const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// WebAuthn (Passkeys / biometría)
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL, isoUint8Array } = require('@simplewebauthn/server/helpers');

// QR para autenticación cross-device
const QRCode = require('qrcode');

// Stellar Soroban SDK
const StellarSdk = require('@stellar/stellar-sdk');

// Configuración Stellar / Soroban
const CONTRACT_ID = process.env.CONTRACT_ID || 'CBNEJ7M4BIAMX4URHV72DYQDS4KELL7EYJJQOHPQIOMFEIWFK64U7D3T';
const COUNTER_CONTRACT_ID = process.env.COUNTER_CONTRACT_ID || CONTRACT_ID;
const STELLAR_SECRET = process.env.STELLAR_SECRET || process.env.SECRET_KEY;
const STELLAR_PUBLIC = process.env.STELLAR_PUBLIC || process.env.PUBLIC_KEY;
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://rpc-testnet.stellar.org';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const BLOCKCHAIN_MODE = process.env.BLOCKCHAIN_MODE || 'full'; // 'off' | 'log' | 'full'

// Base de datos: PostgreSQL (Render) o SQLite (local)
const DATABASE_URL = process.env.DATABASE_URL;
let initSqlJs, pgPool;
if (!DATABASE_URL) {
  initSqlJs = require('sql.js');
}

const app = express();
const PORT = process.env.PORT || 8080;

let JWT_SECRET = process.env.JWT_SECRET;
let JWT_WEBAUTHN_SECRET = process.env.JWT_WEBAUTHN_SECRET;

// Configuración WebAuthn (Passkeys)
const RP_NAME = 'Money Digital - GROUP JAD';
const isRender = !!process.env.RENDER;
const isRailway = !!process.env.RAILWAY;
const RP_ID = process.env.RP_ID || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';

// ORIGINS debe contener SOLO origins exactos que el navegador reportará
const ORIGINS = (() => {
  if (process.env.ORIGINS) return process.env.ORIGINS.split(',').map(s => s.trim());
  const origins = [];
  // Desarrollo local
  origins.push('http://localhost:8080');
  origins.push('http://localhost:3000');
  // Producción Render
  if (process.env.ORIGIN) origins.push(process.env.ORIGIN);
  if (isRender && process.env.RENDER_EXTERNAL_HOSTNAME) {
    origins.push(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}`);
  }
  if (isRailway && process.env.RAILWAY_PUBLIC_DOMAIN) {
    origins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }
  // Surge (solo frontend estático)
  origins.push('https://money-digital.surge.sh');
  return [...new Set(origins)];
})();

function getRPID(req) {
  if (process.env.RP_ID) return process.env.RP_ID;
  const host = req?.headers?.host || 'localhost';
  if (isRender && process.env.RENDER_EXTERNAL_HOSTNAME) return process.env.RENDER_EXTERNAL_HOSTNAME;
  if (isRailway && process.env.RAILWAY_PUBLIC_DOMAIN) return process.env.RAILWAY_PUBLIC_DOMAIN;
  return host.split(':')[0];
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const fullHost = host.includes(':') ? host : (proto === 'https' ? host : host + (process.env.PORT ? `:${process.env.PORT}` : ''));
  return `${proto}://${fullHost}`;
}

// Challenge lifetime: configurable, default 5 min para flujo cross-device con QR
const CHALLENGE_TTL = (parseInt(process.env.CHALLENGE_TTL) || 5) * 60 * 1000;

const challengeStore = {
  async set(key, data) {
    try {
      const id = `ch_${uuidv4()}`;
      const type = key.includes('register') ? 'register' : key.includes('login') ? 'login' : 'qrauth';
      const username = key.replace(/^(register|login|qrauth):/, '');
      await dbRun(`DELETE FROM auth_challenges WHERE type = ? AND username = ?`, [type, username]);
      await dbRun(`INSERT INTO auth_challenges (id, type, username, challenge, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [id, type, username, JSON.stringify(data), data.expiresAt]);
      this._cache.set(key, data);
    } catch (e) {
      console.warn('Error guardando challenge en DB, usando cache:', e.message);
      this._cache.set(key, data);
    }
  },
  async get(key) {
    const cached = this._cache.get(key);
    if (cached) return cached;
    try {
      const type = key.includes('register') ? 'register' : key.includes('login') ? 'login' : 'qrauth';
      const username = key.replace(/^(register|login|qrauth):/, '');
      const result = await dbExec(`SELECT challenge FROM auth_challenges WHERE type = ? AND username = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
        [type, username, Date.now()]);
      if (result.length && result[0].values.length) {
        const data = JSON.parse(result[0].values[0][0]);
        this._cache.set(key, data);
        return data;
      }
    } catch (e) {
      console.warn('Error leyendo challenge de DB:', e.message);
    }
    return null;
  },
  async delete(key) {
    this._cache.delete(key);
    try {
      const type = key.includes('register') ? 'register' : key.includes('login') ? 'login' : 'qrauth';
      const username = key.replace(/^(register|login|qrauth):/, '');
      await dbRun(`DELETE FROM auth_challenges WHERE type = ? AND username = ?`, [type, username]);
    } catch (e) {
      console.warn('Error eliminando challenge de DB:', e.message);
    }
  },
  _cache: new Map()
};

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const DOCS_DIR = path.join(__dirname, 'docs');
const SECRETS_FILE = path.join(DATA_DIR, 'jwt_secrets.json');

// Asegurar directorios
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function loadOrGenerateSecrets() {
  if (JWT_SECRET && JWT_WEBAUTHN_SECRET) return;
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
      if (saved.jwt && saved.webauthn) {
        JWT_SECRET = saved.jwt;
        JWT_WEBAUTHN_SECRET = saved.webauthn;
        console.log('🔑 Secretos JWT cargados desde archivo persistente.');
        return;
      }
    }
  } catch (e) { /* ignorar */ }
  const secrets = {
    jwt: crypto.randomBytes(32).toString('hex'),
    webauthn: crypto.randomBytes(32).toString('hex'),
  };
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
    console.log('🔑 Secretos JWT generados y guardados permanentemente en data/jwt_secrets.json');
    console.log('   Las sesiones persistirán entre reinicios del servidor.');
  } catch (e) { /* ignorar */ }
  JWT_SECRET = secrets.jwt;
  JWT_WEBAUTHN_SECRET = secrets.webauthn;
}
loadOrGenerateSecrets();

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Middleware
app.use(cors({
  origin: ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Seguridad: headers básicos
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Rate limiter simple en memoria para login/register
const rateLimitStore = {};
// Limpiar entradas antiguas cada 5 minutos
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const key of Object.keys(rateLimitStore)) {
    rateLimitStore[key] = rateLimitStore[key].filter(t => t > cutoff);
    if (rateLimitStore[key].length === 0) delete rateLimitStore[key];
  }
}, 300000);
function rateLimit(ms, maxRequests) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    if (!rateLimitStore[key]) rateLimitStore[key] = [];
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < ms);
    if (rateLimitStore[key].length >= maxRequests) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' });
    }
    rateLimitStore[key].push(now);
    next();
  };
}

app.use('/uploads', anyAuthMiddleware, express.static(UPLOADS_DIR));

// Variable global de DB (compatible SQLite y PostgreSQL)
let db = null;

// Convertir ? a $1,$2,... para PostgreSQL
function pgParams(sql, params) {
  if (!params || params.length === 0) return { sql, params };
  let idx = 0;
  const converted = sql.replace(/\?/g, () => `$${++idx}`);
  return { sql: converted, params };
}

// Ejecutar query y devolver en formato {columns, values}[]
async function dbExec(sql, params) {
  if (DATABASE_URL) {
    const { Pool } = require('pg');
    if (!pgPool) pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const { sql: pgSql, params: pgParamsArr } = pgParams(sql, params);
    try {
      const result = await pgPool.query(pgSql, pgParamsArr);
      if (!result.rows.length) return [];
      return [{ columns: Object.keys(result.rows[0]), values: result.rows.map(r => Object.values(r)) }];
    } catch (pgErr) {
      console.error('ERROR en PostgreSQL, intentando SQLite como fallback:', pgErr.message);
      await ensureSQLiteFallback();
    }
  }
  if (!db) await ensureSQLiteFallback();
  // sql.js: db.exec() NO acepta parámetros, usar prepared statements
  if (!params || params.length === 0) {
    return db.exec(sql);
  }
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  if (rows.length === 0) return [];
  return [{ columns: Object.keys(rows[0]), values: rows.map(r => Object.values(r)) }];
}

async function ensureSQLiteFallback() {
  if (!db) {
    console.warn('⚠️ SQLite no estaba inicializado. Inicializando como fallback...');
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'estudiante',
      stellar_public TEXT, stellar_secret_encrypted TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, username TEXT NOT NULL,
      challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, tokens INTEGER NOT NULL DEFAULT 0,
      deadline TEXT, subject TEXT, instructions TEXT, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'active'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, activity_id TEXT NOT NULL, student_username TEXT NOT NULL,
      file_path TEXT, file_name TEXT, file_type TEXT, file_size INTEGER, comments TEXT,
      status TEXT NOT NULL DEFAULT 'pending', submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT, reviewed_by TEXT, review_comment TEXT, tokens_awarded INTEGER DEFAULT 0,
      blockchain_tx_hash TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, cost INTEGER NOT NULL,
      image TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active', redeemed_count INTEGER DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS redemptions (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, reward_id TEXT NOT NULL,
      reward_name TEXT NOT NULL, cost INTEGER NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS token_transactions (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL,
      activity_id TEXT, reward_id TEXT, description TEXT, blockchain_tx_hash TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS counter_state (
      id TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    console.log('✅ SQLite fallback inicializado correctamente');
  }
}

async function dbRun(sql, params) {
  if (DATABASE_URL) {
    const { Pool } = require('pg');
    if (!pgPool) pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const { sql: pgSql, params: pgParamsArr } = pgParams(sql, params);
    try {
      await pgPool.query(pgSql, pgParamsArr);
      return;
    } catch (pgErr) {
      console.error('ERROR en dbRun PostgreSQL, usando SQLite como fallback:', pgErr.message);
      await ensureSQLiteFallback();
    }
  }
  if (!db) await ensureSQLiteFallback();
  db.run(sql, params);
  saveDB();
}

// Inicializar base de datos SQLite (usada como fallback o principal)
async function initSQLite() {
  const SQL = await initSqlJs();
  let buffer;
  if (fs.existsSync(DB_PATH)) {
    buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log(`📂 Base de datos SQLite cargada desde ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log(`🆕 Base de datos SQLite creada en ${DB_PATH}`);
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'estudiante',
    stellar_public TEXT,
    stellar_secret_encrypted TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    tokens INTEGER NOT NULL DEFAULT 0,
    deadline TEXT,
    subject TEXT,
    instructions TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY (created_by) REFERENCES users(username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    student_username TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    file_type TEXT,
    file_size INTEGER,
    comments TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    reviewed_by TEXT,
    review_comment TEXT,
    tokens_awarded INTEGER DEFAULT 0,
    blockchain_tx_hash TEXT,
    FOREIGN KEY (activity_id) REFERENCES activities(id),
    FOREIGN KEY (student_username) REFERENCES users(username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rewards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    cost INTEGER NOT NULL,
    image TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active',
    redeemed_count INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS redemptions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    reward_id TEXT NOT NULL,
    reward_name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (username) REFERENCES users(username),
    FOREIGN KEY (reward_id) REFERENCES rewards(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS token_transactions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    activity_id TEXT,
    reward_id TEXT,
    description TEXT,
    blockchain_tx_hash TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (username) REFERENCES users(username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (username) REFERENCES users(username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS counter_state (
    id TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    username TEXT NOT NULL,
    challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`DELETE FROM auth_challenges WHERE expires_at < ?`, [Date.now()]);

  const counterRow = db.exec(`SELECT id FROM counter_state WHERE id = 'global'`);
  if (!counterRow.length || !counterRow[0].values.length) {
    db.run(`INSERT INTO counter_state (id, value, updated_at) VALUES ('global', 0, datetime('now'))`);
  }

  saveDB();
  console.log('✅ Base de datos SQLite inicializada correctamente');
}

// Inicializar base de datos
async function initDB() {
  if (DATABASE_URL) {
    console.log(`🗄️  Modo DB: PostgreSQL detectado (${DATABASE_URL.substring(0, 30)}...)`);
    try {
      const { Pool } = require('pg');
      pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
      const testResult = await pgPool.query('SELECT NOW()');
      console.log(`✅ Conexión PostgreSQL exitosa: ${testResult.rows[0].now}`);

      // Crear tablas en PostgreSQL
      await pgPool.query(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'estudiante',
        stellar_public TEXT, stellar_secret_encrypted TEXT, created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, tokens INTEGER NOT NULL DEFAULT 0,
        deadline TEXT, subject TEXT, instructions TEXT, created_by TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(), status TEXT NOT NULL DEFAULT 'active'
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY, activity_id TEXT NOT NULL, student_username TEXT NOT NULL,
        file_path TEXT, file_name TEXT, file_type TEXT, file_size INTEGER, comments TEXT,
        status TEXT NOT NULL DEFAULT 'pending', submitted_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP, reviewed_by TEXT, review_comment TEXT, tokens_awarded INTEGER DEFAULT 0,
        blockchain_tx_hash TEXT
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS rewards (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, cost INTEGER NOT NULL,
        image TEXT, created_by TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'active', redeemed_count INTEGER DEFAULT 0
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS redemptions (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, reward_id TEXT NOT NULL,
        reward_name TEXT NOT NULL, cost INTEGER NOT NULL, timestamp TIMESTAMP DEFAULT NOW()
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS token_transactions (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL,
        activity_id TEXT, reward_id TEXT, description TEXT, blockchain_tx_hash TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS counter_state (
        id TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW()
      )`);
      await pgPool.query(`CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, username TEXT NOT NULL, challenge TEXT NOT NULL,
        expires_at BIGINT NOT NULL, created_at TIMESTAMP DEFAULT NOW()
      )`);

      await pgPool.query(`DELETE FROM auth_challenges WHERE expires_at < $1`, [Date.now()]);
      const counterRow = await pgPool.query(`SELECT id FROM counter_state WHERE id = 'global'`);
      if (!counterRow.rows.length) {
        await pgPool.query(`INSERT INTO counter_state (id, value, updated_at) VALUES ('global', 0, NOW())`);
      }

      console.log('✅ Base de datos PostgreSQL inicializada correctamente');
    } catch (pgErr) {
      console.error(`❌ Error con PostgreSQL: ${pgErr.message}`);
      console.error(`   ⚠️  USANDO SQLITE COMO FALLBACK`);
      pgPool = null;
      await initSQLite();
    }
  } else {
    console.log('🗄️  Modo DB: SQLite local');
    await initSQLite();
  }
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'docente') {
    return res.status(403).json({ error: 'Solo docentes pueden realizar esta acción' });
  }
  next();
}

// Middleware para autenticación biométrica (Passkeys)
function biometricAuthMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token biométrico requerido' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_WEBAUTHN_SECRET);
    if (decoded.authMethod !== 'passkey') {
      return res.status(401).json({ error: 'Token no es biométrico' });
    }
    req.biometricUser = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token biométrico inválido o expirado' });
  }
}

// Middleware de autenticación unificado - acepta tokens de contraseña Y biométricos
async function anyAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }
    const token = header.split(' ')[1];
    
    // Intentar con JWT_SECRET (login con contraseña)
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      req.authMethod = 'password';
      return next();
    } catch (e) {
      // No es token de contraseña, continuar
    }
    
    // Intentar con JWT_WEBAUTHN_SECRET (login biométrico)
    try {
      const decoded = jwt.verify(token, JWT_WEBAUTHN_SECRET);
      if (decoded.authMethod === 'passkey') {
        // Buscar datos completos del usuario en DB
        const userResult = await dbExec(`SELECT id, username, email, role, stellar_public FROM users WHERE username = ?`, [decoded.username]);
        if (userResult.length && userResult[0].values.length) {
          const cols = userResult[0].columns;
          const row = userResult[0].values[0];
          const idx = (name) => cols.indexOf(name);
          req.user = {
            id: row[idx('id')],
            username: row[idx('username')],
            email: row[idx('email')],
            role: row[idx('role')],
            stellarPublic: row[idx('stellar_public')],
            authMethod: 'passkey',
            credentialId: decoded.credentialId
          };
          req.authMethod = 'passkey';
          return next();
        }
      }
    } catch (e) {
      // No es token biométrico
    }
    
    return res.status(401).json({ error: 'Token inválido o expirado' });
  } catch (e) {
    console.error('Error en anyAuthMiddleware:', e);
    return res.status(500).json({ error: 'Error interno de autenticación' });
  }
}

// ========================
// WEBAUTHN (PASSKEYS) + QR CROSS-DEVICE ROUTES
// ========================

// 1. Iniciar registro biométrico
app.post('/api/auth/passkey/register/begin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username requerido' });

    const userResult = await dbExec(`SELECT id, username FROM users WHERE username = ?`, [username]);
    if (!userResult.length || !userResult[0].values.length) {
      return res.status(404).json({ error: 'Usuario no encontrado. Regístrate primero.' });
    }

    const existingKeys = await dbExec(`SELECT credential_id, public_key, counter, transports FROM passkeys WHERE username = ?`, [username]);

    const existingCredentials = existingKeys.length && existingKeys[0].values.length
      ? existingKeys[0].values.map(row => ({
          id: row[0],
          publicKey: row[1],
          counter: parseInt(row[2] || 0),
          transports: row[3] ? JSON.parse(row[3]) : []
        }))
      : [];

    const effectiveRPID = getRPID(req);
    const userIDBuffer = crypto.randomBytes(32);
    const userID = isoBase64URL.fromBuffer(userIDBuffer);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: effectiveRPID,
      userName: username,
      userDisplayName: username,
      user: {
        id: userIDBuffer,
        name: username,
        displayName: username,
      },
      attestationType: 'none',
      excludeCredentials: existingCredentials.map(cred => ({
        id: cred.id,
        transports: cred.transports,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        requireResidentKey: true,
      },
    });

    await challengeStore.set(`register:${username}`, {
      challenge: options.challenge,
      username,
      userID,
      expiresAt: Date.now() + CHALLENGE_TTL,
    });

    res.json(options);
  } catch (e) {
    console.error('Error en register/begin:', e);
    res.status(500).json({ error: `Error al iniciar registro: ${e.message}` });
  }
});

// 2. Completar registro biométrico
app.post('/api/auth/passkey/register/complete', async (req, res) => {
  try {
    const { username, credential } = req.body;
    if (!username || !credential) return res.status(400).json({ error: 'Username y credential requeridos' });

    const storedData = await challengeStore.get(`register:${username}`);
    if (!storedData) return res.status(400).json({ error: 'Inicia el registro primero (/register/begin)' });

    if (Date.now() > storedData.expiresAt) {
      await challengeStore.delete(`register:${username}`);
      return res.status(400).json({ error: 'Challenge expirado. Intenta de nuevo.' });
    }

    const effectiveRPID = getRPID(req);
    const effectiveOrigin = getOrigin(req);

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: storedData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: effectiveRPID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verificación biométrica fallida. El navegador no pudo validar la credencial.' });
    }

    const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

    const id = uuidv4();
    const credentialIdBase64 = isoBase64URL.fromBuffer(credentialID);
    const publicKeyBase64 = isoBase64URL.fromBuffer(credentialPublicKey);

    let transports = [];
    if (credential.response && Array.isArray(credential.response.transports)) {
      transports = credential.response.transports;
    }
    const transportsStr = JSON.stringify(transports);

    await dbRun(`INSERT INTO passkeys (id, username, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, username, credentialIdBase64, publicKeyBase64, counter, transportsStr]);

    await challengeStore.delete(`register:${username}`);

    const token = jwt.sign(
      { id, username, authMethod: 'passkey', credentialId: credentialIdBase64 },
      JWT_WEBAUTHN_SECRET,
      { expiresIn: '24h' }
    );

    const userResult = await dbExec(`SELECT id, username, email, role, stellar_public FROM users WHERE username = ?`, [username]);

    res.json({
      verified: true,
      token,
      user: userResult.length && userResult[0].values.length ? {
        id: userResult[0].values[0][0],
        username: userResult[0].values[0][1],
        email: userResult[0].values[0][2],
        role: userResult[0].values[0][3],
        stellarPublic: userResult[0].values[0][4],
      } : { username },
      walletId: credentialIdBase64.substring(0, 12) + '...'
    });
  } catch (e) {
    console.error('Error en register/complete:', e);
    res.status(500).json({ error: `Error al completar registro: ${e.message}` });
  }
});

app.post('/api/auth/passkey/login/begin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username requerido' });

    const effectiveRPID = getRPID(req);

    const allowCredentials = [];
    if (username !== '__discovery__') {
      const existingKeys = await dbExec(`SELECT credential_id, transports FROM passkeys WHERE username = ?`, [username]);
      if (existingKeys.length && existingKeys[0].values.length) {
        existingKeys[0].values.forEach(row => {
          allowCredentials.push({
            id: row[0],
            transports: row[1] ? JSON.parse(row[1]) : [],
          });
        });
      }
    }

    const authOptions = {
      rpID: effectiveRPID,
      userVerification: 'required',
    };
    if (allowCredentials.length > 0) {
      authOptions.allowCredentials = allowCredentials;
    }

    const options = await generateAuthenticationOptions(authOptions);

    await challengeStore.set(`login:${username}`, {
      challenge: options.challenge,
      username,
      expiresAt: Date.now() + CHALLENGE_TTL,
    });

    res.json(options);
  } catch (e) {
    console.error('Error en login/begin:', e);
    res.status(500).json({ error: `Error al iniciar sesión: ${e.message}` });
  }
});

// 4. Completar login biométrico
app.post('/api/auth/passkey/login/complete', async (req, res) => {
  try {
    const { username, credential } = req.body;
    if (!username || !credential) return res.status(400).json({ error: 'Username y credential requeridos' });

    const storedData = await challengeStore.get(`login:${username}`);
    if (!storedData) return res.status(400).json({ error: 'Inicia sesión primero (/login/begin)' });

    if (Date.now() > storedData.expiresAt) {
      await challengeStore.delete(`login:${username}`);
      return res.status(400).json({ error: 'Challenge expirado. Intenta de nuevo.' });
    }

    const credId = credential.id;

    // Si el credential viene con userHandle, intentar identificar al usuario
    let effectiveUsername = username;
    if (credential.response?.userHandle) {
      try {
        const userHandleStr = credential.response.userHandle;
        // Intentar buscar por credential ID primero (independiente del username enviado)
        const userByCred = await dbExec(`SELECT username FROM passkeys WHERE credential_id = ?`, [credId]);
        if (userByCred.length && userByCred[0].values.length) {
          effectiveUsername = userByCred[0].values[0][0];
        }
      } catch (e) {
        // Si falla, usar el username original
      }
    }

    const credResult = await dbExec(`SELECT * FROM passkeys WHERE credential_id = ?`, [credId]);
    if (!credResult.length || !credResult[0].values.length) {
      return res.status(404).json({ error: 'Credencial no encontrada. ¿Registraste tu passkey primero?' });
    }

    const cols = credResult[0].columns;
    const row = credResult[0].values[0];
    const idx = (name) => cols.indexOf(name);
    const credUsername = row[idx('username')];

    if (credUsername !== effectiveUsername) {
      return res.status(403).json({ error: 'Esta credencial no pertenece al usuario solicitado' });
    }

    const storedCredential = {
      id: row[idx('credential_id')],
      publicKey: row[idx('public_key')],
      counter: parseInt(row[idx('counter')] || 0),
      transports: row[idx('transports')] ? JSON.parse(row[idx('transports')]) : [],
    };

    const effectiveRPID = getRPID(req);

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: storedData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: effectiveRPID,
      credential: {
        id: storedCredential.id,
        publicKey: isoBase64URL.toBuffer(storedCredential.publicKey),
        counter: storedCredential.counter,
        transports: storedCredential.transports,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verificación biométrica fallida. La firma no coincide.' });
    }

    const newCounter = verification.authenticationInfo?.newCounter || storedCredential.counter;
    await dbRun(`UPDATE passkeys SET counter = ? WHERE credential_id = ?`, [newCounter, credId]);

    await challengeStore.delete(`login:${effectiveUsername}`);

    const userResult = await dbExec(`SELECT id, username, email, role, stellar_public FROM users WHERE username = ?`, [effectiveUsername]);

    if (!userResult.length || !userResult[0].values.length) {
      return res.status(500).json({ error: 'Usuario no encontrado en la base de datos' });
    }

    const token = jwt.sign(
      { id: userResult[0].values[0][0], username: effectiveUsername, role: userResult[0].values[0][3], authMethod: 'passkey', credentialId: credId },
      JWT_WEBAUTHN_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      verified: true,
      token,
      user: {
        id: userResult[0].values[0][0],
        username: userResult[0].values[0][1],
        email: userResult[0].values[0][2],
        role: userResult[0].values[0][3],
        stellarPublic: userResult[0].values[0][4],
      },
      walletId: credId.substring(0, 12) + '...'
    });
  } catch (e) {
    console.error('Error en login/complete:', e);
    res.status(500).json({ error: `Error al verificar biometría: ${e.message}` });
  }
});

// 5. Verificar estado del token biométrico
app.get('/api/auth/passkey/status', biometricAuthMiddleware, (req, res) => {
  res.json({ valid: true, username: req.biometricUser.username, walletId: req.biometricUser.credentialId?.substring(0, 12) + '...' });
});

// 6. Cerrar sesión biométrica
app.post('/api/auth/passkey/logout', biometricAuthMiddleware, (req, res) => {
  res.json({ success: true, message: 'Sesión biométrica cerrada' });
});

// 7. Verificar si un usuario tiene passkey registrada
app.get('/api/auth/passkey/has-passkey/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await dbExec(`SELECT id FROM passkeys WHERE username = ? LIMIT 1`, [username]);
    const hasPasskey = result.length > 0 && result[0].values.length > 0;
    res.json({ hasPasskey, username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Listar passkeys del usuario autenticado
app.get('/api/auth/passkey/list', anyAuthMiddleware, async (req, res) => {
  try {
    const result = await dbExec(`SELECT id, credential_id, created_at, counter FROM passkeys WHERE username = ?`, [req.user.username]);
    if (!result.length) return res.json([]);
    const cols = result[0].columns;
    const idx = (name) => cols.indexOf(name);
    const passkeys = result[0].values.map(row => ({
      id: row[idx('id')],
      credentialId: row[idx('credential_id')],
      createdAt: row[idx('created_at')],
      counter: parseInt(row[idx('counter')] || 0),
    }));
    res.json(passkeys);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 9. Eliminar una passkey
app.delete('/api/auth/passkey/:id', anyAuthMiddleware, async (req, res) => {
  try {
    const result = await dbExec(`SELECT username FROM passkeys WHERE id = ?`, [req.params.id]);
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Passkey no encontrada' });
    }
    if (result[0].values[0][0] !== req.user.username) {
      return res.status(403).json({ error: 'No puedes eliminar la passkey de otro usuario' });
    }
    await dbRun(`DELETE FROM passkeys WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Passkey eliminada correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// QR CROSS-DEVICE AUTH
// ========================

// Almacén de sesiones QR
const qrSessionStore = {
  _sessions: new Map(),
  create(username) {
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      username,
      status: 'pending', // pending | scanned | authenticated | expired | failed
      qrCode: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + CHALLENGE_TTL,
      token: null,
      error: null,
    };
    this._sessions.set(sessionId, session);
    return session;
  },
  get(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      return session;
    }
    return session;
  },
  setStatus(sessionId, status, extra = {}) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    Object.assign(session, { status, ...extra });
  },
  cleanup() {
    const now = Date.now();
    for (const [id, session] of this._sessions) {
      if (now > session.expiresAt + 60000) {
        this._sessions.delete(id);
      }
    }
  }
};

// Limpiar sesiones expiradas cada 5 minutos
setInterval(() => qrSessionStore.cleanup(), 300000);

// 10. Generar QR para login cross-device
app.post('/api/auth/qr/generate', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username requerido' });
    console.log(`📱 QR solicitud generación para username="${username}" (DB mode: ${DATABASE_URL ? 'PostgreSQL' : 'SQLite'})`);

    const userResult = await dbExec(`SELECT id, username FROM users WHERE username = ?`, [username]);
    console.log(`📱 QR resultado búsqueda: encontrado=${userResult.length > 0 && userResult[0].values.length > 0}`);
    if (!userResult.length || !userResult[0].values.length) {
      console.warn(`❌ QR usuario "${username}" NO encontrado en DB`);
      // Debug: listar usuarios existentes
      try {
        const allUsers = await dbExec(`SELECT username FROM users ORDER BY created_at DESC LIMIT 10`);
        if (allUsers.length > 0 && allUsers[0].values.length > 0) {
          const names = allUsers[0].values.map(r => r[0]);
          console.log(`📱 QR usuarios en DB: ${JSON.stringify(names)}`);
        } else {
          console.log(`📱 QR NO HAY usuarios en DB`);
        }
      } catch (listErr) {
        console.error(`📱 QR error listando usuarios:`, listErr.message);
      }
      return res.status(404).json({ error: 'Usuario no encontrado. Regístrate primero.' });
    }
    console.log(`📱 QR usuario "${username}" encontrado en DB correctamente`);

    const session = qrSessionStore.create(username);

    // Crear payload QR como URL navegable (usar siempre la URL pública)
    const publicOrigin = process.env.ORIGIN || `https://${getRPID(req)}`;
    const effectiveRPID = getRPID(req);
    const qrURL = `${publicOrigin}/qr-auth.html?s=${encodeURIComponent(session.id)}&r=${encodeURIComponent(effectiveRPID)}`;
    const qrPayload = qrURL;

    const qrDataURL = await QRCode.toDataURL(qrPayload, {
      width: 300,
      margin: 2,
      color: { dark: '#00eaff', light: '#00000000' },
    });

    session.qrCode = qrDataURL;

    res.json({
      sessionId: session.id,
      qrCode: qrDataURL,
      qrPayload,
      expiresAt: session.expiresAt,
      status: 'pending',
    });
  } catch (e) {
    console.error('Error generando QR:', e);
    res.status(500).json({ error: `Error al generar QR: ${e.message}` });
  }
});

// 11. Escanear QR desde el móvil e iniciar autenticación
app.post('/api/auth/qr/scan', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });

    const session = qrSessionStore.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión QR no encontrada o expirada' });

    if (session.status !== 'pending') {
      return res.status(400).json({ error: `Sesión QR ya no está pendiente (estado: ${session.status})` });
    }

    qrSessionStore.setStatus(sessionId, 'scanned');

    const effectiveRPID = getRPID(req);

    const allowCredentials = [];
    const existingKeys = await dbExec(`SELECT credential_id, transports FROM passkeys WHERE username = ?`, [session.username]);
    if (existingKeys.length && existingKeys[0].values.length) {
      existingKeys[0].values.forEach(row => {
        allowCredentials.push({
          id: row[0],
          transports: row[1] ? JSON.parse(row[1]) : [],
        });
      });
    }

    const authOptions = {
      rpID: effectiveRPID,
      userVerification: 'required',
    };
    if (allowCredentials.length > 0) {
      authOptions.allowCredentials = allowCredentials;
    }

    const options = await generateAuthenticationOptions(authOptions);

    await challengeStore.set(`qrauth:${sessionId}`, {
      challenge: options.challenge,
      sessionId,
      username: session.username,
      expiresAt: Date.now() + CHALLENGE_TTL,
    });

    res.json({
      status: 'scanned',
      username: session.username,
      challenge: options.challenge,
      rpID: effectiveRPID,
      options,
    });
  } catch (e) {
    console.error('Error escaneando QR:', e);
    res.status(500).json({ error: `Error al escanear QR: ${e.message}` });
  }
});

// 12. Completar autenticación desde el móvil (después de escanear QR)
app.post('/api/auth/qr/authenticate', async (req, res) => {
  try {
    const { sessionId, credential } = req.body;
    if (!sessionId || !credential) return res.status(400).json({ error: 'sessionId y credential requeridos' });

    const session = qrSessionStore.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión QR no encontrada o expirada' });

    const storedData = await challengeStore.get(`qrauth:${sessionId}`);
    if (!storedData) return res.status(400).json({ error: 'Challenge no encontrado. Escanea el QR primero.' });

    if (Date.now() > storedData.expiresAt) {
      await challengeStore.delete(`qrauth:${sessionId}`);
      qrSessionStore.setStatus(sessionId, 'expired');
      return res.status(400).json({ error: 'Challenge expirado. Escanea el QR de nuevo.' });
    }

    // Buscar la credencial
    const credId = credential.id;
    const credResult = await dbExec(`SELECT * FROM passkeys WHERE credential_id = ?`, [credId]);
    if (!credResult.length || !credResult[0].values.length) {
      qrSessionStore.setStatus(sessionId, 'failed', { error: 'Credencial no encontrada' });
      return res.status(404).json({ error: 'Credencial no encontrada. Registra tu passkey primero.' });
    }

    const cols = credResult[0].columns;
    const row = credResult[0].values[0];
    const idx = (name) => cols.indexOf(name);
    const credUsername = row[idx('username')];

    if (credUsername !== session.username) {
      qrSessionStore.setStatus(sessionId, 'failed', { error: 'Credencial no pertenece al usuario' });
      return res.status(403).json({ error: 'Esta credencial no pertenece al usuario de la sesión QR' });
    }

    const storedCredential = {
      id: row[idx('credential_id')],
      publicKey: row[idx('public_key')],
      counter: parseInt(row[idx('counter')] || 0),
      transports: row[idx('transports')] ? JSON.parse(row[idx('transports')]) : [],
    };

    const effectiveRPID = getRPID(req);

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: storedData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: effectiveRPID,
      credential: {
        id: storedCredential.id,
        publicKey: isoBase64URL.toBuffer(storedCredential.publicKey),
        counter: storedCredential.counter,
        transports: storedCredential.transports,
      },
    });

    if (!verification.verified) {
      qrSessionStore.setStatus(sessionId, 'failed', { error: 'Verificación fallida' });
      return res.status(400).json({ error: 'Verificación biométrica fallida' });
    }

    const newCounter = verification.authenticationInfo?.newCounter || storedCredential.counter;
    await dbRun(`UPDATE passkeys SET counter = ? WHERE credential_id = ?`, [newCounter, credId]);

    await challengeStore.delete(`qrauth:${sessionId}`);

    const userResult = await dbExec(`SELECT id, username, email, role, stellar_public FROM users WHERE username = ?`, [session.username]);

    const token = jwt.sign(
      { id: userResult[0].values[0][0], username: session.username, role: userResult[0].values[0][3], authMethod: 'passkey', credentialId: credId },
      JWT_WEBAUTHN_SECRET,
      { expiresIn: '24h' }
    );

    qrSessionStore.setStatus(sessionId, 'authenticated', { token });

    res.json({
      verified: true,
      token,
      user: {
        id: userResult[0].values[0][0],
        username: userResult[0].values[0][1],
        email: userResult[0].values[0][2],
        role: userResult[0].values[0][3],
        stellarPublic: userResult[0].values[0][4],
      },
      walletId: credId.substring(0, 12) + '...'
    });
  } catch (e) {
    console.error('Error en QR authenticate:', e);
    res.status(500).json({ error: `Error en autenticación QR: ${e.message}` });
  }
});

// 13. Polling: el desktop consulta el estado de la sesión QR
app.get('/api/auth/qr/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = qrSessionStore.get(sessionId);
  if (!session) {
    return res.json({ status: 'expired', error: 'Sesión no encontrada o expirada' });
  }

  const response = {
    status: session.status,
    username: session.username,
  };

  if (session.status === 'authenticated' && session.token) {
    response.token = session.token;
  }

  if (session.status === 'failed') {
    response.error = session.error;
  }

  res.json(response);
});

// ========================
// SOROBAN HELPER
// ========================

async function sorobanInvoke(functionName, args = []) {
  if (!STELLAR_SECRET || BLOCKCHAIN_MODE === 'off') return { hash: null, error: 'Blockchain disabled' };
  try {
    const contractId = ['increment', 'decrement', 'reset', 'get'].includes(functionName)
      ? COUNTER_CONTRACT_ID : CONTRACT_ID;
    const server = new StellarSdk.SorobanRpc.Server(SOROBAN_RPC_URL);
    const keypair = StellarSdk.Keypair.fromSecret(STELLAR_SECRET);
    const publicKey = keypair.publicKey();
    const account = await server.getAccount(publicKey);
    const contract = new StellarSdk.Contract(contractId);
    let operation;
    if (functionName === 'get') {
      operation = contract.call(functionName);
    } else {
      const scvalArgs = args.map(a => {
        if (typeof a === 'number' || typeof a === 'bigint') return StellarSdk.xdr.ScVal.scvU32(Number(a));
        if (typeof a === 'string' && a.startsWith('G')) return StellarSdk.xdr.ScVal.scvAddress(StellarSdk.Keypair.fromPublicKey(a).xdrAccountId());
        return StellarSdk.xdr.ScVal.scvU32(Number(a));
      });
      operation = contract.call(functionName, ...scvalArgs);
    }
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();
    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(keypair);
    const result = await server.sendTransaction(preparedTx);
    return { hash: result.hash, error: null };
  } catch (e) {
    if (BLOCKCHAIN_MODE === 'full') {
      console.error(`Soroban invoke (${functionName}):`, e.message);
      return { hash: null, error: e.message };
    }
    console.warn(`Soroban invoke (${functionName}):`, e.message);
    return { hash: null, error: e.message };
  }
}

// ========================
// COUNTER (CONTADOR) ROUTES
// ========================

// Obtener valor del contador (público)
app.get('/api/counter', (req, res) => {
  try {
    const result = db.exec(`SELECT value FROM counter_state WHERE id = 'global'`);
    const value = (result.length && result[0].values.length) ? parseInt(result[0].values[0][0]) : 0;
    res.json({ value, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Incrementar contador (requiere auth - contraseña o biométrico)
app.post('/api/counter/increment', anyAuthMiddleware, async (req, res) => {
  try {
    const result = db.exec(`SELECT value FROM counter_state WHERE id = 'global'`);
    let value = (result.length && result[0].values.length) ? parseInt(result[0].values[0][0]) : 0;
    value += 1;
    db.run(`UPDATE counter_state SET value = ?, updated_at = datetime('now') WHERE id = 'global'`, [value]);
    saveDB();

    let txHash = null;
    if (STELLAR_SECRET) {
      const sorobanResult = await sorobanInvoke('increment');
      txHash = sorobanResult.hash;
    }

    res.json({ value, success: true, txHash, username: req.user.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Decrementar contador (requiere auth - contraseña o biométrico)
app.post('/api/counter/decrement', anyAuthMiddleware, async (req, res) => {
  try {
    const result = db.exec(`SELECT value FROM counter_state WHERE id = 'global'`);
    let value = (result.length && result[0].values.length) ? parseInt(result[0].values[0][0]) : 0;
    value = Math.max(0, value - 1);
    db.run(`UPDATE counter_state SET value = ?, updated_at = datetime('now') WHERE id = 'global'`, [value]);
    saveDB();

    let txHash = null;
    if (STELLAR_SECRET) {
      const sorobanResult = await sorobanInvoke('decrement');
      txHash = sorobanResult.hash;
    }

    res.json({ value, success: true, txHash, username: req.user.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resetear contador (requiere auth - contraseña o biométrico)
app.post('/api/counter/reset', anyAuthMiddleware, async (req, res) => {
  try {
    db.run(`UPDATE counter_state SET value = 0, updated_at = datetime('now') WHERE id = 'global'`);
    saveDB();

    let txHash = null;
    if (STELLAR_SECRET) {
      const sorobanInvokeResult = await sorobanInvoke('reset');
      txHash = sorobanInvokeResult.hash;
    }

    res.json({ value: 0, success: true, txHash, username: req.user.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// API ROUTES
// ========================

// --- AUTH ---
app.post('/api/auth/register', rateLimit(60000, 5), async (req, res) => {
  try {
    const { username, email, password, role, stellarPublic, stellarSecretEncrypted } = req.body;
    console.log(`📝 REGISTER solicitud recibida: username="${username}", email="${email}", role="${role}"`);

    if (!username || !email || !password) {
      console.warn(`❌ REGISTER campos faltantes: username=${!!username}, email=${!!email}, password=${!!password}`);
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (username.length < 3) return res.status(400).json({ error: 'Usuario debe tener al menos 3 caracteres' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'Contraseña debe tener al menos 6 caracteres' });
    const allowedRoles = ['estudiante', 'docente'];
    const finalRole = allowedRoles.includes(role) ? role : 'estudiante';

    console.log(`🔍 REGISTER buscando duplicados para "${username}" o "${email}"...`);
    const existing = await dbExec(`SELECT id FROM users WHERE username = ? OR email = ?`, [username, email]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      console.warn(`❌ REGISTER usuario duplicado: "${username}" o "${email}" ya existe`);
      return res.status(400).json({ error: 'Usuario o email ya registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = new Date().toISOString();
    console.log(`🔑 REGISTER hash generado, id="${id}"`);

    // Generar par de llaves Stellar automáticamente si no se proporcionaron
    let finalStellarPublic = stellarPublic || null;
    let finalStellarSecretEncrypted = stellarSecretEncrypted || null;

    try {
      const kp = StellarSdk.Keypair.random();
      finalStellarPublic = stellarPublic || kp.publicKey();
      finalStellarSecretEncrypted = stellarSecretEncrypted || kp.secret();
      console.log(`✅ REGISTER cuenta Stellar generada para ${username}: ${finalStellarPublic.substring(0, 8)}...`);
    } catch (stellarErr) {
      console.warn('⚠️ REGISTER no se pudo generar cuenta Stellar:', stellarErr.message);
    }

    console.log(`💾 REGISTER insertando usuario "${username}" en DB...`);
    console.log(`   DB mode: ${DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`);
    await dbRun(`INSERT INTO users (id, username, email, password_hash, role, stellar_public, stellar_secret_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, username, email, passwordHash, finalRole, finalStellarPublic, finalStellarSecretEncrypted, now]);

    // VERIFICAR que el usuario se guardó correctamente
    const verifyUser = await dbExec(`SELECT id, username FROM users WHERE username = ?`, [username]);
    if (verifyUser.length > 0 && verifyUser[0].values.length > 0) {
      console.log(`✅ REGISTER usuario "${username}" verificado en DB correctamente (id=${verifyUser[0].values[0][0]})`);
    } else {
      console.error(`❌ REGISTER FALLO CRÍTICO: usuario "${username}" NO se encontró después de insertar!`);
      return res.status(500).json({ error: 'Error al persistir el usuario. Intenta de nuevo.' });
    }

    const token = jwt.sign({ id, username, email, role: finalRole, stellarPublic: finalStellarPublic }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`✅ REGISTER exitoso para "${username}", token generado`);
    res.json({ token, user: { id, username, email, role: finalRole, stellarPublic: finalStellarPublic } });
  } catch (e) {
    console.error('❌ Error en registro:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/auth/login', rateLimit(60000, 10), async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`🔐 LOGIN solicitud para username="${username}"`);
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    console.log(`🔍 LOGIN buscando usuario "${username}" en DB (modo: ${DATABASE_URL ? 'PostgreSQL' : 'SQLite'})...`);
    const result = await dbExec(`SELECT * FROM users WHERE username = ?`, [username]);
    
    if (!result.length || !result[0].values.length) {
      console.warn(`❌ LOGIN usuario "${username}" NO encontrado en DB`);
      // Debug: listar todos los usuarios para diagnóstico
      try {
        const allUsers = await dbExec(`SELECT username FROM users ORDER BY created_at DESC LIMIT 10`);
        if (allUsers.length > 0 && allUsers[0].values.length > 0) {
          const names = allUsers[0].values.map(r => r[0]);
          console.log(`📋 LOGIN usuarios existentes (últimos 10): ${JSON.stringify(names)}`);
        } else {
          console.log(`📋 LOGIN NO HAY usuarios registrados en DB`);
        }
      } catch (listErr) {
        console.error(`📋 LOGIN error listando usuarios:`, listErr.message);
      }
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const row = result[0].values[0];
    const cols = result[0].columns;
    const idx = (name) => cols.indexOf(name);
    const user = {
      id: row[idx('id')],
      username: row[idx('username')],
      email: row[idx('email')],
      passwordHash: row[idx('password_hash')],
      role: row[idx('role')],
      stellarPublic: row[idx('stellar_public')],
      stellarSecretEncrypted: row[idx('stellar_secret_encrypted')],
    };
    console.log(`✅ LOGIN usuario "${user.username}" encontrado en DB (id=${user.id})`);

    console.log(`🔐 LOGIN comparando contraseña para "${username}"...`);
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      console.warn(`❌ LOGIN contraseña INCORRECTA para "${username}"`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log(`✅ LOGIN contraseña correcta para "${username}", generando JWT...`);
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role, stellarPublic: user.stellarPublic },
      JWT_SECRET, { expiresIn: '24h' }
    );
    console.log(`✅ LOGIN exitoso para "${username}", token generado`);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, stellarPublic: user.stellarPublic, stellarSecretEncrypted: user.stellarSecretEncrypted } });
  } catch (e) {
    console.error('❌ Error en login:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/auth/me', anyAuthMiddleware, async (req, res) => {
  const result = await dbExec(`SELECT id, username, email, role, stellar_public, stellar_secret_encrypted, created_at FROM users WHERE id = ?`, [req.user.id]);
  if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  const row = result[0].values[0];
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  res.json({
    id: row[idx('id')], username: row[idx('username')], email: row[idx('email')],
    role: row[idx('role')], stellarPublic: row[idx('stellar_public')],
    stellarSecretEncrypted: row[idx('stellar_secret_encrypted')], createdAt: row[idx('created_at')]
  });
});

// --- USERS ---
app.get('/api/users', anyAuthMiddleware, (req, res) => {
  const result = db.exec(`SELECT id, username, email, role, stellar_public FROM users ORDER BY created_at DESC`);
  if (!result.length) return res.json([]);
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  const users = result[0].values.map(row => ({
    id: row[idx('id')], username: row[idx('username')], email: row[idx('email')],
    role: row[idx('role')], stellarPublic: row[idx('stellar_public')]
  }));
  res.json(users);
});

app.get('/api/users/students', anyAuthMiddleware, (req, res) => {
  const result = db.exec(`SELECT id, username, email, stellar_public FROM users WHERE role = 'estudiante' ORDER BY username`);
  if (!result.length) return res.json([]);
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  res.json(result[0].values.map(row => ({
    id: row[idx('id')], username: row[idx('username')], email: row[idx('email')], stellarPublic: row[idx('stellar_public')]
  })));
});

app.get('/api/users/:username/stellar-key', anyAuthMiddleware, (req, res) => {
  const isOwner = req.params.username === req.user.username;
  if (!isOwner && req.user.role !== 'docente') {
    return res.status(403).json({ error: 'No puedes ver la clave de otro usuario' });
  }
  const result = db.exec(`SELECT stellar_public, stellar_secret_encrypted FROM users WHERE username = ?`, [req.params.username]);
  if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  const row = result[0].values[0];
  if (isOwner) {
    res.json({ stellarPublic: row[idx('stellar_public')], stellarSecretEncrypted: row[idx('stellar_secret_encrypted')] });
  } else {
    // docente viendo a otro usuario: solo clave pública
    res.json({ stellarPublic: row[idx('stellar_public')] });
  }
});

// --- ACTIVITIES ---
app.get('/api/activities', anyAuthMiddleware, (req, res) => {
  const result = db.exec(`SELECT * FROM activities WHERE status = 'active' ORDER BY created_at DESC`);
  if (!result.length) return res.json([]);
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  res.json(result[0].values.map(row => ({
    id: row[idx('id')], title: row[idx('title')], description: row[idx('description')],
    tokens: parseInt(row[idx('tokens')] || 0), deadline: row[idx('deadline')],
    subject: row[idx('subject')], instructions: row[idx('instructions')],
    createdBy: row[idx('created_by')], createdAt: row[idx('created_at')], status: row[idx('status')]
  })));
});

app.post('/api/activities', anyAuthMiddleware, adminOnly, (req, res) => {
  const { title, description, tokens, deadline, subject, instructions } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(`INSERT INTO activities (id, title, description, tokens, deadline, subject, instructions, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, description, parseInt(tokens) || 0, deadline || null, subject || null, instructions || null, req.user.username, now]);
  saveDB();
  res.json({ id, title, description, tokens: parseInt(tokens) || 0, deadline, subject, instructions, createdBy: req.user.username, createdAt: now, status: 'active' });
});

app.put('/api/activities/:id', anyAuthMiddleware, adminOnly, (req, res) => {
  const { title, description, tokens, deadline, subject, instructions, status } = req.body;
  const updates = [];
  const params = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (tokens !== undefined) { updates.push('tokens = ?'); params.push(parseInt(tokens)); }
  if (deadline !== undefined) { updates.push('deadline = ?'); params.push(deadline); }
  if (subject !== undefined) { updates.push('subject = ?'); params.push(subject); }
  if (instructions !== undefined) { updates.push('instructions = ?'); params.push(instructions); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (updates.length === 0) return res.status(400).json({ error: 'Sin campos para actualizar' });
  params.push(req.params.id);
  db.run(`UPDATE activities SET ${updates.join(', ')} WHERE id = ?`, params);
  saveDB();
  res.json({ success: true });
});

app.delete('/api/activities/:id', anyAuthMiddleware, adminOnly, (req, res) => {
  db.run(`UPDATE activities SET status = 'inactive' WHERE id = ?`, [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// --- SUBMISSIONS ---
app.get('/api/submissions', anyAuthMiddleware, (req, res) => {
  let query = `SELECT s.*, a.title as activity_title, a.tokens as activity_tokens FROM submissions s LEFT JOIN activities a ON s.activity_id = a.id`;
  const params = [];
  const where = [];

  if (req.user.role === 'estudiante') {
    where.push('s.student_username = ?');
    params.push(req.user.username);
  }

  if (req.query.activity_id) {
    where.push('s.activity_id = ?');
    params.push(req.query.activity_id);
  }

  if (req.query.status) {
    where.push('s.status = ?');
    params.push(req.query.status);
  }

  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY s.submitted_at DESC';

  const result = db.exec(query, params);
  if (!result.length) return res.json([]);
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  res.json(result[0].values.map(row => ({
    id: row[idx('id')], activityId: row[idx('activity_id')], activityTitle: row[idx('activity_title')],
    activityTokens: parseInt(row[idx('activity_tokens')] || 0),
    studentUsername: row[idx('student_username')],
    filePath: row[idx('file_path')], fileName: row[idx('file_name')], fileType: row[idx('file_type')], fileSize: row[idx('file_size')],
    comments: row[idx('comments')], status: row[idx('status')],
    submittedAt: row[idx('submitted_at')], reviewedAt: row[idx('reviewed_at')],
    reviewedBy: row[idx('reviewed_by')], reviewComment: row[idx('review_comment')],
    tokensAwarded: parseInt(row[idx('tokens_awarded')] || 0),
    blockchainTxHash: row[idx('blockchain_tx_hash')]
  })));
});

app.post('/api/submissions', anyAuthMiddleware, upload.single('file'), (req, res) => {
  const { activityId, comments } = req.body;
  if (!activityId) return res.status(400).json({ error: 'ID de actividad requerido' });

  const fileInfo = req.file ? { filePath: req.file.filename, fileName: req.file.originalname, fileType: req.file.mimetype, fileSize: req.file.size } : {};
  const id = uuidv4();
  const now = new Date().toISOString();

  db.run(`INSERT INTO submissions (id, activity_id, student_username, file_path, file_name, file_type, file_size, comments, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, activityId, req.user.username, fileInfo.filePath || null, fileInfo.fileName || null, fileInfo.fileType || null, fileInfo.fileSize || null, comments || null, now]);
  saveDB();
  res.json({ id, activityId, studentUsername: req.user.username, ...fileInfo, comments, status: 'pending', submittedAt: now });
});

app.put('/api/submissions/:id/review', anyAuthMiddleware, adminOnly, async (req, res) => {
  const { status, reviewComment } = req.body;
  if (!['pending', 'approved', 'rejected', 'needs_correction'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  const result = db.exec(`SELECT s.*, a.tokens as activity_tokens, a.title as activity_title FROM submissions s LEFT JOIN activities a ON s.activity_id = a.id WHERE s.id = ?`, [req.params.id]);
  if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Submission no encontrada' });

  const cols = result[0].columns;
  const row = result[0].values[0];
  const idx = (name) => cols.indexOf(name);
  const studentUsername = row[idx('student_username')];
  const activityTokens = parseInt(row[idx('activity_tokens')] || 0);

  const now = new Date().toISOString();
  let blockchainTxHash = null;

  // Si se aprueba, otorgar tokens (la UI llamará al contrato Soroban)
  if (status === 'approved') {
    db.run(`UPDATE submissions SET status = ?, reviewed_at = ?, reviewed_by = ?, review_comment = ?, tokens_awarded = ? WHERE id = ?`,
      [status, now, req.user.username, reviewComment || null, activityTokens, req.params.id]);
    saveDB();

    // Registrar transacción de tokens
    const txId = uuidv4();
    db.run(`INSERT INTO token_transactions (id, username, amount, type, activity_id, description, timestamp) VALUES (?, ?, ?, 'earned', ?, ?, ?)`,
      [txId, studentUsername, activityTokens, row[idx('activity_id')], `Tokens por actividad: ${row[idx('activity_title')]}`, now]);
    saveDB();
  } else {
    db.run(`UPDATE submissions SET status = ?, reviewed_at = ?, reviewed_by = ?, review_comment = ? WHERE id = ?`,
      [status, now, req.user.username, reviewComment || null, req.params.id]);
    saveDB();
  }

  res.json({ id: req.params.id, status, reviewedAt: now, reviewedBy: req.user.username, reviewComment, tokensAwarded: status === 'approved' ? activityTokens : 0, blockchainTxHash });
});

// --- TOKENS ---
app.get('/api/tokens/:username', anyAuthMiddleware, (req, res) => {
  const result = db.exec(`SELECT amount, type, description, blockchain_tx_hash, timestamp FROM token_transactions WHERE username = ? ORDER BY timestamp DESC`, [req.params.username]);
  const transactions = result.length ? result[0].values.map(row => ({
    amount: parseInt(row[0]), type: row[1], description: row[2], blockchainTxHash: row[3], timestamp: row[4]
  })) : [];

  const balance = transactions.reduce((sum, tx) => sum + tx.amount, 0);

  res.json({ username: req.params.username, balance, transactions });
});

app.post('/api/tokens/mint', anyAuthMiddleware, adminOnly, async (req, res) => {
  const { username, amount, description } = req.body;
  if (!username || !amount) return res.status(400).json({ error: 'Usuario y cantidad requeridos' });

  const result = db.exec(`SELECT id FROM users WHERE username = ?`, [username]);
  if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  const txId = uuidv4();
  const now = new Date().toISOString();
  db.run(`INSERT INTO token_transactions (id, username, amount, type, description, timestamp) VALUES (?, ?, ?, 'earned', ?, ?)`,
    [txId, username, parseInt(amount), description || 'Tokens minteados por docente', now]);
  saveDB();
  res.json({ id: txId, username, amount: parseInt(amount), type: 'earned', description: description || 'Tokens minteados por docente', timestamp: now });
});

// --- REWARDS ---
app.get('/api/rewards', anyAuthMiddleware, (req, res) => {
  const result = db.exec(`SELECT * FROM rewards WHERE status = 'active' ORDER BY created_at DESC`);
  if (!result.length) return res.json([]);
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  res.json(result[0].values.map(row => ({
    id: row[idx('id')], name: row[idx('name')], description: row[idx('description')],
    cost: parseInt(row[idx('cost')] || 0), image: row[idx('image')],
    createdBy: row[idx('created_by')], createdAt: row[idx('created_at')],
    status: row[idx('status')], redeemedCount: parseInt(row[idx('redeemed_count')] || 0)
  })));
});

app.post('/api/rewards', anyAuthMiddleware, adminOnly, (req, res) => {
  const { name, description, cost, image } = req.body;
  if (!name || !cost) return res.status(400).json({ error: 'Nombre y costo requeridos' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(`INSERT INTO rewards (id, name, description, cost, image, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || '', parseInt(cost), image || null, req.user.username, now]);
  saveDB();
  res.json({ id, name, description, cost: parseInt(cost), image, createdBy: req.user.username, createdAt: now, status: 'active', redeemedCount: 0 });
});

app.post('/api/rewards/:id/redeem', anyAuthMiddleware, (req, res) => {
  const result = db.exec(`SELECT * FROM rewards WHERE id = ? AND status = 'active'`, [req.params.id]);
  if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Recompensa no encontrada' });

  const cols = result[0].columns;
  const row = result[0].values[0];
  const idx = (name) => cols.indexOf(name);
  const cost = parseInt(row[idx('cost')] || 0);
  const rewardName = row[idx('name')];

  // Verificar balance
  const txResult = db.exec(`SELECT amount, type FROM token_transactions WHERE username = ?`, [req.user.username]);
  const transactions = txResult.length ? txResult[0].values.map(r => ({ amount: parseInt(r[0]), type: r[1] })) : [];
  const balance = transactions.reduce((sum, tx) => sum + tx.amount, 0);

  if (balance < cost) return res.status(400).json({ error: 'Tokens insuficientes' });

  const now = new Date().toISOString();
  const redemptionId = uuidv4();
  const txId = uuidv4();

  db.run(`INSERT INTO redemptions (id, username, reward_id, reward_name, cost, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    [redemptionId, req.user.username, req.params.id, rewardName, cost, now]);
  db.run(`INSERT INTO token_transactions (id, username, amount, type, reward_id, description, timestamp) VALUES (?, ?, ?, 'redeemed', ?, ?, ?)`,
    [txId, req.user.username, -cost, req.params.id, `Canjeado: ${rewardName}`, now]);
  db.run(`UPDATE rewards SET redeemed_count = redeemed_count + 1 WHERE id = ?`, [req.params.id]);
  saveDB();

  res.json({ success: true, redemptionId, newBalance: balance - cost });
});

// --- FILE DOWNLOAD ---
app.get('/api/files/:filename', anyAuthMiddleware, (req, res) => {
  const resolved = path.resolve(UPLOADS_DIR, req.params.filename);
  if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(resolved);
});

// --- STATS ---
app.get('/api/stats/student', anyAuthMiddleware, (req, res) => {
  const username = req.user.username;

  const activitiesResult = db.exec(`SELECT id, tokens FROM activities WHERE status = 'active'`);
  const activities = activitiesResult.length ? activitiesResult[0].values.map(r => ({ id: r[0], tokens: parseInt(r[1] || 0) })) : [];
  const totalActivities = activities.length;

  const subsResult = db.exec(`SELECT status, tokens_awarded FROM submissions WHERE student_username = ?`, [username]);
  const submissions = subsResult.length ? subsResult[0].values.map(r => ({ status: r[0], tokensAwarded: parseInt(r[1] || 0) })) : [];

  const pending = submissions.filter(s => s.status === 'pending').length;
  const needsCorrection = submissions.filter(s => s.status === 'needs_correction').length;
  const approved = submissions.filter(s => s.status === 'approved').length;
  const rejected = submissions.filter(s => s.status === 'rejected').length;
  const tokensEarned = submissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + s.tokensAwarded, 0);

  const txResult = db.exec(`SELECT amount, type FROM token_transactions WHERE username = ?`, [username]);
  const txs = txResult.length ? txResult[0].values.map(r => ({ amount: parseInt(r[0]), type: r[1] })) : [];
  const tokensBalance = txs.reduce((sum, tx) => sum + tx.amount, 0);

  const progress = totalActivities > 0 ? Math.round((approved / totalActivities) * 100) : 0;

  res.json({ totalActivities, pendingSubmissions: pending, pendingReview: pending, needsCorrection, approved, rejected, tokensBalance, tokensEarned, activitiesCompleted: approved, progress });
});

app.get('/api/stats/teacher', anyAuthMiddleware, (req, res) => {
  const username = req.user.username;

  const actResult = db.exec(`SELECT id FROM activities WHERE created_by = ?`, [username]);
  const totalActivities = actResult.length ? actResult[0].values.length : 0;

  const subResult = db.exec(`SELECT s.status, s.tokens_awarded FROM submissions s LEFT JOIN activities a ON s.activity_id = a.id WHERE a.created_by = ?`, [username]);
  const submissions = subResult.length ? subResult[0].values.map(r => ({ status: r[0], tokensAwarded: parseInt(r[1] || 0) })) : [];
  const pendingReviews = submissions.filter(s => s.status === 'pending').length;
  const totalTokensAwarded = submissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + s.tokensAwarded, 0);

  const studentsResult = db.exec(`SELECT DISTINCT s.student_username FROM submissions s LEFT JOIN activities a ON s.activity_id = a.id WHERE a.created_by = ?`, [username]);
  const totalStudents = studentsResult.length ? studentsResult[0].values.length : 0;

  res.json({ totalActivities, pendingReviews, totalTokensAwarded, totalStudents });
});

// ========================
// STATIC FILES (Frontend)
// ========================
app.use(express.static(DOCS_DIR));

// Catch-all for SPA-style routing (except API)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.method !== 'GET') return next();
  const filePath = path.join(DOCS_DIR, req.path === '/' ? 'index.html' : req.path);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.sendFile(path.join(DOCS_DIR, 'index.html'));
});

// ========================
// START
// ========================
async function start() {
  await initDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor Money Digital iniciado`);
    console.log(`📂 Frontend: http://localhost:${PORT}`);
    console.log(`🔌 API: http://localhost:${PORT}/api`);
    console.log(`🔐 Passkeys (WebAuthn): http://localhost:${PORT}/api/auth/passkey`);
    console.log(`🔢 Contador: http://localhost:${PORT}/api/counter`);
    console.log(`🆕 DApp Biometrica: http://localhost:${PORT}/contador.html`);
    console.log(`📁 Archivos: ${UPLOADS_DIR}`);
    console.log(`Presiona Ctrl+C para detener\n`);
  });
}

start().catch(console.error);

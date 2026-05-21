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

// SQLite (sql.js)
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 8080;

// SEGURIDAD: JWT_SECRET y JWT_WEBAUTHN_SECRET deben venir de variables de entorno.
// En desarrollo se generan automáticamente; en producción son OBLIGATORIAS.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_WEBAUTHN_SECRET = process.env.JWT_WEBAUTHN_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET || !process.env.JWT_WEBAUTHN_SECRET) {
  console.warn('⚠️  ADVERTENCIA: JWT_SECRET y/o JWT_WEBAUTHN_SECRET no están configurados como variables de entorno.');
  console.warn('   Usando valores generados aleatoriamente. Las sesiones se invalidarán al reiniciar el servidor.');
  console.warn('   Para producción, configura: export JWT_SECRET=... && export JWT_WEBAUTHN_SECRET=...');
}

// Configuración WebAuthn (Passkeys)
const RP_NAME = 'Money Digital - GROUP JAD';
const isRender = !!process.env.RENDER;
const isRailway = !!process.env.RAILWAY;
const RP_ID = process.env.RP_ID || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
const ORIGINS = (() => {
  if (process.env.ORIGINS) return process.env.ORIGINS.split(',');
  const origins = [`http://localhost:${PORT}`, 'http://localhost:3000', 'http://localhost:8080'];
  if (process.env.ORIGIN) origins.push(process.env.ORIGIN);
  if (isRender && RP_ID) origins.push(`https://${RP_ID}`);
  if (isRailway && process.env.RAILWAY_PUBLIC_DOMAIN) origins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  origins.push('https://money-digital.surge.sh');
  return origins;
})();

// Store de challenges con persistencia en SQLite
const challengeStore = {
  set(key, data) {
    try {
      const id = `ch_${uuidv4()}`;
      const type = key.includes('register') ? 'register' : 'login';
      const username = key.replace(/^(register|login):/, '');
      // Eliminar challenge previo del mismo tipo/usuario si existe
      db.run(`DELETE FROM auth_challenges WHERE type = ? AND username = ?`, [type, username]);
      db.run(`INSERT INTO auth_challenges (id, type, username, challenge, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [id, type, username, JSON.stringify(data), data.expiresAt]);
      saveDB();
      this._cache.set(key, data);
    } catch (e) {
      console.warn('Error guardando challenge en DB, usando cache:', e.message);
      this._cache.set(key, data);
    }
  },
  get(key) {
    const cached = this._cache.get(key);
    if (cached) return cached;
    try {
      const type = key.includes('register') ? 'register' : 'login';
      const username = key.replace(/^(register|login):/, '');
      const result = db.exec(`SELECT challenge FROM auth_challenges WHERE type = ? AND username = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
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
  delete(key) {
    this._cache.delete(key);
    try {
      const type = key.includes('register') ? 'register' : 'login';
      const username = key.replace(/^(register|login):/, '');
      db.run(`DELETE FROM auth_challenges WHERE type = ? AND username = ?`, [type, username]);
      saveDB();
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

// Asegurar directorios
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

app.use('/uploads', authMiddleware, express.static(UPLOADS_DIR));

// Variable global de DB
let db = null;

// Inicializar base de datos
async function initDB() {
  const SQL = await initSqlJs();
  let buffer;
  if (fs.existsSync(DB_PATH)) {
    buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
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

  // Tabla para credenciales WebAuthn (Passkeys)
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

  // Tabla para el contador blockchain
  db.run(`CREATE TABLE IF NOT EXISTS counter_state (
    id TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Tabla para challenges de WebAuthn (persistencia, no solo en memoria)
  db.run(`CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    username TEXT NOT NULL,
    challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Limpiar challenges expirados al iniciar
  db.run(`DELETE FROM auth_challenges WHERE expires_at < ?`, [Date.now()]);

  // Asegurar que existe la fila del contador global
  const counterRow = db.exec(`SELECT id FROM counter_state WHERE id = 'global'`);
  if (!counterRow.length || !counterRow[0].values.length) {
    db.run(`INSERT INTO counter_state (id, value, updated_at) VALUES ('global', 0, datetime('now'))`);
  }

  saveDB();
  console.log('Base de datos inicializada correctamente');
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Middleware JWT
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
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

// ========================
// WEBAUTHN (PASSKEYS) ROUTES
// ========================

// 1. Iniciar registro biométrico
app.post('/api/auth/passkey/register/begin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username requerido' });

    // Verificar que el usuario existe en el sistema
    const userResult = db.exec(`SELECT id, username FROM users WHERE username = ?`, [username]);
    if (!userResult.length || !userResult[0].values.length) {
      return res.status(404).json({ error: 'Usuario no encontrado. Regístrate primero en el sistema.' });
    }

    // Verificar si ya tiene una passkey registrada
    const existingKeys = db.exec(`SELECT credential_id, public_key, counter, transports FROM passkeys WHERE username = ?`, [username]);
    const existingCredentials = existingKeys.length ? existingKeys[0].values.map(row => ({
      id: row[0], publicKey: row[1], counter: parseInt(row[2] || 0), transports: row[3] ? JSON.parse(row[3]) : []
    })) : [];

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: username,
      userDisplayName: username,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map(cred => ({
        id: isoBase64URL.toBuffer(cred.id),
        type: 'public-key',
        transports: cred.transports,
      })),
    });

    // Guardar challenge en store temporal
    challengeStore.set(`register:${username}`, {
      challenge: options.challenge,
      username,
      expiresAt: Date.now() + 60000,
    });

    res.json(options);
  } catch (e) {
    console.error('Error en register/begin:', e);
    res.status(500).json({ error: e.message });
  }
});

// 2. Completar registro biométrico
app.post('/api/auth/passkey/register/complete', async (req, res) => {
  try {
    const { username, credential } = req.body;
    if (!username || !credential) return res.status(400).json({ error: 'Username y credential requeridos' });

    const storedData = challengeStore.get(`register:${username}`);
    if (!storedData) return res.status(400).json({ error: 'Inicia el registro primero (/register/begin)' });

    if (Date.now() > storedData.expiresAt) {
      challengeStore.delete(`register:${username}`);
      return res.status(400).json({ error: 'Challenge expirado. Intenta de nuevo.' });
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: storedData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verificación biométrica fallida' });
    }

    const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

    // Guardar credencial en DB
    const id = uuidv4();
    const credentialIdBase64 = isoBase64URL.fromBuffer(credentialID);
    const publicKeyBase64 = isoBase64URL.fromBuffer(credentialPublicKey);
    const transports = JSON.stringify(credential.response?.transports || []);

    db.run(`INSERT INTO passkeys (id, username, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, username, credentialIdBase64, publicKeyBase64, counter, transports]);
    saveDB();

    challengeStore.delete(`register:${username}`);

    // Emitir token JWT biométrico
    const token = jwt.sign(
      { id: id, username, authMethod: 'passkey', credentialId: credentialIdBase64 },
      JWT_WEBAUTHN_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ verified: true, token, walletId: credentialIdBase64.substring(0, 12) + '...' });
  } catch (e) {
    console.error('Error en register/complete:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3. Iniciar login biométrico
app.post('/api/auth/passkey/login/begin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username requerido' });

    // Buscar credenciales del usuario
    const keyResult = db.exec(`SELECT credential_id, public_key, counter, transports FROM passkeys WHERE username = ?`, [username]);
    if (!keyResult.length || !keyResult[0].values.length) {
      return res.status(404).json({ error: 'No hay passkey registrada para este usuario. Regístrate primero.' });
    }

    const credentials = keyResult[0].values.map(row => ({
      id: row[0],
      publicKey: row[1],
      counter: parseInt(row[2] || 0),
      transports: row[3] ? JSON.parse(row[3]) : [],
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: credentials.map(cred => ({
        id: isoBase64URL.toBuffer(cred.id),
        type: 'public-key',
        transports: cred.transports,
      })),
      userVerification: 'preferred',
    });

    challengeStore.set(`login:${username}`, {
      challenge: options.challenge,
      username,
      expiresAt: Date.now() + 60000,
    });

    res.json(options);
  } catch (e) {
    console.error('Error en login/begin:', e);
    res.status(500).json({ error: e.message });
  }
});

// 4. Completar login biométrico
app.post('/api/auth/passkey/login/complete', async (req, res) => {
  try {
    const { username, credential } = req.body;
    if (!username || !credential) return res.status(400).json({ error: 'Username y credential requeridos' });

    const storedData = challengeStore.get(`login:${username}`);
    if (!storedData) return res.status(400).json({ error: 'Inicia sesión primero (/login/begin)' });

    if (Date.now() > storedData.expiresAt) {
      challengeStore.delete(`login:${username}`);
      return res.status(400).json({ error: 'Challenge expirado. Intenta de nuevo.' });
    }

    // Buscar la credencial en DB por credential ID
    const credId = credential.id;
    const credResult = db.exec(`SELECT * FROM passkeys WHERE credential_id = ?`, [credId]);
    if (!credResult.length || !credResult[0].values.length) {
      return res.status(404).json({ error: 'Credencial no encontrada' });
    }

    const cols = credResult[0].columns;
    const row = credResult[0].values[0];
    const idx = (name) => cols.indexOf(name);
    const credUsername = row[idx('username')];
    // Verificar que la credencial pertenece al usuario que dice ser
    if (credUsername !== username) {
      return res.status(403).json({ error: 'Esta credencial no pertenece al usuario solicitado' });
    }
    const storedCredential = {
      id: row[idx('credential_id')],
      publicKey: row[idx('public_key')],
      counter: parseInt(row[idx('counter')] || 0),
      transports: row[idx('transports')] ? JSON.parse(row[idx('transports')]) : [],
    };

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: storedData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: storedCredential.id,
        publicKey: isoBase64URL.toBuffer(storedCredential.publicKey),
        counter: storedCredential.counter,
        transports: storedCredential.transports,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verificación biométrica fallida' });
    }

    // Actualizar contador de la credencial
    const newCounter = verification.authenticationInfo?.newCounter || storedCredential.counter;
    db.run(`UPDATE passkeys SET counter = ? WHERE credential_id = ?`, [newCounter, credId]);
    saveDB();

    challengeStore.delete(`login:${username}`);

    // Obtener datos del usuario
    const userResult = db.exec(`SELECT id, username, role FROM users WHERE username = ?`, [username]);

    // Emitir token JWT biométrico
    const token = jwt.sign(
      { id: userResult[0].values[0][0], username, role: userResult[0].values[0][2], authMethod: 'passkey', credentialId: credId },
      JWT_WEBAUTHN_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ verified: true, token, walletId: credId.substring(0, 12) + '...' });
  } catch (e) {
    console.error('Error en login/complete:', e);
    res.status(500).json({ error: e.message });
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

// Incrementar contador (requiere auth biométrico)
app.post('/api/counter/increment', biometricAuthMiddleware, async (req, res) => {
  try {
    const result = db.exec(`SELECT value FROM counter_state WHERE id = 'global'`);
    let value = (result.length && result[0].values.length) ? parseInt(result[0].values[0][0]) : 0;
    value += 1;
    db.run(`UPDATE counter_state SET value = ?, updated_at = datetime('now') WHERE id = 'global'`, [value]);
    saveDB();

    // Registrar en blockchain Soroban (si hay secret configurado)
    let txHash = null;
    if (STELLAR_SECRET) {
      const sorobanResult = await sorobanInvoke('increment');
      txHash = sorobanResult.hash;
    }

    res.json({ value, success: true, txHash, username: req.biometricUser.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Decrementar contador (requiere auth biométrico)
app.post('/api/counter/decrement', biometricAuthMiddleware, async (req, res) => {
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

    res.json({ value, success: true, txHash, username: req.biometricUser.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resetear contador (requiere auth biométrico)
app.post('/api/counter/reset', biometricAuthMiddleware, async (req, res) => {
  try {
    db.run(`UPDATE counter_state SET value = 0, updated_at = datetime('now') WHERE id = 'global'`);
    saveDB();

    let txHash = null;
    if (STELLAR_SECRET) {
      const sorobanResult = await sorobanInvoke('reset');
      txHash = sorobanResult.hash;
    }

    res.json({ value: 0, success: true, txHash, username: req.biometricUser.username });
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
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (username.length < 3) return res.status(400).json({ error: 'Usuario debe tener al menos 3 caracteres' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'Contraseña debe tener al menos 6 caracteres' });
    const allowedRoles = ['estudiante', 'docente'];
    const finalRole = allowedRoles.includes(role) ? role : 'estudiante';

    const existing = db.exec(`SELECT id FROM users WHERE username = ? OR email = ?`, [username, email]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return res.status(400).json({ error: 'Usuario o email ya registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = new Date().toISOString();

    // Generar par de llaves Stellar automáticamente si no se proporcionaron
    let finalStellarPublic = stellarPublic || null;
    let finalStellarSecretEncrypted = stellarSecretEncrypted || null;

    try {
      const kp = StellarSdk.Keypair.random();
      finalStellarPublic = stellarPublic || kp.publicKey();
      finalStellarSecretEncrypted = stellarSecretEncrypted || kp.secret();
      // Nota: la clave secreta se almacena en texto plano en DB solo si el
      // cliente no la envió cifrada. En producción, el cliente DEBE cifrarla
      // con la contraseña del usuario antes de enviarla.
      console.log(`✅ Cuenta Stellar generada para ${username}: ${finalStellarPublic.substring(0, 8)}...`);
    } catch (stellarErr) {
      console.warn('No se pudo generar cuenta Stellar:', stellarErr.message);
    }

    db.run(`INSERT INTO users (id, username, email, password_hash, role, stellar_public, stellar_secret_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, username, email, passwordHash, finalRole, finalStellarPublic, finalStellarSecretEncrypted, now]);
    saveDB();

    const token = jwt.sign({ id, username, email, role: finalRole, stellarPublic: finalStellarPublic }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id, username, email, role: finalRole, stellarPublic: finalStellarPublic } });
  } catch (e) {
    console.error('Error en registro:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/auth/login', rateLimit(60000, 10), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const result = db.exec(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!result.length || !result[0].values.length) {
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

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role, stellarPublic: user.stellarPublic },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, stellarPublic: user.stellarPublic, stellarSecretEncrypted: user.stellarSecretEncrypted } });
  } catch (e) {
    console.error('Error en login:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const result = db.exec(`SELECT id, username, email, role, stellar_public, stellar_secret_encrypted, created_at FROM users WHERE id = ?`, [req.user.id]);
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
app.get('/api/users', authMiddleware, (req, res) => {
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

app.get('/api/users/students', authMiddleware, (req, res) => {
  const result = db.exec(`SELECT id, username, email, stellar_public FROM users WHERE role = 'estudiante' ORDER BY username`);
  if (!result.length) return res.json([]);
  const cols = result[0].columns;
  const idx = (name) => cols.indexOf(name);
  res.json(result[0].values.map(row => ({
    id: row[idx('id')], username: row[idx('username')], email: row[idx('email')], stellarPublic: row[idx('stellar_public')]
  })));
});

app.get('/api/users/:username/stellar-key', authMiddleware, (req, res) => {
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
app.get('/api/activities', authMiddleware, (req, res) => {
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

app.post('/api/activities', authMiddleware, adminOnly, (req, res) => {
  const { title, description, tokens, deadline, subject, instructions } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(`INSERT INTO activities (id, title, description, tokens, deadline, subject, instructions, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, description, parseInt(tokens) || 0, deadline || null, subject || null, instructions || null, req.user.username, now]);
  saveDB();
  res.json({ id, title, description, tokens: parseInt(tokens) || 0, deadline, subject, instructions, createdBy: req.user.username, createdAt: now, status: 'active' });
});

app.put('/api/activities/:id', authMiddleware, adminOnly, (req, res) => {
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

app.delete('/api/activities/:id', authMiddleware, adminOnly, (req, res) => {
  db.run(`UPDATE activities SET status = 'inactive' WHERE id = ?`, [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// --- SUBMISSIONS ---
app.get('/api/submissions', authMiddleware, (req, res) => {
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

app.post('/api/submissions', authMiddleware, upload.single('file'), (req, res) => {
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

app.put('/api/submissions/:id/review', authMiddleware, adminOnly, async (req, res) => {
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
app.get('/api/tokens/:username', authMiddleware, (req, res) => {
  const result = db.exec(`SELECT amount, type, description, blockchain_tx_hash, timestamp FROM token_transactions WHERE username = ? ORDER BY timestamp DESC`, [req.params.username]);
  const transactions = result.length ? result[0].values.map(row => ({
    amount: parseInt(row[0]), type: row[1], description: row[2], blockchainTxHash: row[3], timestamp: row[4]
  })) : [];

  const balance = transactions.reduce((sum, tx) => sum + tx.amount, 0);

  res.json({ username: req.params.username, balance, transactions });
});

app.post('/api/tokens/mint', authMiddleware, adminOnly, async (req, res) => {
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
app.get('/api/rewards', authMiddleware, (req, res) => {
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

app.post('/api/rewards', authMiddleware, adminOnly, (req, res) => {
  const { name, description, cost, image } = req.body;
  if (!name || !cost) return res.status(400).json({ error: 'Nombre y costo requeridos' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(`INSERT INTO rewards (id, name, description, cost, image, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || '', parseInt(cost), image || null, req.user.username, now]);
  saveDB();
  res.json({ id, name, description, cost: parseInt(cost), image, createdBy: req.user.username, createdAt: now, status: 'active', redeemedCount: 0 });
});

app.post('/api/rewards/:id/redeem', authMiddleware, (req, res) => {
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
app.get('/api/files/:filename', authMiddleware, (req, res) => {
  const resolved = path.resolve(UPLOADS_DIR, req.params.filename);
  if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(resolved);
});

// --- STATS ---
app.get('/api/stats/student', authMiddleware, (req, res) => {
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

app.get('/api/stats/teacher', authMiddleware, (req, res) => {
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

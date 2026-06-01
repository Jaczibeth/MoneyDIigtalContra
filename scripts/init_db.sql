-- Init DB schema for MoneyDIigtalContra
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'estudiante',
  stellar_public TEXT,
  stellar_secret_encrypted TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
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
);

CREATE TABLE IF NOT EXISTS submissions (
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
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cost INTEGER NOT NULL,
  image TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active',
  redeemed_count INTEGER DEFAULT 0,
  FOREIGN KEY (created_by) REFERENCES users(username)
);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (username) REFERENCES users(username)
);

CREATE TABLE IF NOT EXISTS token_transactions (
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
);

CREATE TABLE IF NOT EXISTS counter_state (
  id TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  username TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  reward_name TEXT NOT NULL,
  cost INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (username) REFERENCES users(username),
  FOREIGN KEY (reward_id) REFERENCES rewards(id)
);

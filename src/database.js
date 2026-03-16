const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'esignature.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    oauth_provider TEXT,
    oauth_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    token TEXT UNIQUE NOT NULL,
    invited_by INTEGER NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (invited_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS envelopes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    owner_id INTEGER NOT NULL,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    voided_at TEXT,
    void_reason TEXT,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS envelope_documents (
    id TEXT PRIMARY KEY,
    envelope_id TEXT NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 1,
    order_num INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (envelope_id) REFERENCES envelopes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recipients (
    id TEXT PRIMARY KEY,
    envelope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'signer',
    order_num INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    token TEXT UNIQUE NOT NULL,
    access_code TEXT,
    decline_reason TEXT,
    signed_at TEXT,
    viewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (envelope_id) REFERENCES envelopes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    envelope_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    type TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    required INTEGER NOT NULL DEFAULT 1,
    label TEXT DEFAULT '',
    value TEXT DEFAULT '',
    FOREIGN KEY (envelope_id) REFERENCES envelopes(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES envelope_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES recipients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    signature_data TEXT NOT NULL,
    signature_type TEXT NOT NULL DEFAULT 'draw',
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipient_id) REFERENCES recipients(id),
    FOREIGN KEY (field_id) REFERENCES fields(id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS template_documents (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 1,
    order_num INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS template_roles (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Signer',
    order_num INTEGER NOT NULL DEFAULT 1,
    color TEXT NOT NULL DEFAULT '#5B21B6',
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS template_fields (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    type TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    required INTEGER NOT NULL DEFAULT 1,
    label TEXT DEFAULT '',
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES template_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES template_roles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (envelope_id) REFERENCES envelopes(id)
  );
`);

// Migrations for existing databases
const columns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!columns.includes('must_change_password')) {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
}
if (!columns.includes('oauth_provider')) {
  db.exec("ALTER TABLE users ADD COLUMN oauth_provider TEXT");
}
if (!columns.includes('oauth_id')) {
  db.exec("ALTER TABLE users ADD COLUMN oauth_id TEXT");
}

// Seed admin account if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const bcrypt = require('bcrypt');
  const tempPassword = 'ChangeMe123!';
  const hash = bcrypt.hashSync(tempPassword, 10);
  db.prepare(
    'INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)'
  ).run('ash@buyerforesight.com', 'Ash', hash, 'admin', 1);
  console.log('Admin account seeded: ash@buyerforesight.com / ChangeMe123!');
}

module.exports = db;

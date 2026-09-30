import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'accountant.db');

// Ensure the data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

/**
 * Initialize the SQLite database and create tables if they don't exist.
 */
export function initDatabase() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    UNIQUE NOT NULL,
      email      TEXT    UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
    CREATE INDEX IF NOT EXISTS idx_accounts_email    ON accounts(email);
  `);

  console.log(`Database initialized at ${DB_PATH}`);
  return db;
}

/**
 * Get the database instance (must call initDatabase() first).
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

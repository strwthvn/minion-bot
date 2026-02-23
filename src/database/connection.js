const Database = require('better-sqlite3');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'events.db');

let db;

function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);

  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      date_time TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      ping_role_id TEXT,
      participant_limit INTEGER,
      reactions TEXT DEFAULT '["✅","❌"]',
      message_id TEXT,
      status TEXT DEFAULT 'active',
      reminder_24h INTEGER DEFAULT 0,
      reminder_1h INTEGER DEFAULT 0,
      reminder_5min INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      reaction TEXT NOT NULL,
      is_reserve INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      UNIQUE(event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
  `);
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, close };

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
      channel_id TEXT,
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

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      archive_channel_id TEXT,
      cleanup_reminders INTEGER NOT NULL DEFAULT 0,
      cleanup_delay_minutes INTEGER,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Bot messages tied to an event (reminders, notices), so cleanup can delete them later
    CREATE TABLE IF NOT EXISTS event_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'notice',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_event_messages_event ON event_messages(event_id, kind);

    -- Messages that hand out roles by reaction
    CREATE TABLE IF NOT EXISTS reaction_role_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- emoji is the match key from the gateway event (reaction.emoji.id ?? reaction.emoji.name),
    -- emoji_display is what we react and render with (the char, or <:name:id>)
    CREATE TABLE IF NOT EXISTS reaction_role_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_row_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      emoji_display TEXT NOT NULL,
      role_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      UNIQUE(message_row_id, emoji),
      FOREIGN KEY (message_row_id) REFERENCES reaction_role_messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reaction_role_bindings_message ON reaction_role_bindings(message_row_id);
  `);

  const columns = db.prepare('PRAGMA table_info(events)').all();
  const hasColumn = name => columns.some(c => c.name === name);

  if (!hasColumn('channel_id')) {
    db.exec('ALTER TABLE events ADD COLUMN channel_id TEXT');
    // Backfill active events with the legacy hardcoded channel so they keep working post-migration
    db.prepare("UPDATE events SET channel_id = ? WHERE channel_id IS NULL AND status = 'active'")
      .run('1475429537742454785');
  }

  // Guild is needed to resolve per-guild settings; legacy rows are backfilled lazily from the channel
  if (!hasColumn('guild_id')) db.exec('ALTER TABLE events ADD COLUMN guild_id TEXT');

  // Cleanup bookkeeping — set once so each step runs at most one time per event
  if (!hasColumn('finished_at')) db.exec('ALTER TABLE events ADD COLUMN finished_at TEXT');
  if (!hasColumn('archived_at')) db.exec('ALTER TABLE events ADD COLUMN archived_at TEXT');
  if (!hasColumn('reminders_cleaned')) {
    db.exec('ALTER TABLE events ADD COLUMN reminders_cleaned INTEGER DEFAULT 0');
  }
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, close };

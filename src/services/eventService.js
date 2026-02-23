const { getDb } = require('../database/connection');

const eventService = {
  create({ name, description, dateTime, creatorId, pingRoleId, participantLimit, reactions }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO events (name, description, date_time, creator_id, ping_role_id, participant_limit, reactions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name,
      description,
      dateTime.toISOString(),
      creatorId,
      pingRoleId || null,
      participantLimit || null,
      JSON.stringify(reactions),
    );
    return result.lastInsertRowid;
  },

  getById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  },

  getActive() {
    const db = getDb();
    return db.prepare("SELECT * FROM events WHERE status = 'active' ORDER BY date_time ASC").all();
  },

  getPast() {
    const db = getDb();
    return db.prepare("SELECT * FROM events WHERE status IN ('completed', 'cancelled') ORDER BY date_time DESC").all();
  },

  update(id, fields) {
    const db = getDb();
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  setStatus(id, status) {
    const db = getDb();
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, id);
  },

  setMessageId(id, messageId) {
    const db = getDb();
    db.prepare('UPDATE events SET message_id = ? WHERE id = ?').run(messageId, id);
  },

  setReminderFlag(id, flag) {
    const db = getDb();
    db.prepare(`UPDATE events SET ${flag} = 1 WHERE id = ?`).run(id);
  },

  resetReminders(id) {
    const db = getDb();
    db.prepare('UPDATE events SET reminder_24h = 0, reminder_1h = 0, reminder_5min = 0 WHERE id = ?').run(id);
  },

  getByMessageId(messageId) {
    const db = getDb();
    return db.prepare('SELECT * FROM events WHERE message_id = ?').get(messageId);
  },
};

module.exports = eventService;

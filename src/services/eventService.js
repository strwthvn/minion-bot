const { getDb } = require('../database/connection');

const eventService = {
  create({ name, description, dateTime, creatorId, pingRoleId, participantLimit, reactions, channelId, guildId }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO events (name, description, date_time, creator_id, ping_role_id, participant_limit, reactions, channel_id, guild_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name,
      description,
      dateTime.toISOString(),
      creatorId,
      pingRoleId || null,
      participantLimit || null,
      JSON.stringify(reactions),
      channelId,
      guildId || null,
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
    // finished_at anchors the cleanup delay — for a cancelled event the scheduled
    // date_time may still be days away, so counting from it would stall cleanup
    const finishedAt = status === 'active' ? null : new Date().toISOString();
    db.prepare('UPDATE events SET status = ?, finished_at = ? WHERE id = ?').run(status, finishedAt, id);
  },

  /** Finished events still sitting in their original channel, awaiting cleanup. */
  getPendingArchive() {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM events
      WHERE status IN ('completed', 'cancelled') AND archived_at IS NULL
      ORDER BY date_time ASC
    `).all();
  },

  setMessageId(id, messageId) {
    const db = getDb();
    db.prepare('UPDATE events SET message_id = ? WHERE id = ?').run(messageId, id);
  },

  setChannelId(id, channelId) {
    const db = getDb();
    db.prepare('UPDATE events SET channel_id = ? WHERE id = ?').run(channelId, id);
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

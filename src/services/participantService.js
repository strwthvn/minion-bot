const { getDb } = require('../database/connection');

const participantService = {
  /**
   * Add participant. Returns { added: true, isReserve } or { added: false, reason }.
   */
  add(eventId, userId, reaction) {
    const db = getDb();

    const existing = db.prepare(
      'SELECT * FROM participants WHERE event_id = ? AND user_id = ?',
    ).get(eventId, userId);

    if (existing) {
      // Update reaction instead of duplicating
      db.prepare(
        'UPDATE participants SET reaction = ? WHERE event_id = ? AND user_id = ?',
      ).run(reaction, eventId, userId);
      return { added: true, isReserve: !!existing.is_reserve, updated: true };
    }

    const event = db.prepare('SELECT participant_limit FROM events WHERE id = ?').get(eventId);
    const mainCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM participants WHERE event_id = ? AND is_reserve = 0',
    ).get(eventId).cnt;

    const isReserve = event.participant_limit != null && mainCount >= event.participant_limit ? 1 : 0;

    const maxPos = db.prepare(
      'SELECT COALESCE(MAX(position), 0) as mp FROM participants WHERE event_id = ?',
    ).get(eventId).mp;

    db.prepare(`
      INSERT INTO participants (event_id, user_id, reaction, is_reserve, position)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, userId, reaction, isReserve, maxPos + 1);

    return { added: true, isReserve: !!isReserve };
  },

  /**
   * Remove participant. Returns promoted user id or null.
   */
  remove(eventId, userId) {
    const db = getDb();

    const existing = db.prepare(
      'SELECT * FROM participants WHERE event_id = ? AND user_id = ?',
    ).get(eventId, userId);
    if (!existing) return null;

    db.prepare('DELETE FROM participants WHERE event_id = ? AND user_id = ?').run(eventId, userId);

    // If removed user was a main participant, promote the first reserve
    if (!existing.is_reserve) {
      const firstReserve = db.prepare(
        'SELECT * FROM participants WHERE event_id = ? AND is_reserve = 1 ORDER BY position ASC LIMIT 1',
      ).get(eventId);

      if (firstReserve) {
        db.prepare(
          'UPDATE participants SET is_reserve = 0 WHERE id = ?',
        ).run(firstReserve.id);
        return firstReserve.user_id;
      }
    }

    return null;
  },

  getAll(eventId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM participants WHERE event_id = ? ORDER BY is_reserve ASC, position ASC',
    ).all(eventId);
  },

  getMain(eventId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM participants WHERE event_id = ? AND is_reserve = 0 ORDER BY position ASC',
    ).all(eventId);
  },

  getReserve(eventId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM participants WHERE event_id = ? AND is_reserve = 1 ORDER BY position ASC',
    ).all(eventId);
  },

  exists(eventId, userId) {
    const db = getDb();
    const row = db.prepare(
      'SELECT 1 FROM participants WHERE event_id = ? AND user_id = ?',
    ).get(eventId, userId);
    return !!row;
  },

  removeAll(eventId) {
    const db = getDb();
    db.prepare('DELETE FROM participants WHERE event_id = ?').run(eventId);
  },
};

module.exports = participantService;

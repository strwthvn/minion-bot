const { getDb } = require('../database/connection');

/**
 * Reaction-role messages: a posted message plus the emoji → role bindings
 * that decide which role a reaction on it hands out.
 */
const reactionRoleService = {
  /**
   * Store a published message with all of its bindings.
   * Wrapped in a transaction so a half-saved dispenser can never exist.
   * Returns the new row id.
   */
  create({ guildId, channelId, messageId, content, creatorId, pairs }) {
    const db = getDb();

    const insert = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO reaction_role_messages (guild_id, channel_id, message_id, content, creator_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(guildId, channelId, messageId, content, creatorId);

      const messageRowId = result.lastInsertRowid;
      const stmt = db.prepare(`
        INSERT INTO reaction_role_bindings (message_row_id, emoji, emoji_display, role_id, position)
        VALUES (?, ?, ?, ?, ?)
      `);

      pairs.forEach((pair, index) => {
        stmt.run(messageRowId, pair.emoji, pair.emojiDisplay, pair.roleId, index + 1);
      });

      return messageRowId;
    });

    return insert();
  },

  /**
   * The hot path for the reaction handler: resolve a message id + emoji key
   * straight to its binding. Returns undefined when the message hands out no roles.
   */
  findBinding(messageId, emojiKey) {
    const db = getDb();
    return db.prepare(`
      SELECT b.* FROM reaction_role_bindings b
      JOIN reaction_role_messages m ON m.id = b.message_row_id
      WHERE m.message_id = ? AND b.emoji = ?
    `).get(messageId, emojiKey);
  },

  getById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM reaction_role_messages WHERE id = ?').get(id);
  },

  getByMessageId(messageId) {
    const db = getDb();
    return db.prepare('SELECT * FROM reaction_role_messages WHERE message_id = ?').get(messageId);
  },

  getByGuild(guildId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM reaction_role_messages WHERE guild_id = ? ORDER BY id ASC',
    ).all(guildId);
  },

  getBindings(messageRowId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM reaction_role_bindings WHERE message_row_id = ? ORDER BY position ASC',
    ).all(messageRowId);
  },

  addBinding(messageRowId, { emoji, emojiDisplay, roleId }) {
    const db = getDb();
    const maxPos = db.prepare(
      'SELECT COALESCE(MAX(position), 0) as mp FROM reaction_role_bindings WHERE message_row_id = ?',
    ).get(messageRowId).mp;

    db.prepare(`
      INSERT INTO reaction_role_bindings (message_row_id, emoji, emoji_display, role_id, position)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageRowId, emoji, emojiDisplay, roleId, maxPos + 1);
  },

  removeBinding(messageRowId, emoji) {
    const db = getDb();
    db.prepare(
      'DELETE FROM reaction_role_bindings WHERE message_row_id = ? AND emoji = ?',
    ).run(messageRowId, emoji);
  },

  /** Bindings are dropped by the ON DELETE CASCADE foreign key. */
  remove(id) {
    const db = getDb();
    db.prepare('DELETE FROM reaction_role_messages WHERE id = ?').run(id);
  },

  /**
   * Drop the record for a message that no longer exists.
   * Returns how many rows went away, so callers can stay quiet about the
   * overwhelming majority of deleted messages that hand out no roles.
   */
  removeByMessageId(messageId) {
    const db = getDb();
    return db.prepare('DELETE FROM reaction_role_messages WHERE message_id = ?').run(messageId).changes;
  },

  /** Same, for a bulk purge. Discord caps a bulk delete at 100 messages. */
  removeByMessageIds(messageIds) {
    if (messageIds.length === 0) return 0;

    const db = getDb();
    const placeholders = messageIds.map(() => '?').join(', ');
    return db.prepare(
      `DELETE FROM reaction_role_messages WHERE message_id IN (${placeholders})`,
    ).run(...messageIds).changes;
  },

  /** Same, for every record in a channel that was deleted. */
  removeByChannel(channelId) {
    const db = getDb();
    return db.prepare('DELETE FROM reaction_role_messages WHERE channel_id = ?').run(channelId).changes;
  },

  /**
   * The full message text: the author's own text plus an auto-generated legend.
   * Single source of truth — used both when publishing and after every binding change.
   */
  renderContent(content, bindings) {
    if (bindings.length === 0) return content;

    const legend = bindings
      .map(b => `${b.emoji_display} → <@&${b.role_id}>`)
      .join('\n');

    return `${content}\n\n${legend}`;
  },
};

module.exports = reactionRoleService;

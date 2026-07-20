const { getDb } = require('../database/connection');

/**
 * Tracks bot messages posted for an event (reminders, notices) so that
 * auto-cleanup can delete them once the event is over.
 */
const eventMessageService = {
  track(eventId, channelId, messageId, kind = 'notice') {
    const db = getDb();
    db.prepare(
      'INSERT INTO event_messages (event_id, channel_id, message_id, kind) VALUES (?, ?, ?, ?)',
    ).run(eventId, channelId, messageId, kind);
  },

  /** Send a message to the channel and track it in one step. */
  async send(channel, eventId, payload, kind = 'notice') {
    const message = await channel.send(payload);
    this.track(eventId, channel.id, message.id, kind);
    return message;
  },

  getByEvent(eventId, kind) {
    const db = getDb();
    return kind
      ? db.prepare('SELECT * FROM event_messages WHERE event_id = ? AND kind = ?').all(eventId, kind)
      : db.prepare('SELECT * FROM event_messages WHERE event_id = ?').all(eventId);
  },

  forget(id) {
    const db = getDb();
    db.prepare('DELETE FROM event_messages WHERE id = ?').run(id);
  },

  /**
   * Delete tracked messages from Discord and drop their rows.
   * Rows are dropped even when the delete fails — the message is either already
   * gone or unreachable, and retrying it forever would be pointless.
   * Returns the number of messages actually deleted.
   */
  async purge(client, eventId, kind) {
    const rows = this.getByEvent(eventId, kind);
    let deleted = 0;

    for (const row of rows) {
      try {
        const channel = await client.channels.fetch(row.channel_id);
        const message = await channel.messages.fetch(row.message_id);
        await message.delete();
        deleted++;
      } catch {}
      this.forget(row.id);
    }

    return deleted;
  },
};

module.exports = eventMessageService;

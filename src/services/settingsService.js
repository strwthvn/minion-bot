const { getDb } = require('../database/connection');
const eventService = require('./eventService');

const DEFAULTS = {
  archive_channel_id: null,
  cleanup_reminders: 0,
  cleanup_delay_minutes: null,
};

const settingsService = {
  get(guildId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    return row || { guild_id: guildId, ...DEFAULTS };
  },

  set(guildId, fields) {
    const db = getDb();
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;

    db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);
    sets.push("updated_at = datetime('now')");
    values.push(guildId);
    db.prepare(`UPDATE guild_settings SET ${sets.join(', ')} WHERE guild_id = ?`).run(...values);
  },

  /**
   * Settings for the guild an event lives in. Events created before the guild_id
   * column existed are backfilled from their channel on first lookup.
   * Returns null if the guild cannot be determined (e.g. channel is gone).
   */
  async forEvent(client, event) {
    let guildId = event.guild_id;

    if (!guildId && event.channel_id) {
      try {
        const channel = await client.channels.fetch(event.channel_id);
        guildId = channel.guildId;
        if (guildId) eventService.update(event.id, { guild_id: guildId });
      } catch {
        return null;
      }
    }

    return guildId ? this.get(guildId) : null;
  },
};

module.exports = settingsService;

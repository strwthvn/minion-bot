const eventService = require('./eventService');
const participantService = require('./participantService');
const embedService = require('./embedService');
const eventMessageService = require('./eventMessageService');

const archiveService = {
  /**
   * Drop the "начнётся через N" pings once the event has started.
   * No-op unless the guild opted in via /settings cleanup-reminders.
   */
  async cleanupReminders(client, event, settings) {
    if (!settings?.cleanup_reminders || event.reminders_cleaned) return;

    await eventMessageService.purge(client, event.id, 'reminder');
    eventService.update(event.id, { reminders_cleaned: 1 });
  },

  /**
   * Clear a finished event out of its channel: purge leftover bot messages, then
   * either repost the embed in the archive channel or — when no archive channel
   * is configured — delete it outright.
   */
  async archive(client, event, settings) {
    await eventMessageService.purge(client, event.id);

    let archived = null;

    if (settings.archive_channel_id) {
      const participants = participantService.getAll(event.id);
      const embed = embedService.buildEmbed(event, participants);

      try {
        const archiveChannel = await client.channels.fetch(settings.archive_channel_id);
        archived = await archiveChannel.send({ embeds: [embed] });
      } catch (err) {
        // Leave the original in place rather than losing the event entirely.
        // The next tick retries, so a transient failure heals itself.
        console.error(`Failed to archive event #${event.id}:`, err.message);
        return false;
      }
    }

    if (event.channel_id && event.message_id) {
      try {
        const channel = await client.channels.fetch(event.channel_id);
        const message = await channel.messages.fetch(event.message_id);
        await message.delete();
      } catch {}
    }

    eventService.update(event.id, {
      archived_at: new Date().toISOString(),
      // Point the record at the archived copy so it stays resolvable
      channel_id: archived ? archived.channel.id : null,
      message_id: archived ? archived.id : null,
    });

    return true;
  },
};

module.exports = archiveService;

const eventService = require('./eventService');
const participantService = require('./participantService');
const embedService = require('./embedService');
const eventMessageService = require('./eventMessageService');
const settingsService = require('./settingsService');
const archiveService = require('./archiveService');

let intervalId = null;

const THRESHOLDS = [
  { flag: 'reminder_24h', ms: 24 * 60 * 60 * 1000, label: '24 часа' },
  { flag: 'reminder_1h',  ms: 60 * 60 * 1000,      label: '1 час' },
  { flag: 'reminder_5min', ms: 5 * 60 * 1000,       label: '5 минут' },
];

const reminderService = {
  start(client) {
    if (intervalId) return;
    intervalId = setInterval(() => this.check(client), 60_000);
    // Run immediately on start
    this.check(client);
  },

  stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  },

  async check(client) {
    const events = eventService.getActive();
    const now = Date.now();

    for (const event of events) {
      const eventTime = new Date(event.date_time).getTime();
      const diff = eventTime - now;

      // Event has passed → complete it
      if (diff <= 0) {
        eventService.setStatus(event.id, 'completed');

        if (event.channel_id) {
          try {
            const channel = await client.channels.fetch(event.channel_id);
            const participants = participantService.getAll(event.id);
            const updatedEvent = eventService.getById(event.id);
            await embedService.update(channel, updatedEvent, participants);
          } catch (err) {
            console.error(`Failed to update completed event #${event.id}:`, err.message);
          }
        }

        try {
          const settings = await settingsService.forEvent(client, event);
          await archiveService.cleanupReminders(client, event, settings);
        } catch (err) {
          console.error(`Failed to clean reminders for event #${event.id}:`, err.message);
        }
        continue;
      }

      // Check reminder thresholds
      for (const threshold of THRESHOLDS) {
        if (diff <= threshold.ms && !event[threshold.flag]) {
          eventService.setReminderFlag(event.id, threshold.flag);

          if (!event.channel_id) continue;

          try {
            const channel = await client.channels.fetch(event.channel_id);
            const mainParticipants = participantService.getMain(event.id);
            const mentions = mainParticipants.map(p => `<@${p.user_id}>`).join(' ');

            await eventMessageService.send(
              channel,
              event.id,
              `⏰ **${event.name}** начнётся через **${threshold.label}**!\n${mentions || 'Пока нет участников.'}`,
              'reminder',
            );
          } catch (err) {
            console.error(`Failed to send reminder for event #${event.id}:`, err.message);
          }
        }
      }
    }

    await this.checkCleanup(client);
  },

  /** Archive/remove finished events whose cleanup delay has elapsed. */
  async checkCleanup(client) {
    const now = Date.now();

    for (const event of eventService.getPendingArchive()) {
      try {
        const settings = await settingsService.forEvent(client, event);
        if (!settings || settings.cleanup_delay_minutes == null) continue;

        const finishedAt = new Date(event.finished_at || event.date_time).getTime();
        if (now < finishedAt + settings.cleanup_delay_minutes * 60_000) continue;

        await archiveService.cleanupReminders(client, event, settings);
        await archiveService.archive(client, event, settings);
      } catch (err) {
        console.error(`Failed to clean up event #${event.id}:`, err.message);
      }
    }
  },
};

module.exports = reminderService;

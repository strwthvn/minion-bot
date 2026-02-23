const { EVENTS_CHANNEL_ID } = require('../config');
const eventService = require('./eventService');
const participantService = require('./participantService');
const embedService = require('./embedService');

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

        try {
          const channel = await client.channels.fetch(EVENTS_CHANNEL_ID);
          const participants = participantService.getAll(event.id);
          const updatedEvent = eventService.getById(event.id);
          await embedService.update(channel, updatedEvent, participants);
        } catch (err) {
          console.error(`Failed to update completed event #${event.id}:`, err.message);
        }
        continue;
      }

      // Check reminder thresholds
      for (const threshold of THRESHOLDS) {
        if (diff <= threshold.ms && !event[threshold.flag]) {
          eventService.setReminderFlag(event.id, threshold.flag);

          try {
            const channel = await client.channels.fetch(EVENTS_CHANNEL_ID);
            const mainParticipants = participantService.getMain(event.id);
            const mentions = mainParticipants.map(p => `<@${p.user_id}>`).join(' ');

            await channel.send(
              `⏰ **${event.name}** начнётся через **${threshold.label}**!\n${mentions || 'Пока нет участников.'}`,
            );
          } catch (err) {
            console.error(`Failed to send reminder for event #${event.id}:`, err.message);
          }
        }
      }
    }
  },
};

module.exports = reminderService;

const { EmbedBuilder } = require('discord.js');
const { COLORS, EMBED_FOOTER } = require('../config');
const { formatMSK } = require('../utils/dateParser');

const STATUS_LABELS = {
  active: '🟢 Активен',
  completed: '✅ Завершён',
  cancelled: '❌ Отменён',
};

const embedService = {
  buildEmbed(event, participants) {
    const reactions = JSON.parse(event.reactions);
    const mainParticipants = participants.filter(p => !p.is_reserve);
    const reserveParticipants = participants.filter(p => p.is_reserve);

    const color = event.status === 'cancelled'
      ? COLORS.CANCELLED
      : event.status === 'completed'
        ? COLORS.COMPLETED
        : COLORS.ACTIVE;

    const embed = new EmbedBuilder()
      .setTitle(event.name)
      .setDescription(event.description)
      .setColor(color)
      .setFooter({ text: `${EMBED_FOOTER} • Ивент #${event.id}` })
      .setTimestamp(new Date(event.date_time));

    embed.addFields({
      name: '📅 Дата и время',
      value: formatMSK(event.date_time),
      inline: true,
    });

    embed.addFields({
      name: '📊 Статус',
      value: STATUS_LABELS[event.status] || event.status,
      inline: true,
    });

    const limitStr = event.participant_limit
      ? `${mainParticipants.length}/${event.participant_limit}`
      : `${mainParticipants.length}`;

    embed.addFields({
      name: '👥 Участники',
      value: limitStr,
      inline: true,
    });

    // Group main participants by reaction
    const positiveReactions = reactions.filter(r => r !== '❌');
    for (const emoji of positiveReactions) {
      const group = mainParticipants.filter(p => p.reaction === emoji);
      const value = group.length > 0
        ? group.map(p => `<@${p.user_id}>`).join('\n')
        : '*Пусто*';
      embed.addFields({
        name: `${emoji} (${group.length})`,
        value,
        inline: true,
      });
    }

    // Reserve queue
    if (reserveParticipants.length > 0) {
      embed.addFields({
        name: `⏳ Очередь запасных (${reserveParticipants.length})`,
        value: reserveParticipants.map((p, i) => `${i + 1}. <@${p.user_id}>`).join('\n'),
      });
    }

    return embed;
  },

  /**
   * Post a new embed to channel, add reactions, ping role.
   * Returns the sent message.
   */
  async postNew(channel, event, participants) {
    const embed = this.buildEmbed(event, participants);
    const reactions = JSON.parse(event.reactions);

    const pingTarget = event.ping_role_id ? `<@&${event.ping_role_id}>` : '@everyone';
    const message = await channel.send({
      content: `${pingTarget} — новый ивент!`,
      embeds: [embed],
    });

    for (const emoji of reactions) {
      await message.react(emoji).catch(() => {});
    }

    return message;
  },

  /**
   * Update an existing embed message.
   */
  async update(channel, event, participants) {
    if (!event.message_id) return;

    try {
      const message = await channel.messages.fetch(event.message_id);
      const embed = this.buildEmbed(event, participants);
      await message.edit({ embeds: [embed] });
    } catch (err) {
      console.error(`Failed to update embed for event #${event.id}:`, err.message);
    }
  },
};

module.exports = embedService;

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const settingsService = require('../services/settingsService');

const POSTABLE_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Настройки бота на сервере')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('show')
        .setDescription('Показать текущие настройки'),
    )
    .addSubcommand(sub =>
      sub
        .setName('archive')
        .setDescription('Канал, куда переносятся завершённые ивенты')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Канал архива (не указывать = выключить архивацию)')
            .addChannelTypes(...POSTABLE_CHANNELS)
            .setRequired(false),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('cleanup-reminders')
        .setDescription('Удалять напоминания о скором начале, когда ивент начался')
        .addBooleanOption(opt =>
          opt
            .setName('enabled')
            .setDescription('Включить очистку напоминаний')
            .setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('cleanup-event')
        .setDescription('Убирать сообщение ивента через N минут после начала')
        .addIntegerOption(opt =>
          opt
            .setName('delay')
            .setDescription('Минут после начала, 0 = сразу (не указывать = выключить)')
            .setMinValue(0)
            .setMaxValue(10080) // неделя
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ Команда доступна только на сервере.', flags: 64 });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'show') return handleShow(interaction);
    if (sub === 'archive') return handleArchive(interaction);
    if (sub === 'cleanup-reminders') return handleCleanupReminders(interaction);
    if (sub === 'cleanup-event') return handleCleanupEvent(interaction);
  },
};

// ─── SHOW ────────────────────────────────────────────────

async function handleShow(interaction) {
  const settings = settingsService.get(interaction.guildId);

  const archive = settings.archive_channel_id
    ? `<#${settings.archive_channel_id}>`
    : '*не задан*';

  const reminders = settings.cleanup_reminders
    ? 'включена — напоминания удаляются при старте ивента'
    : 'выключена';

  const cleanup = settings.cleanup_delay_minutes == null
    ? 'выключена'
    : settings.cleanup_delay_minutes === 0
      ? 'сразу после начала ивента'
      : `через ${settings.cleanup_delay_minutes} мин. после начала ивента`;

  await interaction.reply({
    content: [
      '**Настройки ивентов**',
      '',
      `📦 Канал архива: ${archive}`,
      `🧹 Очистка напоминаний: ${reminders}`,
      `⏳ Очистка сообщения ивента: ${cleanup}`,
      '',
      describeOutcome(settings),
    ].join('\n'),
    flags: 64,
  });
}

/** Plain-language summary of what the current combination of settings actually does. */
function describeOutcome(settings) {
  if (settings.cleanup_delay_minutes == null) {
    return settings.archive_channel_id
      ? '⚠️ Архивация не сработает: включите `/settings cleanup-event`, чтобы ивенты переносились в архив.'
      : '_Сообщения ивентов остаются в своих каналах._';
  }

  return settings.archive_channel_id
    ? `_Завершённые ивенты переносятся в <#${settings.archive_channel_id}>._`
    : '⚠️ Канал архива не задан — сообщения ивентов будут **удаляться безвозвратно**.';
}

// ─── ARCHIVE CHANNEL ─────────────────────────────────────

async function handleArchive(interaction) {
  const channel = interaction.options.getChannel('channel');

  if (!channel) {
    settingsService.set(interaction.guildId, { archive_channel_id: null });
    return interaction.reply({
      content: '✅ Архивация выключена. Сообщения завершённых ивентов будут удаляться, если включена `/settings cleanup-event`.',
      flags: 64,
    });
  }

  const missing = missingPermissions(interaction, channel);
  if (missing) {
    return interaction.reply({
      content: `❌ У бота нет прав в <#${channel.id}>: ${missing}.`,
      flags: 64,
    });
  }

  settingsService.set(interaction.guildId, { archive_channel_id: channel.id });

  const settings = settingsService.get(interaction.guildId);
  const hint = settings.cleanup_delay_minutes == null
    ? '\n⚠️ Перенос пока не включён — задайте `/settings cleanup-event delay:<минуты>`.'
    : '';

  await interaction.reply({
    content: `✅ Архив ивентов: <#${channel.id}>.${hint}`,
    flags: 64,
  });
}

function missingPermissions(interaction, channel) {
  const me = interaction.guild.members.me;
  if (!me) return null;

  const perms = channel.permissionsFor(me);
  if (!perms) return null;

  const required = [
    [PermissionFlagsBits.ViewChannel, 'Просмотр канала'],
    [PermissionFlagsBits.SendMessages, 'Отправка сообщений'],
    [PermissionFlagsBits.EmbedLinks, 'Встраивание ссылок'],
  ];

  const missing = required.filter(([flag]) => !perms.has(flag)).map(([, label]) => label);
  return missing.length > 0 ? missing.join(', ') : null;
}

// ─── CLEANUP: REMINDERS ──────────────────────────────────

async function handleCleanupReminders(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  settingsService.set(interaction.guildId, { cleanup_reminders: enabled ? 1 : 0 });

  await interaction.reply({
    content: enabled
      ? '✅ Напоминания (24ч / 1ч / 5мин) будут удаляться в момент начала ивента.'
      : '✅ Напоминания больше не удаляются автоматически.',
    flags: 64,
  });
}

// ─── CLEANUP: EVENT MESSAGE ──────────────────────────────

async function handleCleanupEvent(interaction) {
  const delay = interaction.options.getInteger('delay');

  if (delay == null) {
    settingsService.set(interaction.guildId, { cleanup_delay_minutes: null });
    return interaction.reply({
      content: '✅ Автоочистка сообщений ивентов выключена — они остаются в своих каналах.',
      flags: 64,
    });
  }

  settingsService.set(interaction.guildId, { cleanup_delay_minutes: delay });

  const settings = settingsService.get(interaction.guildId);
  const when = delay === 0 ? 'сразу после начала' : `через ${delay} мин. после начала`;
  const target = settings.archive_channel_id
    ? `переносится в <#${settings.archive_channel_id}>`
    : '**удаляется безвозвратно** — задайте `/settings archive channel:<канал>`, чтобы сохранять историю';

  await interaction.reply({
    content: `✅ Сообщение ивента ${when} ${target}.`,
    flags: 64,
  });
}

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const { EVENTS_CHANNEL_ID } = require('../config');
const eventService = require('../services/eventService');
const participantService = require('../services/participantService');
const embedService = require('../services/embedService');
const { parse, formatMSK } = require('../utils/dateParser');

const ITEMS_PER_PAGE = 5;

// Temp storage for create flow (userId → event data), cleared after use
const pendingCreates = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Управление ивентами')
    .addSubcommand(sub =>
      sub.setName('create').setDescription('Создать новый ивент'),
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Список ивентов')
        .addStringOption(opt =>
          opt
            .setName('filter')
            .setDescription('Фильтр')
            .addChoices(
              { name: 'Предстоящие', value: 'upcoming' },
              { name: 'Прошедшие', value: 'past' },
            ),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Редактировать ивент')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('ID ивента').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Отменить ивент')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('ID ивента').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') return handleCreate(interaction);
    if (sub === 'list') return handleList(interaction);
    if (sub === 'edit') return handleEdit(interaction);
    if (sub === 'cancel') return handleCancel(interaction);
  },

  // Exported for index.js interaction routing
  handleModal,
  handleButton,
  handleStringSelect,
  handleRoleSelect,
  handleUserSelect,
};

// ─── CREATE ──────────────────────────────────────────────

async function handleCreate(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('event-create-modal')
    .setTitle('Создать ивент');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Название')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Описание')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('datetime')
        .setLabel('Дата и время (МСК)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('25.07.2025 20:00'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('limit')
        .setLabel('Лимит участников')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('Пусто = без лимита'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reactions')
        .setLabel('Кастомные реакции')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('🗡️ 🛡️ 🩹 или пусто = ✅/❌'),
    ),
  );

  await interaction.showModal(modal);
}

// ─── LIST ────────────────────────────────────────────────

async function handleList(interaction) {
  const filter = interaction.options.getString('filter') || 'upcoming';
  const events = filter === 'past' ? eventService.getPast() : eventService.getActive();

  if (events.length === 0) {
    return interaction.reply({
      content: filter === 'past' ? 'Нет прошедших ивентов.' : 'Нет предстоящих ивентов.',
      flags: 64,
    });
  }

  const pages = [];
  for (let i = 0; i < events.length; i += ITEMS_PER_PAGE) {
    pages.push(events.slice(i, i + ITEMS_PER_PAGE));
  }

  const buildPage = (page, pageIndex) => {
    const lines = page.map(e => {
      const mainCount = participantService.getMain(e.id).length;
      const limitStr = e.participant_limit ? `${mainCount}/${e.participant_limit}` : `${mainCount}`;
      return `**#${e.id}** — ${e.name}\n📅 ${formatMSK(e.date_time)} | 👥 ${limitStr}`;
    });

    const components = [];
    if (pages.length > 1) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`event-list-prev:${pageIndex}:${filter}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex === 0),
          new ButtonBuilder()
            .setCustomId(`event-list-next:${pageIndex}:${filter}`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex === pages.length - 1),
        ),
      );
    }

    return {
      content: `**${filter === 'past' ? 'Прошедшие' : 'Предстоящие'} ивенты** (стр. ${pageIndex + 1}/${pages.length}):\n\n${lines.join('\n\n')}`,
      components,
      flags: 64,
    };
  };

  await interaction.reply(buildPage(pages[0], 0));
}

// ─── EDIT ────────────────────────────────────────────────

async function handleEdit(interaction) {
  const eventId = interaction.options.getInteger('id');
  const event = eventService.getById(eventId);

  if (!event) {
    return interaction.reply({ content: 'Ивент не найден.', flags: 64 });
  }
  if (event.creator_id !== interaction.user.id) {
    return interaction.reply({ content: 'Только создатель может редактировать ивент.', flags: 64 });
  }
  if (event.status !== 'active') {
    return interaction.reply({ content: 'Нельзя редактировать завершённый/отменённый ивент.', flags: 64 });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`event-edit-action:${eventId}`)
    .setPlaceholder('Выберите действие')
    .addOptions(
      { label: 'Изменить название/описание', value: 'name_desc' },
      { label: 'Изменить дату/время', value: 'datetime' },
      { label: 'Изменить лимит участников', value: 'limit' },
      { label: 'Изменить реакции', value: 'reactions' },
      { label: 'Добавить участника', value: 'add_user' },
      { label: 'Убрать участника', value: 'remove_user' },
    );

  await interaction.reply({
    content: `Редактирование ивента **#${eventId} — ${event.name}**:`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64,
  });
}

// ─── CANCEL ──────────────────────────────────────────────

async function handleCancel(interaction) {
  const eventId = interaction.options.getInteger('id');
  const event = eventService.getById(eventId);

  if (!event) {
    return interaction.reply({ content: 'Ивент не найден.', flags: 64 });
  }
  if (event.creator_id !== interaction.user.id) {
    return interaction.reply({ content: 'Только создатель может отменить ивент.', flags: 64 });
  }
  if (event.status !== 'active') {
    return interaction.reply({ content: 'Ивент уже завершён или отменён.', flags: 64 });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event-cancel-confirm:${eventId}`)
      .setLabel('Да, отменить')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('event-cancel-abort')
      .setLabel('Нет')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: `Вы уверены, что хотите отменить ивент **#${eventId} — ${event.name}**?`,
    components: [row],
    flags: 64,
  });
}

// ─── INTERACTION HANDLERS ────────────────────────────────

async function handleModal(interaction) {
  const customId = interaction.customId;

  if (customId === 'event-create-modal') {
    return handleCreateModalSubmit(interaction);
  }

  if (customId.startsWith('event-edit-modal:')) {
    return handleEditModalSubmit(interaction);
  }
}

async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('event-list-prev:') || customId.startsWith('event-list-next:')) {
    return handleListPagination(interaction);
  }

  if (customId.startsWith('event-cancel-confirm:')) {
    return handleCancelConfirm(interaction);
  }

  if (customId === 'event-cancel-abort') {
    return interaction.update({ content: 'Отмена отменена.', components: [] });
  }

  if (customId.startsWith('event-create-role-skip:')) {
    return handleRoleSkip(interaction);
  }
}

async function handleStringSelect(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('event-edit-action:')) {
    return handleEditAction(interaction);
  }
}

async function handleRoleSelect(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('event-create-role:')) {
    return handleCreateRoleSelect(interaction);
  }
}

async function handleUserSelect(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('event-edit-adduser:')) {
    return handleEditAddUser(interaction);
  }

  if (customId.startsWith('event-edit-removeuser:')) {
    return handleEditRemoveUser(interaction);
  }
}

// ─── CREATE FLOW ─────────────────────────────────────────

async function handleCreateModalSubmit(interaction) {
  const name = interaction.fields.getTextInputValue('name');
  const description = interaction.fields.getTextInputValue('description');
  const datetimeStr = interaction.fields.getTextInputValue('datetime');
  const limitStr = interaction.fields.getTextInputValue('limit');
  const reactionsStr = interaction.fields.getTextInputValue('reactions');

  const parsed = parse(datetimeStr);
  if (!parsed.ok) {
    return interaction.reply({ content: `❌ ${parsed.error}`, flags: 64 });
  }

  const limit = limitStr ? parseInt(limitStr, 10) : null;
  if (limitStr && (isNaN(limit) || limit < 1)) {
    return interaction.reply({ content: '❌ Лимит должен быть положительным числом.', flags: 64 });
  }

  let reactions = ['✅', '❌'];
  if (reactionsStr && reactionsStr.trim()) {
    const custom = reactionsStr.trim().split(/\s+/).filter(Boolean);
    if (custom.length > 0) {
      reactions = [...custom];
      if (!reactions.includes('❌')) reactions.push('❌');
    }
  }

  // Store temp data keyed by user ID
  const userId = interaction.user.id;
  pendingCreates.set(userId, { name, description, dateTime: parsed.date.toISOString(), limit, reactions });

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`event-create-role:${userId}`)
    .setPlaceholder('Выберите роль для пинга');

  const skipButton = new ButtonBuilder()
    .setCustomId(`event-create-role-skip:${userId}`)
    .setLabel('Пропустить (@everyone)')
    .setStyle(ButtonStyle.Secondary);

  await interaction.reply({
    content: '✅ Данные ивента получены! Выберите роль для пинга или пропустите:',
    components: [
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(skipButton),
    ],
    flags: 64,
  });
}

async function handleCreateRoleSelect(interaction) {
  const userId = interaction.customId.split(':')[1];
  const data = pendingCreates.get(userId);
  if (!data) return interaction.update({ content: '❌ Данные ивента не найдены. Попробуйте создать заново.', components: [] });
  pendingCreates.delete(userId);
  const roleId = interaction.values[0];

  await finalizeEventCreation(interaction, data, roleId);
}

async function handleRoleSkip(interaction) {
  const userId = interaction.customId.split(':')[1];
  const data = pendingCreates.get(userId);
  if (!data) return interaction.update({ content: '❌ Данные ивента не найдены. Попробуйте создать заново.', components: [] });
  pendingCreates.delete(userId);

  await finalizeEventCreation(interaction, data, null);
}

async function finalizeEventCreation(interaction, data, pingRoleId) {
  const eventId = eventService.create({
    name: data.name,
    description: data.description,
    dateTime: new Date(data.dateTime),
    creatorId: interaction.user.id,
    pingRoleId,
    participantLimit: data.limit,
    reactions: data.reactions,
  });

  const event = eventService.getById(eventId);

  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    const message = await embedService.postNew(channel, event, []);
    eventService.setMessageId(eventId, message.id);

    await interaction.update({
      content: `✅ Ивент **#${eventId} — ${data.name}** создан!`,
      components: [],
    });
  } catch (err) {
    console.error('Failed to post event embed:', err);
    await interaction.update({
      content: `⚠️ Ивент создан (ID: ${eventId}), но не удалось отправить сообщение в канал.`,
      components: [],
    });
  }
}

// ─── LIST PAGINATION ─────────────────────────────────────

async function handleListPagination(interaction) {
  const parts = interaction.customId.split(':');
  const currentPage = parseInt(parts[1], 10);
  const filter = parts[2];
  const direction = interaction.customId.startsWith('event-list-next') ? 1 : -1;
  const newPage = currentPage + direction;

  const events = filter === 'past' ? eventService.getPast() : eventService.getActive();
  const pages = [];
  for (let i = 0; i < events.length; i += ITEMS_PER_PAGE) {
    pages.push(events.slice(i, i + ITEMS_PER_PAGE));
  }

  if (newPage < 0 || newPage >= pages.length) return;

  const page = pages[newPage];
  const lines = page.map(e => {
    const mainCount = participantService.getMain(e.id).length;
    const limitStr = e.participant_limit ? `${mainCount}/${e.participant_limit}` : `${mainCount}`;
    return `**#${e.id}** — ${e.name}\n📅 ${formatMSK(e.date_time)} | 👥 ${limitStr}`;
  });

  const components = [];
  if (pages.length > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`event-list-prev:${newPage}:${filter}`)
          .setLabel('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(newPage === 0),
        new ButtonBuilder()
          .setCustomId(`event-list-next:${newPage}:${filter}`)
          .setLabel('▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(newPage === pages.length - 1),
      ),
    );
  }

  await interaction.update({
    content: `**${filter === 'past' ? 'Прошедшие' : 'Предстоящие'} ивенты** (стр. ${newPage + 1}/${pages.length}):\n\n${lines.join('\n\n')}`,
    components,
  });
}

// ─── CANCEL CONFIRM ──────────────────────────────────────

async function handleCancelConfirm(interaction) {
  const eventId = parseInt(interaction.customId.split(':')[1], 10);
  const event = eventService.getById(eventId);

  if (!event || event.status !== 'active') {
    return interaction.update({ content: 'Ивент уже завершён или отменён.', components: [] });
  }

  eventService.setStatus(eventId, 'cancelled');

  // Notify participants
  const mainParticipants = participantService.getMain(eventId);
  const mentions = mainParticipants.map(p => `<@${p.user_id}>`).join(' ');

  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    if (mentions) {
      await channel.send(`❌ Ивент **${event.name}** отменён!\n${mentions}`);
    }
    const participants = participantService.getAll(eventId);
    const updatedEvent = eventService.getById(eventId);
    await embedService.update(channel, updatedEvent, participants);
  } catch (err) {
    console.error('Failed to notify about cancellation:', err);
  }

  await interaction.update({ content: `✅ Ивент **#${eventId}** отменён.`, components: [] });
}

// ─── EDIT FLOW ───────────────────────────────────────────

async function handleEditAction(interaction) {
  const parts = interaction.customId.split(':');
  const eventId = parseInt(parts[1], 10);
  const action = interaction.values[0];

  const event = eventService.getById(eventId);
  if (!event || event.status !== 'active') {
    return interaction.update({ content: 'Ивент не найден или неактивен.', components: [] });
  }

  if (action === 'name_desc') {
    const modal = new ModalBuilder()
      .setCustomId(`event-edit-modal:${eventId}:name_desc`)
      .setTitle('Изменить название/описание');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Название')
          .setStyle(TextInputStyle.Short)
          .setValue(event.name)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Описание')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(event.description)
          .setRequired(true),
      ),
    );

    return interaction.showModal(modal);
  }

  if (action === 'datetime') {
    const modal = new ModalBuilder()
      .setCustomId(`event-edit-modal:${eventId}:datetime`)
      .setTitle('Изменить дату/время');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('datetime')
          .setLabel('Дата и время (МСК)')
          .setStyle(TextInputStyle.Short)
          .setValue(formatMSK(event.date_time).replace(' МСК', ''))
          .setRequired(true)
          .setPlaceholder('25.07.2025 20:00'),
      ),
    );

    return interaction.showModal(modal);
  }

  if (action === 'limit') {
    const modal = new ModalBuilder()
      .setCustomId(`event-edit-modal:${eventId}:limit`)
      .setTitle('Изменить лимит участников');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('limit')
          .setLabel('Лимит участников')
          .setStyle(TextInputStyle.Short)
          .setValue(event.participant_limit ? String(event.participant_limit) : '')
          .setRequired(false)
          .setPlaceholder('Пусто = без лимита'),
      ),
    );

    return interaction.showModal(modal);
  }

  if (action === 'reactions') {
    const currentReactions = JSON.parse(event.reactions).filter(r => r !== '❌').join(' ');
    const modal = new ModalBuilder()
      .setCustomId(`event-edit-modal:${eventId}:reactions`)
      .setTitle('Изменить реакции');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reactions')
          .setLabel('Реакции (через пробел)')
          .setStyle(TextInputStyle.Short)
          .setValue(currentReactions)
          .setRequired(false)
          .setPlaceholder('🗡️ 🛡️ 🩹 или пусто = ✅'),
      ),
    );

    return interaction.showModal(modal);
  }

  if (action === 'add_user') {
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`event-edit-adduser:${eventId}`)
      .setPlaceholder('Выберите участника');

    return interaction.update({
      content: 'Выберите участника для добавления:',
      components: [new ActionRowBuilder().addComponents(userSelect)],
    });
  }

  if (action === 'remove_user') {
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`event-edit-removeuser:${eventId}`)
      .setPlaceholder('Выберите участника');

    return interaction.update({
      content: 'Выберите участника для удаления:',
      components: [new ActionRowBuilder().addComponents(userSelect)],
    });
  }
}

async function handleEditModalSubmit(interaction) {
  const parts = interaction.customId.split(':');
  const eventId = parseInt(parts[1], 10);
  const action = parts[2];

  const event = eventService.getById(eventId);
  if (!event || event.status !== 'active') {
    return interaction.reply({ content: 'Ивент не найден или неактивен.', flags: 64 });
  }

  if (action === 'name_desc') {
    const name = interaction.fields.getTextInputValue('name');
    const description = interaction.fields.getTextInputValue('description');
    eventService.update(eventId, { name, description });
  }

  if (action === 'datetime') {
    const datetimeStr = interaction.fields.getTextInputValue('datetime');
    const parsed = parse(datetimeStr);
    if (!parsed.ok) {
      return interaction.reply({ content: `❌ ${parsed.error}`, flags: 64 });
    }
    eventService.update(eventId, { date_time: parsed.date.toISOString() });
    eventService.resetReminders(eventId);

    // Notify participants about date change
    const mainParticipants = participantService.getMain(eventId);
    if (mainParticipants.length > 0) {
      const mentions = mainParticipants.map(p => `<@${p.user_id}>`).join(' ');
      try {
        const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
        await channel.send(`📅 Дата ивента **${event.name}** изменена на **${formatMSK(parsed.date)}**!\n${mentions}`);
      } catch {}
    }
  }

  if (action === 'limit') {
    const limitStr = interaction.fields.getTextInputValue('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : null;
    if (limitStr && (isNaN(limit) || limit < 1)) {
      return interaction.reply({ content: '❌ Лимит должен быть положительным числом.', flags: 64 });
    }
    eventService.update(eventId, { participant_limit: limit });
  }

  if (action === 'reactions') {
    const reactionsStr = interaction.fields.getTextInputValue('reactions');
    let reactions = ['✅', '❌'];
    if (reactionsStr && reactionsStr.trim()) {
      const custom = reactionsStr.trim().split(/\s+/).filter(Boolean);
      if (custom.length > 0) {
        reactions = [...custom];
        if (!reactions.includes('❌')) reactions.push('❌');
      }
    }
    eventService.update(eventId, { reactions: JSON.stringify(reactions) });

    // Re-add reactions to message
    try {
      const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
      const updatedEvent = eventService.getById(eventId);
      if (updatedEvent.message_id) {
        const msg = await channel.messages.fetch(updatedEvent.message_id);
        await msg.reactions.removeAll();
        for (const emoji of reactions) {
          await msg.react(emoji).catch(() => {});
        }
      }
    } catch {}
  }

  // Update embed
  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    const updatedEvent = eventService.getById(eventId);
    const participants = participantService.getAll(eventId);
    await embedService.update(channel, updatedEvent, participants);
  } catch {}

  await interaction.reply({ content: '✅ Ивент обновлён!', flags: 64 });
}

async function handleEditAddUser(interaction) {
  const eventId = parseInt(interaction.customId.split(':')[1], 10);
  const userId = interaction.values[0];

  const event = eventService.getById(eventId);
  if (!event || event.status !== 'active') {
    return interaction.update({ content: 'Ивент не найден или неактивен.', components: [] });
  }

  const reactions = JSON.parse(event.reactions);
  const mainReaction = reactions.find(r => r !== '❌') || '✅';
  const result = participantService.add(eventId, userId, mainReaction);

  // Update embed
  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    const participants = participantService.getAll(eventId);
    await embedService.update(channel, event, participants);
  } catch {}

  // Notify user
  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    await channel.send(`<@${userId}> добавлен в ивент **${event.name}**${result.isReserve ? ' (в очередь запасных)' : ''}!`);
  } catch {}

  await interaction.update({
    content: `✅ <@${userId}> добавлен${result.isReserve ? ' в очередь запасных' : ''}.`,
    components: [],
  });
}

async function handleEditRemoveUser(interaction) {
  const eventId = parseInt(interaction.customId.split(':')[1], 10);
  const userId = interaction.values[0];

  const event = eventService.getById(eventId);
  if (!event || event.status !== 'active') {
    return interaction.update({ content: 'Ивент не найден или неактивен.', components: [] });
  }

  const promoted = participantService.remove(eventId, userId);

  // Update embed
  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    const participants = participantService.getAll(eventId);
    await embedService.update(channel, event, participants);
  } catch {}

  // Notify
  try {
    const channel = await interaction.client.channels.fetch(EVENTS_CHANNEL_ID);
    await channel.send(`<@${userId}> убран из ивента **${event.name}**.`);
    if (promoted) {
      await channel.send(`<@${promoted}> перемещён из очереди в основной состав ивента **${event.name}**!`);
    }
  } catch {}

  await interaction.update({
    content: `✅ <@${userId}> убран из ивента.`,
    components: [],
  });
}

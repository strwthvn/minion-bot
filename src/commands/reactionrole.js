const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const reactionRoleService = require('../services/reactionRoleService');
const { MAX_REACTION_ROLES } = require('../config');

const POSTABLE_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// Mirrors what discord.js can resolve back into a component emoji: a 2-32 char
// name and a real snowflake. Anything looser renders as an empty reaction.
const CUSTOM_EMOJI_REGEX = /^<(a?):(\w{2,32}):(\d{17,20})>$/;
const MESSAGE_LIMIT = 2000;
// Discord API error codes that prove the target is gone rather than unreachable
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;
const LIST_LIMIT = 25;

const EXPIRED = '❌ Данные конструктора не найдены. Начните заново.';

// Temp storage for the emoji → role builder (userId → draft), cleared once applied
const pendingBuilds = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Выдача ролей по реакции на сообщение')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Создать сообщение, выдающее роли по реакциям'),
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Список сообщений с выдачей ролей'),
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Добавить реакцию и роль к существующему сообщению')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('ID из /reactionrole list').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Убрать реакцию и роль у существующего сообщения')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('ID из /reactionrole list').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Перестать выдавать роли по сообщению')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('ID из /reactionrole list').setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ Команда работает только на сервере.', flags: 64 });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') return handleCreate(interaction);
    if (sub === 'list') return handleList(interaction);
    if (sub === 'add') return handleAdd(interaction);
    if (sub === 'remove') return handleRemove(interaction);
    if (sub === 'delete') return handleDelete(interaction);
  },

  // Exported for index.js interaction routing
  handleModal,
  handleButton,
  handleStringSelect,
  handleRoleSelect,
};

// ─── VALIDATION ──────────────────────────────────────────

/**
 * Parse a raw emoji string into the match key stored in the DB and the
 * form used for reacting and rendering. Returns { ok: false, error } on bad input.
 */
function parseEmojiInput(client, raw) {
  const input = raw.trim();
  if (!input) return { ok: false, error: 'Эмодзи не указан.' };

  const custom = input.match(CUSTOM_EMOJI_REGEX);
  if (custom) {
    const id = custom[3];
    if (!client.emojis.cache.has(id)) {
      return { ok: false, error: 'Бот не имеет доступа к этому эмодзи. Используйте эмодзи с этого сервера.' };
    }
    return { ok: true, emoji: id, emojiDisplay: input };
  }

  if (/\s/.test(input) || input.length > 16) {
    return { ok: false, error: 'Укажите ровно один эмодзи.' };
  }

  return { ok: true, emoji: input, emojiDisplay: input };
}

/**
 * Why the bot cannot hand out this role, or null when it can.
 */
function roleProblem(guild, roleId) {
  const me = guild.members.me;
  if (!me) return 'не удалось определить роль бота на сервере.';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'у бота нет права «Управление ролями».';
  }

  const role = guild.roles.cache.get(roleId);
  if (!role) return 'роль не найдена.';
  if (role.id === guild.id) return 'роль @everyone нельзя выдавать.';
  if (role.managed) return `роль **${role.name}** управляется интеграцией и не выдаётся вручную.`;
  if (role.position >= me.roles.highest.position) {
    return `роль **${role.name}** выше роли бота — поднимите роль бота в настройках сервера.`;
  }

  return null;
}

function missingPermissions(guild, channel) {
  const me = guild.members.me;
  if (!me) return null;

  const perms = channel.permissionsFor(me);
  if (!perms) return null;

  const required = [
    [PermissionFlagsBits.ViewChannel, 'Просмотр канала'],
    [PermissionFlagsBits.SendMessages, 'Отправка сообщений'],
    [PermissionFlagsBits.AddReactions, 'Добавление реакций'],
    [PermissionFlagsBits.ReadMessageHistory, 'Чтение истории сообщений'],
  ];

  const missing = required.filter(([flag]) => !perms.has(flag)).map(([, label]) => label);
  return missing.length > 0 ? missing.join(', ') : null;
}

// ─── VIEWS ───────────────────────────────────────────────

/**
 * The ephemeral builder panel: draft preview plus the controls that edit it.
 * Returns a payload without flags — callers add them for reply(), omit for update().
 */
function renderBuilder(data) {
  const pairs = data.pairs
    .map((p, i) => `${i + 1}. ${p.emojiDisplay} → <@&${p.roleId}>`)
    .join('\n');

  // Quote line by line: a `>>>` block quote would swallow the rest of the panel
  const preview = data.text.split('\n').map(line => `> ${line}`).join('\n');

  let content = `**Конструктор выдачи ролей**\n\n**Текст сообщения:**\n${preview}`;
  content += `\n\n**Реакции:**\n${pairs || '*Пока не добавлено ни одной.*'}`;
  if (data.error) content += `\n\n❌ ${data.error}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('reactionrole-build-addpair')
        .setLabel('Добавить реакцию')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(data.pairs.length >= MAX_REACTION_ROLES),
    ),
  ];

  if (data.pairs.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('reactionrole-build-droppair')
          .setPlaceholder('Убрать пару из черновика')
          .addOptions(
            data.pairs.map((p, i) => ({
              label: `${i + 1}. ${p.roleName}`.slice(0, 100),
              value: p.emoji,
              emoji: p.emojiDisplay,
            })),
          ),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('reactionrole-build-publish')
        .setLabel('Опубликовать')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(data.pairs.length === 0),
      new ButtonBuilder()
        .setCustomId('reactionrole-build-cancel')
        .setLabel('Отмена')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { content, components: rows };
}

function renderRolePicker(data) {
  return {
    content: `Реакция ${data.pendingEmoji.emojiDisplay} — выберите роль, которая будет выдаваться:`,
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('reactionrole-build-role')
          .setPlaceholder('Выберите роль'),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('reactionrole-build-back')
          .setLabel('Назад')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function emojiModal() {
  return new ModalBuilder()
    .setCustomId('reactionrole-emoji-modal')
    .setTitle('Добавить реакцию')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('emoji')
          .setLabel('Эмодзи')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('👍 или :custom_emoji:'),
      ),
    );
}

/**
 * Buttons and selects always have a message to edit. A modal only does when it was
 * opened from a component — one opened from a slash command has to reply instead.
 */
async function showView(interaction, view) {
  const fromMessage = interaction.isModalSubmit() ? interaction.isFromMessage() : true;

  if (fromMessage) {
    return interaction.update(view);
  }
  return interaction.reply({ ...view, flags: 64 });
}

// ─── CREATE ──────────────────────────────────────────────

async function handleCreate(interaction) {
  if (!POSTABLE_CHANNELS.includes(interaction.channel?.type)) {
    return interaction.reply({
      content: '❌ Команду нужно вызывать в текстовом канале — сообщение публикуется в нём.',
      flags: 64,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('reactionrole-create-modal')
    .setTitle('Сообщение с выдачей ролей')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel('Текст сообщения')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1200)
          .setPlaceholder('Выберите свои роли реакциями ниже'),
      ),
    );

  await interaction.showModal(modal);
}

async function handleCreateModalSubmit(interaction) {
  const data = {
    mode: 'create',
    channelId: interaction.channelId,
    text: interaction.fields.getTextInputValue('text'),
    pairs: [],
    pendingEmoji: null,
    error: null,
  };

  pendingBuilds.set(interaction.user.id, data);

  await interaction.reply({ ...renderBuilder(data), flags: 64 });
}

async function handlePublish(interaction) {
  const data = pendingBuilds.get(interaction.user.id);
  if (!data || data.mode !== 'create') {
    return interaction.update({ content: EXPIRED, components: [] });
  }

  data.error = null;

  const channel = await interaction.client.channels.fetch(data.channelId).catch(() => null);
  if (!channel) {
    data.error = 'Канал публикации недоступен.';
    return interaction.update(renderBuilder(data));
  }

  const missing = missingPermissions(interaction.guild, channel);
  if (missing) {
    data.error = `Боту не хватает прав в <#${channel.id}>: ${missing}.`;
    return interaction.update(renderBuilder(data));
  }

  // Re-check every role — the server could have changed since the pair was added
  for (const pair of data.pairs) {
    const problem = roleProblem(interaction.guild, pair.roleId);
    if (problem) {
      data.error = `Нельзя опубликовать: ${problem}`;
      return interaction.update(renderBuilder(data));
    }
  }

  const bindings = data.pairs.map(p => ({ emoji_display: p.emojiDisplay, role_id: p.roleId }));
  const content = reactionRoleService.renderContent(data.text, bindings);

  if (content.length > MESSAGE_LIMIT) {
    data.error = `Сообщение вместе с подписью длиннее ${MESSAGE_LIMIT} символов — сократите текст.`;
    return interaction.update(renderBuilder(data));
  }

  // Reacting is rate-limited, so acknowledge before the slow part
  await interaction.deferUpdate();

  let message;
  try {
    // allowedMentions is mandatory: the legend is built from role mentions
    message = await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('Failed to post reaction-role message:', err.message);
    data.error = `Не удалось отправить сообщение в <#${channel.id}>.`;
    return interaction.editReply(renderBuilder(data));
  }

  for (const pair of data.pairs) {
    try {
      await message.react(pair.emojiDisplay);
    } catch (err) {
      console.error(`Failed to react with ${pair.emojiDisplay}:`, err.message);
      await message.delete().catch(() => {});
      data.error = `Не удалось поставить реакцию ${pair.emojiDisplay}. Проверьте, что эмодзи доступен боту.`;
      return interaction.editReply(renderBuilder(data));
    }
  }

  const id = reactionRoleService.create({
    guildId: interaction.guildId,
    channelId: channel.id,
    messageId: message.id,
    content: data.text,
    creatorId: interaction.user.id,
    pairs: data.pairs,
  });

  pendingBuilds.delete(interaction.user.id);

  await interaction.editReply({
    content: `✅ Сообщение **#${id}** опубликовано в <#${channel.id}> — роли выдаются по ${data.pairs.length} реакциям.`,
    components: [],
  });
}

// ─── LIST ────────────────────────────────────────────────

async function handleList(interaction) {
  const records = reactionRoleService.getByGuild(interaction.guildId);

  if (records.length === 0) {
    return interaction.reply({
      content: 'На сервере пока нет сообщений с выдачей ролей.',
      flags: 64,
    });
  }

  const header = '**Сообщения с выдачей ролей:**\n\n';
  const lines = [];
  let budget = MESSAGE_LIMIT - header.length - 40; // headroom for the "и ещё" tail

  for (const record of records) {
    if (lines.length >= LIST_LIMIT) break;

    const count = reactionRoleService.getBindings(record.id).length;
    const link = `https://discord.com/channels/${record.guild_id}/${record.channel_id}/${record.message_id}`;
    const line = `**#${record.id}** — <#${record.channel_id}> · ролей: ${count} · [перейти](${link})`;

    if (line.length + 1 > budget) break;
    budget -= line.length + 1;
    lines.push(line);
  }

  const hidden = records.length - lines.length;
  if (hidden > 0) lines.push(`*…и ещё ${hidden}.*`);

  await interaction.reply({ content: header + lines.join('\n'), flags: 64 });
}

// ─── ADD / REMOVE / DELETE ───────────────────────────────

/**
 * Look up a record and make sure it belongs to the guild the command came from.
 */
function requireRecord(interaction) {
  const record = reactionRoleService.getById(interaction.options.getInteger('id'));
  if (!record || record.guild_id !== interaction.guildId) return null;
  return record;
}

async function handleAdd(interaction) {
  const record = requireRecord(interaction);
  if (!record) {
    return interaction.reply({ content: '❌ Сообщение не найдено. Проверьте ID в `/reactionrole list`.', flags: 64 });
  }

  const bindings = reactionRoleService.getBindings(record.id);
  if (bindings.length >= MAX_REACTION_ROLES) {
    return interaction.reply({
      content: `❌ На сообщении уже ${MAX_REACTION_ROLES} реакций — это лимит Discord.`,
      flags: 64,
    });
  }

  pendingBuilds.set(interaction.user.id, {
    mode: 'add',
    messageRowId: record.id,
    pairs: [],
    pendingEmoji: null,
    error: null,
  });

  await interaction.showModal(emojiModal());
}

async function handleRemove(interaction) {
  const record = requireRecord(interaction);
  if (!record) {
    return interaction.reply({ content: '❌ Сообщение не найдено. Проверьте ID в `/reactionrole list`.', flags: 64 });
  }

  const bindings = reactionRoleService.getBindings(record.id);
  if (bindings.length === 0) {
    return interaction.reply({ content: 'У этого сообщения нет привязанных ролей.', flags: 64 });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`reactionrole-remove-pick:${record.id}`)
    .setPlaceholder('Выберите реакцию')
    .addOptions(
      bindings.map(b => {
        const role = interaction.guild.roles.cache.get(b.role_id);
        return {
          label: (role ? role.name : `Роль ${b.role_id}`).slice(0, 100),
          value: b.emoji,
          emoji: b.emoji_display,
        };
      }),
    );

  await interaction.reply({
    content: `Какую реакцию убрать из сообщения **#${record.id}**?`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64,
  });
}

async function handleRemovePick(interaction) {
  const recordId = parseInt(interaction.customId.split(':')[1], 10);
  const emoji = interaction.values[0];

  const record = reactionRoleService.getById(recordId);
  if (!record) {
    return interaction.update({ content: '❌ Сообщение больше не отслеживается.', components: [] });
  }

  await interaction.deferUpdate();

  const binding = reactionRoleService.getBindings(record.id).find(b => b.emoji === emoji);
  if (!binding) {
    return interaction.editReply({ content: '❌ Эта реакция уже убрана.', components: [] });
  }

  const { message, forgotten } = await resolveRecordMessage(interaction.client, record);
  if (forgotten) {
    return interaction.editReply({
      content: `❌ Сообщение **#${record.id}** удалено из канала — запись убрана целиком.`,
      components: [],
    });
  }

  reactionRoleService.removeBinding(record.id, emoji);

  if (message) {
    await message.reactions.cache.get(emoji)?.remove().catch(() => {});
    await syncMessage(message, record);
  }

  await interaction.editReply({
    content: `✅ Реакция ${binding.emoji_display} больше не выдаёт роль.${message ? '' : '\n⚠️ Сообщение сейчас недоступно — реакция на нём осталась.'}`,
    components: [],
  });
}

async function handleDelete(interaction) {
  const record = requireRecord(interaction);
  if (!record) {
    return interaction.reply({ content: '❌ Сообщение не найдено. Проверьте ID в `/reactionrole list`.', flags: 64 });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reactionrole-delete-confirm:${record.id}`)
      .setLabel('Да, отключить')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('reactionrole-delete-abort')
      .setLabel('Нет')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: `Отключить выдачу ролей по сообщению **#${record.id}** в <#${record.channel_id}>?\nСамо сообщение останется в канале, бот снимет с него свои реакции.`,
    components: [row],
    flags: 64,
  });
}

async function handleDeleteConfirm(interaction) {
  const recordId = parseInt(interaction.customId.split(':')[1], 10);
  const record = reactionRoleService.getById(recordId);

  if (!record) {
    return interaction.update({ content: 'Сообщение уже отключено.', components: [] });
  }

  await interaction.deferUpdate();

  const { message } = await fetchRecordMessage(interaction.client, record);
  if (message) {
    await message.reactions.removeAll().catch(() => {});
  }

  reactionRoleService.remove(record.id);

  await interaction.editReply({
    content: `✅ Сообщение **#${record.id}** больше не выдаёт роли.`,
    components: [],
  });
}

// ─── SHARED EMOJI → ROLE SUB-FLOW ────────────────────────

/**
 * Report a rejected pair. The create flow keeps its draft and shows the error on
 * the panel; the add flow has nothing to go back to, so the draft is dropped.
 */
async function rejectPair(interaction, data, error) {
  if (data.mode === 'create') {
    data.error = error;
    data.pendingEmoji = null;
    return showView(interaction, renderBuilder(data));
  }

  pendingBuilds.delete(interaction.user.id);
  return showView(interaction, { content: `❌ ${error}`, components: [] });
}

async function handleEmojiModalSubmit(interaction) {
  const data = pendingBuilds.get(interaction.user.id);
  if (!data) {
    return showView(interaction, { content: EXPIRED, components: [] });
  }

  const parsed = parseEmojiInput(interaction.client, interaction.fields.getTextInputValue('emoji'));
  if (!parsed.ok) return rejectPair(interaction, data, parsed.error);

  const taken = data.mode === 'create'
    ? data.pairs.some(p => p.emoji === parsed.emoji)
    : reactionRoleService.getBindings(data.messageRowId).some(b => b.emoji === parsed.emoji);

  if (taken) return rejectPair(interaction, data, 'Эта реакция уже привязана к роли.');

  data.error = null;
  data.pendingEmoji = { emoji: parsed.emoji, emojiDisplay: parsed.emojiDisplay };

  await showView(interaction, renderRolePicker(data));
}

async function handleRolePicked(interaction) {
  const data = pendingBuilds.get(interaction.user.id);
  if (!data || !data.pendingEmoji) {
    return interaction.update({ content: EXPIRED, components: [] });
  }

  const roleId = interaction.values[0];
  const problem = roleProblem(interaction.guild, roleId);
  if (problem) return rejectPair(interaction, data, `Нельзя выбрать эту роль: ${problem}`);

  const role = interaction.guild.roles.cache.get(roleId);

  if (data.mode === 'create') {
    data.pairs.push({ ...data.pendingEmoji, roleId, roleName: role.name });
    data.pendingEmoji = null;
    data.error = null;
    return interaction.update(renderBuilder(data));
  }

  return applyAddBinding(interaction, data, roleId, role);
}

/**
 * Attach a new emoji → role pair to an already published message.
 * Reacts first so a failed reaction never leaves a binding nothing can trigger.
 */
async function applyAddBinding(interaction, data, roleId, role) {
  const record = reactionRoleService.getById(data.messageRowId);
  if (!record) {
    return interaction.update({ content: '❌ Сообщение больше не отслеживается.', components: [] });
  }

  await interaction.deferUpdate();

  const { message, forgotten } = await resolveRecordMessage(interaction.client, record);
  if (!message) {
    return interaction.editReply({
      content: forgotten
        ? `❌ Сообщение **#${record.id}** удалено из канала — запись убрана. Создайте новое через \`/reactionrole create\`.`
        : '❌ Не удалось получить сообщение из канала. Проверьте права бота и попробуйте ещё раз.',
      components: [],
    });
  }

  const projected = reactionRoleService.renderContent(record.content, [
    ...reactionRoleService.getBindings(record.id),
    { emoji_display: data.pendingEmoji.emojiDisplay, role_id: roleId },
  ]);

  if (projected.length > MESSAGE_LIMIT) {
    return interaction.editReply({
      content: `❌ Сообщение вместе с подписью станет длиннее ${MESSAGE_LIMIT} символов — сократите текст сообщения.`,
      components: [],
    });
  }

  try {
    await message.react(data.pendingEmoji.emojiDisplay);
  } catch (err) {
    console.error(`Failed to react with ${data.pendingEmoji.emojiDisplay}:`, err.message);
    return interaction.editReply({
      content: `❌ Не удалось поставить реакцию ${data.pendingEmoji.emojiDisplay}. Проверьте права бота и доступность эмодзи.`,
      components: [],
    });
  }

  reactionRoleService.addBinding(record.id, {
    emoji: data.pendingEmoji.emoji,
    emojiDisplay: data.pendingEmoji.emojiDisplay,
    roleId,
  });

  await syncMessage(message, record);
  pendingBuilds.delete(interaction.user.id);

  await interaction.editReply({
    content: `✅ Реакция ${data.pendingEmoji.emojiDisplay} теперь выдаёт роль **${role.name}**.`,
    components: [],
  });
}

// ─── HELPERS ─────────────────────────────────────────────

/**
 * Fetch the published message. `missing` is true only when Discord confirmed the
 * message or its channel is gone — a transient failure (lost permission, network,
 * rate limit) leaves it false so a live record is never dropped by mistake.
 */
async function fetchRecordMessage(client, record) {
  try {
    const channel = await client.channels.fetch(record.channel_id);
    const message = await channel.messages.fetch(record.message_id);
    return { message, missing: false };
  } catch (err) {
    const missing = err.code === UNKNOWN_CHANNEL || err.code === UNKNOWN_MESSAGE;
    if (!missing) {
      console.error(`Failed to fetch reaction-role message #${record.id}:`, err.message);
    }
    return { message: null, missing };
  }
}

/**
 * Same, but forgets the record when the message is provably gone. This is the
 * lazy half of the cleanup: the delete listeners miss anything that happened
 * while the bot was offline, and this catches those on first use.
 */
async function resolveRecordMessage(client, record) {
  const { message, missing } = await fetchRecordMessage(client, record);

  if (missing) {
    reactionRoleService.remove(record.id);
    console.log(`Reaction-role message #${record.id} is gone — record dropped.`);
  }

  return { message, forgotten: missing };
}

/** Rewrite the published message so its legend matches the current bindings. */
async function syncMessage(message, record) {
  const bindings = reactionRoleService.getBindings(record.id);
  const content = reactionRoleService.renderContent(record.content, bindings);

  try {
    await message.edit({ content, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error(`Failed to refresh reaction-role message #${record.id}:`, err.message);
  }
}

// ─── INTERACTION HANDLERS ────────────────────────────────

async function handleModal(interaction) {
  const customId = interaction.customId;

  if (customId === 'reactionrole-create-modal') {
    return handleCreateModalSubmit(interaction);
  }

  if (customId === 'reactionrole-emoji-modal') {
    return handleEmojiModalSubmit(interaction);
  }
}

async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'reactionrole-build-addpair') {
    if (!pendingBuilds.has(interaction.user.id)) {
      return interaction.update({ content: EXPIRED, components: [] });
    }
    return interaction.showModal(emojiModal());
  }

  if (customId === 'reactionrole-build-back') {
    const data = pendingBuilds.get(interaction.user.id);
    if (!data || data.mode !== 'create') {
      pendingBuilds.delete(interaction.user.id);
      return interaction.update({ content: 'Отменено.', components: [] });
    }
    data.pendingEmoji = null;
    return interaction.update(renderBuilder(data));
  }

  if (customId === 'reactionrole-build-publish') {
    return handlePublish(interaction);
  }

  if (customId === 'reactionrole-build-cancel') {
    pendingBuilds.delete(interaction.user.id);
    return interaction.update({ content: 'Создание отменено.', components: [] });
  }

  if (customId.startsWith('reactionrole-delete-confirm:')) {
    return handleDeleteConfirm(interaction);
  }

  if (customId === 'reactionrole-delete-abort') {
    return interaction.update({ content: 'Отключение отменено.', components: [] });
  }
}

async function handleStringSelect(interaction) {
  const customId = interaction.customId;

  if (customId === 'reactionrole-build-droppair') {
    const data = pendingBuilds.get(interaction.user.id);
    if (!data || data.mode !== 'create') {
      return interaction.update({ content: EXPIRED, components: [] });
    }
    data.pairs = data.pairs.filter(p => p.emoji !== interaction.values[0]);
    data.error = null;
    return interaction.update(renderBuilder(data));
  }

  if (customId.startsWith('reactionrole-remove-pick:')) {
    return handleRemovePick(interaction);
  }
}

async function handleRoleSelect(interaction) {
  if (interaction.customId === 'reactionrole-build-role') {
    return handleRolePicked(interaction);
  }
}

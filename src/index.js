require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { getDb, close: closeDb } = require('./database/connection');
const { handleReactionAdd, handleReactionRemove } = require('./handlers/reactionHandler');
const { handleVoiceStateUpdate } = require('./handlers/voiceMoveHandler');
const { handleMention } = require('./handlers/mentionHandler');
const {
  handleMessageDelete,
  handleMessageDeleteBulk,
  handleChannelDelete,
} = require('./handlers/reactionRoleCleanupHandler');
const reminderService = require('./services/reminderService');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Maps an interaction to the handler a command module must export to receive it
function componentHandlerName(interaction) {
  if (interaction.isModalSubmit()) return 'handleModal';
  if (interaction.isButton()) return 'handleButton';
  if (interaction.isStringSelectMenu()) return 'handleStringSelect';
  if (interaction.isRoleSelectMenu()) return 'handleRoleSelect';
  if (interaction.isUserSelectMenu()) return 'handleUserSelect';
  if (interaction.isChannelSelectMenu()) return 'handleChannelSelect';
  return null;
}

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      return await command.execute(interaction);
    }

    // Components and modals: custom IDs are `<command>-<action>[:args]`, so the
    // prefix before the first dash names the command module that owns the handler
    const handlerName = componentHandlerName(interaction);
    if (!handlerName) return;

    const command = client.commands.get(interaction.customId.split('-')[0]);
    const handler = command?.[handlerName];
    if (!handler) return;

    return await handler(interaction);
  } catch (error) {
    console.error('Interaction error:', error);

    const reply = { content: 'Произошла ошибка.', flags: 64 };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {}
  }
});

// Reactions
client.on('messageReactionAdd', (reaction, user) => handleReactionAdd(reaction, user, client));
client.on('messageReactionRemove', (reaction, user) => handleReactionRemove(reaction, user, client));

// Forget reaction-role messages that no longer exist
client.on('messageDelete', (message) => handleMessageDelete(message));
client.on('messageDeleteBulk', (messages) => handleMessageDeleteBulk(messages));
client.on('channelDelete', (channel) => handleChannelDelete(channel));

// Mentions
client.on('messageCreate', (message) => handleMention(message, client));

// Voice moves
client.on('voiceStateUpdate', (oldState, newState) => handleVoiceStateUpdate(oldState, newState));

// Ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Initialize database
  getDb();
  console.log('Database initialized.');

  // Start reminders
  reminderService.start(client);
  console.log('Reminder service started.');
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  reminderService.stop();
  closeDb();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(process.env.DISCORD_TOKEN);

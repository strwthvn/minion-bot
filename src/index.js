require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { getDb, close: closeDb } = require('./database/connection');
const { handleReactionAdd, handleReactionRemove } = require('./handlers/reactionHandler');
const reminderService = require('./services/reminderService');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
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

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      return await command.execute(interaction);
    }

    // Route event-related interactions to the event command module
    const eventCommand = client.commands.get('event');
    if (!eventCommand) return;

    if (interaction.isModalSubmit() && interaction.customId.startsWith('event-')) {
      return await eventCommand.handleModal(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('event-')) {
      return await eventCommand.handleButton(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('event-')) {
      return await eventCommand.handleStringSelect(interaction);
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('event-')) {
      return await eventCommand.handleRoleSelect(interaction);
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('event-')) {
      return await eventCommand.handleUserSelect(interaction);
    }
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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run the bot
npm run dev        # Run with hot-reload (--watch)
npm run deploy     # Register slash commands with Discord API
docker-compose up  # Run in Docker with hot-reload
```

After adding or modifying command definitions, run `npm run deploy` to update Discord's command registry.

## Architecture

Discord.js v14 bot with a modular slash command system.

- **`src/index.js`** — Entry point. Initializes the client, dynamically loads all command modules from `src/commands/`, and dispatches interactions.
- **`src/deploy-commands.js`** — Registers slash commands via Discord REST API. Uses guild-scoped deployment if `DISCORD_GUILD_ID` is set, otherwise global.
- **`src/commands/`** — Each `.js` file is auto-loaded as a command module.

### Command module contract

Every file in `src/commands/` must export:
```js
module.exports = {
  data: new SlashCommandBuilder()...  // command definition
  async execute(interaction) { ... }  // handler
};
```

## Environment

Config via `.env` (see `.env.example`): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` (optional).

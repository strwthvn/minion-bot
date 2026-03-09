# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Commands

```bash
npm start          # Run the bot
npm run dev        # Run with hot-reload (--watch)
npm run deploy     # Register slash commands with Discord API
docker compose up  # Run in Docker with hot-reload
```

After adding or modifying command definitions, run `npm run deploy` to update Discord's command registry.

## Architecture

Discord.js v14 bot with a modular slash command system.

- **`src/index.js`** — Entry point. Loads commands from `src/commands/`, routes interactions (commands, modals, buttons, select menus) to their handlers.
- **`src/deploy-commands.js`** — Registers slash commands via Discord REST API. Guild-scoped if `DISCORD_GUILD_ID` is set, otherwise global.
- **`src/commands/`** — Each `.js` file is auto-loaded as a command module.
- **`src/handlers/`** — Event handlers (reactions, voice state). Connected in `index.js`.
- **`src/services/`** — Business logic: DB operations, embed building, reminders. Commands should delegate logic here.
- **`src/database/connection.js`** — SQLite (better-sqlite3) setup, schema migrations. Tables: `events`, `participants`.
- **`src/utils/`** — Helpers (date parsing with MSK timezone).
- **`src/config.js`** — Channel IDs, colors, constants. Never hardcode IDs in logic — put them here.

### Command module contract

Every file in `src/commands/` must export:
```js
module.exports = {
  data: new SlashCommandBuilder()...  // command definition
  async execute(interaction) { ... }  // handler
};
```

Commands with complex interactions (modals, buttons, selects) also export handler functions: `handleModal`, `handleButton`, `handleStringSelect`, `handleRoleSelect`, `handleUserSelect`. These are routed by custom ID prefix in `index.js`.

## Key patterns

- **Dates** are stored as UTC in the database, displayed as MSK (UTC+3). Use `dateParser.js` for conversion.
- **Ephemeral replies** for errors: `interaction.reply({ content: '...', flags: 64 })`.
- **Participant queue**: when event has a limit, excess participants go to reserve. When a main participant leaves, the first reserve is auto-promoted (`participantService`).
- **Reminders**: `reminderService` checks every 60s, sends notifications at 24h/1h/5min before event, auto-completes past events.
- **Graceful shutdown**: `index.js` handles SIGINT/SIGTERM — stops reminders, closes DB, destroys client.

## Environment

Config via `.env` (see `.env.example`): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` (optional).

## Deploy

Push to `master` triggers GitHub Actions (`.github/workflows/deploy.yml`): SSH into server, pull, `docker compose up -d --build`.

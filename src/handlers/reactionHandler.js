const { EVENTS_CHANNEL_ID } = require('../config');
const eventService = require('../services/eventService');
const participantService = require('../services/participantService');
const embedService = require('../services/embedService');

async function ensureFull(reaction, user) {
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  if (user.partial) await user.fetch();
}

async function handleReactionAdd(reaction, user, client) {
  try {
    await ensureFull(reaction, user);
  } catch {
    return;
  }

  if (user.bot) return;
  if (reaction.message.channel.id !== EVENTS_CHANNEL_ID) return;

  const event = eventService.getByMessageId(reaction.message.id);
  if (!event || event.status !== 'active') return;

  const reactions = JSON.parse(event.reactions);
  const emoji = reaction.emoji.name;

  if (!reactions.includes(emoji)) {
    await reaction.users.remove(user.id).catch(() => {});
    return;
  }

  // ❌ means "not attending" — don't record as participant, but remove any existing signup
  if (emoji === '❌') {
    const promoted = participantService.remove(event.id, user.id);
    if (promoted) {
      // Notify promoted user
      const channel = reaction.message.channel;
      await channel.send(`<@${promoted}> перемещён из очереди в основной состав ивента **${event.name}**!`).catch(() => {});
    }

    // Remove any other reactions this user had
    for (const r of reactions) {
      if (r === '❌') continue;
      const msgReaction = reaction.message.reactions.cache.get(r);
      if (msgReaction) {
        await msgReaction.users.remove(user.id).catch(() => {});
      }
    }

    const participants = participantService.getAll(event.id);
    await embedService.update(reaction.message.channel, event, participants);
    return;
  }

  // Enforce single positive reaction: remove other positive reactions
  for (const r of reactions) {
    if (r === emoji || r === '❌') continue;
    const msgReaction = reaction.message.reactions.cache.get(r);
    if (msgReaction) {
      await msgReaction.users.remove(user.id).catch(() => {});
    }
  }
  // Also remove ❌ if they had it
  const declineReaction = reaction.message.reactions.cache.get('❌');
  if (declineReaction) {
    await declineReaction.users.remove(user.id).catch(() => {});
  }

  participantService.add(event.id, user.id, emoji);

  const participants = participantService.getAll(event.id);
  await embedService.update(reaction.message.channel, event, participants);
}

async function handleReactionRemove(reaction, user, client) {
  try {
    await ensureFull(reaction, user);
  } catch {
    return;
  }

  if (user.bot) return;
  if (reaction.message.channel.id !== EVENTS_CHANNEL_ID) return;

  const event = eventService.getByMessageId(reaction.message.id);
  if (!event || event.status !== 'active') return;

  const reactions = JSON.parse(event.reactions);
  const emoji = reaction.emoji.name;

  if (!reactions.includes(emoji)) return;
  if (emoji === '❌') return; // Removing ❌ doesn't change participant list

  // Only remove if their current recorded reaction matches the one being removed
  const existing = require('../database/connection').getDb().prepare(
    'SELECT reaction FROM participants WHERE event_id = ? AND user_id = ?',
  ).get(event.id, user.id);
  if (!existing || existing.reaction !== emoji) return;

  const promoted = participantService.remove(event.id, user.id);

  if (promoted) {
    const channel = reaction.message.channel;
    await channel.send(`<@${promoted}> перемещён из очереди в основной состав ивента **${event.name}**!`).catch(() => {});
  }

  const participants = participantService.getAll(event.id);
  await embedService.update(reaction.message.channel, event, participants);
}

module.exports = { handleReactionAdd, handleReactionRemove };

const reactionRoleService = require('../services/reactionRoleService');

const AUDIT_REASON = 'Роль по реакции';

/**
 * Resolve a reaction to its binding. Returns null when the message
 * is not a reaction-role dispenser or the emoji is not bound to a role.
 */
function resolveBinding(reaction) {
  if (!reaction.message.guild) return null;

  // Custom emoji are matched by snowflake, unicode ones by the character itself
  const emojiKey = reaction.emoji.id ?? reaction.emoji.name;
  return reactionRoleService.findBinding(reaction.message.id, emojiKey) || null;
}

/**
 * Grant the bound role. Called with an already-fetched reaction and user.
 */
async function handleAdd(reaction, user) {
  const binding = resolveBinding(reaction);
  if (!binding) return;

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member || member.roles.cache.has(binding.role_id)) return;

  try {
    await member.roles.add(binding.role_id, AUDIT_REASON);
  } catch (err) {
    console.error(`Failed to grant role ${binding.role_id} to ${user.id}:`, err.message);
  }
}

/**
 * Take the bound role back once the reaction is gone.
 */
async function handleRemove(reaction, user) {
  const binding = resolveBinding(reaction);
  if (!binding) return;

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member || !member.roles.cache.has(binding.role_id)) return;

  try {
    await member.roles.remove(binding.role_id, AUDIT_REASON);
  } catch (err) {
    console.error(`Failed to revoke role ${binding.role_id} from ${user.id}:`, err.message);
  }
}

module.exports = { handleAdd, handleRemove };

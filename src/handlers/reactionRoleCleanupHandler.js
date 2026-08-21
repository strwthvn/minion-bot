const reactionRoleService = require('../services/reactionRoleService');

/**
 * Drops reaction-role records whose message is gone. Without this a deleted
 * dispenser lingers in the DB forever and keeps showing up in /reactionrole list,
 * even though nothing can react to it any more.
 *
 * Discord fires a different event for each way a message can disappear, and none
 * of them covers the others — hence three handlers.
 */

/** A single message was deleted. Partials are enough here: only the id matters. */
function handleMessageDelete(message) {
  const removed = reactionRoleService.removeByMessageId(message.id);
  if (removed > 0) {
    console.log(`Reaction-role message ${message.id} was deleted — record dropped.`);
  }
}

/** A bulk purge sends this instead of one messageDelete per message. */
function handleMessageDeleteBulk(messages) {
  const removed = reactionRoleService.removeByMessageIds([...messages.keys()]);
  if (removed > 0) {
    console.log(`Bulk delete dropped ${removed} reaction-role record(s).`);
  }
}

/** Deleting a channel does not emit messageDelete for the messages inside it. */
function handleChannelDelete(channel) {
  const removed = reactionRoleService.removeByChannel(channel.id);
  if (removed > 0) {
    console.log(`Channel ${channel.id} was deleted — dropped ${removed} reaction-role record(s).`);
  }
}

module.exports = { handleMessageDelete, handleMessageDeleteBulk, handleChannelDelete };

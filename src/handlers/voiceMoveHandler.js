const { AuditLogEvent } = require('discord.js');
const { MOVE_TARGET_VOICE_CHANNEL_ID, MOVE_LOG_TEXT_CHANNEL_ID } = require('../config');

const AUDIT_LOG_DELAY_MS = 1000;
const AUDIT_LOG_MAX_AGE_MS = 5000;

async function handleVoiceStateUpdate(oldState, newState) {
  try {
    // Ignore mute/deafen/etc — only care about channel changes
    if (oldState.channelId === newState.channelId) return;

    // Only track moves into the target voice channel
    if (newState.channelId !== MOVE_TARGET_VOICE_CHANNEL_ID) return;

    // Ignore bots
    if (newState.member?.user?.bot) return;

    // Wait for audit log to be written
    await new Promise(resolve => setTimeout(resolve, AUDIT_LOG_DELAY_MS));

    const guild = newState.guild;
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberMove,
      limit: 5,
    });

    const now = Date.now();
    const moveEntry = logs.entries.find(entry => {
      const age = now - entry.createdTimestamp;
      if (age > AUDIT_LOG_MAX_AGE_MS) return false;
      if (entry.extra?.channel?.id !== MOVE_TARGET_VOICE_CHANNEL_ID) return false;
      if (entry.executorId === newState.id) return false;
      return true;
    });

    if (!moveEntry) return;

    const logChannel = await guild.channels.fetch(MOVE_LOG_TEXT_CHANNEL_ID);
    if (!logChannel) return;

    const targetChannelName = newState.channel?.name ?? 'неизвестный канал';

    await logChannel.send(
      `<@${moveEntry.executorId}> отправил <@${newState.id}> в ${targetChannelName}`,
    );
  } catch (error) {
    console.error('Voice move handler error:', error);
  }
}

module.exports = { handleVoiceStateUpdate };

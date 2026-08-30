// meelarp — server logs ("Record" in MEE6 terms)
import { Events, AuditLogEvent, ChannelType } from 'discord.js';
import { getSettings } from '../../db.js';
import { brandEmbed, safeChannel, truncate, logError, absTime } from '../util.js';

const COLORS = {
  create: 0x27e0a4, delete: 0xff4d6d, update: 0x5b6bff, join: 0x27e0a4,
  leave: 0xff8a3d, ban: 0xff4d6d, voice: 0x9b7bff,
};

function target(guild, eventKey) {
  const settings = getSettings(guild.id);
  if (!settings.modules.logs) return null;
  if (!settings.logs.events?.[eventKey]) return null;
  const id = settings.logs.perEventChannels?.[eventKey] ?? settings.logs.channelId;
  return safeChannel(guild, id);
}

function ignored(guild, channelId) {
  const settings = getSettings(guild.id);
  return channelId ? (settings.logs.ignoredChannels ?? []).includes(channelId) : false;
}

async function post(guild, eventKey, embed) {
  const ch = target(guild, eventKey);
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch((e) => logError('logs:send', e));
}

/** Look up who performed an action (best effort). */
async function executor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(
      (e) => (!targetId || e.target?.id === targetId) && Date.now() - e.createdTimestamp < 8000);
    return entry?.executor ?? null;
  } catch { return null; }
}

export function registerLogging(client) {
  // --- messages -----------------------------------------------------------
  client.on(Events.MessageDelete, async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;
      if (ignored(message.guild, message.channel.id)) return;
      const who = await executor(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
      await post(message.guild, 'messageDelete', brandEmbed({
        color: COLORS.delete,
        title: 'Message deleted',
        description: truncate(message.content || '*no text content*', 1800),
        fields: [
          { name: 'Author', value: message.author ? `<@${message.author.id}>` : 'Unknown', inline: true },
          { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
          ...(who && who.id !== message.author?.id ? [{ name: 'Deleted by', value: `<@${who.id}>`, inline: true }] : []),
          ...(message.attachments?.size
            ? [{ name: 'Attachments', value: [...message.attachments.values()].map((a) => a.name).join(', ').slice(0, 1000) }]
            : []),
        ],
        footer: `Message ID: ${message.id}`,
        timestamp: true,
      }));
    } catch (e) { logError('logs:messageDelete', e); }
  });

  client.on(Events.MessageBulkDelete, async (messages) => {
    try {
      const first = messages.first();
      if (!first?.guild) return;
      await post(first.guild, 'messageBulkDelete', brandEmbed({
        color: COLORS.delete,
        title: 'Messages bulk deleted',
        description: `**${messages.size}** messages were removed from <#${first.channel.id}>.`,
        timestamp: true,
      }));
    } catch (e) { logError('logs:bulkDelete', e); }
  });

  client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    try {
      if (!newMsg.guild || newMsg.author?.bot) return;
      if (oldMsg.content === newMsg.content) return;
      if (ignored(newMsg.guild, newMsg.channel.id)) return;
      await post(newMsg.guild, 'messageEdit', brandEmbed({
        color: COLORS.update,
        title: 'Message edited',
        description: `[Jump to message](${newMsg.url})`,
        fields: [
          { name: 'Before', value: truncate(oldMsg.content || '*unknown (not cached)*', 1000) },
          { name: 'After', value: truncate(newMsg.content || '*empty*', 1000) },
          { name: 'Author', value: `<@${newMsg.author.id}>`, inline: true },
          { name: 'Channel', value: `<#${newMsg.channel.id}>`, inline: true },
        ],
        timestamp: true,
      }));
    } catch (e) { logError('logs:messageUpdate', e); }
  });

  // --- members ------------------------------------------------------------
  client.on(Events.GuildMemberAdd, async (member) => {
    const age = Date.now() - member.user.createdTimestamp;
    await post(member.guild, 'memberJoin', brandEmbed({
      color: COLORS.join,
      title: 'Member joined',
      description: `<@${member.id}> \`${member.user.tag}\``,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      fields: [
        { name: 'Account created', value: absTime(member.user.createdTimestamp), inline: true },
        { name: 'Member count', value: String(member.guild.memberCount), inline: true },
        ...(age < 7 * 86400000 ? [{ name: '⚠ New account', value: `Created ${Math.floor(age / 86400000)}d ago` }] : []),
      ],
      footer: `User ID: ${member.id}`,
      timestamp: true,
    }));
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const roles = member.roles?.cache.filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`) ?? [];
    await post(member.guild, 'memberLeave', brandEmbed({
      color: COLORS.leave,
      title: 'Member left',
      description: `<@${member.id}> \`${member.user.tag}\``,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      fields: [
        { name: 'Joined', value: member.joinedTimestamp ? absTime(member.joinedTimestamp) : 'Unknown', inline: true },
        { name: 'Member count', value: String(member.guild.memberCount), inline: true },
        ...(roles.length ? [{ name: 'Roles', value: truncate(roles.join(' '), 1000) }] : []),
      ],
      footer: `User ID: ${member.id}`,
      timestamp: true,
    }));
  });

  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    try {
      const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id));
      const removed = oldM.roles.cache.filter((r) => !newM.roles.cache.has(r.id));
      if (added.size || removed.size) {
        await post(newM.guild, 'memberUpdate', brandEmbed({
          color: COLORS.update,
          title: 'Member roles updated',
          description: `<@${newM.id}> \`${newM.user.tag}\``,
          fields: [
            ...(added.size ? [{ name: 'Added', value: added.map((r) => `<@&${r.id}>`).join(' ').slice(0, 1000) }] : []),
            ...(removed.size ? [{ name: 'Removed', value: removed.map((r) => `<@&${r.id}>`).join(' ').slice(0, 1000) }] : []),
          ],
          timestamp: true,
        }));
      }
      if (oldM.nickname !== newM.nickname) {
        await post(newM.guild, 'memberUpdate', brandEmbed({
          color: COLORS.update,
          title: 'Nickname changed',
          description: `<@${newM.id}>`,
          fields: [
            { name: 'Before', value: oldM.nickname ?? '*none*', inline: true },
            { name: 'After', value: newM.nickname ?? '*none*', inline: true },
          ],
          timestamp: true,
        }));
      }
      if (!oldM.communicationDisabledUntilTimestamp && newM.communicationDisabledUntilTimestamp) {
        await post(newM.guild, 'memberUpdate', brandEmbed({
          color: COLORS.ban,
          title: 'Member timed out',
          description: `<@${newM.id}> until ${absTime(newM.communicationDisabledUntilTimestamp)}`,
          timestamp: true,
        }));
      }
    } catch (e) { logError('logs:memberUpdate', e); }
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    const who = await executor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await post(ban.guild, 'memberBanned', brandEmbed({
      color: COLORS.ban,
      title: 'Member banned',
      description: `<@${ban.user.id}> \`${ban.user.tag}\``,
      fields: [
        ...(who ? [{ name: 'By', value: `<@${who.id}>`, inline: true }] : []),
        { name: 'Reason', value: truncate(ban.reason || 'No reason given', 1000) },
      ],
      footer: `User ID: ${ban.user.id}`,
      timestamp: true,
    }));
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    await post(ban.guild, 'memberUnbanned', brandEmbed({
      color: COLORS.create,
      title: 'Member unbanned',
      description: `<@${ban.user.id}> \`${ban.user.tag}\``,
      timestamp: true,
    }));
  });

  // --- roles & channels ---------------------------------------------------
  client.on(Events.GuildRoleCreate, async (role) => {
    await post(role.guild, 'roleCreate', brandEmbed({
      color: COLORS.create, title: 'Role created',
      description: `<@&${role.id}> \`${role.name}\``, timestamp: true }));
  });
  client.on(Events.GuildRoleDelete, async (role) => {
    await post(role.guild, 'roleDelete', brandEmbed({
      color: COLORS.delete, title: 'Role deleted',
      description: `\`${role.name}\` (${role.id})`, timestamp: true }));
  });
  client.on(Events.GuildRoleUpdate, async (oldR, newR) => {
    const changes = [];
    if (oldR.name !== newR.name) changes.push(`Name: \`${oldR.name}\` → \`${newR.name}\``);
    if (oldR.hexColor !== newR.hexColor) changes.push(`Color: ${oldR.hexColor} → ${newR.hexColor}`);
    if (oldR.permissions.bitfield !== newR.permissions.bitfield) changes.push('Permissions changed');
    if (!changes.length) return;
    await post(newR.guild, 'roleUpdate', brandEmbed({
      color: COLORS.update, title: 'Role updated',
      description: `<@&${newR.id}>\n${changes.join('\n')}`, timestamp: true }));
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    await post(channel.guild, 'channelCreate', brandEmbed({
      color: COLORS.create, title: 'Channel created',
      description: `<#${channel.id}> \`${channel.name}\``, timestamp: true }));
  });
  client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    await post(channel.guild, 'channelDelete', brandEmbed({
      color: COLORS.delete, title: 'Channel deleted',
      description: `\`${channel.name}\` (${channel.id})`, timestamp: true }));
  });
  client.on(Events.ChannelUpdate, async (oldC, newC) => {
    if (!newC.guild) return;
    const changes = [];
    if (oldC.name !== newC.name) changes.push(`Name: \`${oldC.name}\` → \`${newC.name}\``);
    if (oldC.topic !== newC.topic) changes.push('Topic changed');
    if (oldC.rateLimitPerUser !== newC.rateLimitPerUser) {
      changes.push(`Slowmode: ${oldC.rateLimitPerUser ?? 0}s → ${newC.rateLimitPerUser ?? 0}s`);
    }
    if (!changes.length) return;
    await post(newC.guild, 'channelUpdate', brandEmbed({
      color: COLORS.update, title: 'Channel updated',
      description: `<#${newC.id}>\n${changes.join('\n')}`, timestamp: true }));
  });

  client.on(Events.ThreadCreate, async (thread) => {
    if (!thread.guild) return;
    await post(thread.guild, 'threadCreate', brandEmbed({
      color: COLORS.create, title: 'Thread created',
      description: `<#${thread.id}> in <#${thread.parentId}>`, timestamp: true }));
  });

  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild) return;
    await post(invite.guild, 'inviteCreate', brandEmbed({
      color: COLORS.create, title: 'Invite created',
      description: `\`${invite.code}\` by <@${invite.inviterId}> for <#${invite.channelId}>`,
      fields: [{ name: 'Max uses', value: String(invite.maxUses || 'unlimited'), inline: true }],
      timestamp: true }));
  });

  // --- voice --------------------------------------------------------------
  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    const guild = newS.guild ?? oldS.guild;
    if (!guild) return;
    if (!oldS.channelId && newS.channelId) {
      await post(guild, 'voiceJoin', brandEmbed({
        color: COLORS.voice, title: 'Voice joined',
        description: `<@${newS.id}> joined <#${newS.channelId}>`, timestamp: true }));
    } else if (oldS.channelId && !newS.channelId) {
      await post(guild, 'voiceLeave', brandEmbed({
        color: COLORS.voice, title: 'Voice left',
        description: `<@${oldS.id}> left <#${oldS.channelId}>`, timestamp: true }));
    } else if (oldS.channelId !== newS.channelId) {
      await post(guild, 'voiceMove', brandEmbed({
        color: COLORS.voice, title: 'Voice moved',
        description: `<@${newS.id}>: <#${oldS.channelId}> → <#${newS.channelId}>`, timestamp: true }));
    }
  });
}

export { ChannelType };

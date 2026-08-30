// meelarp — moderation actions, case log, temp-action expiry
import { PermissionFlagsBits } from 'discord.js';
import { db, getSettings, nextCaseNo, now } from '../../db.js';
import { brandEmbed, formatDuration, safeChannel, logError, truncate } from '../util.js';

const CASE_STYLE = {
  warn:    { color: 0xffb020, verb: 'warned',      icon: '⚠' },
  timeout: { color: 0xff8a3d, verb: 'timed out',   icon: '⏳' },
  untimeout:{ color: 0x27e0a4, verb: 'untimed out', icon: '⏳' },
  mute:    { color: 0xff8a3d, verb: 'muted',       icon: '🔇' },
  unmute:  { color: 0x27e0a4, verb: 'unmuted',     icon: '🔊' },
  kick:    { color: 0xff6b6b, verb: 'kicked',      icon: '👢' },
  ban:     { color: 0xff4d6d, verb: 'banned',      icon: '🔨' },
  softban: { color: 0xff4d6d, verb: 'softbanned',  icon: '🧹' },
  unban:   { color: 0x27e0a4, verb: 'unbanned',    icon: '🕊' },
  purge:   { color: 0x5b6bff, verb: 'purged',      icon: '🧽' },
  note:    { color: 0x8b93a7, verb: 'noted',       icon: '📝' },
};

const qInsertCase = db.prepare(`
  INSERT INTO cases (guild_id, case_no, type, user_id, user_tag, mod_id, mod_tag, reason, duration, expires_at, active, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

export function createCase(guild, { type, user, moderator, reason, durationSec }) {
  const caseNo = nextCaseNo(guild.id);
  const expires = durationSec ? now() + durationSec * 1000 : null;
  const needsExpiry = ['ban', 'mute', 'timeout'].includes(type) && !!durationSec;
  qInsertCase.run(
    guild.id, caseNo, type, user.id, user.tag ?? user.username ?? null,
    moderator?.id ?? null, moderator?.tag ?? moderator?.username ?? null,
    reason ?? null, durationSec ?? null, expires, needsExpiry ? 1 : 0, now());
  return { caseNo, expires };
}

export function getCases(guildId, { userId = null, type = null, limit = 25, offset = 0 } = {}) {
  const where = ['guild_id = ?'];
  const args = [guildId];
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (type) { where.push('type = ?'); args.push(type); }
  return db.prepare(
    `SELECT * FROM cases WHERE ${where.join(' AND ')} ORDER BY case_no DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);
}

export function getCase(guildId, caseNo) {
  return db.prepare('SELECT * FROM cases WHERE guild_id = ? AND case_no = ?').get(guildId, caseNo);
}

export function deleteCase(guildId, caseNo) {
  return db.prepare('DELETE FROM cases WHERE guild_id = ? AND case_no = ?').run(guildId, caseNo).changes > 0;
}

export function editCaseReason(guildId, caseNo, reason) {
  return db.prepare('UPDATE cases SET reason = ? WHERE guild_id = ? AND case_no = ?')
    .run(reason, guildId, caseNo).changes > 0;
}

export function warnCount(guildId, userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'warn'")
    .get(guildId, userId).n;
}

export function clearWarnings(guildId, userId) {
  return db.prepare("DELETE FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'warn'")
    .run(guildId, userId).changes;
}

/** Post a case to the mod-log channel. */
export async function postModLog(guild, { caseNo, type, user, moderator, reason, durationSec, extra }) {
  const settings = getSettings(guild.id);
  const ch = safeChannel(guild, settings.moderation.modLogChannel);
  if (!ch) return;
  const style = CASE_STYLE[type] ?? { color: 0x5b6bff, verb: type, icon: '•' };
  const fields = [
    { name: 'Member', value: `<@${user.id}>\n\`${user.tag ?? user.username ?? user.id}\``, inline: true },
    { name: 'Moderator', value: moderator ? `<@${moderator.id}>` : 'meelarp (automatic)', inline: true },
  ];
  if (durationSec) fields.push({ name: 'Duration', value: formatDuration(durationSec), inline: true });
  if (extra) fields.push({ name: 'Details', value: truncate(extra, 1024), inline: false });
  fields.push({ name: 'Reason', value: truncate(reason || 'No reason given', 1024), inline: false });

  const embed = brandEmbed({
    color: style.color,
    title: `${style.icon}  Case #${caseNo} — ${type}`,
    fields,
    footer: `User ID: ${user.id}`,
    timestamp: true,
  });
  await ch.send({ embeds: [embed] }).catch((e) => logError('modlog', e));
}

/** DM the target about an action (best effort). */
export async function notifyTarget(guild, user, { type, reason, durationSec, caseNo }) {
  const settings = getSettings(guild.id);
  if (!settings.moderation.dmOnAction) return false;
  const style = CASE_STYLE[type] ?? { color: 0x5b6bff, verb: type };
  const embed = brandEmbed({
    color: style.color,
    title: `You were ${style.verb} in ${guild.name}`,
    description: reason ? `**Reason:** ${truncate(reason, 1000)}` : 'No reason was given.',
    fields: durationSec ? [{ name: 'Duration', value: formatDuration(durationSec) }] : undefined,
    footer: caseNo ? `Case #${caseNo}` : undefined,
    timestamp: true,
  });
  try { await user.send({ embeds: [embed] }); return true; } catch { return false; }
}

/**
 * Full pipeline: perform the Discord action, record a case, DM, and mod-log.
 * `action` is one of warn | timeout | untimeout | mute | unmute | kick | ban | softban | unban | note
 */
export async function punish(guild, { action, target, targetUser, moderator, reason, durationSec, deleteDays = 0 }) {
  const settings = getSettings(guild.id);
  const user = targetUser ?? target?.user;
  if (!user) throw new Error('No target user');
  const reasonLine = `${moderator ? `${moderator.tag ?? moderator.username}` : 'meelarp'}: ${reason || 'No reason given'}`;

  const { caseNo } = createCase(guild, { type: action, user, moderator, reason, durationSec });

  // DM before removal actions so it can still be delivered
  if (['ban', 'kick', 'softban', 'warn', 'timeout', 'mute'].includes(action)) {
    await notifyTarget(guild, user, { type: action, reason, durationSec, caseNo });
  }

  switch (action) {
    case 'warn':
      break;
    case 'timeout': {
      const ms = Math.min((durationSec ?? 600) * 1000, 28 * 24 * 3600 * 1000);
      await target.timeout(ms, reasonLine);
      break;
    }
    case 'untimeout':
      await target.timeout(null, reasonLine);
      break;
    case 'mute': {
      const roleId = settings.moderation.muteRoleId;
      if (roleId) await target.roles.add(roleId, reasonLine);
      else await target.timeout(Math.min((durationSec ?? 600) * 1000, 28 * 24 * 3600 * 1000), reasonLine);
      break;
    }
    case 'unmute': {
      const roleId = settings.moderation.muteRoleId;
      if (roleId && target.roles.cache.has(roleId)) await target.roles.remove(roleId, reasonLine);
      if (target.communicationDisabledUntilTimestamp) await target.timeout(null, reasonLine);
      break;
    }
    case 'kick':
      await target.kick(reasonLine);
      break;
    case 'ban':
      await guild.bans.create(user.id, { reason: reasonLine, deleteMessageSeconds: deleteDays * 86400 });
      break;
    case 'softban':
      await guild.bans.create(user.id, { reason: reasonLine, deleteMessageSeconds: (deleteDays || 1) * 86400 });
      await guild.bans.remove(user.id, 'meelarp: softban (unban)');
      break;
    case 'unban':
      await guild.bans.remove(user.id, reasonLine);
      break;
    case 'note':
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  await postModLog(guild, { caseNo, type: action, user, moderator, reason, durationSec });

  if (action === 'warn') await checkWarnThresholds(guild, target, user, moderator);
  return caseNo;
}

/** Auto-escalate once a member crosses a configured warn count. */
export async function checkWarnThresholds(guild, member, user, moderator) {
  const settings = getSettings(guild.id);
  const thresholds = settings.moderation.warnThresholds ?? [];
  if (!thresholds.length || !member) return;
  const count = warnCount(guild.id, user.id);
  const hit = thresholds.filter((t) => Number(t.warns) === count).sort((a, b) => b.warns - a.warns)[0];
  if (!hit) return;
  const reason = `Automatic: reached ${count} warning${count === 1 ? '' : 's'}`;
  try {
    await punish(guild, {
      action: hit.action,
      target: member,
      targetUser: user,
      moderator: null,
      reason,
      durationSec: hit.duration ? Number(hit.duration) : undefined,
    });
  } catch (e) { logError('warn-threshold', e); }
}

// --- expiry sweeper (temp bans / temp mutes) ------------------------------
export async function sweepExpired(client) {
  const rows = db.prepare(
    'SELECT * FROM cases WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?').all(now());
  for (const row of rows) {
    db.prepare('UPDATE cases SET active = 0 WHERE id = ?').run(row.id);
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;
    try {
      if (row.type === 'ban') {
        await guild.bans.remove(row.user_id, 'meelarp: temporary ban expired').catch(() => {});
        const user = { id: row.user_id, tag: row.user_tag };
        const { caseNo } = createCase(guild, {
          type: 'unban', user, moderator: null, reason: 'Temporary ban expired' });
        await postModLog(guild, {
          caseNo, type: 'unban', user, moderator: null, reason: 'Temporary ban expired' });
      } else if (row.type === 'mute') {
        const settings = getSettings(guild.id);
        const member = await guild.members.fetch(row.user_id).catch(() => null);
        if (member && settings.moderation.muteRoleId) {
          await member.roles.remove(settings.moderation.muteRoleId, 'meelarp: temporary mute expired').catch(() => {});
        }
      }
    } catch (e) { logError('sweep', e); }
  }
}

/** Bulk delete with filters, mirroring MEE6's /clear options. */
export async function purge(channel, { limit, filter = {}, moderator }) {
  const fetched = await channel.messages.fetch({ limit: Math.min(100, limit + 25) });
  let msgs = [...fetched.values()];
  if (filter.userId) msgs = msgs.filter((m) => m.author.id === filter.userId);
  if (filter.contains) msgs = msgs.filter((m) => m.content.toLowerCase().includes(filter.contains.toLowerCase()));
  if (filter.bots) msgs = msgs.filter((m) => m.author.bot);
  if (filter.humans) msgs = msgs.filter((m) => !m.author.bot);
  if (filter.attachments) msgs = msgs.filter((m) => m.attachments.size > 0);
  if (filter.embeds) msgs = msgs.filter((m) => m.embeds.length > 0);
  if (filter.links) msgs = msgs.filter((m) => /https?:\/\//i.test(m.content));
  if (filter.invites) msgs = msgs.filter((m) => /discord(?:app)?\.(?:gg|com\/invite)\//i.test(m.content));

  const twoWeeks = Date.now() - 13.5 * 24 * 3600 * 1000;
  msgs = msgs.filter((m) => m.createdTimestamp > twoWeeks && !m.pinned).slice(0, limit);
  if (!msgs.length) return 0;
  const deleted = await channel.bulkDelete(msgs, true);
  return deleted.size;
}

export function memberIsMuted(member, settings) {
  if (settings.moderation.muteRoleId) return member.roles.cache.has(settings.moderation.muteRoleId);
  return !!member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now();
}

export function botCan(guild, perm) {
  return guild.members.me?.permissions.has(PermissionFlagsBits[perm]) ?? false;
}

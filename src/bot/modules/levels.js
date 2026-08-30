// meelarp — leveling / XP engine
import { db, getSettings, bumpStat } from '../../db.js';
import { applyPlaceholders, randInt, safeChannel, logError } from '../util.js';

// --- curves ---------------------------------------------------------------
/** XP required to advance FROM `level` to `level + 1`. */
export function xpForLevel(level, curve = 'mee6') {
  switch (curve) {
    case 'linear': return 100 * (level + 1);
    case 'fast':   return 3 * level * level + 40 * level + 80;
    case 'slow':   return 8 * level * level + 75 * level + 150;
    case 'mee6':
    default:       return 5 * level * level + 50 * level + 100;
  }
}

export function totalXpFor(level, curve = 'mee6') {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i, curve);
  return total;
}

export function levelFromXp(xp, curve = 'mee6') {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForLevel(level, curve)) {
    remaining -= xpForLevel(level, curve);
    level++;
    if (level > 1000) break;
  }
  return { level, into: remaining, needed: xpForLevel(level, curve) };
}

// --- queries --------------------------------------------------------------
const qGet = db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?');
const qUpsert = db.prepare(`
  INSERT INTO levels (guild_id, user_id, xp, level, messages, voice_minutes, last_xp, username, avatar)
  VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    xp = excluded.xp, level = excluded.level, messages = excluded.messages,
    last_xp = excluded.last_xp, username = excluded.username, avatar = excluded.avatar`);
const qSetXp = db.prepare('UPDATE levels SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?');
const qRank = db.prepare('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ? AND xp > ?');
const qTop = db.prepare('SELECT * FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?');
const qCount = db.prepare('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ?');

export function getMemberLevel(guildId, userId) {
  const row = qGet.get(guildId, userId) ?? { guild_id: guildId, user_id: userId, xp: 0, level: 0, messages: 0, voice_minutes: 0, last_xp: 0 };
  const curve = getSettings(guildId).levels.curve;
  const prog = levelFromXp(row.xp, curve);
  const rank = qRank.get(guildId, row.xp).n + 1;
  return { ...row, ...prog, rank };
}

export function leaderboard(guildId, { limit = 10, offset = 0 } = {}) {
  const curve = getSettings(guildId).levels.curve;
  const rows = qTop.all(guildId, limit, offset);
  return {
    total: qCount.get(guildId).n,
    rows: rows.map((r, i) => ({ ...r, rank: offset + i + 1, ...levelFromXp(r.xp, curve) })),
  };
}

export function setXp(guildId, userId, xp) {
  const curve = getSettings(guildId).levels.curve;
  const level = levelFromXp(Math.max(0, xp), curve).level;
  const existing = qGet.get(guildId, userId);
  if (existing) qSetXp.run(Math.max(0, xp), level, guildId, userId);
  else qUpsert.run(guildId, userId, Math.max(0, xp), level, 0, 0, null, null);
  return { xp: Math.max(0, xp), level };
}

export function addXpRaw(guildId, userId, amount) {
  const cur = qGet.get(guildId, userId);
  return setXp(guildId, userId, (cur?.xp ?? 0) + amount);
}

export function resetGuildLevels(guildId) {
  db.prepare('DELETE FROM levels WHERE guild_id = ?').run(guildId);
}
export function resetMemberLevel(guildId, userId) {
  db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

// --- xp gain --------------------------------------------------------------
function multiplierFor(member, channelId, settings) {
  let factor = 1;
  for (const m of settings.levels.multipliers ?? []) {
    if (m.type === 'channel' && m.id === channelId) factor *= Number(m.factor) || 1;
    if (m.type === 'role' && member.roles.cache.has(m.id)) factor *= Number(m.factor) || 1;
  }
  return factor;
}

export function isXpBlocked(member, channel, settings) {
  const L = settings.levels;
  if (L.noXpChannels?.includes(channel.id)) return true;
  if (channel.parentId && L.noXpChannels?.includes(channel.parentId)) return true;
  if (L.noXpRoles?.some((r) => member.roles.cache.has(r))) return true;
  return false;
}

/** Handles a message for XP. Returns { leveledUp, level } or null. */
export async function handleMessageXp(message) {
  const settings = getSettings(message.guild.id);
  if (!settings.modules.levels) return null;
  const member = message.member;
  if (!member || member.user.bot) return null;
  if (isXpBlocked(member, message.channel, settings)) return null;

  const L = settings.levels;
  const row = qGet.get(message.guild.id, member.id);
  const nowMs = Date.now();
  if (row && nowMs - row.last_xp < (L.cooldownSeconds ?? 60) * 1000) {
    // still count the message for stats/activity
    db.prepare('UPDATE levels SET messages = messages + 1, username = ?, avatar = ? WHERE guild_id = ? AND user_id = ?')
      .run(member.user.username, member.user.displayAvatarURL({ extension: 'png', size: 128 }), message.guild.id, member.id);
    return null;
  }

  const [min, max] = Array.isArray(L.xpPerMessage) ? L.xpPerMessage : [15, 25];
  const gain = Math.round(randInt(min, max) * multiplierFor(member, message.channel.id, settings));
  const prevXp = row?.xp ?? 0;
  const prevLevel = levelFromXp(prevXp, L.curve).level;
  const newXp = prevXp + gain;
  const newLevel = levelFromXp(newXp, L.curve).level;

  qUpsert.run(
    message.guild.id, member.id, newXp, newLevel, (row?.messages ?? 0) + 1, nowMs,
    member.user.username, member.user.displayAvatarURL({ extension: 'png', size: 128 }));

  if (newLevel > prevLevel) {
    const rewarded = await applyRoleRewards(member, newLevel, settings).catch((e) => logError('levels:rewards', e));
    await announceLevelUp(message, member, newLevel, settings, !!rewarded?.length);
    return { leveledUp: true, level: newLevel, rewards: rewarded ?? [] };
  }
  return { leveledUp: false, level: newLevel };
}

export async function applyRoleRewards(member, level, settings) {
  const L = settings.levels;
  const rewards = (L.roleRewards ?? []).slice().sort((a, b) => a.level - b.level);
  if (!rewards.length) return [];
  const earned = rewards.filter((r) => level >= r.level);
  if (!earned.length) return [];
  const granted = [];

  if (L.stackRoles) {
    for (const r of earned) {
      if (!member.roles.cache.has(r.roleId) && member.guild.roles.cache.has(r.roleId)) {
        await member.roles.add(r.roleId, `meelarp: reached level ${r.level}`).catch(() => {});
        granted.push(r.roleId);
      }
    }
  } else {
    const top = earned[earned.length - 1];
    const toRemove = rewards.filter((r) => r.roleId !== top.roleId && member.roles.cache.has(r.roleId)).map((r) => r.roleId);
    if (toRemove.length) await member.roles.remove(toRemove, 'meelarp: level role replaced').catch(() => {});
    if (!member.roles.cache.has(top.roleId) && member.guild.roles.cache.has(top.roleId)) {
      await member.roles.add(top.roleId, `meelarp: reached level ${top.level}`).catch(() => {});
      granted.push(top.roleId);
    }
  }
  return granted;
}

async function announceLevelUp(message, member, level, settings, gotReward) {
  const L = settings.levels;
  if (L.announce === 'none') return;
  if (L.announceOnlyOnReward && !gotReward) return;

  const text = applyPlaceholders(L.announceMessage, {
    user: member.user, member, guild: member.guild, channel: message.channel,
    extra: { level, xp: getMemberLevel(member.guild.id, member.id).xp },
  });

  try {
    if (L.announce === 'dm') {
      await member.send({ content: `${text}\n*in **${member.guild.name}***` }).catch(() => {});
    } else if (L.announce === 'current') {
      await message.channel.send({ content: text, allowedMentions: { users: [member.id] } });
    } else {
      const ch = safeChannel(member.guild, L.announceChannel) ?? message.channel;
      await ch.send({ content: text, allowedMentions: { users: [member.id] } });
    }
  } catch (e) { logError('levels:announce', e); }
}

// --- voice XP -------------------------------------------------------------
const voiceSince = new Map(); // `${guildId}:${userId}` -> ms

export function voiceJoined(guildId, userId) {
  voiceSince.set(`${guildId}:${userId}`, Date.now());
}

export function voiceLeft(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const since = voiceSince.get(key);
  voiceSince.delete(key);
  if (!since) return 0;
  const minutes = Math.floor((Date.now() - since) / 60000);
  if (minutes <= 0) return 0;
  const settings = getSettings(guildId);
  db.prepare(`INSERT INTO levels (guild_id, user_id, xp, level, messages, voice_minutes, last_xp)
    VALUES (?, ?, 0, 0, 0, ?, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET voice_minutes = voice_minutes + ?`)
    .run(guildId, userId, minutes, minutes);
  if (settings.modules.levels && settings.levels.voiceXp?.enabled) {
    addXpRaw(guildId, userId, minutes * (settings.levels.voiceXp.perMinute ?? 5));
  }
  return minutes;
}

export function trackMessageStat(guildId) {
  bumpStat(guildId, 'messages');
}

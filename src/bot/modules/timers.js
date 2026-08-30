// meelarp — scheduled/recurring messages (MEE6 "Timers", premium there)
import { db, getSettings, jsonCol, now } from '../../db.js';
import { applyPlaceholders, buildEmbedFrom, safeChannel, logError } from '../util.js';

const hydrate = (row) => ({ ...row, embed: jsonCol(row.embed, null) });

export function listTimers(guildId) {
  return db.prepare('SELECT * FROM timers WHERE guild_id = ? ORDER BY id DESC').all(guildId).map(hydrate);
}

export function createTimer(guildId, data) {
  const interval = Math.max(60, Number(data.intervalSec) || 3600);
  const info = db.prepare(`INSERT INTO timers (guild_id, channel_id, name, message, embed, interval_sec, next_run, enabled, delete_previous, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    guildId, data.channelId, data.name ?? 'Timer', data.message ?? '',
    data.embed ? JSON.stringify(data.embed) : null, interval,
    now() + (Number(data.startInSec ?? interval) * 1000), data.enabled === false ? 0 : 1,
    data.deletePrevious ? 1 : 0, now());
  return hydrate(db.prepare('SELECT * FROM timers WHERE id = ?').get(Number(info.lastInsertRowid)));
}

export function updateTimer(id, data) {
  const t = db.prepare('SELECT * FROM timers WHERE id = ?').get(id);
  if (!t) return null;
  const interval = data.intervalSec !== undefined ? Math.max(60, Number(data.intervalSec)) : t.interval_sec;
  db.prepare(`UPDATE timers SET channel_id = ?, name = ?, message = ?, embed = ?, interval_sec = ?,
    enabled = ?, delete_previous = ?, next_run = ? WHERE id = ?`).run(
    data.channelId ?? t.channel_id, data.name ?? t.name, data.message ?? t.message,
    data.embed !== undefined ? (data.embed ? JSON.stringify(data.embed) : null) : t.embed,
    interval, data.enabled === undefined ? t.enabled : (data.enabled ? 1 : 0),
    data.deletePrevious === undefined ? t.delete_previous : (data.deletePrevious ? 1 : 0),
    data.intervalSec !== undefined ? now() + interval * 1000 : t.next_run, id);
  return hydrate(db.prepare('SELECT * FROM timers WHERE id = ?').get(id));
}

export function deleteTimer(id) {
  return db.prepare('DELETE FROM timers WHERE id = ?').run(id).changes > 0;
}

export async function runTimer(client, row) {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return;
  const settings = getSettings(guild.id);
  if (!settings.modules.timers) return;
  const channel = safeChannel(guild, row.channel_id);
  if (!channel) return;

  const ctx = { guild, channel };
  const payload = {};
  if (row.message) payload.content = applyPlaceholders(row.message, ctx).slice(0, 2000);
  const embed = buildEmbedFrom(jsonCol(row.embed, null), ctx);
  if (embed) payload.embeds = [embed];
  if (!payload.content && !payload.embeds) return;

  if (row.delete_previous && row.last_message_id) {
    await channel.messages.delete(row.last_message_id).catch(() => {});
  }
  const sent = await channel.send(payload).catch((e) => { logError('timers:send', e); return null; });
  db.prepare('UPDATE timers SET last_message_id = ? WHERE id = ?').run(sent?.id ?? null, row.id);
}

export async function tickTimers(client) {
  const due = db.prepare('SELECT * FROM timers WHERE enabled = 1 AND next_run <= ?').all(now());
  for (const row of due) {
    db.prepare('UPDATE timers SET next_run = ? WHERE id = ?').run(now() + row.interval_sec * 1000, row.id);
    await runTimer(client, row).catch((e) => logError('timers:tick', e));
  }
}

// --- one-off reminders (/remind) -----------------------------------------
export function addReminder({ userId, guildId, channelId, text, remindAt }) {
  const info = db.prepare(
    'INSERT INTO reminders (user_id, guild_id, channel_id, text, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, guildId, channelId, text, remindAt, now());
  return Number(info.lastInsertRowid);
}

export function listReminders(userId) {
  return db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at').all(userId);
}

export function deleteReminder(id, userId) {
  return db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export async function tickReminders(client) {
  const due = db.prepare('SELECT * FROM reminders WHERE remind_at <= ?').all(now());
  for (const r of due) {
    db.prepare('DELETE FROM reminders WHERE id = ?').run(r.id);
    try {
      const user = await client.users.fetch(r.user_id).catch(() => null);
      const content = `⏰ **Reminder:** ${r.text}`;
      const channel = r.channel_id ? await client.channels.fetch(r.channel_id).catch(() => null) : null;
      if (channel?.isTextBased()) {
        await channel.send({ content: `<@${r.user_id}> ${content}`, allowedMentions: { users: [r.user_id] } });
      } else if (user) {
        await user.send({ content }).catch(() => {});
      }
    } catch (e) { logError('reminders', e); }
  }
}

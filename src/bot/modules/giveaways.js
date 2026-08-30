// meelarp — giveaways with entry requirements
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { db, getSettings, jsonCol, now } from '../../db.js';
import { brandEmbed, safeChannel, logError, relTime, formatDuration } from '../util.js';
import { getMemberLevel } from './levels.js';

const hydrate = (g) => ({ ...g, requirements: jsonCol(g.requirements, {}), winners: jsonCol(g.winners, []) });

export function listGiveaways(guildId, { activeOnly = false } = {}) {
  const rows = activeOnly
    ? db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at').all(guildId)
    : db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY id DESC LIMIT 50').all(guildId);
  return rows.map(hydrate);
}

export function getGiveaway(id) {
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
  return g ? hydrate(g) : null;
}

export function entryCount(id) {
  return db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(id).n;
}

function buildEmbed(g, entries) {
  const req = g.requirements ?? {};
  const reqLines = [];
  if (req.roles?.length) reqLines.push(`Must have: ${req.roles.map((r) => `<@&${r}>`).join(' or ')}`);
  if (req.level) reqLines.push(`Must be level **${req.level}+**`);
  if (req.accountAgeDays) reqLines.push(`Account older than **${req.accountAgeDays} days**`);
  if (req.messages) reqLines.push(`At least **${req.messages}** messages sent`);

  return brandEmbed({
    color: g.ended ? 0x4b5162 : 0x5b6bff,
    title: `🎉  ${g.prize}`,
    description: [
      g.ended ? 'This giveaway has ended.' : `Ends ${relTime(g.ends_at)}`,
      `Winners: **${g.winner_count}**`,
      `Hosted by <@${g.host_id}>`,
      reqLines.length ? `\n**Requirements**\n${reqLines.map((l) => `• ${l}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    footer: `${entries} entr${entries === 1 ? 'y' : 'ies'} · meelarp`,
    timestamp: true,
  });
}

function buildRow(g, entries, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw:enter:${g.id}`)
      .setLabel(disabled ? 'Giveaway ended' : `Enter (${entries})`)
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled));
}

export async function startGiveaway(guild, { channelId, prize, winners, durationSec, hostId, requirements }) {
  const channel = safeChannel(guild, channelId);
  if (!channel) return { ok: false, error: 'I cannot post in that channel.' };
  const endsAt = now() + durationSec * 1000;
  const info = db.prepare(`INSERT INTO giveaways (guild_id, channel_id, message_id, prize, winner_count, ends_at, host_id, requirements, ended, winners, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, '[]', ?)`).run(
    guild.id, channelId, prize, Math.max(1, winners), endsAt, hostId,
    JSON.stringify(requirements ?? {}), now());
  const g = getGiveaway(Number(info.lastInsertRowid));

  const msg = await channel.send({ embeds: [buildEmbed(g, 0)], components: [buildRow(g, 0)] })
    .catch((e) => { logError('giveaway:start', e); return null; });
  if (!msg) { db.prepare('DELETE FROM giveaways WHERE id = ?').run(g.id); return { ok: false, error: 'Failed to post.' }; }
  db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(msg.id, g.id);
  return { ok: true, giveaway: { ...g, message_id: msg.id }, url: msg.url };
}

function meetsRequirements(member, g) {
  const req = g.requirements ?? {};
  if (req.roles?.length && !req.roles.some((r) => member.roles.cache.has(r))) {
    return `You need one of these roles: ${req.roles.map((r) => `<@&${r}>`).join(', ')}`;
  }
  if (req.level) {
    const lvl = getMemberLevel(member.guild.id, member.id);
    if (lvl.level < Number(req.level)) return `You need to be level ${req.level} or higher (you are ${lvl.level}).`;
  }
  if (req.messages) {
    const lvl = getMemberLevel(member.guild.id, member.id);
    if ((lvl.messages ?? 0) < Number(req.messages)) return `You need at least ${req.messages} messages in this server.`;
  }
  if (req.accountAgeDays) {
    const days = (Date.now() - member.user.createdTimestamp) / 86400000;
    if (days < Number(req.accountAgeDays)) return `Your account must be at least ${req.accountAgeDays} days old.`;
  }
  return null;
}

export async function handleGiveawayButton(interaction) {
  if (!interaction.customId.startsWith('gw:enter:')) return false;
  const id = Number(interaction.customId.split(':')[2]);
  const g = getGiveaway(id);
  if (!g || g.ended) {
    await interaction.reply({ content: 'This giveaway is over.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const already = db.prepare('SELECT 1 AS x FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
    .get(id, interaction.user.id);
  if (already) {
    db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, interaction.user.id);
    await interaction.reply({ content: 'Your entry has been withdrawn.', flags: MessageFlags.Ephemeral });
  } else {
    const problem = meetsRequirements(interaction.member, g);
    if (problem) {
      await interaction.reply({ content: `You cannot enter yet — ${problem}`, flags: MessageFlags.Ephemeral });
      return true;
    }
    db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id, entered_at) VALUES (?, ?, ?)')
      .run(id, interaction.user.id, now());
    await interaction.reply({ content: `You are entered for **${g.prize}**. Good luck!`, flags: MessageFlags.Ephemeral });
  }

  const entries = entryCount(id);
  await interaction.message.edit({ embeds: [buildEmbed(g, entries)], components: [buildRow(g, entries)] }).catch(() => {});
  return true;
}

function pickWinners(id, count, exclude = []) {
  const rows = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id)
    .map((r) => r.user_id).filter((u) => !exclude.includes(u));
  const winners = [];
  for (let i = 0; i < count && rows.length; i++) {
    winners.push(...rows.splice(Math.floor(Math.random() * rows.length), 1));
  }
  return winners;
}

export async function endGiveaway(client, id, { reroll = false } = {}) {
  const g = getGiveaway(id);
  if (!g) return { ok: false, error: 'Giveaway not found.' };
  const guild = client.guilds.cache.get(g.guild_id);
  if (!guild) return { ok: false, error: 'Guild unavailable.' };
  const channel = safeChannel(guild, g.channel_id);

  const winners = pickWinners(id, g.winner_count, reroll ? g.winners : []);
  db.prepare('UPDATE giveaways SET ended = 1, winners = ? WHERE id = ?')
    .run(JSON.stringify(reroll ? [...g.winners, ...winners] : winners), id);

  if (channel) {
    const entries = entryCount(id);
    const msg = g.message_id ? await channel.messages.fetch(g.message_id).catch(() => null) : null;
    if (msg) {
      await msg.edit({
        embeds: [buildEmbed({ ...g, ended: 1 }, entries)],
        components: [buildRow(g, entries, true)],
      }).catch(() => {});
    }
    const mention = winners.length ? winners.map((w) => `<@${w}>`).join(', ') : null;
    await channel.send({
      content: mention
        ? `🎉 ${reroll ? 'New winner' : 'Congratulations'} ${mention} — you won **${g.prize}**!`
        : `No valid entries for **${g.prize}**, so there is no winner.`,
      reply: msg ? { messageReference: msg.id, failIfNotExists: false } : undefined,
      allowedMentions: { users: winners },
    }).catch(() => {});
  }
  return { ok: true, winners };
}

export function deleteGiveaway(id) {
  db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ?').run(id);
  return db.prepare('DELETE FROM giveaways WHERE id = ?').run(id).changes > 0;
}

export async function tickGiveaways(client) {
  const due = db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(now());
  for (const g of due) {
    await endGiveaway(client, g.id).catch((e) => logError('giveaway:end', e));
  }
}

export { formatDuration };

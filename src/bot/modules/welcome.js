// meelarp — welcome / goodbye / boost messages, autorole, sticky roles
import { AttachmentBuilder } from 'discord.js';
import { db, getSettings, bumpStat } from '../../db.js';
import { applyPlaceholders, buildEmbedFrom, safeChannel, logError, sleep } from '../util.js';
import { renderWelcomeCard, canvasAvailable } from '../rankcard.js';

const qSaveSticky = db.prepare(`
  INSERT INTO sticky_roles (guild_id, user_id, roles, saved_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET roles = excluded.roles, saved_at = excluded.saved_at`);
const qGetSticky = db.prepare('SELECT * FROM sticky_roles WHERE guild_id = ? AND user_id = ?');

export async function handleMemberJoin(member) {
  const settings = getSettings(member.guild.id);
  bumpStat(member.guild.id, 'joins');

  // --- sticky roles (restore what they had) -------------------------------
  if (settings.welcome.stickyRoles) {
    const row = qGetSticky.get(member.guild.id, member.id);
    if (row) {
      let roles = [];
      try { roles = JSON.parse(row.roles); } catch {}
      const restorable = roles.filter((id) => {
        const role = member.guild.roles.cache.get(id);
        return role && role.editable && !role.managed;
      });
      if (restorable.length) await member.roles.add(restorable, 'meelarp: sticky roles restored').catch(() => {});
    }
  }

  // --- autorole -----------------------------------------------------------
  const ar = settings.welcome.autorole;
  if (ar?.enabled) {
    const roles = member.user.bot ? (ar.botRoles?.length ? ar.botRoles : []) : (ar.roles ?? []);
    if (roles.length) {
      const apply = async () => {
        const usable = roles.filter((id) => {
          const role = member.guild.roles.cache.get(id);
          return role && role.editable && !role.managed;
        });
        if (usable.length) await member.roles.add(usable, 'meelarp: autorole').catch((e) => logError('autorole', e));
      };
      if (ar.delaySeconds > 0) setTimeout(() => { apply(); }, ar.delaySeconds * 1000);
      else await apply();
    }
  }

  if (!settings.modules.welcome) return;

  // --- welcome DM ---------------------------------------------------------
  if (settings.welcome.dm?.enabled && !member.user.bot) {
    const ctx = { user: member.user, member, guild: member.guild };
    const payload = {};
    if (settings.welcome.dm.message) payload.content = applyPlaceholders(settings.welcome.dm.message, ctx);
    const embed = buildEmbedFrom(settings.welcome.dm.embed, ctx);
    if (embed) payload.embeds = [embed];
    if (payload.content || payload.embeds) await member.send(payload).catch(() => {});
  }

  // --- welcome message ----------------------------------------------------
  const join = settings.welcome.join;
  if (!join?.enabled) return;
  const channel = safeChannel(member.guild, join.channelId);
  if (!channel) return;

  const ctx = { user: member.user, member, guild: member.guild, channel };
  const payload = { allowedMentions: { users: [member.id], parse: ['users'] } };
  if (join.message) payload.content = applyPlaceholders(join.message, ctx);
  const embed = buildEmbedFrom(join.embed, ctx);
  if (embed) payload.embeds = [embed];

  if (join.image?.enabled && canvasAvailable()) {
    try {
      const png = await renderWelcomeCard({
        username: member.user.username,
        avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
        guildName: member.guild.name,
        memberCount: member.guild.memberCount,
        title: join.image.title ? applyPlaceholders(join.image.title, ctx) : undefined,
        subtitle: join.image.subtitle ? applyPlaceholders(join.image.subtitle, ctx) : undefined,
      }, { background: join.image.background, accent: join.image.accent });
      if (png) payload.files = [new AttachmentBuilder(png, { name: 'welcome.png' })];
    } catch (e) { logError('welcome:image', e); }
  }

  if (!payload.content && !payload.embeds && !payload.files) return;
  const sent = await channel.send(payload).catch((e) => logError('welcome:send', e));
  if (sent && join.deleteAfter > 0) {
    setTimeout(() => sent.delete().catch(() => {}), join.deleteAfter * 1000);
  }
}

export async function handleMemberLeave(member) {
  const settings = getSettings(member.guild.id);
  bumpStat(member.guild.id, 'leaves');

  if (settings.welcome.stickyRoles && member.roles) {
    const roles = member.roles.cache
      .filter((r) => r.id !== member.guild.id && !r.managed)
      .map((r) => r.id);
    if (roles.length) qSaveSticky.run(member.guild.id, member.id, JSON.stringify(roles), Date.now());
  }

  if (settings.levels?.resetOnLeave) {
    db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(member.guild.id, member.id);
  }

  if (!settings.modules.welcome) return;
  const leave = settings.welcome.leave;
  if (!leave?.enabled) return;
  const channel = safeChannel(member.guild, leave.channelId);
  if (!channel) return;

  const ctx = { user: member.user, member, guild: member.guild, channel };
  const payload = { allowedMentions: { parse: [] } };
  if (leave.message) payload.content = applyPlaceholders(leave.message, ctx);
  const embed = buildEmbedFrom(leave.embed, ctx);
  if (embed) payload.embeds = [embed];
  if (!payload.content && !payload.embeds) return;
  await channel.send(payload).catch(() => {});
}

/** Fired from guildMemberUpdate when premiumSince flips on. */
export async function handleBoost(member) {
  const settings = getSettings(member.guild.id);
  if (!settings.modules.welcome) return;
  const boost = settings.welcome.boost;
  if (!boost?.enabled) return;
  const channel = safeChannel(member.guild, boost.channelId);
  if (!channel) return;
  const ctx = { user: member.user, member, guild: member.guild, channel };
  await channel.send({
    content: applyPlaceholders(boost.message, ctx),
    allowedMentions: { users: [member.id] },
  }).catch(() => {});
}

export async function testWelcome(guild, member, kind = 'join') {
  const settings = getSettings(guild.id);
  const cfg = kind === 'leave' ? settings.welcome.leave : settings.welcome.join;
  const channel = safeChannel(guild, cfg?.channelId);
  if (!channel) return { ok: false, error: 'No channel configured (or I cannot post there).' };
  if (kind === 'join') await handleMemberJoin(member);
  else await handleMemberLeave(member);
  return { ok: true };
}

export { sleep };

// meelarp — shared helpers for the bot side
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

export const BRAND = config.brand;

// --- durations ------------------------------------------------------------
const UNITS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  w: 604800, week: 604800, weeks: 604800,
  mo: 2592000, month: 2592000, months: 2592000,
  y: 31536000, year: 31536000, years: 31536000 };

/** "1h30m", "2 days", "45s" -> seconds (null when unparseable) */
export function parseDuration(input) {
  if (input === null || input === undefined) return null;
  const str = String(input).trim().toLowerCase();
  if (!str || str === 'perm' || str === 'permanent' || str === 'never') return null;
  let total = 0;
  let matched = false;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) {
    const mult = UNITS[m[2]];
    if (!mult) continue;
    total += parseFloat(m[1]) * mult;
    matched = true;
  }
  if (!matched && /^\d+$/.test(str)) return parseInt(str, 10);
  return matched ? Math.round(total) : null;
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return 'permanent';
  const parts = [];
  const units = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  let rest = Math.floor(seconds);
  for (const [label, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) { parts.push(`${n}${label}`); rest -= n * size; }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0s';
}

export const relTime = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
export const absTime = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;

// --- placeholders ---------------------------------------------------------
/**
 * Replaces {user:mention}, {server:name}, {level}, … in a template.
 * ctx: { user, member, guild, channel, extra:{} }
 */
export function applyPlaceholders(template, ctx = {}) {
  if (!template) return '';
  const { user, member, guild, channel, extra = {} } = ctx;
  const map = {
    'user:mention': user ? `<@${user.id}>` : '',
    'user:name': user?.username ?? '',
    'user:tag': user?.tag ?? user?.username ?? '',
    'user:id': user?.id ?? '',
    'user:avatar': user?.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? '',
    'user:nickname': member?.displayName ?? user?.username ?? '',
    'user:created': user ? `<t:${Math.floor(user.createdTimestamp / 1000)}:R>` : '',
    'user:joined': member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '',
    'server:name': guild?.name ?? '',
    'server:id': guild?.id ?? '',
    'server:membercount': guild ? String(guild.memberCount) : '',
    'server:members': guild ? String(guild.memberCount) : '',
    'server:icon': guild?.iconURL?.({ extension: 'png', size: 256 }) ?? '',
    'server:boosts': guild ? String(guild.premiumSubscriptionCount ?? 0) : '',
    'server:owner': guild?.ownerId ? `<@${guild.ownerId}>` : '',
    'channel:mention': channel ? `<#${channel.id}>` : '',
    'channel:name': channel?.name ?? '',
    'date': new Date().toLocaleDateString('en-GB'),
    'time': new Date().toLocaleTimeString('en-GB'),
    'timestamp': `<t:${Math.floor(Date.now() / 1000)}:f>`,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  };
  return String(template).replace(/\{([a-z0-9_:.]+)\}/gi, (whole, key) => {
    const k = key.toLowerCase();
    return k in map ? map[k] : whole;
  });
}

// --- embeds ---------------------------------------------------------------
export function brandEmbed(opts = {}) {
  const e = new EmbedBuilder().setColor(opts.color ?? BRAND.color);
  if (opts.title) e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  if (opts.footer) e.setFooter({ text: opts.footer, iconURL: opts.footerIcon });
  if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
  if (opts.image) e.setImage(opts.image);
  if (opts.author) e.setAuthor(opts.author);
  if (opts.fields) e.addFields(opts.fields);
  if (opts.timestamp) e.setTimestamp();
  return e;
}

export const ok = (text) => brandEmbed({ description: `✓ ${text}`, color: 0x27e0a4 });
export const warn = (text) => brandEmbed({ description: `⚠ ${text}`, color: 0xffb020 });
export const fail = (text) => brandEmbed({ description: `✗ ${text}`, color: 0xff4d6d });

/** Turn a dashboard-authored embed object into a real EmbedBuilder. */
export function buildEmbedFrom(data, ctx) {
  if (!data || typeof data !== 'object') return null;
  const e = new EmbedBuilder();
  const p = (v) => (v ? applyPlaceholders(v, ctx) : v);
  if (data.title) e.setTitle(p(data.title).slice(0, 256));
  if (data.description) e.setDescription(p(data.description).slice(0, 4096));
  if (data.url) e.setURL(data.url);
  e.setColor(typeof data.color === 'string' ? Number(data.color.replace('#', '0x')) : (data.color ?? BRAND.color));
  if (data.author?.name) {
    e.setAuthor({ name: p(data.author.name).slice(0, 256), iconURL: p(data.author.icon) || undefined,
      url: data.author.url || undefined });
  }
  if (data.footer?.text) e.setFooter({ text: p(data.footer.text).slice(0, 2048), iconURL: p(data.footer.icon) || undefined });
  if (data.thumbnail) e.setThumbnail(p(data.thumbnail));
  if (data.image) e.setImage(p(data.image));
  if (data.timestamp) e.setTimestamp();
  if (Array.isArray(data.fields)) {
    for (const f of data.fields.slice(0, 25)) {
      if (!f?.name || !f?.value) continue;
      e.addFields({ name: p(f.name).slice(0, 256), value: p(f.value).slice(0, 1024), inline: !!f.inline });
    }
  }
  return e;
}

// --- permissions ----------------------------------------------------------
export const MOD_PERMS = {
  ban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  manageMessages: PermissionFlagsBits.ManageMessages,
  manageRoles: PermissionFlagsBits.ManageRoles,
  manageGuild: PermissionFlagsBits.ManageGuild,
};

export function isManager(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.ManageGuild) || member?.id === member?.guild?.ownerId;
}

/** Can `mod` act on `target`? (role hierarchy + owner + protected roles) */
export function canActOn(mod, target, settings) {
  if (!target) return { ok: false, reason: 'Member not found in this server.' };
  if (target.id === mod.id) return { ok: false, reason: 'You cannot target yourself.' };
  if (target.id === target.guild.ownerId) return { ok: false, reason: 'You cannot target the server owner.' };
  if (mod.id !== mod.guild.ownerId && target.roles.highest.position >= mod.roles.highest.position) {
    return { ok: false, reason: 'That member has a role equal to or above yours.' };
  }
  const protectedRoles = settings?.moderation?.protectedRoles ?? [];
  if (protectedRoles.some((r) => target.roles.cache.has(r))) {
    return { ok: false, reason: 'That member holds a protected role.' };
  }
  const me = target.guild.members.me;
  if (me && target.roles.highest.position >= me.roles.highest.position) {
    return { ok: false, reason: 'My highest role is not above that member — move meelarp up in the role list.' };
  }
  return { ok: true };
}

// --- misc -----------------------------------------------------------------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) },
  (_, i) => arr.slice(i * size, i * size + size));
export const escapeMd = (s) => String(s).replace(/([*_`~\\|>])/g, '\\$1');
export const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

export function safeChannel(guild, id) {
  if (!id) return null;
  const ch = guild.channels.cache.get(id);
  if (!ch || !ch.isTextBased?.()) return null;
  const me = guild.members.me;
  if (me && !ch.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return null;
  return ch;
}

export function logError(scope, err) {
  console.error(`[meelarp:${scope}]`, err?.stack || err?.message || err);
}

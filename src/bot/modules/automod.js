// meelarp — automod rule engine
import { PermissionFlagsBits } from 'discord.js';
import { getSettings, bumpStat } from '../../db.js';
import { punish } from './moderation.js';
import { brandEmbed, safeChannel, logError, truncate } from '../util.js';

// Word presets are stored base64-encoded so the raw lists don't sit in plain
// source (they are filter data, not content the bot ever emits).
const PRESETS = {
  profanity: 'ZnVjayxzaGl0LGJpdGNoLGFzc2hvbGUsYmFzdGFyZCxkaWNraGVhZCxjdW50LHdob3JlLHNsdXQsbW90aGVyZnVja2VyLHdhbmtlcixwcmljayx0d2F0LGJvbGxvY2tzLGRvdWNoZWJhZyxqYWNrYXNzLGFyc2Vob2xl',
  slurs: 'bmlnZ2VyLG5pZ2dhLGZhZ2dvdCxmYWdnLHRyYW5ueSxyZXRhcmQsc3BpYyxjaGluaw==',
  sexual: 'cG9ybmh1Yixvbmx5ZmFucyxuc2Z3IHBpY3MsY3AsY2hpbGQgcG9ybg==',
};

const decodePreset = (name) => {
  const raw = PRESETS[name];
  if (!raw) return [];
  return Buffer.from(raw, 'base64').toString('utf8').split(',').map((s) => s.trim()).filter(Boolean);
};

export const presetNames = Object.keys(PRESETS);

// --- text normalization ---------------------------------------------------
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };

function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$!|+]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/([a-z0-9-_]+)/gi;
const LINK_RE = /https?:\/\/([^\s/$.?#]+\.[^\s]*)/gi;
const EMOJI_RE = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;
const ZALGO_RE = /[̀-ͯ҉]/g;

// --- per-user short-term buffers ------------------------------------------
const recent = new Map();   // `${g}:${u}` -> [{ t, content }]
const strikes = new Map();  // `${g}:${u}` -> [{ t }]

function pushRecent(key, content, windowMs = 15000) {
  const arr = recent.get(key) ?? [];
  const t = Date.now();
  arr.push({ t, content });
  const kept = arr.filter((e) => t - e.t < windowMs);
  recent.set(key, kept);
  return kept;
}

function addStrike(key, windowSec) {
  const arr = strikes.get(key) ?? [];
  const t = Date.now();
  arr.push({ t });
  const kept = arr.filter((e) => t - e.t < windowSec * 1000);
  strikes.set(key, kept);
  return kept.length;
}

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of recent) if (!v.length || t - v[v.length - 1].t > 60000) recent.delete(k);
  for (const [k, v] of strikes) if (!v.length || t - v[v.length - 1].t > 3600_000) strikes.delete(k);
}, 120_000).unref?.();

// --- rule checks ----------------------------------------------------------
function checkRules(message, settings) {
  const rules = settings.automod.rules;
  const content = message.content ?? '';
  const norm = normalize(content);
  const key = `${message.guild.id}:${message.author.id}`;

  if (rules.invites?.enabled) {
    const matches = [...content.matchAll(INVITE_RE)];
    const wl = rules.invites.whitelist ?? [];
    const bad = matches.filter((m) => !wl.includes(m[1]));
    if (bad.length) return { rule: 'invites', reason: 'Posted a Discord invite', config: rules.invites };
  }

  if (rules.links?.enabled) {
    const links = [...content.matchAll(LINK_RE)].map((m) => m[1].toLowerCase().replace(/^www\./, ''));
    if (links.length) {
      const list = (rules.links.list ?? []).map((d) => d.toLowerCase().replace(/^www\./, ''));
      const isBad = rules.links.mode === 'whitelist'
        ? links.some((l) => !list.some((d) => l === d || l.endsWith(`.${d}`)))
        : links.some((l) => list.some((d) => l === d || l.endsWith(`.${d}`))) || list.length === 0;
      if (isBad) return { rule: 'links', reason: 'Posted a disallowed link', config: rules.links };
    }
  }

  if (rules.words?.enabled) {
    const list = [
      ...(rules.words.list ?? []),
      ...(rules.words.presets ?? []).flatMap(decodePreset),
    ].map((w) => normalize(w)).filter(Boolean);
    const hay = rules.words.wildcard ? norm.replace(/\s/g, '') : norm;
    for (const word of list) {
      const needle = rules.words.wildcard ? word.replace(/\s/g, '') : word;
      const hit = rules.words.wildcard
        ? hay.includes(needle)
        : new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(hay);
      if (hit) return { rule: 'words', reason: 'Used a filtered word', config: rules.words };
    }
  }

  if (rules.mentions?.enabled) {
    const count = message.mentions.users.size + message.mentions.roles.size
      + (message.mentions.everyone ? 5 : 0);
    if (count >= (rules.mentions.limit ?? 5)) {
      return { rule: 'mentions', reason: `Mentioned ${count} users/roles at once`, config: rules.mentions };
    }
  }

  if (rules.caps?.enabled && content.length >= (rules.caps.minLength ?? 10)) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= (rules.caps.minLength ?? 10)) {
      const upper = letters.replace(/[^A-Z]/g, '').length;
      const pct = (upper / letters.length) * 100;
      if (pct >= (rules.caps.percent ?? 70)) {
        return { rule: 'caps', reason: `Message was ${Math.round(pct)}% caps`, config: rules.caps };
      }
    }
  }

  if (rules.emoji?.enabled) {
    const count = (content.match(EMOJI_RE) ?? []).length;
    if (count >= (rules.emoji.limit ?? 8)) {
      return { rule: 'emoji', reason: `Used ${count} emoji in one message`, config: rules.emoji };
    }
  }

  if (rules.zalgo?.enabled) {
    const marks = (content.match(ZALGO_RE) ?? []).length;
    if (marks > 8) return { rule: 'zalgo', reason: 'Zalgo / combining-character spam', config: rules.zalgo };
  }

  if (rules.newlines?.enabled) {
    const lines = (content.match(/\n/g) ?? []).length;
    if (lines >= (rules.newlines.limit ?? 12)) {
      return { rule: 'newlines', reason: `Message spanned ${lines + 1} lines`, config: rules.newlines };
    }
  }

  if (rules.attachments?.enabled && message.attachments.size >= (rules.attachments.limit ?? 5)) {
    return { rule: 'attachments', reason: `Sent ${message.attachments.size} attachments at once`, config: rules.attachments };
  }

  if (rules.spam?.enabled) {
    const windowMs = (rules.spam.seconds ?? 5) * 1000;
    const arr = pushRecent(key, content, Math.max(windowMs, 15000));
    const inWindow = arr.filter((e) => Date.now() - e.t < windowMs);
    if (inWindow.length >= (rules.spam.messages ?? 5)) {
      return { rule: 'spam', reason: `Sent ${inWindow.length} messages in ${rules.spam.seconds ?? 5}s`,
        config: rules.spam, bulk: inWindow.length };
    }
  } else {
    pushRecent(key, content);
  }

  if (rules.duplicates?.enabled && content.trim().length > 3) {
    const arr = recent.get(key) ?? [];
    const same = arr.filter((e) => normalize(e.content) === norm).length;
    if (same >= (rules.duplicates.count ?? 3)) {
      return { rule: 'duplicates', reason: `Repeated the same message ${same} times`, config: rules.duplicates };
    }
  }

  return null;
}

function exempt(message, settings) {
  const member = message.member;
  if (!member) return true;
  if (member.user.bot) return true;
  if (member.id === message.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (settings.automod.exemptChannels?.includes(message.channel.id)) return true;
  if (message.channel.parentId && settings.automod.exemptChannels?.includes(message.channel.parentId)) return true;
  if (settings.automod.exemptRoles?.some((r) => member.roles.cache.has(r))) return true;
  return false;
}

// --- entry point ----------------------------------------------------------
export async function runAutomod(message) {
  const settings = getSettings(message.guild.id);
  if (!settings.modules.automod) return false;
  if (exempt(message, settings)) return false;

  let hit;
  try { hit = checkRules(message, settings); } catch (e) { logError('automod:check', e); return false; }
  if (!hit) return false;

  const key = `${message.guild.id}:${message.author.id}`;
  let action = hit.config.action ?? 'delete';
  let duration = hit.config.duration;

  // escalation ladder overrides the per-rule action once strikes pile up
  const esc = settings.automod.escalation;
  if (esc?.enabled && esc.steps?.length) {
    const count = addStrike(key, esc.window ?? 3600);
    const step = esc.steps
      .filter((s) => count >= Number(s.strikes))
      .sort((a, b) => Number(b.strikes) - Number(a.strikes))[0];
    if (step) { action = step.action; duration = step.duration ?? duration; }
  }

  // delete the offending message(s)
  try {
    if (message.deletable) await message.delete();
    if (hit.rule === 'spam' && hit.bulk > 1 && message.channel.bulkDelete) {
      const fetched = await message.channel.messages.fetch({ limit: 25 }).catch(() => null);
      if (fetched) {
        const mine = [...fetched.values()]
          .filter((m) => m.author.id === message.author.id && Date.now() - m.createdTimestamp < 20000);
        if (mine.length > 1) await message.channel.bulkDelete(mine, true).catch(() => {});
      }
    }
  } catch (e) { /* message may already be gone */ }

  bumpStat(message.guild.id, 'automod');

  const reason = `Automod (${hit.rule}): ${hit.reason}`;
  try {
    if (action !== 'delete' && message.member) {
      await punish(message.guild, {
        action: action === 'mute' ? 'mute' : action,
        target: message.member,
        targetUser: message.author,
        moderator: null,
        reason,
        durationSec: ['timeout', 'mute', 'ban'].includes(action) ? Number(duration) || 300 : undefined,
      });
    }
  } catch (e) { logError('automod:punish', e); }

  await logAutomod(message, hit, action, reason);
  return true;
}

async function logAutomod(message, hit, action, reason) {
  const settings = getSettings(message.guild.id);
  const ch = safeChannel(message.guild, settings.automod.logChannel ?? settings.moderation.modLogChannel);
  if (!ch) return;
  const embed = brandEmbed({
    color: 0xffb020,
    title: `Automod — ${hit.rule}`,
    description: hit.reason,
    fields: [
      { name: 'Member', value: `<@${message.author.id}> \`${message.author.tag}\``, inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Action', value: action, inline: true },
      ...(message.content ? [{ name: 'Message', value: truncate(message.content, 1000) }] : []),
    ],
    footer: `User ID: ${message.author.id}`,
    timestamp: true,
  });
  await ch.send({ embeds: [embed] }).catch(() => {});
}

export function automodPreview(text, rulesConfig) {
  // used by the dashboard's filter tester
  const fake = {
    content: text,
    attachments: { size: 0 },
    mentions: { users: { size: 0 }, roles: { size: 0 }, everyone: false },
    guild: { id: 'preview' },
    author: { id: 'preview' },
    channel: { id: 'preview' },
  };
  try {
    return checkRules(fake, { automod: { rules: rulesConfig } });
  } catch { return null; }
}

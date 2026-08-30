// meelarp — custom commands (unlimited, embeds + actions included)
import { db, getSettings, jsonCol, now, bumpStat } from '../../db.js';
import { applyPlaceholders, buildEmbedFrom, logError } from '../util.js';

const cooldowns = new Map(); // `${guild}:${cmd}:${user}` -> ts

export function listCommands(guildId) {
  return db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name').all(guildId)
    .map(hydrate);
}

function hydrate(row) {
  return {
    ...row,
    aliases: jsonCol(row.aliases, []),
    embed: jsonCol(row.embed, null),
    actions: jsonCol(row.actions, {}),
    restrictions: jsonCol(row.restrictions, {}),
  };
}

export function getCommand(guildId, name) {
  const row = db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?').get(guildId, name.toLowerCase());
  return row ? hydrate(row) : null;
}

export function upsertCommand(guildId, data, author) {
  const name = String(data.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!name) throw new Error('Invalid command name');
  const existing = getCommand(guildId, name);
  if (existing) {
    db.prepare(`UPDATE custom_commands SET aliases = ?, response = ?, embed = ?, actions = ?,
      restrictions = ?, enabled = ? WHERE id = ?`).run(
      JSON.stringify(data.aliases ?? existing.aliases), data.response ?? existing.response,
      data.embed ? JSON.stringify(data.embed) : null, JSON.stringify(data.actions ?? existing.actions),
      JSON.stringify(data.restrictions ?? existing.restrictions),
      data.enabled === undefined ? existing.enabled : (data.enabled ? 1 : 0), existing.id);
    return getCommand(guildId, name);
  }
  db.prepare(`INSERT INTO custom_commands (guild_id, name, aliases, response, embed, actions, restrictions, enabled, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
    guildId, name, JSON.stringify(data.aliases ?? []), data.response ?? '',
    data.embed ? JSON.stringify(data.embed) : null, JSON.stringify(data.actions ?? {}),
    JSON.stringify(data.restrictions ?? {}), author?.id ?? null, now());
  return getCommand(guildId, name);
}

export function deleteCommand(guildId, name) {
  return db.prepare('DELETE FROM custom_commands WHERE guild_id = ? AND name = ?')
    .run(guildId, String(name).toLowerCase()).changes > 0;
}

function resolve(guildId, word) {
  const direct = getCommand(guildId, word);
  if (direct) return direct;
  for (const cmd of listCommands(guildId)) {
    if (cmd.aliases.map((a) => String(a).toLowerCase()).includes(word)) return cmd;
  }
  return null;
}

function allowed(cmd, message) {
  const r = cmd.restrictions ?? {};
  if (r.channels?.length && !r.channels.includes(message.channel.id)) return false;
  if (r.deniedChannels?.length && r.deniedChannels.includes(message.channel.id)) return false;
  if (r.roles?.length && !r.roles.some((role) => message.member?.roles.cache.has(role))) return false;
  if (r.deniedRoles?.length && r.deniedRoles.some((role) => message.member?.roles.cache.has(role))) return false;
  return true;
}

/** Returns true when a custom command handled the message. */
export async function handleCustomCommand(message) {
  const settings = getSettings(message.guild.id);
  if (!settings.modules.commands) return false;
  const prefix = settings.prefix || '!';
  if (!message.content.startsWith(prefix)) return false;

  const [rawName, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
  if (!rawName) return false;
  const cmd = resolve(message.guild.id, rawName.toLowerCase());
  if (!cmd || !cmd.enabled) return false;
  if (!allowed(cmd, message)) return false;

  const cdKey = `${message.guild.id}:${cmd.name}:${message.author.id}`;
  const cdSec = cmd.restrictions?.cooldown ?? settings.commands.cooldownSeconds ?? 3;
  const last = cooldowns.get(cdKey) ?? 0;
  if (Date.now() - last < cdSec * 1000) return true;
  cooldowns.set(cdKey, Date.now());

  const ctx = {
    user: message.author, member: message.member, guild: message.guild, channel: message.channel,
    extra: {
      args: args.join(' '),
      'args:1': args[0] ?? '', 'args:2': args[1] ?? '', 'args:3': args[2] ?? '',
      'mention:1': message.mentions.users.first() ? `<@${message.mentions.users.first().id}>` : '',
      'touser': message.mentions.users.first()?.username ?? message.author.username,
      'random:100': String(Math.floor(Math.random() * 100) + 1),
    },
  };

  const payload = { allowedMentions: { parse: ['users'] } };
  if (cmd.response) payload.content = applyPlaceholders(cmd.response, ctx).slice(0, 2000);
  const embed = buildEmbedFrom(cmd.embed, ctx);
  if (embed) payload.embeds = [embed];

  const actions = cmd.actions ?? {};
  try {
    if (actions.deleteTrigger || settings.commands.deleteTrigger) await message.delete().catch(() => {});
    if (actions.addRoles?.length && message.member) {
      await message.member.roles.add(actions.addRoles.filter((r) => message.guild.roles.cache.get(r)?.editable),
        `meelarp: custom command ${cmd.name}`).catch(() => {});
    }
    if (actions.removeRoles?.length && message.member) {
      await message.member.roles.remove(actions.removeRoles.filter((r) => message.guild.roles.cache.get(r)?.editable),
        `meelarp: custom command ${cmd.name}`).catch(() => {});
    }
    if (payload.content || payload.embeds) {
      if (actions.dm) await message.author.send(payload).catch(() => {});
      else {
        const target = actions.channelId ? message.guild.channels.cache.get(actions.channelId) : message.channel;
        const sent = await (target?.isTextBased() ? target : message.channel).send(payload);
        if (actions.deleteAfter > 0) setTimeout(() => sent.delete().catch(() => {}), actions.deleteAfter * 1000);
      }
    }
    if (actions.reactWith) await message.react(actions.reactWith).catch(() => {});
  } catch (e) { logError('customcmd', e); }

  db.prepare('UPDATE custom_commands SET uses = uses + 1 WHERE id = ?').run(cmd.id);
  bumpStat(message.guild.id, 'commands');
  return true;
}

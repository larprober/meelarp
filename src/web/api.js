// meelarp — dashboard JSON API
import { ChannelType } from 'discord.js';
import { config, DEFAULT_SETTINGS } from '../config.js';
import { db, getSettings, saveSettings, patchSettings, recentAudit, logAudit, statsRange, jsonCol } from '../db.js';
import { readSession, json, readBody, canManage } from './session.js';

import { leaderboard, setXp, resetMemberLevel, resetGuildLevels, totalXpFor } from '../bot/modules/levels.js';
import { getCases, deleteCase, editCaseReason } from '../bot/modules/moderation.js';
import { listCommands, upsertCommand, deleteCommand } from '../bot/modules/customcommands.js';
import { listMenus, createMenu, updateMenu, deleteMenu, publishMenu } from '../bot/modules/roles.js';
import { listTimers, createTimer, updateTimer, deleteTimer, runTimer } from '../bot/modules/timers.js';
import { listFeeds, createFeed, updateFeed, deleteFeed, testFeed } from '../bot/modules/feeds.js';
import { listGiveaways, startGiveaway, endGiveaway, deleteGiveaway, entryCount } from '../bot/modules/giveaways.js';
import { ticketsFor, sendPanel } from '../bot/modules/tickets.js';
import { automodPreview, presetNames } from '../bot/modules/automod.js';
import { counterTypes } from '../bot/modules/counters.js';
import { capabilities as musicCapabilities } from '../bot/modules/music.js';
import { handleMemberJoin } from '../bot/modules/welcome.js';

// --- auth -----------------------------------------------------------------
function auth(req, res) {
  const session = readSession(req);
  if (!session) { json(res, 401, { error: 'Not signed in' }); return null; }
  return session;
}

function guildAccess(req, res, guildId, botClient) {
  const session = auth(req, res);
  if (!session) return null;
  const entry = session.guilds.find((g) => g.id === guildId);
  if (!entry || !canManage(entry)) {
    json(res, 403, { error: 'You need Manage Server permission in that server.' });
    return null;
  }
  const guild = botClient?.guilds?.cache.get(guildId) ?? null;
  return { session, entry, guild };
}

// --- serializers ----------------------------------------------------------
function guildMeta(guild, entry) {
  if (!guild) {
    return { id: entry.id, name: entry.name, icon: entry.icon, botPresent: false,
      channels: [], categories: [], voiceChannels: [], roles: [], memberCount: 0, emojis: [] };
  }
  const textTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    botPresent: true,
    memberCount: guild.memberCount,
    boosts: guild.premiumSubscriptionCount ?? 0,
    ownerId: guild.ownerId,
    channels: guild.channels.cache.filter((c) => textTypes.includes(c.type))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null })),
    voiceChannels: guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice)
      .map((c) => ({ id: c.id, name: c.name })),
    categories: guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({ id: c.id, name: c.name })),
    roles: guild.roles.cache.filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position,
        managed: r.managed, assignable: r.editable })),
    emojis: guild.emojis.cache.map((e) => ({ id: e.id, name: e.name, animated: e.animated,
      tag: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` })),
    botRolePosition: guild.members.me?.roles.highest.position ?? 0,
  };
}

const avatarUrl = (u) => u.avatar
  ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
  : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(u.id) >> 22n) % 6}.png`;

// --- route table ----------------------------------------------------------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, regex, keys, handler });
};

// --- public ---------------------------------------------------------------
route('GET', '/api/health', async (ctx) => json(ctx.res, 200, { ok: true, uptime: process.uptime() }));

route('GET', '/api/stats', async ({ res, botClient }) => {
  const guilds = botClient?.guilds?.cache;
  json(res, 200, {
    ready: !!botClient?.isReady?.(),
    guilds: guilds?.size ?? 0,
    members: guilds ? guilds.reduce((n, g) => n + (g.memberCount ?? 0), 0) : 0,
    commands: botClient?.commands?.size ?? 0,
    inviteConfigured: !!config.clientId,
    music: musicCapabilities,
  });
});

route('GET', '/api/me', async ({ req, res, botClient }) => {
  const session = auth(req, res);
  if (!session) return;
  const manageable = session.guilds.filter(canManage).map((g) => ({
    ...g,
    botPresent: !!botClient?.guilds?.cache.has(g.id),
    memberCount: botClient?.guilds?.cache.get(g.id)?.memberCount ?? null,
  }));
  json(res, 200, {
    user: { ...session.user, avatarUrl: avatarUrl(session.user) },
    guilds: manageable.sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name)),
    inviteUrl: `${config.web.baseUrl}/invite`,
  });
});

route('GET', '/api/leaderboard/:guildId', async ({ res, params, url, botClient }) => {
  const settings = getSettings(params.guildId);
  if (!settings.levels.leaderboardPublic) return json(res, 403, { error: 'This leaderboard is private.' });
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const data = leaderboard(params.guildId, { limit: 25, offset: (page - 1) * 25 });
  const guild = botClient?.guilds?.cache.get(params.guildId);
  json(res, 200, {
    guild: guild ? { id: guild.id, name: guild.name, icon: guild.icon, memberCount: guild.memberCount } : null,
    page,
    ...data,
  });
});

// --- guild core -----------------------------------------------------------
route('GET', '/api/guild/:id', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, {
    meta: guildMeta(access.guild, access.entry),
    settings: getSettings(params.id),
    defaults: DEFAULT_SETTINGS,
    catalog: { automodPresets: presetNames, counterTypes, music: musicCapabilities },
  });
});

route('PATCH', '/api/guild/:id/settings', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const patch = await readBody(req);
  const settings = patchSettings(params.id, patch);
  logAudit(params.id, access.session.user, 'settings.update', Object.keys(patch).join(', '));
  json(res, 200, { settings });
});

route('PUT', '/api/guild/:id/settings', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const body = await readBody(req);
  const settings = saveSettings(params.id, body);
  logAudit(params.id, access.session.user, 'settings.replace', '');
  json(res, 200, { settings });
});

route('GET', '/api/guild/:id/overview', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const g = access.guild;
  json(res, 200, {
    stats: statsRange(params.id, 14),
    audit: recentAudit(params.id, 12),
    counts: {
      ranked: db.prepare('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ?').get(params.id).n,
      cases: db.prepare('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ?').get(params.id).n,
      commands: db.prepare('SELECT COUNT(*) AS n FROM custom_commands WHERE guild_id = ?').get(params.id).n,
      menus: db.prepare('SELECT COUNT(*) AS n FROM role_menus WHERE guild_id = ?').get(params.id).n,
      feeds: db.prepare('SELECT COUNT(*) AS n FROM feeds WHERE guild_id = ?').get(params.id).n,
      timers: db.prepare('SELECT COUNT(*) AS n FROM timers WHERE guild_id = ?').get(params.id).n,
      giveaways: db.prepare('SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND ended = 0').get(params.id).n,
      tickets: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND closed = 0').get(params.id).n,
    },
    guild: g ? { memberCount: g.memberCount, boosts: g.premiumSubscriptionCount ?? 0,
      channels: g.channels.cache.size, roles: g.roles.cache.size - 1 } : null,
  });
});

// --- levels ---------------------------------------------------------------
route('GET', '/api/guild/:id/levels', async ({ req, res, params, url, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  json(res, 200, { page, ...leaderboard(params.id, { limit: 50, offset: (page - 1) * 50 }) });
});

route('POST', '/api/guild/:id/levels', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const { userId, xp, level, action } = await readBody(req);
  if (action === 'resetAll') {
    resetGuildLevels(params.id);
    logAudit(params.id, access.session.user, 'levels.resetAll', '');
    return json(res, 200, { ok: true });
  }
  if (!userId) return json(res, 400, { error: 'userId is required' });
  if (action === 'reset') {
    resetMemberLevel(params.id, userId);
    logAudit(params.id, access.session.user, 'levels.reset', userId);
    return json(res, 200, { ok: true });
  }
  const target = level !== undefined
    ? totalXpFor(Number(level), getSettings(params.id).levels.curve)
    : Number(xp);
  const result = setXp(params.id, userId, target);
  logAudit(params.id, access.session.user, 'levels.set', `${userId} → ${target} XP`);
  json(res, 200, { ok: true, ...result });
});

// --- moderation cases -----------------------------------------------------
route('GET', '/api/guild/:id/cases', async ({ req, res, params, url, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, {
    cases: getCases(params.id, {
      userId: url.searchParams.get('user') ?? null,
      type: url.searchParams.get('type') ?? null,
      limit: Math.min(200, Number(url.searchParams.get('limit') ?? 50)),
      offset: Number(url.searchParams.get('offset') ?? 0),
    }),
    total: db.prepare('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ?').get(params.id).n,
  });
});

route('PATCH', '/api/guild/:id/cases/:no', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const { reason } = await readBody(req);
  const okEdit = editCaseReason(params.id, Number(params.no), reason);
  json(res, okEdit ? 200 : 404, okEdit ? { ok: true } : { error: 'Case not found' });
});

route('DELETE', '/api/guild/:id/cases/:no', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const gone = deleteCase(params.id, Number(params.no));
  logAudit(params.id, access.session.user, 'case.delete', `#${params.no}`);
  json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'Case not found' });
});

// --- custom commands ------------------------------------------------------
route('GET', '/api/guild/:id/commands', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, { commands: listCommands(params.id) });
});

route('POST', '/api/guild/:id/commands', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const body = await readBody(req);
  try {
    const cmd = upsertCommand(params.id, body, access.session.user);
    logAudit(params.id, access.session.user, 'command.save', cmd.name);
    json(res, 200, { command: cmd });
  } catch (e) { json(res, 400, { error: e.message }); }
});

route('DELETE', '/api/guild/:id/commands/:name', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const gone = deleteCommand(params.id, params.name);
  logAudit(params.id, access.session.user, 'command.delete', params.name);
  json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'Command not found' });
});

// --- role menus -----------------------------------------------------------
route('GET', '/api/guild/:id/rolemenus', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, { menus: listMenus(params.id) });
});

route('POST', '/api/guild/:id/rolemenus', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const body = await readBody(req);
  const menu = body.id ? updateMenu(Number(body.id), body) : createMenu(params.id, body);
  if (!menu) return json(res, 404, { error: 'Menu not found' });
  let published = null;
  if (body.publish && access.guild) published = await publishMenu(access.guild, menu.id);
  logAudit(params.id, access.session.user, 'rolemenu.save', menu.title ?? String(menu.id));
  json(res, 200, { menu, published });
});

route('POST', '/api/guild/:id/rolemenus/:menuId/publish', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  if (!access.guild) return json(res, 400, { error: 'meelarp is not in that server.' });
  const result = await publishMenu(access.guild, Number(params.menuId));
  json(res, result.ok ? 200 : 400, result);
});

route('DELETE', '/api/guild/:id/rolemenus/:menuId', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const gone = deleteMenu(Number(params.menuId));
  json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'Menu not found' });
});

// --- timers ---------------------------------------------------------------
route('GET', '/api/guild/:id/timers', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, { timers: listTimers(params.id) });
});

route('POST', '/api/guild/:id/timers', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const body = await readBody(req);
  const timer = body.id ? updateTimer(Number(body.id), body) : createTimer(params.id, body);
  logAudit(params.id, access.session.user, 'timer.save', String(timer?.id));
  json(res, timer ? 200 : 404, timer ? { timer } : { error: 'Timer not found' });
});

route('POST', '/api/guild/:id/timers/:timerId/run', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const row = db.prepare('SELECT * FROM timers WHERE id = ? AND guild_id = ?').get(Number(params.timerId), params.id);
  if (!row) return json(res, 404, { error: 'Timer not found' });
  await runTimer(botClient, row);
  json(res, 200, { ok: true });
});

route('DELETE', '/api/guild/:id/timers/:timerId', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const gone = deleteTimer(Number(params.timerId));
  json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'Timer not found' });
});

// --- feeds ----------------------------------------------------------------
route('GET', '/api/guild/:id/feeds', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, { feeds: listFeeds(params.id) });
});

route('POST', '/api/guild/:id/feeds', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const body = await readBody(req);
  try {
    const feed = body.id ? updateFeed(Number(body.id), body) : await createFeed(params.id, body);
    logAudit(params.id, access.session.user, 'feed.save', feed?.display_name ?? '');
    json(res, feed ? 200 : 404, feed ? { feed } : { error: 'Feed not found' });
  } catch (e) { json(res, 400, { error: e.message }); }
});

route('POST', '/api/guild/:id/feeds/:feedId/test', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const result = await testFeed(botClient, Number(params.feedId));
  json(res, result.ok ? 200 : 400, result);
});

route('DELETE', '/api/guild/:id/feeds/:feedId', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const gone = deleteFeed(Number(params.feedId));
  json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'Feed not found' });
});

// --- giveaways ------------------------------------------------------------
route('GET', '/api/guild/:id/giveaways', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, {
    giveaways: listGiveaways(params.id).map((g) => ({ ...g, entries: entryCount(g.id) })),
  });
});

route('POST', '/api/guild/:id/giveaways', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  if (!access.guild) return json(res, 400, { error: 'meelarp is not in that server.' });
  const body = await readBody(req);
  const result = await startGiveaway(access.guild, {
    channelId: body.channelId,
    prize: body.prize,
    winners: Number(body.winners ?? 1),
    durationSec: Number(body.durationSec ?? 3600),
    hostId: access.session.user.id,
    requirements: body.requirements ?? {},
  });
  logAudit(params.id, access.session.user, 'giveaway.start', body.prize ?? '');
  json(res, result.ok ? 200 : 400, result);
});

route('POST', '/api/guild/:id/giveaways/:gid/end', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const body = await readBody(req).catch(() => ({}));
  const result = await endGiveaway(botClient, Number(params.gid), { reroll: !!body.reroll });
  json(res, result.ok ? 200 : 400, result);
});

route('DELETE', '/api/guild/:id/giveaways/:gid', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const gone = deleteGiveaway(Number(params.gid));
  json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'Giveaway not found' });
});

// --- tickets --------------------------------------------------------------
route('GET', '/api/guild/:id/tickets', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, { tickets: ticketsFor(params.id) });
});

route('POST', '/api/guild/:id/tickets/panel', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  if (!access.guild) return json(res, 400, { error: 'meelarp is not in that server.' });
  const body = await readBody(req);
  const channel = access.guild.channels.cache.get(body.channelId);
  if (!channel?.isTextBased()) return json(res, 400, { error: 'Pick a text channel.' });
  await sendPanel(channel, body);
  logAudit(params.id, access.session.user, 'ticket.panel', channel.name);
  json(res, 200, { ok: true });
});

// --- testers & tools ------------------------------------------------------
route('POST', '/api/guild/:id/automod/test', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  const { text, rules } = await readBody(req);
  const hit = automodPreview(text ?? '', rules ?? getSettings(params.id).automod.rules);
  json(res, 200, { hit: hit ? { rule: hit.rule, reason: hit.reason, action: hit.config.action } : null });
});

route('POST', '/api/guild/:id/welcome/test', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  if (!access.guild) return json(res, 400, { error: 'meelarp is not in that server.' });
  const member = await access.guild.members.fetch(access.session.user.id).catch(() => null);
  if (!member) return json(res, 400, { error: 'You must be a member of that server to preview.' });
  await handleMemberJoin(member);
  json(res, 200, { ok: true });
});

route('POST', '/api/guild/:id/announce', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  if (!access.guild) return json(res, 400, { error: 'meelarp is not in that server.' });
  const { channelId, content, embed } = await readBody(req);
  const channel = access.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return json(res, 400, { error: 'Pick a text channel.' });
  const { buildEmbedFrom } = await import('../bot/util.js');
  const built = embed ? buildEmbedFrom(embed, { guild: access.guild, channel }) : null;
  if (!content && !built) return json(res, 400, { error: 'Nothing to send.' });
  await channel.send({ content: content || undefined, embeds: built ? [built] : undefined });
  logAudit(params.id, access.session.user, 'announce', channel.name);
  json(res, 200, { ok: true });
});

route('GET', '/api/guild/:id/audit', async ({ req, res, params, botClient }) => {
  const access = guildAccess(req, res, params.id, botClient);
  if (!access) return;
  json(res, 200, { audit: recentAudit(params.id, 50) });
});

// --- dispatcher -----------------------------------------------------------
export async function handleApi(req, res, url, botClient) {
  const method = req.method.toUpperCase();

  // Simple CSRF guard: mutations must come from our own fetch() calls.
  if (method !== 'GET' && req.headers['x-meelarp'] !== '1') {
    return json(res, 403, { error: 'Missing meelarp request header.' });
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      return await r.handler({ req, res, url, params, botClient });
    } catch (e) {
      console.error('[meelarp:api]', url.pathname, e);
      if (!res.headersSent) return json(res, 500, { error: e.message || 'Internal error' });
      return res.end();
    }
  }
  return json(res, 404, { error: `No API route for ${method} ${url.pathname}` });
}

export { jsonCol };

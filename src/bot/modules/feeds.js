// meelarp — social feeds: YouTube, Twitch, Reddit, RSS (unlimited)
import { db, getSettings, now } from '../../db.js';
import { config } from '../../config.js';
import { brandEmbed, safeChannel, applyPlaceholders, logError, truncate } from '../util.js';

const UA = 'meelarp/1.0 (+https://github.com/larprober/meelarp)';

const DEFAULT_TEMPLATES = {
  youtube: '**{name}** just posted a video!\n{url}',
  twitch: '@everyone **{name}** is now live on Twitch!\n{url}',
  reddit: 'New post in **r/{name}**\n{url}',
  rss: '**{name}**: {title}\n{url}',
};

// --- helpers --------------------------------------------------------------
async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decodeXml(m[1].trim()) : null;
};
const attr = (xml, name, a) => {
  const m = new RegExp(`<${name}[^>]*\\b${a}=["']([^"']+)["']`, 'i').exec(xml);
  return m ? m[1] : null;
};
function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// --- source resolution ----------------------------------------------------
export async function resolveSource(type, input) {
  const raw = String(input).trim();
  switch (type) {
    case 'youtube': {
      if (/^UC[\w-]{20,}$/.test(raw)) return { id: raw, name: raw };
      const url = /^https?:\/\//.test(raw) ? raw
        : raw.startsWith('@') ? `https://www.youtube.com/${raw}`
        : `https://www.youtube.com/@${raw}`;
      const html = await getText(url);
      const id = /"channelId":"(UC[\w-]{20,})"/.exec(html)?.[1]
        ?? /channel_id=(UC[\w-]{20,})/.exec(html)?.[1];
      if (!id) throw new Error('Could not find that YouTube channel.');
      const name = /<meta property="og:title" content="([^"]+)"/.exec(html)?.[1] ?? raw;
      return { id, name: decodeXml(name) };
    }
    case 'twitch': {
      const login = raw.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (!login) throw new Error('Invalid Twitch channel.');
      return { id: login, name: login };
    }
    case 'reddit': {
      const sub = raw.replace(/^https?:\/\/(www\.)?reddit\.com\//i, '').replace(/^r\//i, '').replace(/\/.*$/, '');
      if (!sub) throw new Error('Invalid subreddit.');
      return { id: sub, name: sub };
    }
    case 'rss':
    default: {
      if (!/^https?:\/\//.test(raw)) throw new Error('RSS feeds need a full URL.');
      const xml = await getText(raw);
      const name = tag(xml, 'title') ?? new URL(raw).hostname;
      return { id: raw, name };
    }
  }
}

// --- fetchers -------------------------------------------------------------
async function fetchYouTube(feed) {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(feed.source_id)}`);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  if (!entries.length) return [];
  return entries.slice(0, 5).map((e) => ({
    id: tag(e, 'yt:videoId') ?? tag(e, 'id'),
    title: tag(e, 'title'),
    url: attr(e, 'link', 'href'),
    author: tag(e, 'name'),
    published: Date.parse(tag(e, 'published') ?? '') || Date.now(),
    thumbnail: attr(e, 'media:thumbnail', 'url'),
    description: truncate(tag(e, 'media:description') ?? '', 300),
  }));
}

let twitchToken = { value: null, expires: 0 };
async function twitchAuth() {
  if (twitchToken.value && twitchToken.expires > Date.now() + 60000) return twitchToken.value;
  if (!config.twitch.clientId || !config.twitch.clientSecret) throw new Error('Twitch credentials are not configured.');
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Twitch auth failed (${res.status})`);
  const data = await res.json();
  twitchToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return twitchToken.value;
}

async function fetchTwitch(feed) {
  const token = await twitchAuth();
  const data = await getJson(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(feed.source_id)}`,
    { 'client-id': config.twitch.clientId, authorization: `Bearer ${token}` });
  const stream = data.data?.[0];
  if (!stream) {
    if (feed.live) db.prepare('UPDATE feeds SET live = 0 WHERE id = ?').run(feed.id);
    return [];
  }
  if (feed.live) return [];  // already announced this stream
  db.prepare('UPDATE feeds SET live = 1 WHERE id = ?').run(feed.id);
  return [{
    id: stream.id,
    title: stream.title,
    url: `https://twitch.tv/${stream.user_login}`,
    author: stream.user_name,
    published: Date.parse(stream.started_at) || Date.now(),
    thumbnail: (stream.thumbnail_url ?? '').replace('{width}', '640').replace('{height}', '360'),
    description: `Playing **${stream.game_name || 'something'}** for ${stream.viewer_count} viewers`,
  }];
}

async function fetchReddit(feed) {
  const data = await getJson(`https://www.reddit.com/r/${encodeURIComponent(feed.source_id)}/new.json?limit=5`);
  return (data.data?.children ?? []).map((c) => c.data).map((p) => ({
    id: p.id,
    title: p.title,
    url: `https://reddit.com${p.permalink}`,
    author: `u/${p.author}`,
    published: (p.created_utc ?? 0) * 1000,
    thumbnail: /^https?:\/\//.test(p.thumbnail ?? '') ? p.thumbnail : null,
    description: truncate(p.selftext ?? '', 300),
  }));
}

async function fetchRss(feed) {
  const xml = await getText(feed.source_id);
  const items = [...xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g)].map((m) => m[1]);
  return items.slice(0, 5).map((i) => {
    const link = tag(i, 'link') || attr(i, 'link', 'href');
    return {
      id: tag(i, 'guid') ?? tag(i, 'id') ?? link,
      title: tag(i, 'title'),
      url: link,
      author: tag(i, 'dc:creator') ?? tag(i, 'author') ?? feed.display_name,
      published: Date.parse(tag(i, 'pubDate') ?? tag(i, 'updated') ?? '') || Date.now(),
      thumbnail: attr(i, 'media:thumbnail', 'url') ?? attr(i, 'enclosure', 'url'),
      description: truncate(tag(i, 'description') ?? tag(i, 'summary') ?? '', 300),
    };
  });
}

const FETCHERS = { youtube: fetchYouTube, twitch: fetchTwitch, reddit: fetchReddit, rss: fetchRss };

// --- CRUD -----------------------------------------------------------------
export function listFeeds(guildId) {
  return db.prepare('SELECT * FROM feeds WHERE guild_id = ? ORDER BY id DESC').all(guildId);
}

export async function createFeed(guildId, { type, source, channelId, template }) {
  const resolved = await resolveSource(type, source);
  const info = db.prepare(`INSERT INTO feeds (guild_id, type, source, source_id, display_name, channel_id, template, last_item, last_check, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 1, ?)`).run(
    guildId, type, source, resolved.id, resolved.name, channelId,
    template ?? DEFAULT_TEMPLATES[type] ?? DEFAULT_TEMPLATES.rss, now());
  return db.prepare('SELECT * FROM feeds WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function updateFeed(id, data) {
  const f = db.prepare('SELECT * FROM feeds WHERE id = ?').get(id);
  if (!f) return null;
  db.prepare('UPDATE feeds SET channel_id = ?, template = ?, enabled = ? WHERE id = ?').run(
    data.channelId ?? f.channel_id, data.template ?? f.template,
    data.enabled === undefined ? f.enabled : (data.enabled ? 1 : 0), id);
  return db.prepare('SELECT * FROM feeds WHERE id = ?').get(id);
}

export function deleteFeed(id) {
  return db.prepare('DELETE FROM feeds WHERE id = ?').run(id).changes > 0;
}

// --- polling --------------------------------------------------------------
export async function pollFeeds(client) {
  const feeds = db.prepare('SELECT * FROM feeds WHERE enabled = 1 AND last_check <= ?')
    .all(now() - 5 * 60 * 1000);
  for (const feed of feeds) {
    db.prepare('UPDATE feeds SET last_check = ? WHERE id = ?').run(now(), feed.id);
    try {
      const guild = client.guilds.cache.get(feed.guild_id);
      if (!guild) continue;
      const settings = getSettings(guild.id);
      if (!settings.modules.feeds) continue;

      const items = await FETCHERS[feed.type]?.(feed) ?? [];
      if (!items.length) continue;
      items.sort((a, b) => a.published - b.published);

      // first run: remember the newest item, announce nothing
      if (!feed.last_item) {
        db.prepare('UPDATE feeds SET last_item = ? WHERE id = ?').run(items[items.length - 1].id, feed.id);
        continue;
      }

      const lastIndex = items.findIndex((i) => i.id === feed.last_item);
      const fresh = lastIndex === -1 ? items.slice(-1) : items.slice(lastIndex + 1);
      if (!fresh.length) continue;

      const channel = safeChannel(guild, feed.channel_id);
      if (!channel) continue;

      for (const item of fresh.slice(-3)) {
        await announce(channel, feed, item).catch((e) => logError('feeds:announce', e));
      }
      db.prepare('UPDATE feeds SET last_item = ? WHERE id = ?').run(fresh[fresh.length - 1].id, feed.id);
    } catch (e) {
      logError(`feeds:${feed.type}`, e);
    }
  }
}

const FEED_COLORS = { youtube: 0xff0033, twitch: 0x9146ff, reddit: 0xff4500, rss: 0xf6a800 };

async function announce(channel, feed, item) {
  const content = applyPlaceholders(feed.template || DEFAULT_TEMPLATES[feed.type], {
    guild: channel.guild, channel,
    extra: {
      name: feed.display_name ?? feed.source,
      title: item.title ?? '',
      url: item.url ?? '',
      author: item.author ?? '',
      description: item.description ?? '',
    },
  });
  const embed = brandEmbed({
    color: FEED_COLORS[feed.type] ?? 0x5b6bff,
    title: truncate(item.title || 'New post', 250),
    description: item.description || undefined,
    author: { name: item.author || feed.display_name || feed.type },
    image: item.thumbnail || undefined,
    footer: `meelarp · ${feed.type}`,
    timestamp: true,
  });
  if (item.url) embed.setURL(item.url);
  await channel.send({
    content: content.slice(0, 2000),
    embeds: [embed],
    allowedMentions: { parse: ['everyone', 'roles', 'users'] },
  });
}

export async function testFeed(client, feedId) {
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedId);
  if (!feed) return { ok: false, error: 'Feed not found' };
  const guild = client.guilds.cache.get(feed.guild_id);
  const channel = guild && safeChannel(guild, feed.channel_id);
  if (!channel) return { ok: false, error: 'Cannot post in the configured channel' };
  const items = await FETCHERS[feed.type]?.({ ...feed, live: 0 }) ?? [];
  if (!items.length) return { ok: false, error: 'No items found for that source right now' };
  await announce(channel, feed, items[items.length - 1]);
  return { ok: true };
}

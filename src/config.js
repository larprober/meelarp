// meelarp — runtime configuration + per-guild settings schema
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// --- tiny .env loader (no dependency) -------------------------------------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  clientSecret: process.env.CLIENT_SECRET || '',
  ownerIds: (process.env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  web: {
    port: Number(process.env.PORT || 3400),
    host: process.env.HOST || '0.0.0.0',
    baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3400}`).replace(/\/$/, ''),
    sessionSecret: process.env.SESSION_SECRET || 'change-me-meelarp-dev-secret',
  },
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'meelarp.db'),
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
  },
  brand: {
    name: 'meelarp',
    color: 0x5b6bff,
    colorHex: '#5b6bff',
    accent: 0x27e0a4,
  },
  debug: bool(process.env.DEBUG),
};

export const inviteUrl = () =>
  `https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=1101659759351&scope=bot%20applications.commands`;

// --- default per-guild settings -------------------------------------------
// Every "premium" MEE6 gate is simply on by default here.
export const DEFAULT_SETTINGS = {
  prefix: '!',
  modules: {
    levels: true,
    moderation: true,
    automod: true,
    welcome: true,
    roles: true,
    commands: true,
    timers: true,
    feeds: true,
    giveaways: true,
    tickets: true,
    logs: true,
    counters: false,
    music: true,
    starboard: false,
    utility: true,
  },
  levels: {
    xpPerMessage: [15, 25],
    cooldownSeconds: 60,
    curve: 'mee6',                // mee6 | linear | fast
    announce: 'channel',          // channel | dm | current | none
    announceChannel: null,
    announceMessage: '{user:mention} just advanced to **level {level}**!',
    announceOnlyOnReward: false,
    stackRoles: true,
    roleRewards: [],              // [{ level, roleId }]
    multipliers: [],              // [{ type:'role'|'channel', id, factor }]
    noXpChannels: [],
    noXpRoles: [],
    voiceXp: { enabled: false, perMinute: 5 },
    card: {                       // "premium" rank card — free here
      accent: '#5b6bff',
      background: null,
      barStyle: 'rounded',        // rounded | square | segmented
      textColor: '#ffffff',
      opacity: 0.72,
    },
    leaderboardPublic: true,
    resetOnLeave: false,
  },
  moderation: {
    modLogChannel: null,
    dmOnAction: true,
    muteRoleId: null,             // null => native timeouts
    warnThresholds: [],           // [{ warns, action, duration }]
    protectedRoles: [],
    purgeLimit: 100,
  },
  automod: {
    exemptRoles: [],
    exemptChannels: [],
    logChannel: null,
    rules: {
      invites:    { enabled: false, action: 'delete',  whitelist: [] },
      links:      { enabled: false, action: 'delete',  mode: 'blacklist', list: [] },
      spam:       { enabled: false, action: 'timeout', messages: 5, seconds: 5, duration: 300 },
      duplicates: { enabled: false, action: 'delete',  count: 3 },
      mentions:   { enabled: false, action: 'timeout', limit: 5, duration: 300 },
      caps:       { enabled: false, action: 'delete',  percent: 70, minLength: 10 },
      words:      { enabled: false, action: 'delete',  list: [], presets: [], wildcard: true },
      emoji:      { enabled: false, action: 'delete',  limit: 8 },
      zalgo:      { enabled: false, action: 'delete' },
      attachments:{ enabled: false, action: 'delete',  limit: 5 },
      newlines:   { enabled: false, action: 'delete',  limit: 12 },
    },
    escalation: { enabled: false, window: 3600, steps: [] },
  },
  welcome: {
    join: {
      enabled: false, channelId: null,
      message: 'Welcome {user:mention} to **{server:name}**!',
      embed: null,
      image: { enabled: false, background: null, accent: '#5b6bff' },
      deleteAfter: 0,
    },
    dm: { enabled: false, message: 'Welcome to **{server:name}**, {user:name}!', embed: null },
    leave: { enabled: false, channelId: null, message: '**{user:name}** left the server.', embed: null },
    boost: { enabled: false, channelId: null, message: 'Thank you {user:mention} for boosting **{server:name}**!' },
    autorole: { enabled: false, roles: [], delaySeconds: 0, botRoles: [] },
    stickyRoles: false,
  },
  commands: { deleteTrigger: false, cooldownSeconds: 3 },
  logs: {
    channelId: null,
    events: {
      messageDelete: true, messageEdit: true, messageBulkDelete: true,
      memberJoin: true, memberLeave: true, memberUpdate: true,
      memberBanned: true, memberUnbanned: true,
      roleCreate: true, roleDelete: true, roleUpdate: true,
      channelCreate: true, channelDelete: true, channelUpdate: true,
      voiceJoin: false, voiceLeave: false, voiceMove: false,
      inviteCreate: false, threadCreate: false,
    },
    ignoredChannels: [],
    perEventChannels: {},
  },
  counters: { items: [] },        // [{ channelId, type, template }]
  tickets: {
    categoryId: null, supportRoles: [], transcriptChannel: null,
    openMessage: 'Thanks for opening a ticket. A staff member will be with you shortly.',
    limitPerUser: 1, nameTemplate: 'ticket-{number}',
  },
  giveaways: { managerRoles: [] },
  starboard: { channelId: null, threshold: 3, emoji: '⭐', selfStar: false, ignoredChannels: [] },
  music: { djRoles: [], maxQueue: 200, defaultVolume: 60, leaveOnEmptySeconds: 120 },
  permissions: {},                // { commandName: { roles: [], channels: [], denyChannels: [] } }
};

export function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch === undefined ? base : patch;
  if (typeof base !== 'object' || base === null) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

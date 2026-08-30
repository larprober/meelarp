// meelarp — storage layer on Node's built-in SQLite (no native build step)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config, DEFAULT_SETTINGS, deepMerge } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT,
  icon TEXT,
  member_count INTEGER DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS levels (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  voice_minutes INTEGER NOT NULL DEFAULT 0,
  last_xp INTEGER NOT NULL DEFAULT 0,
  username TEXT,
  avatar TEXT,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_levels_rank ON levels (guild_id, xp DESC);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  case_no INTEGER NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_tag TEXT,
  mod_id TEXT,
  mod_tag TEXT,
  reason TEXT,
  duration INTEGER,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_guild ON cases (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cases_expiry ON cases (active, expires_at);

CREATE TABLE IF NOT EXISTS custom_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  response TEXT NOT NULL,
  embed TEXT,
  actions TEXT NOT NULL DEFAULT '{}',
  restrictions TEXT NOT NULL DEFAULT '{}',
  uses INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS role_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  title TEXT,
  description TEXT,
  style TEXT NOT NULL DEFAULT 'buttons',
  mode TEXT NOT NULL DEFAULT 'multi',
  color TEXT,
  options TEXT NOT NULL DEFAULT '[]',
  required_roles TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT,
  message TEXT NOT NULL,
  embed TEXT,
  interval_sec INTEGER NOT NULL,
  next_run INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  delete_previous INTEGER NOT NULL DEFAULT 0,
  last_message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  display_name TEXT,
  channel_id TEXT NOT NULL,
  template TEXT,
  last_item TEXT,
  last_check INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  prize TEXT NOT NULL,
  winner_count INTEGER NOT NULL DEFAULT 1,
  ends_at INTEGER NOT NULL,
  host_id TEXT,
  requirements TEXT NOT NULL DEFAULT '{}',
  ended INTEGER NOT NULL DEFAULT 0,
  winners TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject TEXT,
  claimed_by TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS sticky_roles (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  roles TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS starboard (
  guild_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  star_message_id TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, message_id)
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  text TEXT NOT NULL,
  remind_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT,
  user_tag TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stats (
  guild_id TEXT NOT NULL,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  joins INTEGER NOT NULL DEFAULT 0,
  leaves INTEGER NOT NULL DEFAULT 0,
  automod INTEGER NOT NULL DEFAULT 0,
  commands INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day)
);
`);

export const now = () => Date.now();

// --- guild settings with in-process cache ---------------------------------
const settingsCache = new Map();

const qGetGuild = db.prepare('SELECT * FROM guilds WHERE id = ?');
const qUpsertGuild = db.prepare(`
  INSERT INTO guilds (id, name, icon, member_count, settings, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon,
    member_count = excluded.member_count, updated_at = excluded.updated_at`);
const qSaveSettings = db.prepare('UPDATE guilds SET settings = ?, updated_at = ? WHERE id = ?');

export function getSettings(guildId) {
  if (settingsCache.has(guildId)) return settingsCache.get(guildId);
  const row = qGetGuild.get(guildId);
  let stored = {};
  if (row) {
    try { stored = JSON.parse(row.settings); } catch { stored = {}; }
  } else {
    qUpsertGuild.run(guildId, null, null, 0, '{}', now());
  }
  const merged = deepMerge(DEFAULT_SETTINGS, stored);
  settingsCache.set(guildId, merged);
  return merged;
}

export function saveSettings(guildId, settings) {
  getSettings(guildId); // ensures row exists
  settingsCache.set(guildId, settings);
  qSaveSettings.run(JSON.stringify(settings), now(), guildId);
  return settings;
}

/** Apply a partial patch (deep) to a guild's settings and persist. */
export function patchSettings(guildId, patch) {
  const next = deepMerge(getSettings(guildId), patch);
  return saveSettings(guildId, next);
}

export function touchGuild(guild) {
  qUpsertGuild.run(guild.id, guild.name, guild.icon ?? null, guild.memberCount ?? 0, '{}', now());
}

export function knownGuildIds() {
  return db.prepare('SELECT id FROM guilds').all().map((r) => r.id);
}

// --- audit / stats helpers ------------------------------------------------
const qAudit = db.prepare(
  'INSERT INTO audit (guild_id, user_id, user_tag, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)');
export function logAudit(guildId, user, action, detail = '') {
  qAudit.run(guildId, user?.id ?? null, user?.tag ?? user?.username ?? null, action, detail, now());
}
export function recentAudit(guildId, limit = 30) {
  return db.prepare('SELECT * FROM audit WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit);
}

const qStat = db.prepare(`
  INSERT INTO stats (guild_id, day, messages, joins, leaves, automod, commands)
  VALUES (?, ?, 0, 0, 0, 0, 0) ON CONFLICT(guild_id, day) DO NOTHING`);
export function bumpStat(guildId, field, by = 1) {
  const day = new Date().toISOString().slice(0, 10);
  qStat.run(guildId, day);
  db.prepare(`UPDATE stats SET ${field} = ${field} + ? WHERE guild_id = ? AND day = ?`).run(by, guildId, day);
}
export function statsRange(guildId, days = 14) {
  return db.prepare(
    'SELECT * FROM stats WHERE guild_id = ? ORDER BY day DESC LIMIT ?').all(guildId, days).reverse();
}

// --- misc small helpers used across modules -------------------------------
export function nextCaseNo(guildId) {
  const row = db.prepare('SELECT MAX(case_no) AS n FROM cases WHERE guild_id = ?').get(guildId);
  return (row?.n ?? 0) + 1;
}

export function jsonCol(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

process.on('exit', () => { try { db.close(); } catch {} });

// meelarp — cookie sessions + small HTTP helpers (shared by server.js and api.js)
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, now } from '../db.js';

const sign = (value) =>
  crypto.createHmac('sha256', config.web.sessionSecret).update(value).digest('base64url');

export function makeCookie(name, value, { maxAge = 604800, httpOnly = true } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (httpOnly) parts.push('HttpOnly');
  if (config.web.baseUrl.startsWith('https://')) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

export function createSession(data) {
  const id = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, data.user.id, JSON.stringify(data), now() + 7 * 86400_000);
  return `${id}.${sign(id)}`;
}

export function readSession(req) {
  const raw = parseCookies(req).meelarp_session;
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig) return null;
  const expected = sign(id);
  if (sig.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  try { return { id, ...JSON.parse(row.data) }; } catch { return null; }
}

export function updateSession(id, data) {
  const { id: _drop, ...rest } = data;
  db.prepare('UPDATE sessions SET data = ? WHERE id = ?').run(JSON.stringify(rest), id);
}

export function destroySession(req) {
  const id = parseCookies(req).meelarp_session?.split('.')[0];
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

// --- HTTP helpers ---------------------------------------------------------
export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON body'); }
}

export async function discordApi(pathname, accessToken) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord API ${pathname} failed: ${res.status}`);
  return res.json();
}

/** Discord's MANAGE_GUILD bit. */
export const MANAGE_GUILD = 1n << 5n;

export function canManage(guildEntry) {
  if (!guildEntry) return false;
  if (guildEntry.owner) return true;
  try { return (BigInt(guildEntry.permissions) & MANAGE_GUILD) === MANAGE_GUILD; }
  catch { return false; }
}

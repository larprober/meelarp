// meelarp — dashboard web server (node:http, no framework)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT, inviteUrl } from '../config.js';
import { handleApi } from './api.js';
import { makeCookie, parseCookies, createSession, destroySession,
  purgeExpiredSessions, json, discordApi } from './session.js';

const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

setInterval(purgeExpiredSessions, 3600_000).unref?.();

// --- static + html --------------------------------------------------------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return true; }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return true; }

  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': stat.size,
    etag,
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function sendHtml(res, file) {
  const body = fs.readFileSync(path.join(PUBLIC_DIR, file));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

const redirect = (res, location) => { res.writeHead(302, { location }); res.end(); };

// --- Discord OAuth --------------------------------------------------------
function oauthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.web.baseUrl}/callback`,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${config.web.baseUrl}/callback`,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- router ---------------------------------------------------------------
export function createHandler(botClient) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/login') {
        if (!config.clientId || !config.clientSecret) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          return res.end('CLIENT_ID / CLIENT_SECRET are not configured. Fill in .env and restart meelarp.');
        }
        const state = crypto.randomBytes(16).toString('base64url');
        res.setHeader('set-cookie', makeCookie('meelarp_state', state, { maxAge: 600 }));
        return redirect(res, oauthUrl(state));
      }

      if (pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const expected = parseCookies(req).meelarp_state;
        if (!code || !state || state !== expected) return redirect(res, '/?error=state');

        const token = await exchangeCode(code);
        const user = await discordApi('/users/@me', token.access_token);
        const guilds = await discordApi('/users/@me/guilds', token.access_token);
        const cookie = createSession({
          user: { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar },
          guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon,
            owner: g.owner, permissions: g.permissions })),
          accessToken: token.access_token,
          fetchedAt: Date.now(),
        });
        res.setHeader('set-cookie', [
          makeCookie('meelarp_session', cookie),
          makeCookie('meelarp_state', '', { maxAge: 0 }),
        ]);
        return redirect(res, '/servers');
      }

      if (pathname === '/logout') {
        destroySession(req);
        res.setHeader('set-cookie', makeCookie('meelarp_session', '', { maxAge: 0 }));
        return redirect(res, '/');
      }

      if (pathname.startsWith('/api/')) return handleApi(req, res, url, botClient);

      if (pathname === '/servers') return sendHtml(res, 'servers.html');
      if (pathname.startsWith('/dashboard/')) return sendHtml(res, 'dashboard.html');
      if (pathname.startsWith('/leaderboard/')) return sendHtml(res, 'leaderboard.html');
      if (pathname === '/invite') return redirect(res, inviteUrl());

      if (serveStatic(req, res, pathname)) return;

      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>404 · meelarp</title>'
        + '<body style="background:#0b0d16;color:#e7e9f3;font:15px/1.6 system-ui;display:grid;place-items:center;height:100vh;margin:0">'
        + '<div style="text-align:center"><h1 style="font-size:64px;margin:0">404</h1>'
        + '<p style="color:#9aa1b8">That page does not exist. <a href="/" style="color:#5b6bff">Back to meelarp</a></p></div>');
    } catch (e) {
      console.error('[meelarp:web]', e);
      if (!res.headersSent) json(res, 500, { error: e.message || 'Internal error' });
      else res.end();
    }
  };
}

export async function startWeb(botClient) {
  const server = http.createServer(createHandler(botClient));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.web.port, config.web.host, resolve);
    });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      throw new Error(`Port ${config.web.port} is already in use — meelarp may already be running. `
        + `Close the other window, or set a different PORT in .env.`);
    }
    throw e;
  }
  return () => new Promise((resolve) => server.close(resolve));
}

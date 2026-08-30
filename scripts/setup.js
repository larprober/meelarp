// meelarp — creates .env from .env.example with a generated session secret
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, '.env');
const example = path.join(root, '.env.example');

if (fs.existsSync(target)) {
  console.log('.env already exists — leaving it alone.');
  process.exit(0);
}

const secret = crypto.randomBytes(32).toString('base64url');
const content = fs.readFileSync(example, 'utf8').replace('SESSION_SECRET=', `SESSION_SECRET=${secret}`);
fs.writeFileSync(target, content);

console.log(`Created ${target}

Next:
  1. Open https://discord.com/developers/applications and create an application
  2. Bot tab       → Reset Token          → paste into DISCORD_TOKEN
                   → enable all three Privileged Gateway Intents
  3. General Info  → Application ID       → paste into CLIENT_ID
  4. OAuth2 tab    → Client Secret        → paste into CLIENT_SECRET
                   → Redirects: add  http://localhost:3400/callback
  5. npm start`);

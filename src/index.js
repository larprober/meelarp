// meelarp — entry point: starts the bot and the dashboard together
import { config } from './config.js';
import './db.js';

const args = process.argv.slice(2);
const webOnly = args.includes('--web-only');
const botOnly = args.includes('--bot-only');

const banner = `
   ┌──────────────────────────────────────────────┐
   │  meelarp — every MEE6 feature, none paywalled │
   └──────────────────────────────────────────────┘`;
console.log(banner);

let stopBot = null;

if (!webOnly) {
  const bot = await import('./bot/index.js');
  stopBot = bot.stopBot;
  await bot.startBot();
}

let stopWeb = null;
if (!botOnly) {
  const web = await import('./web/server.js');
  const client = webOnly ? null : (await import('./bot/index.js')).client;
  try {
    stopWeb = await web.startWeb(client);
    console.log(`[meelarp] dashboard on ${config.web.baseUrl}`);
  } catch (e) {
    console.error(`[meelarp] Dashboard could not start: ${e.message}`);
    if (!stopBot) process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`\n[meelarp] ${signal} — shutting down`);
  try { await stopWeb?.(); } catch {}
  try { await stopBot?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[meelarp] unhandled rejection:', e));

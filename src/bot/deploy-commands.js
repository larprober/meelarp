// meelarp — register slash commands without starting the gateway connection
import { registerCommands, commandPayload } from './index.js';

try {
  const n = await registerCommands();
  console.log(`[meelarp] registered ${n} global slash commands:`);
  console.log(commandPayload().map((c) => `  /${c.name}`).join('\n'));
  process.exit(0);
} catch (e) {
  console.error('[meelarp] failed to register commands:', e.message);
  process.exit(1);
}

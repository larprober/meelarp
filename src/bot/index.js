// meelarp — Discord client, event wiring, schedulers
import { Client, GatewayIntentBits, Partials, Events, Collection, ActivityType,
  MessageFlags, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { getSettings, touchGuild, bumpStat, logAudit } from '../db.js';
import { fail, logError, brandEmbed } from './util.js';

import levelCommands from './commands/levels.js';
import moderationCommands from './commands/moderation.js';
import utilityCommands from './commands/utility.js';
import communityCommands from './commands/community.js';
import musicCommands from './commands/music.js';

import { handleMessageXp, voiceJoined, voiceLeft } from './modules/levels.js';
import { runAutomod } from './modules/automod.js';
import { handleCustomCommand } from './modules/customcommands.js';
import { handleMemberJoin, handleMemberLeave, handleBoost } from './modules/welcome.js';
import { handleRoleInteraction, handleRoleReaction } from './modules/roles.js';
import { handleGiveawayButton, tickGiveaways } from './modules/giveaways.js';
import { handleTicketInteraction } from './modules/tickets.js';
import { handleDashboardInteraction } from './modules/dashboard.js';
import { handleStar } from './modules/starboard.js';
import { registerLogging } from './modules/logs.js';
import { sweepExpired } from './modules/moderation.js';
import { tickTimers, tickReminders } from './modules/timers.js';
import { pollFeeds } from './modules/feeds.js';
import { updateCounters } from './modules/counters.js';
import { destroyAll as stopAllMusic } from './modules/music.js';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
  allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
});

// --- command registry -----------------------------------------------------
client.commands = new Collection();
for (const cmd of [...levelCommands, ...moderationCommands, ...utilityCommands,
  ...communityCommands, ...musicCommands]) {
  client.commands.set(cmd.data.name, cmd);
}

export function commandPayload() {
  return client.commands.map((c) => c.data.toJSON());
}

export async function registerCommands() {
  if (!config.token || !config.clientId) throw new Error('DISCORD_TOKEN and CLIENT_ID are required.');
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commandPayload();
  await rest.put(Routes.applicationCommands(config.clientId), { body });
  return body.length;
}

// --- helpers --------------------------------------------------------------
function commandAllowed(interaction) {
  const settings = getSettings(interaction.guild.id);
  const rule = settings.permissions?.[interaction.commandName];
  if (!rule) return true;
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (rule.denyChannels?.includes(interaction.channel.id)) return false;
  if (rule.channels?.length && !rule.channels.includes(interaction.channel.id)) return false;
  if (rule.roles?.length && !rule.roles.some((r) => interaction.member.roles.cache.has(r))) return false;
  return true;
}

const moduleForCommand = {
  rank: 'levels', leaderboard: 'levels', levels: 'levels', xp: 'levels', levelrole: 'levels',
  play: 'music', skip: 'music', stop: 'music', pause: 'music', resume: 'music', queue: 'music',
  nowplaying: 'music', loop: 'music', volume: 'music', shuffle: 'music', remove: 'music',
  giveaway: 'giveaways', ticket: 'tickets', timer: 'timers', feed: 'feeds',
  rolemenu: 'roles', customcommand: 'commands', automod: 'automod',
};

// --- events ---------------------------------------------------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`[meelarp] logged in as ${c.user.tag} · ${c.guilds.cache.size} servers`);
  c.user.setPresence({
    activities: [{ name: `${c.guilds.cache.size} servers · /help`, type: ActivityType.Watching }],
    status: 'online',
  });
  for (const guild of c.guilds.cache.values()) {
    touchGuild(guild);
    getSettings(guild.id);
  }

  try {
    const n = await registerCommands();
    console.log(`[meelarp] registered ${n} slash commands`);
  } catch (e) { logError('register-commands', e); }

  startSchedulers(c);
});

client.on(Events.GuildCreate, async (guild) => {
  touchGuild(guild);
  console.log(`[meelarp] joined ${guild.name} (${guild.id})`);
  const channel = guild.systemChannel
    ?? guild.channels.cache.find((ch) => ch.isTextBased?.() && ch.permissionsFor(guild.members.me)?.has('SendMessages'));
  await channel?.send({ embeds: [brandEmbed({
    title: 'meelarp is here',
    description: [
      'Every MEE6 feature, premium included, at no cost.',
      '',
      '• `/help` — the full command list',
      `• [Open the dashboard](${config.web.baseUrl}/dashboard/${guild.id}) to configure leveling, automod, welcome messages, roles, feeds and more.`,
    ].join('\n'),
  })] }).catch(() => {});
});

client.on(Events.GuildDelete, (guild) => console.log(`[meelarp] left ${guild.name}`));

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild || message.author.bot || !message.member) return;
    bumpStat(message.guild.id, 'messages');

    if (await runAutomod(message)) return;
    if (await handleCustomCommand(message)) return;
    await handleMessageXp(message);
  } catch (e) { logError('messageCreate', e); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      if (interaction.customId?.startsWith('dash:')) {
        await handleDashboardInteraction(interaction);
        return;
      }
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (await handleRoleInteraction(interaction)) return;
        if (await handleGiveawayButton(interaction)) return;
        if (await handleTicketInteraction(interaction)) return;
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    if (!interaction.guild) {
      return interaction.reply({ content: 'meelarp commands only work inside a server.', flags: MessageFlags.Ephemeral });
    }

    const moduleName = moduleForCommand[interaction.commandName];
    if (moduleName && !getSettings(interaction.guild.id).modules[moduleName]) {
      return interaction.reply({ embeds: [fail(`The **${moduleName}** module is disabled on this server.`)], flags: MessageFlags.Ephemeral });
    }
    if (!commandAllowed(interaction)) {
      return interaction.reply({ embeds: [fail('That command is restricted here.')], flags: MessageFlags.Ephemeral });
    }

    bumpStat(interaction.guild.id, 'commands');
    await command.execute(interaction);
  } catch (e) {
    logError(`command:${interaction.commandName ?? 'interaction'}`, e);
    const payload = { embeds: [fail('Something went wrong running that. The error has been logged.')], flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, (member) => handleMemberJoin(member).catch((e) => logError('memberAdd', e)));
client.on(Events.GuildMemberRemove, (member) => handleMemberLeave(member).catch((e) => logError('memberRemove', e)));

client.on(Events.GuildMemberUpdate, (oldM, newM) => {
  if (!oldM.premiumSince && newM.premiumSince) handleBoost(newM).catch((e) => logError('boost', e));
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await handleRoleReaction(reaction, user, true).catch((e) => logError('reactionAdd', e));
  await handleStar(reaction, user).catch(() => {});
});
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await handleRoleReaction(reaction, user, false).catch((e) => logError('reactionRemove', e));
  await handleStar(reaction, user).catch(() => {});
});

client.on(Events.VoiceStateUpdate, (oldS, newS) => {
  const guildId = (newS.guild ?? oldS.guild)?.id;
  if (!guildId) return;
  if (!oldS.channelId && newS.channelId) voiceJoined(guildId, newS.id);
  else if (oldS.channelId && !newS.channelId) voiceLeft(guildId, oldS.id);
});

registerLogging(client);

client.on(Events.Error, (e) => logError('client', e));
client.rest.on('rateLimited', (info) => {
  if (config.debug) console.warn('[meelarp] rate limited', info.route);
});

// --- schedulers -----------------------------------------------------------
let schedulers = [];
function startSchedulers(c) {
  const every = (ms, fn, name) => {
    const handle = setInterval(() => { fn().catch((e) => logError(`scheduler:${name}`, e)); }, ms);
    handle.unref?.();
    schedulers.push(handle);
  };
  every(30_000, () => sweepExpired(c), 'expiry');
  every(30_000, () => tickTimers(c), 'timers');
  every(20_000, () => tickReminders(c), 'reminders');
  every(15_000, () => tickGiveaways(c), 'giveaways');
  every(60_000, () => pollFeeds(c), 'feeds');
  every(5 * 60_000, () => updateCounters(c), 'counters');
  every(10 * 60_000, async () => {
    for (const guild of c.guilds.cache.values()) touchGuild(guild);
    c.user.setPresence({
      activities: [{ name: `${c.guilds.cache.size} servers · /help`, type: ActivityType.Watching }],
      status: 'online',
    });
  }, 'presence');
}

export async function startBot() {
  if (!config.token) {
    console.error('[meelarp] DISCORD_TOKEN is missing — the bot will not start. Copy .env.example to .env and fill it in.');
    return null;
  }
  try {
    await client.login(config.token);
    return client;
  } catch (e) {
    const detail = `${e.code ?? ''} ${e.message ?? ''}`;
    if (/self.signed|DEPTH_ZERO|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timeout|network/i.test(detail)) {
      console.error('[meelarp] Could not reach Discord.\n'
        + '          Discord is blocked on some networks — connect a VPN and start meelarp again.\n'
        + `          (${detail.trim()})`);
    } else if (/TOKEN_INVALID|Unauthorized|401/i.test(detail)) {
      console.error('[meelarp] Discord rejected the token.\n'
        + '          Reset it in the Developer Portal (Bot tab) and paste the new one into .env.');
    } else if (/disallowed intents|Used disallowed intents/i.test(detail)) {
      console.error('[meelarp] Discord refused the connection because of missing intents.\n'
        + '          Enable all three Privileged Gateway Intents on the Bot tab, then start meelarp again.');
    } else {
      console.error(`[meelarp] Login failed: ${detail.trim()}`);
    }
    console.error('[meelarp] The dashboard stays available so you can keep configuring.');
    return null;
  }
}

export function stopBot() {
  for (const h of schedulers) clearInterval(h);
  schedulers = [];
  stopAllMusic();
  return client.destroy();
}

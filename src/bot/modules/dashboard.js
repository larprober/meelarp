// meelarp — the in-Discord control panel behind /dashboard
//
// Every screen is rebuilt from settings on each interaction, so nothing is held
// in memory and the panel keeps working across restarts. State travels in the
// customId: dash:<action>:<view>[:<argument>] (Discord allows 100 characters).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits,
  MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { getSettings, saveSettings, logAudit, db } from '../../db.js';
import { brandEmbed, truncate, logError, formatDuration, parseDuration } from '../util.js';
import { listMenus, publishMenu } from './roles.js';
import { listTimers } from './timers.js';
import { listFeeds } from './feeds.js';
import { listGiveaways, entryCount } from './giveaways.js';
import { listCommands } from './customcommands.js';
import { sendPanel, ticketsFor } from './tickets.js';
import { counterTypes } from './counters.js';
import { presetNames } from './automod.js';

// --- small helpers --------------------------------------------------------
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (node[k] === null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  node[last] = value;
}

function save(guildId, path, value) {
  const settings = getSettings(guildId);
  setPath(settings, path, value);
  saveSettings(guildId, settings);
  return settings;
}

const on = (v) => (v ? '🟢 on' : '⚫ off');
const chan = (id) => (id ? `<#${id}>` : '*not set*');
const role = (id) => (id ? `<@&${id}>` : '*not set*');
const roleList = (ids) => (ids?.length ? ids.map((r) => `<@&${r}>`).join(' ') : '*none*');
const chanList = (ids) => (ids?.length ? ids.map((c) => `<#${c}>`).join(' ') : '*none*');

const cid = (action, view, arg) => `dash:${action}:${view}${arg !== undefined ? `:${arg}` : ''}`;

// --- shared component builders -------------------------------------------
function navRow(view, extra = []) {
  const buttons = [...extra];
  if (view !== 'home') {
    buttons.push(new ButtonBuilder().setCustomId(cid('go', 'home')).setLabel('Home')
      .setStyle(ButtonStyle.Secondary).setEmoji('🏠'));
  }
  buttons.push(new ButtonBuilder().setCustomId(cid('go', view)).setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary).setEmoji('🔄'));
  return new ActionRowBuilder().addComponents(buttons.slice(0, 5));
}

function toggleButton(view, path, settings, { onLabel = 'Turn off', offLabel = 'Turn on' } = {}) {
  const value = getPath(settings, path);
  return new ButtonBuilder()
    .setCustomId(cid('tg', view, path))
    .setLabel(value ? onLabel : offLabel)
    .setStyle(value ? ButtonStyle.Danger : ButtonStyle.Success);
}

const modalButton = (view, form, label, emoji) => {
  const b = new ButtonBuilder().setCustomId(cid('mdl', view, form)).setLabel(label).setStyle(ButtonStyle.Primary);
  if (emoji) b.setEmoji(emoji);
  return b;
};

function channelRow(view, path, placeholder, types = [ChannelType.GuildText, ChannelType.GuildAnnouncement]) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(cid('ch', view, path))
      .setPlaceholder(placeholder).setChannelTypes(types).setMinValues(0).setMaxValues(1));
}

function roleRow(view, path, placeholder, { multi = false, max = 10 } = {}) {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId(cid(multi ? 'rlm' : 'rl', view, path))
      .setPlaceholder(placeholder).setMinValues(0).setMaxValues(multi ? max : 1));
}

/** discord.js rejects null on these setters, so optional bits are only applied when present. */
function selectOption({ label, value, description, emoji, isDefault }) {
  const option = new StringSelectMenuOptionBuilder()
    .setLabel(truncate(label, 100)).setValue(String(value)).setDefault(!!isDefault);
  if (description) option.setDescription(truncate(description, 100));
  if (emoji) option.setEmoji(emoji);
  return option;
}

function choiceRow(view, path, placeholder, options, current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(cid('one', view, path)).setPlaceholder(placeholder)
      .addOptions(options.map((o) => selectOption({ ...o, isDefault: String(o.value) === String(current) }))));
}

/**
 * Which boolean keys each multi-select owns. The handler needs this to know
 * what to switch *off* — a select only reports what is still chosen.
 */
const FLAG_SETS = {
  modules: () => MODULES.map(([k]) => k),
  'automod.rules': () => AUTOMOD_RULES.map(([k]) => `${k}.enabled`),
  'logs.events': () => LOG_EVENTS.map(([k]) => k),
};

/** Multi-select where the chosen options are the enabled booleans under basePath. */
function flagsRow(view, basePath, placeholder, entries, settings) {
  const options = entries.slice(0, 25).map(([key, label, description]) =>
    selectOption({ label, value: key, description, isDefault: !!getPath(settings, `${basePath}.${key}`) }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(cid('flags', view, basePath))
      .setPlaceholder(placeholder).setMinValues(0).setMaxValues(options.length).addOptions(options));
}

// --- module catalogue -----------------------------------------------------
const MODULES = [
  ['levels', 'Leveling', 'XP, rank cards, role rewards'],
  ['moderation', 'Moderation', 'Cases, warnings, mod log'],
  ['automod', 'Automod', 'Filters that act automatically'],
  ['welcome', 'Welcome', 'Greetings, autorole, sticky roles'],
  ['roles', 'Role menus', 'Self-assignable roles'],
  ['commands', 'Custom commands', 'Your own prefix commands'],
  ['timers', 'Timers', 'Recurring scheduled messages'],
  ['feeds', 'Feeds', 'YouTube, Twitch, Reddit, RSS'],
  ['giveaways', 'Giveaways', 'Entry requirements and rerolls'],
  ['tickets', 'Tickets', 'Private support channels'],
  ['logs', 'Server logs', 'Message, member, channel events'],
  ['counters', 'Counters', 'Auto-updating stat channels'],
  ['music', 'Music', 'Voice playback'],
  ['starboard', 'Starboard', 'Highlight the best messages'],
];

const SECTIONS = [
  ['modules', 'Modules', 'Switch whole features on or off', '🧩'],
  ['levels', 'Leveling', 'XP rates, announcements, rewards', '📈'],
  ['moderation', 'Moderation', 'Mod log, mute role, DM notices', '🛡'],
  ['automod', 'Automod', 'Filters and their punishments', '🚫'],
  ['welcome', 'Welcome & goodbye', 'Greetings and autorole', '👋'],
  ['roles', 'Role menus', 'Post and refresh role pickers', '🏷'],
  ['logs', 'Server logs', 'Which events get recorded', '📋'],
  ['tickets', 'Tickets', 'Support panel and staff roles', '🎫'],
  ['starboard', 'Starboard', 'Reaction highlights', '⭐'],
  ['music', 'Music', 'DJ roles and volume', '🎵'],
  ['counters', 'Counters', 'Live stat channels', '📊'],
  ['content', 'Timers, feeds & giveaways', 'What is currently scheduled', '🗓'],
];

const AUTOMOD_RULES = [
  ['invites', 'Discord invites', 'Removes invites to other servers'],
  ['links', 'Links', 'Allow-list or block-list of domains'],
  ['spam', 'Message spam', 'Too many messages, too fast'],
  ['duplicates', 'Repeated messages', 'The same message over and over'],
  ['mentions', 'Mass mentions', 'Pinging many people at once'],
  ['caps', 'Excessive caps', 'Shouty messages'],
  ['words', 'Word filter', 'Your blocked words and presets'],
  ['emoji', 'Emoji spam', 'Walls of emoji'],
  ['zalgo', 'Zalgo text', 'Combining-character spam'],
  ['attachments', 'Attachment floods', 'Too many files at once'],
  ['newlines', 'Newline spam', 'Messages stretched over many lines'],
];

const LOG_EVENTS = [
  ['messageDelete', 'Message deleted'], ['messageEdit', 'Message edited'],
  ['messageBulkDelete', 'Bulk deletes'], ['memberJoin', 'Member joined'],
  ['memberLeave', 'Member left'], ['memberUpdate', 'Roles & nicknames'],
  ['memberBanned', 'Member banned'], ['memberUnbanned', 'Member unbanned'],
  ['roleCreate', 'Role created'], ['roleDelete', 'Role deleted'], ['roleUpdate', 'Role updated'],
  ['channelCreate', 'Channel created'], ['channelDelete', 'Channel deleted'],
  ['channelUpdate', 'Channel updated'], ['voiceJoin', 'Voice joined'],
  ['voiceLeave', 'Voice left'], ['voiceMove', 'Voice moved'],
  ['inviteCreate', 'Invite created'], ['threadCreate', 'Thread created'],
];

const ACTION_CHOICES = [
  { value: 'delete', label: 'Delete the message' },
  { value: 'warn', label: 'Delete and warn' },
  { value: 'timeout', label: 'Delete and time out' },
  { value: 'kick', label: 'Delete and kick' },
  { value: 'ban', label: 'Delete and ban' },
];

// --- views ----------------------------------------------------------------
const VIEWS = {};

VIEWS.home = (guild, settings) => {
  const enabled = MODULES.filter(([k]) => settings.modules[k]);
  const counts = {
    ranked: db.prepare('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ?').get(guild.id).n,
    cases: db.prepare('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ?').get(guild.id).n,
    menus: listMenus(guild.id).length,
    commands: listCommands(guild.id).length,
    tickets: ticketsFor(guild.id, { openOnly: true }).length,
  };

  const embed = brandEmbed({
    title: `${guild.name} — meelarp control panel`,
    description: `**${enabled.length} of ${MODULES.length}** modules active. `
      + 'Pick a section below to change settings without leaving Discord.',
    thumbnail: guild.iconURL({ size: 128 }) ?? undefined,
    fields: [
      { name: 'Active modules', value: enabled.length ? enabled.map(([, n]) => n).join(', ') : '*none*' },
      { name: 'Ranked members', value: String(counts.ranked), inline: true },
      { name: 'Mod cases', value: String(counts.cases), inline: true },
      { name: 'Open tickets', value: String(counts.tickets), inline: true },
      { name: 'Role menus', value: String(counts.menus), inline: true },
      { name: 'Custom commands', value: String(counts.commands), inline: true },
      { name: 'Prefix', value: `\`${settings.prefix}\``, inline: true },
    ],
    footer: 'Only you can see this panel',
  });

  const sectionSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(cid('nav', 'home')).setPlaceholder('Jump to a section…')
      .addOptions(SECTIONS.map(([value, label, description, emoji]) =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(value)
          .setDescription(description).setEmoji(emoji))));

  const links = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('go', 'modules')).setLabel('Modules')
      .setStyle(ButtonStyle.Primary).setEmoji('🧩'),
    new ButtonBuilder().setCustomId(cid('go', 'home')).setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
    new ButtonBuilder().setLabel('Web dashboard').setStyle(ButtonStyle.Link)
      .setURL(`${config.web.baseUrl}/dashboard/${guild.id}`));

  return { embeds: [embed], components: [sectionSelect, links] };
};

VIEWS.modules = (guild, settings) => ({
  embeds: [brandEmbed({
    title: 'Modules',
    description: 'Everything selected below is running. Deselect to switch a module off — '
      + 'its settings are kept either way.',
    fields: [
      { name: 'On', value: MODULES.filter(([k]) => settings.modules[k]).map(([, n]) => n).join('\n') || '*none*', inline: true },
      { name: 'Off', value: MODULES.filter(([k]) => !settings.modules[k]).map(([, n]) => n).join('\n') || '*none*', inline: true },
    ],
  })],
  components: [
    flagsRow('modules', 'modules', 'Choose which modules run…',
      MODULES.map(([k, label, desc]) => [k, label, desc]), settings),
    navRow('modules'),
  ],
});

VIEWS.levels = (guild, settings) => {
  const L = settings.levels;
  const rewards = (L.roleRewards ?? []).slice().sort((a, b) => a.level - b.level);
  return {
    embeds: [brandEmbed({
      title: 'Leveling',
      description: `Module is ${on(settings.modules.levels)}.`,
      fields: [
        { name: 'XP per message', value: `${L.xpPerMessage[0]}–${L.xpPerMessage[1]}`, inline: true },
        { name: 'Cooldown', value: `${L.cooldownSeconds}s`, inline: true },
        { name: 'Curve', value: L.curve, inline: true },
        { name: 'Announce', value: L.announce === 'channel' ? `channel ${chan(L.announceChannel)}` : L.announce, inline: true },
        { name: 'Stack rewards', value: on(L.stackRoles), inline: true },
        { name: 'Voice XP', value: on(L.voiceXp?.enabled), inline: true },
        { name: 'Level-up message', value: truncate(L.announceMessage || '*none*', 200) },
        { name: `Role rewards (${rewards.length})`,
          value: rewards.length ? rewards.map((r) => `Level **${r.level}** → <@&${r.roleId}>`).join('\n') : '*none*' },
      ],
    })],
    components: [
      channelRow('levels', 'levels.announceChannel', 'Level-up announcement channel…'),
      choiceRow('levels', 'levels.announce', 'Where to announce level-ups…', [
        { value: 'channel', label: 'A specific channel' },
        { value: 'current', label: 'Where they were chatting' },
        { value: 'dm', label: 'Direct message' },
        { value: 'none', label: 'Do not announce' },
      ], L.announce),
      choiceRow('levels', 'levels.curve', 'Level curve…', [
        { value: 'mee6', label: 'MEE6 compatible', description: '5n² + 50n + 100' },
        { value: 'linear', label: 'Linear', description: 'Steady climb' },
        { value: 'fast', label: 'Fast', description: 'Quicker early levels' },
        { value: 'slow', label: 'Slow', description: 'Long grind' },
      ], L.curve),
      new ActionRowBuilder().addComponents(
        modalButton('levels', 'xp', 'XP rate', '⚙'),
        modalButton('levels', 'msg', 'Message', '✏'),
        new ButtonBuilder().setCustomId(cid('go', 'rewards')).setLabel('Role rewards')
          .setStyle(ButtonStyle.Primary).setEmoji('🏆'),
        new ButtonBuilder().setCustomId(cid('tg', 'levels', 'levels.stackRoles'))
          .setLabel(L.stackRoles ? 'Stacking: on' : 'Stacking: off').setStyle(ButtonStyle.Secondary),
        toggleButton('levels', 'modules.levels', settings)),
      navRow('levels'),
    ],
  };
};

VIEWS.rewards = (guild, settings) => {
  const rewards = (settings.levels.roleRewards ?? []).slice().sort((a, b) => a.level - b.level);
  const components = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(cid('act', 'rewards', 'pick'))
        .setPlaceholder('Pick a role to reward, then set its level…')
        .setMinValues(1).setMaxValues(1)),
  ];
  if (rewards.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(cid('act', 'rewards', 'del'))
        .setPlaceholder('Remove a reward…')
        .addOptions(rewards.slice(0, 25).map((r) => new StringSelectMenuOptionBuilder()
          .setLabel(`Level ${r.level}`).setValue(String(r.level))
          .setDescription(truncate(guild.roles.cache.get(r.roleId)?.name ?? r.roleId, 100))))));
  }
  components.push(navRow('rewards', [
    new ButtonBuilder().setCustomId(cid('go', 'levels')).setLabel('Back to leveling')
      .setStyle(ButtonStyle.Secondary).setEmoji('◀'),
  ]));

  return {
    embeds: [brandEmbed({
      title: 'Role rewards',
      description: rewards.length
        ? rewards.map((r) => `Level **${r.level}** → <@&${r.roleId}>`).join('\n')
        : 'No rewards yet. Pick a role below and meelarp will ask which level earns it.',
      footer: settings.levels.stackRoles ? 'Members keep every role they earn'
        : 'Only the highest earned role is kept',
    })],
    components,
  };
};

VIEWS.moderation = (guild, settings) => {
  const M = settings.moderation;
  return {
    embeds: [brandEmbed({
      title: 'Moderation',
      description: `Module is ${on(settings.modules.moderation)}.`,
      fields: [
        { name: 'Mod log', value: chan(M.modLogChannel), inline: true },
        { name: 'DM on action', value: on(M.dmOnAction), inline: true },
        { name: 'Mute role', value: M.muteRoleId ? role(M.muteRoleId) : '*native timeouts*', inline: true },
        { name: 'Protected roles', value: roleList(M.protectedRoles) },
        { name: 'Warning escalation',
          value: (M.warnThresholds ?? []).length
            ? M.warnThresholds.map((t) => `${t.warns} warnings → **${t.action}**${t.duration ? ` for ${formatDuration(t.duration)}` : ''}`).join('\n')
            : '*none — warnings are only recorded*' },
      ],
    })],
    components: [
      channelRow('moderation', 'moderation.modLogChannel', 'Moderation log channel…'),
      roleRow('moderation', 'moderation.muteRoleId', 'Mute role (leave empty for timeouts)…'),
      roleRow('moderation', 'moderation.protectedRoles', 'Protected roles — cannot be actioned…', { multi: true }),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('tg', 'moderation', 'moderation.dmOnAction'))
          .setLabel('DM notices').setStyle(ButtonStyle.Secondary),
        modalButton('moderation', 'warn', 'Escalation', '⚠'),
        toggleButton('moderation', 'modules.moderation', settings)),
      navRow('moderation'),
    ],
  };
};

VIEWS.automod = (guild, settings) => {
  const rules = settings.automod.rules;
  const active = AUTOMOD_RULES.filter(([k]) => rules[k]?.enabled);
  return {
    embeds: [brandEmbed({
      title: 'Automod',
      description: `Module is ${on(settings.modules.automod)}. Select the filters you want running, `
        + 'then open one to change what it does.',
      fields: [
        { name: `Active filters (${active.length})`,
          value: active.length ? active.map(([k, label]) => `**${label}** → \`${rules[k].action}\``).join('\n') : '*none*' },
        { name: 'Exempt roles', value: roleList(settings.automod.exemptRoles), inline: true },
        { name: 'Exempt channels', value: chanList(settings.automod.exemptChannels), inline: true },
      ],
    })],
    components: [
      flagsRow('automod', 'automod.rules', 'Which filters should run…',
        AUTOMOD_RULES.map(([k, label, desc]) => [`${k}.enabled`, label, desc]), settings),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(cid('act', 'automod', 'open'))
          .setPlaceholder('Configure a filter…')
          .addOptions(AUTOMOD_RULES.map(([k, label, desc]) => new StringSelectMenuOptionBuilder()
            .setLabel(label).setValue(k).setDescription(truncate(desc, 100))))),
      roleRow('automod', 'automod.exemptRoles', 'Roles automod ignores…', { multi: true }),
      new ActionRowBuilder().addComponents(
        modalButton('automod', 'words', 'Word filter', '🔤'),
        toggleButton('automod', 'modules.automod', settings)),
      navRow('automod'),
    ],
  };
};

VIEWS.rule = (guild, settings, key) => {
  const rule = settings.automod.rules[key];
  const meta = AUTOMOD_RULES.find(([k]) => k === key);
  if (!rule || !meta) return VIEWS.automod(guild, settings);

  const params = Object.entries(rule)
    .filter(([k]) => !['enabled', 'action', 'presets', 'wildcard'].includes(k))
    .map(([k, v]) => `**${k}**: ${Array.isArray(v) ? (v.length ? truncate(v.join(', '), 120) : '*empty*') : v}`);

  const buttons = [
    new ButtonBuilder().setCustomId(cid('tg', `rule.${key}`, `automod.rules.${key}.enabled`))
      .setLabel(rule.enabled ? 'Disable filter' : 'Enable filter')
      .setStyle(rule.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  ];
  if (params.length) buttons.push(modalButton(`rule.${key}`, `param.${key}`, 'Edit values', '⚙'));

  return {
    embeds: [brandEmbed({
      title: `Automod — ${meta[1]}`,
      description: `${meta[2]}\n\nFilter is ${on(rule.enabled)}.`,
      fields: [
        { name: 'On a hit', value: `\`${rule.action}\`` },
        ...(params.length ? [{ name: 'Settings', value: params.join('\n') }] : []),
      ],
    })],
    components: [
      choiceRow(`rule.${key}`, `automod.rules.${key}.action`, 'What happens on a hit…', ACTION_CHOICES, rule.action),
      new ActionRowBuilder().addComponents(buttons),
      navRow(`rule.${key}`, [
        new ButtonBuilder().setCustomId(cid('go', 'automod')).setLabel('Back to automod')
          .setStyle(ButtonStyle.Secondary).setEmoji('◀'),
      ]),
    ],
  };
};

VIEWS.welcome = (guild, settings) => {
  const W = settings.welcome;
  return {
    embeds: [brandEmbed({
      title: 'Welcome & goodbye',
      description: `Module is ${on(settings.modules.welcome)}.`,
      fields: [
        { name: 'Welcome message', value: `${on(W.join.enabled)} in ${chan(W.join.channelId)}`, inline: true },
        { name: 'Welcome image', value: on(W.join.image?.enabled), inline: true },
        { name: 'Welcome DM', value: on(W.dm?.enabled), inline: true },
        { name: 'Text', value: truncate(W.join.message || '*none*', 300) },
        { name: 'Goodbye', value: `${on(W.leave.enabled)} in ${chan(W.leave.channelId)}`, inline: true },
        { name: 'Autorole', value: `${on(W.autorole?.enabled)} — ${roleList(W.autorole?.roles)}`, inline: true },
        { name: 'Sticky roles', value: on(W.stickyRoles), inline: true },
      ],
    })],
    components: [
      channelRow('welcome', 'welcome.join.channelId', 'Welcome channel…'),
      roleRow('welcome', 'welcome.autorole.roles', 'Roles given automatically on join…', { multi: true }),
      new ActionRowBuilder().addComponents(
        modalButton('welcome', 'join', 'Welcome text', '✏'),
        new ButtonBuilder().setCustomId(cid('tg', 'welcome', 'welcome.join.enabled'))
          .setLabel('Welcome msg').setStyle(W.join.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('tg', 'welcome', 'welcome.join.image.enabled'))
          .setLabel('Banner image').setStyle(W.join.image?.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('tg', 'welcome', 'welcome.autorole.enabled'))
          .setLabel('Autorole').setStyle(W.autorole?.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('tg', 'welcome', 'welcome.stickyRoles'))
          .setLabel('Sticky roles').setStyle(W.stickyRoles ? ButtonStyle.Danger : ButtonStyle.Success)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('go', 'goodbye')).setLabel('Goodbye settings')
          .setStyle(ButtonStyle.Primary).setEmoji('👋'),
        new ButtonBuilder().setCustomId(cid('act', 'welcome', 'test')).setLabel('Send a test')
          .setStyle(ButtonStyle.Secondary).setEmoji('📨'),
        toggleButton('welcome', 'modules.welcome', settings)),
      navRow('welcome'),
    ],
  };
};

VIEWS.goodbye = (guild, settings) => {
  const W = settings.welcome;
  return {
    embeds: [brandEmbed({
      title: 'Goodbye & boost messages',
      fields: [
        { name: 'Goodbye', value: `${on(W.leave.enabled)} in ${chan(W.leave.channelId)}` },
        { name: 'Text', value: truncate(W.leave.message || '*none*', 300) },
        { name: 'Boost announcement', value: `${on(W.boost?.enabled)} in ${chan(W.boost?.channelId)}` },
      ],
    })],
    components: [
      channelRow('goodbye', 'welcome.leave.channelId', 'Goodbye channel…'),
      channelRow('goodbye', 'welcome.boost.channelId', 'Boost announcement channel…'),
      new ActionRowBuilder().addComponents(
        modalButton('goodbye', 'leave', 'Goodbye text', '✏'),
        new ButtonBuilder().setCustomId(cid('tg', 'goodbye', 'welcome.leave.enabled'))
          .setLabel('Goodbye').setStyle(W.leave.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('tg', 'goodbye', 'welcome.boost.enabled'))
          .setLabel('Boost msg').setStyle(W.boost?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      navRow('goodbye', [
        new ButtonBuilder().setCustomId(cid('go', 'welcome')).setLabel('Back to welcome')
          .setStyle(ButtonStyle.Secondary).setEmoji('◀'),
      ]),
    ],
  };
};

VIEWS.roles = (guild, settings) => {
  const menus = listMenus(guild.id);
  const components = [];
  if (menus.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(cid('act', 'roles', 'publish'))
        .setPlaceholder('Post or refresh a menu…')
        .addOptions(menus.slice(0, 25).map((m) => new StringSelectMenuOptionBuilder()
          .setLabel(truncate(m.title ?? `Menu ${m.id}`, 100)).setValue(String(m.id))
          .setDescription(truncate(`${m.options.length} roles · ${m.style} · ${m.message_id ? 'posted' : 'not posted'}`, 100))))));
  }
  components.push(new ActionRowBuilder().addComponents(
    toggleButton('roles', 'modules.roles', settings)));
  components.push(navRow('roles'));

  return {
    embeds: [brandEmbed({
      title: 'Role menus',
      description: menus.length
        ? menus.map((m) => `**${m.title ?? `Menu ${m.id}`}** — ${m.options.length} roles, \`${m.style}\`, `
            + `${m.message_id ? `posted in ${chan(m.channel_id)}` : 'not posted yet'}`).join('\n')
        : 'No menus yet. Create one with `/rolemenu create`, or design a richer one on the web dashboard.',
      footer: 'Create menus with /rolemenu create',
    })],
    components,
  };
};

VIEWS.logs = (guild, settings) => ({
  embeds: [brandEmbed({
    title: 'Server logs',
    description: `Module is ${on(settings.modules.logs)}. Logging to ${chan(settings.logs.channelId)}.`,
    fields: [
      { name: 'Recorded events',
        value: LOG_EVENTS.filter(([k]) => settings.logs.events[k]).map(([, l]) => l).join(', ') || '*none*' },
      { name: 'Ignored channels', value: chanList(settings.logs.ignoredChannels) },
    ],
  })],
  components: [
    channelRow('logs', 'logs.channelId', 'Log channel…'),
    flagsRow('logs', 'logs.events', 'Which events to record…', LOG_EVENTS, settings),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId(cid('chm', 'logs', 'logs.ignoredChannels'))
        .setPlaceholder('Channels to ignore…')
        .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
        .setMinValues(0).setMaxValues(20)),
    new ActionRowBuilder().addComponents(toggleButton('logs', 'modules.logs', settings)),
    navRow('logs'),
  ],
});

VIEWS.tickets = (guild, settings) => {
  const T = settings.tickets;
  const open = ticketsFor(guild.id, { openOnly: true }).length;
  return {
    embeds: [brandEmbed({
      title: 'Tickets',
      description: `Module is ${on(settings.modules.tickets)}. **${open}** open right now.`,
      fields: [
        { name: 'Category', value: T.categoryId ? `<#${T.categoryId}>` : '*none*', inline: true },
        { name: 'Transcripts', value: chan(T.transcriptChannel), inline: true },
        { name: 'Limit per member', value: String(T.limitPerUser), inline: true },
        { name: 'Support roles', value: roleList(T.supportRoles) },
        { name: 'Opening message', value: truncate(T.openMessage, 300) },
      ],
    })],
    components: [
      channelRow('tickets', 'tickets.categoryId', 'Category for new tickets…', [ChannelType.GuildCategory]),
      channelRow('tickets', 'tickets.transcriptChannel', 'Transcript archive channel…'),
      roleRow('tickets', 'tickets.supportRoles', 'Support roles…', { multi: true }),
      new ActionRowBuilder().addComponents(
        modalButton('tickets', 'cfg', 'Wording', '✏'),
        new ButtonBuilder().setCustomId(cid('act', 'tickets', 'panel')).setLabel('Post panel here')
          .setStyle(ButtonStyle.Success).setEmoji('🎫'),
        toggleButton('tickets', 'modules.tickets', settings)),
      navRow('tickets'),
    ],
  };
};

VIEWS.starboard = (guild, settings) => {
  const S = settings.starboard;
  return {
    embeds: [brandEmbed({
      title: 'Starboard',
      description: `Module is ${on(settings.modules.starboard)}.`,
      fields: [
        { name: 'Channel', value: chan(S.channelId), inline: true },
        { name: 'Reactions needed', value: String(S.threshold), inline: true },
        { name: 'Emoji', value: S.emoji, inline: true },
        { name: 'Count author\'s own star', value: on(S.selfStar), inline: true },
        { name: 'Ignored channels', value: chanList(S.ignoredChannels) },
      ],
    })],
    components: [
      channelRow('starboard', 'starboard.channelId', 'Starboard channel…'),
      new ActionRowBuilder().addComponents(
        modalButton('starboard', 'cfg', 'Threshold & emoji', '⚙'),
        new ButtonBuilder().setCustomId(cid('tg', 'starboard', 'starboard.selfStar'))
          .setLabel('Self-star').setStyle(S.selfStar ? ButtonStyle.Danger : ButtonStyle.Success),
        toggleButton('starboard', 'modules.starboard', settings)),
      navRow('starboard'),
    ],
  };
};

VIEWS.music = (guild, settings) => ({
  embeds: [brandEmbed({
    title: 'Music',
    description: `Module is ${on(settings.modules.music)}.`,
    fields: [
      { name: 'DJ roles', value: settings.music.djRoles?.length ? roleList(settings.music.djRoles) : '*everyone can control playback*' },
      { name: 'Default volume', value: `${settings.music.defaultVolume}%`, inline: true },
      { name: 'Max queue', value: String(settings.music.maxQueue), inline: true },
      { name: 'Leave when empty', value: `${settings.music.leaveOnEmptySeconds}s`, inline: true },
    ],
    footer: 'Run /musicstatus to check playback dependencies',
  })],
  components: [
    roleRow('music', 'music.djRoles', 'DJ roles…', { multi: true }),
    new ActionRowBuilder().addComponents(
      modalButton('music', 'cfg', 'Player settings', '⚙'),
      toggleButton('music', 'modules.music', settings)),
    navRow('music'),
  ],
});

VIEWS.counters = (guild, settings) => {
  const items = settings.counters.items ?? [];
  return {
    embeds: [brandEmbed({
      title: 'Counters',
      description: `Module is ${on(settings.modules.counters)}. Pick a statistic, then choose the voice `
        + 'channel that should display it. Discord rate-limits renames, so counters refresh every few minutes.',
      fields: [
        { name: `Counters (${items.length})`,
          value: items.length
            ? items.map((i) => `${chan(i.channelId)} — ${counterTypes.find((t) => t.id === i.type)?.label ?? i.type}`).join('\n')
            : '*none*' },
      ],
    })],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(cid('act', 'counters', 'type'))
          .setPlaceholder('1 — pick what to count…')
          .addOptions(counterTypes.slice(0, 25).map((t) => new StringSelectMenuOptionBuilder()
            .setLabel(t.label).setValue(t.id)))),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(cid('act', 'counters', 'del'))
          .setPlaceholder('Remove a counter…').setChannelTypes([ChannelType.GuildVoice])
          .setMinValues(0).setMaxValues(1)),
      new ActionRowBuilder().addComponents(toggleButton('counters', 'modules.counters', settings)),
      navRow('counters'),
    ],
  };
};

VIEWS.countertype = (guild, settings, type) => {
  const label = counterTypes.find((t) => t.id === type)?.label ?? type;
  return {
    embeds: [brandEmbed({
      title: `Counter — ${label}`,
      description: `Now choose the voice channel that should display **${label}**. `
        + 'meelarp renames it (and keeps it updated) within a few minutes.',
      footer: 'Members cannot join a counter channel if you deny Connect on it',
    })],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(cid('act', `countertype.${type}`, 'set'))
          .setPlaceholder('2 — pick the voice channel…')
          .setChannelTypes([ChannelType.GuildVoice]).setMinValues(1).setMaxValues(1)),
      navRow(`countertype.${type}`, [
        new ButtonBuilder().setCustomId(cid('go', 'counters')).setLabel('Back to counters')
          .setStyle(ButtonStyle.Secondary).setEmoji('◀'),
      ]),
    ],
  };
};

VIEWS.content = (guild, settings) => {
  const timers = listTimers(guild.id);
  const feeds = listFeeds(guild.id);
  const live = listGiveaways(guild.id, { activeOnly: true });
  return {
    embeds: [brandEmbed({
      title: 'Timers, feeds & giveaways',
      description: 'These are created with slash commands — `/timer add`, `/feed add`, `/giveaway start` — '
        + 'and listed here so you can see what is scheduled.',
      fields: [
        { name: `Timers (${timers.length})`,
          value: timers.length
            ? timers.slice(0, 8).map((t) => `**#${t.id}** every ${formatDuration(t.interval_sec)} in ${chan(t.channel_id)}${t.enabled ? '' : ' *(paused)*'}`).join('\n')
            : '*none*' },
        { name: `Feeds (${feeds.length})`,
          value: feeds.length
            ? feeds.slice(0, 8).map((f) => `**#${f.id}** \`${f.type}\` ${f.display_name ?? f.source} → ${chan(f.channel_id)}`).join('\n')
            : '*none*' },
        { name: `Live giveaways (${live.length})`,
          value: live.length
            ? live.slice(0, 8).map((g) => `**#${g.id}** ${truncate(g.prize, 40)} — ${entryCount(g.id)} entries, ends <t:${Math.floor(g.ends_at / 1000)}:R>`).join('\n')
            : '*none*' },
      ],
    })],
    components: [navRow('content')],
  };
};

// --- modals ---------------------------------------------------------------
const MODALS = {
  xp: {
    title: 'XP rate',
    inputs: (s) => [
      { id: 'min', label: 'Minimum XP per message', value: String(s.levels.xpPerMessage[0]) },
      { id: 'max', label: 'Maximum XP per message', value: String(s.levels.xpPerMessage[1]) },
      { id: 'cooldown', label: 'Cooldown between gains (seconds)', value: String(s.levels.cooldownSeconds) },
    ],
    apply: (s, v) => {
      const min = Math.max(0, parseInt(v.min, 10) || 0);
      const max = Math.max(min, parseInt(v.max, 10) || min);
      s.levels.xpPerMessage = [min, max];
      s.levels.cooldownSeconds = Math.max(0, parseInt(v.cooldown, 10) || 0);
      return `XP set to ${min}–${max} every ${s.levels.cooldownSeconds}s.`;
    },
  },
  msg: {
    title: 'Level-up message',
    inputs: (s) => [
      { id: 'message', label: 'Message', style: TextInputStyle.Paragraph, max: 1000,
        value: s.levels.announceMessage,
        placeholder: '{user:mention} reached level {level}!' },
    ],
    apply: (s, v) => { s.levels.announceMessage = v.message; return 'Level-up message updated.'; },
  },
  warn: {
    title: 'Warning escalation',
    inputs: (s) => [
      { id: 'rules', label: 'One per line: warns action duration', style: TextInputStyle.Paragraph, required: false,
        value: (s.moderation.warnThresholds ?? []).map((t) => `${t.warns} ${t.action}${t.duration ? ` ${formatDuration(t.duration).replace(/\s/g, '')}` : ''}`).join('\n'),
        placeholder: '3 timeout 1h\n5 kick\n7 ban' },
    ],
    apply: (s, v) => {
      const steps = [];
      for (const line of (v.rules ?? '').split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const warns = parseInt(parts[0], 10);
        const action = parts[1].toLowerCase();
        if (!warns || !['timeout', 'mute', 'kick', 'ban'].includes(action)) continue;
        steps.push({ warns, action, duration: parts[2] ? parseDuration(parts[2]) : null });
      }
      s.moderation.warnThresholds = steps.sort((a, b) => a.warns - b.warns);
      return steps.length ? `${steps.length} escalation step(s) saved.` : 'Escalation cleared.';
    },
  },
  words: {
    title: 'Word filter',
    inputs: (s) => [
      { id: 'list', label: 'Blocked words (comma or line separated)', style: TextInputStyle.Paragraph,
        required: false, value: (s.automod.rules.words.list ?? []).join(', ') },
      { id: 'presets', label: `Built-in lists (${presetNames.join(', ')})`, required: false,
        value: (s.automod.rules.words.presets ?? []).join(', '),
        placeholder: 'profanity, slurs' },
    ],
    apply: (s, v) => {
      const split = (t) => String(t ?? '').split(/[\n,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      s.automod.rules.words.list = split(v.list);
      s.automod.rules.words.presets = split(v.presets).filter((p) => presetNames.includes(p));
      return `${s.automod.rules.words.list.length} words, ${s.automod.rules.words.presets.length} preset(s).`;
    },
  },
  join: {
    title: 'Welcome message',
    inputs: (s) => [
      { id: 'message', label: 'Message', style: TextInputStyle.Paragraph, max: 1500,
        value: s.welcome.join.message, placeholder: 'Welcome {user:mention} to {server:name}!' },
    ],
    apply: (s, v) => { s.welcome.join.message = v.message; return 'Welcome message updated.'; },
  },
  leave: {
    title: 'Goodbye message',
    inputs: (s) => [
      { id: 'message', label: 'Message', style: TextInputStyle.Paragraph, max: 1500,
        value: s.welcome.leave.message, placeholder: '{user:name} left the server.' },
    ],
    apply: (s, v) => { s.welcome.leave.message = v.message; return 'Goodbye message updated.'; },
  },
  cfg_tickets: {
    title: 'Ticket wording',
    inputs: (s) => [
      { id: 'openMessage', label: 'First message inside a ticket', style: TextInputStyle.Paragraph,
        value: s.tickets.openMessage },
      { id: 'limitPerUser', label: 'Open tickets allowed per member', value: String(s.tickets.limitPerUser) },
      { id: 'nameTemplate', label: 'Channel name ({number}, {user})', value: s.tickets.nameTemplate },
    ],
    apply: (s, v) => {
      s.tickets.openMessage = v.openMessage;
      s.tickets.limitPerUser = Math.max(1, parseInt(v.limitPerUser, 10) || 1);
      s.tickets.nameTemplate = v.nameTemplate || 'ticket-{number}';
      return 'Ticket settings saved.';
    },
  },
  cfg_starboard: {
    title: 'Starboard',
    inputs: (s) => [
      { id: 'threshold', label: 'Reactions needed', value: String(s.starboard.threshold) },
      { id: 'emoji', label: 'Emoji', value: s.starboard.emoji },
    ],
    apply: (s, v) => {
      s.starboard.threshold = Math.max(1, parseInt(v.threshold, 10) || 3);
      s.starboard.emoji = v.emoji.trim() || '⭐';
      return `Starboard needs ${s.starboard.threshold} ${s.starboard.emoji}.`;
    },
  },
  cfg_music: {
    title: 'Player settings',
    inputs: (s) => [
      { id: 'defaultVolume', label: 'Default volume (0-200)', value: String(s.music.defaultVolume) },
      { id: 'maxQueue', label: 'Maximum queue length', value: String(s.music.maxQueue) },
      { id: 'leaveOnEmptySeconds', label: 'Leave after queue empties (seconds)', value: String(s.music.leaveOnEmptySeconds) },
    ],
    apply: (s, v) => {
      s.music.defaultVolume = Math.min(200, Math.max(0, parseInt(v.defaultVolume, 10) || 60));
      s.music.maxQueue = Math.max(10, parseInt(v.maxQueue, 10) || 200);
      s.music.leaveOnEmptySeconds = Math.max(0, parseInt(v.leaveOnEmptySeconds, 10) || 120);
      return 'Player settings saved.';
    },
  },
};

/** Rule parameter modals are generated from whatever keys the rule actually has. */
function ruleModal(settings, key) {
  const rule = settings.automod.rules[key];
  const editable = Object.entries(rule)
    .filter(([k]) => !['enabled', 'action', 'presets'].includes(k))
    .slice(0, 5);
  return {
    title: `Automod — ${key}`,
    inputs: () => editable.map(([k, v]) => ({
      id: k,
      label: truncate(k, 45),
      required: false,
      style: Array.isArray(v) ? TextInputStyle.Paragraph : TextInputStyle.Short,
      value: Array.isArray(v) ? v.join(', ') : String(v),
    })),
    apply: (s, values) => {
      const rules = s.automod.rules[key];
      for (const [k, original] of editable) {
        const raw = values[k];
        if (raw === undefined) continue;
        if (Array.isArray(original)) {
          rules[k] = String(raw).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
        } else if (typeof original === 'number') {
          const n = Number(raw);
          if (Number.isFinite(n)) rules[k] = n;
        } else if (typeof original === 'boolean') {
          rules[k] = /^(1|true|yes|on)$/i.test(String(raw).trim());
        } else {
          rules[k] = raw;
        }
      }
      return `Updated the ${key} filter.`;
    },
  };
}

function buildModal(customId, spec, settings) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(truncate(spec.title, 45));
  for (const field of spec.inputs(settings).slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(truncate(field.label, 45))
      .setStyle(field.style ?? TextInputStyle.Short)
      .setRequired(field.required !== false);
    if (field.value !== undefined && field.value !== null && String(field.value).length) {
      input.setValue(truncate(String(field.value), field.max ?? 400));
    }
    if (field.placeholder) input.setPlaceholder(truncate(field.placeholder, 100));
    if (field.max) input.setMaxLength(field.max);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

// --- rendering ------------------------------------------------------------
// `update()` cannot change a message's ephemeral flag, so render() stays flagless
// and only the first reply opts into ephemeral.
function render(guild, viewKey) {
  const settings = getSettings(guild.id);
  const [base, arg] = viewKey.split('.');
  const view = VIEWS[base] ?? VIEWS.home;
  return view(guild, settings, arg);
}

export async function openDashboard(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      embeds: [brandEmbed({ color: 0xff4d6d,
        description: 'You need the **Manage Server** permission to open the control panel.' })],
      flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ ...render(interaction.guild, 'home'), flags: MessageFlags.Ephemeral });
}

// --- interaction router ---------------------------------------------------
export async function handleDashboardInteraction(interaction) {
  if (!interaction.customId?.startsWith('dash:')) return false;

  if (!interaction.guild || !interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need Manage Server to use this panel.',
      flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const [, action, view, ...rest] = interaction.customId.split(':');
  const arg = rest.join(':');
  const guild = interaction.guild;
  let notice = null;

  try {
    switch (action) {
      // --- navigation ---------------------------------------------------
      case 'go':
        await interaction.update(render(guild, view));
        return true;

      case 'nav':
        await interaction.update(render(guild, interaction.values[0]));
        return true;

      // --- direct writes --------------------------------------------------
      case 'tg': {
        const settings = getSettings(guild.id);
        const next = !getPath(settings, arg);
        save(guild.id, arg, next);
        logAudit(guild.id, interaction.user, 'panel.toggle', `${arg} → ${next}`);
        break;
      }

      case 'one':
        save(guild.id, arg, interaction.values[0]);
        logAudit(guild.id, interaction.user, 'panel.set', `${arg} → ${interaction.values[0]}`);
        break;

      case 'ch':
        save(guild.id, arg, interaction.values[0] ?? null);
        break;

      case 'chm':
        save(guild.id, arg, [...interaction.values]);
        break;

      case 'rl':
        save(guild.id, arg, interaction.values[0] ?? null);
        break;

      case 'rlm':
        save(guild.id, arg, [...interaction.values]);
        break;

      case 'flags': {
        // The select reports only what is still chosen, so every key this menu
        // owns is rewritten — chosen ones true, the rest false.
        const settings = getSettings(guild.id);
        const chosen = new Set(interaction.values);
        for (const key of FLAG_SETS[arg]?.() ?? []) {
          setPath(settings, `${arg}.${key}`, chosen.has(key));
        }
        saveSettings(guild.id, settings);
        logAudit(guild.id, interaction.user, 'panel.flags', `${arg}: ${interaction.values.join(', ') || 'none'}`);
        break;
      }

      // --- modals ---------------------------------------------------------
      case 'mdl': {
        const settings = getSettings(guild.id);
        const spec = arg.startsWith('param.')
          ? ruleModal(settings, arg.slice('param.'.length))
          : MODALS[arg] ?? MODALS[`cfg_${view}`];
        if (!spec) {
          await interaction.reply({ content: 'That form is unavailable.', flags: MessageFlags.Ephemeral });
          return true;
        }
        await interaction.showModal(buildModal(`dash:sub:${view}:${arg}`, spec, settings));
        return true;
      }

      case 'sub': {
        const settings = getSettings(guild.id);
        const spec = arg.startsWith('param.')
          ? ruleModal(settings, arg.slice('param.'.length))
          : arg.startsWith('reward.')
            ? null
            : MODALS[arg] ?? MODALS[`cfg_${view}`];

        if (arg.startsWith('reward.')) {
          const roleId = arg.slice('reward.'.length);
          const level = parseInt(interaction.fields.getTextInputValue('level'), 10);
          if (!level || level < 1) {
            await interaction.reply({ content: 'Give a level of 1 or higher.', flags: MessageFlags.Ephemeral });
            return true;
          }
          const rewards = (settings.levels.roleRewards ?? []).filter((r) => r.level !== level);
          settings.levels.roleRewards = [...rewards, { level, roleId }];
          saveSettings(guild.id, settings);
          logAudit(guild.id, interaction.user, 'panel.reward', `level ${level} → ${roleId}`);
          notice = `Level **${level}** now grants <@&${roleId}>.`;
          break;
        }

        if (!spec) {
          await interaction.reply({ content: 'That form is unavailable.', flags: MessageFlags.Ephemeral });
          return true;
        }
        const values = {};
        for (const field of spec.inputs(settings)) {
          try { values[field.id] = interaction.fields.getTextInputValue(field.id); } catch { /* optional */ }
        }
        notice = spec.apply(settings, values);
        saveSettings(guild.id, settings);
        logAudit(guild.id, interaction.user, 'panel.form', arg);
        break;
      }

      // --- bespoke actions -------------------------------------------------
      case 'act': {
        const settings = getSettings(guild.id);

        if (view === 'rewards' && arg === 'pick') {
          await handleRewardRolePick(interaction);
          return true;
        }

        if (view === 'rewards' && arg === 'del') {
          const level = Number(interaction.values[0]);
          settings.levels.roleRewards = (settings.levels.roleRewards ?? []).filter((r) => r.level !== level);
          saveSettings(guild.id, settings);
          notice = `Removed the level ${level} reward.`;
          break;
        }

        if (view === 'automod' && arg === 'open') {
          await interaction.update(render(guild, `rule.${interaction.values[0]}`));
          return true;
        }

        if (view === 'roles' && arg === 'publish') {
          const result = await publishMenu(guild, Number(interaction.values[0]));
          notice = result.ok ? `Menu posted — ${result.url}` : `Could not post: ${result.error}`;
          break;
        }

        if (view === 'welcome' && arg === 'test') {
          const { handleMemberJoin } = await import('./welcome.js');
          await handleMemberJoin(interaction.member);
          notice = 'Test welcome sent using your own account.';
          break;
        }

        if (view === 'tickets' && arg === 'panel') {
          await sendPanel(interaction.channel, {});
          notice = `Ticket panel posted in ${chan(interaction.channel.id)}.`;
          break;
        }

        if (view === 'counters' && arg === 'type') {
          await interaction.update(render(guild, `countertype.${interaction.values[0]}`));
          return true;
        }

        if (view === 'counters' && arg === 'del') {
          const channelId = interaction.values[0];
          if (!channelId) { notice = 'Nothing selected.'; break; }
          const before = (settings.counters.items ?? []).length;
          settings.counters.items = (settings.counters.items ?? []).filter((i) => i.channelId !== channelId);
          saveSettings(guild.id, settings);
          notice = settings.counters.items.length < before
            ? 'Counter removed.' : 'That channel was not a counter.';
          break;
        }

        if (view.startsWith('countertype') && arg === 'set') {
          const type = view.split('.')[1];
          const channelId = interaction.values[0];
          if (!channelId) { notice = 'No channel picked.'; break; }
          const label = counterTypes.find((t) => t.id === type)?.label ?? type;
          settings.counters.items = [
            ...(settings.counters.items ?? []).filter((i) => i.channelId !== channelId),
            { channelId, type, template: `${label}: {count}` },
          ];
          settings.modules.counters = true;
          saveSettings(guild.id, settings);
          notice = `<#${channelId}> now shows **${label}**. It renames within a few minutes.`;
          break;
        }

        notice = 'That action is not available.';
        break;
      }

      default:
        return false;
    }

    // Re-render the view the interaction came from, with an optional confirmation.
    const target = view.startsWith('countertype') ? 'counters' : view;
    const payload = render(guild, target);
    if (notice) {
      payload.embeds = [...payload.embeds,
        brandEmbed({ color: 0x27e0a4, description: `✓ ${notice}` })];
    }

    if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.update(payload);
    }
    return true;
  } catch (e) {
    logError('dashboard-panel', e);
    const message = { content: `Something went wrong: ${e.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(message).catch(() => {});
    else await interaction.reply(message).catch(() => {});
    return true;
  }
}

// The role picker on the rewards screen opens a follow-up modal asking for the level.
export async function handleRewardRolePick(interaction) {
  const roleId = interaction.values[0];
  if (!roleId) return interaction.update(render(interaction.guild, 'rewards'));
  const role = interaction.guild.roles.cache.get(roleId);
  const modal = new ModalBuilder()
    .setCustomId(`dash:sub:rewards:reward.${roleId}`)
    .setTitle(truncate(`Reward: ${role?.name ?? 'role'}`, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('level').setLabel('Level that earns this role')
        .setStyle(TextInputStyle.Short).setPlaceholder('10').setRequired(true)));
  return interaction.showModal(modal);
}

export { VIEWS };

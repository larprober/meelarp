// meelarp — utility & info commands
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config, inviteUrl } from '../../config.js';
import { getSettings } from '../../db.js';
import { brandEmbed, ok, fail, parseDuration, formatDuration, absTime, truncate, buildEmbedFrom } from '../util.js';
import { addReminder, listReminders, deleteReminder } from '../modules/timers.js';

const MODULE_HELP = [
  ['Setup', '`/dashboard` — the full control panel, right here in Discord'],
  ['Levels', '`/rank` `/leaderboard` `/levels` `/xp` `/levelrole`'],
  ['Moderation', '`/ban` `/kick` `/timeout` `/mute` `/warn` `/warnings` `/case` `/purge` `/lock` `/slowmode` `/role` `/nick`'],
  ['Automod', '`/automod status` `/automod toggle` `/automod test`'],
  ['Roles', '`/rolemenu create` `/rolemenu publish` `/rolemenu list`'],
  ['Custom commands', '`/customcommand add` `/customcommand list` `/customcommand remove`'],
  ['Giveaways', '`/giveaway start` `/giveaway end` `/giveaway reroll` `/giveaway list`'],
  ['Tickets', '`/ticket panel` `/ticket add` `/ticket remove` `/ticket close`'],
  ['Timers & feeds', '`/timer add` `/timer list` `/feed add` `/feed list` `/feed test`'],
  ['Music', '`/play` `/skip` `/queue` `/nowplaying` `/loop` `/volume` `/shuffle` `/stop`'],
  ['Utility', '`/userinfo` `/serverinfo` `/avatar` `/roleinfo` `/poll` `/remind` `/say` `/embed` `/ping`'],
];

const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('What meelarp can do'),
  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(config.web.baseUrl),
      new ButtonBuilder().setLabel('Invite meelarp').setStyle(ButtonStyle.Link).setURL(inviteUrl()));
    return interaction.reply({
      embeds: [brandEmbed({
        title: 'meelarp',
        description: 'Every MEE6 feature — leveling, moderation, automod, welcome, roles, feeds, giveaways, tickets, music — with nothing behind a paywall.\n​',
        fields: MODULE_HELP.map(([name, value]) => ({ name, value, inline: false })),
        footer: 'Configure everything on the dashboard',
        thumbnail: interaction.client.user.displayAvatarURL({ size: 128 }),
      })],
      components: [row],
    });
  },
};

const ping = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check meelarp\'s latency'),
  async execute(interaction) {
    const sent = await interaction.reply({ embeds: [brandEmbed({ description: 'Pinging…' })], fetchReply: true });
    return interaction.editReply({ embeds: [brandEmbed({
      title: 'Pong',
      fields: [
        { name: 'Round trip', value: `${sent.createdTimestamp - interaction.createdTimestamp} ms`, inline: true },
        { name: 'Websocket', value: `${Math.round(interaction.client.ws.ping)} ms`, inline: true },
        { name: 'Uptime', value: formatDuration(process.uptime()), inline: true },
      ],
    })] });
  },
};

const userinfo = {
  data: new SlashCommandBuilder().setName('userinfo').setDescription('Information about a member')
    .addUserOption((o) => o.setName('member').setDescription('Member')),
  async execute(interaction) {
    const user = interaction.options.getUser('member') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const roles = member?.roles.cache.filter((r) => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position).map((r) => `<@&${r.id}>`) ?? [];
    return interaction.reply({ embeds: [brandEmbed({
      title: user.tag,
      thumbnail: user.displayAvatarURL({ size: 256 }),
      fields: [
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot', value: user.bot ? 'yes' : 'no', inline: true },
        { name: 'Nickname', value: member?.nickname ?? '—', inline: true },
        { name: 'Account created', value: absTime(user.createdTimestamp), inline: false },
        ...(member?.joinedTimestamp ? [{ name: 'Joined server', value: absTime(member.joinedTimestamp), inline: false }] : []),
        ...(member?.premiumSinceTimestamp ? [{ name: 'Boosting since', value: absTime(member.premiumSinceTimestamp) }] : []),
        { name: `Roles (${roles.length})`, value: truncate(roles.join(' ') || '—', 1000) },
      ],
      color: member?.displayColor || undefined,
    })] });
  },
};

const serverinfo = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Information about this server'),
  async execute(interaction) {
    const g = interaction.guild;
    const channels = g.channels.cache;
    return interaction.reply({ embeds: [brandEmbed({
      title: g.name,
      thumbnail: g.iconURL({ size: 256 }),
      fields: [
        { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: 'Created', value: absTime(g.createdTimestamp), inline: true },
        { name: 'Members', value: String(g.memberCount), inline: true },
        { name: 'Channels', value: `${channels.filter((c) => c.type === ChannelType.GuildText).size} text · ${channels.filter((c) => c.type === ChannelType.GuildVoice).size} voice`, inline: true },
        { name: 'Roles', value: String(g.roles.cache.size - 1), inline: true },
        { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (tier ${g.premiumTier})`, inline: true },
        { name: 'Emojis', value: String(g.emojis.cache.size), inline: true },
        { name: 'Verification', value: String(g.verificationLevel), inline: true },
        { name: 'ID', value: g.id, inline: true },
      ],
      image: g.bannerURL({ size: 512 }) ?? undefined,
    })] });
  },
};

const avatar = {
  data: new SlashCommandBuilder().setName('avatar').setDescription('Show a member\'s avatar')
    .addUserOption((o) => o.setName('member').setDescription('Member')),
  async execute(interaction) {
    const user = interaction.options.getUser('member') ?? interaction.user;
    return interaction.reply({ embeds: [brandEmbed({
      title: `${user.username}'s avatar`,
      image: user.displayAvatarURL({ size: 1024, extension: 'png' }),
    })] });
  },
};

const roleinfo = {
  data: new SlashCommandBuilder().setName('roleinfo').setDescription('Information about a role')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
  async execute(interaction) {
    const r = interaction.options.getRole('role');
    const perms = r.permissions.toArray();
    return interaction.reply({ embeds: [brandEmbed({
      title: r.name,
      color: r.color || undefined,
      fields: [
        { name: 'ID', value: r.id, inline: true },
        { name: 'Members', value: String(r.members.size), inline: true },
        { name: 'Color', value: r.hexColor, inline: true },
        { name: 'Mentionable', value: r.mentionable ? 'yes' : 'no', inline: true },
        { name: 'Hoisted', value: r.hoist ? 'yes' : 'no', inline: true },
        { name: 'Position', value: String(r.position), inline: true },
        { name: 'Created', value: absTime(r.createdTimestamp) },
        { name: 'Key permissions', value: truncate(perms.slice(0, 12).join(', ') || 'none', 1000) },
      ],
    })] });
  },
};

const poll = {
  data: new SlashCommandBuilder().setName('poll').setDescription('Start a reaction poll')
    .addStringOption((o) => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption((o) => o.setName('options').setDescription('Choices separated by | (max 10). Omit for yes/no')),
  async execute(interaction) {
    const question = interaction.options.getString('question');
    const raw = interaction.options.getString('options');
    const digits = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const choices = raw ? raw.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 10) : [];

    const embed = brandEmbed({
      title: '📊  ' + truncate(question, 240),
      description: choices.length
        ? choices.map((c, i) => `${digits[i]}  ${c}`).join('\n')
        : 'React 👍 or 👎 below.',
      footer: `Poll by ${interaction.user.tag}`,
      timestamp: true,
    });
    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    const reactions = choices.length ? digits.slice(0, choices.length) : ['👍', '👎'];
    for (const r of reactions) await msg.react(r).catch(() => {});
    return msg;
  },
};

const remind = {
  data: new SlashCommandBuilder().setName('remind').setDescription('Set a reminder')
    .addSubcommand((s) => s.setName('me').setDescription('Remind me later')
      .addStringOption((o) => o.setName('when').setDescription('e.g. 10m, 2h, 3d').setRequired(true))
      .addStringOption((o) => o.setName('what').setDescription('What to remember').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List your reminders'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a reminder')
      .addIntegerOption((o) => o.setName('id').setDescription('Reminder ID').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = listReminders(interaction.user.id);
      if (!rows.length) return interaction.reply({ embeds: [fail('You have no reminders.')], flags: MessageFlags.Ephemeral });
      return interaction.reply({
        embeds: [brandEmbed({ title: 'Your reminders',
          description: rows.map((r) => `**#${r.id}** ${absTime(r.remind_at)} — ${truncate(r.text, 80)}`).join('\n') })],
        flags: MessageFlags.Ephemeral });
    }
    if (sub === 'cancel') {
      const okDel = deleteReminder(interaction.options.getInteger('id'), interaction.user.id);
      return interaction.reply({ embeds: [okDel ? ok('Reminder cancelled.') : fail('No such reminder.')], flags: MessageFlags.Ephemeral });
    }
    const seconds = parseDuration(interaction.options.getString('when'));
    if (!seconds || seconds < 30) return interaction.reply({ embeds: [fail('Give me at least 30 seconds — try `10m` or `2h`.')], flags: MessageFlags.Ephemeral });
    const id = addReminder({
      userId: interaction.user.id, guildId: interaction.guild.id, channelId: interaction.channel.id,
      text: interaction.options.getString('what'), remindAt: Date.now() + seconds * 1000 });
    return interaction.reply({ embeds: [ok(`I will remind you in **${formatDuration(seconds)}** (reminder #${id}).`)] });
  },
};

const say = {
  data: new SlashCommandBuilder().setName('say').setDescription('Send a message as meelarp')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('message').setDescription('What to say').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Where to say it').addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.send({ content: interaction.options.getString('message').slice(0, 2000),
      allowedMentions: { parse: ['users'] } });
    return interaction.reply({ embeds: [ok(`Sent in <#${channel.id}>.`)], flags: MessageFlags.Ephemeral });
  },
};

const embed = {
  data: new SlashCommandBuilder().setName('embed').setDescription('Post an embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('title').setDescription('Embed title'))
    .addStringOption((o) => o.setName('description').setDescription('Embed body (use \\n for new lines)'))
    .addStringOption((o) => o.setName('color').setDescription('Hex color, e.g. #5b6bff'))
    .addStringOption((o) => o.setName('image').setDescription('Image URL'))
    .addStringOption((o) => o.setName('footer').setDescription('Footer text'))
    .addChannelOption((o) => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    const data = {
      title: interaction.options.getString('title') ?? undefined,
      description: (interaction.options.getString('description') ?? '').replace(/\\n/g, '\n') || undefined,
      color: interaction.options.getString('color') ?? undefined,
      image: interaction.options.getString('image') ?? undefined,
      footer: interaction.options.getString('footer') ? { text: interaction.options.getString('footer') } : undefined,
    };
    if (!data.title && !data.description) {
      return interaction.reply({ embeds: [fail('Give the embed at least a title or a description.')], flags: MessageFlags.Ephemeral });
    }
    const built = buildEmbedFrom(data, { guild: interaction.guild, user: interaction.user });
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.send({ embeds: [built] });
    return interaction.reply({ embeds: [ok(`Embed posted in <#${channel.id}>.`)], flags: MessageFlags.Ephemeral });
  },
};

const dashboard = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open the meelarp control panel right here in Discord')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const { openDashboard } = await import('../modules/dashboard.js');
    return openDashboard(interaction);
  },
};

const configCmd = {
  data: new SlashCommandBuilder().setName('config').setDescription('Show or change core settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('view').setDescription('Show the current configuration'))
    .addSubcommand((s) => s.setName('prefix').setDescription('Set the custom-command prefix')
      .addStringOption((o) => o.setName('prefix').setDescription('New prefix').setRequired(true).setMaxLength(5)))
    .addSubcommand((s) => s.setName('module').setDescription('Enable or disable a module')
      .addStringOption((o) => o.setName('name').setDescription('Module').setRequired(true).addChoices(
        ...['levels', 'moderation', 'automod', 'welcome', 'roles', 'commands', 'timers', 'feeds',
          'giveaways', 'tickets', 'logs', 'counters', 'music', 'starboard'].map((m) => ({ name: m, value: m }))))
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('modlog').setDescription('Set the moderation log channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))),
  async execute(interaction) {
    const { saveSettings } = await import('../../db.js');
    const settings = getSettings(interaction.guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'prefix') {
      settings.prefix = interaction.options.getString('prefix');
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Custom-command prefix is now \`${settings.prefix}\`.`)] });
    }
    if (sub === 'module') {
      const name = interaction.options.getString('name');
      settings.modules[name] = interaction.options.getBoolean('enabled');
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Module **${name}** is now **${settings.modules[name] ? 'on' : 'off'}**.`)] });
    }
    if (sub === 'modlog') {
      settings.moderation.modLogChannel = interaction.options.getChannel('channel').id;
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Moderation log set to <#${settings.moderation.modLogChannel}>.`)] });
    }

    const on = Object.entries(settings.modules).filter(([, v]) => v).map(([k]) => k);
    const off = Object.entries(settings.modules).filter(([, v]) => !v).map(([k]) => k);
    return interaction.reply({ embeds: [brandEmbed({
      title: `Configuration — ${interaction.guild.name}`,
      fields: [
        { name: 'Enabled', value: on.join(', ') || 'none' },
        { name: 'Disabled', value: off.join(', ') || 'none' },
        { name: 'Prefix', value: `\`${settings.prefix}\``, inline: true },
        { name: 'Mod log', value: settings.moderation.modLogChannel ? `<#${settings.moderation.modLogChannel}>` : 'not set', inline: true },
        { name: 'Level announce', value: settings.levels.announce, inline: true },
      ],
      footer: `Full settings: ${config.web.baseUrl}/dashboard/${interaction.guild.id}`,
    })] });
  },
};

export default [help, ping, userinfo, serverinfo, avatar, roleinfo, poll, remind, say, embed, dashboard, configCmd];

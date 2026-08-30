// meelarp — moderation commands
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { getSettings } from '../../db.js';
import { brandEmbed, ok, fail, warn, canActOn, parseDuration, formatDuration, truncate } from '../util.js';
import { punish, purge, getCases, getCase, deleteCase, editCaseReason, warnCount, clearWarnings } from '../modules/moderation.js';

const reasonOpt = (o) => o.setName('reason').setDescription('Reason for the action').setMaxLength(400);
const durationOpt = (o) => o.setName('duration').setDescription('e.g. 30m, 2h, 7d — leave empty for permanent');

async function act(interaction, action, { requiresMember = true, defaultDuration = null } = {}) {
  const settings = getSettings(interaction.guild.id);
  const user = interaction.options.getUser('member') ?? interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const durationRaw = interaction.options.getString('duration');
  const durationSec = durationRaw ? parseDuration(durationRaw) : defaultDuration;

  if (durationRaw && durationSec === null) {
    return interaction.reply({ embeds: [fail(`I could not read \`${durationRaw}\` as a duration. Try \`30m\`, \`2h\`, \`7d\`.`)], flags: MessageFlags.Ephemeral });
  }

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (requiresMember && !member) {
    return interaction.reply({ embeds: [fail('That member is not in this server.')], flags: MessageFlags.Ephemeral });
  }
  if (member) {
    const check = canActOn(interaction.member, member, settings);
    if (!check.ok) return interaction.reply({ embeds: [fail(check.reason)], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();
  try {
    const caseNo = await punish(interaction.guild, {
      action, target: member, targetUser: user, moderator: interaction.user,
      reason, durationSec: durationSec ?? undefined,
      deleteDays: interaction.options.getInteger?.('delete_days') ?? 0,
    });
    const verb = { warn: 'Warned', timeout: 'Timed out', untimeout: 'Removed timeout for', mute: 'Muted',
      unmute: 'Unmuted', kick: 'Kicked', ban: 'Banned', softban: 'Softbanned', unban: 'Unbanned', note: 'Noted' }[action];
    return interaction.editReply({ embeds: [ok(
      `${verb} **${user.tag}**${durationSec ? ` for ${formatDuration(durationSec)}` : ''} · case #${caseNo}\n> ${truncate(reason, 300)}`)] });
  } catch (e) {
    return interaction.editReply({ embeds: [fail(`Action failed: ${e.message}`)] });
  }
}

const ban = {
  data: new SlashCommandBuilder().setName('ban').setDescription('Ban a member (optionally temporary)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member to ban').setRequired(true))
    .addStringOption(reasonOpt).addStringOption(durationOpt)
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete this many days of their messages').setMinValue(0).setMaxValue(7)),
  execute: (i) => act(i, 'ban', { requiresMember: false }),
};

const unban = {
  data: new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User to unban').setRequired(true))
    .addStringOption(reasonOpt),
  execute: (i) => act(i, 'unban', { requiresMember: false }),
};

const softban = {
  data: new SlashCommandBuilder().setName('softban').setDescription('Ban then immediately unban to purge messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption(reasonOpt)
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Days of messages to remove').setMinValue(1).setMaxValue(7)),
  execute: (i) => act(i, 'softban', { requiresMember: false }),
};

const kick = {
  data: new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true))
    .addStringOption(reasonOpt),
  execute: (i) => act(i, 'kick'),
};

const timeout = {
  data: new SlashCommandBuilder().setName('timeout').setDescription('Time a member out')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 1d (max 28d)').setRequired(true))
    .addStringOption(reasonOpt),
  execute: (i) => act(i, 'timeout', { defaultDuration: 600 }),
};

const untimeout = {
  data: new SlashCommandBuilder().setName('untimeout').setDescription('Remove a member\'s timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption(reasonOpt),
  execute: (i) => act(i, 'untimeout'),
};

const mute = {
  data: new SlashCommandBuilder().setName('mute').setDescription('Mute a member (mute role, or timeout if none is set)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption(durationOpt).addStringOption(reasonOpt),
  execute: (i) => act(i, 'mute', { defaultDuration: 600 }),
};

const unmute = {
  data: new SlashCommandBuilder().setName('unmute').setDescription('Unmute a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption(reasonOpt),
  execute: (i) => act(i, 'unmute'),
};

const warnCmd = {
  data: new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((o) => reasonOpt(o).setRequired(true)),
  execute: (i) => act(i, 'warn'),
};

const warnings = {
  data: new SlashCommandBuilder().setName('warnings').setDescription('List a member\'s warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser('member');
    const rows = getCases(interaction.guild.id, { userId: user.id, type: 'warn', limit: 15 });
    if (!rows.length) return interaction.reply({ embeds: [ok(`**${user.tag}** has no warnings.`)] });
    return interaction.reply({ embeds: [brandEmbed({
      title: `Warnings for ${user.tag}`,
      description: rows.map((c) =>
        `**#${c.case_no}** · <t:${Math.floor(c.created_at / 1000)}:d> · by ${c.mod_tag ?? 'automod'}\n> ${truncate(c.reason ?? 'No reason', 200)}`).join('\n\n'),
      footer: `${rows.length} shown · ${warnCount(interaction.guild.id, user.id)} total`,
      color: 0xffb020,
    })] });
  },
};

const clearwarnings = {
  data: new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear all warnings for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser('member');
    const n = clearWarnings(interaction.guild.id, user.id);
    return interaction.reply({ embeds: [ok(`Cleared **${n}** warning${n === 1 ? '' : 's'} for <@${user.id}>.`)] });
  },
};

const caseCmd = {
  data: new SlashCommandBuilder().setName('case').setDescription('Inspect the moderation case log')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName('view').setDescription('View a case')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true)))
    .addSubcommand((s) => s.setName('reason').setDescription('Edit a case reason')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true)))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a case')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Recent cases')
      .addUserOption((o) => o.setName('member').setDescription('Filter by member'))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const user = interaction.options.getUser('member');
      const rows = getCases(interaction.guild.id, { userId: user?.id, limit: 15 });
      if (!rows.length) return interaction.reply({ embeds: [fail('No cases recorded yet.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: user ? `Cases for ${user.tag}` : 'Recent cases',
        description: rows.map((c) =>
          `**#${c.case_no}** \`${c.type}\` <@${c.user_id}> — ${truncate(c.reason ?? 'No reason', 80)}`).join('\n'),
      })] });
    }

    const number = interaction.options.getInteger('number');
    const c = getCase(interaction.guild.id, number);
    if (!c) return interaction.reply({ embeds: [fail(`Case #${number} does not exist.`)], flags: MessageFlags.Ephemeral });

    if (sub === 'delete') {
      deleteCase(interaction.guild.id, number);
      return interaction.reply({ embeds: [ok(`Deleted case #${number}.`)] });
    }
    if (sub === 'reason') {
      editCaseReason(interaction.guild.id, number, interaction.options.getString('reason'));
      return interaction.reply({ embeds: [ok(`Updated the reason for case #${number}.`)] });
    }
    return interaction.reply({ embeds: [brandEmbed({
      title: `Case #${c.case_no} — ${c.type}`,
      fields: [
        { name: 'Member', value: `<@${c.user_id}> \`${c.user_tag ?? c.user_id}\``, inline: true },
        { name: 'Moderator', value: c.mod_id ? `<@${c.mod_id}>` : 'meelarp (automatic)', inline: true },
        { name: 'When', value: `<t:${Math.floor(c.created_at / 1000)}:F>`, inline: false },
        ...(c.duration ? [{ name: 'Duration', value: formatDuration(c.duration), inline: true }] : []),
        { name: 'Reason', value: truncate(c.reason ?? 'No reason given', 1000) },
      ],
    })] });
  },
};

const purgeCmd = {
  data: new SlashCommandBuilder().setName('purge').setDescription('Bulk delete recent messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('How many messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('member').setDescription('Only from this member'))
    .addStringOption((o) => o.setName('contains').setDescription('Only messages containing this text'))
    .addStringOption((o) => o.setName('filter').setDescription('Only a certain kind of message')
      .addChoices(
        { name: 'bots', value: 'bots' }, { name: 'humans', value: 'humans' },
        { name: 'attachments', value: 'attachments' }, { name: 'embeds', value: 'embeds' },
        { name: 'links', value: 'links' }, { name: 'invites', value: 'invites' })),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const amount = interaction.options.getInteger('amount');
    const filterKind = interaction.options.getString('filter');
    const filter = {
      userId: interaction.options.getUser('member')?.id,
      contains: interaction.options.getString('contains') ?? undefined,
      ...(filterKind ? { [filterKind]: true } : {}),
    };
    try {
      const n = await purge(interaction.channel, { limit: amount, filter, moderator: interaction.user });
      return interaction.editReply({ embeds: [ok(`Deleted **${n}** message${n === 1 ? '' : 's'}.`)] });
    } catch (e) {
      return interaction.editReply({ embeds: [fail(`Purge failed: ${e.message}. Messages older than 14 days cannot be bulk deleted.`)] });
    }
  },
};

const slowmode = {
  data: new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10s, 1m, off').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    const raw = interaction.options.getString('duration');
    const seconds = /^(off|0|none)$/i.test(raw) ? 0 : parseDuration(raw);
    if (seconds === null || seconds > 21600) {
      return interaction.reply({ embeds: [fail('Slowmode must be between 0 and 6 hours.')], flags: MessageFlags.Ephemeral });
    }
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.setRateLimitPerUser(seconds, `meelarp: ${interaction.user.tag}`);
    return interaction.reply({ embeds: [ok(seconds
      ? `Slowmode in <#${channel.id}> set to **${formatDuration(seconds)}**.`
      : `Slowmode disabled in <#${channel.id}>.`)] });
  },
};

const lock = {
  data: new SlashCommandBuilder().setName('lock').setDescription('Stop @everyone from sending messages here')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
    .addStringOption(reasonOpt),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone,
      { SendMessages: false }, { reason: `meelarp lock by ${interaction.user.tag}` });
    return interaction.reply({ embeds: [warn(`<#${channel.id}> is locked.${
      interaction.options.getString('reason') ? `\n> ${interaction.options.getString('reason')}` : ''}`)] });
  },
};

const unlock = {
  data: new SlashCommandBuilder().setName('unlock').setDescription('Re-open a locked channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('channel').setDescription('Channel')),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone,
      { SendMessages: null }, { reason: `meelarp unlock by ${interaction.user.tag}` });
    return interaction.reply({ embeds: [ok(`<#${channel.id}> is unlocked.`)] });
  },
};

const nick = {
  data: new SlashCommandBuilder().setName('nick').setDescription('Change a member\'s nickname')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('nickname').setDescription('New nickname (empty to reset)').setMaxLength(32)),
  async execute(interaction) {
    const member = await interaction.guild.members.fetch(interaction.options.getUser('member').id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [fail('Member not found.')], flags: MessageFlags.Ephemeral });
    const name = interaction.options.getString('nickname');
    try {
      await member.setNickname(name ?? null, `meelarp: ${interaction.user.tag}`);
      return interaction.reply({ embeds: [ok(name ? `Nickname set to **${name}**.` : 'Nickname reset.')] });
    } catch {
      return interaction.reply({ embeds: [fail('I cannot change that member\'s nickname (role hierarchy).')], flags: MessageFlags.Ephemeral });
    }
  },
};

const role = {
  data: new SlashCommandBuilder().setName('role').setDescription('Add or remove a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName('add').setDescription('Give a role')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take a role away')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))),
  async execute(interaction) {
    const member = await interaction.guild.members.fetch(interaction.options.getUser('member').id).catch(() => null);
    const target = interaction.options.getRole('role');
    if (!member) return interaction.reply({ embeds: [fail('Member not found.')], flags: MessageFlags.Ephemeral });
    if (!target.editable) return interaction.reply({ embeds: [fail(`I cannot manage **${target.name}** — move my role above it.`)], flags: MessageFlags.Ephemeral });
    if (interaction.member.roles.highest.comparePositionTo(target) <= 0 && interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ embeds: [fail('That role is above your highest role.')], flags: MessageFlags.Ephemeral });
    }
    const adding = interaction.options.getSubcommand() === 'add';
    await member.roles[adding ? 'add' : 'remove'](target, `meelarp: ${interaction.user.tag}`);
    return interaction.reply({ embeds: [ok(`${adding ? 'Added' : 'Removed'} <@&${target.id}> ${adding ? 'to' : 'from'} <@${member.id}>.`)] });
  },
};

export default [ban, unban, softban, kick, timeout, untimeout, mute, unmute, warnCmd, warnings,
  clearwarnings, caseCmd, purgeCmd, slowmode, lock, unlock, nick, role];

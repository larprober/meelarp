// meelarp — leveling commands
import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { getSettings, saveSettings } from '../../db.js';
import { brandEmbed, ok, fail, chunk } from '../util.js';
import { getMemberLevel, leaderboard, setXp, addXpRaw, resetGuildLevels, resetMemberLevel,
  xpForLevel, totalXpFor } from '../modules/levels.js';
import { renderRankCard, canvasAvailable } from '../rankcard.js';

const rank = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your rank card (or someone else\'s)')
    .addUserOption((o) => o.setName('member').setDescription('Whose rank to show')),
  async execute(interaction) {
    const settings = getSettings(interaction.guild.id);
    if (!settings.modules.levels) return interaction.reply({ embeds: [fail('Leveling is disabled on this server.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();
    const user = interaction.options.getUser('member') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const data = getMemberLevel(interaction.guild.id, user.id);

    if (canvasAvailable()) {
      const png = await renderRankCard({
        username: member?.displayName ?? user.username,
        avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
        rank: data.rank, level: data.level, into: data.into, needed: data.needed,
        xp: data.xp, messages: data.messages,
        status: member?.presence?.status ?? 'offline',
      }, settings.levels.card);
      if (png) {
        return interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'rank.png' })] });
      }
    }

    const filled = Math.round((data.into / Math.max(1, data.needed)) * 20);
    return interaction.editReply({ embeds: [brandEmbed({
      title: `${member?.displayName ?? user.username} — level ${data.level}`,
      description: `\`${'█'.repeat(filled)}${'░'.repeat(20 - filled)}\`\n**${data.into} / ${data.needed} XP** to level ${data.level + 1}`,
      thumbnail: user.displayAvatarURL({ size: 128 }),
      fields: [
        { name: 'Rank', value: `#${data.rank}`, inline: true },
        { name: 'Total XP', value: String(data.xp), inline: true },
        { name: 'Messages', value: String(data.messages), inline: true },
      ],
    })] });
  },
};

const leaderboardCmd = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the server XP leaderboard')
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
  async execute(interaction) {
    const settings = getSettings(interaction.guild.id);
    if (!settings.modules.levels) return interaction.reply({ embeds: [fail('Leveling is disabled on this server.')], flags: MessageFlags.Ephemeral });
    const page = interaction.options.getInteger('page') ?? 1;
    const { rows, total } = leaderboard(interaction.guild.id, { limit: 10, offset: (page - 1) * 10 });
    if (!rows.length) return interaction.reply({ embeds: [fail('Nobody has earned XP yet.')] });

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r) => {
      const badge = r.rank <= 3 ? medals[r.rank - 1] : `\`#${String(r.rank).padStart(2, ' ')}\``;
      return `${badge} <@${r.user_id}> — **level ${r.level}** · ${r.xp.toLocaleString()} XP`;
    });

    return interaction.reply({ embeds: [brandEmbed({
      title: `${interaction.guild.name} — leaderboard`,
      description: lines.join('\n'),
      footer: `Page ${page} of ${Math.max(1, Math.ceil(total / 10))} · ${total} ranked members · ${config.web.baseUrl}/leaderboard/${interaction.guild.id}`,
      thumbnail: interaction.guild.iconURL({ size: 128 }),
    })] });
  },
};

const xp = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Manage member XP')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Give XP to a member')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('XP amount').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take XP from a member')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('XP amount').setRequired(true)))
    .addSubcommand((s) => s.setName('set').setDescription('Set a member\'s XP')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('XP total').setRequired(true)))
    .addSubcommand((s) => s.setName('setlevel').setDescription('Set a member\'s level')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset a member\'s XP')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('resetall').setDescription('Reset the whole leaderboard')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = getSettings(interaction.guild.id);

    if (sub === 'resetall') {
      resetGuildLevels(interaction.guild.id);
      return interaction.reply({ embeds: [ok('The leaderboard has been reset.')] });
    }

    const user = interaction.options.getUser('member');
    if (sub === 'reset') {
      resetMemberLevel(interaction.guild.id, user.id);
      return interaction.reply({ embeds: [ok(`Reset XP for <@${user.id}>.`)] });
    }

    if (sub === 'setlevel') {
      const level = interaction.options.getInteger('level');
      const total = totalXpFor(Math.max(0, level), settings.levels.curve);
      setXp(interaction.guild.id, user.id, total);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        const { applyRoleRewards } = await import('../modules/levels.js');
        await applyRoleRewards(member, level, settings).catch(() => {});
      }
      return interaction.reply({ embeds: [ok(`<@${user.id}> is now level **${level}** (${total.toLocaleString()} XP).`)] });
    }

    const amount = interaction.options.getInteger('amount');
    const result = sub === 'set'
      ? setXp(interaction.guild.id, user.id, amount)
      : addXpRaw(interaction.guild.id, user.id, sub === 'remove' ? -amount : amount);
    return interaction.reply({ embeds: [ok(
      `<@${user.id}> now has **${result.xp.toLocaleString()} XP** (level ${result.level}).`)] });
  },
};

const levelrole = {
  data: new SlashCommandBuilder()
    .setName('levelrole')
    .setDescription('Manage level role rewards')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Reward a role at a level')
      .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a level reward')
      .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List level rewards'))
    .addSubcommand((s) => s.setName('stack').setDescription('Keep all earned roles, or only the highest')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Stack roles').setRequired(true))),
  async execute(interaction) {
    const settings = getSettings(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const rewards = settings.levels.roleRewards ?? [];

    if (sub === 'list') {
      if (!rewards.length) return interaction.reply({ embeds: [fail('No level rewards configured yet.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Level rewards',
        description: rewards.slice().sort((a, b) => a.level - b.level)
          .map((r) => `Level **${r.level}** → <@&${r.roleId}>`).join('\n'),
        footer: settings.levels.stackRoles ? 'Roles stack' : 'Only the highest role is kept',
      })] });
    }

    if (sub === 'stack') {
      settings.levels.stackRoles = interaction.options.getBoolean('enabled');
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(settings.levels.stackRoles
        ? 'Members now keep every level role they earn.'
        : 'Members now keep only their highest level role.')] });
    }

    const level = interaction.options.getInteger('level');
    if (sub === 'remove') {
      settings.levels.roleRewards = rewards.filter((r) => r.level !== level);
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Removed the reward for level ${level}.`)] });
    }

    const role = interaction.options.getRole('role');
    if (role.managed || role.id === interaction.guild.id) {
      return interaction.reply({ embeds: [fail('That role cannot be assigned by a bot.')], flags: MessageFlags.Ephemeral });
    }
    if (interaction.guild.members.me.roles.highest.comparePositionTo(role) <= 0) {
      return interaction.reply({ embeds: [fail(`My highest role must be above **${role.name}**.`)], flags: MessageFlags.Ephemeral });
    }
    settings.levels.roleRewards = [...rewards.filter((r) => r.level !== level), { level, roleId: role.id }];
    saveSettings(interaction.guild.id, settings);
    return interaction.reply({ embeds: [ok(`Members reaching level **${level}** now get <@&${role.id}>.`)] });
  },
};

const levels = {
  data: new SlashCommandBuilder()
    .setName('levels')
    .setDescription('Open the full leaderboard on the dashboard'),
  async execute(interaction) {
    return interaction.reply({ embeds: [brandEmbed({
      title: `${interaction.guild.name} leaderboard`,
      description: `[Open the web leaderboard](${config.web.baseUrl}/leaderboard/${interaction.guild.id})`,
    })] });
  },
};

export default [rank, leaderboardCmd, xp, levelrole, levels];
export { chunk, xpForLevel };

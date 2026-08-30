// meelarp — giveaways, tickets, timers, feeds, role menus, custom commands, automod
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { config } from '../../config.js';
import { getSettings, saveSettings } from '../../db.js';
import { brandEmbed, ok, fail, parseDuration, formatDuration, truncate, relTime } from '../util.js';
import { startGiveaway, endGiveaway, listGiveaways, entryCount, getGiveaway } from '../modules/giveaways.js';
import { sendPanel, addUserToTicket, removeUserFromTicket } from '../modules/tickets.js';
import { createTimer, listTimers, deleteTimer, updateTimer } from '../modules/timers.js';
import { createFeed, listFeeds, deleteFeed, testFeed } from '../modules/feeds.js';
import { createMenu, listMenus, publishMenu, deleteMenu, getMenu, updateMenu } from '../modules/roles.js';
import { upsertCommand, listCommands, deleteCommand } from '../modules/customcommands.js';
import { automodPreview, presetNames } from '../modules/automod.js';

// --- giveaways ------------------------------------------------------------
const giveaway = {
  data: new SlashCommandBuilder().setName('giveaway').setDescription('Run a giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway')
      .addStringOption((o) => o.setName('prize').setDescription('What are you giving away?').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 1h, 2d').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(50))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText))
      .addRoleOption((o) => o.setName('required_role').setDescription('Role needed to enter'))
      .addIntegerOption((o) => o.setName('required_level').setDescription('Minimum meelarp level'))
      .addIntegerOption((o) => o.setName('account_age_days').setDescription('Minimum account age in days')))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winners')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List giveaways')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = listGiveaways(interaction.guild.id).slice(0, 15);
      if (!rows.length) return interaction.reply({ embeds: [fail('No giveaways yet.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Giveaways',
        description: rows.map((g) => `**#${g.id}** ${g.ended ? '`ended`' : `ends ${relTime(g.ends_at)}`} — ${truncate(g.prize, 60)} · ${entryCount(g.id)} entries`).join('\n'),
      })] });
    }

    if (sub === 'start') {
      const durationSec = parseDuration(interaction.options.getString('duration'));
      if (!durationSec || durationSec < 60) {
        return interaction.reply({ embeds: [fail('Give it at least a minute — try `1h` or `2d`.')], flags: MessageFlags.Ephemeral });
      }
      const requirements = {};
      const role = interaction.options.getRole('required_role');
      if (role) requirements.roles = [role.id];
      const level = interaction.options.getInteger('required_level');
      if (level) requirements.level = level;
      const age = interaction.options.getInteger('account_age_days');
      if (age) requirements.accountAgeDays = age;

      const res = await startGiveaway(interaction.guild, {
        channelId: (interaction.options.getChannel('channel') ?? interaction.channel).id,
        prize: interaction.options.getString('prize'),
        winners: interaction.options.getInteger('winners') ?? 1,
        durationSec, hostId: interaction.user.id, requirements,
      });
      return interaction.reply({ embeds: [res.ok
        ? ok(`Giveaway **#${res.giveaway.id}** started — ends in ${formatDuration(durationSec)}.\n${res.url}`)
        : fail(res.error)], flags: res.ok ? undefined : MessageFlags.Ephemeral });
    }

    const id = interaction.options.getInteger('id');
    const g = getGiveaway(id);
    if (!g || g.guild_id !== interaction.guild.id) {
      return interaction.reply({ embeds: [fail('No giveaway with that ID here.')], flags: MessageFlags.Ephemeral });
    }
    const res = await endGiveaway(interaction.client, id, { reroll: sub === 'reroll' });
    return interaction.reply({ embeds: [res.ok
      ? ok(res.winners.length ? `Winners: ${res.winners.map((w) => `<@${w}>`).join(', ')}` : 'No valid entries.')
      : fail(res.error)] });
  },
};

// --- tickets --------------------------------------------------------------
const ticket = {
  data: new SlashCommandBuilder().setName('ticket').setDescription('Support tickets')
    .addSubcommand((s) => s.setName('panel').setDescription('Post the ticket panel (staff only)')
      .addStringOption((o) => o.setName('title').setDescription('Panel title'))
      .addStringOption((o) => o.setName('description').setDescription('Panel text'))
      .addStringOption((o) => o.setName('button').setDescription('Button label'))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('add').setDescription('Add a member to this ticket')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a member from this ticket')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('setup').setDescription('Configure tickets (staff only)')
      .addChannelOption((o) => o.setName('category').setDescription('Category for new tickets').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((o) => o.setName('support_role').setDescription('Role that can see tickets'))
      .addChannelOption((o) => o.setName('transcripts').setDescription('Where transcripts are posted').addChannelTypes(ChannelType.GuildText))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = getSettings(interaction.guild.id);
    const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
      || (settings.tickets.supportRoles ?? []).some((r) => interaction.member.roles.cache.has(r));

    if (sub === 'panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [fail('You need Manage Server for that.')], flags: MessageFlags.Ephemeral });
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await sendPanel(channel, {
        title: interaction.options.getString('title'),
        description: interaction.options.getString('description'),
        buttonLabel: interaction.options.getString('button'),
      });
      return interaction.reply({ embeds: [ok(`Ticket panel posted in <#${channel.id}>.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [fail('You need Manage Server for that.')], flags: MessageFlags.Ephemeral });
      }
      const category = interaction.options.getChannel('category');
      const role = interaction.options.getRole('support_role');
      const transcripts = interaction.options.getChannel('transcripts');
      if (category) settings.tickets.categoryId = category.id;
      if (role) settings.tickets.supportRoles = [...new Set([...(settings.tickets.supportRoles ?? []), role.id])];
      if (transcripts) settings.tickets.transcriptChannel = transcripts.id;
      settings.modules.tickets = true;
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok('Ticket settings updated.')], flags: MessageFlags.Ephemeral });
    }

    if (!isStaff) return interaction.reply({ embeds: [fail('Only support staff can do that.')], flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('member');
    try {
      if (sub === 'add') await addUserToTicket(interaction.channel, user);
      else await removeUserFromTicket(interaction.channel, user);
      return interaction.reply({ embeds: [ok(`${sub === 'add' ? 'Added' : 'Removed'} <@${user.id}>.`)] });
    } catch {
      return interaction.reply({ embeds: [fail('That only works inside a ticket channel.')], flags: MessageFlags.Ephemeral });
    }
  },
};

// --- timers ---------------------------------------------------------------
const timer = {
  data: new SlashCommandBuilder().setName('timer').setDescription('Recurring scheduled messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Add a recurring message')
      .addStringOption((o) => o.setName('interval').setDescription('e.g. 30m, 6h, 1d').setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('Message to post').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('name').setDescription('A label for this timer')))
    .addSubcommand((s) => s.setName('list').setDescription('List timers'))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a timer')
      .addIntegerOption((o) => o.setName('id').setDescription('Timer ID').setRequired(true)))
    .addSubcommand((s) => s.setName('toggle').setDescription('Pause or resume a timer')
      .addIntegerOption((o) => o.setName('id').setDescription('Timer ID').setRequired(true))
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = listTimers(interaction.guild.id);
      if (!rows.length) return interaction.reply({ embeds: [fail('No timers configured.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Timers',
        description: rows.map((t) => `**#${t.id}** ${t.enabled ? '' : '`paused` '}every ${formatDuration(t.interval_sec)} in <#${t.channel_id}>\n> ${truncate(t.message, 80)}`).join('\n'),
      })] });
    }
    if (sub === 'remove') {
      const gone = deleteTimer(interaction.options.getInteger('id'));
      return interaction.reply({ embeds: [gone ? ok('Timer deleted.') : fail('No such timer.')] });
    }
    if (sub === 'toggle') {
      const t = updateTimer(interaction.options.getInteger('id'), { enabled: interaction.options.getBoolean('enabled') });
      return interaction.reply({ embeds: [t ? ok(`Timer #${t.id} is now ${t.enabled ? 'running' : 'paused'}.`) : fail('No such timer.')] });
    }
    const interval = parseDuration(interaction.options.getString('interval'));
    if (!interval || interval < 60) return interaction.reply({ embeds: [fail('Minimum interval is 1 minute.')], flags: MessageFlags.Ephemeral });
    const t = createTimer(interaction.guild.id, {
      channelId: (interaction.options.getChannel('channel') ?? interaction.channel).id,
      message: interaction.options.getString('message'),
      name: interaction.options.getString('name') ?? 'Timer',
      intervalSec: interval,
    });
    return interaction.reply({ embeds: [ok(`Timer **#${t.id}** created — posting every ${formatDuration(interval)}.`)] });
  },
};

// --- feeds ----------------------------------------------------------------
const feed = {
  data: new SlashCommandBuilder().setName('feed').setDescription('YouTube, Twitch, Reddit and RSS alerts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Follow a source')
      .addStringOption((o) => o.setName('type').setDescription('Source type').setRequired(true)
        .addChoices({ name: 'YouTube', value: 'youtube' }, { name: 'Twitch', value: 'twitch' },
          { name: 'Reddit', value: 'reddit' }, { name: 'RSS', value: 'rss' }))
      .addStringOption((o) => o.setName('source').setDescription('Channel URL / @handle / subreddit / feed URL').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to announce').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('message').setDescription('Announcement text; {name} {title} {url} available')))
    .addSubcommand((s) => s.setName('list').setDescription('List feeds'))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop following a source')
      .addIntegerOption((o) => o.setName('id').setDescription('Feed ID').setRequired(true)))
    .addSubcommand((s) => s.setName('test').setDescription('Post the latest item now')
      .addIntegerOption((o) => o.setName('id').setDescription('Feed ID').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = listFeeds(interaction.guild.id);
      if (!rows.length) return interaction.reply({ embeds: [fail('No feeds configured.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Feeds',
        description: rows.map((f) => `**#${f.id}** \`${f.type}\` **${f.display_name ?? f.source}** → <#${f.channel_id}>${f.enabled ? '' : ' `paused`'}`).join('\n'),
      })] });
    }
    if (sub === 'remove') {
      const gone = deleteFeed(interaction.options.getInteger('id'));
      return interaction.reply({ embeds: [gone ? ok('Feed removed.') : fail('No such feed.')] });
    }
    if (sub === 'test') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await testFeed(interaction.client, interaction.options.getInteger('id'));
      return interaction.editReply({ embeds: [res.ok ? ok('Posted the latest item.') : fail(res.error)] });
    }

    await interaction.deferReply();
    try {
      const f = await createFeed(interaction.guild.id, {
        type: interaction.options.getString('type'),
        source: interaction.options.getString('source'),
        channelId: (interaction.options.getChannel('channel') ?? interaction.channel).id,
        template: interaction.options.getString('message') ?? undefined,
      });
      return interaction.editReply({ embeds: [ok(
        `Now following **${f.display_name ?? f.source}** (feed #${f.id}) — new posts go to <#${f.channel_id}>.`)] });
    } catch (e) {
      return interaction.editReply({ embeds: [fail(e.message)] });
    }
  },
};

// --- role menus -----------------------------------------------------------
const rolemenu = {
  data: new SlashCommandBuilder().setName('rolemenu').setDescription('Self-assignable role menus')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName('create').setDescription('Create a menu with up to 5 roles')
      .addStringOption((o) => o.setName('title').setDescription('Menu title').setRequired(true))
      .addRoleOption((o) => o.setName('role1').setDescription('Role 1').setRequired(true))
      .addRoleOption((o) => o.setName('role2').setDescription('Role 2'))
      .addRoleOption((o) => o.setName('role3').setDescription('Role 3'))
      .addRoleOption((o) => o.setName('role4').setDescription('Role 4'))
      .addRoleOption((o) => o.setName('role5').setDescription('Role 5'))
      .addStringOption((o) => o.setName('style').setDescription('How members pick')
        .addChoices({ name: 'buttons', value: 'buttons' }, { name: 'dropdown', value: 'select' },
          { name: 'reactions', value: 'reactions' }))
      .addStringOption((o) => o.setName('mode').setDescription('Selection rules')
        .addChoices({ name: 'multiple roles', value: 'multi' }, { name: 'only one', value: 'unique' },
          { name: 'add only', value: 'add-only' }, { name: 'verify', value: 'verify' }))
      .addStringOption((o) => o.setName('description').setDescription('Text under the title'))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('list').setDescription('List role menus'))
    .addSubcommand((s) => s.setName('publish').setDescription('Post or refresh a menu')
      .addIntegerOption((o) => o.setName('id').setDescription('Menu ID').setRequired(true)))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a menu')
      .addIntegerOption((o) => o.setName('id').setDescription('Menu ID').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = listMenus(interaction.guild.id);
      if (!rows.length) return interaction.reply({ embeds: [fail('No role menus yet.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Role menus',
        description: rows.map((m) => `**#${m.id}** ${m.title} — \`${m.style}\` · ${m.options.length} roles${m.message_id ? '' : ' *(not posted)*'}`).join('\n'),
        footer: `Design richer menus at ${config.web.baseUrl}/dashboard/${interaction.guild.id}`,
      })] });
    }
    if (sub === 'delete') {
      const menu = getMenu(interaction.options.getInteger('id'));
      if (!menu || menu.guild_id !== interaction.guild.id) return interaction.reply({ embeds: [fail('No such menu.')], flags: MessageFlags.Ephemeral });
      deleteMenu(menu.id);
      return interaction.reply({ embeds: [ok('Menu deleted (the posted message stays; delete it manually).')] });
    }
    if (sub === 'publish') {
      const menu = getMenu(interaction.options.getInteger('id'));
      if (!menu || menu.guild_id !== interaction.guild.id) return interaction.reply({ embeds: [fail('No such menu.')], flags: MessageFlags.Ephemeral });
      const res = await publishMenu(interaction.guild, menu.id);
      return interaction.reply({ embeds: [res.ok ? ok(`Menu posted: ${res.url}`) : fail(res.error)], flags: MessageFlags.Ephemeral });
    }

    const roles = ['role1', 'role2', 'role3', 'role4', 'role5']
      .map((k) => interaction.options.getRole(k)).filter(Boolean);
    const unusable = roles.filter((r) => !r.editable);
    if (unusable.length) {
      return interaction.reply({ embeds: [fail(`I cannot assign: ${unusable.map((r) => r.name).join(', ')}. Move my role above them.`)], flags: MessageFlags.Ephemeral });
    }
    const style = interaction.options.getString('style') ?? 'buttons';
    const menu = createMenu(interaction.guild.id, {
      channelId: (interaction.options.getChannel('channel') ?? interaction.channel).id,
      title: interaction.options.getString('title'),
      description: interaction.options.getString('description') ?? undefined,
      style,
      mode: interaction.options.getString('mode') ?? 'multi',
      options: roles.map((r, i) => ({ roleId: r.id, label: r.name,
        emoji: style === 'reactions' ? ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i] : undefined })),
    });
    const res = await publishMenu(interaction.guild, menu.id);
    return interaction.reply({ embeds: [res.ok
      ? ok(`Role menu **#${menu.id}** created: ${res.url}`)
      : fail(res.error)] });
  },
};

// --- custom commands ------------------------------------------------------
const customcommand = {
  data: new SlashCommandBuilder().setName('customcommand').setDescription('Custom text commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Create or update a command')
      .addStringOption((o) => o.setName('name').setDescription('Command name (without prefix)').setRequired(true))
      .addStringOption((o) => o.setName('response').setDescription('Reply text. Placeholders like {user:mention} work').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a command')
      .addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List custom commands')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = getSettings(interaction.guild.id);
    if (sub === 'list') {
      const rows = listCommands(interaction.guild.id);
      if (!rows.length) return interaction.reply({ embeds: [fail('No custom commands yet.')] });
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Custom commands',
        description: rows.map((c) => `\`${settings.prefix}${c.name}\`${c.enabled ? '' : ' `disabled`'} — used ${c.uses}×`).join('\n'),
      })] });
    }
    if (sub === 'remove') {
      const gone = deleteCommand(interaction.guild.id, interaction.options.getString('name'));
      return interaction.reply({ embeds: [gone ? ok('Command deleted.') : fail('No such command.')] });
    }
    const cmd = upsertCommand(interaction.guild.id, {
      name: interaction.options.getString('name'),
      response: interaction.options.getString('response'),
    }, interaction.user);
    return interaction.reply({ embeds: [ok(`\`${settings.prefix}${cmd.name}\` is ready.`)] });
  },
};

// --- automod --------------------------------------------------------------
const automod = {
  data: new SlashCommandBuilder().setName('automod').setDescription('Automatic moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show automod rules'))
    .addSubcommand((s) => s.setName('toggle').setDescription('Enable or disable a rule')
      .addStringOption((o) => o.setName('rule').setDescription('Rule').setRequired(true).addChoices(
        ...['invites', 'links', 'spam', 'duplicates', 'mentions', 'caps', 'words', 'emoji', 'zalgo', 'attachments', 'newlines']
          .map((r) => ({ name: r, value: r }))))
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('What to do on a hit')
        .addChoices({ name: 'delete', value: 'delete' }, { name: 'warn', value: 'warn' },
          { name: 'timeout', value: 'timeout' }, { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' })))
    .addSubcommand((s) => s.setName('addword').setDescription('Add a filtered word')
      .addStringOption((o) => o.setName('word').setDescription('Word or phrase').setRequired(true)))
    .addSubcommand((s) => s.setName('preset').setDescription('Turn a built-in word list on or off')
      .addStringOption((o) => o.setName('name').setDescription('Preset').setRequired(true)
        .addChoices(...presetNames.map((p) => ({ name: p, value: p }))))
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('test').setDescription('Check a message against the filters')
      .addStringOption((o) => o.setName('text').setDescription('Text to test').setRequired(true))),
  async execute(interaction) {
    const settings = getSettings(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const rules = settings.automod.rules;

    if (sub === 'status') {
      const lines = Object.entries(rules).map(([name, r]) =>
        `${r.enabled ? '🟢' : '⚫'} **${name}** — ${r.enabled ? `action: \`${r.action}\`` : 'off'}`);
      return interaction.reply({ embeds: [brandEmbed({
        title: 'Automod',
        description: `Module: **${settings.modules.automod ? 'on' : 'off'}**\n\n${lines.join('\n')}`,
        footer: `Fine-tune every rule at ${config.web.baseUrl}/dashboard/${interaction.guild.id}`,
      })] });
    }

    if (sub === 'toggle') {
      const name = interaction.options.getString('rule');
      rules[name].enabled = interaction.options.getBoolean('enabled');
      const action = interaction.options.getString('action');
      if (action) rules[name].action = action;
      settings.modules.automod = true;
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Rule **${name}** is now **${rules[name].enabled ? 'on' : 'off'}** (action: ${rules[name].action}).`)] });
    }

    if (sub === 'addword') {
      const word = interaction.options.getString('word').toLowerCase();
      rules.words.list = [...new Set([...(rules.words.list ?? []), word])];
      rules.words.enabled = true;
      settings.modules.automod = true;
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Added to the word filter (${rules.words.list.length} words total).`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'preset') {
      const name = interaction.options.getString('name');
      const enabled = interaction.options.getBoolean('enabled');
      const set = new Set(rules.words.presets ?? []);
      enabled ? set.add(name) : set.delete(name);
      rules.words.presets = [...set];
      if (enabled) { rules.words.enabled = true; settings.modules.automod = true; }
      saveSettings(interaction.guild.id, settings);
      return interaction.reply({ embeds: [ok(`Preset **${name}** ${enabled ? 'enabled' : 'disabled'}.`)] });
    }

    const hit = automodPreview(interaction.options.getString('text'), rules);
    return interaction.reply({ embeds: [hit
      ? brandEmbed({ color: 0xffb020, title: 'Would be caught',
          description: `Rule **${hit.rule}** — ${hit.reason}\nAction: \`${hit.config.action}\`` })
      : ok('That message passes every enabled filter.')], flags: MessageFlags.Ephemeral });
  },
};

export default [giveaway, ticket, timer, feed, rolemenu, customcommand, automod];

// meelarp — support tickets (panel, claim, close, transcript)
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  PermissionFlagsBits, AttachmentBuilder, MessageFlags } from 'discord.js';
import { db, getSettings, now } from '../../db.js';
import { brandEmbed, safeChannel, logError, truncate } from '../util.js';

export function ticketsFor(guildId, { openOnly = false } = {}) {
  return openOnly
    ? db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND closed = 0 ORDER BY id DESC').all(guildId)
    : db.prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY id DESC LIMIT 100').all(guildId);
}

export async function sendPanel(channel, { title, description, buttonLabel } = {}) {
  const embed = brandEmbed({
    title: title || 'Need help?',
    description: description || 'Press the button below to open a private ticket with the staff team.',
    footer: 'meelarp tickets',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:open').setLabel(buttonLabel || 'Open a ticket')
      .setEmoji('🎫').setStyle(ButtonStyle.Primary));
  return channel.send({ embeds: [embed], components: [row] });
}

async function openTicket(interaction) {
  const guild = interaction.guild;
  const settings = getSettings(guild.id);
  const cfg = settings.tickets;

  const open = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND user_id = ? AND closed = 0')
    .get(guild.id, interaction.user.id).n;
  if (open >= (cfg.limitPerUser ?? 1)) {
    await interaction.reply({
      content: `You already have ${open} open ticket${open === 1 ? '' : 's'}. Close it before opening another.`,
      flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const number = (db.prepare('SELECT MAX(number) AS n FROM tickets WHERE guild_id = ?').get(guild.id).n ?? 0) + 1;
  const name = (cfg.nameTemplate || 'ticket-{number}')
    .replace('{number}', String(number).padStart(4, '0'))
    .replace('{user}', interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .slice(0, 90);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ...(cfg.supportRoles ?? []).filter((r) => guild.roles.cache.has(r)).map((r) => ({
      id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] })),
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: cfg.categoryId && guild.channels.cache.get(cfg.categoryId)?.type === ChannelType.GuildCategory
        ? cfg.categoryId : undefined,
      permissionOverwrites: overwrites,
      topic: `meelarp ticket #${number} · opened by ${interaction.user.tag} (${interaction.user.id})`,
    });
  } catch (e) {
    logError('tickets:create', e);
    await interaction.editReply({ content: 'I could not create the channel — check my Manage Channels permission.' });
    return;
  }

  db.prepare('INSERT INTO tickets (guild_id, number, channel_id, user_id, closed, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(guild.id, number, channel.id, interaction.user.id, now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger));

  await channel.send({
    content: `<@${interaction.user.id}>${(cfg.supportRoles ?? []).map((r) => ` <@&${r}>`).join('')}`,
    embeds: [brandEmbed({
      title: `Ticket #${String(number).padStart(4, '0')}`,
      description: cfg.openMessage,
      footer: `Opened by ${interaction.user.tag}`,
      timestamp: true,
    })],
    components: [row],
    allowedMentions: { users: [interaction.user.id], roles: cfg.supportRoles ?? [] },
  }).catch(() => {});

  await interaction.editReply({ content: `Your ticket is ready: <#${channel.id}>` });
}

async function claimTicket(interaction) {
  const settings = getSettings(interaction.guild.id);
  const isStaff = (settings.tickets.supportRoles ?? []).some((r) => interaction.member.roles.cache.has(r))
    || interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!isStaff) {
    await interaction.reply({ content: 'Only support staff can claim tickets.', flags: MessageFlags.Ephemeral });
    return;
  }
  db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?').run(interaction.user.id, interaction.channel.id);
  await interaction.reply({ embeds: [brandEmbed({
    description: `<@${interaction.user.id}> has claimed this ticket.`, color: 0x27e0a4 })] });
}

async function buildTranscript(channel, ticket) {
  const messages = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.reverse();
  const lines = messages.map((m) => {
    const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
    const attach = m.attachments.size ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]` : '';
    const embeds = m.embeds.length ? ` [${m.embeds.length} embed(s)]` : '';
    return `[${time}] ${m.author.tag}: ${m.content}${attach}${embeds}`;
  });
  const header = [
    `meelarp ticket transcript`,
    `Ticket #${String(ticket.number).padStart(4, '0')}`,
    `Opened by: ${ticket.user_id}`,
    `Channel: #${channel.name}`,
    `Messages: ${messages.length}`,
    ''.padEnd(50, '-'),
    '',
  ].join('\n');
  return Buffer.from(header + lines.join('\n'), 'utf8');
}

async function closeTicket(interaction) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND closed = 0').get(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: 'This channel is not an open ticket.', flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = getSettings(interaction.guild.id);
  const isStaff = (settings.tickets.supportRoles ?? []).some((r) => interaction.member.roles.cache.has(r))
    || interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!isStaff && interaction.user.id !== ticket.user_id) {
    await interaction.reply({ content: 'Only staff or the ticket author can close this.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ embeds: [brandEmbed({
    description: 'Closing this ticket and saving the transcript…', color: 0xffb020 })] });

  db.prepare('UPDATE tickets SET closed = 1, closed_at = ? WHERE id = ?').run(now(), ticket.id);

  try {
    const buffer = await buildTranscript(interaction.channel, ticket);
    const file = new AttachmentBuilder(buffer, { name: `ticket-${String(ticket.number).padStart(4, '0')}.txt` });
    const dest = safeChannel(interaction.guild, settings.tickets.transcriptChannel);
    if (dest) {
      await dest.send({
        embeds: [brandEmbed({
          title: `Ticket #${String(ticket.number).padStart(4, '0')} closed`,
          fields: [
            { name: 'Opened by', value: `<@${ticket.user_id}>`, inline: true },
            { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Claimed by', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Nobody', inline: true },
          ],
          timestamp: true,
        })],
        files: [file],
      }).catch(() => {});
    }
    const author = await interaction.client.users.fetch(ticket.user_id).catch(() => null);
    if (author) {
      await author.send({
        embeds: [brandEmbed({
          title: `Your ticket in ${interaction.guild.name} was closed`,
          description: truncate(settings.tickets.openMessage ?? '', 500),
        })],
        files: [new AttachmentBuilder(buffer, { name: `ticket-${String(ticket.number).padStart(4, '0')}.txt` })],
      }).catch(() => {});
    }
  } catch (e) { logError('tickets:transcript', e); }

  setTimeout(() => interaction.channel.delete('meelarp: ticket closed').catch(() => {}), 5000);
}

export async function handleTicketInteraction(interaction) {
  if (!interaction.customId?.startsWith('ticket:')) return false;
  const settings = getSettings(interaction.guild.id);
  if (!settings.modules.tickets) {
    await interaction.reply({ content: 'Tickets are disabled on this server.', flags: MessageFlags.Ephemeral });
    return true;
  }
  try {
    const action = interaction.customId.split(':')[1];
    if (action === 'open') await openTicket(interaction);
    else if (action === 'claim') await claimTicket(interaction);
    else if (action === 'close') await closeTicket(interaction);
  } catch (e) {
    logError('tickets', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong with that ticket action.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
  return true;
}

export async function addUserToTicket(channel, user) {
  await channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
}
export async function removeUserFromTicket(channel, user) {
  await channel.permissionOverwrites.delete(user.id);
}

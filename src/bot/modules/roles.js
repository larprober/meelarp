// meelarp — self-assignable role menus (buttons, dropdowns, reactions)
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { db, getSettings, jsonCol, now } from '../../db.js';
import { BRAND, logError, chunk } from '../util.js';

const qInsert = db.prepare(`
  INSERT INTO role_menus (guild_id, channel_id, message_id, title, description, style, mode, color, options, required_roles, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

export function listMenus(guildId) {
  return db.prepare('SELECT * FROM role_menus WHERE guild_id = ? ORDER BY id DESC').all(guildId)
    .map((m) => ({ ...m, options: jsonCol(m.options, []), required_roles: jsonCol(m.required_roles, []) }));
}

export function getMenu(id) {
  const m = db.prepare('SELECT * FROM role_menus WHERE id = ?').get(id);
  if (!m) return null;
  return { ...m, options: jsonCol(m.options, []), required_roles: jsonCol(m.required_roles, []) };
}

export function createMenu(guildId, data) {
  const info = qInsert.run(
    guildId, data.channelId ?? null, null, data.title ?? 'Pick your roles',
    data.description ?? null, data.style ?? 'buttons', data.mode ?? 'multi',
    data.color ?? BRAND.colorHex, JSON.stringify(data.options ?? []),
    JSON.stringify(data.requiredRoles ?? []), now());
  return getMenu(Number(info.lastInsertRowid));
}

export function updateMenu(id, data) {
  const menu = getMenu(id);
  if (!menu) return null;
  db.prepare(`UPDATE role_menus SET channel_id = ?, title = ?, description = ?, style = ?, mode = ?,
    color = ?, options = ?, required_roles = ? WHERE id = ?`).run(
    data.channelId ?? menu.channel_id, data.title ?? menu.title, data.description ?? menu.description,
    data.style ?? menu.style, data.mode ?? menu.mode, data.color ?? menu.color,
    JSON.stringify(data.options ?? menu.options), JSON.stringify(data.requiredRoles ?? menu.required_roles), id);
  return getMenu(id);
}

export function deleteMenu(id) {
  return db.prepare('DELETE FROM role_menus WHERE id = ?').run(id).changes > 0;
}

function menuByMessage(messageId) {
  const m = db.prepare('SELECT * FROM role_menus WHERE message_id = ?').get(messageId);
  return m ? { ...m, options: jsonCol(m.options, []), required_roles: jsonCol(m.required_roles, []) } : null;
}

function parseEmoji(raw) {
  if (!raw) return null;
  const custom = /^<a?:(\w+):(\d+)>$/.exec(raw);
  if (custom) return { id: custom[2], name: custom[1], animated: raw.startsWith('<a:') };
  return { name: raw };
}

function buildComponents(menu, guild) {
  const opts = menu.options.filter((o) => guild.roles.cache.has(o.roleId));
  if (!opts.length) return [];

  if (menu.style === 'select') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rm:sel:${menu.id}`)
      .setPlaceholder(menu.mode === 'unique' ? 'Choose one role' : 'Choose your roles')
      .setMinValues(0)
      .setMaxValues(menu.mode === 'unique' ? 1 : Math.min(25, opts.length));
    for (const o of opts.slice(0, 25)) {
      const builder = new StringSelectMenuOptionBuilder()
        .setLabel((o.label || guild.roles.cache.get(o.roleId)?.name || 'Role').slice(0, 100))
        .setValue(o.roleId);
      if (o.description) builder.setDescription(String(o.description).slice(0, 100));
      const emoji = parseEmoji(o.emoji);
      if (emoji) { try { builder.setEmoji(emoji); } catch {} }
      select.addOptions(builder);
    }
    return [new ActionRowBuilder().addComponents(select)];
  }

  const buttons = opts.slice(0, 25).map((o) => {
    const b = new ButtonBuilder()
      .setCustomId(`rm:btn:${menu.id}:${o.roleId}`)
      .setLabel((o.label || guild.roles.cache.get(o.roleId)?.name || 'Role').slice(0, 80))
      .setStyle(({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary,
        success: ButtonStyle.Success, danger: ButtonStyle.Danger })[o.style] ?? ButtonStyle.Secondary);
    const emoji = parseEmoji(o.emoji);
    if (emoji) { try { b.setEmoji(emoji); } catch {} }
    return b;
  });
  return chunk(buttons, 5).slice(0, 5).map((row) => new ActionRowBuilder().addComponents(row));
}

function buildEmbed(menu, guild) {
  const lines = menu.options
    .filter((o) => guild.roles.cache.has(o.roleId))
    .map((o) => `${o.emoji ? `${o.emoji} ` : '• '}<@&${o.roleId}>${o.description ? ` — ${o.description}` : ''}`);
  const embed = new EmbedBuilder()
    .setTitle(menu.title || 'Pick your roles')
    .setColor(Number(String(menu.color || BRAND.colorHex).replace('#', '0x')) || BRAND.color);
  const desc = [menu.description, menu.style === 'reactions' ? lines.join('\n') : null]
    .filter(Boolean).join('\n\n');
  if (desc) embed.setDescription(desc.slice(0, 4000));
  if (menu.mode === 'unique') embed.setFooter({ text: 'You can hold only one role from this menu.' });
  if (menu.mode === 'verify') embed.setFooter({ text: 'Click to verify and unlock the server.' });
  return embed;
}

/** Post (or repost) a menu into its channel. */
export async function publishMenu(guild, menuId) {
  const menu = getMenu(menuId);
  if (!menu) return { ok: false, error: 'Menu not found.' };
  const channel = guild.channels.cache.get(menu.channel_id);
  if (!channel?.isTextBased()) return { ok: false, error: 'Menu has no valid channel.' };

  const payload = { embeds: [buildEmbed(menu, guild)], components: buildComponents(menu, guild) };

  let message = null;
  if (menu.message_id) {
    message = await channel.messages.fetch(menu.message_id).catch(() => null);
  }
  if (message) await message.edit(payload).catch(() => { message = null; });
  if (!message) {
    message = await channel.send(payload).catch((e) => { logError('roles:publish', e); return null; });
    if (!message) return { ok: false, error: 'I could not post in that channel.' };
    db.prepare('UPDATE role_menus SET message_id = ? WHERE id = ?').run(message.id, menu.id);
  }

  if (menu.style === 'reactions') {
    for (const o of menu.options) {
      if (!o.emoji) continue;
      await message.react(o.emoji).catch(() => {});
    }
  }
  return { ok: true, messageId: message.id, url: message.url };
}

async function toggleRole(member, roleId, menu, mode = 'toggle') {
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { ok: false, msg: 'That role no longer exists.' };
  if (!role.editable) return { ok: false, msg: `I cannot assign **${role.name}** — my role must sit above it.` };

  if (menu.required_roles?.length && !menu.required_roles.some((r) => member.roles.cache.has(r))) {
    return { ok: false, msg: 'You do not have the role required to use this menu.' };
  }

  const has = member.roles.cache.has(roleId);

  if (menu.mode === 'verify' && has) return { ok: true, msg: `You already have **${role.name}**.` };
  if (menu.mode === 'add-only' && has) return { ok: true, msg: `You already have **${role.name}**.` };
  if (menu.mode === 'remove-only' && !has) return { ok: true, msg: `You do not have **${role.name}**.` };

  if (menu.mode === 'unique') {
    const others = menu.options.map((o) => o.roleId).filter((id) => id !== roleId && member.roles.cache.has(id));
    if (others.length) await member.roles.remove(others, 'meelarp: unique role menu').catch(() => {});
  }

  if (has && mode !== 'add') {
    await member.roles.remove(roleId, 'meelarp: role menu');
    return { ok: true, msg: `Removed **${role.name}**.` };
  }
  if (!has && mode !== 'remove') {
    await member.roles.add(roleId, 'meelarp: role menu');
    return { ok: true, msg: `Added **${role.name}**.` };
  }
  return { ok: true, msg: 'No change.' };
}

export async function handleRoleInteraction(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('rm:')) return false;
  const settings = getSettings(interaction.guild.id);
  if (!settings.modules.roles) {
    await interaction.reply({ content: 'The roles module is disabled here.', flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    if (id.startsWith('rm:btn:')) {
      const [, , menuId, roleId] = id.split(':');
      const menu = getMenu(Number(menuId));
      if (!menu) { await interaction.reply({ content: 'This menu no longer exists.', flags: MessageFlags.Ephemeral }); return true; }
      const res = await toggleRole(interaction.member, roleId, menu);
      await interaction.reply({ content: res.msg, flags: MessageFlags.Ephemeral });
      return true;
    }

    if (id.startsWith('rm:sel:')) {
      const menuId = Number(id.split(':')[2]);
      const menu = getMenu(menuId);
      if (!menu) { await interaction.reply({ content: 'This menu no longer exists.', flags: MessageFlags.Ephemeral }); return true; }
      const chosen = new Set(interaction.values);
      const all = menu.options.map((o) => o.roleId);
      const lines = [];
      for (const roleId of all) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role?.editable) continue;
        const has = interaction.member.roles.cache.has(roleId);
        if (chosen.has(roleId) && !has) {
          await interaction.member.roles.add(roleId, 'meelarp: role menu').catch(() => {});
          lines.push(`+ ${role.name}`);
        } else if (!chosen.has(roleId) && has && menu.mode !== 'add-only') {
          await interaction.member.roles.remove(roleId, 'meelarp: role menu').catch(() => {});
          lines.push(`− ${role.name}`);
        }
      }
      await interaction.reply({
        content: lines.length ? `Updated your roles:\n\`\`\`diff\n${lines.join('\n')}\n\`\`\`` : 'No changes.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
  } catch (e) {
    logError('roles:interaction', e);
    if (!interaction.replied) {
      await interaction.reply({ content: 'Something went wrong assigning that role.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return true;
  }
  return false;
}

/** Classic reaction-role handling. */
export async function handleRoleReaction(reaction, user, added) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const menu = menuByMessage(reaction.message.id);
    if (!menu || menu.style !== 'reactions') return;
    const guild = reaction.message.guild;
    if (!guild) return;
    const settings = getSettings(guild.id);
    if (!settings.modules.roles) return;

    const emojiKey = reaction.emoji.id ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const option = menu.options.find((o) => o.emoji === emojiKey || o.emoji === reaction.emoji.name);
    if (!option) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    await toggleRole(member, option.roleId, menu, added ? 'add' : 'remove');
  } catch (e) { logError('roles:reaction', e); }
}

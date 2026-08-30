// meelarp — starboard (highlight channel)
import { db, getSettings } from '../../db.js';
import { brandEmbed, safeChannel, truncate, logError } from '../util.js';

const qGet = db.prepare('SELECT * FROM starboard WHERE guild_id = ? AND message_id = ?');
const qUpsert = db.prepare(`
  INSERT INTO starboard (guild_id, message_id, star_message_id, count) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, message_id) DO UPDATE SET star_message_id = excluded.star_message_id, count = excluded.count`);

function matchesEmoji(reaction, configured) {
  const name = reaction.emoji.id
    ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji.name;
  return name === configured || reaction.emoji.name === configured;
}

export async function handleStar(reaction, user) {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const message = reaction.message;
    const guild = message.guild;
    if (!guild || user.bot) return;

    const settings = getSettings(guild.id);
    if (!settings.modules.starboard) return;
    const sb = settings.starboard;
    if (!matchesEmoji(reaction, sb.emoji || '⭐')) return;
    if ((sb.ignoredChannels ?? []).includes(message.channel.id)) return;

    const board = safeChannel(guild, sb.channelId);
    if (!board || board.id === message.channel.id) return;

    let count = reaction.count ?? 0;
    if (!sb.selfStar) {
      const users = await reaction.users.fetch().catch(() => null);
      if (users?.has(message.author.id)) count -= 1;
    }

    const existing = qGet.get(guild.id, message.id);

    if (count < (sb.threshold ?? 3)) {
      if (existing?.star_message_id) {
        await board.messages.delete(existing.star_message_id).catch(() => {});
        db.prepare('DELETE FROM starboard WHERE guild_id = ? AND message_id = ?').run(guild.id, message.id);
      }
      return;
    }

    const embed = brandEmbed({
      color: 0xf5c451,
      author: { name: message.author.tag, iconURL: message.author.displayAvatarURL({ size: 64 }) },
      description: truncate(message.content || '*no text*', 2000),
      fields: [{ name: 'Source', value: `[Jump to message](${message.url}) in <#${message.channel.id}>` }],
      timestamp: true,
      footer: `${message.id}`,
    });
    const image = [...message.attachments.values()].find((a) => a.contentType?.startsWith('image/'));
    if (image) embed.setImage(image.url);

    const content = `${sb.emoji || '⭐'} **${count}** · <#${message.channel.id}>`;

    if (existing?.star_message_id) {
      const starMsg = await board.messages.fetch(existing.star_message_id).catch(() => null);
      if (starMsg) {
        await starMsg.edit({ content, embeds: [embed] }).catch(() => {});
        qUpsert.run(guild.id, message.id, existing.star_message_id, count);
        return;
      }
    }
    const posted = await board.send({ content, embeds: [embed] }).catch(() => null);
    if (posted) qUpsert.run(guild.id, message.id, posted.id, count);
  } catch (e) { logError('starboard', e); }
}

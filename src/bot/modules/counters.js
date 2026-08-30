// meelarp — server stat counters (auto-renamed voice/text channels)
import { getSettings } from '../../db.js';
import { logError } from '../util.js';

const lastRename = new Map(); // channelId -> ts (Discord rate-limits channel renames hard)

function valueFor(guild, item) {
  const members = guild.members.cache;
  switch (item.type) {
    case 'members': return guild.memberCount;
    case 'humans': return members.filter((m) => !m.user.bot).size;
    case 'bots': return members.filter((m) => m.user.bot).size;
    case 'boosts': return guild.premiumSubscriptionCount ?? 0;
    case 'boostTier': return guild.premiumTier ?? 0;
    case 'online': return members.filter((m) => m.presence && m.presence.status !== 'offline').size;
    case 'roles': return guild.roles.cache.size - 1;
    case 'channels': return guild.channels.cache.filter((c) => c.type !== 4).size;
    case 'role': return item.roleId ? members.filter((m) => m.roles.cache.has(item.roleId)).size : 0;
    default: return 0;
  }
}

export async function updateCounters(client) {
  for (const guild of client.guilds.cache.values()) {
    const settings = getSettings(guild.id);
    if (!settings.modules.counters) continue;
    const items = settings.counters.items ?? [];
    if (!items.length) continue;

    for (const item of items) {
      const channel = guild.channels.cache.get(item.channelId);
      if (!channel?.manageable) continue;
      // Discord allows ~2 channel renames per 10 minutes; stay well under.
      if (Date.now() - (lastRename.get(channel.id) ?? 0) < 6 * 60 * 1000) continue;

      const value = valueFor(guild, item);
      const name = (item.template || '{type}: {count}')
        .replace('{count}', String(value))
        .replace('{type}', item.type)
        .replace('{server}', guild.name)
        .slice(0, 100);
      if (channel.name === name) continue;

      try {
        await channel.setName(name, 'meelarp: counter update');
        lastRename.set(channel.id, Date.now());
      } catch (e) { logError('counters', e); }
    }
  }
}

export const counterTypes = [
  { id: 'members', label: 'Total members' },
  { id: 'humans', label: 'Humans' },
  { id: 'bots', label: 'Bots' },
  { id: 'online', label: 'Online members' },
  { id: 'boosts', label: 'Boost count' },
  { id: 'boostTier', label: 'Boost tier' },
  { id: 'roles', label: 'Role count' },
  { id: 'channels', label: 'Channel count' },
  { id: 'role', label: 'Members with a role' },
];

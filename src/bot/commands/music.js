// meelarp — music commands
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getSettings } from '../../db.js';
import { brandEmbed, ok, fail, formatDuration, truncate } from '../util.js';
import { playRequest, getQueue, nowPlayingEmbed, isDj, musicReady, capabilities } from '../modules/music.js';

function guard(interaction, { needQueue = true, needDj = true } = {}) {
  const settings = getSettings(interaction.guild.id);
  if (!settings.modules.music) return { error: 'The music module is disabled on this server.' };
  const queue = getQueue(interaction.guild.id);
  if (needQueue && (!queue || !queue.current)) return { error: 'Nothing is playing right now.' };
  if (needDj && !isDj(interaction.member)) return { error: 'You need a DJ role to control playback.' };
  if (queue && interaction.member.voice?.channelId !== queue.voiceChannel.id && needDj) {
    return { error: 'Join my voice channel first.' };
  }
  return { queue };
}

const play = {
  data: new SlashCommandBuilder().setName('play').setDescription('Play a track or playlist')
    .addStringOption((o) => o.setName('query').setDescription('Search terms or a YouTube URL').setRequired(true)),
  async execute(interaction) {
    const settings = getSettings(interaction.guild.id);
    if (!settings.modules.music) return interaction.reply({ embeds: [fail('The music module is disabled here.')], flags: MessageFlags.Ephemeral });
    const ready = musicReady();
    if (!ready.ok) {
      return interaction.reply({ embeds: [fail(
        `Music needs these on the host machine: **${ready.missing.join(', ')}**.\nInstall yt-dlp and restart meelarp.`)], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    try {
      const res = await playRequest({
        guild: interaction.guild, member: interaction.member,
        textChannel: interaction.channel, query: interaction.options.getString('query'),
      });
      if (!res.ok) return interaction.editReply({ embeds: [fail(res.error)] });
      if (res.tracks.length > 1) {
        return interaction.editReply({ embeds: [ok(`Queued **${res.added}** tracks.`)] });
      }
      const t = res.tracks[0];
      return interaction.editReply({ embeds: [ok(
        `Queued **${truncate(t.title, 80)}**${t.duration ? ` · ${formatDuration(t.duration)}` : ''}`)] });
    } catch (e) {
      return interaction.editReply({ embeds: [fail(`Could not play that: ${e.message}`)] });
    }
  },
};

const skip = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    const title = g.queue.current?.title;
    g.queue.player.stop(true);
    return interaction.reply({ embeds: [ok(`Skipped **${truncate(title ?? 'track', 80)}**.`)] });
  },
};

const stop = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and leave'),
  async execute(interaction) {
    const g = guard(interaction, { needQueue: false });
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    if (!g.queue) return interaction.reply({ embeds: [fail('I am not in a voice channel.')], flags: MessageFlags.Ephemeral });
    g.queue.destroy();
    return interaction.reply({ embeds: [ok('Stopped and left the channel.')] });
  },
};

const pause = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    g.queue.player.pause();
    return interaction.reply({ embeds: [ok('Paused.')] });
  },
};

const resume = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    g.queue.player.unpause();
    return interaction.reply({ embeds: [ok('Resumed.')] });
  },
};

const queueCmd = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the queue'),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue?.current) return interaction.reply({ embeds: [fail('Nothing is playing.')], flags: MessageFlags.Ephemeral });
    const upcoming = queue.tracks.slice(0, 10)
      .map((t, i) => `\`${String(i + 1).padStart(2, '0')}\` ${truncate(t.title, 60)} · ${t.duration ? formatDuration(t.duration) : 'live'}`);
    return interaction.reply({ embeds: [brandEmbed({
      title: 'Queue',
      description: `**Now:** ${truncate(queue.current.title, 80)}\n\n${upcoming.join('\n') || '*nothing queued*'}`,
      footer: `${queue.tracks.length} in queue · loop: ${queue.loop} · volume ${queue.volume}%`,
    })] });
  },
};

const nowplaying = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track'),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue?.current) return interaction.reply({ embeds: [fail('Nothing is playing.')], flags: MessageFlags.Ephemeral });
    return interaction.reply({ embeds: [nowPlayingEmbed(queue.current, queue)] });
  },
};

const loop = {
  data: new SlashCommandBuilder().setName('loop').setDescription('Set the loop mode')
    .addStringOption((o) => o.setName('mode').setDescription('Loop mode').setRequired(true)
      .addChoices({ name: 'off', value: 'off' }, { name: 'track', value: 'track' }, { name: 'queue', value: 'queue' })),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    g.queue.loop = interaction.options.getString('mode');
    return interaction.reply({ embeds: [ok(`Loop mode: **${g.queue.loop}**.`)] });
  },
};

const volume = {
  data: new SlashCommandBuilder().setName('volume').setDescription('Set playback volume')
    .addIntegerOption((o) => o.setName('percent').setDescription('0-200').setRequired(true).setMinValue(0).setMaxValue(200)),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    const applied = g.queue.setVolume(interaction.options.getInteger('percent'));
    return interaction.reply({ embeds: [applied
      ? ok(`Volume set to **${g.queue.volume}%**.`)
      : brandEmbed({ color: 0xffb020, description:
          `Saved **${g.queue.volume}%**, but live volume control needs ffmpeg installed on the host.` })] });
  },
};

const shuffle = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    const t = g.queue.tracks;
    for (let i = t.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [t[i], t[j]] = [t[j], t[i]];
    }
    return interaction.reply({ embeds: [ok(`Shuffled **${t.length}** tracks.`)] });
  },
};

const removeTrack = {
  data: new SlashCommandBuilder().setName('remove').setDescription('Remove a track from the queue')
    .addIntegerOption((o) => o.setName('position').setDescription('Queue position').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    const g = guard(interaction);
    if (g.error) return interaction.reply({ embeds: [fail(g.error)], flags: MessageFlags.Ephemeral });
    const pos = interaction.options.getInteger('position');
    const [removed] = g.queue.tracks.splice(pos - 1, 1);
    return interaction.reply({ embeds: [removed
      ? ok(`Removed **${truncate(removed.title, 80)}**.`)
      : fail('Nothing at that position.')] });
  },
};

const musicStatus = {
  data: new SlashCommandBuilder().setName('musicstatus').setDescription('Check what the music player needs'),
  async execute(interaction) {
    const rows = [
      ['Voice library', capabilities.voice],
      ['Search (youtube-sr)', capabilities.search],
      ['yt-dlp (streaming)', capabilities.ytdlp],
      ['ffmpeg (volume control)', capabilities.ffmpeg],
    ];
    return interaction.reply({ embeds: [brandEmbed({
      title: 'Music dependencies',
      description: rows.map(([name, present]) => `${present ? '🟢' : '🔴'} ${name}`).join('\n'),
      footer: capabilities.ytdlp ? 'Ready to play' : 'Install yt-dlp on the host to enable playback',
    })], flags: MessageFlags.Ephemeral });
  },
};

export default [play, skip, stop, pause, resume, queueCmd, nowplaying, loop, volume, shuffle, removeTrack, musicStatus];

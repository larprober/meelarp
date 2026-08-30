// meelarp — music player (MEE6 premium feature, free here)
// Playback needs yt-dlp on PATH; ffmpeg is optional (enables volume control).
import { spawn, spawnSync } from 'node:child_process';
import { brandEmbed, formatDuration, truncate, logError } from '../util.js';
import { getSettings } from '../../db.js';

let voice = null, search = null;
try { voice = await import('@discordjs/voice'); } catch {}
try { search = (await import('youtube-sr')).default; } catch {}

/**
 * Resolve a tool to an absolute path once, at startup. The shell is used only
 * here, with a hard-coded tool name — never with anything a Discord user typed.
 * Media processes are then spawned from the resolved path with shell: false, so
 * a track URL can never reach a command interpreter.
 */
function resolveBin(name) {
  try {
    const lookup = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`;
    const r = spawnSync(lookup, { shell: true, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const found = (r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (!found) return null;
    // Node refuses to run .cmd/.bat shims without a shell, and we will not use one.
    if (/\.(cmd|bat)$/i.test(found)) {
      console.warn(`[meelarp:music] ${name} resolved to a shim (${found}). `
        + 'Install the standalone executable so meelarp can run it without a shell.');
      return null;
    }
    return found;
  } catch { return null; }
}

const YTDLP = resolveBin('yt-dlp') ?? resolveBin('youtube-dl');
const FFMPEG = resolveBin('ffmpeg');

export const capabilities = {
  voice: !!voice,
  search: !!search,
  ytdlp: !!YTDLP,
  ffmpeg: !!FFMPEG,
};

/** Only well-formed http(s) URLs are ever handed to the downloader. */
export function safeTrackUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch { return null; }
}

export function musicReady() {
  const missing = [];
  if (!capabilities.voice) missing.push('@discordjs/voice');
  if (!capabilities.ytdlp) missing.push('yt-dlp (install from https://github.com/yt-dlp/yt-dlp)');
  return { ok: missing.length === 0, missing };
}

// --- queues ---------------------------------------------------------------
const queues = new Map(); // guildId -> queue

class Queue {
  constructor(guild, textChannel, voiceChannel) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.tracks = [];
    this.current = null;
    this.loop = 'off';       // off | track | queue
    this.volume = getSettings(guild.id).music.defaultVolume ?? 60;
    this.connection = null;
    this.player = null;
    this.process = null;
    this.destroyed = false;
    this.emptySince = null;
  }

  get playing() { return !!this.current; }

  async connect() {
    if (this.connection) return this.connection;
    this.connection = voice.joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.player = voice.createAudioPlayer({
      behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause },
    });
    this.connection.subscribe(this.player);

    this.player.on(voice.AudioPlayerStatus.Idle, () => { this.advance().catch((e) => logError('music:advance', e)); });
    this.player.on('error', (e) => {
      logError('music:player', e);
      this.textChannel?.send({ embeds: [brandEmbed({ color: 0xff4d6d,
        description: `Playback error on **${this.current?.title ?? 'track'}** — skipping.` })] }).catch(() => {});
      this.advance().catch(() => {});
    });

    this.connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          voice.entersState(this.connection, voice.VoiceConnectionStatus.Signalling, 5000),
          voice.entersState(this.connection, voice.VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch { this.destroy(); }
    });

    await voice.entersState(this.connection, voice.VoiceConnectionStatus.Ready, 20000).catch(() => {});
    return this.connection;
  }

  add(track) {
    const max = getSettings(this.guild.id).music.maxQueue ?? 200;
    if (this.tracks.length >= max) return false;
    this.tracks.push(track);
    return true;
  }

  async start() {
    if (this.current) return;
    await this.advance();
  }

  async advance() {
    if (this.destroyed) return;
    if (this.loop === 'track' && this.current) {
      return this.play(this.current);
    }
    if (this.loop === 'queue' && this.current) this.tracks.push(this.current);

    const next = this.tracks.shift();
    if (!next) {
      this.current = null;
      this.emptySince = Date.now();
      const leaveAfter = getSettings(this.guild.id).music.leaveOnEmptySeconds ?? 120;
      setTimeout(() => {
        if (!this.current && !this.destroyed && Date.now() - (this.emptySince ?? 0) >= leaveAfter * 1000) {
          this.textChannel?.send({ embeds: [brandEmbed({ description: 'Queue finished — leaving the voice channel.' })] }).catch(() => {});
          this.destroy();
        }
      }, leaveAfter * 1000 + 500);
      return;
    }
    await this.play(next);
  }

  async play(track) {
    this.current = track;
    this.emptySince = null;
    this.killProcess();

    const url = safeTrackUrl(track.url);
    if (!url) {
      logError('music:play', new Error(`Refusing to play a non-http(s) source: ${track.url}`));
      return this.advance();
    }

    const format = capabilities.ffmpeg
      ? 'bestaudio/best'
      : 'bestaudio[ext=webm][acodec=opus]/bestaudio[acodec=opus]/bestaudio';

    const args = ['-f', format, '-o', '-', '--no-playlist', '--quiet', '--no-warnings', '--', url];
    const proc = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    this.process = proc;
    proc.stderr.on('data', () => {});
    proc.on('error', (e) => logError('music:ytdlp', e));

    let resource;
    if (capabilities.ffmpeg) {
      const ff = spawn(FFMPEG, ['-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', '0',
        '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
        { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
      proc.stdout.pipe(ff.stdin).on('error', () => {});
      this.ffmpeg = ff;
      resource = voice.createAudioResource(ff.stdout, { inputType: voice.StreamType.Raw, inlineVolume: true });
      resource.volume?.setVolume(this.volume / 100);
    } else {
      resource = voice.createAudioResource(proc.stdout, { inputType: voice.StreamType.WebmOpus });
    }

    this.resource = resource;
    this.player.play(resource);

    if (this.textChannel) {
      await this.textChannel.send({ embeds: [nowPlayingEmbed(track, this)] }).catch(() => {});
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(200, v));
    this.resource?.volume?.setVolume(this.volume / 100);
    return capabilities.ffmpeg;
  }

  killProcess() {
    try { this.process?.kill(); } catch {}
    try { this.ffmpeg?.kill(); } catch {}
    this.process = null;
    this.ffmpeg = null;
  }

  destroy() {
    this.destroyed = true;
    this.killProcess();
    try { this.player?.stop(true); } catch {}
    try { this.connection?.destroy(); } catch {}
    queues.delete(this.guild.id);
  }
}

export function getQueue(guildId) { return queues.get(guildId) ?? null; }

export function nowPlayingEmbed(track, queue) {
  return brandEmbed({
    title: 'Now playing',
    description: `**[${truncate(track.title, 90)}](${track.url})**`,
    thumbnail: track.thumbnail,
    fields: [
      { name: 'Duration', value: track.duration ? formatDuration(track.duration) : 'live', inline: true },
      { name: 'Requested by', value: `<@${track.requestedBy}>`, inline: true },
      { name: 'Up next', value: queue?.tracks[0] ? truncate(queue.tracks[0].title, 60) : 'nothing', inline: true },
    ],
    footer: queue ? `Volume ${queue.volume}% · loop: ${queue.loop} · ${queue.tracks.length} in queue` : undefined,
  });
}

// --- resolving ------------------------------------------------------------
export async function resolveTracks(query, requestedBy) {
  if (!search) throw new Error('Search is unavailable (youtube-sr not installed).');
  const isUrl = /^https?:\/\//i.test(query);

  if (isUrl && /[?&]list=/.test(query)) {
    const playlist = await search.getPlaylist(query, { limit: 100 }).catch(() => null);
    if (playlist) {
      return playlist.videos.map((v) => ({
        title: v.title, url: v.url, duration: Math.round((v.duration ?? 0) / 1000),
        thumbnail: v.thumbnail?.url, requestedBy,
      }));
    }
  }
  if (isUrl) {
    const info = await search.getVideo(query).catch(() => null);
    if (info) {
      return [{ title: info.title, url: info.url, duration: Math.round((info.duration ?? 0) / 1000),
        thumbnail: info.thumbnail?.url, requestedBy }];
    }
    const direct = safeTrackUrl(query);
    if (!direct) throw new Error('That does not look like a playable http(s) link.');
    return [{ title: direct, url: direct, duration: 0, thumbnail: null, requestedBy }];
  }
  const results = await search.search(query, { limit: 1, type: 'video' });
  if (!results.length) return [];
  const v = results[0];
  return [{ title: v.title, url: v.url, duration: Math.round((v.duration ?? 0) / 1000),
    thumbnail: v.thumbnail?.url, requestedBy }];
}

export async function playRequest({ guild, member, textChannel, query }) {
  const ready = musicReady();
  if (!ready.ok) return { ok: false, error: `Music needs: ${ready.missing.join(', ')}` };

  const vc = member.voice?.channel;
  if (!vc) return { ok: false, error: 'Join a voice channel first.' };
  const perms = vc.permissionsFor(guild.members.me);
  if (!perms?.has('Connect') || !perms?.has('Speak')) {
    return { ok: false, error: 'I need Connect and Speak permissions in that channel.' };
  }

  let queue = queues.get(guild.id);
  if (!queue || queue.destroyed) {
    queue = new Queue(guild, textChannel, vc);
    queues.set(guild.id, queue);
    await queue.connect();
  }

  const tracks = await resolveTracks(query, member.id);
  if (!tracks.length) return { ok: false, error: 'Nothing found for that query.' };
  let added = 0;
  for (const t of tracks) if (queue.add(t)) added++;

  if (!queue.playing) await queue.start();
  return { ok: true, added, tracks, queue, queued: queue.playing && added > 0 };
}

export function isDj(member) {
  const settings = getSettings(member.guild.id);
  const djRoles = settings.music.djRoles ?? [];
  if (!djRoles.length) return true;
  if (member.permissions.has('ManageGuild')) return true;
  return djRoles.some((r) => member.roles.cache.has(r));
}

export function destroyAll() {
  for (const q of queues.values()) q.destroy();
}

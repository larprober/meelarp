# meelarp

Every MEE6 feature — **including the ones MEE6 charges for** — as a self-hosted Discord bot
with its own web dashboard. Leveling with custom rank cards, moderation, automod, welcome
images, unlimited role menus and custom commands, social feeds, giveaways, tickets, timers,
logs, counters and music. Nothing is gated, because there is no tier to sell.

Runs on Node 22.5+ with **one** dependency (`discord.js`). Storage is Node's built-in SQLite —
no database server, no native build step.

---

## Setup

```bash
npm install
npm run setup
```

`npm run setup` writes a `.env` with a random session secret. Then fill in three values from
the [Discord developer portal](https://discord.com/developers/applications):

| Step | Where | Goes into |
| --- | --- | --- |
| Create an application | Applications → New Application | — |
| **Bot** tab → Reset Token | copy the token | `DISCORD_TOKEN` |
| **Bot** tab → Privileged Gateway Intents | enable **all three** (Presence, Server Members, Message Content) | — |
| **General Information** → Application ID | copy | `CLIENT_ID` |
| **OAuth2** → Client Secret | copy | `CLIENT_SECRET` |
| **OAuth2** → Redirects → Add | `http://localhost:3400/callback` | must match `BASE_URL` |

Then:

```bash
npm start
```

That starts the bot and the dashboard together on <http://localhost:3400>. Slash commands
register automatically on first connect (they can take a few minutes to appear globally).

Open the dashboard, sign in with Discord, and pick a server. Use the **Add to Discord**
button (or `http://localhost:3400/invite`) to invite the bot.

### Two ways to configure

Run **`/dashboard`** in Discord for a private control panel — buttons, native channel and
role pickers, and pop-up forms covering modules, leveling, moderation, automod, welcome,
role menus, logs, tickets, starboard, music and counters. Nobody else can see it, and it
needs Manage Server.

The **web dashboard** covers the same ground plus the things that need more room: the rank
card designer with a live preview, the custom command editor, feed and timer management,
the case log, and the XP leaderboard with per-member editing. Both write to the same
database, so use whichever is closer to hand.

### Other commands

```bash
npm run bot      # bot only, no dashboard
npm run web      # dashboard only
npm run deploy   # re-register slash commands and exit
```

---

## What is included

| Module | What it does | MEE6 tier |
| --- | --- | --- |
| **Leveling** | XP per message with cooldown, four level curves (the default matches MEE6 exactly), role rewards that stack or replace, per-role and per-channel XP multipliers, no-XP channels and roles, voice XP, public web leaderboard | Premium bits free |
| **Rank cards** | Generated PNG with your accent colour, background image, bar style and progress ring | **Premium** |
| **Moderation** | ban / tempban / softban / kick / timeout / mute / warn / purge with filters / lock / slowmode / nick / role, every action recorded as a numbered case, DM notices, warning-escalation ladder, protected roles | Free |
| **Automod** | Invites, links (allow or block list), spam, duplicates, mass mentions, caps, word filter (with leetspeak and spacing evasion detection plus built-in presets), emoji floods, zalgo, attachments, newline spam — each with its own action, plus a strike-based escalation ladder and a live filter tester in the dashboard | Free |
| **Welcome** | Channel message, embed, DM, boost message, generated welcome banner, autorole with delay, separate bot roles, sticky roles that return on rejoin | Images are **Premium** |
| **Role menus** | Unlimited menus as buttons, dropdowns or classic reactions; multi, unique, add-only and verify modes | Unlimited is **Premium** |
| **Custom commands** | Unlimited, with embeds, aliases, cooldowns, channel and role restrictions, role-granting actions, DM replies | Unlimited is **Premium** |
| **Feeds** | YouTube, Twitch, Reddit and any RSS feed, unlimited sources, custom announcement text | More than 3 is **Premium** |
| **Timers** | Recurring scheduled messages, optional cleanup of the previous post, pause/resume | **Premium** |
| **Giveaways** | Button entry, requirements (role, level, message count, account age), automatic draw, rerolls | Free |
| **Tickets** | One-button panel, private channels, staff claiming, text transcripts to an archive channel | Free |
| **Logs** | Message, member, role, channel, ban, voice, invite and thread events with per-event channels and ignored channels | Free |
| **Counters** | Voice channels that rename themselves with live member/boost/role counts | Free |
| **Music** | Queue, search, playlists, loop modes, shuffle, volume, DJ roles | **Premium** |
| **Starboard** | Highlight messages that pass a reaction threshold | Free |

54 slash commands in total — run `/help` in Discord for the list.

### Music needs one extra tool

Playback streams through [yt-dlp](https://github.com/yt-dlp/yt-dlp), which must be on the
host's `PATH` as a **standalone executable** — meelarp never runs media tools through a
shell (a track URL must not be able to reach a command interpreter), and Node cannot launch
a `.cmd`/`.bat` shim without one. `ffmpeg` is optional and only adds live volume control.
Run `/musicstatus` in Discord to see what is detected. Everything else works without them.

### Twitch alerts need API keys

Create an app at <https://dev.twitch.tv/console/apps> and put the ID and secret in
`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`. YouTube, Reddit and RSS need no keys.

---

## Placeholders

Usable in welcome messages, level-up announcements, custom commands, timers and feeds:

```
{user:mention} {user:name} {user:tag} {user:id} {user:nickname} {user:avatar}
{user:created} {user:joined}
{server:name} {server:id} {server:membercount} {server:boosts} {server:owner} {server:icon}
{channel:mention} {channel:name}
{level} {date} {time} {timestamp}
```

Custom commands additionally get `{args}`, `{args:1}`…`{args:3}`, `{touser}`,
`{mention:1}` and `{random:100}`. Feeds get `{name}`, `{title}`, `{url}`, `{author}`,
`{description}`.

---

## Hosting it properly

The dashboard is a plain `node:http` server, so put it behind nginx/Caddy for TLS and set
`BASE_URL` to the public HTTPS URL (and add that `/callback` to the Discord redirect list).
Sessions are signed cookies; keep `SESSION_SECRET` secret and stable, or everyone gets
logged out.

Everything lives in `data/meelarp.db`. Backing meelarp up is copying that file — which is
the thing MEE6 sells as "server backups".

## Layout

```
src/
  config.js            settings schema + .env loader
  db.js                SQLite schema, per-guild settings cache
  bot/
    index.js           client, events, schedulers
    util.js            placeholders, durations, embeds, permission checks
    rankcard.js        rank + welcome image rendering
    commands/          54 slash commands, grouped by area
    modules/           levels, moderation, automod, welcome, roles, customcommands,
                       timers, feeds, giveaways, tickets, logs, counters, starboard, music
  web/
    server.js          HTTP router, static files, Discord OAuth
    session.js         signed cookie sessions
    api.js             dashboard JSON API
public/                dashboard front end (no build step, no framework)
```

Not affiliated with MEE6.

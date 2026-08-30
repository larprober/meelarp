// meelarp — dashboard pages: roles, commands, timers, feeds, giveaways,
// tickets, logs, counters, music, starboard, server settings
import { icon } from '/icons.js';
import { S, api, esc, card, toast, modal, confirmDialog, toggleField, textField, numberField,
  selectField, colorField, channelField, roleField, listField, emptyState, markDirty, bindFields,
  roleOptions, channelOptions, roleName, channelName, timeAgo, formatDuration, parseDuration,
  PLACEHOLDER_HELP, num, getPath } from '/ui.js';

const fieldRow = (label, inner, hint) => `
  <div class="field"><label>${esc(label)}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

// =========================================================================
export const roles = {
  title: 'Role menus',
  subtitle: 'Let members pick their own roles — buttons, dropdowns or reactions. No limits.',
  module: 'roles',
  _editing: null,

  async render() {
    const { menus } = await api('/rolemenus');
    this._menus = menus;
    const editing = this._editing;

    const list = menus.length ? menus.map((m) => `
      <div class="list-item">
        <div class="card-icon" style="width:32px;height:32px">${icon(
          m.style === 'select' ? 'caret' : m.style === 'reactions' ? 'sparkle' : 'tag', 16)}</div>
        <div class="meta">
          <strong>${esc(m.title ?? 'Untitled menu')}</strong>
          <span>${m.options.length} role${m.options.length === 1 ? '' : 's'} · ${esc(m.style)} · ${esc(m.mode)}
            ${m.channel_id ? `· ${esc(channelName(m.channel_id))}` : ''}</span>
        </div>
        <span class="pill ${m.message_id ? 'on' : 'off'}">${m.message_id ? 'posted' : 'not posted'}</span>
        <button class="btn btn-ghost btn-sm" data-menu-edit="${m.id}">Edit</button>
        <button class="btn btn-sm" data-menu-publish="${m.id}">${icon('send', 14)} Publish</button>
        <button class="btn btn-ghost btn-sm btn-icon" data-menu-delete="${m.id}">${icon('trash', 15)}</button>
      </div>`).join('')
      : emptyState('tag', 'No role menus yet', 'Create one and members can self-assign roles.');

    const optionRow = (o, i) => `
      <div class="list-item" data-opt-row="${i}">
        <select data-opt="roleId" style="max-width:200px">${roleOptions(o.roleId, { none: 'Pick a role…', assignableOnly: true })}</select>
        <input type="text" data-opt="label" class="grow" placeholder="Button label" value="${esc(o.label ?? '')}">
        <input type="text" data-opt="emoji" placeholder="Emoji" style="max-width:100px" value="${esc(o.emoji ?? '')}">
        <input type="text" data-opt="description" class="grow" placeholder="Description (dropdowns)" value="${esc(o.description ?? '')}">
        <button class="btn btn-ghost btn-sm btn-icon" data-opt-remove="${i}">${icon('x', 15)}</button>
      </div>`;

    const editor = editing ? card('wand', editing.id ? 'Edit menu' : 'New role menu',
      'Members keep the roles they pick until they toggle them off', `
      <div class="grid grid-2">
        <div>
          ${fieldRow('Title', `<input type="text" id="m-title" value="${esc(editing.title ?? '')}" placeholder="Pick your roles">`)}
          ${fieldRow('Description', `<textarea id="m-description" rows="2" placeholder="Optional text under the title">${esc(editing.description ?? '')}</textarea>`)}
          ${fieldRow('Channel', `<select id="m-channel">${channelOptions(editing.channel_id, { none: 'Pick a channel…' })}</select>`)}
        </div>
        <div>
          ${fieldRow('Style', `<select id="m-style">
            ${[['buttons', 'Buttons'], ['select', 'Dropdown'], ['reactions', 'Reactions']]
              .map(([v, l]) => `<option value="${v}" ${editing.style === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>`, 'Reactions need an emoji on every option.')}
          ${fieldRow('Selection rules', `<select id="m-mode">
            ${[['multi', 'Members can hold several'], ['unique', 'Only one role from this menu'],
               ['add-only', 'Add only — never removes'], ['verify', 'Verification button']]
              .map(([v, l]) => `<option value="${v}" ${editing.mode === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>`)}
          ${fieldRow('Embed colour', `<input type="color" id="m-color" value="${esc(editing.color ?? '#5b6bff')}">`)}
        </div>
      </div>
      <label class="label" style="margin-top:8px">Roles in this menu</label>
      <div id="opt-rows">${(editing.options ?? []).map(optionRow).join('')}</div>
      <button class="btn btn-sm" id="opt-add" style="margin-top:8px">${icon('plus', 15)} Add a role</button>
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn btn-ghost" id="m-cancel">Cancel</button>
        <button class="btn btn-primary" id="m-save">${icon('save', 15)} Save & publish</button>
      </div>`) : '';

    return `
      ${editor}
      ${card('tag', 'Your menus', `${menus.length} menu${menus.length === 1 ? '' : 's'}`, list,
        `<button class="btn btn-primary btn-sm" id="menu-new">${icon('plus', 15)} New menu</button>`)}`;
  },

  mount(root, rerender) {
    const page = this;
    root.querySelector('#menu-new')?.addEventListener('click', () => {
      page._editing = { title: 'Pick your roles', style: 'buttons', mode: 'multi',
        color: '#5b6bff', options: [{ roleId: '', label: '', emoji: '', description: '' }] };
      rerender();
    });

    root.querySelectorAll('[data-menu-edit]').forEach((b) => b.addEventListener('click', () => {
      page._editing = page._menus.find((m) => String(m.id) === b.dataset.menuEdit);
      rerender();
    }));

    root.querySelectorAll('[data-menu-publish]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await api(`/rolemenus/${b.dataset.menuPublish}/publish`, { method: 'POST', body: {} });
        toast(res.ok ? 'Menu posted to Discord' : res.error, res.ok ? 'ok' : 'err');
        rerender();
      } catch (e) { toast(e.message, 'err'); }
    }));

    root.querySelectorAll('[data-menu-delete]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('Delete this menu?', 'The posted message stays in Discord — delete it there if you want it gone.',
        async () => {
          await api(`/rolemenus/${b.dataset.menuDelete}`, { method: 'DELETE' });
          toast('Menu deleted', 'ok');
          page._editing = null;
          rerender();
        });
    }));

    // --- editor ---
    const readOptions = () => [...root.querySelectorAll('[data-opt-row]')].map((row) => ({
      roleId: row.querySelector('[data-opt="roleId"]').value,
      label: row.querySelector('[data-opt="label"]').value,
      emoji: row.querySelector('[data-opt="emoji"]').value,
      description: row.querySelector('[data-opt="description"]').value,
    })).filter((o) => o.roleId);

    root.querySelector('#opt-add')?.addEventListener('click', () => {
      page._editing = { ...page._editing, ...collectEditor(root), options: [...readOptions(), { roleId: '', label: '' }] };
      rerender();
    });

    root.querySelectorAll('[data-opt-remove]').forEach((b) => b.addEventListener('click', () => {
      const opts = readOptions();
      opts.splice(Number(b.dataset.optRemove), 1);
      page._editing = { ...page._editing, ...collectEditor(root), options: opts };
      rerender();
    }));

    root.querySelector('#m-cancel')?.addEventListener('click', () => { page._editing = null; rerender(); });

    root.querySelector('#m-save')?.addEventListener('click', async () => {
      const body = { ...collectEditor(root), options: readOptions(), publish: true };
      if (page._editing.id) body.id = page._editing.id;
      if (!body.channelId) return toast('Pick a channel for the menu', 'err');
      if (!body.options.length) return toast('Add at least one role', 'err');
      if (body.style === 'reactions' && body.options.some((o) => !o.emoji)) {
        return toast('Reaction menus need an emoji on every role', 'err');
      }
      try {
        const res = await api('/rolemenus', { method: 'POST', body });
        toast(res.published?.ok === false ? res.published.error : 'Menu saved and posted',
          res.published?.ok === false ? 'err' : 'ok');
        page._editing = null;
        rerender();
      } catch (e) { toast(e.message, 'err'); }
    });

    function collectEditor(r) {
      return {
        title: r.querySelector('#m-title')?.value,
        description: r.querySelector('#m-description')?.value,
        channelId: r.querySelector('#m-channel')?.value,
        style: r.querySelector('#m-style')?.value,
        mode: r.querySelector('#m-mode')?.value,
        color: r.querySelector('#m-color')?.value,
      };
    }
  },
};

// =========================================================================
export const commands = {
  title: 'Custom commands',
  subtitle: 'Your own prefix commands with embeds, role actions and restrictions. Unlimited.',
  module: 'commands',
  _editing: null,

  async render() {
    const { commands: list } = await api('/commands');
    this._list = list;
    const prefix = S.settings.prefix ?? '!';
    const e = this._editing;

    const editor = e ? card('terminal', e.id ? `Editing ${prefix}${e.name}` : 'New command', '', `
      <div class="grid grid-2">
        <div>
          ${fieldRow('Command name', `<div class="row"><span class="code-chip">${esc(prefix)}</span>
            <input type="text" id="c-name" class="grow" value="${esc(e.name ?? '')}" placeholder="rules">
            </div>`, 'Lowercase letters, numbers and dashes.')}
          ${fieldRow('Aliases', `<input type="text" id="c-aliases" value="${esc((e.aliases ?? []).join(', '))}" placeholder="info, help">`)}
          ${fieldRow('Response', `<textarea id="c-response" rows="4" placeholder="Welcome {user:mention}! Read the rules in #rules.">${esc(e.response ?? '')}</textarea>`,
            PLACEHOLDER_HELP + '<br>Also: <span class="code-chip">{args}</span> <span class="code-chip">{touser}</span> <span class="code-chip">{random:100}</span>')}
        </div>
        <div>
          ${fieldRow('Cooldown', `<input type="number" id="c-cooldown" value="${e.restrictions?.cooldown ?? 3}" min="0">`, 'Seconds per member.')}
          ${fieldRow('Only usable in', `<select id="c-channels" multiple size="4">${
            S.meta.channels.map((c) => `<option value="${c.id}" ${(e.restrictions?.channels ?? []).includes(c.id) ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')
          }</select>`, 'Leave empty for every channel. Ctrl-click to pick several.')}
          ${fieldRow('Only usable by', `<select id="c-roles" multiple size="4">${
            S.meta.roles.map((r) => `<option value="${r.id}" ${(e.restrictions?.roles ?? []).includes(r.id) ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')
          }</select>`)}
          <div class="row">
            <label class="toggle"><input type="checkbox" id="c-delete" ${e.actions?.deleteTrigger ? 'checked' : ''}>
              <span class="track"></span><span class="txt">Delete the trigger</span></label>
            <label class="toggle"><input type="checkbox" id="c-dm" ${e.actions?.dm ? 'checked' : ''}>
              <span class="track"></span><span class="txt">Reply in DM</span></label>
          </div>
          ${fieldRow('Give these roles', `<select id="c-addroles" multiple size="3">${
            S.meta.roles.filter((r) => r.assignable && !r.managed)
              .map((r) => `<option value="${r.id}" ${(e.actions?.addRoles ?? []).includes(r.id) ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')
          }</select>`)}
        </div>
      </div>
      <div class="row" style="margin-top:14px;justify-content:flex-end">
        <button class="btn btn-ghost" id="c-cancel">Cancel</button>
        <button class="btn btn-primary" id="c-save">${icon('save', 15)} Save command</button>
      </div>`) : '';

    return `
      ${editor}
      ${card('terminal', 'Commands', `${list.length} command${list.length === 1 ? '' : 's'}`,
        list.length ? list.map((c) => `
          <div class="list-item">
            <span class="code-chip">${esc(prefix)}${esc(c.name)}</span>
            <div class="meta"><strong style="font-weight:500;color:var(--text-dim)">${esc((c.response ?? '').slice(0, 70) || '(embed only)')}</strong>
              <span>used ${c.uses}×${c.aliases.length ? ` · aliases: ${esc(c.aliases.join(', '))}` : ''}</span></div>
            <button class="btn btn-ghost btn-sm" data-cmd-edit="${esc(c.name)}">Edit</button>
            <button class="btn btn-ghost btn-sm btn-icon" data-cmd-delete="${esc(c.name)}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('terminal', 'No custom commands yet', 'Create shortcuts for rules, socials, FAQs — anything.'),
        `<button class="btn btn-primary btn-sm" id="cmd-new">${icon('plus', 15)} New command</button>`)}

      ${card('sliders', 'Command behaviour', 'Applies to every custom command', `
        ${textField('prefix', 'Prefix', { hint: 'The character your custom commands start with.' })}
        ${numberField('commands.cooldownSeconds', 'Default cooldown', { suffix: 'seconds', min: 0 })}
        ${toggleField('commands.deleteTrigger', 'Always delete the message that triggered a command')}`)}`;
  },

  mount(root, rerender) {
    const page = this;
    bindFields(root);

    root.querySelector('#cmd-new')?.addEventListener('click', () => {
      page._editing = { name: '', response: '', aliases: [], restrictions: {}, actions: {} };
      rerender();
    });
    root.querySelectorAll('[data-cmd-edit]').forEach((b) => b.addEventListener('click', () => {
      page._editing = page._list.find((c) => c.name === b.dataset.cmdEdit);
      rerender();
    }));
    root.querySelectorAll('[data-cmd-delete]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog(`Delete ${b.dataset.cmdDelete}?`, 'The command stops working immediately.', async () => {
        await api(`/commands/${encodeURIComponent(b.dataset.cmdDelete)}`, { method: 'DELETE' });
        toast('Command deleted', 'ok');
        page._editing = null;
        rerender();
      });
    }));
    root.querySelector('#c-cancel')?.addEventListener('click', () => { page._editing = null; rerender(); });

    root.querySelector('#c-save')?.addEventListener('click', async () => {
      const picked = (id) => [...root.querySelector(id).selectedOptions].map((o) => o.value);
      const body = {
        name: root.querySelector('#c-name').value.trim(),
        response: root.querySelector('#c-response').value,
        aliases: root.querySelector('#c-aliases').value.split(',').map((s) => s.trim()).filter(Boolean),
        restrictions: {
          cooldown: num(root.querySelector('#c-cooldown').value, 3),
          channels: picked('#c-channels'),
          roles: picked('#c-roles'),
        },
        actions: {
          deleteTrigger: root.querySelector('#c-delete').checked,
          dm: root.querySelector('#c-dm').checked,
          addRoles: picked('#c-addroles'),
        },
      };
      if (!body.name) return toast('Give the command a name', 'err');
      if (!body.response) return toast('Give the command a response', 'err');
      try {
        await api('/commands', { method: 'POST', body });
        toast('Command saved', 'ok');
        page._editing = null;
        rerender();
      } catch (err) { toast(err.message, 'err'); }
    });
  },
};

// =========================================================================
export const timers = {
  title: 'Timers',
  subtitle: 'Recurring messages on a schedule. A MEE6 Premium feature — free here.',
  module: 'timers',
  async render() {
    const { timers: list } = await api('/timers');
    return `
      ${card('clock', 'Scheduled messages', `${list.length} timer${list.length === 1 ? '' : 's'}`,
        list.length ? list.map((t) => `
          <div class="list-item">
            <div class="card-icon" style="width:32px;height:32px">${icon('clock', 16)}</div>
            <div class="meta"><strong>${esc(t.name || 'Timer')} — every ${formatDuration(t.interval_sec)}</strong>
              <span>${esc(channelName(t.channel_id))} · ${esc((t.message ?? '').slice(0, 60))}</span></div>
            <span class="pill ${t.enabled ? 'on' : 'off'}">${t.enabled ? 'running' : 'paused'}</span>
            <button class="btn btn-ghost btn-sm" data-timer-run="${t.id}">${icon('play', 14)} Run now</button>
            <button class="btn btn-ghost btn-sm" data-timer-toggle="${t.id}" data-enabled="${t.enabled}">
              ${t.enabled ? 'Pause' : 'Resume'}</button>
            <button class="btn btn-ghost btn-sm btn-icon" data-timer-delete="${t.id}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('clock', 'No timers yet', 'Post rules, promos or reminders on a loop.'),
        `<button class="btn btn-primary btn-sm" id="timer-new">${icon('plus', 15)} New timer</button>`)}`;
  },
  mount(root, rerender) {
    root.querySelector('#timer-new')?.addEventListener('click', () => {
      modal({
        title: 'New timer',
        subtitle: 'meelarp will post this message on a loop.',
        body: `
          ${fieldRow('Name', '<input type="text" data-name="name" placeholder="Rules reminder">')}
          ${fieldRow('Channel', `<select data-name="channelId">${channelOptions(null, { none: 'Pick a channel…' })}</select>`)}
          ${fieldRow('Every', '<input type="text" data-name="interval" placeholder="6h, 30m, 1d">', 'Minimum 1 minute.')}
          ${fieldRow('Message', '<textarea data-name="message" rows="4"></textarea>', PLACEHOLDER_HELP)}
          <label class="toggle"><input type="checkbox" data-name="deletePrevious"><span class="track"></span>
            <span class="txt">Delete the previous post each time</span></label>`,
        confirmLabel: 'Create timer',
        async onConfirm(v) {
          const intervalSec = parseDuration(v.interval);
          if (!v.channelId) { toast('Pick a channel', 'err'); return false; }
          if (!intervalSec || intervalSec < 60) { toast('Interval must be at least 1 minute', 'err'); return false; }
          if (!v.message.trim()) { toast('Write a message', 'err'); return false; }
          await api('/timers', { method: 'POST', body: {
            name: v.name, channelId: v.channelId, intervalSec, message: v.message,
            deletePrevious: v.deletePrevious } });
          toast('Timer created', 'ok');
          rerender();
        },
      });
    });

    root.querySelectorAll('[data-timer-run]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/timers/${b.dataset.timerRun}/run`, { method: 'POST', body: {} });
        toast('Posted now', 'ok'); } catch (e) { toast(e.message, 'err'); }
    }));
    root.querySelectorAll('[data-timer-toggle]').forEach((b) => b.addEventListener('click', async () => {
      await api('/timers', { method: 'POST', body: { id: Number(b.dataset.timerToggle), enabled: b.dataset.enabled !== '1' } });
      rerender();
    }));
    root.querySelectorAll('[data-timer-delete]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('Delete this timer?', 'It stops posting immediately.', async () => {
        await api(`/timers/${b.dataset.timerDelete}`, { method: 'DELETE' });
        toast('Timer deleted', 'ok');
        rerender();
      });
    }));
  },
};

// =========================================================================
const FEED_TYPES = [
  ['youtube', 'YouTube', 'Channel URL, @handle or channel ID'],
  ['twitch', 'Twitch', 'Channel name — needs Twitch API keys in .env'],
  ['reddit', 'Reddit', 'Subreddit name, e.g. discordapp'],
  ['rss', 'RSS', 'Any feed URL'],
];

export const feeds = {
  title: 'Feeds',
  subtitle: 'Announce new videos, streams and posts. Unlimited sources — MEE6 caps this.',
  module: 'feeds',
  async render() {
    const { feeds: list } = await api('/feeds');
    return `
      ${card('broadcast', 'Followed sources', `${list.length} feed${list.length === 1 ? '' : 's'}`,
        list.length ? list.map((f) => `
          <div class="list-item">
            <span class="pill">${esc(f.type)}</span>
            <div class="meta"><strong>${esc(f.display_name ?? f.source)}</strong>
              <span>posts to ${esc(channelName(f.channel_id))}</span></div>
            <span class="pill ${f.enabled ? 'on' : 'off'}">${f.enabled ? 'active' : 'paused'}</span>
            <button class="btn btn-ghost btn-sm" data-feed-test="${f.id}">${icon('play', 14)} Test</button>
            <button class="btn btn-ghost btn-sm btn-icon" data-feed-delete="${f.id}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('broadcast', 'No feeds yet', 'Follow a YouTube channel, Twitch streamer, subreddit or RSS feed.'),
        `<button class="btn btn-primary btn-sm" id="feed-new">${icon('plus', 15)} Add a feed</button>`)}

      ${card('info', 'How it works', '', `
        <p style="color:var(--text-dim);margin:0">meelarp checks every source about once every five minutes.
        The first check only records the latest item, so you will see announcements from the next new post onward.
        Twitch needs <span class="code-chip">TWITCH_CLIENT_ID</span> and
        <span class="code-chip">TWITCH_CLIENT_SECRET</span> in your <span class="code-chip">.env</span>.</p>`)}`;
  },
  mount(root, rerender) {
    root.querySelector('#feed-new')?.addEventListener('click', () => {
      modal({
        title: 'Add a feed',
        subtitle: 'meelarp posts an announcement whenever something new appears.',
        body: `
          ${fieldRow('Source type', `<select data-name="type">${FEED_TYPES.map(([v, l, h]) =>
            `<option value="${v}" data-hint="${esc(h)}">${l}</option>`).join('')}</select>`)}
          ${fieldRow('Source', '<input type="text" data-name="source" placeholder="https://youtube.com/@someone">',
            'YouTube: URL or @handle · Twitch: channel name · Reddit: subreddit · RSS: feed URL')}
          ${fieldRow('Announce in', `<select data-name="channelId">${channelOptions(null, { none: 'Pick a channel…' })}</select>`)}
          ${fieldRow('Announcement text', '<textarea data-name="template" rows="2" placeholder="Leave empty for the default"></textarea>',
            'Available: <span class="code-chip">{name}</span> <span class="code-chip">{title}</span> <span class="code-chip">{url}</span> <span class="code-chip">{author}</span>')}`,
        confirmLabel: 'Add feed',
        async onConfirm(v) {
          if (!v.source?.trim()) { toast('Enter a source', 'err'); return false; }
          if (!v.channelId) { toast('Pick a channel', 'err'); return false; }
          await api('/feeds', { method: 'POST', body: {
            type: v.type, source: v.source.trim(), channelId: v.channelId,
            template: v.template?.trim() || undefined } });
          toast('Feed added', 'ok');
          rerender();
        },
      });
    });

    root.querySelectorAll('[data-feed-test]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/feeds/${b.dataset.feedTest}/test`, { method: 'POST', body: {} });
        toast('Posted the latest item', 'ok'); } catch (e) { toast(e.message, 'err'); }
    }));
    root.querySelectorAll('[data-feed-delete]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('Stop following this source?', 'No more announcements from it.', async () => {
        await api(`/feeds/${b.dataset.feedDelete}`, { method: 'DELETE' });
        toast('Feed removed', 'ok');
        rerender();
      });
    }));
  },
};

// =========================================================================
export const giveaways = {
  title: 'Giveaways',
  subtitle: 'Button entry, entry requirements, automatic draws and rerolls.',
  module: 'giveaways',
  async render() {
    const { giveaways: list } = await api('/giveaways');
    return `
      ${card('gift', 'Giveaways', `${list.filter((g) => !g.ended).length} running`,
        list.length ? list.map((g) => `
          <div class="list-item">
            <div class="card-icon" style="width:32px;height:32px">${icon('gift', 16)}</div>
            <div class="meta"><strong>${esc(g.prize)}</strong>
              <span>${g.winner_count} winner${g.winner_count === 1 ? '' : 's'} · ${g.entries} entries ·
                ${esc(channelName(g.channel_id))} ·
                ${g.ended ? 'ended' : `ends ${new Date(g.ends_at).toLocaleString()}`}</span></div>
            <span class="pill ${g.ended ? 'off' : 'on'}">${g.ended ? 'ended' : 'live'}</span>
            ${g.ended
              ? `<button class="btn btn-ghost btn-sm" data-gw-reroll="${g.id}">${icon('refresh', 14)} Reroll</button>`
              : `<button class="btn btn-ghost btn-sm" data-gw-end="${g.id}">End now</button>`}
            <button class="btn btn-ghost btn-sm btn-icon" data-gw-delete="${g.id}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('gift', 'No giveaways yet', 'Start one and members enter with a button.'),
        `<button class="btn btn-primary btn-sm" id="gw-new">${icon('plus', 15)} Start a giveaway</button>`)}`;
  },
  mount(root, rerender) {
    root.querySelector('#gw-new')?.addEventListener('click', () => {
      modal({
        title: 'Start a giveaway',
        subtitle: 'Entries are collected with a button on the giveaway message.',
        body: `
          ${fieldRow('Prize', '<input type="text" data-name="prize" placeholder="Discord Nitro">')}
          <div class="row">
            <div class="grow">${fieldRow('Channel', `<select data-name="channelId">${channelOptions(null, { none: 'Pick a channel…' })}</select>`)}</div>
            <div style="max-width:120px">${fieldRow('Winners', '<input type="number" data-name="winners" value="1" min="1">')}</div>
            <div style="max-width:150px">${fieldRow('Duration', '<input type="text" data-name="duration" placeholder="24h">')}</div>
          </div>
          <label class="label">Entry requirements (optional)</label>
          <div class="row">
            <div class="grow">${fieldRow('Required role', `<select data-name="reqRole">${roleOptions(null, { none: 'Anyone can enter' })}</select>`)}</div>
            <div style="max-width:130px">${fieldRow('Min level', '<input type="number" data-name="reqLevel" min="0" placeholder="0">')}</div>
            <div style="max-width:150px">${fieldRow('Account age', '<input type="number" data-name="reqAge" min="0" placeholder="days">')}</div>
          </div>`,
        confirmLabel: 'Launch',
        async onConfirm(v) {
          const durationSec = parseDuration(v.duration);
          if (!v.prize?.trim()) { toast('What is the prize?', 'err'); return false; }
          if (!v.channelId) { toast('Pick a channel', 'err'); return false; }
          if (!durationSec || durationSec < 60) { toast('Duration must be at least 1 minute', 'err'); return false; }
          const requirements = {};
          if (v.reqRole) requirements.roles = [v.reqRole];
          if (num(v.reqLevel)) requirements.level = num(v.reqLevel);
          if (num(v.reqAge)) requirements.accountAgeDays = num(v.reqAge);
          const res = await api('/giveaways', { method: 'POST', body: {
            prize: v.prize, channelId: v.channelId, winners: num(v.winners, 1), durationSec, requirements } });
          if (!res.ok) { toast(res.error, 'err'); return false; }
          toast('Giveaway started', 'ok');
          rerender();
        },
      });
    });

    const finish = (id, reroll) => async () => {
      try {
        const res = await api(`/giveaways/${id}/end`, { method: 'POST', body: { reroll } });
        toast(res.winners?.length ? `Winners drawn: ${res.winners.length}` : 'No valid entries', 'ok');
        rerender();
      } catch (e) { toast(e.message, 'err'); }
    };
    root.querySelectorAll('[data-gw-end]').forEach((b) => b.addEventListener('click', finish(b.dataset.gwEnd, false)));
    root.querySelectorAll('[data-gw-reroll]').forEach((b) => b.addEventListener('click', finish(b.dataset.gwReroll, true)));
    root.querySelectorAll('[data-gw-delete]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('Delete this giveaway?', 'Entries are deleted too.', async () => {
        await api(`/giveaways/${b.dataset.gwDelete}`, { method: 'DELETE' });
        toast('Giveaway deleted', 'ok');
        rerender();
      });
    }));
  },
};

// =========================================================================
export const tickets = {
  title: 'Tickets',
  subtitle: 'A support panel that opens private channels, with claiming and transcripts.',
  module: 'tickets',
  async render() {
    const { tickets: list } = await api('/tickets');
    const open = list.filter((t) => !t.closed);
    return `
      ${card('ticket', 'Ticket settings', 'Where tickets live and who can see them', `
        ${channelField('tickets.categoryId', 'Category for new tickets', { category: true, none: 'No category' })}
        ${listField('tickets.supportRoles', 'Support roles', 'role', { hint: 'These roles can see, claim and close every ticket.' })}
        ${channelField('tickets.transcriptChannel', 'Transcript archive', { none: 'Do not archive' })}
        ${textField('tickets.openMessage', 'First message inside a new ticket', { textarea: true, rows: 2 })}
        <div class="grid grid-2">
          ${numberField('tickets.limitPerUser', 'Open tickets per member', { min: 1 })}
          ${textField('tickets.nameTemplate', 'Channel name', { hint: 'Use {number} and {user}.' })}
        </div>`)}

      ${card('send', 'Ticket panel', 'Post the button members press to open a ticket', `
        <div class="grid grid-2">
          ${fieldRow('Channel', `<select id="tp-channel">${channelOptions(null, { none: 'Pick a channel…' })}</select>`)}
          ${fieldRow('Button label', '<input type="text" id="tp-button" value="Open a ticket">')}
        </div>
        ${fieldRow('Panel title', '<input type="text" id="tp-title" value="Need help?">')}
        ${fieldRow('Panel text', '<textarea id="tp-desc" rows="2">Press the button below to open a private ticket with the staff team.</textarea>')}
        <button class="btn btn-primary btn-sm" id="tp-post">${icon('send', 15)} Post the panel</button>`)}

      ${card('list', 'Open tickets', `${open.length} open`, open.length
        ? open.map((t) => `
          <div class="list-item">
            <span class="code-chip">#${String(t.number).padStart(4, '0')}</span>
            <div class="meta"><strong>${esc(channelName(t.channel_id))}</strong>
              <span>opened by ${t.user_id} · ${timeAgo(t.created_at)}${t.claimed_by ? ' · claimed' : ''}</span></div>
          </div>`).join('')
        : emptyState('ticket', 'No open tickets', 'Tickets opened from the panel show up here.'))}`;
  },
  mount(root, rerender) {
    bindFields(root);
    root.querySelector('#tp-post')?.addEventListener('click', async () => {
      const channelId = root.querySelector('#tp-channel').value;
      if (!channelId) return toast('Pick a channel', 'err');
      try {
        await api('/tickets/panel', { method: 'POST', body: {
          channelId,
          title: root.querySelector('#tp-title').value,
          description: root.querySelector('#tp-desc').value,
          buttonLabel: root.querySelector('#tp-button').value,
        } });
        toast('Panel posted', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  },
};

// =========================================================================
const LOG_EVENTS = [
  ['messageDelete', 'Message deleted'], ['messageEdit', 'Message edited'],
  ['messageBulkDelete', 'Bulk deletes'], ['memberJoin', 'Member joined'],
  ['memberLeave', 'Member left'], ['memberUpdate', 'Roles & nicknames'],
  ['memberBanned', 'Member banned'], ['memberUnbanned', 'Member unbanned'],
  ['roleCreate', 'Role created'], ['roleDelete', 'Role deleted'], ['roleUpdate', 'Role updated'],
  ['channelCreate', 'Channel created'], ['channelDelete', 'Channel deleted'], ['channelUpdate', 'Channel updated'],
  ['voiceJoin', 'Voice joined'], ['voiceLeave', 'Voice left'], ['voiceMove', 'Voice moved'],
  ['inviteCreate', 'Invite created'], ['threadCreate', 'Thread created'],
];

export const logs = {
  title: 'Server logs',
  subtitle: 'A written record of what happens in your server.',
  module: 'logs',
  async render() {
    return `
      ${card('list', 'Log destination', '', `
        ${channelField('logs.channelId', 'Default log channel')}
        ${listField('logs.ignoredChannels', 'Ignored channels', 'channel',
          { hint: 'Message events in these channels are never logged.' })}`)}

      ${card('sliders', 'Events', 'Pick exactly what gets recorded', `
        <div class="grid grid-2">
          ${LOG_EVENTS.map(([key, label]) => `
            <label class="toggle" style="padding:8px 0">
              <input type="checkbox" data-path="logs.events.${key}" data-type="bool"
                ${S.settings.logs.events[key] ? 'checked' : ''}>
              <span class="track"></span><span class="txt">${label}</span></label>`).join('')}
        </div>`)}`;
  },
  mount(root) { bindFields(root); },
};

// =========================================================================
export const counters = {
  title: 'Counters',
  subtitle: 'Voice channels that rename themselves with live server stats.',
  module: 'counters',
  async render() {
    const items = S.settings.counters.items ?? [];
    const types = S.catalog?.counterTypes ?? [];
    return `
      ${card('gauge', 'Stat channels', `${items.length} counter${items.length === 1 ? '' : 's'}`,
        items.length ? items.map((it, i) => `
          <div class="list-item">
            <div class="card-icon" style="width:32px;height:32px">${icon('gauge', 16)}</div>
            <div class="meta"><strong>${esc(channelName(it.channelId))}</strong>
              <span>${esc(types.find((t) => t.id === it.type)?.label ?? it.type)} · “${esc(it.template)}”</span></div>
            <button class="btn btn-ghost btn-sm btn-icon" data-counter-remove="${i}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('gauge', 'No counters yet', 'Create a voice channel, then point a counter at it.'), '')}

      ${card('plus', 'Add a counter', 'Discord limits renames, so meelarp updates every few minutes', `
        <div class="row">
          <select id="ct-channel" class="grow">${channelOptions(null, { none: 'Pick a voice channel…', voice: true })}</select>
          <select id="ct-type" style="max-width:200px">
            ${types.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="row" style="margin-top:10px">
          <input type="text" id="ct-template" class="grow" value="Members: {count}" placeholder="Members: {count}">
          <select id="ct-role" style="max-width:200px">${roleOptions(null, { none: 'Role (for role counters)' })}</select>
          <button class="btn btn-primary btn-sm" id="ct-add">${icon('plus', 15)} Add</button>
        </div>
        <div class="hint" style="margin-top:8px">Use <span class="code-chip">{count}</span> and
          <span class="code-chip">{server}</span> in the name template.</div>`)}`;
  },
  mount(root, rerender) {
    root.querySelector('#ct-add')?.addEventListener('click', () => {
      const channelId = root.querySelector('#ct-channel').value;
      if (!channelId) return toast('Pick a voice channel', 'err');
      const item = {
        channelId,
        type: root.querySelector('#ct-type').value,
        template: root.querySelector('#ct-template').value || '{type}: {count}',
        roleId: root.querySelector('#ct-role').value || undefined,
      };
      S.settings.counters.items = [...(S.settings.counters.items ?? []), item];
      S.settings.modules.counters = true;
      markDirty();
      rerender();
    });
    root.querySelectorAll('[data-counter-remove]').forEach((b) => b.addEventListener('click', () => {
      S.settings.counters.items.splice(Number(b.dataset.counterRemove), 1);
      markDirty();
      rerender();
    }));
  },
};

// =========================================================================
export const music = {
  title: 'Music',
  subtitle: 'Voice playback with queues and loop modes — MEE6 Premium, free here.',
  module: 'music',
  async render() {
    const caps = S.catalog?.music ?? {};
    const row = (label, on, note) => `
      <div class="list-item">
        <div class="card-icon" style="width:30px;height:30px;background:${on ? 'rgba(39,224,164,.14)' : 'rgba(255,92,122,.12)'};
          color:${on ? 'var(--mint)' : 'var(--rose)'}">${icon(on ? 'check' : 'x', 15)}</div>
        <div class="meta"><strong>${esc(label)}</strong><span>${esc(note)}</span></div>
      </div>`;
    return `
      ${card('music', 'Player settings', '', `
        ${listField('music.djRoles', 'DJ roles', 'role',
          { hint: 'Leave empty to let everyone control playback.' })}
        <div class="grid grid-2">
          ${numberField('music.defaultVolume', 'Default volume', { suffix: '%', min: 0, max: 200 })}
          ${numberField('music.maxQueue', 'Maximum queue length', { min: 10 })}
        </div>
        ${numberField('music.leaveOnEmptySeconds', 'Leave after the queue empties', { suffix: 'seconds', min: 0 })}`)}

      ${card('info', 'Playback requirements', 'Music streams through tools on the machine hosting meelarp', `
        ${row('Voice library', caps.voice, '@discordjs/voice — installed with meelarp')}
        ${row('Search', caps.search, 'youtube-sr — installed with meelarp')}
        ${row('yt-dlp', caps.ytdlp, caps.ytdlp ? 'Found on PATH' : 'Required for playback — install yt-dlp and restart')}
        ${row('ffmpeg', caps.ffmpeg, caps.ffmpeg ? 'Found on PATH' : 'Optional — enables live volume control')}`)}`;
  },
  mount(root) { bindFields(root); },
};

// =========================================================================
export const starboard = {
  title: 'Starboard',
  subtitle: 'Reposts the messages your server reacts to most.',
  module: 'starboard',
  async render() {
    return card('star', 'Starboard', 'Messages that pass the threshold get pinned to a channel', `
      ${channelField('starboard.channelId', 'Starboard channel')}
      <div class="grid grid-2">
        ${numberField('starboard.threshold', 'Reactions needed', { min: 1 })}
        ${textField('starboard.emoji', 'Emoji', { placeholder: '⭐' })}
      </div>
      ${toggleField('starboard.selfStar', 'Count the author\'s own reaction')}
      ${listField('starboard.ignoredChannels', 'Ignored channels', 'channel')}`);
  },
  mount(root) { bindFields(root); },
};

// =========================================================================
export const settings = {
  title: 'Server settings',
  subtitle: 'Prefix, command restrictions and the things you cannot undo.',
  async render() {
    const perms = S.settings.permissions ?? {};
    const names = Object.keys(perms);
    return `
      ${card('sliders', 'General', '', `
        ${textField('prefix', 'Custom command prefix')}
        <div class="row" style="margin-top:6px">
          <a class="btn btn-sm" href="/leaderboard/${S.guildId}" target="_blank" rel="noopener">
            ${icon('external', 15)} Public leaderboard</a>
          <a class="btn btn-sm" href="/invite" target="_blank" rel="noopener">${icon('bot', 15)} Invite link</a>
        </div>`)}

      ${card('lock', 'Command restrictions', 'Limit a slash command to certain roles or channels', `
        ${names.length ? names.map((name) => `
          <div class="list-item">
            <span class="code-chip">/${esc(name)}</span>
            <div class="meta"><span>${(perms[name].roles ?? []).map(roleName).join(', ') || 'any role'}
              · ${(perms[name].channels ?? []).map(channelName).join(', ') || 'any channel'}</span></div>
            <button class="btn btn-ghost btn-sm btn-icon" data-perm-remove="${esc(name)}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('lock', 'No restrictions', 'Every command follows Discord\'s own permission settings.')}
        <div class="row" style="margin-top:12px">
          <input type="text" id="perm-name" placeholder="command name, e.g. rank" style="max-width:200px">
          <select id="perm-role" class="grow">${roleOptions(null, { none: 'Restrict to role (optional)' })}</select>
          <select id="perm-channel" class="grow">${channelOptions(null, { none: 'Restrict to channel (optional)' })}</select>
          <button class="btn btn-primary btn-sm" id="perm-add">${icon('plus', 15)} Add</button>
        </div>`)}

      ${card('alert', 'Danger zone', 'These cannot be undone', `
        <div class="row">
          <button class="btn btn-danger btn-sm" id="danger-xp">Reset all XP</button>
          <button class="btn btn-danger btn-sm" id="danger-settings">Restore default settings</button>
        </div>`)}`;
  },
  mount(root, rerender) {
    bindFields(root);
    root.querySelector('#perm-add')?.addEventListener('click', () => {
      const name = root.querySelector('#perm-name').value.trim().replace(/^\//, '');
      if (!name) return toast('Which command?', 'err');
      const role = root.querySelector('#perm-role').value;
      const channel = root.querySelector('#perm-channel').value;
      S.settings.permissions = { ...(S.settings.permissions ?? {}), [name]: {
        roles: role ? [role] : [], channels: channel ? [channel] : [], denyChannels: [] } };
      markDirty();
      rerender();
    });
    root.querySelectorAll('[data-perm-remove]').forEach((b) => b.addEventListener('click', () => {
      delete S.settings.permissions[b.dataset.permRemove];
      markDirty();
      rerender();
    }));
    root.querySelector('#danger-xp')?.addEventListener('click', () => {
      confirmDialog('Reset all XP?', 'Every member loses their level and rank.', async () => {
        await api('/levels', { method: 'POST', body: { action: 'resetAll' } });
        toast('Leaderboard reset', 'ok');
      }, 'Reset XP');
    });
    root.querySelector('#danger-settings')?.addEventListener('click', () => {
      confirmDialog('Restore defaults?', 'Every module setting returns to its default value. '
        + 'Commands, menus, feeds and timers are kept.', async () => {
        S.settings = structuredClone(S.defaults);
        await api('/settings', { method: 'PUT', body: S.settings });
        toast('Settings restored', 'ok');
        location.reload();
      }, 'Restore defaults');
    });
  },
};

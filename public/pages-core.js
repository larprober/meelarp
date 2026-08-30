// meelarp — dashboard pages: overview, levels, moderation, automod, welcome
import { icon, MODULE_ICONS } from '/icons.js';
import { S, api, esc, card, toast, modal, confirmDialog, toggleField, textField, numberField,
  selectField, colorField, channelField, roleField, listField, emptyState, getPath, setPath,
  markDirty, bindFields, roleOptions, channelOptions, roleName, channelName, timeAgo,
  formatDuration, PLACEHOLDER_HELP, num } from '/ui.js';

const MODULE_LABELS = {
  levels: ['Leveling', 'XP, rank cards and role rewards'],
  moderation: ['Moderation', 'Cases, warnings and mod log'],
  automod: ['Automod', 'Filters that act before you have to'],
  welcome: ['Welcome', 'Greetings, autorole, sticky roles'],
  roles: ['Role menus', 'Self-assignable roles'],
  commands: ['Custom commands', 'Your own prefix commands'],
  timers: ['Timers', 'Recurring scheduled messages'],
  feeds: ['Feeds', 'YouTube, Twitch, Reddit, RSS'],
  giveaways: ['Giveaways', 'Entry requirements and rerolls'],
  tickets: ['Tickets', 'Private support channels'],
  logs: ['Server logs', 'Message, member and channel events'],
  counters: ['Counters', 'Auto-updating stat channels'],
  music: ['Music', 'Voice channel playback'],
  starboard: ['Starboard', 'Highlight the best messages'],
};

// =========================================================================
export const overview = {
  title: 'Overview',
  subtitle: 'Server activity and the modules you have switched on.',
  async render() {
    const data = await api('/overview');
    this._data = data;
    const max = Math.max(1, ...data.stats.map((s) => s.messages));
    const chart = data.stats.length
      ? `<div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:6px">
          ${data.stats.map((s) => `
            <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;align-items:center"
                 title="${s.day}: ${s.messages} messages, ${s.joins} joins">
              <div style="width:100%;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,var(--brand),rgba(91,107,255,.35));
                          height:${Math.max(3, (s.messages / max) * 100)}%"></div>
              <span style="font-size:10px;color:var(--text-faint)">${s.day.slice(5)}</span>
            </div>`).join('')}
        </div>`
      : emptyState('levels', 'No activity recorded yet', 'Stats appear once members start chatting.');

    return `
      <div class="grid grid-4" style="margin-bottom:18px">
        <div class="stat"><div class="label">Members</div><div class="value">${(data.guild?.memberCount ?? 0).toLocaleString()}</div></div>
        <div class="stat"><div class="label">Ranked</div><div class="value brand">${data.counts.ranked.toLocaleString()}</div></div>
        <div class="stat"><div class="label">Mod cases</div><div class="value">${data.counts.cases}</div></div>
        <div class="stat"><div class="label">Open tickets</div><div class="value mint">${data.counts.tickets}</div></div>
      </div>

      ${card('levels', 'Messages per day', 'Last 14 days', chart)}

      ${card('sliders', 'Modules', 'Switch entire feature sets on or off', `
        <div class="grid grid-2">
          ${Object.entries(MODULE_LABELS).map(([key, [name, desc]]) => `
            <div class="module-row ${S.settings.modules[key] ? 'on' : ''}">
              <div class="ico">${icon(MODULE_ICONS[key] ?? 'sparkle', 18)}</div>
              <div class="meta"><strong>${name}</strong><span>${desc}</span></div>
              <label class="toggle">
                <input type="checkbox" data-path="modules.${key}" data-type="bool" ${S.settings.modules[key] ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>`).join('')}
        </div>`)}

      ${card('list', 'Recent dashboard changes', 'Who changed what', data.audit.length
        ? data.audit.map((a) => `
          <div class="list-item">
            <div class="card-icon" style="width:30px;height:30px">${icon('wand', 15)}</div>
            <div class="meta"><strong>${esc(a.action)}</strong><span>${esc(a.detail || '—')}</span></div>
            <span class="pill">${esc(a.user_tag ?? 'system')} · ${timeAgo(a.created_at)}</span>
          </div>`).join('')
        : emptyState('list', 'Nothing yet', 'Changes you make here will be listed.'))}`;
  },
  mount(root, rerenderNav) {
    bindFields(root, () => rerenderNav?.());
  },
};

// =========================================================================
export const levels = {
  title: 'Leveling',
  subtitle: 'XP rates, level-up announcements, role rewards and the rank card design.',
  module: 'levels',
  async render() {
    const L = S.settings.levels;
    const board = await api('/levels').catch(() => ({ rows: [], total: 0 }));
    this._board = board;

    const rewardRows = (L.roleRewards ?? []).slice().sort((a, b) => a.level - b.level);
    const multiplierRows = L.multipliers ?? [];

    return `
      ${card('levels', 'XP settings', 'How members earn experience', `
        <div class="grid grid-2">
          <div>
            <div class="field">
              <label>XP per message</label>
              <div class="row">
                <input type="number" data-path="levels.xpPerMessage.0" data-type="number" style="max-width:90px" value="${L.xpPerMessage[0]}">
                <span style="color:var(--text-faint)">to</span>
                <input type="number" data-path="levels.xpPerMessage.1" data-type="number" style="max-width:90px" value="${L.xpPerMessage[1]}">
              </div>
              <div class="hint">MEE6 gives 15–25 XP per message. A random amount in this range is awarded.</div>
            </div>
            ${numberField('levels.cooldownSeconds', 'Cooldown between XP gains', { suffix: 'seconds', min: 0 })}
          </div>
          <div>
            ${selectField('levels.curve', 'Level curve', [
              { value: 'mee6', label: 'MEE6 compatible (5n² + 50n + 100)' },
              { value: 'linear', label: 'Linear — steady climb' },
              { value: 'fast', label: 'Fast — quicker early levels' },
              { value: 'slow', label: 'Slow — long grind' },
            ], { hint: 'Changing the curve re-derives levels from existing XP.' })}
            ${toggleField('levels.leaderboardPublic', 'Public web leaderboard',
              `Anyone with the link can view <span class="code-chip">/leaderboard/${S.guildId}</span>`)}
            ${toggleField('levels.resetOnLeave', 'Reset XP when a member leaves')}
          </div>
        </div>`)}

      ${card('sparkle', 'Level-up announcements', 'What happens when someone levels up', `
        ${selectField('levels.announce', 'Where to announce', [
          { value: 'channel', label: 'A specific channel' },
          { value: 'current', label: 'The channel they were chatting in' },
          { value: 'dm', label: 'Direct message' },
          { value: 'none', label: 'Do not announce' },
        ])}
        ${channelField('levels.announceChannel', 'Announcement channel', { none: 'Use the current channel' })}
        ${textField('levels.announceMessage', 'Message', { textarea: true, rows: 2 })}
        <div class="hint" style="margin:-8px 0 14px">${PLACEHOLDER_HELP}</div>
        ${toggleField('levels.announceOnlyOnReward', 'Only announce when a role reward is earned')}
        <div class="dc-preview" style="margin-top:10px">
          <div class="dc-msg">
            <div class="dc-avatar">m</div>
            <div>
              <div class="dc-name">meelarp <span class="dc-bot">bot</span></div>
              <div class="dc-body" id="levelup-preview"></div>
            </div>
          </div>
        </div>`)}

      ${card('tag', 'Role rewards', 'Roles granted automatically at a level', `
        ${toggleField('levels.stackRoles', 'Keep every role earned',
          'Turn this off to swap the previous reward for the new one.')}
        ${rewardRows.length ? `<table style="margin-top:6px"><thead><tr>
            <th style="width:90px">Level</th><th>Role</th><th style="width:60px"></th></tr></thead><tbody>
          ${rewardRows.map((r) => `<tr>
            <td><span class="pill on">lvl ${r.level}</span></td>
            <td>${esc(roleName(r.roleId))}</td>
            <td><button class="btn btn-ghost btn-sm btn-icon" data-reward-remove="${r.level}">${icon('trash', 15)}</button></td>
          </tr>`).join('')}</tbody></table>`
          : emptyState('tag', 'No role rewards yet', 'Give members something to climb towards.')}
        <div class="row" style="margin-top:14px">
          <input type="number" id="reward-level" placeholder="Level" min="1" style="max-width:110px">
          <select id="reward-role" class="grow">${roleOptions(null, { none: 'Pick a role…', assignableOnly: true })}</select>
          <button class="btn btn-primary btn-sm" id="reward-add">${icon('plus', 15)} Add reward</button>
        </div>`)}

      ${card('gauge', 'XP multipliers', 'Boost or slow XP in specific roles and channels', `
        ${multiplierRows.length ? multiplierRows.map((m, i) => `
          <div class="list-item">
            <div class="card-icon" style="width:30px;height:30px">${icon(m.type === 'role' ? 'tag' : 'hash', 15)}</div>
            <div class="meta"><strong>${esc(m.type === 'role' ? roleName(m.id) : channelName(m.id))}</strong>
              <span>${m.type}</span></div>
            <span class="pill ${m.factor >= 1 ? 'on' : 'warn'}">×${m.factor}</span>
            <button class="btn btn-ghost btn-sm btn-icon" data-multiplier-remove="${i}">${icon('trash', 15)}</button>
          </div>`).join('')
          : emptyState('gauge', 'No multipliers', 'Every channel and role currently earns the same XP.')}
        <div class="row" style="margin-top:12px">
          <select id="mult-type" style="max-width:120px">
            <option value="role">Role</option><option value="channel">Channel</option>
          </select>
          <select id="mult-target" class="grow">${roleOptions(null, { none: 'Pick a role…' })}</select>
          <input type="number" id="mult-factor" value="2" step="0.1" min="0" style="max-width:90px">
          <button class="btn btn-primary btn-sm" id="mult-add">${icon('plus', 15)} Add</button>
        </div>`)}

      ${card('filter', 'No-XP zones', 'Where XP is not earned', `
        <div class="grid grid-2">
          ${listField('levels.noXpChannels', 'Ignored channels', 'channel')}
          ${listField('levels.noXpRoles', 'Ignored roles', 'role')}
        </div>`)}

      ${card('music', 'Voice XP', 'Reward members for time spent in voice', `
        ${toggleField('levels.voiceXp.enabled', 'Award XP for voice activity')}
        ${numberField('levels.voiceXp.perMinute', 'XP per minute in voice', { min: 0 })}`)}

      ${card('wand', 'Rank card', 'MEE6 charges for this. Restyle it freely.', `
        <div class="grid grid-2">
          <div>
            ${colorField('levels.card.accent', 'Accent colour')}
            ${textField('levels.card.background', 'Background image URL', { placeholder: 'https://… (leave empty for the generated backdrop)' })}
            ${selectField('levels.card.barStyle', 'Progress bar style', [
              { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' },
              { value: 'segmented', label: 'Segmented' }])}
            ${numberField('levels.card.opacity', 'Background dim', { min: 0, max: 1, step: 0.05,
              suffix: '0 = bright image, 1 = solid dark' })}
          </div>
          <div>
            <label class="label">Preview</label>
            <div id="card-preview"></div>
            <div class="hint">Run <span class="code-chip">/rank</span> in Discord to see the real render.</div>
          </div>
        </div>`)}

      ${card('users', 'Leaderboard', `${board.total?.toLocaleString() ?? 0} ranked members`, `
        ${board.rows?.length ? `<table><thead><tr><th style="width:50px">#</th><th>Member</th>
          <th style="width:80px">Level</th><th style="width:110px">XP</th><th style="width:150px"></th></tr></thead><tbody>
          ${board.rows.slice(0, 25).map((r) => `<tr>
            <td><div class="rank-badge ${r.rank <= 3 ? 'g' + r.rank : ''}">${r.rank}</div></td>
            <td>${esc(r.username ?? r.user_id)}</td>
            <td><span class="pill on">lvl ${r.level}</span></td>
            <td class="mono">${r.xp.toLocaleString()}</td>
            <td style="text-align:right">
              <button class="btn btn-ghost btn-sm" data-xp-edit="${r.user_id}" data-xp="${r.xp}">Edit XP</button>
              <button class="btn btn-ghost btn-sm btn-icon" data-xp-reset="${r.user_id}">${icon('trash', 15)}</button>
            </td></tr>`).join('')}</tbody></table>`
          : emptyState('users', 'Nobody has earned XP yet', 'The leaderboard fills up as members chat.')}
        <div class="row" style="margin-top:14px;justify-content:flex-end">
          <button class="btn btn-danger btn-sm" id="reset-all-xp">${icon('alert', 15)} Reset entire leaderboard</button>
        </div>`)}`;
  },

  mount(root, rerender) {
    const preview = () => {
      const L = S.settings.levels;
      const msg = (L.announceMessage ?? '')
        .replace(/\{user:mention\}/g, '<span class="dc-mention">@you</span>')
        .replace(/\{user:name\}/g, 'you')
        .replace(/\{level\}/g, '7')
        .replace(/\{server:name\}/g, esc(S.meta.name))
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      const el = root.querySelector('#levelup-preview');
      if (el) el.innerHTML = msg;

      const card = L.card;
      const box = root.querySelector('#card-preview');
      if (box) {
        box.innerHTML = `
          <div style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);
            background:${card.background ? `url('${esc(card.background)}') center/cover` : 'linear-gradient(135deg,#121527,#0b0d18)'}">
            <div style="position:absolute;inset:0;background:rgba(8,10,18,${card.background ? card.opacity : 0.2})"></div>
            <div style="position:relative;display:flex;gap:14px;align-items:center;padding:18px">
              <div style="width:64px;height:64px;border-radius:50%;flex-shrink:0;
                background:conic-gradient(${esc(card.accent)} 62%, rgba(255,255,255,.12) 0);
                display:grid;place-items:center">
                <div style="width:52px;height:52px;border-radius:50%;background:#20263f;display:grid;place-items:center;
                  color:#fff;font-weight:800">m</div>
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
                  <strong style="color:${esc(card.textColor ?? '#fff')};font-size:16px">member</strong>
                  <span style="font-size:11.5px;color:#9aa1b8;white-space:nowrap">RANK <strong style="color:#fff">#4</strong>
                    &nbsp;LVL <strong style="color:${esc(card.accent)}">12</strong></span>
                </div>
                <div style="height:16px;margin-top:10px;border-radius:${card.barStyle === 'square' ? '3px' : '999px'};
                  background:rgba(255,255,255,.09);overflow:hidden">
                  <div style="height:100%;width:62%;border-radius:inherit;
                    background:${card.barStyle === 'segmented'
                      ? `repeating-linear-gradient(90deg, ${esc(card.accent)} 0 12px, transparent 12px 16px)`
                      : `linear-gradient(90deg, ${esc(card.accent)}, #27e0a4)`}"></div>
                </div>
                <div style="font-size:11.5px;color:#9aa1b8;margin-top:6px">1,240 / 2,000 XP</div>
              </div>
            </div>
          </div>`;
      }
    };

    bindFields(root, preview);
    preview();

    root.querySelector('#reward-add')?.addEventListener('click', () => {
      const level = num(root.querySelector('#reward-level').value);
      const roleId = root.querySelector('#reward-role').value;
      if (!level || !roleId) return toast('Pick a level and a role', 'err');
      const list = (S.settings.levels.roleRewards ?? []).filter((r) => r.level !== level);
      S.settings.levels.roleRewards = [...list, { level, roleId }];
      markDirty();
      rerender();
    });

    root.querySelectorAll('[data-reward-remove]').forEach((btn) => btn.addEventListener('click', () => {
      S.settings.levels.roleRewards = S.settings.levels.roleRewards
        .filter((r) => String(r.level) !== btn.dataset.rewardRemove);
      markDirty();
      rerender();
    }));

    const multType = root.querySelector('#mult-type');
    multType?.addEventListener('change', () => {
      root.querySelector('#mult-target').innerHTML = multType.value === 'role'
        ? roleOptions(null, { none: 'Pick a role…' })
        : channelOptions(null, { none: 'Pick a channel…' });
    });
    root.querySelector('#mult-add')?.addEventListener('click', () => {
      const id = root.querySelector('#mult-target').value;
      const factor = Number(root.querySelector('#mult-factor').value);
      if (!id || !factor) return toast('Pick a target and a factor', 'err');
      S.settings.levels.multipliers = [...(S.settings.levels.multipliers ?? []),
        { type: multType.value, id, factor }];
      markDirty();
      rerender();
    });
    root.querySelectorAll('[data-multiplier-remove]').forEach((btn) => btn.addEventListener('click', () => {
      S.settings.levels.multipliers.splice(Number(btn.dataset.multiplierRemove), 1);
      markDirty();
      rerender();
    }));

    root.querySelectorAll('[data-xp-edit]').forEach((btn) => btn.addEventListener('click', () => {
      modal({
        title: 'Set XP',
        subtitle: 'Total XP for this member. Their level is recalculated automatically.',
        body: `<div class="field"><label>Total XP</label>
          <input type="number" data-name="xp" value="${btn.dataset.xp}"></div>`,
        async onConfirm(values) {
          await api('/levels', { method: 'POST', body: { userId: btn.dataset.xpEdit, xp: Number(values.xp) } });
          toast('XP updated', 'ok');
          rerender();
        },
      });
    }));

    root.querySelectorAll('[data-xp-reset]').forEach((btn) => btn.addEventListener('click', () => {
      confirmDialog('Reset this member?', 'Their XP and level go back to zero.', async () => {
        await api('/levels', { method: 'POST', body: { userId: btn.dataset.xpReset, action: 'reset' } });
        toast('Member reset', 'ok');
        rerender();
      });
    }));

    root.querySelector('#reset-all-xp')?.addEventListener('click', () => {
      confirmDialog('Reset the whole leaderboard?',
        'Every member loses their XP and levels. This cannot be undone.', async () => {
          await api('/levels', { method: 'POST', body: { action: 'resetAll' } });
          toast('Leaderboard reset', 'ok');
          rerender();
        }, 'Reset everything');
    });
  },
};

// =========================================================================
export const moderation = {
  title: 'Moderation',
  subtitle: 'Where actions are logged, who is protected, and what happens as warnings pile up.',
  module: 'moderation',
  async render() {
    const { cases, total } = await api('/cases?limit=25').catch(() => ({ cases: [], total: 0 }));
    const thresholds = S.settings.moderation.warnThresholds ?? [];
    const TYPE_PILL = { ban: 'bad', kick: 'bad', warn: 'warn', timeout: 'warn', mute: 'warn' };

    return `
      ${card('shield', 'Logging & notices', 'How moderation actions are recorded', `
        ${channelField('moderation.modLogChannel', 'Moderation log channel',
          { hint: 'Every ban, kick, warn and automod hit lands here as a numbered case.' })}
        ${toggleField('moderation.dmOnAction', 'Tell the member why they were actioned')}
        ${roleField('moderation.muteRoleId', 'Mute role',
          { none: 'Use Discord timeouts (recommended)', hint: 'Only needed if you prefer a classic mute role over native timeouts.' })}
        ${listField('moderation.protectedRoles', 'Protected roles', 'role',
          { hint: 'Members with these roles cannot be actioned through meelarp.' })}`)}

      ${card('alert', 'Warning escalation', 'Automatic punishment once warnings add up', `
        ${thresholds.length ? `<table><thead><tr><th style="width:110px">Warnings</th><th>Action</th>
          <th style="width:120px">Duration</th><th style="width:60px"></th></tr></thead><tbody>
          ${thresholds.map((t, i) => `<tr>
            <td><span class="pill warn">${t.warns}</span></td>
            <td>${esc(t.action)}</td>
            <td>${t.duration ? formatDuration(t.duration) : '—'}</td>
            <td><button class="btn btn-ghost btn-sm btn-icon" data-threshold-remove="${i}">${icon('trash', 15)}</button></td>
          </tr>`).join('')}</tbody></table>`
          : emptyState('alert', 'No escalation configured', 'Warnings are recorded but nothing happens automatically.')}
        <div class="row" style="margin-top:14px">
          <input type="number" id="th-warns" placeholder="Warnings" min="1" style="max-width:110px">
          <select id="th-action" style="max-width:140px">
            <option value="timeout">Timeout</option><option value="mute">Mute</option>
            <option value="kick">Kick</option><option value="ban">Ban</option>
          </select>
          <input type="text" id="th-duration" placeholder="1h, 7d (optional)" style="max-width:170px">
          <button class="btn btn-primary btn-sm" id="th-add">${icon('plus', 15)} Add step</button>
        </div>`)}

      ${card('list', 'Case log', `${total} recorded case${total === 1 ? '' : 's'}`, `
        ${cases.length ? `<table><thead><tr><th style="width:70px">Case</th><th style="width:100px">Type</th>
          <th>Member</th><th>Reason</th><th style="width:110px">When</th><th style="width:50px"></th></tr></thead><tbody>
          ${cases.map((c) => `<tr>
            <td class="mono">#${c.case_no}</td>
            <td><span class="pill ${TYPE_PILL[c.type] ?? ''}">${esc(c.type)}</span></td>
            <td>${esc(c.user_tag ?? c.user_id)}</td>
            <td style="color:var(--text-dim)">${esc((c.reason ?? '—').slice(0, 70))}</td>
            <td style="color:var(--text-faint);font-size:12.5px">${timeAgo(c.created_at)}</td>
            <td><button class="btn btn-ghost btn-sm btn-icon" data-case-delete="${c.case_no}">${icon('trash', 15)}</button></td>
          </tr>`).join('')}</tbody></table>`
          : emptyState('shield', 'No cases yet', 'Moderation actions taken through meelarp appear here.')}`)}`;
  },
  mount(root, rerender) {
    bindFields(root);
    root.querySelector('#th-add')?.addEventListener('click', () => {
      const warns = num(root.querySelector('#th-warns').value);
      if (!warns) return toast('How many warnings?', 'err');
      const durationRaw = root.querySelector('#th-duration').value;
      const seconds = durationRaw ? (parseInt(durationRaw, 10) && /^\d+$/.test(durationRaw)
        ? Number(durationRaw)
        : ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[durationRaw.slice(-1)] ?? 60) * parseFloat(durationRaw)) : null;
      S.settings.moderation.warnThresholds = [
        ...(S.settings.moderation.warnThresholds ?? []).filter((t) => t.warns !== warns),
        { warns, action: root.querySelector('#th-action').value, duration: seconds || null },
      ].sort((a, b) => a.warns - b.warns);
      markDirty();
      rerender();
    });
    root.querySelectorAll('[data-threshold-remove]').forEach((btn) => btn.addEventListener('click', () => {
      S.settings.moderation.warnThresholds.splice(Number(btn.dataset.thresholdRemove), 1);
      markDirty();
      rerender();
    }));
    root.querySelectorAll('[data-case-delete]').forEach((btn) => btn.addEventListener('click', () => {
      confirmDialog(`Delete case #${btn.dataset.caseDelete}?`, 'The record is removed permanently.', async () => {
        await api(`/cases/${btn.dataset.caseDelete}`, { method: 'DELETE' });
        toast('Case deleted', 'ok');
        rerender();
      });
    }));
  },
};

// =========================================================================
const RULE_META = {
  invites:    ['link', 'Discord invites', 'Removes invite links to other servers.'],
  links:      ['external', 'Links', 'Allow-list or block-list of domains.'],
  spam:       ['alert', 'Message spam', 'Too many messages in a short window.'],
  duplicates: ['copy', 'Repeated messages', 'The same message posted over and over.'],
  mentions:   ['users', 'Mass mentions', 'Pinging many people at once.'],
  caps:       ['alert', 'Excessive caps', 'Shouty messages above a caps percentage.'],
  words:      ['filter', 'Word filter', 'Your own blocked words plus optional presets.'],
  emoji:      ['sparkle', 'Emoji spam', 'Walls of emoji.'],
  zalgo:      ['alert', 'Zalgo text', 'Combining characters that break layout.'],
  attachments:['copy', 'Attachment floods', 'Too many files in one message.'],
  newlines:   ['list', 'Newline spam', 'Messages stretched over many lines.'],
};

const ACTIONS = [
  { value: 'delete', label: 'Delete the message' },
  { value: 'warn', label: 'Delete + warn' },
  { value: 'timeout', label: 'Delete + timeout' },
  { value: 'kick', label: 'Delete + kick' },
  { value: 'ban', label: 'Delete + ban' },
];

export const automod = {
  title: 'Automod',
  subtitle: 'Filters that act before a moderator has to. Each rule has its own punishment.',
  module: 'automod',
  async render() {
    const A = S.settings.automod;
    const ruleCard = (key) => {
      const [ic, name, desc] = RULE_META[key];
      const r = A.rules[key];
      const extra = {
        spam: `<div class="row">
            ${numberField(`automod.rules.spam.messages`, 'Messages', { min: 2 })}
            ${numberField(`automod.rules.spam.seconds`, 'Within seconds', { min: 1 })}
            ${numberField(`automod.rules.spam.duration`, 'Timeout length', { suffix: 'sec', min: 30 })}
          </div>`,
        duplicates: numberField('automod.rules.duplicates.count', 'Repeats allowed', { min: 2 }),
        mentions: `<div class="row">${numberField('automod.rules.mentions.limit', 'Mention limit', { min: 2 })}
          ${numberField('automod.rules.mentions.duration', 'Timeout length', { suffix: 'sec', min: 30 })}</div>`,
        caps: `<div class="row">${numberField('automod.rules.caps.percent', 'Caps %', { min: 30, max: 100 })}
          ${numberField('automod.rules.caps.minLength', 'Minimum length', { min: 5 })}</div>`,
        emoji: numberField('automod.rules.emoji.limit', 'Emoji limit', { min: 2 }),
        attachments: numberField('automod.rules.attachments.limit', 'Attachment limit', { min: 2 }),
        newlines: numberField('automod.rules.newlines.limit', 'Line limit', { min: 3 }),
        invites: textField('automod.rules.invites.whitelist', 'Allowed invite codes',
          { placeholder: 'comma separated', hint: 'Invite codes that stay allowed.' }),
        links: `${selectField('automod.rules.links.mode', 'Mode', [
            { value: 'blacklist', label: 'Block these domains' },
            { value: 'whitelist', label: 'Allow only these domains' }])}
          ${textField('automod.rules.links.list', 'Domains', { placeholder: 'example.com, spam.link' })}`,
        words: `${textField('automod.rules.words.list', 'Blocked words', { textarea: true, rows: 3,
            placeholder: 'one per line or comma separated' })}
          <div class="field"><label>Built-in lists</label><div class="row">
            ${(S.catalog?.automodPresets ?? []).map((p) => `
              <label class="toggle"><input type="checkbox" data-preset="${p}"
                ${(A.rules.words.presets ?? []).includes(p) ? 'checked' : ''}>
                <span class="track"></span><span class="txt">${esc(p)}</span></label>`).join('')}
          </div></div>
          ${toggleField('automod.rules.words.wildcard', 'Match inside longer words',
            'Catches l3et-speak and spacing tricks, but can create false positives.')}`,
      }[key] ?? '';

      return `
        <div class="card" style="margin-bottom:12px;${r.enabled ? '' : 'opacity:.72'}">
          <div class="card-head" style="margin-bottom:${r.enabled ? '16px' : '0'}">
            <div class="card-icon">${icon(ic, 18)}</div>
            <div><h3>${name}</h3><p>${desc}</p></div>
            <span class="spacer"></span>
            <label class="toggle"><input type="checkbox" data-path="automod.rules.${key}.enabled"
              data-type="bool" data-rerender="1" ${r.enabled ? 'checked' : ''}>
              <span class="track"></span></label>
          </div>
          ${r.enabled ? `<div class="grid grid-2">
            <div>${selectField(`automod.rules.${key}.action`, 'When it triggers', ACTIONS)}</div>
            <div>${extra}</div>
          </div>` : ''}
        </div>`;
    };

    return `
      ${card('filter', 'Scope', 'Who and where automod ignores', `
        <div class="grid grid-2">
          ${listField('automod.exemptRoles', 'Exempt roles', 'role',
            { hint: 'Members with Manage Server are always exempt.' })}
          ${listField('automod.exemptChannels', 'Exempt channels', 'channel')}
        </div>
        ${channelField('automod.logChannel', 'Automod log channel', { none: 'Use the moderation log' })}`)}

      ${card('wand', 'Filter tester', 'Check a message against your current rules', `
        <div class="row">
          <input type="text" id="automod-test" class="grow" placeholder="Type a message to test…">
          <button class="btn btn-sm" id="automod-run">${icon('play', 15)} Test</button>
        </div>
        <div id="automod-result" style="margin-top:12px"></div>`)}

      <h3 style="margin:26px 0 14px;font-size:16px">Rules</h3>
      ${Object.keys(RULE_META).map(ruleCard).join('')}

      ${card('alert', 'Escalation ladder', 'Repeat offenders get treated differently', `
        ${toggleField('automod.escalation.enabled', 'Escalate on repeated hits')}
        ${numberField('automod.escalation.window', 'Strike memory window', { suffix: 'seconds', min: 60 })}
        ${(A.escalation.steps ?? []).length ? `<table><thead><tr><th style="width:100px">Strikes</th>
          <th>Action</th><th style="width:120px">Duration</th><th style="width:50px"></th></tr></thead><tbody>
          ${A.escalation.steps.map((s, i) => `<tr>
            <td><span class="pill warn">${s.strikes}</span></td><td>${esc(s.action)}</td>
            <td>${s.duration ? formatDuration(s.duration) : '—'}</td>
            <td><button class="btn btn-ghost btn-sm btn-icon" data-step-remove="${i}">${icon('trash', 15)}</button></td>
          </tr>`).join('')}</tbody></table>` : ''}
        <div class="row" style="margin-top:12px">
          <input type="number" id="esc-strikes" placeholder="Strikes" min="2" style="max-width:110px">
          <select id="esc-action" style="max-width:150px">
            <option value="timeout">Timeout</option><option value="kick">Kick</option><option value="ban">Ban</option>
          </select>
          <input type="number" id="esc-duration" placeholder="Seconds" style="max-width:130px">
          <button class="btn btn-primary btn-sm" id="esc-add">${icon('plus', 15)} Add step</button>
        </div>`)}`;
  },

  mount(root, rerender) {
    // comma/newline lists stored as arrays
    const listPaths = ['automod.rules.words.list', 'automod.rules.links.list', 'automod.rules.invites.whitelist'];
    listPaths.forEach((p) => {
      const el = root.querySelector(`[data-path="${p}"]`);
      if (el) el.value = (getPath(S.settings, p) ?? []).join(', ');
    });

    bindFields(root, (path, value) => {
      if (listPaths.includes(path)) {
        setPath(S.settings, path, String(value).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean));
      }
    });

    root.querySelectorAll('[data-rerender]').forEach((el) => el.addEventListener('change', () => rerender()));

    root.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('change', () => {
      const set = new Set(S.settings.automod.rules.words.presets ?? []);
      el.checked ? set.add(el.dataset.preset) : set.delete(el.dataset.preset);
      S.settings.automod.rules.words.presets = [...set];
      markDirty();
    }));

    root.querySelector('#automod-run')?.addEventListener('click', async () => {
      const text = root.querySelector('#automod-test').value;
      const out = root.querySelector('#automod-result');
      try {
        const { hit } = await api('/automod/test', { method: 'POST',
          body: { text, rules: S.settings.automod.rules } });
        out.innerHTML = hit
          ? `<div class="list-item" style="border-color:rgba(255,176,32,.35)">
              <div class="card-icon" style="background:rgba(255,176,32,.14);color:var(--amber)">${icon('alert', 17)}</div>
              <div class="meta"><strong>Caught by “${esc(hit.rule)}”</strong><span>${esc(hit.reason)}</span></div>
              <span class="pill warn">${esc(hit.action)}</span></div>`
          : `<div class="list-item" style="border-color:rgba(39,224,164,.3)">
              <div class="card-icon" style="background:rgba(39,224,164,.14);color:var(--mint)">${icon('check', 17)}</div>
              <div class="meta"><strong>Passes every enabled filter</strong>
                <span>Save your changes first if you just edited a rule.</span></div></div>`;
      } catch (e) { toast(e.message, 'err'); }
    });

    root.querySelector('#esc-add')?.addEventListener('click', () => {
      const strikes = num(root.querySelector('#esc-strikes').value);
      if (!strikes) return toast('How many strikes?', 'err');
      S.settings.automod.escalation.steps = [
        ...(S.settings.automod.escalation.steps ?? []).filter((s) => s.strikes !== strikes),
        { strikes, action: root.querySelector('#esc-action').value,
          duration: num(root.querySelector('#esc-duration').value) || null },
      ].sort((a, b) => a.strikes - b.strikes);
      markDirty();
      rerender();
    });
    root.querySelectorAll('[data-step-remove]').forEach((btn) => btn.addEventListener('click', () => {
      S.settings.automod.escalation.steps.splice(Number(btn.dataset.stepRemove), 1);
      markDirty();
      rerender();
    }));
  },
};

// =========================================================================
export const welcome = {
  title: 'Welcome & goodbye',
  subtitle: 'Greet new members, say farewell, hand out roles automatically.',
  module: 'welcome',
  async render() {
    const W = S.settings.welcome;
    const previewBox = (id) => `
      <div class="dc-preview" style="margin-top:10px">
        <div class="dc-msg"><div class="dc-avatar">m</div>
          <div style="min-width:0"><div class="dc-name">meelarp <span class="dc-bot">bot</span></div>
            <div class="dc-body" id="${id}"></div></div></div>
      </div>`;

    return `
      ${card('welcome', 'Welcome message', 'Posted in a channel when someone joins', `
        ${toggleField('welcome.join.enabled', 'Send a welcome message')}
        ${channelField('welcome.join.channelId', 'Channel')}
        ${textField('welcome.join.message', 'Message', { textarea: true, rows: 3 })}
        <div class="hint" style="margin:-8px 0 14px">${PLACEHOLDER_HELP}</div>
        ${numberField('welcome.join.deleteAfter', 'Delete the message after', { suffix: 'seconds (0 = keep)', min: 0 })}
        ${previewBox('welcome-preview')}
        <div class="row" style="margin-top:14px">
          <button class="btn btn-sm" id="welcome-test">${icon('send', 15)} Send a test to the channel</button>
        </div>`)}

      ${card('wand', 'Welcome image', 'MEE6 Premium feature — included here', `
        ${toggleField('welcome.join.image.enabled', 'Attach a generated welcome banner')}
        <div class="grid grid-2">
          ${textField('welcome.join.image.background', 'Background image URL', { placeholder: 'https://…' })}
          ${colorField('welcome.join.image.accent', 'Accent colour')}
        </div>
        <div style="border-radius:14px;overflow:hidden;border:1px solid var(--line);margin-top:6px">
          <div id="banner-preview"></div>
        </div>`)}

      ${card('send', 'Welcome DM', 'A private message to the new member', `
        ${toggleField('welcome.dm.enabled', 'Send a direct message')}
        ${textField('welcome.dm.message', 'Message', { textarea: true, rows: 3 })}`)}

      ${card('logout', 'Goodbye message', 'When a member leaves', `
        ${toggleField('welcome.leave.enabled', 'Send a goodbye message')}
        ${channelField('welcome.leave.channelId', 'Channel')}
        ${textField('welcome.leave.message', 'Message', { textarea: true, rows: 2 })}
        ${previewBox('leave-preview')}`)}

      ${card('sparkle', 'Boost message', 'Thank members who boost the server', `
        ${toggleField('welcome.boost.enabled', 'Announce boosts')}
        ${channelField('welcome.boost.channelId', 'Channel')}
        ${textField('welcome.boost.message', 'Message', { textarea: true, rows: 2 })}`)}

      ${card('tag', 'Autorole & sticky roles', 'Roles handed out on join', `
        ${toggleField('welcome.autorole.enabled', 'Give roles automatically on join')}
        ${listField('welcome.autorole.roles', 'Roles for members', 'role')}
        ${listField('welcome.autorole.botRoles', 'Roles for bots', 'role')}
        ${numberField('welcome.autorole.delaySeconds', 'Wait before assigning', { suffix: 'seconds', min: 0,
          hint: 'A short delay helps with raid-protection tools that screen new joins.' })}
        ${toggleField('welcome.stickyRoles', 'Restore roles when a member rejoins',
          'meelarp remembers the roles someone had when they left.')}`)}`;
  },

  mount(root, rerender) {
    const render = () => {
      const fill = (id, text) => {
        const el = root.querySelector(`#${id}`);
        if (!el) return;
        el.innerHTML = (text ?? '')
          .replace(/\{user:mention\}/g, '<span class="dc-mention">@newmember</span>')
          .replace(/\{user:name\}/g, 'newmember')
          .replace(/\{user:tag\}/g, 'newmember')
          .replace(/\{server:name\}/g, esc(S.meta.name))
          .replace(/\{server:membercount\}/g, String(S.meta.memberCount ?? 0))
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      };
      fill('welcome-preview', S.settings.welcome.join.message);
      fill('leave-preview', S.settings.welcome.leave.message);

      const img = S.settings.welcome.join.image;
      const banner = root.querySelector('#banner-preview');
      if (banner) {
        banner.innerHTML = `
          <div style="position:relative;height:150px;display:grid;place-items:center;text-align:center;
            background:${img.background ? `url('${esc(img.background)}') center/cover`
              : `radial-gradient(circle at 50% -20%, ${esc(img.accent)}, #0b0d18 70%)`}">
            <div style="position:absolute;inset:0;background:rgba(8,10,18,.55)"></div>
            <div style="position:relative">
              <div style="width:54px;height:54px;border-radius:50%;margin:0 auto 8px;background:#20263f;
                border:3px solid ${esc(img.accent)};display:grid;place-items:center;color:#fff;font-weight:800">m</div>
              <div style="font-weight:800;font-size:19px;color:#fff">Welcome, newmember</div>
              <div style="font-size:12.5px;color:#9aa1b8">You are member #${(S.meta.memberCount ?? 0) + 1} of ${esc(S.meta.name)}</div>
            </div>
          </div>`;
      }
    };

    bindFields(root, render);
    render();

    root.querySelector('#welcome-test')?.addEventListener('click', async () => {
      try {
        await api('/welcome/test', { method: 'POST', body: {} });
        toast('Test welcome sent', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  },
};

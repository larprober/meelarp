// meelarp — dashboard shared state, API client and form component library
import { icon } from '/icons.js';

export const S = {
  guildId: location.pathname.split('/')[2],
  meta: null, settings: null, defaults: null, catalog: null,
  dirty: false, page: 'overview',
};

// --- helpers --------------------------------------------------------------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (node[k] === null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  node[last] = value;
}

export const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

const UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
export function parseDuration(input) {
  if (input == null) return null;
  const str = String(input).trim().toLowerCase();
  if (!str) return null;
  let total = 0, matched = false;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*([smhdw])/g)) {
    total += parseFloat(m[1]) * UNITS[m[2]];
    matched = true;
  }
  if (!matched && /^\d+$/.test(str)) return parseInt(str, 10);
  return matched ? Math.round(total) : null;
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  const parts = [];
  let rest = Math.floor(seconds);
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(rest / size);
    if (n) { parts.push(`${n}${label}`); rest -= n * size; }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

export const timeAgo = (ms) => {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// --- API ------------------------------------------------------------------
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/guild/${S.guildId}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-meelarp': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { location.href = '/login'; return {}; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- toasts ---------------------------------------------------------------
export function toast(message, kind = '') {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info', 17)}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(12px)'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

// --- dirty tracking -------------------------------------------------------
const dirtyListeners = new Set();
export const onDirtyChange = (fn) => dirtyListeners.add(fn);
export function markDirty(value = true) {
  S.dirty = value;
  for (const fn of dirtyListeners) fn(value);
}

export async function saveSettings() {
  await api('/settings', { method: 'PUT', body: S.settings });
  markDirty(false);
  toast('Settings saved', 'ok');
}

// --- modal ----------------------------------------------------------------
export function modal({ title, subtitle, body, confirmLabel = 'Save', danger = false, onConfirm, wide = false }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" ${wide ? 'style="width:min(760px,100%)"' : ''}>
        <h3>${esc(title)}</h3>
        ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
        <div id="modal-body">${body}</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>
        </div>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('.modal-backdrop').onclick = (e) => { if (e.target.classList.contains('modal-backdrop')) close(); };
  root.querySelector('[data-confirm]').onclick = async () => {
    const values = {};
    for (const el of root.querySelectorAll('[data-name]')) {
      values[el.dataset.name] = el.type === 'checkbox' ? el.checked
        : el.multiple ? [...el.selectedOptions].map((o) => o.value)
        : el.value;
    }
    try {
      const result = await onConfirm(values, root);
      if (result !== false) close();
    } catch (e) { toast(e.message, 'err'); }
  };
  return { close, root };
}

export function confirmDialog(title, message, onConfirm, confirmLabel = 'Delete') {
  return modal({ title, subtitle: message, body: '', confirmLabel, danger: true, onConfirm });
}

// --- form components ------------------------------------------------------
// Every component reads/writes S.settings through a dotted path and marks dirty.

export const toggleField = (path, label, hint) => `
  <div class="field">
    <label class="toggle">
      <input type="checkbox" data-path="${path}" data-type="bool" ${getPath(S.settings, path) ? 'checked' : ''}>
      <span class="track"></span><span class="txt">${esc(label)}</span>
    </label>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

export const textField = (path, label, { hint, placeholder = '', textarea = false, rows = 3 } = {}) => `
  <div class="field">
    <label>${esc(label)}</label>
    ${textarea
      ? `<textarea data-path="${path}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(getPath(S.settings, path) ?? '')}</textarea>`
      : `<input type="text" data-path="${path}" placeholder="${esc(placeholder)}" value="${esc(getPath(S.settings, path) ?? '')}">`}
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

export const numberField = (path, label, { hint, min, max, step = 1, suffix } = {}) => `
  <div class="field">
    <label>${esc(label)}</label>
    <div class="row">
      <input type="number" data-path="${path}" data-type="number" style="max-width:150px"
        ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}
        step="${step}" value="${getPath(S.settings, path) ?? 0}">
      ${suffix ? `<span style="color:var(--text-faint);font-size:13px">${esc(suffix)}</span>` : ''}
    </div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

export const selectField = (path, label, options, { hint } = {}) => {
  const value = getPath(S.settings, path);
  return `
  <div class="field">
    <label>${esc(label)}</label>
    <select data-path="${path}">
      ${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;
};

export const colorField = (path, label, { hint } = {}) => `
  <div class="field">
    <label>${esc(label)}</label>
    <div class="row">
      <input type="color" data-path="${path}" value="${esc(getPath(S.settings, path) ?? '#5b6bff')}">
      <input type="text" class="grow mono" data-path="${path}" style="max-width:130px"
        value="${esc(getPath(S.settings, path) ?? '#5b6bff')}">
    </div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

export const channelOptions = (selected, { none = 'No channel', voice = false, category = false } = {}) => {
  const list = category ? S.meta.categories : voice ? S.meta.voiceChannels : S.meta.channels;
  return `<option value="">${esc(none)}</option>` + list.map((c) =>
    `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${category || voice ? '' : '#'}${esc(c.name)}</option>`).join('');
};

export const roleOptions = (selected, { none = 'No role', assignableOnly = false } = {}) =>
  `<option value="">${esc(none)}</option>` + S.meta.roles
    .filter((r) => (!assignableOnly || (r.assignable && !r.managed)))
    .map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>@${esc(r.name)}</option>`).join('');

export const channelField = (path, label, { hint, none = 'No channel', voice = false, category = false } = {}) => `
  <div class="field">
    <label>${esc(label)}</label>
    <select data-path="${path}" data-empty="null">
      ${channelOptions(getPath(S.settings, path), { none, voice, category })}
    </select>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

export const roleField = (path, label, { hint, none = 'No role' } = {}) => `
  <div class="field">
    <label>${esc(label)}</label>
    <select data-path="${path}" data-empty="null">${roleOptions(getPath(S.settings, path), { none })}</select>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

/** Multi-select shown as removable tags plus an "add" dropdown. */
export function listField(path, label, kind, { hint } = {}) {
  const values = getPath(S.settings, path) ?? [];
  const lookup = kind === 'role'
    ? (id) => { const r = S.meta.roles.find((x) => x.id === id); return r ? `@${r.name}` : id; }
    : (id) => {
      const c = [...S.meta.channels, ...S.meta.voiceChannels, ...S.meta.categories].find((x) => x.id === id);
      return c ? `#${c.name}` : id;
    };
  const remaining = kind === 'role'
    ? S.meta.roles.filter((r) => !values.includes(r.id))
    : S.meta.channels.filter((c) => !values.includes(c.id));

  return `
  <div class="field">
    <label>${esc(label)}</label>
    <div class="tag-input">
      ${values.map((v) => `<span class="tag">${esc(lookup(v))}
        <button type="button" data-list-remove="${path}" data-value="${esc(v)}">${icon('x', 12)}</button></span>`).join('')}
      <select data-list-add="${path}">
        <option value="">+ add ${kind}…</option>
        ${remaining.map((r) => `<option value="${r.id}">${kind === 'role' ? '@' : '#'}${esc(r.name)}</option>`).join('')}
      </select>
    </div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;
}

export const card = (iconName, title, subtitle, body, headExtra = '') => `
  <section class="card">
    <div class="card-head">
      <div class="card-icon">${icon(iconName, 19)}</div>
      <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
      <span class="spacer"></span>${headExtra}
    </div>
    ${body}
  </section>`;

export const emptyState = (iconName, title, text, action = '') => `
  <div class="empty">${icon(iconName, 34)}<strong>${esc(title)}</strong>${esc(text)}
    ${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;

export const PLACEHOLDER_HELP = `Placeholders:
<span class="code-chip">{user:mention}</span> <span class="code-chip">{user:name}</span>
<span class="code-chip">{user:tag}</span> <span class="code-chip">{server:name}</span>
<span class="code-chip">{server:membercount}</span> <span class="code-chip">{level}</span>`;

/** Wire every data-path input inside a container to S.settings. */
export function bindFields(root, onChange) {
  root.querySelectorAll('[data-path]').forEach((el) => {
    const handler = () => {
      const path = el.dataset.path;
      let value;
      if (el.dataset.type === 'bool') value = el.checked;
      else if (el.dataset.type === 'number' || el.type === 'number') value = num(el.value);
      else value = el.value;
      if (value === '' && el.dataset.empty === 'null') value = null;
      setPath(S.settings, path, value);
      markDirty();
      // keep paired colour inputs in sync
      if (el.type === 'color' || (el.type === 'text' && /color|accent/i.test(el.dataset.path))) {
        root.querySelectorAll(`[data-path="${el.dataset.path}"]`).forEach((twin) => {
          if (twin !== el) twin.value = value;
        });
      }
      onChange?.(el.dataset.path, value);
    };
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color' ? 'change' : 'input', handler);
  });

  root.querySelectorAll('[data-list-add]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!el.value) return;
      const path = el.dataset.listAdd;
      const list = getPath(S.settings, path) ?? [];
      if (!list.includes(el.value)) setPath(S.settings, path, [...list, el.value]);
      markDirty();
      onChange?.(path, getPath(S.settings, path), true);
    });
  });

  root.querySelectorAll('[data-list-remove]').forEach((el) => {
    el.addEventListener('click', () => {
      const path = el.dataset.listRemove;
      const list = (getPath(S.settings, path) ?? []).filter((v) => v !== el.dataset.value);
      setPath(S.settings, path, list);
      markDirty();
      onChange?.(path, list, true);
    });
  });
}

export const channelName = (id) => {
  const c = [...(S.meta?.channels ?? []), ...(S.meta?.voiceChannels ?? []), ...(S.meta?.categories ?? [])]
    .find((x) => x.id === id);
  return c ? `#${c.name}` : 'unknown channel';
};
export const roleName = (id) => {
  const r = (S.meta?.roles ?? []).find((x) => x.id === id);
  return r ? `@${r.name}` : 'unknown role';
};

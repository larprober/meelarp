// meelarp — dashboard bootstrap, navigation and routing
import { icon, logoMark, MODULE_ICONS } from '/icons.js';
import { S, api, esc, toast, saveSettings, markDirty, onDirtyChange } from '/ui.js';
import { overview, levels, moderation, automod, welcome } from '/pages-core.js';
import { roles, commands, timers, feeds, giveaways, tickets, logs, counters, music,
  starboard, settings } from '/pages-more.js';

const PAGES = { overview, levels, moderation, automod, welcome, roles, commands, timers,
  feeds, giveaways, tickets, logs, counters, music, starboard, settings };

const NAV = [
  ['Server', [['overview', 'Overview', 'home'], ['settings', 'Settings', 'sliders']]],
  ['Engagement', [['levels', 'Leveling', 'levels'], ['roles', 'Role menus', 'tag'],
    ['commands', 'Custom commands', 'terminal'], ['giveaways', 'Giveaways', 'gift'],
    ['starboard', 'Starboard', 'star']]],
  ['Safety', [['moderation', 'Moderation', 'shield'], ['automod', 'Automod', 'filter'],
    ['logs', 'Server logs', 'list']]],
  ['Growth', [['welcome', 'Welcome', 'welcome'], ['feeds', 'Feeds', 'broadcast'],
    ['timers', 'Timers', 'clock'], ['counters', 'Counters', 'gauge']]],
  ['Extras', [['tickets', 'Tickets', 'ticket'], ['music', 'Music', 'music']]],
];

const mainEl = document.getElementById('main');
const navEl = document.getElementById('nav');

document.getElementById('logo').innerHTML = logoMark(30);
document.getElementById('logout').innerHTML = icon('logout', 16);

// --- boot -----------------------------------------------------------------
async function boot() {
  try {
    const [me, data] = await Promise.all([
      fetch('/api/me').then((r) => (r.status === 401 ? Promise.reject(new Error('unauthenticated')) : r.json())),
      api(''),
    ]);

    S.meta = data.meta;
    S.settings = data.settings;
    S.defaults = data.defaults;
    S.catalog = data.catalog;

    document.getElementById('user').innerHTML = `
      <span class="user-chip"><img src="${me.user.avatarUrl}" alt="">${esc(me.user.global_name ?? me.user.username)}</span>`;

    document.getElementById('guild-card').innerHTML = `
      <div class="side-guild">
        ${S.meta.icon
          ? `<img src="https://cdn.discordapp.com/icons/${S.meta.id}/${S.meta.icon}.png?size=96" alt="">`
          : `<div class="guild-avatar">${esc(S.meta.name.slice(0, 2).toUpperCase())}</div>`}
        <div class="meta">
          <div class="name">${esc(S.meta.name)}</div>
          <div class="sub">${S.meta.botPresent ? `${(S.meta.memberCount ?? 0).toLocaleString()} members` : 'meelarp not added'}</div>
        </div>
      </div>`;

    if (!S.meta.botPresent) {
      mainEl.innerHTML = `
        <div class="center-screen">
          ${icon('bot', 42)}
          <h2>meelarp is not in this server yet</h2>
          <p style="color:var(--text-dim);max-width:40ch">Add the bot, then reload this page to configure it.</p>
          <a class="btn btn-primary" href="/invite">Add meelarp to ${esc(S.meta.name)}</a>
        </div>`;
      return;
    }

    renderNav();
    window.addEventListener('hashchange', () => route());
    route();
  } catch (e) {
    if (e.message === 'unauthenticated') { location.href = '/login'; return; }
    mainEl.innerHTML = `<div class="center-screen">${icon('alert', 40)}
      <h2>Could not load this server</h2>
      <p style="color:var(--text-dim)">${esc(e.message)}</p>
      <a class="btn" href="/servers">Back to your servers</a></div>`;
  }
}

// --- navigation -----------------------------------------------------------
function renderNav() {
  navEl.innerHTML = NAV.map(([group, items]) => `
    <div class="nav-group-label">${group}</div>
    ${items.map(([key, label, ic]) => {
      const moduleKey = PAGES[key]?.module;
      const dot = moduleKey
        ? `<span class="dot ${S.settings.modules[moduleKey] ? '' : 'off'}"></span>` : '';
      return `<button class="nav-item ${S.page === key ? 'active' : ''}" data-page="${key}">
        ${icon(ic, 17)}<span>${label}</span>${dot}</button>`;
    }).join('')}`).join('');

  navEl.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.page;
  }));
}

// --- routing --------------------------------------------------------------
let rendering = false;

async function route() {
  const key = (location.hash.slice(1) || 'overview');
  S.page = PAGES[key] ? key : 'overview';
  await renderPage();
  renderNav();
}

async function renderPage() {
  if (rendering) return;
  rendering = true;
  const page = PAGES[S.page];

  mainEl.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;

  try {
    const body = await page.render();
    const moduleKey = page.module;
    const disabled = moduleKey && !S.settings.modules[moduleKey];

    mainEl.innerHTML = `
      <div class="page-head">
        <h1>${esc(page.title)}</h1>
        <p>${esc(page.subtitle ?? '')}</p>
      </div>
      ${disabled ? `
        <div class="list-item" style="border-color:rgba(255,176,32,.35);background:rgba(255,176,32,.06)">
          <div class="card-icon" style="background:rgba(255,176,32,.14);color:var(--amber)">${icon('alert', 17)}</div>
          <div class="meta"><strong>This module is switched off</strong>
            <span>Settings below are saved but nothing runs until you enable it.</span></div>
          <button class="btn btn-sm btn-primary" id="enable-module">Enable ${esc(moduleKey)}</button>
        </div>` : ''}
      ${body}
      <div class="sticky-save hidden" id="save-bar">
        ${icon('save', 17)}
        <span class="txt">You have unsaved changes.</span>
        <button class="btn btn-ghost btn-sm" id="discard-btn">Discard</button>
        <button class="btn btn-primary btn-sm" id="save-btn">Save changes</button>
      </div>`;

    document.getElementById('enable-module')?.addEventListener('click', async () => {
      S.settings.modules[moduleKey] = true;
      await saveSettings();
      route();
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      try { await saveSettings(); renderNav(); }
      catch (e) { toast(e.message, 'err'); }
    });
    document.getElementById('discard-btn').addEventListener('click', () => location.reload());

    rendering = false;
    page.mount?.(mainEl, () => { renderPage(); renderNav(); });
    updateSaveBar(S.dirty);
  } catch (e) {
    rendering = false;
    mainEl.innerHTML = `<div class="center-screen">${icon('alert', 40)}
      <h2>${esc(page.title)} failed to load</h2>
      <p style="color:var(--text-dim)">${esc(e.message)}</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}

function updateSaveBar(dirty) {
  document.getElementById('save-bar')?.classList.toggle('hidden', !dirty);
}
onDirtyChange(updateSaveBar);

window.addEventListener('beforeunload', (e) => {
  if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (S.dirty) saveSettings().then(renderNav).catch((err) => toast(err.message, 'err'));
  }
});

boot();

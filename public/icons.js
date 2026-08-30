// meelarp — hand-built SVG icon set (no emoji, no icon-font dependency)
const P = {
  // navigation / modules
  home:      '<path d="M4 11.2 12 4l8 7.2"/><path d="M6.5 10v9.5h11V10"/><path d="M10 20v-5h4v5"/>',
  levels:    '<path d="M4 20h16"/><rect x="5" y="12" width="3.6" height="6" rx="1.2"/><rect x="10.2" y="8" width="3.6" height="10" rx="1.2"/><rect x="15.4" y="4.5" width="3.6" height="13.5" rx="1.2"/>',
  shield:    '<path d="M12 3.3 5 6.2v5.1c0 4.3 2.9 7.9 7 9.4 4.1-1.5 7-5.1 7-9.4V6.2Z"/><path d="m9.2 12.2 2 2.1 3.6-4"/>',
  filter:    '<path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 2v-7.4Z"/>',
  welcome:   '<path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14"/><path d="M11 12h9"/><path d="m16.6 8.6 3.4 3.4-3.4 3.4"/>',
  tag:       '<path d="M4.5 11.8V5.4a.9.9 0 0 1 .9-.9h6.4l7.7 7.7a1.3 1.3 0 0 1 0 1.8l-4.6 4.6a1.3 1.3 0 0 1-1.8 0Z"/><circle cx="8.6" cy="8.6" r="1.5"/>',
  terminal:  '<rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><path d="m7.6 9.6 2.6 2.5-2.6 2.5"/><path d="M13 14.6h3.6"/>',
  clock:     '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3 1.8"/>',
  broadcast: '<circle cx="12" cy="12" r="2.2"/><path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8"/><path d="M15.9 15.9a5.5 5.5 0 0 0 0-7.8"/><path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2"/><path d="M18.6 18.6a9.3 9.3 0 0 0 0-13.2"/>',
  gift:      '<rect x="3.6" y="9.4" width="16.8" height="4" rx="1.2"/><path d="M5.2 13.4V19a1.4 1.4 0 0 0 1.4 1.4h10.8A1.4 1.4 0 0 0 18.8 19v-5.6"/><path d="M12 9.4v11"/><path d="M12 9.4S10.6 4 8.2 4a2.1 2.1 0 0 0 0 5.4Z"/><path d="M12 9.4S13.4 4 15.8 4a2.1 2.1 0 0 1 0 5.4Z"/>',
  ticket:    '<path d="M4 8.4V6.6A1.6 1.6 0 0 1 5.6 5h12.8A1.6 1.6 0 0 1 20 6.6v1.8a2.4 2.4 0 0 0 0 4.8v4.2A1.6 1.6 0 0 1 18.4 19H5.6A1.6 1.6 0 0 1 4 17.4v-4.2a2.4 2.4 0 0 0 0-4.8Z"/><path d="M14.4 5v14" stroke-dasharray="2 2.4"/>',
  list:      '<path d="M8.4 6.6h11.2"/><path d="M8.4 12h11.2"/><path d="M8.4 17.4h11.2"/><circle cx="4.8" cy="6.6" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="17.4" r="1.1"/>',
  gauge:     '<path d="M4.4 17.5a8.6 8.6 0 1 1 15.2 0"/><path d="m12 13.4 3.6-3.9"/><circle cx="12" cy="14.6" r="1.4"/>',
  music:     '<path d="M9.3 18V6.4l9.4-2v11"/><circle cx="6.8" cy="18" r="2.5"/><circle cx="16.2" cy="15.4" r="2.5"/>',
  star:      '<path d="m12 4 2.5 5.2 5.6.8-4 4 .9 5.7-5-2.7-5 2.7.9-5.7-4-4 5.6-.8Z"/>',
  sliders:   '<path d="M5 7.5h6"/><path d="M15 7.5h4"/><path d="M5 16.5h4"/><path d="M13 16.5h6"/><circle cx="13" cy="7.5" r="2.1"/><circle cx="11" cy="16.5" r="2.1"/>',
  users:     '<circle cx="9.4" cy="8.6" r="3.2"/><path d="M3.8 19.4a5.8 5.8 0 0 1 11.2 0"/><path d="M16 5.7a3.2 3.2 0 0 1 0 6"/><path d="M17.4 14.3a5.8 5.8 0 0 1 2.8 4.4"/>',
  bot:       '<rect x="4.4" y="8" width="15.2" height="11" rx="3"/><path d="M12 8V4.6"/><circle cx="12" cy="3.6" r="1.2"/><circle cx="9.4" cy="13.2" r="1.15"/><circle cx="14.6" cy="13.2" r="1.15"/><path d="M9.8 16.4h4.4"/>',
  hash:      '<path d="M9.4 4.4 7.8 19.6"/><path d="M16.2 4.4l-1.6 15.2"/><path d="M4.8 9h14.4"/><path d="M4.2 15h14.4"/>',
  sparkle:   '<path d="M12 3.6 13.7 9 19 10.7 13.7 12.4 12 17.8 10.3 12.4 5 10.7 10.3 9Z"/><path d="M18.4 16.2 19 18l1.8.6-1.8.6-.6 1.8-.6-1.8L16 18.6l1.8-.6Z"/>',
  // actions
  check:     '<path d="m5 12.5 4.6 4.5L19 7.5"/>',
  x:         '<path d="M6.5 6.5 17.5 17.5"/><path d="M17.5 6.5 6.5 17.5"/>',
  plus:      '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
  trash:     '<path d="M4.8 7h14.4"/><path d="M9.6 7V5.4A1.4 1.4 0 0 1 11 4h2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M6.6 7l.9 12.1A1.5 1.5 0 0 0 9 20.5h6a1.5 1.5 0 0 0 1.5-1.4L17.4 7"/><path d="M10.4 11v5.4"/><path d="M13.6 11v5.4"/>',
  save:      '<path d="M5.5 4.5h10.2L19.5 8.3v11.2a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"/><path d="M8.2 4.5v5h6.2v-5"/><path d="M7.6 14.4h8.8v6.1H7.6Z"/>',
  external:  '<path d="M13.5 5h5.5v5.5"/><path d="M18.4 5.6 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5v-10A1.5 1.5 0 0 1 6.5 7H11"/>',
  chevron:   '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  caret:     '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
  search:    '<circle cx="10.8" cy="10.8" r="6"/><path d="m15.4 15.4 4.2 4.2"/>',
  refresh:   '<path d="M19.4 11a7.5 7.5 0 1 0-.6 4.6"/><path d="M19.8 6v5.2h-5.2"/>',
  copy:      '<rect x="8.6" y="8.6" width="11" height="11" rx="2"/><path d="M15.4 5.6a2 2 0 0 0-2-1.2H6.4a2 2 0 0 0-2 2v7a2 2 0 0 0 1.2 2"/>',
  logout:    '<path d="M14.5 7.5V5.6A1.6 1.6 0 0 0 12.9 4H6.1A1.6 1.6 0 0 0 4.5 5.6v12.8A1.6 1.6 0 0 0 6.1 20h6.8a1.6 1.6 0 0 0 1.6-1.6v-1.9"/><path d="M9.6 12h10"/><path d="m16.4 8.6 3.4 3.4-3.4 3.4"/>',
  alert:     '<path d="M12 4.6 21 19.4H3Z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
  info:      '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.4"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
  play:      '<path d="M8 5.6 18.4 12 8 18.4Z"/>',
  send:      '<path d="M20.4 3.6 3.8 10.2l6.4 2.6 2.6 6.4Z"/><path d="m10.2 12.8 4.8-4.8"/>',
  eye:       '<path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  lock:      '<rect x="5.4" y="10.4" width="13.2" height="9.4" rx="2"/><path d="M8.4 10.4V7.9a3.6 3.6 0 0 1 7.2 0v2.5"/>',
  calendar:  '<rect x="4" y="6" width="16" height="14" rx="2.2"/><path d="M4 10.2h16"/><path d="M8.6 4v3.4"/><path d="M15.4 4v3.4"/>',
  link:      '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3"/>',
  wand:      '<path d="M5 19 15.6 8.4"/><path d="m14.4 4.6.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z"/><path d="m19 13.4.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5Z"/>',
};

const FILLED = {
  discord: '<path d="M19.5 6.2A16 16 0 0 0 15.6 5l-.2.4a12 12 0 0 1 3.4 1.7 14.6 14.6 0 0 0-12.6 0A12 12 0 0 1 9.6 5.4L9.4 5A16 16 0 0 0 5.5 6.2C3 9.9 2.3 13.5 2.6 17a16.1 16.1 0 0 0 4.9 2.5l1-1.7a10.5 10.5 0 0 1-1.6-.8l.4-.3a11.5 11.5 0 0 0 9.8 0l.4.3a10.5 10.5 0 0 1-1.6.8l1 1.7a16 16 0 0 0 4.9-2.5c.4-4.1-.7-7.7-2.3-10.8ZM9.3 14.8c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2Zm5.4 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.7 2-1.7 2Z"/>',
};

export function icon(name, size = 20, extraClass = '') {
  if (FILLED[name]) {
    return `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${FILLED[name]}</svg>`;
  }
  const body = P[name] ?? P.info;
  return `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The meelarp mark. */
export const LOGO = { orange: '#E0522B', black: '#000000', teal: '#00E0A0' };

export function logoMark(size = 30, id = 'ml') {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 400 400" aria-hidden="true">
    <defs>
      <clipPath id="${id}-mouth">
        <path d="M133 245 A67 67 0 0 0 267 245 Z"/>
      </clipPath>
    </defs>
    <rect width="400" height="400" rx="84" fill="${LOGO.orange}"/>
    <circle cx="133" cy="155" r="27" fill="${LOGO.black}"/>
    <circle cx="267" cy="155" r="27" fill="${LOGO.black}"/>
    <path d="M133 245 A67 67 0 0 0 267 245 Z" fill="${LOGO.black}"/>
    <ellipse cx="200" cy="308" rx="54" ry="36" fill="${LOGO.teal}" clip-path="url(#${id}-mouth)"/>
  </svg>`;
}

export const MODULE_ICONS = {
  levels: 'levels', moderation: 'shield', automod: 'filter', welcome: 'welcome',
  roles: 'tag', commands: 'terminal', timers: 'clock', feeds: 'broadcast',
  giveaways: 'gift', tickets: 'ticket', logs: 'list', counters: 'gauge',
  music: 'music', starboard: 'star', utility: 'sparkle',
};

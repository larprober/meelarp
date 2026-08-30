// meelarp — rank / welcome image rendering (MEE6 "premium" cards, free)
// Uses @napi-rs/canvas when available; callers fall back to embeds if not.
let canvasMod = null;
try { canvasMod = await import('@napi-rs/canvas'); } catch { canvasMod = null; }

export const canvasAvailable = () => !!canvasMod;

const W = 960, H = 300;

function hexToRgb(hex, fallback = [91, 107, 255]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, startSize, weight = '700') {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 12);
  return size;
}

const shortNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/**
 * @param {object} data { username, discriminator, avatarUrl, rank, level, into, needed, xp, messages, status }
 * @param {object} card { accent, background, barStyle, textColor, opacity }
 * @returns {Promise<Buffer|null>} PNG buffer
 */
export async function renderRankCard(data, card = {}) {
  if (!canvasMod) return null;
  const { createCanvas, loadImage } = canvasMod;
  const accent = hexToRgb(card.accent, [91, 107, 255]);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // --- backdrop -----------------------------------------------------------
  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, W, H);

  if (card.background) {
    try {
      const bg = await loadImage(card.background);
      const scale = Math.max(W / bg.width, H / bg.height);
      const bw = bg.width * scale, bh = bg.height * scale;
      ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.fillStyle = `rgba(8, 10, 18, ${card.opacity ?? 0.72})`;
      ctx.fillRect(0, 0, W, H);
    } catch { /* fall through to generated backdrop */ }
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#121527');
    g.addColorStop(0.55, '#0e1120');
    g.addColorStop(1, '#0b0d18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // accent glow
    const glow = ctx.createRadialGradient(W - 140, -40, 20, W - 140, -40, 460);
    glow.addColorStop(0, rgba(accent, 0.5));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    // faint diagonal rules
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (let x = -H; x < W; x += 26) {
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke();
    }
    ctx.restore();
  }

  // --- glass panel --------------------------------------------------------
  ctx.save();
  roundRect(ctx, 18, 18, W - 36, H - 36, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const text = card.textColor || '#ffffff';
  const pct = data.needed > 0 ? Math.min(1, data.into / data.needed) : 0;

  // --- avatar with progress ring -----------------------------------------
  const cx = 118, cy = H / 2, r = 62;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();

  // ring track + progress
  ctx.beginPath();
  ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
  const ringGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ringGrad.addColorStop(0, rgba(accent, 1));
  ringGrad.addColorStop(1, '#27e0a4');
  ctx.strokeStyle = ringGrad;
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  try {
    const av = await loadImage(data.avatarUrl);
    ctx.drawImage(av, cx - r, cy - r, r * 2, r * 2);
  } catch {
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 54px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((data.username || '?').charAt(0).toUpperCase(), cx, cy + 19);
  }
  ctx.restore();

  // status dot
  if (data.status) {
    const colors = { online: '#3fd07d', idle: '#f0b232', dnd: '#f04747', offline: '#7a808f' };
    const sx = cx + r * 0.72, sy = cy + r * 0.72;
    ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#0c0e16'; ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fillStyle = colors[data.status] || colors.offline; ctx.fill();
  }

  // --- rank / level cluster (top right) -----------------------------------
  ctx.textAlign = 'right';
  const levelText = String(data.level);
  const rankText = `#${data.rank}`;

  ctx.font = '600 20px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('LEVEL', W - 60, 66);
  const lvlSize = fitText(ctx, levelText, 150, 62, '800');
  ctx.fillStyle = rgba(accent, 1);
  ctx.font = `800 ${lvlSize}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(levelText, W - 60, 66 + lvlSize - 8);

  const lvlWidth = ctx.measureText(levelText).width;
  ctx.font = '600 18px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('RANK', W - 90 - lvlWidth - 24, 66);
  ctx.font = '800 40px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = text;
  ctx.fillText(rankText, W - 90 - lvlWidth - 24, 66 + 34);

  // --- name ---------------------------------------------------------------
  ctx.textAlign = 'left';
  const nameX = 210;
  const nameSize = fitText(ctx, data.username, 380, 38, '700');
  ctx.fillStyle = text;
  ctx.font = `700 ${nameSize}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(data.username, nameX, 128);

  if (data.messages !== undefined) {
    ctx.font = '500 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText(`${shortNum(data.messages)} messages  ·  ${shortNum(data.xp)} total XP`, nameX, 155);
  }

  // --- xp bar -------------------------------------------------------------
  const barX = nameX, barY = 186, barW = W - nameX - 60, barH = 26;
  const style = card.barStyle || 'rounded';
  const radius = style === 'square' ? 4 : barH / 2;

  roundRect(ctx, barX, barY, barW, barH, radius);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();

  if (pct > 0) {
    ctx.save();
    roundRect(ctx, barX, barY, barW, barH, radius);
    ctx.clip();
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, rgba(accent, 1));
    grad.addColorStop(1, '#27e0a4');
    ctx.fillStyle = grad;
    const fillW = Math.max(barH, barW * pct);
    ctx.fillRect(barX, barY, fillW, barH);

    if (style === 'segmented') {
      ctx.globalCompositeOperation = 'destination-out';
      for (let x = barX + 16; x < barX + barW; x += 16) ctx.fillRect(x, barY, 4, barH);
      ctx.globalCompositeOperation = 'source-over';
    }
    // sheen
    const sheen = ctx.createLinearGradient(0, barY, 0, barY + barH);
    sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(barX, barY, fillW, barH);
    ctx.restore();
  }

  ctx.font = '600 16px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${shortNum(data.into)} / ${shortNum(data.needed)} XP`, barX, barY + barH + 24);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`${Math.floor(pct * 100)}%`, barX + barW, barY + barH + 24);

  // wordmark
  ctx.textAlign = 'right';
  ctx.font = '700 14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText('meelarp', W - 34, H - 30);

  return canvas.encode('png');
}

/** Welcome banner (MEE6 premium feature). */
export async function renderWelcomeCard({ username, avatarUrl, guildName, memberCount, title, subtitle }, opts = {}) {
  if (!canvasMod) return null;
  const { createCanvas, loadImage } = canvasMod;
  const accent = hexToRgb(opts.accent, [91, 107, 255]);
  const w = 1000, h = 340;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, w, h);
  if (opts.background) {
    try {
      const bg = await loadImage(opts.background);
      const scale = Math.max(w / bg.width, h / bg.height);
      ctx.drawImage(bg, (w - bg.width * scale) / 2, (h - bg.height * scale) / 2, bg.width * scale, bg.height * scale);
      ctx.fillStyle = 'rgba(8,10,18,0.66)';
      ctx.fillRect(0, 0, w, h);
    } catch { /* ignore */ }
  } else {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#141830');
    base.addColorStop(1, '#0a0c16');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w / 2, -30, 20, w / 2, -30, 480);
    glow.addColorStop(0, rgba(accent, 0.5));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (let x = -h; x < w; x += 26) {
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke();
    }
    ctx.restore();
  }

  roundRect(ctx, 20, 20, w - 40, h - 40, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const cx = w / 2, cy = 118, r = 66;
  ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(accent, 0.9); ctx.lineWidth = 5; ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  try {
    const av = await loadImage(avatarUrl);
    ctx.drawImage(av, cx - r, cy - r, r * 2, r * 2);
  } catch {
    ctx.fillStyle = rgba(accent, 1); ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  const t = title || `Welcome, ${username}`;
  const ts = fitText(ctx, t, w - 140, 44, '800');
  ctx.font = `800 ${ts}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(t, cx, 236);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 21px "Segoe UI", Arial, sans-serif';
  ctx.fillText(subtitle || `You are member #${memberCount} of ${guildName}`, cx, 272);

  return canvas.encode('png');
}

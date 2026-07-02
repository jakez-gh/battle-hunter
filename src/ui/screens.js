// Screen flow (DESIGN.md §1.2, §2.13, §2.15): a screen-stack manager plus all
// game screens — TITLE, ROSTER/OFFICE, CREATION, HUB, CLIENT, HOSPITAL,
// OPTIONS, GAME, RESULTS.
//
// A screen is a plain object: { enter, exit, resume, update(dt), draw(ctx),
// onKey(sem, e), onClick(pos, e), onHover(pos, e) } — all optional. Screens
// receive the shared `app` context built by main.js: { canvas, ctx, W, H,
// atlas, stack, roster, session, options(), save(), music(name),
// startMission(mission), adapt }. All engine/renderer access for the
// in-mission screen goes through app.adapt (main.js's ADAPT layer) so the
// parallel game.js/ai.js/renderer.js contracts are patched in one place.
import { describeCard, cardColor } from '../engine/cards.js';
import { ITEMS, sellPrice, effectiveStats } from '../engine/items.js';
import { battleOdds, describeOdds, explainStrike } from '../engine/odds.js';
import { STORY_MISSIONS, makeNormalMission, applyResults, displayStats, LEVEL_UP_FEES } from '../engine/missions.js';
import { PALETTE_NAMES, HUNTERS as HUNTER_SPRITES } from '../render/sprites.js';
import { setVolumes } from '../audio/synth.js';
import { sfx } from '../audio/sfx.js';
import { makeHunterRecord, exportSave, importSave, loadRoster,
         loadRelicDiveBest, saveRelicDiveBest, todayDateKey, dateToSeed,
         buildShareString, hashRunSeed, getLeaderboard, addLeaderboardEntry,
         storageArea } from '../save.js';
import { makeRng } from '../engine/rng.js';
import { rollPerkChoices, describePerk, perkHasEffect } from '../engine/perks.js';
import { MODIFIERS, allModifiers, scoreMultiplier, rollDailyModifier } from '../engine/modifiers.js';

// ---------------------------------------------------------------------------
// First-play tutorial tips (F6 demo-path: teach by doing, not by reading the manual)

const TIPS_KEY = 'bh-tips-v1';
const TIP_DEFS = {
  card:     ['Cards fuel every turn!', 'Red=attack  Yellow=defend  Blue=move  Green=trap'],
  steer:    ['MOVEMENT — pick your route before committing', 'Arrow keys or click  ·  Z to undo the last step'],
  response: ['BATTLE — choose your response carefully', 'Counter=fight  Guard=absorb  Escape=flee  Surrender=give'],
  win:      ['Mission complete, Hunter!', 'Play DAILY HUNT every day to track your personal best.'],
  wyrm:     ['THE WYRM hunts the Target holder!', 'WYRM defeat = WIPE: all items + credits lost forever.'],
  dive:     ['RELIC DIVE — win the depth, then choose your fate', 'DESCEND for more score (HP carries over)  ·  BANK OUT to lock it in safely'],
  sealed:   ['Item sealed — effects inactive until appraised', 'Visit the CLIENT between missions to identify it  ·  Cursed items activate unidentified'],
};

function loadSeenTips() {
  try {
    const raw = storageArea().getItem(TIPS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function markTipSeen(key, set) {
  set.add(key);
  try { storageArea().setItem(TIPS_KEY, JSON.stringify([...set])); } catch {}
}

// ---------------------------------------------------------------------------
// Screen stack

export function createScreenStack() {
  const stack = [];
  const FADE_DUR = 0.22;
  let fadeAlpha = 0;
  const top = () => stack[stack.length - 1] ?? null;
  const triggerFade = () => { fadeAlpha = 1.0; };
  return {
    top,
    depth: () => stack.length,
    push(s) { stack.push(s); s.enter?.(); triggerFade(); },
    pop() {
      const s = stack.pop();
      s?.exit?.();
      top()?.resume?.();
      triggerFade();
      return s;
    },
    // Unwind the stack until the screen tagged `tag` is on top (it stays).
    // Returns true if such a screen was found, false otherwise (stack untouched).
    // Used to route back to the Hub regardless of what sits above it (D20):
    // story leaves [Title, Hub, Client, RESULTS], so a blind pop misses the Hub.
    popToTag(tag) {
      const i = stack.findIndex((s) => s?.tag === tag);
      if (i < 0) return false;
      while (stack.length > i + 1) {
        const s = stack.pop();
        s?.exit?.();
      }
      top()?.resume?.();
      triggerFade();
      return true;
    },
    replace(s) {
      const old = stack.pop();
      old?.exit?.();
      stack.push(s);
      s.enter?.();
      triggerFade();
    },
    update(dt) {
      top()?.update?.(dt);
      if (fadeAlpha > 0) fadeAlpha = Math.max(0, fadeAlpha - dt / FADE_DUR);
    },
    draw(ctx) {
      top()?.draw?.(ctx);
      if (fadeAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        ctx.fillStyle = '#06060c';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      }
    },
    onKey(k, e) { top()?.onKey?.(k, e); },
    onClick(pos, e) { top()?.onClick?.(pos, e); },
    onHover(pos, e) { top()?.onHover?.(pos, e); },
  };
}

// ---------------------------------------------------------------------------
// Shared drawing helpers — chunky retro canvas styling, no external resources.

const FG = '#e8e8f0', DIM = '#9aa0b4', GOLD = '#e8d87e', BAD = '#e06a5a', OK = '#7ee8a0';
const SLOT_COLORS = ['#4a7dff', '#e05a4a', '#e0c63a', '#3aa84a']; // P1-P4 (§2.2)
const CARD_HEX = { red: '#e05a4a', yellow: '#e0c63a', blue: '#4a7dff', green: '#3aa84a' };
const MONSTER_KIND_COLOR = { VAC: '#50b0e8', OOZ: '#50c84a', FNG: '#e09040', WYRM: '#9870d8' };
const STATUS_GLOW_COLORS = { stun: '#d8b83a', leg: '#4a7dff', panic: '#e05a4a', empty: '#9aa0b4' };

// Battle respond hints — exported so layout tests can verify these fit in the
// 232px game menu at size 13 (≈0.6em/char Courier New → 212px available for
// label+hint combined).
export const RESPONSE_HINTS = {
  counter: 'fight back',
  guard: 'double DF',
  escape: 'flee roll',
  surrender: 'give item',
  fortune: 'reroll dice',
};

const font = (px, bold = true) => `${bold ? 'bold ' : ''}${px}px "Consolas", "Cascadia Mono", "Monaco", monospace`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function text(ctx, s, x, y, opt = {}) {
  ctx.font = font(opt.size ?? 16, opt.bold ?? true);
  ctx.textAlign = opt.align ?? 'left';
  ctx.textBaseline = opt.baseline ?? 'top';
  if (opt.shadow ?? true) {
    ctx.fillStyle = '#000';
    ctx.fillText(s, x + 2, y + 2);
  }
  ctx.fillStyle = opt.color ?? FG;
  ctx.fillText(s, x, y);
}

function wrapText(ctx, str, x, y, maxW, lineH, opt = {}) {
  if (!str) return y;
  ctx.font = font(opt.size ?? 13, opt.bold ?? false);
  let line = '', cy = y;
  for (const word of str.split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (line && ctx.measureText(test).width > maxW) {
      text(ctx, line, x, cy, opt);
      line = word;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) text(ctx, line, x, cy, opt);
  return cy + lineH;
}

function box(ctx, x, y, w, h, opt = {}) {
  if (opt.fill) {
    ctx.fillStyle = opt.fill;
    ctx.fillRect(x, y, w, h);
  } else {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(22,24,44,0.97)');
    grad.addColorStop(1, 'rgba(10,12,24,0.97)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }
  const bdr = opt.stroke ?? '#4a5280';
  ctx.strokeStyle = bdr;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  // Single top-edge highlight (frosted glass suggestion)
  ctx.save();
  ctx.strokeStyle = 'rgba(160,170,220,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 3, y + 3);
  ctx.lineTo(x + w - 3, y + 3);
  ctx.stroke();
  ctx.restore();
  if (opt.title) {
    // Subtle gold wash behind the title area
    const tg = ctx.createLinearGradient(x + 4, y, x + Math.min(w - 8, 140), y);
    tg.addColorStop(0, 'rgba(200,160,30,0.14)'); tg.addColorStop(1, 'transparent');
    ctx.fillStyle = tg; ctx.fillRect(x + 4, y + 2, Math.min(w - 8, 140), 26);
    ctx.fillStyle = GOLD; ctx.fillRect(x + 4, y + 7, 2, 18);
    ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = '#906000';
    text(ctx, opt.title, x + 10, y + 8, { size: 14, color: GOLD, shadow: false });
    ctx.restore();
  }
}

function sprite(app, name, x, y, scale = 1) {
  const img = app.atlas?.[name];
  if (!img) return;
  app.ctx.imageSmoothingEnabled = false;
  app.ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
}

const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// ---------------------------------------------------------------------------
// Wallpapers — original procedural backdrops; index 0 is always unlocked,
// 1..15 unlock via Disc 1..15 items (§2.13, §2.14).

export const WALLPAPERS = [
  { name: 'Slate', base: '#11131c', accent: '#1a1d2c', pattern: 'plain' },
  { name: 'Grid Iron', base: '#101822', accent: '#1c2c40', pattern: 'grid' },
  { name: 'Ember Field', base: '#1c1012', accent: '#48211c', pattern: 'dots' },
  { name: 'Tide Lines', base: '#0e1420', accent: '#1c2c4e', pattern: 'waves' },
  { name: 'Moss Weave', base: '#0e180f', accent: '#1d3a20', pattern: 'diag' },
  { name: 'Amber Glow', base: '#1c160c', accent: '#4a3a16', pattern: 'rings' },
  { name: 'Static Drift', base: '#14141a', accent: '#2c2c36', pattern: 'dots' },
  { name: 'Indigo Span', base: '#12101f', accent: '#28204a', pattern: 'stripes' },
  { name: 'Coral Bands', base: '#1c1014', accent: '#4a2230', pattern: 'diag' },
  { name: 'Pale Rings', base: '#171a1c', accent: '#33404a', pattern: 'rings' },
  { name: 'Night Grid', base: '#140f1c', accent: '#2e2044', pattern: 'grid' },
  { name: 'Sunset Bars', base: '#1c130c', accent: '#503018', pattern: 'stripes' },
  { name: 'Deep Dots', base: '#0c1a1a', accent: '#1c4040', pattern: 'dots' },
  { name: 'Mint Cross', base: '#101c16', accent: '#234534', pattern: 'grid' },
  { name: 'Rose Diag', base: '#1c1018', accent: '#46203a', pattern: 'diag' },
  { name: 'Gilded Rings', base: '#1a1408', accent: '#54421a', pattern: 'rings' },
];

export function unlockedWallpapers(roster) {
  const set = new Set([0, ...(roster.options.wallpapersUnlocked || [])]);
  for (const h of roster.hunters) {
    for (const it of h.items || []) {
      const m = /^disc(\d+)$/.exec(it.itemId);
      if (m && +m[1] < WALLPAPERS.length) set.add(+m[1]);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function drawWallpaper(ctx, W, H, index) {
  const wp = WALLPAPERS[index] ?? WALLPAPERS[0];
  const t = performance.now() / 1000;
  ctx.fillStyle = wp.base;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = wp.accent;
  ctx.strokeStyle = wp.accent;
  ctx.lineWidth = 2;
  const S = 48;
  if (wp.pattern === 'plain') {
    // Slow horizontal scanlines drifting downward — adds subtle texture to flat fills
    const drift = (t * 6) % S;
    ctx.save(); ctx.globalAlpha = 0.04; ctx.fillStyle = wp.accent;
    for (let y = -S + drift; y < H; y += S) ctx.fillRect(0, y | 0, W, 2);
    ctx.restore();
  } else if (wp.pattern === 'grid') {
    for (let x = 0; x <= W; x += S) ctx.fillRect(x, 0, 2, H);
    for (let y = 0; y <= H; y += S) ctx.fillRect(0, y, W, 2);
    // Brief twinkle at grid intersections: ~1-in-3 intersections flash per cycle
    ctx.save();
    for (let y = S; y < H; y += S) {
      for (let x = S; x < W; x += S) {
        const ih = ((x * 31 + y * 17) ^ 0x3C7) & 0xFFF;
        const period = 3200 + (ih & 0xFFF);
        const phase = ((t * 1000 + ih * 23) % period) / period;
        if (phase > 0.06) continue;
        const ga = Math.sin(phase / 0.06 * Math.PI) * 0.55;
        ctx.globalAlpha = ga; ctx.fillStyle = wp.accent;
        ctx.fillRect(x - 2, y - 2, 6, 6);
      }
    }
    ctx.restore();
  } else if (wp.pattern === 'dots') {
    // Dots breathe and drift on a per-dot Lissajous orbit
    const dr = 3 + 1.5 * Math.sin(t * 0.8);
    for (let y = S / 2; y < H; y += S) for (let x = S / 2; x < W; x += S) {
      const ph = (Math.round(x / S) * 7 + Math.round(y / S) * 11) * 0.47;
      const dx = Math.sin(t * 0.24 + ph) * 3.5;
      const dy = Math.cos(t * 0.19 + ph * 0.71) * 3.5;
      ctx.fillRect((x + dx - dr) | 0, (y + dy - dr) | 0, (dr * 2 + 1) | 0, (dr * 2 + 1) | 0);
    }
  } else if (wp.pattern === 'stripes') {
    // Stripes drift slowly upward — seamlessly wraps every S pixels
    const drift = (t * 8) % S;
    for (let y = -S + drift; y < H; y += S) ctx.fillRect(0, y | 0, W, 10);
  } else if (wp.pattern === 'diag') {
    // Forward lines drift right; faint back-slash cross lines at 0.32 alpha → diamond weave
    const drift = (t * 12) % S;
    ctx.beginPath();
    for (let x = -H - S + drift; x < W; x += S) { ctx.moveTo(x, 0); ctx.lineTo(x + H, H); }
    ctx.stroke();
    ctx.save(); ctx.globalAlpha = 0.32;
    const bdrift = ((-t * 8) % S + S) % S;
    ctx.beginPath();
    for (let x = -S + bdrift; x < W + H; x += S) { ctx.moveTo(x, 0); ctx.lineTo(x - H, H); }
    ctx.stroke();
    ctx.restore();
  } else if (wp.pattern === 'waves') {
    // Sine-wave bands drifting slowly at different speeds — parallax ocean feel
    ctx.lineWidth = 1.5;
    for (let li = 0; li < 7; li++) {
      const baseY = (li / 7) * H + S * 0.3;
      const spd = 0.55 + li * 0.15;
      const amp = 7 + (li % 3) * 5;
      const freq = 0.017 + (li % 2) * 0.006;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const wy = baseY + amp * Math.sin(x * freq + t * spd);
        x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
  } else if (wp.pattern === 'rings') {
    // Rings breathe + each node fires an expanding pulse ring at a staggered phase offset
    const ringR = S / 3 + 4 * Math.sin(t * 0.55);
    ctx.lineWidth = 1.5;
    for (let y = S; y < H; y += S * 2) for (let x = S; x < W; x += S * 2) {
      ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2); ctx.stroke();
      const seed = (x * 31 + y * 17) & 0xFFF;
      const period = 2600 + (seed % 1200);
      const phase = ((t * 1000 + seed * 23) % period) / period;
      if (phase < 0.50) {
        const pr = ringR * 0.8 + phase * S * 1.2;
        const pa = (1 - phase / 0.50) * 0.40;
        ctx.save(); ctx.globalAlpha = pa; ctx.lineWidth = 1.0;
        ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }
  // Radial vignette — very slight breathing pulse gives the menus a living feel
  const vigBreathe = 0.016 * Math.sin(t / 5.8);
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.95);
  vig.addColorStop(0, 'transparent');
  vig.addColorStop(1, `rgba(0,0,0,${(0.52 + vigBreathe).toFixed(3)})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// Menus — vertical option lists with keyboard + click-to-select-click-to-pick.

function makeMenu(items, { title = '', onPick, onCancel, footer = '', footerColor = null } = {}) {
  const m = {
    title, items, footer, footerColor, idx: 0, rects: [],
    current: () => m.items[m.idx],
    move(d) {
      const n = m.items.length;
      if (!n) return;
      for (let i = 0; i < n; i++) {
        m.idx = (m.idx + d + n) % n;
        if (!m.items[m.idx].disabled) break;
      }
      sfx.menuMove();
    },
    pick() {
      const it = m.items[m.idx];
      if (!it || it.disabled) { sfx.error(); return; }
      sfx.menuConfirm();
      onPick?.(it.value, it);
    },
    cancel() {
      if (!onCancel) return;
      sfx.menuCancel();
      onCancel();
    },
    key(k) {
      if (k === 'up') m.move(-1);
      else if (k === 'down') m.move(1);
      else if (k === 'confirm') m.pick();
      else if (k === 'cancel') m.cancel();
      else return false;
      return true;
    },
    click(pos) {
      for (let i = 0; i < m.rects.length; i++) {
        if (m.rects[i] && inRect(pos, m.rects[i])) {
          // A tap/click selects AND activates the item in one go. (Was
          // focus-then-tap-again, which forced an unusable double-tap on touch
          // and is also non-standard for a mouse — you click what you mean.)
          if (m.items[i].disabled) { sfx.error(); return true; }
          m.idx = i;
          m.pick();
          return true;
        }
      }
      return false;
    },
  };
  if (m.items.length && m.items[0].disabled) m.move(1);
  return m;
}

function drawMenu(ctx, m, x, y, w, opt = {}) {
  const lh = opt.lineH ?? 24;
  const pad = opt.pad ?? 10;
  const headH = m.title ? (opt.headH ?? 26) : 0;
  const footH = m.footer ? (opt.footH ?? 20) : 0;
  const h = m.items.length * lh + pad * 2 + headH + footH;
  box(ctx, x, y, w, h, { title: m.title });
  m.rects = [];
  let oy = y + pad + headH;
  m.items.forEach((it, i) => {
    const sel = i === m.idx;
    if (sel) {
      const hc = (!it.disabled && it.color) ? it.color : '#5064dc';
      const sg = ctx.createLinearGradient(x + 4, 0, x + w - 8, 0);
      sg.addColorStop(0, hc + '6a'); sg.addColorStop(1, hc + '1a');
      ctx.fillStyle = sg; ctx.fillRect(x + 4, oy - 2, w - 8, lh);
      ctx.fillStyle = hc + 'b8'; ctx.fillRect(x + 4, oy - 2, 2, lh);
      // Subtle shimmer scan across selected row
      const mt = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
      const shX = x + 4 + ((mt % 2.4) / 2.4) * (w + 40) - 20;
      const sh = ctx.createLinearGradient(shX - 16, 0, shX + 16, 0);
      sh.addColorStop(0, 'transparent');
      sh.addColorStop(0.5, 'rgba(240,240,255,0.18)');
      sh.addColorStop(1, 'transparent');
      ctx.save(); ctx.beginPath(); ctx.rect(x + 4, oy - 2, w - 8, lh); ctx.clip();
      ctx.fillStyle = sh; ctx.fillRect(shX - 16, oy - 2, 32, lh); ctx.restore();
    }
    const color = it.disabled ? '#565d75' : it.color ?? (sel ? '#ffffff' : FG);
    text(ctx, (sel ? '>' : ' ') + it.label, x + 10, oy, { size: opt.size ?? 15, color });
    if (it.right) text(ctx, it.right, x + w - 10, oy, { align: 'right', size: opt.size ?? 14, color: it.disabled ? '#565d75' : (it.rightColor ?? DIM) });
    m.rects.push({ x: x + 4, y: oy - 2, w: w - 8, h: lh });
    oy += lh;
  });
  if (m.footer) text(ctx, m.footer, x + 10, oy + 2, { size: 12, color: m.footerColor ?? DIM });
  return h;
}

// Sub-menu host: screens with nested menus (client, hospital, game).
function makeMenuHost() {
  const menus = [];
  return {
    menus,
    top: () => menus[menus.length - 1] ?? null,
    push(m) { menus.push(m); },
    pop() { return menus.pop(); },
    clear() { menus.length = 0; },
    key(k) { return menus.length ? this.top().key(k) : false; },
    click(pos) { return menus.length ? this.top().click(pos) : false; },
  };
}

// ---------------------------------------------------------------------------
// Small shared bits

const baseMaxHp = (rec) => 7 + 3 * rec.internal.hp + (rec.level - 1);
const fmtStats = (d) => `MV+${d.mv}  AT ${d.at}  DF ${d.df}  HP ${d.maxHp}`;
const currentHunter = (app) => app.roster.hunters.find((h) => h.id === app.session.hunterId) ?? null;
const PALETTE_ACCENT = {
  cobalt: '#2d5bd1', ember: '#c8372d', citrine: '#d1a52d', moss: '#3d8f3a',
  orchid: '#8b3dc1', rust: '#b4642a', glacier: '#3aa9b8', onyx: '#3c3c46',
};
const itemName = (slot) => {
  const it = ITEMS[slot.itemId];
  if (!it) return slot.itemId;
  if (!slot.identified) return it.cursed ? '??? (cursed)' : `??? (sealed)`;
  const m = slot.identified && it.effect ? /^(?:at|df|escape)\+(\d)$/.exec(it.effect) : null;
  return m ? `${it.name} +${m[1]}` : it.name;
};
const itemTier = (slot) => {
  const it = ITEMS[slot.itemId];
  const m = slot.identified && it?.effect ? /^(?:at|df|escape)\+(\d)$/.exec(it.effect) : null;
  return m ? +m[1] : 0;
};
const ITEM_CAT_COLOR = {
  weapon: '#cc4a3a', armor: '#e0c63a', escape: '#3a6ee0',
  special: '#a060d8', counter: '#3aa84a', sensor: '#3aacc8',
  treasure: '#b8c0d0',
};

function drawItemList(ctx, items, x, y0, hudT) {
  items.slice(0, 6).forEach((slot, i) => {
    const tier = itemTier(slot);
    const label = '- ' + itemName(slot);
    const ly = y0 + i * 18;
    if (!slot.identified) {
      text(ctx, label, x, ly, { size: 12, color: DIM });
    } else if (tier >= 3) {
      ctx.save(); ctx.shadowBlur = 4 + 2 * Math.sin(hudT * 1.8 + i * 1.1); ctx.shadowColor = '#906000';
      text(ctx, label, x, ly, { size: 12, color: GOLD, shadow: false });
      ctx.restore();
    } else {
      const it = ITEMS[slot.itemId];
      const col = ITEM_CAT_COLOR[it?.category] ?? '#b8c0d0';
      text(ctx, label, x, ly, { size: 12, color: col });
    }
  });
}

function drawGoldBloom(ctx, cx) {
  const bt = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  const breathe = 0.04 * Math.sin(bt * 0.85);
  const bl = ctx.createRadialGradient(cx, 60, 8, cx, 60, 130);
  bl.addColorStop(0, `rgba(200,160,30,${(0.28 + breathe).toFixed(3)})`);
  bl.addColorStop(1, 'transparent');
  ctx.fillStyle = bl;
  ctx.fillRect(cx - 130, 10, 260, 100);
}

function drawHunterCard(app, rec, x, y, w) {
  const ctx = app.ctx;
  const accent = PALETTE_ACCENT[rec.palette] ?? '#3c4364';
  box(ctx, x, y, w, 76, { stroke: accent });
  ctx.fillStyle = accent;
  ctx.fillRect(x + 2, y + 2, 3, 72);
  // Palette-colored glow behind portrait
  const pg = ctx.createRadialGradient(x + 38, y + 38, 4, x + 38, y + 38, 38);
  pg.addColorStop(0, accent + '44'); pg.addColorStop(1, accent + '00');
  ctx.fillStyle = pg; ctx.fillRect(x + 5, y + 4, 66, 68);
  // Animated shimmer scan across the card
  const ct = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  const shX = x + ((ct % 3.0) / 3.0) * (w + 60) - 30;
  const sh = ctx.createLinearGradient(shX - 24, 0, shX + 24, 0);
  sh.addColorStop(0, 'transparent');
  sh.addColorStop(0.5, 'rgba(180,200,255,0.12)');
  sh.addColorStop(1, 'transparent');
  ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, 72); ctx.clip();
  ctx.fillStyle = sh; ctx.fillRect(shX - 24, y + 2, 48, 72); ctx.restore();
  sprite(app, `hunter${rec.spriteId}.${rec.palette}.icon`, x + 8, y + 8, 5);
  const d = displayStats(rec.internal, rec.level);
  ctx.save(); ctx.shadowBlur = 9; ctx.shadowColor = '#b07a08';
  text(ctx, rec.name, x + 76, y + 8, { size: 18, color: GOLD, shadow: false });
  ctx.restore();
  { const lvStr = `Lv ${rec.level}   `;
    ctx.font = '14px Consolas, "Courier New", monospace';
    const lvW = Math.round(ctx.measureText(lvStr).width);
    text(ctx, lvStr, x + 76, y + 30, { size: 14 });
    ctx.save(); ctx.shadowBlur = 4; ctx.shadowColor = '#906000';
    text(ctx, `${rec.credits} cr`, x + 76 + lvW, y + 30, { size: 14, color: GOLD, shadow: false });
    ctx.restore(); }
  { const hp = rec.maxHp, base = baseMaxHp(rec);
    const segs = [
      { t: `MV+${d.mv}`, c: '#3a6ee0' },
      { t: `  AT ${d.at}`, c: '#cc4a3a' },
      { t: `  DF ${d.df}`, c: '#e0c63a' },
      { t: `  HP ${hp}${hp < base ? '/' + base : ''}`, c: '#3aa84a' },
    ];
    ctx.font = font(13, true);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let sx = x + 76;
    for (const seg of segs) {
      ctx.fillStyle = '#000'; ctx.fillText(seg.t, sx + 2, y + 52);
      ctx.save(); ctx.shadowBlur = 3; ctx.shadowColor = seg.c;
      ctx.fillStyle = seg.c; ctx.fillText(seg.t, sx, y + 50);
      ctx.restore();
      sx += Math.round(ctx.measureText(seg.t).width);
    } }
}

// ---------------------------------------------------------------------------
// TITLE

export function makeTitleScreen(app) {
  let t = 0;

  function quickStart() {
    sfx.menuConfirm();
    // Ensure there's an active hunter — create a balanced starter if none.
    if (!currentHunter(app)) {
      const QUICK_NAMES = ['Vex', 'Arlo', 'Sable', 'Kira', 'Finn', 'Nova'];
      const name = QUICK_NAMES[Math.floor(Date.now() / 1000) % QUICK_NAMES.length];
      const rec = makeHunterRecord({
        name,
        spriteId: Math.floor(Math.random() * 8),
        palette: PALETTE_NAMES[Math.floor(Math.random() * PALETTE_NAMES.length)],
        internal: { mv: 3, at: 4, df: 4, hp: 4 }, // balanced L1 starter
      });
      app.roster.hunters.push(rec);
      app.session.hunterId = rec.id;
      app.save();
    }
    // Push Hub below so results screen pops back to it, then launch directly into
    // a Level 1 Normal mission — skips the Client/party-setup friction (F6 demo path).
    app.session.mode = 'normal';
    app.session.coopIds = []; // D04: clear any stale co-op party (1 human + 3 AI)
    app.stack.push(makeHubScreen(app));
    const hunter = currentHunter(app);
    if (hunter) {
      const mission = makeNormalMission([hunter]);
      app.pushMission(mission);
    }
  }

  const menu = makeMenu([
    { label: 'QUICK START', value: 'quick', color: OK },
    { label: 'STORY', value: 'story', color: GOLD },
    { label: 'NORMAL', value: 'normal', color: '#4a7dff' },
    { label: 'HOW TO PLAY', value: 'manual', color: '#3aacc8' },
    { label: 'OPTIONS', value: 'options', color: DIM },
  ], {
    onPick(v) {
      if (v === 'quick') { quickStart(); return; }
      if (v === 'options') { app.stack.push(makeOptionsScreen(app)); return; }
      if (v === 'manual') { app.stack.push(makeManualScreen(app)); return; }
      app.session.mode = v;
      app.stack.push(makeRosterScreen(app));
    },
  });
  return {
    enter() { app.music('title'); },
    resume() { app.music('title'); },
    update(dt) { t += dt; },
    onKey(k) { menu.key(k); },
    onClick(pos) { menu.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      // Twinkling background stars — 40 gently oscillating specs
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 137.508) % 1) * app.W;
        const sy = ((i * 61.803) % 1) * app.H * 0.68 + Math.sin(t * (0.05 + (i % 5) * 0.02) + i * 0.8) * 10;
        const sa = 0.10 + 0.10 * Math.sin(t * (1.2 + (i & 3) * 0.4) + i * 0.97);
        ctx.save(); ctx.globalAlpha = sa;
        if ((i & 7) === 0) {
          // Gold stars: cross/star shape
          ctx.fillStyle = GOLD;
          ctx.fillRect((sx - 0.4) | 0, (sy - 1.5) | 0, 1, 3);
          ctx.fillRect((sx - 1.5) | 0, (sy - 0.4) | 0, 3, 1);
        } else {
          ctx.fillStyle = FG;
          ctx.fillRect(sx | 0, sy | 0, 1, 1);
        }
        ctx.restore();
      }
      // Chunky layered logo
      const cx = app.W / 2;
      const bob = Math.sin(t * 2) * 4;
      // Purple atmospheric bloom behind the title
      const titlePulse = 0.38 + 0.10 * Math.sin(t * 1.4);
      const bloom = ctx.createRadialGradient(cx, 160, 15, cx, 160, 190);
      bloom.addColorStop(0, `rgba(55, 12, 92, ${titlePulse.toFixed(2)})`);
      bloom.addColorStop(1, 'transparent');
      ctx.fillStyle = bloom;
      ctx.fillRect(cx - 190, 55, 380, 210);
      for (const [dx, dy, c] of [[8, 8, '#000'], [4, 4, '#5c1d8f'], [0, 0, FG]]) {
        text(ctx, 'BATTLE', cx + dx, 110 + dy + bob, { size: 84, align: 'center', shadow: false, color: c });
      }
      ctx.save(); ctx.shadowBlur = 28; ctx.shadowColor = '#7030c0';
      text(ctx, 'BATTLE', cx, 110 + bob, { size: 84, align: 'center', shadow: false, color: FG });
      ctx.restore();
      for (const [dx, dy, c] of [[8, 8, '#000'], [4, 4, '#8f6f1d'], [0, 0, GOLD]]) {
        text(ctx, 'HUNTER', cx + dx, 200 + dy + bob, { size: 84, align: 'center', shadow: false, color: c });
      }
      ctx.save(); ctx.shadowBlur = 28; ctx.shadowColor = '#c07800';
      text(ctx, 'HUNTER', cx, 200 + bob, { size: 84, align: 'center', shadow: false, color: GOLD });
      ctx.restore();
      // Horizontal shimmer sweep over the title area (repeats every 3.2s)
      { const scanX = cx - 260 + ((t % 3.2) / 3.2) * (520 + 80) - 40;
        const scan = ctx.createLinearGradient(scanX - 50, 0, scanX + 50, 0);
        scan.addColorStop(0, 'transparent');
        scan.addColorStop(0.5, 'rgba(255,255,255,0.15)');
        scan.addColorStop(1, 'transparent');
        ctx.save(); ctx.fillStyle = scan;
        ctx.fillRect(cx - 260, 55 + bob, 520, 230); ctx.restore(); }
      // Decorative separator line + flanking diamonds
      ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = '#806000';
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx - 260, 300, 520, 3);
      // Flanking accent diamonds
      ctx.fillStyle = GOLD;
      for (const [dx, fy] of [[cx - 280, 302], [cx + 280, 302]]) {
        ctx.beginPath();
        ctx.moveTo(dx, fy - 5); ctx.lineTo(dx + 5, fy);
        ctx.lineTo(dx, fy + 5); ctx.lineTo(dx - 5, fy);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.save(); ctx.shadowBlur = 4; ctx.shadowColor = '#404060';
      text(ctx, 'relic dives of the Meridian Salvage Guild', cx, 314, { size: 15, align: 'center', color: DIM, shadow: false });
      ctx.restore();
      // All 8 hunters marching with palette-colored ground glows
      const step = Math.floor(t * 3) % 2 ? 'step' : 'idle';
      const HUNTER_GLOWS = ['#3a6ee0','#cc4a3a','#e0c63a','#3aa84a','#8c3ae0','#c85c2a','#3aacc8','#888aa0'];
      PALETTE_NAMES.forEach((pal, i) => {
        const hx = cx - 350 + i * 88;
        const gcx = hx + 40;
        const gcy = 428;
        const pulse = 0.22 + 0.12 * Math.sin(t * 1.6 + i * 0.8);
        ctx.save();
        ctx.globalAlpha = pulse;
        const gr = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, 34);
        gr.addColorStop(0, HUNTER_GLOWS[i]);
        gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr;
        ctx.fillRect(gcx - 34, gcy - 34, 68, 68);
        ctx.restore();
        // Floating dust motes drifting upward around each hunter
        for (let j = 0; j < 4; j++) {
          const phase = ((t * 0.38 + i * 0.7 + j * 1.4) % 1 + 1) % 1;
          const sx = gcx + Math.sin(t * 0.9 + j * 2.2 + i * 0.5) * 16;
          const sy = gcy - phase * 54 - 8;
          const ma = Math.min(phase, 1 - phase) * 2 * 0.5;
          ctx.save(); ctx.globalAlpha = ma;
          ctx.fillStyle = HUNTER_GLOWS[i];
          ctx.fillRect((sx - 0.5) | 0, (sy - 1.5) | 0, 2, 4);
          ctx.fillRect((sx - 1.5) | 0, (sy - 0.5) | 0, 4, 2);
          ctx.restore();
        }
        sprite(app, `hunter${i}.${pal}.${step}`, hx, 354, 5);
      });
      drawMenu(ctx, menu, cx - 130, 464, 260, { lineH: 30, size: 20 });
      text(ctx, 'arrows/WASD move - Enter confirm - Esc back', cx, 660, { size: 13, align: 'center', color: DIM });
      text(ctx, 'an original clone - all art, music and names are ours', cx, 685, { size: 12, align: 'center', color: '#565d75' });
    },
  };
}

// ---------------------------------------------------------------------------
// ROSTER / OFFICE — list saved hunters, create, erase, pick the active one.
// opts.manage = opened from the hub Office (returns to hub instead of
// entering it).

export function makeRosterScreen(app, opts = {}) {
  const host = makeMenuHost();

  function rootMenu() {
    const hs = app.roster.hunters;
    const items = hs.map((h) => ({ label: h.name, right: `Lv${h.level} ${h.credits}cr`, rightColor: GOLD, color: PALETTE_ACCENT[h.palette], value: { kind: 'hunter', id: h.id } }));
    items.push({ label: '+ Register new hunter', value: { kind: 'new' }, color: OK });
    items.push({ label: 'Back', value: { kind: 'back' } });
    return makeMenu(items, {
      title: opts.manage ? 'OFFICE' : `OFFICE - ${app.session.mode.toUpperCase()} MODE`,
      footer: 'Save data is stored in this browser.',
      onPick(v) {
        if (v.kind === 'back') { app.stack.pop(); return; }
        if (v.kind === 'new') { app.stack.push(makeCreationScreen(app)); return; }
        host.push(hunterMenu(v.id));
      },
      onCancel() { app.stack.pop(); },
    });
  }

  function hunterMenu(id) {
    const rec = app.roster.hunters.find((h) => h.id === id);
    return makeMenu([
      { label: opts.manage ? 'Make active' : 'Enter the hub', value: 'select' },
      { label: 'Erase', value: 'erase', color: BAD, disabled: opts.manage && id === app.session.hunterId },
      { label: 'Cancel', value: 'cancel' },
    ], {
      title: rec.name,
      onPick(v) {
        if (v === 'select') {
          app.session.hunterId = id;
          if (opts.manage) { host.clear(); host.push(rootMenu()); }
          else app.stack.replace(makeHubScreen(app));
        } else if (v === 'erase') {
          host.push(makeMenu([
            { label: 'Yes, erase forever', value: true, color: BAD },
            { label: 'No', value: false },
          ], {
            title: `Erase ${rec.name}?`,
            onPick(yes) {
              if (yes) {
                app.roster.hunters = app.roster.hunters.filter((h) => h.id !== id);
                if (app.session.hunterId === id) app.session.hunterId = null;
                app.save();
                host.clear();
                host.push(rootMenu());
              } else host.pop();
            },
            onCancel() { host.pop(); },
          }));
        } else host.pop();
      },
      onCancel() { host.pop(); },
    });
  }

  let rt = 0;
  return {
    enter() { host.push(rootMenu()); },
    resume() { host.clear(); host.push(rootMenu()); }, // refresh after creation
    update(dt) { rt += dt; },
    onKey(k) { host.key(k); },
    onClick(pos) { host.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      drawGoldBloom(ctx, app.W / 2);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#b07a08';
      text(ctx, 'HUNTER ROSTER', app.W / 2, 30, { size: 36, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      if (!host.menus[0]) return;
      drawMenu(ctx, host.menus[0], 60, 100, 380, { lineH: 28, size: 16 });
      if (host.menus.length > 1) drawMenu(ctx, host.top(), 200, 200, 320);
      // detail card for the highlighted roster hunter
      const sel = host.menus[0]?.current()?.value;
      if (sel?.kind === 'hunter') {
        const rec = app.roster.hunters.find((h) => h.id === sel.id);
        if (rec) {
          drawHunterCard(app, rec, 500, 100, 400);
          box(ctx, 500, 190, 400, 250, { title: 'STATUS' });
          // Animated preview: walk cycle + gentle vertical bob
          const rframe = Math.floor(rt * 2.5) % 2 ? 'step' : 'idle';
          const rbob = Math.round(Math.sin(rt * 2.2) * 3);
          const raccent = PALETTE_ACCENT[rec.palette] ?? '#3c4364';
          // Palette-tinted glow behind the large sprite
          const rg = ctx.createRadialGradient(664, 294, 12, 664, 294, 88);
          rg.addColorStop(0, raccent + '44'); rg.addColorStop(1, 'transparent');
          ctx.fillStyle = rg; ctx.fillRect(576, 206, 176, 176);
          sprite(app, `hunter${rec.spriteId}.${rec.palette}.${rframe}`, 520, 230 + rbob, 8);
          const d = displayStats(rec.internal, rec.level);
          const lines = [
            `Level ${rec.level}`,
            `Story: mission ${Math.min(15, rec.storyProgress + 1)}`,
            `MV +${d.mv}   AT ${d.at}   DF ${d.df}`,
            `Max HP ${rec.maxHp}${rec.maxHp < baseMaxHp(rec) ? ` (base ${baseMaxHp(rec)})` : ''}`,
            `Credits ${rec.credits}`,
            `Missions ${rec.record.missions}   Wins ${rec.record.wins}`,
            `Items: ${rec.items.length}/6`,
          ];
          const lineColors = [FG, OK, FG, rec.maxHp < baseMaxHp(rec) ? BAD : '#3aa84a', null, FG, FG];
          lines.forEach((s, i) => {
            const ly = 226 + i * 26;
            if (i === 2) {
              const rSegs = [
                { t: `MV +${d.mv}`, c: '#3a6ee0' },
                { t: `   AT ${d.at}`, c: '#cc4a3a' },
                { t: `   DF ${d.df}`, c: '#e0c63a' },
              ];
              ctx.font = font(15, true);
              ctx.textAlign = 'left'; ctx.textBaseline = 'top';
              let sx = 680;
              for (const seg of rSegs) {
                ctx.fillStyle = '#000'; ctx.fillText(seg.t, sx + 2, ly + 2);
                ctx.fillStyle = seg.c; ctx.fillText(seg.t, sx, ly);
                sx += Math.round(ctx.measureText(seg.t).width);
              }
            } else if (i === 4) {
              ctx.save(); ctx.shadowBlur = 4; ctx.shadowColor = '#906000';
              text(ctx, s, 680, ly, { size: 15, color: GOLD, shadow: false });
              ctx.restore();
            } else if (i === 5) {
              // "Missions N   Wins N" — wins count in green
              ctx.font = font(15, true); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
              const mSegs = [
                { t: `Missions ${rec.record.missions}`, c: FG },
                { t: `   Wins `, c: DIM },
                { t: String(rec.record.wins), c: rec.record.wins > 0 ? OK : DIM },
              ];
              let mx = 680;
              for (const seg of mSegs) {
                ctx.fillStyle = seg.c; ctx.fillText(seg.t, mx, ly);
                mx += Math.round(ctx.measureText(seg.t).width);
              }
            } else if (i === 6) {
              const ic = rec.items.length === 6 ? '#d8cc88' : rec.items.length === 0 ? DIM : FG;
              text(ctx, s, 680, ly, { size: 15, color: ic });
            } else {
              text(ctx, s, 680, ly, { size: 15, color: lineColors[i] ?? FG });
            }
          });
          drawItemList(ctx, rec.items, 520, 372, rt);
        }
      }
      if (!app.roster.hunters.length) {
        text(ctx, 'No hunters registered yet - create one!', 500, 120, { size: 16, color: FG });
        text(ctx, 'Always open via run.bat / run.sh so saves persist.', 500, 146, { size: 12, color: GOLD });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CREATION — 11-point internal allocation (§2.1), live derived stats, name
// entry (<= 7 chars), sprite/palette picker.

export function makeCreationScreen(app) {
  const POOL = 11;
  const QUICK_NAMES = ['ACE', 'VALE', 'DRAY', 'KESS', 'ROOK', 'YUNA', 'BRIX', 'NOVA'];
  const state = {
    name: '',
    spriteId: 0,
    palette: 0,
    internal: { mv: 1, at: 1, df: 1, hp: 1 },
    row: 0,
    t: 0,
  };
  const ROWS = ['name', 'sprite', 'palette', 'mv', 'at', 'df', 'hp', 'done'];
  const spent = () => state.internal.mv + state.internal.at + state.internal.df + state.internal.hp - 4;
  const left = () => POOL - spent();
  const canDone = () => state.name.trim().length > 0 && left() === 0;

  function adjust(dir) {
    const row = ROWS[state.row];
    if (row === 'sprite') {
      state.spriteId = (state.spriteId + dir + HUNTER_SPRITES.length) % HUNTER_SPRITES.length;
      sfx.menuMove();
    } else if (row === 'palette') {
      state.palette = (state.palette + dir + PALETTE_NAMES.length) % PALETTE_NAMES.length;
      sfx.menuMove();
    } else if (['mv', 'at', 'df', 'hp'].includes(row)) {
      if (dir > 0 && left() > 0) { state.internal[row]++; sfx.menuMove(); }
      else if (dir < 0 && state.internal[row] > 1) { state.internal[row]--; sfx.menuMove(); }
      else sfx.error();
    }
  }

  function done() {
    if (!canDone()) { sfx.error(); return; }
    const rec = makeHunterRecord({
      name: state.name.trim().toUpperCase(),
      spriteId: state.spriteId,
      palette: PALETTE_NAMES[state.palette],
      internal: state.internal,
    });
    app.roster.hunters.push(rec);
    app.session.hunterId = rec.id;
    app.save();
    sfx.menuConfirm();
    app.stack.pop();
  }

  function quickStart() {
    const nameIdx = app.roster.hunters.length % QUICK_NAMES.length;
    const pal = PALETTE_NAMES[Math.floor(Math.random() * PALETTE_NAMES.length)];
    const sprite = Math.floor(Math.random() * HUNTER_SPRITES.length);
    const rec = makeHunterRecord({
      name: QUICK_NAMES[nameIdx],
      spriteId: sprite,
      palette: pal,
      internal: { mv: 4, at: 4, df: 3, hp: 4 }, // balanced: 11 pts above base-1 each
    });
    app.roster.hunters.push(rec);
    app.session.hunterId = rec.id;
    app.save();
    sfx.menuConfirm();
    app.stack.pop();
  }

  return {
    update(dt) { state.t += dt; },
    onKey(k, e) {
      // name typing first (letters would otherwise hit WASD navigation)
      if (ROWS[state.row] === 'name' && e) {
        if (e.key === 'Backspace') { state.name = state.name.slice(0, -1); sfx.menuMove(); return; }
        if (/^[A-Za-z0-9\-'!.]$/.test(e.key) && state.name.length < 7) {
          state.name += e.key.toUpperCase();
          sfx.menuMove();
          return;
        }
      }
      if (k === 'up') { state.row = (state.row + ROWS.length - 1) % ROWS.length; sfx.menuMove(); }
      else if (k === 'down') { state.row = (state.row + 1) % ROWS.length; sfx.menuMove(); }
      else if (k === 'left') adjust(-1);
      else if (k === 'right') adjust(1);
      else if (k === 'confirm') {
        if (ROWS[state.row] === 'done') done();
        else { state.row = (state.row + 1) % ROWS.length; sfx.menuMove(); }
      } else if (k === 'cancel') { sfx.menuCancel(); app.stack.pop(); }
      else if (e?.code === 'KeyQ' && ROWS[state.row] !== 'name') quickStart();
    },
    onClick(pos) {
      if (inRect(pos, { x: 600, y: 460, w: 280, h: 36 })) { quickStart(); return; }
      // Single tap focuses + acts (touch-friendly): 'done' runs, stat rows adjust
      // by the tapped half; the 'name' row just focuses (typed via keyboard).
      for (let i = 0; i < ROWS.length; i++) {
        const r = { x: 60, y: 120 + i * 56 - 4, w: 480, h: 52 };
        if (inRect(pos, r)) {
          state.row = i;
          if (ROWS[i] === 'done') done();
          else if (ROWS[i] !== 'name') adjust(pos.x > r.x + r.w / 2 ? 1 : -1);
          else sfx.menuMove();
          return;
        }
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      drawGoldBloom(ctx, app.W / 2);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#b07a08';
      text(ctx, 'REGISTER HUNTER', app.W / 2, 26, { size: 32, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      const d = displayStats(state.internal, 1);
      const labels = {
        name: ['Name', state.name + (ROWS[state.row] === 'name' && Math.floor(state.t * 2) % 2 ? '_' : '')],
        sprite: ['Design', `< ${state.spriteId + 1} / ${HUNTER_SPRITES.length} >`],
        palette: ['Colors', `< ${PALETTE_NAMES[state.palette]} >`],
        mv: ['MV pts', `< ${state.internal.mv} >   move +${d.mv}`],
        at: ['AT pts', `< ${state.internal.at} >   attack ${d.at}`],
        df: ['DF pts', `< ${state.internal.df} >   defense ${d.df}`],
        hp: ['HP pts', `< ${state.internal.hp} >   max HP ${d.maxHp}`],
        done: ['', canDone() ? 'BEGIN CAREER' : `allocate ${left()} more pt${left() === 1 ? '' : 's'}${state.name ? '' : ' + name'}`],
      };
      const STAT_RGB = { mv: [58,110,224], at: [204,74,58], df: [224,198,58], hp: [58,168,74] };
      const STAT_HEX = { mv: '#3a6ee0', at: '#cc4a3a', df: '#e0c63a', hp: '#3aa84a' };
      ROWS.forEach((row, i) => {
        const y = 120 + i * 56;
        const sel = state.row === i;
        if (sel) {
          const palHex = row === 'palette' ? (PALETTE_ACCENT[PALETTE_NAMES[state.palette]] ?? '#4a64d1') : null;
          const palRgb = palHex ? [parseInt(palHex.slice(1,3),16), parseInt(palHex.slice(3,5),16), parseInt(palHex.slice(5,7),16)] : null;
          const rgb = palRgb ?? STAT_RGB[row] ?? [80, 100, 220];
          const [ri, gi, bi] = rgb;
          const sg = ctx.createLinearGradient(56, 0, 56 + 488, 0);
          sg.addColorStop(0, `rgba(${ri},${gi},${bi},0.42)`); sg.addColorStop(1, `rgba(${ri},${gi},${bi},0.10)`);
          ctx.fillStyle = sg; ctx.fillRect(56, y - 8, 488, 48);
          ctx.fillStyle = `rgba(${Math.min(255,ri+50)},${Math.min(255,gi+55)},${Math.min(255,bi+40)},0.72)`;
          ctx.fillRect(56, y - 8, 2, 48);
          const shX = 56 + ((state.t % 2.4) / 2.4) * (488 + 40) - 20;
          const sh = ctx.createLinearGradient(shX - 16, 0, shX + 16, 0);
          sh.addColorStop(0, 'transparent');
          sh.addColorStop(0.5, `rgba(${Math.min(255,ri+120)},${Math.min(255,gi+110)},${Math.min(255,bi+100)},0.22)`);
          sh.addColorStop(1, 'transparent');
          ctx.save(); ctx.beginPath(); ctx.rect(56, y - 8, 488, 48); ctx.clip();
          ctx.fillStyle = sh; ctx.fillRect(shX - 16, y - 8, 32, 48); ctx.restore();
        }
        const [lab, val] = labels[row];
        if (lab) text(ctx, lab, 70, y, { size: 18, color: sel ? '#fff' : DIM });
        if (row === 'done' && canDone()) {
          // Pulsing green glow behind "BEGIN CAREER" when ready
          const dp = 0.10 + 0.08 * Math.sin(state.t * 2.8);
          ctx.save(); ctx.globalAlpha = dp * 2.5; ctx.fillStyle = OK;
          ctx.fillRect(56, y - 8, 488, 48); ctx.restore();
          ctx.save(); ctx.shadowBlur = 12; ctx.shadowColor = OK;
          text(ctx, val, 220, y, { size: 18, color: OK, shadow: false });
          ctx.restore();
        } else {
          const sc = sel ? STAT_HEX[row] : null;
          const palAcc = row === 'palette' ? (PALETTE_ACCENT[PALETTE_NAMES[state.palette]] ?? FG) : null;
          text(ctx, val, 220, y, { size: 18, color: row === 'done' ? BAD : palAcc ?? sc ?? FG });
        }
      });
      { const ptc = left() ? GOLD : OK;
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = left() ? '#b07a08' : OK;
        text(ctx, `Points left: ${left()} / ${POOL}`, 70, 80, { size: 18, color: ptc, shadow: false });
        ctx.restore(); }
      // live preview
      const pal = PALETTE_NAMES[state.palette];
      const frame = Math.floor(state.t * 3) % 2 ? 'step' : 'idle';
      const prevAccent = PALETTE_ACCENT[pal] ?? '#3c4364';
      box(ctx, 600, 100, 300, 420, { title: 'PREVIEW', stroke: prevAccent });
      // palette-colored inner glow behind the preview sprite
      const pglow = ctx.createRadialGradient(750, 265, 15, 750, 265, 115);
      pglow.addColorStop(0, prevAccent + '30');
      pglow.addColorStop(1, 'transparent');
      ctx.fillStyle = pglow;
      ctx.fillRect(610, 110, 280, 400);
      // orbiting preview motes — 10 palette+gold sparkles behind the sprite
      const pcx = 748, pcy = 240;
      for (let i = 0; i < 10; i++) {
        const freq = 0.32 + (i % 5) * 0.06;
        const a = (i / 10) * Math.PI * 2 + state.t * freq;
        const rx = 54 + Math.sin(state.t * 0.17 + i * 0.8) * 14;
        const ry = 32 + Math.cos(state.t * 0.13 + i * 1.1) * 8;
        const mx = pcx + Math.cos(a) * rx;
        const my = pcy + Math.sin(a) * ry;
        const ma = 0.18 + 0.20 * Math.sin(state.t * 1.8 + i * 1.4);
        ctx.save();
        ctx.globalAlpha = Math.max(0, ma);
        ctx.fillStyle = (i % 3 === 0) ? GOLD : prevAccent;
        const ms = (i & 1) ? 2 : 3;
        ctx.fillRect((mx - ms * 0.25) | 0, (my - ms) | 0, Math.max(1, ms * 0.5) | 0, ms * 2);
        ctx.fillRect((mx - ms) | 0, (my - ms * 0.25) | 0, ms * 2, Math.max(1, ms * 0.5) | 0);
        ctx.restore();
      }
      sprite(app, `hunter${state.spriteId}.${pal}.${frame}`, 660, 150, 11);
      ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = '#b07a08';
      text(ctx, state.name || '-------', 750, 350, { size: 22, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      { const cSegs = [
          { t: `MV+${d.mv}`, c: '#3a6ee0' },
          { t: `  AT ${d.at}`, c: '#cc4a3a' },
          { t: `  DF ${d.df}`, c: '#e0c63a' },
          { t: `  HP ${d.maxHp}`, c: '#3aa84a' },
        ];
        ctx.font = font(14, true);
        let cw = 0; for (const seg of cSegs) cw += Math.round(ctx.measureText(seg.t).width);
        let csx = 750 - cw / 2;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        for (const seg of cSegs) {
          const sw = Math.round(ctx.measureText(seg.t).width);
          ctx.fillStyle = '#000'; ctx.fillText(seg.t, csx + 2, 387);
          ctx.fillStyle = seg.c; ctx.fillText(seg.t, csx, 385);
          csx += sw;
        } }
      { const dSegs = [
          { t: 'displayed: ' }, { t: `MV ${d.mv}`, c: '#3a6ee0' }, { t: '  ' },
          { t: `DF ${d.df}`, c: '#e0c63a' }, { t: '  ' }, { t: `HP ${d.maxHp}`, c: '#3aa84a' },
        ];
        ctx.font = font(12); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        let dtw = 0; for (const s of dSegs) dtw += ctx.measureText(s.t).width;
        let dcx = 750 - dtw / 2;
        for (const s of dSegs) { ctx.fillStyle = s.c ?? DIM; ctx.fillText(s.t, dcx, 420); dcx += ctx.measureText(s.t).width; }
      }
      // Quick Start button (below preview box)
      { const qbx = 600, qby = 460, qbw = 280, qbh = 36;
        const qpulse = 0.06 + 0.04 * Math.sin(state.t * 2.0);
        ctx.save(); ctx.globalAlpha = qpulse * 3; ctx.fillStyle = '#3a6ee0';
        ctx.fillRect(qbx, qby, qbw, qbh); ctx.restore();
        box(ctx, qbx, qby, qbw, qbh, { stroke: '#3a6ee0' });
        text(ctx, '[ Q ] QUICK START (balanced build)', qbx + qbw / 2, qby + 12, { size: 12, align: 'center', color: '#7eaaff' }); }
      text(ctx, 'type to name - arrows to adjust - Enter on BEGIN', app.W / 2, 680, { size: 13, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// HUB — icon row: Office / Client / Hospital / Options (§2.13).

export function makeHubScreen(app) {
  const ICONS = [
    { id: 'office', label: 'OFFICE', icon: 'icon.flag', info: 'Register, inspect or erase hunters. Pick the active hunter.' },
    { id: 'client', label: 'CLIENT', icon: 'icon.bag', info: 'Accept missions, sell finds (haggle if you dare), appraise unknowns.' },
    { id: 'hospital', label: 'HOSPITAL', icon: 'icon.plus', info: 'Repair lost max HP and buy level-ups.' },
    { id: 'options', label: 'OPTIONS', icon: 'icon.move', info: 'Volumes and wallpapers.' },
  ];
  let idx = 0;
  let t = 0;
  const DIVE_BTN = { x: 120, y: 520, w: 200, h: 36 };
  const DAILY_BTN = { x: 340, y: 520, w: 200, h: 36 };
  const open = (id) => {
    sfx.menuConfirm();
    if (id === 'office') app.stack.push(makeRosterScreen(app, { manage: true }));
    else if (id === 'client') app.stack.push(makeClientScreen(app));
    else if (id === 'hospital') app.stack.push(makeHospitalScreen(app));
    else app.stack.push(makeOptionsScreen(app));
  };
  const openRelicDive = (daily) => {
    if (!currentHunter(app)) return;
    sfx.menuConfirm();
    app.stack.push(makeRelicDiveScreen(app, { daily }));
  };
  const openLeaderboard = () => { sfx.menuConfirm(); app.stack.push(makeLeaderboardScreen(app)); };
  const iconRect = (i) => ({ x: 120 + i * 190, y: 160, w: 150, h: 130 });
  return {
    tag: 'hub', // lets popToTag('hub') unwind back here from RESULTS/RunSummary (D20)
    enter() { app.music('hub'); },
    resume() { app.music('hub'); },
    update(dt) { t += dt; },
    onKey(k, e) {
      if (k === 'left') { idx = (idx + ICONS.length - 1) % ICONS.length; sfx.menuMove(); }
      else if (k === 'right') { idx = (idx + 1) % ICONS.length; sfx.menuMove(); }
      else if (k === 'confirm') open(ICONS[idx].id);
      else if (k === 'cancel') { sfx.menuCancel(); app.stack.pop(); } // back to title
      else if (e?.code === 'KeyD') openRelicDive(false);
      else if (e?.code === 'KeyH') openRelicDive(true);
      else if (e?.code === 'KeyL') openLeaderboard();
    },
    onClick(pos) {
      for (let i = 0; i < ICONS.length; i++) {
        if (inRect(pos, iconRect(i))) {
          idx = i; open(ICONS[i].id); // single tap focuses + opens (touch-friendly)
          return;
        }
      }
      if (inRect(pos, DIVE_BTN)) { openRelicDive(false); return; }
      if (inRect(pos, DAILY_BTN)) { openRelicDive(true); return; }
      if (inRect(pos, { x: 560, y: 520, w: 190, h: 36 })) { openLeaderboard(); return; }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      // Ambient drifting motes behind icons (gold, cobalt, orchid)
      { const MOTE_C = [GOLD, '#4a6dd1', '#8b3dc1', '#3aa9b8'];
        for (let i = 0; i < 10; i++) {
          const bx = ((i * 173 + 47) % 760) + 100;
          const by = ((i * 251 + 83) % 520) + 60;
          const sp = 0.038 + (i % 4) * 0.018;
          const mx = bx + Math.sin(t * sp + i * 1.3) * 20;
          const my = by + Math.cos(t * sp * 0.7 + i * 0.9) * 12;
          const ma = 0.07 + 0.06 * Math.sin(t * 0.9 + i * 1.1);
          ctx.save(); ctx.globalAlpha = Math.max(0, ma); ctx.fillStyle = MOTE_C[i % 4];
          const ms = i % 3 === 0 ? 2 : 1.5;
          ctx.fillRect((mx - ms * 0.3) | 0, (my - ms) | 0, Math.max(1, ms * 0.6) | 0, ms * 2);
          ctx.fillRect((mx - ms) | 0, (my - ms * 0.3) | 0, ms * 2, Math.max(1, ms * 0.6) | 0);
          ctx.restore();
        } }
      // Gold bloom behind hub header (breathing)
      const hcx = app.W / 2;
      const hbloomA = 0.30 + 0.04 * Math.sin(t * 0.85);
      const hbloom = ctx.createRadialGradient(hcx, 60, 8, hcx, 60, 130);
      hbloom.addColorStop(0, `rgba(200,160,30,${hbloomA.toFixed(3)})`);
      hbloom.addColorStop(1, 'transparent');
      ctx.fillStyle = hbloom;
      ctx.fillRect(hcx - 130, 10, 260, 100);
      ctx.save(); ctx.shadowBlur = 22; ctx.shadowColor = '#b07a08';
      text(ctx, 'GUILD HUB', app.W / 2, 40, { size: 40, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      ICONS.forEach((ic, i) => {
        const r = iconRect(i);
        const sel = i === idx;
        // pulsing gold glow behind selected icon
        if (sel) {
          const gpulse = 0.16 + 0.10 * Math.sin(t * 2.8);
          const gcx = r.x + r.w / 2, gcy = r.y + r.h / 2;
          ctx.save();
          ctx.globalAlpha = gpulse;
          const gr = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, 88);
          gr.addColorStop(0, GOLD);
          gr.addColorStop(1, 'transparent');
          ctx.fillStyle = gr;
          ctx.fillRect(r.x - 22, r.y - 22, r.w + 44, r.h + 44);
          ctx.restore();
        }
        box(ctx, r.x, r.y, r.w, r.h, { stroke: sel ? GOLD : '#3c4364', fill: sel ? 'rgba(40,44,80,0.95)' : 'rgba(10,12,24,0.92)' });
        // Shine sweep over selected box every 2.4s
        if (sel) {
          const shineX = r.x + ((t % 2.4) / 2.4) * (r.w + 60) - 30;
          const shine = ctx.createLinearGradient(shineX - 30, 0, shineX + 30, 0);
          shine.addColorStop(0, 'transparent');
          shine.addColorStop(0.5, 'rgba(255,240,160,0.18)');
          shine.addColorStop(1, 'transparent');
          ctx.save();
          ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
          ctx.fillStyle = shine; ctx.fillRect(shineX - 30, r.y, 60, r.h);
          ctx.restore(); ctx.restore();
        }
        sprite(app, ic.icon, r.x + r.w / 2 - 30, r.y + 16 + (sel ? Math.sin(t * 5) * 3 : 0), 5);
        if (sel) {
          ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#b07a08';
          text(ctx, ic.label, r.x + r.w / 2, r.y + 96, { size: 16, align: 'center', color: GOLD, shadow: false });
          ctx.restore();
        } else {
          text(ctx, ic.label, r.x + r.w / 2, r.y + 96, { size: 16, align: 'center', color: FG });
        }
      });
      const INFO_ACCENT = { office: '#c07800', client: '#c09010', hospital: '#3aa84a', options: '#3a6ee0' };
      const infoAccent = INFO_ACCENT[ICONS[idx].id] ?? '#3c4364';
      box(ctx, 120, 320, 720, 60, { stroke: infoAccent + '88' });
      { const ia = 0.08 + 0.04 * Math.sin(t * 1.1);
        const ig = ctx.createLinearGradient(120, 320, 120 + 180, 320);
        ig.addColorStop(0, infoAccent + '30'); ig.addColorStop(1, 'transparent');
        ctx.save(); ctx.globalAlpha = ia * 2; ctx.fillStyle = ig;
        ctx.fillRect(122, 322, 716, 56); ctx.restore(); }
      text(ctx, ICONS[idx].info, 140, 340, { size: 15, color: FG });
      const rec = currentHunter(app);
      if (rec) {
        drawHunterCard(app, rec, 120, 410, 480);
        if (app.session.mode === 'story') {
          const prog = rec.storyProgress ?? 0;
          const complete = prog >= 15;
          const barCol = complete ? GOLD : OK;
          const barW = 480, barH = 10, barX = 120, barY = 502;
          // Background track
          ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = barCol;
          ctx.fillRect(barX, barY, barW, barH); ctx.restore();
          // Filled portion
          const fillW = Math.round(barW * Math.min(prog, 15) / 15);
          if (fillW > 0) {
            const bg = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
            if (complete) {
              bg.addColorStop(0, '#a06800'); bg.addColorStop(1, GOLD);
            } else {
              bg.addColorStop(0, '#1e7a40'); bg.addColorStop(1, OK);
            }
            ctx.save(); ctx.shadowBlur = complete ? 10 : 6; ctx.shadowColor = barCol;
            ctx.fillStyle = bg; ctx.fillRect(barX, barY, fillW, barH); ctx.restore();
            // Shine on bar
            ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
            ctx.fillRect(barX, barY, fillW, Math.ceil(barH / 2)); ctx.restore();
          }
          // Segment ticks (every mission)
          ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = '#06060c';
          for (let mi = 1; mi < 15; mi++) ctx.fillRect(barX + Math.round(barW * mi / 15), barY, 1, barH);
          ctx.restore();
          // Label
          const nextLabel = complete ? 'STORY COMPLETE!' : `Mission ${prog + 1} of 15`;
          if (complete) {
            const cpulse = 0.75 + 0.25 * Math.sin(t * 2.0);
            ctx.save(); ctx.globalAlpha = cpulse; ctx.shadowBlur = 14; ctx.shadowColor = GOLD;
            text(ctx, `STORY  ${nextLabel}`, barX, barY + 14, { size: 13, color: GOLD, shadow: false });
            ctx.restore();
          } else {
            ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = OK;
            text(ctx, `STORY  ${nextLabel}`, barX, barY + 14, { size: 13, color: OK, shadow: false });
            ctx.restore();
          }
        } else {
          ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = OK;
          text(ctx, 'NORMAL free-play', 120, 505, { size: 13, color: OK, shadow: false });
          ctx.restore();
          // Relic Dive + Daily Hunt entry buttons
          const diveBest = loadRelicDiveBest();
          const todayKey = todayDateKey();
          const dailyPlayed = diveBest.daily?.dateKey === todayKey;
          for (const [btn, label, daily] of [[DIVE_BTN, '[ D ] RELIC DIVE', false], [DAILY_BTN, '[ H ] DAILY HUNT', true]]) {
            const isDailyDisabled = daily && dailyPlayed;
            const col = isDailyDisabled ? DIM : (daily ? '#3aacc8' : '#9060d8');
            box(ctx, btn.x, btn.y, btn.w, btn.h, { stroke: isDailyDisabled ? '#2a2a3c' : col + '88' });
            if (!isDailyDisabled) {
              ctx.save(); ctx.globalAlpha = 0.09 + 0.05 * Math.sin(t * 1.8);
              ctx.fillStyle = col; ctx.fillRect(btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2);
              ctx.restore();
            }
            text(ctx, label + (isDailyDisabled ? ' (played)' : ''), btn.x + btn.w / 2, btn.y + 13, { size: 13, align: 'center', color: col });
          }
          // New-player callout: pulsing hint above DAILY HUNT for hunters with no missions yet
          if ((rec.record?.missions ?? 0) === 0 && !dailyPlayed) {
            const nhPulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.4));
            ctx.save();
            ctx.globalAlpha = nhPulse;
            ctx.shadowBlur = 10; ctx.shadowColor = '#3aacc8';
            text(ctx, '→ TRY THIS FIRST ←', DAILY_BTN.x + DAILY_BTN.w / 2, DAILY_BTN.y - 14,
              { size: 11, align: 'center', color: '#3aacc8', shadow: false });
            ctx.restore();
          }
          if (diveBest.best) {
            text(ctx, `Best: ${diveBest.best.score} pts  Depth ${diveBest.best.depths}  Streak ${diveBest.streak}`,
              120, 568, { size: 12, color: DIM });
          }
          // Leaderboard button
          { const LB = { x: 560, y: 520, w: 190, h: 36 };
            box(ctx, LB.x, LB.y, LB.w, LB.h, { stroke: '#3c4364' });
            text(ctx, '[ L ] PERSONAL BEST', LB.x + LB.w / 2, LB.y + 13, { size: 12, align: 'center', color: DIM }); }
        }
        drawItemList(ctx, rec.items, 640, 412, t);
      } else {
        // First-play welcome — pulsing arrow points at OFFICE icon
        const nhPulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.0));
        ctx.save(); ctx.globalAlpha = nhPulse; ctx.shadowBlur = 12; ctx.shadowColor = OK;
        text(ctx, 'New here?  Visit the OFFICE to register your first hunter!',
          app.W / 2, 430, { size: 16, align: 'center', color: OK, shadow: false });
        ctx.restore();
        // Arrow up toward OFFICE icon
        const officeR = iconRect(0);
        const ax = officeR.x + officeR.w / 2, ay = officeR.y + officeR.h + 8;
        ctx.save(); ctx.globalAlpha = nhPulse * 0.85; ctx.fillStyle = OK;
        ctx.beginPath(); ctx.moveTo(ax, ay - 8); ctx.lineTo(ax - 6, ay + 4); ctx.lineTo(ax + 6, ay + 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      text(ctx, 'Esc: back to title   L: personal best', app.W / 2, 680, { size: 13, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// RELIC DIVE — entry screen (mode select + best/daily info) for Phase 1 run mode.

export function makeRelicDiveScreen(app, opts = {}) {
  const daily = !!opts.daily;
  let best = loadRelicDiveBest();
  const todayKey = todayDateKey();
  const dailyAlreadyPlayed = best.daily?.dateKey === todayKey;

  // If requested daily but already played today, fall back to normal dive
  const mode = (daily && dailyAlreadyPlayed) ? 'dive' : (daily ? 'daily' : 'dive');
  let t = 0;
  const MODS = allModifiers();
  let modIdx = 0; // focused modifier row
  const selected = new Set(); // ids of active modifiers (normal dive only)
  // Daily: deterministic modifier rolled from the date seed
  const dailyModId = mode === 'daily' ? rollDailyModifier(makeRng(dateToSeed(todayKey))) : null;

  function startRun() {
    const rec = currentHunter(app);
    if (!rec) return;
    if (mode === 'daily' && dailyAlreadyPlayed) return;
    const rootSeed = mode === 'daily'
      ? dateToSeed(todayKey)
      : ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    const activeModIds = mode === 'daily'
      ? (dailyModId ? [dailyModId] : [])
      : [...selected];
    const runState = {
      rootSeed,
      depth: 1,
      startRelicLevel: Math.max(1, Math.min(15, rec.level)),
      daily: mode === 'daily',
      dateKey: mode === 'daily' ? todayKey : null,
      depthResults: [],
      modifiers: activeModIds,
      hunterId: rec.id,
    };
    // Track daily streak: increment only when starting a new daily
    if (mode === 'daily') {
      best = loadRelicDiveBest();
      const yesterday = (() => {
        const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      })();
      const streakYesterday = best.daily?.dateKey === yesterday;
      best.streak = streakYesterday ? (best.streak ?? 0) + 1 : 1;
      saveRelicDiveBest(best);
    }
    app.session.mode = 'relic-dive';
    app.startRelicDiveDepth(runState);
  }

  return {
    enter() { app.music('hub'); },
    update(dt) { t += dt; },
    onKey(k) {
      // modIdx 0..MODS.length-1 = modifier rows; MODS.length = START button
      const NAV_LEN = mode === 'dive' ? MODS.length + 1 : 1;
      if (k === 'up') { modIdx = (modIdx + NAV_LEN - 1) % NAV_LEN; sfx.menuMove(); }
      else if (k === 'down') { modIdx = (modIdx + 1) % NAV_LEN; sfx.menuMove(); }
      else if (k === 'confirm') {
        if (mode !== 'dive' || modIdx === MODS.length) startRun();
        else {
          const id = MODS[modIdx]?.id;
          if (id) { selected.has(id) ? selected.delete(id) : selected.add(id); sfx.menuConfirm(); }
        }
      } else if (k === 'cancel') { sfx.menuCancel(); app.stack.pop(); }
    },
    onClick(pos) {
      const MOD_TOP = 312, MOD_H = 44;
      const rowIdx = Math.floor((pos.y - MOD_TOP) / MOD_H);
      if (rowIdx >= 0 && rowIdx < MODS.length && mode === 'dive') {
        modIdx = rowIdx;
        const id = MODS[rowIdx]?.id;
        if (id) { selected.has(id) ? selected.delete(id) : selected.add(id); sfx.menuConfirm(); }
      } else if (pos.y > 610 && pos.y < 655) startRun();
      else if (pos.y > 675) { sfx.menuCancel(); app.stack.pop(); }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      const cx = app.W / 2;
      // Header bloom
      const bloom = ctx.createRadialGradient(cx, 50, 8, cx, 50, 160);
      bloom.addColorStop(0, `rgba(90,30,160,${(0.3 + 0.07 * Math.sin(t * 0.9)).toFixed(3)})`);
      bloom.addColorStop(1, 'transparent');
      ctx.fillStyle = bloom; ctx.fillRect(cx - 160, 0, 320, 140);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#7030c0';
      text(ctx, 'RELIC DIVE', cx, 40, { size: 38, align: 'center', color: '#c090ff', shadow: false });
      ctx.restore();

      // Mode
      const modeLabel = mode === 'daily' ? `DAILY HUNT — ${todayKey}` : 'NORMAL DIVE';
      const modeColor = mode === 'daily' ? '#3aacc8' : '#9060d8';
      ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = modeColor;
      text(ctx, modeLabel, cx, 90, { size: 18, align: 'center', color: modeColor, shadow: false });
      ctx.restore();

      // Separator
      ctx.save(); ctx.fillStyle = '#3c3464'; ctx.globalAlpha = 0.7;
      ctx.fillRect(120, 112, app.W - 240, 1); ctx.restore();

      // Best / streak info
      const freshBest = loadRelicDiveBest();
      if (freshBest.best) {
        text(ctx, `Personal Best: ${freshBest.best.score} pts — Depth ${freshBest.best.depths}`,
          cx, 140, { size: 15, align: 'center', color: GOLD });
        text(ctx, `Daily Streak: ${freshBest.streak ?? 0} day${freshBest.streak !== 1 ? 's' : ''}`,
          cx, 162, { size: 13, align: 'center', color: DIM });
      } else {
        text(ctx, 'No personal best yet — be the first!', cx, 140, { size: 15, align: 'center', color: DIM });
      }

      // Daily status
      if (freshBest.daily) {
        const sameDay = freshBest.daily.dateKey === todayKey;
        if (sameDay) {
          text(ctx, `Today's run: ${freshBest.daily.score} pts — Depth ${freshBest.daily.depths}`,
            cx, 190, { size: 14, align: 'center', color: '#3aacc8' });
          if (mode === 'daily') {
            text(ctx, 'Daily Hunt already played today. Switch to NORMAL DIVE.',
              cx, 212, { size: 12, align: 'center', color: BAD });
          }
        } else {
          text(ctx, 'Daily Hunt available!', cx, 190, { size: 14, align: 'center', color: OK });
        }
      }

      // Separator
      ctx.save(); ctx.fillStyle = '#3c3464'; ctx.globalAlpha = 0.7;
      ctx.fillRect(120, 230, app.W - 240, 1); ctx.restore();

      // Dive info
      const rec = currentHunter(app);
      if (rec) {
        text(ctx, `Hunter: ${rec.name}  (Lv${rec.level})`, cx, 258, { size: 15, align: 'center', color: FG });
        const startLv = Math.max(1, Math.min(15, rec.level));
        text(ctx, `Starting Relic Level ${startLv}  →  rises each depth  →  cap Lv15`,
          cx, 278, { size: 12, align: 'center', color: DIM });
      }

      // Modifiers
      const MOD_TOP = 300, MOD_H = 44, MOD_L = 100, MOD_W = app.W - 200;
      if (mode === 'dive') {
        text(ctx, 'CHALLENGE MODIFIERS  (score ×)', MOD_L, MOD_TOP - 2, { size: 11, color: DIM });
        for (let i = 0; i < MODS.length; i++) {
          const m = MODS[i];
          const ry = MOD_TOP + 12 + i * MOD_H;
          const isOn = selected.has(m.id);
          const focused = i === modIdx;
          if (focused) {
            ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#9060d8';
            ctx.fillRect(MOD_L - 2, ry - 2, MOD_W + 4, MOD_H - 4); ctx.restore();
          }
          ctx.save(); ctx.globalAlpha = 0.6;
          ctx.strokeStyle = isOn ? '#3aa84a' : (focused ? '#9060d8' : '#3c3464');
          ctx.lineWidth = 1; ctx.strokeRect(MOD_L, ry, MOD_W, MOD_H - 6); ctx.restore();
          if (isOn) {
            ctx.save(); ctx.fillStyle = '#3aa84a'; ctx.globalAlpha = 0.15;
            ctx.fillRect(MOD_L + 1, ry + 1, MOD_W - 2, MOD_H - 8); ctx.restore();
          }
          const dot = isOn ? '●' : '○';
          text(ctx, dot, MOD_L + 14, ry + 14, { size: 14, color: isOn ? '#3aa84a' : DIM });
          text(ctx, m.name, MOD_L + 28, ry + 14, { size: 13, color: isOn ? '#7ee8a0' : FG });
          text(ctx, `×${m.score.toFixed(2)}`, MOD_L + MOD_W - 8, ry + 14, { size: 12, color: isOn ? GOLD : DIM, align: 'right' });
          text(ctx, m.desc, MOD_L + 28, ry + 30, { size: 10, color: DIM });
        }
        const mult = scoreMultiplier([...selected]);
        const multStr = selected.size ? `Score multiplier: ×${mult.toFixed(2)}` : 'No modifiers — standard run';
        text(ctx, multStr, cx, MOD_TOP + 14 + MODS.length * MOD_H, { size: 12, align: 'center', color: selected.size ? GOLD : DIM });
      } else {
        // Daily: show the locked modifier
        text(ctx, 'TODAY\'S MODIFIER', MOD_L, MOD_TOP - 2, { size: 11, color: DIM });
        const dm = MODS.find((m) => m.id === dailyModId);
        if (dm) {
          const ry = MOD_TOP + 12;
          ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = '#3aacc8';
          ctx.fillRect(MOD_L, ry, MOD_W, MOD_H - 6); ctx.restore();
          ctx.save(); ctx.globalAlpha = 0.6; ctx.strokeStyle = '#3aacc8'; ctx.lineWidth = 1;
          ctx.strokeRect(MOD_L, ry, MOD_W, MOD_H - 6); ctx.restore();
          text(ctx, dm.name, MOD_L + 16, ry + 14, { size: 13, color: '#7ee8ff' });
          text(ctx, `×${dm.score.toFixed(2)}`, MOD_L + MOD_W - 8, ry + 14, { size: 12, color: GOLD, align: 'right' });
          text(ctx, dm.desc, MOD_L + 16, ry + 30, { size: 10, color: DIM });
        }
      }

      // Start / Cancel buttons
      const startDisabled = !rec || (mode === 'daily' && dailyAlreadyPlayed);
      const btnY = 610;
      const startFocused = mode === 'dive' ? modIdx === MODS.length : true;
      const btnPulse = startFocused && !startDisabled ? 0.16 + 0.07 * Math.sin(t * 2.2) : 0.10;
      box(ctx, cx - 140, btnY, 260, 40, { stroke: startDisabled ? '#2a2a3c' : (startFocused ? '#c090ff' : '#9060d8') });
      if (!startDisabled) {
        ctx.save(); ctx.globalAlpha = btnPulse; ctx.fillStyle = '#9060d8';
        ctx.fillRect(cx - 139, btnY + 1, 258, 38); ctx.restore();
      }
      text(ctx, startDisabled ? 'ALREADY PLAYED TODAY' : 'START DIVE', cx, btnY + 14, { size: 16, align: 'center', color: startDisabled ? DIM : (startFocused ? '#ffffff' : '#c090ff') });

      text(ctx, mode === 'dive' ? '↑↓ navigate   Enter: toggle / start' : 'Enter: start',
        cx, 660, { size: 11, align: 'center', color: DIM });
      text(ctx, 'Esc: back', cx, 677, { size: 11, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// CLIENT — mission select, sell with haggle, appraise (§2.13).

export function makeClientScreen(app) {
  const host = makeMenuHost();
  let note = '';
  let t = 0;

  function rootMenu() {
    const rec = currentHunter(app);
    return makeMenu([
      { label: 'Accept a mission', value: 'mission', color: '#4a7dff', disabled: !rec },
      { label: 'Sell items', value: 'sell', color: GOLD, disabled: !rec || !rec.items.some((s) => s.identified) },
      { label: 'Appraise items', value: 'appraise', color: '#3aacc8', disabled: !rec || !rec.items.some((s) => !s.identified) },
      { label: 'Back', value: 'back' },
    ], {
      title: 'CLIENT',
      onPick(v) {
        if (v === 'back') { app.stack.pop(); return; }
        if (v === 'mission') host.push(missionMenu());
        else if (v === 'sell') host.push(sellMenu());
        else host.push(appraiseMenu());
      },
      onCancel() { app.stack.pop(); },
    });
  }

  function missionMenu() {
    const rec = currentHunter(app);
    if (app.session.mode === 'story') {
      const unlockedTo = Math.min(15, rec.storyProgress + 1);
      const TYPE_COL = { fetch: GOLD, rescue: OK, resteal: BAD };
      const items = STORY_MISSIONS.map((m) => {
        const cleared = m.id <= (rec.storyProgress ?? 0);
        const locked = m.id > unlockedTo;
        return {
          label: `M${String(m.id).padStart(2)} ${m.title}`,
          right: locked ? 'locked' : cleared ? `✓ Lv${m.level} ${m.type}` : `Lv${m.level} ${m.type}`,
          color: cleared ? OK : undefined,
          rightColor: locked ? undefined : (TYPE_COL[m.type] ?? DIM),
          value: m,
          disabled: locked,
        };
      });
      items.push({ label: 'Cancel', value: null });
      return makeMenu(items, {
        title: 'STORY MISSIONS',
        onPick(m) {
          if (!m) { host.pop(); return; }
          app.stack.push(makeMissionBriefingScreen(app, m));
        },
        onCancel() { host.pop(); },
      });
    }
    return partyMenu(rec);
  }

  // Normal-mode party-setup menu. `baseRec` is always P1 (current hunter).
  function partyMenu(baseRec) {
    const coopIds = [...(app.session.coopIds || [])];

    function currentParty() {
      return [baseRec, ...coopIds.map((id) => app.roster.hunters.find((h) => h.id === id)).filter(Boolean)];
    }

    function rebuildMenu() {
      host.pop();
      host.push(buildPartyMenu());
    }

    function buildPartyMenu() {
      const party = currentParty();
      const m = makeNormalMission(party);
      const items = party.map((h, i) => ({
        label: `P${i + 1}: ${h.name}`,
        right: i === 0 ? 'you' : 'remove',
        value: i === 0 ? null : { kind: 'remove', id: h.id },
        disabled: i === 0,
        color: SLOT_COLORS[i],
      }));
      const available = app.roster.hunters.filter((h) => !party.find((p) => p.id === h.id));
      if (party.length < 4 && available.length > 0) {
        items.push({ label: `+ Add P${party.length + 1}`, value: { kind: 'add' }, color: OK });
      }
      items.push({ label: 'Start', right: `relic Lv${m.level}`, rightColor: '#a898c8', value: { kind: 'start', mission: m }, color: OK });
      items.push({ label: 'Cancel', value: { kind: 'cancel' } });
      return makeMenu(items, {
        title: 'PARTY SETUP',
        footer: `${4 - party.length} CPU rival(s). Grab the Target, reach the EXIT.`,
        onPick(v) {
          if (!v || v.kind === 'cancel') { host.pop(); return; }
          if (v.kind === 'start') {
            app.session.coopIds = coopIds.slice();
            app.startMission(v.mission);
            return;
          }
          if (v.kind === 'remove') {
            const idx = coopIds.indexOf(v.id);
            if (idx !== -1) coopIds.splice(idx, 1);
            rebuildMenu();
            return;
          }
          if (v.kind === 'add') host.push(addHunterMenu());
        },
        onCancel() { host.pop(); },
      });
    }

    function addHunterMenu() {
      const party = currentParty();
      const available = app.roster.hunters.filter((h) => !party.find((p) => p.id === h.id));
      const items = available.map((h) => ({ label: h.name, right: `Lv${h.level}`, rightColor: GOLD, value: h.id }));
      items.push({ label: 'Cancel', value: null });
      return makeMenu(items, {
        title: `ADD P${party.length + 1}`,
        onPick(id) {
          if (id) {
            coopIds.push(id);
            host.pop(); // remove addHunterMenu
            rebuildMenu(); // refresh party menu
          } else {
            host.pop();
          }
        },
        onCancel() { host.pop(); },
      });
    }

    return buildPartyMenu();
  }

  function sellMenu() {
    const rec = currentHunter(app);
    const items = rec.items
      .map((slot, i) => ({ slot, i }))
      .filter(({ slot }) => slot.identified)
      .map(({ slot, i }) => ({
        label: ITEMS[slot.itemId]?.name ?? slot.itemId,
        right: `${sellPrice(slot.itemId, rec.level)}cr`,
        rightColor: GOLD,
        color: ITEM_CAT_COLOR[ITEMS[slot.itemId]?.category],
        value: i,
      }));
    items.push({ label: 'Done', value: null });
    return makeMenu(items, {
      title: 'SELL - pick an item',
      onPick(i) {
        if (i === null) { host.pop(); return; }
        host.push(haggleMenu(i));
      },
      onCancel() { host.pop(); },
    });
  }

  // Haggle (§2.13 defaults): 30% odds of +10%; failure forces sale at 50%.
  function haggleMenu(slotIndex) {
    const rec = currentHunter(app);
    const slot = rec.items[slotIndex];
    const base = sellPrice(slot.itemId, rec.level);
    const sellAt = (price, msg) => {
      rec.items.splice(slotIndex, 1);
      rec.credits += price;
      app.save();
      note = msg;
      sfx.menuConfirm();
      host.pop(); host.pop(); // haggle + stale sell list
      if (rec.items.some((s) => s.identified)) host.push(sellMenu());
    };
    return makeMenu([
      { label: `Sell for ${base}cr`, value: 'sell', color: GOLD },
      { label: 'Haggle (30%: +10% / fail: half)', value: 'haggle', color: '#e0c63a' },
      { label: 'Keep it', value: 'keep', color: DIM },
    ], {
      title: ITEMS[slot.itemId]?.name ?? slot.itemId,
      onPick(v) {
        if (v === 'keep') { host.pop(); return; }
        if (v === 'sell') sellAt(base, `Sold for ${base}cr.`);
        else if (Math.random() < 0.3) sellAt(Math.floor(base * 1.1), `Haggle won! Sold for ${Math.floor(base * 1.1)}cr.`);
        else sellAt(Math.floor(base * 0.5), `Haggle failed - forced sale at ${Math.floor(base * 0.5)}cr.`);
      },
      onCancel() { host.pop(); },
    });
  }

  function appraiseMenu() {
    const rec = currentHunter(app);
    const fee = 50 * rec.level; // §2.13: 50 x character level
    const items = rec.items
      .map((slot, i) => ({ slot, i }))
      .filter(({ slot }) => !slot.identified)
      .map(({ slot, i }) => ({ label: itemName(slot), right: `${fee}cr`, rightColor: GOLD, value: i, disabled: rec.credits < fee }));
    items.push({ label: 'Done', value: null });
    return makeMenu(items, {
      title: `APPRAISE - fee ${fee}cr each`,
      onPick(i) {
        if (i === null) { host.pop(); return; }
        rec.credits -= fee;
        rec.items[i].identified = true;
        app.save();
        note = `It's a ${ITEMS[rec.items[i].itemId]?.name ?? rec.items[i].itemId}!`;
        sfx.boxOpen();
        host.pop();
        host.push(rec.items.some((s) => !s.identified) ? appraiseMenu() : rootMenu());
      },
      onCancel() { host.pop(); },
    });
  }

  return {
    enter() { host.push(rootMenu()); },
    resume() { note = ''; host.clear(); host.push(rootMenu()); },
    update(dt) { t += dt; },
    onKey(k) { host.key(k); },
    onClick(pos) { host.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      // Ambient motes: gold and cobalt, contracts/value theme
      { const MOTE_C = [GOLD, '#4a6dd1', '#e8c050', '#8b6830'];
        for (let i = 0; i < 8; i++) {
          const bx = ((i * 173 + 47) % 660) + 100;
          const by = ((i * 251 + 83) % 480) + 80;
          const sp = 0.030 + (i % 4) * 0.015;
          const mx = bx + Math.sin(t * sp + i * 1.3) * 18;
          const my = by + Math.cos(t * sp * 0.7 + i * 0.9) * 10;
          const ma = 0.06 + 0.05 * Math.sin(t * 0.8 + i * 1.1);
          ctx.save(); ctx.globalAlpha = Math.max(0, ma); ctx.fillStyle = MOTE_C[i % 4];
          const ms = i % 3 === 0 ? 2 : 1.5;
          ctx.fillRect((mx - ms * 0.3) | 0, (my - ms) | 0, Math.max(1, ms * 0.6) | 0, ms * 2);
          ctx.fillRect((mx - ms) | 0, (my - ms * 0.3) | 0, ms * 2, Math.max(1, ms * 0.6) | 0);
          ctx.restore();
        } }
      drawGoldBloom(ctx, app.W / 2);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#b07a08';
      text(ctx, 'CLIENT DESK', app.W / 2, 30, { size: 34, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      const rec = currentHunter(app);
      if (rec) drawHunterCard(app, rec, 540, 90, 380);
      host.menus.forEach((m, i) => drawMenu(ctx, m, 60 + i * 30, 100 + i * 40, 440, { lineH: 26 }));
      if (note) { ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = OK;
        text(ctx, note, app.W / 2, 640, { size: 16, align: 'center', color: OK, shadow: false }); ctx.restore(); }
      if (app.bootNote) text(ctx, app.bootNote, app.W / 2, 668, { size: 13, align: 'center', color: BAD });
    },
  };
}

// ---------------------------------------------------------------------------
// HOSPITAL — repair maxHP (50cr x level / point), buy level-ups (§2.13).

export function makeHospitalScreen(app) {
  const host = makeMenuHost();
  let note = '';
  let t = 0;

  function rootMenu() {
    const rec = currentHunter(app);
    if (!rec) return makeMenu([{ label: 'Back', value: 'back' }], { title: 'HOSPITAL', onPick() { app.stack.pop(); }, onCancel() { app.stack.pop(); } });
    const lost = baseMaxHp(rec) - rec.maxHp;
    const perPt = 50 * rec.level;
    const fee = rec.level < 15 ? LEVEL_UP_FEES[rec.level - 1] : null;
    return makeMenu([
      {
        label: lost > 0 ? `Repair 1 max HP` : 'Repair max HP (nothing lost)',
        right: lost > 0 ? `${perPt}cr` : '',
        rightColor: GOLD,
        value: 'repair1',
        disabled: lost <= 0 || rec.credits < perPt,
      },
      {
        label: lost > 0 ? `Repair all (${lost} pts)` : ' ',
        right: lost > 0 ? `${perPt * lost}cr` : '',
        rightColor: GOLD,
        value: 'repairAll',
        disabled: lost <= 0 || rec.credits < perPt * lost,
      },
      {
        label: fee ? `Level up to ${rec.level + 1}` : 'Level up (at cap 15)',
        right: fee ? `${fee}cr` : '',
        rightColor: GOLD,
        value: 'levelup',
        disabled: !fee || rec.credits < fee,
      },
      { label: 'Back', value: 'back' },
    ], {
      title: `HOSPITAL - ${rec.credits}cr`,
      footer: lost > 0 ? `Max HP ${rec.maxHp} / base ${baseMaxHp(rec)}` : `Max HP ${rec.maxHp} (full)`,
      footerColor: lost > 0 ? BAD : '#3aa84a',
      onPick(v) {
        if (v === 'back') { app.stack.pop(); return; }
        if (v === 'repair1' || v === 'repairAll') {
          const n = v === 'repair1' ? 1 : lost;
          rec.credits -= perPt * n;
          rec.maxHp += n;
          app.save();
          note = `Repaired ${n} max HP.`;
          sfx.heal();
          host.clear(); host.push(rootMenu());
        } else if (v === 'levelup') {
          rec.credits -= fee;
          host.push(allocateMenu(rec));
        }
      },
      onCancel() { app.stack.pop(); },
    });
  }

  // Level-up: +1 maxHP automatic (the level term), +1 internal point (§2.1).
  function allocateMenu(rec) {
    const d = displayStats(rec.internal, rec.level + 1);
    return makeMenu([
      { label: 'MV', right: `iMV ${rec.internal.mv} -> move +${Math.floor((rec.internal.mv + 1) / 3)}`, value: 'mv', color: '#3a6ee0', rightColor: '#3a6ee0' },
      { label: 'AT', right: `iAT ${rec.internal.at} -> attack ${rec.internal.at + 1}`, value: 'at', color: '#cc4a3a', rightColor: '#cc4a3a' },
      { label: 'DF', right: `iDF ${rec.internal.df} -> defense ${Math.floor((rec.internal.df + 1) / 2)}`, value: 'df', color: '#e0c63a', rightColor: '#e0c63a' },
      { label: 'HP', right: `iHP ${rec.internal.hp} -> max ${d.maxHp + 3}`, value: 'hp', color: '#3aa84a', rightColor: '#3aa84a' },
    ], {
      title: `LEVEL ${rec.level + 1}: allocate +1 point`,
      onPick(stat) {
        const before = baseMaxHp(rec);
        rec.level += 1;
        rec.internal[stat] += 1;
        rec.maxHp += baseMaxHp(rec) - before; // damage (halving) is preserved
        app.save();
        note = `Welcome to level ${rec.level}!`;
        sfx.targetFanfare();
        host.clear(); host.push(rootMenu());
      },
      // no cancel: the fee is paid, the point must go somewhere
    });
  }

  return {
    enter() { host.push(rootMenu()); },
    update(dt) { t += dt; },
    onKey(k) { host.key(k); },
    onClick(pos) { host.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      // Ambient motes: green and white, healing/restoration theme
      { const MOTE_C = ['#3aa84a', '#7ee8a0', '#a0f0c0', '#5ad870'];
        for (let i = 0; i < 8; i++) {
          const bx = ((i * 191 + 61) % 660) + 100;
          const by = ((i * 239 + 97) % 480) + 80;
          const sp = 0.025 + (i % 4) * 0.012;
          const mx = bx + Math.sin(t * sp + i * 1.7) * 16;
          const my = by + Math.cos(t * sp * 0.65 + i * 1.1) * 11;
          const ma = 0.06 + 0.05 * Math.sin(t * 0.75 + i * 1.3);
          ctx.save(); ctx.globalAlpha = Math.max(0, ma); ctx.fillStyle = MOTE_C[i % 4];
          const ms = i % 3 === 0 ? 2 : 1.5;
          ctx.fillRect((mx - ms * 0.3) | 0, (my - ms) | 0, Math.max(1, ms * 0.6) | 0, ms * 2);
          ctx.fillRect((mx - ms) | 0, (my - ms * 0.3) | 0, ms * 2, Math.max(1, ms * 0.6) | 0);
          ctx.restore();
        } }
      drawGoldBloom(ctx, app.W / 2);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#b07a08';
      text(ctx, 'HOSPITAL', app.W / 2, 30, { size: 34, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      const rec = currentHunter(app);
      if (rec) drawHunterCard(app, rec, 540, 90, 380);
      host.menus.forEach((m, i) => drawMenu(ctx, m, 60 + i * 30, 100 + i * 40, 440, { lineH: 26 }));
      if (note) { ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = OK;
        text(ctx, note, app.W / 2, 640, { size: 16, align: 'center', color: OK, shadow: false }); ctx.restore(); }
      { const level = rec?.level ?? 1;
        const feeEntries = LEVEL_UP_FEES.map((f, i) => ({ label: `L${i + 1}>${i + 2}: ${f}`, fee: f, current: i === level - 1 }))
          .slice(Math.max(0, level - 2), level + 2);
        ctx.save(); ctx.font = font(12); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const SEP = '   ';
        const totalW = feeEntries.reduce((s, e, j) => s + (j > 0 ? Math.round(ctx.measureText(SEP).width) : 0) + Math.round(ctx.measureText(e.label).width), 0);
        let cx = ((app.W - totalW) / 2) | 0;
        for (let j = 0; j < feeEntries.length; j++) {
          if (j > 0) { const sw = Math.round(ctx.measureText(SEP).width); ctx.fillStyle = DIM; ctx.fillText(SEP, cx, 668); cx += sw; }
          const e = feeEntries[j];
          ctx.fillStyle = e.current ? ((rec?.credits ?? 0) >= e.fee ? GOLD : BAD) : DIM;
          ctx.fillText(e.label, cx, 668); cx += Math.round(ctx.measureText(e.label).width);
        }
        ctx.restore(); }
    },
  };
}

// ---------------------------------------------------------------------------
// OPTIONS — volumes (synth.setVolumes) + wallpaper picker (§2.13).

export function makeOptionsScreen(app) {
  const rows = ['master', 'music', 'sfx', 'aiSpeed', 'wallpaper', 'colorblind', 'export', 'import', 'back'];
  let idx = 0;
  let note = '';
  const opts = app.options();
  const unlocked = unlockedWallpapers(app.roster);
  // remember disc unlocks permanently, even if discs are later sold
  opts.wallpapersUnlocked = unlocked;
  if (!unlocked.includes(opts.wallpaper)) opts.wallpaper = 0;

  function adjust(dir) {
    const row = rows[idx];
    if (row === 'wallpaper') {
      const at = unlocked.indexOf(opts.wallpaper);
      opts.wallpaper = unlocked[(at + dir + unlocked.length) % unlocked.length];
      sfx.menuMove();
    } else if (row === 'aiSpeed') {
      opts.aiSpeed = Math.max(1, Math.min(64, (opts.aiSpeed ?? 2) + dir));
      sfx.menuMove();
    } else if (row === 'colorblind') {
      opts.colorblind = !opts.colorblind;
      sfx.menuMove();
    } else if (row !== 'back' && row !== 'export' && row !== 'import') {
      opts.volumes[row] = Math.round(Math.max(0, Math.min(1, opts.volumes[row] + dir * 0.05)) * 100) / 100;
      setVolumes(opts.volumes);
      sfx.menuMove();
    }
  }

  function doExport() {
    try {
      const json = exportSave();
      navigator.clipboard?.writeText(json)
        .then(() => { note = 'Save copied to clipboard!'; sfx.menuConfirm(); })
        .catch(() => { note = 'Could not copy — see console'; console.log(json); sfx.error(); });
    } catch (e) { note = 'Export failed: ' + e.message; sfx.error(); }
  }

  function doImport() {
    const json = prompt('Paste exported save JSON to restore hunters:\n(this REPLACES your current save)');
    if (!json) return;
    try {
      importSave(json);
      app.roster = loadRoster();
      app.session.hunterId = null;
      note = `Imported ${app.roster.hunters.length} hunter(s)!`;
      sfx.menuConfirm();
    } catch { note = 'Import failed — not a valid save'; sfx.error(); }
  }

  const leave = () => { app.save(); sfx.menuCancel(); app.stack.pop(); };

  return {
    onKey(k) {
      if (k === 'up') { idx = (idx + rows.length - 1) % rows.length; sfx.menuMove(); }
      else if (k === 'down') { idx = (idx + 1) % rows.length; sfx.menuMove(); }
      else if (k === 'left') adjust(-1);
      else if (k === 'right') adjust(1);
      else if (k === 'confirm') {
        if (rows[idx] === 'back') leave();
        else if (rows[idx] === 'export') doExport();
        else if (rows[idx] === 'import') doImport();
        else if (rows[idx] === 'colorblind') { opts.colorblind = !opts.colorblind; sfx.menuMove(); }
      }
      else if (k === 'cancel') leave();
    },
    onClick(pos) {
      for (let i = 0; i < rows.length; i++) {
        const r = { x: 240, y: 120 + i * 56, w: 480, h: 50 };
        if (inRect(pos, r)) {
          idx = i; // single tap acts (touch-friendly): sliders adjust by tapped half
          if (rows[i] === 'back') leave();
          else if (rows[i] === 'export') doExport();
          else if (rows[i] === 'import') doImport();
          else adjust(pos.x > r.x + r.w / 2 ? 1 : -1);
          return;
        }
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, opts.wallpaper);
      drawGoldBloom(ctx, app.W / 2);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#b07a08';
      text(ctx, 'OPTIONS', app.W / 2, 30, { size: 36, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      rows.forEach((row, i) => {
        const y = 124 + i * 56;
        const sel = i === idx;
        if (sel) {
          const og = ctx.createLinearGradient(236, 0, 724, 0);
          og.addColorStop(0, 'rgba(80,100,220,0.42)'); og.addColorStop(1, 'rgba(80,100,220,0.10)');
          ctx.fillStyle = og; ctx.fillRect(236, y - 10, 488, 48);
          ctx.fillStyle = 'rgba(120,150,255,0.72)'; ctx.fillRect(236, y - 10, 2, 48);
          const mt = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
          const shX = 236 + ((mt % 2.4) / 2.4) * (488 + 40) - 20;
          const sh = ctx.createLinearGradient(shX - 16, 0, shX + 16, 0);
          sh.addColorStop(0, 'transparent'); sh.addColorStop(0.5, 'rgba(180,200,255,0.22)'); sh.addColorStop(1, 'transparent');
          ctx.save(); ctx.beginPath(); ctx.rect(236, y - 10, 488, 48); ctx.clip();
          ctx.fillStyle = sh; ctx.fillRect(shX - 16, y - 10, 32, 48); ctx.restore();
        }

        function drawSlider(val, x2, y2, w2, barColor) {
          ctx.fillStyle = '#23263a'; ctx.fillRect(x2, y2, w2, 12);
          const bg = ctx.createLinearGradient(x2, y2, x2, y2 + 12);
          bg.addColorStop(0, barColor + 'cc'); bg.addColorStop(1, barColor + '88');
          ctx.fillStyle = bg; ctx.fillRect(x2, y2, w2 * val, 12);
          ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
          ctx.fillRect(x2, y2, w2 * val, 5); ctx.restore();
        }

        if (row === 'back') { text(ctx, 'BACK', 260, y, { size: 18, color: sel ? '#fff' : FG }); return; }
        if (row === 'export') {
          text(ctx, 'Export Save', 260, y, { size: 18, color: sel ? '#fff' : FG });
          text(ctx, 'copies JSON to clipboard', 500, y, { size: 13, color: DIM }); return;
        }
        if (row === 'import') {
          text(ctx, 'Import Save', 260, y, { size: 18, color: sel ? BAD : FG });
          text(ctx, 'paste JSON — replaces current save', 500, y, { size: 13, color: DIM }); return;
        }
        if (row === 'aiSpeed') {
          text(ctx, 'AI Speed', 260, y, { size: 18, color: sel ? '#fff' : FG });
          const spd = opts.aiSpeed ?? 8;
          drawSlider((spd - 1) / 63, 500, y + 4, 200, sel ? '#d8b83a' : '#7e9fee');
          text(ctx, `${spd}x`, 712, y, { size: 14, color: DIM }); return;
        }
        if (row === 'colorblind') {
          text(ctx, 'Color Blind', 260, y, { size: 18, color: sel ? '#fff' : FG });
          const cb = opts.colorblind;
          text(ctx, cb ? 'ON  (high contrast)' : 'OFF', 500, y, { size: 16, color: cb ? '#4ee8d0' : DIM });
          text(ctx, 'boosts saturation for red-green CVD', 500, y + 22, { size: 11, color: DIM }); return;
        }
        if (row === 'wallpaper') {
          text(ctx, 'Wallpaper', 260, y, { size: 18, color: sel ? '#fff' : FG });
          ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = '#906000';
          text(ctx, `< ${WALLPAPERS[opts.wallpaper].name} >`, 500, y, { size: 16, color: GOLD, shadow: false });
          ctx.restore();
          text(ctx, `${unlocked.length}/${WALLPAPERS.length} unlocked (find Discs)`, 500, y + 22, { size: 11, color: DIM }); return;
        }
        text(ctx, row === 'sfx' ? 'SFX' : cap(row), 260, y, { size: 18, color: sel ? '#fff' : FG });
        const v = opts.volumes[row];
        drawSlider(v, 500, y + 4, 200, sel ? '#d8b83a' : '#7e9fee');
        text(ctx, `${Math.round(v * 100)}%`, 712, y, { size: 14, color: DIM });
      });
      if (note) { ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = OK;
        text(ctx, note, app.W / 2, 590, { size: 14, align: 'center', color: OK, shadow: false }); ctx.restore(); }
      text(ctx, 'left/right to adjust - Enter on export/import - Esc saves and exits', app.W / 2, 618, { size: 12, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// GAME — the in-mission screen. Renderer draws the board (through app.adapt);
// this screen runs the human/AI turn pump, builds Actions from input per
// DESIGN §3.2, and draws the HUD/menus/timing minigame on top.

const DIR_BY_KEY = { up: 'N', down: 'S', left: 'W', right: 'E' };
const TIMING = { period: 0.9, window: 0.08, timeout: 2.7 };
// On-screen touch controls (left edge), the equivalents of the desktop keys that
// phones can't press: Esc (pause), [ ] (speed), Tab (info), Z (undo a step).
const PAUSE_BTN = { x: 8, y: 8, w: 46, h: 46 };
const SPEED_BTN = { x: 8, y: 60, w: 46, h: 46 };
const INFO_BTN = { x: 8, y: 112, w: 46, h: 46 };
const UNDO_BTN = { x: 8, y: 164, w: 46, h: 46 };

// §2.12 score rows from the documented tally fields: 15/tile, 25/HP, flag and
// kill points at face value, handicap (relic - level) x 250, items 250 each and
// Target 1250, capped at 50,000. Credits = floor(score / 15 x relic). Pure —
// shared by the in-game live-score HUD AND the results screen. It previously
// lived only inside makeResultsScreen, so the in-game HUD threw "scoreRows is
// not defined" every frame; module scope fixes that.
function scoreRows(st) {
  return (st.hunters || []).map((h) => {
    const t = h.tally || {};
    const moved = (t.moved ?? 0) * 15;
    const damage = (t.damage ?? 0) * 25;
    const flagPts = t.flagPts ?? 0;
    const killPts = t.killPts ?? 0;
    const handicap = Math.max(0, ((st.relicLevel ?? 1) - (h.level ?? 1)) * 250);
    const itemPts = (h.items?.length ?? 0) * 250 + (h.hasTarget ? 1250 : 0);
    const total = Math.min(50000, moved + damage + flagPts + killPts + handicap + itemPts);
    const credits = Math.floor((total * (st.relicLevel ?? 1)) / 15);
    return { id: h.id, name: h.name, moved, damage, flagPts, killPts, handicap, itemPts, total, credits };
  });
}

export function makeGameScreen(app, g) {
  // g: { state, renderer, mission, outcome:{} } built by app.startMission
  const A = app.adapt;
  const host = makeMenuHost();
  let uiKey = null;        // phase signature the menus were built for
  let steering = false;
  let pendingPath = [];    // queued step dirs for tap/click-to-move (walk to a tapped tile)
  let undoStack = [];      // pre-step snapshots for in-move soft-undo
  let timing = null;       // { t } while a react.* minigame runs
  let aiSpeed = app.options().aiSpeed ?? 2;
  let aiDelay = 0.2 / aiSpeed;
  let infoIndex = 0;
  let banner = null;       // { text, t }
  let inBattleMusic = false;
  let fadeIn = 0;          // seconds since screen entered; drives entry fade
  let hudT = 0;            // running clock for HUD animations
  let frameDt = 1 / 60;
  let broken = false;
  let finished = false;
  let lastHumanId = null;   // hotseat: track whose turn it was
  let pendingBattlers = null; // names captured on battleStarted for explainStrike
  let wyrmCinState = null;    // { max, t, line2 } — full-screen cinematic overlay on WYRM spawn
  let handoff = null;       // { name } — waiting for new human to confirm before revealing hand
  let seenTips = loadSeenTips();  // first-play tips seen this device (persisted)
  let tipOverlay = null;          // { lines, t, key } — contextual hint card

  const say = (s, dur = 2.2, color = GOLD) => { banner = { text: s, t: dur, color }; };
  const showTip = (key) => {
    if (seenTips.has(key) || (tipOverlay?.key === key)) return;
    markTipSeen(key, seenTips);
    tipOverlay = { lines: TIP_DEFS[key], t: 6, key };
  };
  const dismissTip = () => { tipOverlay = null; };
  const snapshot = (s) => { try { return structuredClone(s); } catch { return JSON.parse(JSON.stringify(s)); } };

  function act(action) {
    try {
      const { state, events } = A.apply(g.state, action);
      g.state = state;
      handleEvents(events);
      A.rendererFeed(g.renderer, state, events);
    } catch (err) {
      console.error('engine error applying', action, err);
      say('Engine error - press Esc to leave (see console)', 10);
      broken = true;
    }
    host.clear();
    steering = false;
    timing = null;
    uiKey = null;
    // The undo stack is valid only within one steering sequence: reset when a
    // fresh move begins (0 steps taken) or steering ends. Steps keep it (they
    // push their pre-step snapshot before calling act).
    if (g.state.phase !== 'turn.steer' || !(g.state.move?.path?.length)) undoStack = [];
  }

  // In-move soft-undo: rewind the last step within the current move. Restores a
  // pre-step snapshot (the engine stays pure; we never un-roll the die — the
  // stack is empty at 0 steps). Feeds the renderer the restored state directly.
  function undoStep() {
    pendingPath = []; // undo cancels any in-progress click-to-move walk
    if (!undoStack.length) { sfx.error(); return; }
    g.state = undoStack.pop();
    A.rendererFeed(g.renderer, g.state, []);
    host.clear();
    steering = true;
    timing = null;
    uiKey = null;
    sfx.step();
  }

  function handleEvents(events) {
    for (const ev of events || []) {
      playEventSfx(ev);
      switch (ev.type) {
        case 'battleStarted': {
          if (!inBattleMusic) { inBattleMusic = true; app.music('battle'); }
          const _atk = A.resolveUnit(g.state, ev.attacker);
          const _def = A.resolveUnit(g.state, ev.defender);
          if (_atk?.items && _def?.kind &&
              _atk.items.some(it => ITEMS[it.itemId]?.effect === 'counter-' + _def.kind))
            sfx.counterActivated();
          pendingBattlers = {
            atkName: _atk?.name ?? _atk?.kind ?? '?',
            defName: _def?.name ?? _def?.kind ?? '?',
          };
          break;
        }
        case 'cardDrawn':
          if (g.runState) showTip('dive');
          else showTip('card');
          break;
        case 'fortuneUsed':
          sfx.menuConfirm();
          say(`Fortune used! ${ev.remaining > 0 ? `${ev.remaining} left` : 'none left'}`, 2.0, GOLD);
          break;
        case 'turnStarted':
          if (inBattleMusic) { inBattleMusic = false; app.music(g.songBase); }
          break;
        case 'targetFound': say('TARGET ITEM FOUND!', 2.2, GOLD); break;
        case 'itemTaken':
          if (ev.itemId === 'TARGET' && A.resolveUnit(g.state, ev.unit)?.human)
            say('RELIC SEIZED!', 3, GOLD);
          if (ev.identified === false) showTip('sealed');
          break;
        case 'boxOpened':
          if (ev.contents && ev.contents !== 'TARGET') {
            const boxLabel = ev.identified ? (ITEMS[ev.contents]?.name ?? ev.contents) : '??? (sealed)';
            say(`Found: ${boxLabel}`, 2.2, ev.identified ? '#3aacc8' : DIM);
          }
          break;
        case 'flagClaimed': {
          const FC = { red: '#ff6a5a', blue: '#4a7dff', green: '#3aa84a', yellow: '#e0c63a' };
          say(`${cap(ev.color)} flag - rolled ${ev.roll}!`, 2.2, FC[ev.color] ?? GOLD);
          break; }
        case 'monsterSpawned': say(`${/^[AEIOU]/.test(ev.kind) ? 'An' : 'A'} ${ev.kind} appears!`, 2.2, '#cc4a3a'); break;
        case 'wyrmSpawned': say('THE WYRM RISES!', 3, BAD); wyrmCinState = { max: 2.8, t: 2.8, line2: 'RISES' }; showTip('wyrm'); break;
        case 'wyrmRespawned': say('The WYRM returns...', 3, '#e06090'); wyrmCinState = { max: 1.8, t: 1.8, line2: 'RETURNS' }; break;
        case 'missionWon':
          g.outcome.winnerRef = ev.winner ?? ev.unit ?? null;
          g.outcome.won = true;
          showTip('win');
          break;
        case 'missionLost': {
          g.outcome.reason = ev.reason ?? 'lost';
          g.outcome.won = false;
          const reason = String(g.outcome.reason);
          if (/wyrm/i.test(reason)) say('THE WYRM DEVOURED THE RELIC HOLDER!', 3.2, BAD);
          else if (/rival.*exit|exited/i.test(reason)) say('RIVAL ESCAPED WITH THE RELIC!', 2.8, BAD);
          else if (/rescue/i.test(reason)) say('RAVEN REACHED THE TARGET FIRST!', 2.8, BAD);
          break;
        }
        case 'exitWarpedAway':
          if (A.resolveUnit(g.state, ev.unit)?.human)
            say('EXIT needs the RELIC!', 2.2, BAD);
          break;
        case 'hunterDefeated': {
          const _defeated = A.resolveUnit(g.state, ev.unit);
          if (_defeated?.human) {
            const newMax = _defeated.maxHp;
            say(`TAKEN DOWN! Max HP now ${newMax}.`, 3, BAD);
          }
          break;
        }
        case 'critNegated': say('CRIT NEGATED!', 1.8, OK); break;
        case 'trapDodged':
          if (A.resolveUnit(g.state, ev.unit)?.human) say('DODGED!', 1.6, OK);
          break;
        case 'statusInflicted': {
          const _statusTarget = A.resolveUnit(g.state, ev.target ?? ev.unit);
          if (_statusTarget?.human) {
            const msgs = { panic: 'PANICKED! AI controls your next turn.', stun: 'STUNNED! Next turn skipped.', leg: 'LEG DAMAGE! Movement capped.', empty: 'EMPTY! Hand discarded.' };
            const msg = msgs[ev.kind];
            if (msg) say(msg, 2.4, '#e0a030');
          }
          break;
        }
        case 'actAgain':
          if (A.resolveUnit(g.state, ev.unit)?.human) say('ACT AGAIN!', 1.8, GOLD);
          break;
        default: break;
      }
    }
  }

  function playEventSfx(ev) {
    switch (ev.type) {
      case 'dieRolled': sfx.dieRoll(); break;
      case 'cardDrawn': sfx.cardDraw(); break;
      case 'cardPlayed': sfx.cardPlay(); break;
      case 'stepped': sfx.step(); break;
      case 'trapTriggered': sfx.trapSpring(); break;
      case 'trapDodged': sfx.trapDodge(); break;
      case 'trapSet': sfx.cardPlay(); break;
      case 'boxOpened': sfx.boxOpen(); break;
      case 'targetFound': sfx.targetFanfare(); break;
      case 'flagClaimed': sfx.flagClaim(); break;
      case 'escapeRolled': if (ev.escaped) sfx.escape(); break;
      case 'strikeRolled': {
        if (ev.crit) sfx.crit();
        else if ((ev.damage ?? 0) > 0) sfx.hit(ev.damage);
        else sfx.block();
        if (pendingBattlers && ev.totals) {
          const isAtk = ev.striker === 'attacker';
          const note = explainStrike({
            attacker: isAtk ? pendingBattlers.atkName : pendingBattlers.defName,
            defender: isAtk ? pendingBattlers.defName : pendingBattlers.atkName,
            atkTotal: ev.totals.atk, defTotal: ev.totals.def,
            damage: ev.damage ?? 0, crit: ev.crit ?? false,
          });
          say(note, 2.4, ev.crit ? GOLD : (ev.damage ?? 0) > 0 ? '#cc4a3a' : DIM);
        }
        break;
      }
      case 'critNegated': sfx.block(); break;
      case 'statusInflicted': {
        const statusSfx = { panic: sfx.statusPanic, stun: sfx.statusStun, leg: sfx.statusLeg, empty: sfx.statusEmpty };
        (statusSfx[ev.kind] ?? sfx.error).call(sfx);
        break;
      }
      case 'surrendered': sfx.surrender(); break;
      case 'hunterDefeated': sfx.defeat(); break;
      case 'itemTaken': sfx.boxOpen(); break;
      case 'monsterSpawned': sfx.monsterSpawn(); break;
      case 'monsterKilled': sfx.defeat(); break;
      case 'wyrmSpawned': case 'wyrmRespawned': sfx.wyrmRoar(); break;
      case 'healed': sfx.heal(); break;
      case 'exitWarpedAway': sfx.escape(); break;
      case 'missionWon': sfx.exitWin(); break;
      case 'missionLost': sfx.lose(); break;
      default: break;
    }
  }

  // ---- human UI construction per phase (§3.2) ----

  function pickLabel(option) {
    if (option == null) return 'Nothing';
    if (typeof option === 'string') return ITEMS[option]?.name ?? option;
    if (typeof option === 'object') {
      if (option.itemId) return (ITEMS[option.itemId]?.name ?? option.itemId) + (option.identified === false ? ' (?)' : '');
      if (option.label) return option.label;
    }
    return JSON.stringify(option);
  }

  const ODDS_COL = { strong: '#3aa84a', even: '#9aa0b4', weak: '#cc6040' };
  function attackOddsHint(me, target) {
    try {
      const atkAT = me.internal
        ? (me.internal.at + (effectiveStats(me).at ?? 0))
        : (me.at ?? 1);
      const defDF = target.internal
        ? (Math.floor(target.internal.df / 2) + (effectiveStats(target).df ?? 0))
        : (target.df ?? 0);
      const defAT = target.internal ? (target.internal.at ?? 0) : (target.at ?? 0);
      const o = battleOdds({ at: atkAT, oppAt: defAT, df: defDF });
      const label = { strong: 'Strong', even: 'Even', weak: 'Weak' }[o.advantage] ?? 'Even';
      return { text: `${label} · ~${o.expectedDamage.toFixed(1)} dmg`, color: ODDS_COL[o.advantage] };
    } catch { return null; }
  }

  function actionLabel(st, a) {
    switch (a.type) {
      case 'move': return a.card ? `Move + ${describeCard(a.card)}` : 'Move (roll only)';
      case 'attack': return `Attack ${A.unitName(st, a.target)}`;
      case 'rest': return 'Rest (heal + draw)';
      case 'pass': return 'Pass';
      case 'stop': return 'Stop here';
      case 'respond': return cap(a.response);
      case 'battleCard': return a.card ? describeCard(a.card) : 'No card';
      case 'pick': return pickLabel(a.option);
      case 'confirm': return 'Continue';
      default: return JSON.stringify(a);
    }
  }

  function buildUi(st) {
    host.clear();
    steering = false;
    let acts;
    try {
      acts = A.legalActions(st) || [];
    } catch (err) {
      console.error('legalActions failed', err);
      say('Engine error - press Esc to leave', 10);
      broken = true;
      return;
    }
    const phase = String(st.phase ?? '');

    if (phase === 'turn.steer') { steering = true; showTip('steer'); return; }
    if (phase === 'react.dodge' || phase === 'react.crit') { timing = { t: 0, kind: phase }; return; }

    if (phase === 'turn.action') {
      const moves = acts.filter((a) => a.type === 'move');
      const attacks = acts.filter((a) => a.type === 'attack');
      const rest = acts.find((a) => a.type === 'rest');
      const items = [];
      if (moves.length) items.push({ label: 'Move', color: '#3a6ee0', value: () => host.push(subMenu('MOVE - play a card?', moves)) });
      if (attacks.length) {
        const me = A.resolveUnit(st, A.currentChooser(st));
        const singleTgt = attacks.length === 1 ? A.resolveUnit(st, attacks[0].target) : null;
        const hint = me && singleTgt ? attackOddsHint(me, singleTgt) : null;
        const atkSubMenu = () => makeMenu(attacks.map((a) => {
          const tgt = A.resolveUnit(st, a.target);
          const h = me && tgt ? attackOddsHint(me, tgt) : null;
          return { label: actionLabel(st, a), right: h?.text, rightColor: h?.color, value: a };
        }), { title: 'ATTACK - target', onPick: (a) => act(a), onCancel: () => host.pop() });
        items.push({ label: 'Attack', right: hint?.text, rightColor: hint?.color, color: '#cc4a3a',
          value: () => (attacks.length === 1 ? act(attacks[0]) : host.push(atkSubMenu())) });
      }
      if (rest) items.push({ label: actionLabel(st, rest), color: '#3aa84a', value: () => act(rest) });
      for (const a of acts) {
        if (!['move', 'attack', 'rest'].includes(a.type)) items.push({ label: actionLabel(st, a), color: '#9aa0b4', value: () => act(a) });
      }
      host.push(makeMenu(items, { title: 'YOUR TURN', onPick: (fn) => fn() }));
      return;
    }

    if (phase === 'battle.response') {
      const RESP_COL = { counter: '#cc4a3a', guard: '#e0c63a', escape: '#4a7dff', surrender: '#9aa0b4', fortune: GOLD };
      const items = acts.map((a) => {
        const isFortune = a.type === 'fortune';
        return {
          label: isFortune ? `Fortune (${st.fortune ?? 0} left)` : actionLabel(st, a),
          right: isFortune ? RESPONSE_HINTS.fortune : (RESPONSE_HINTS[a.response] ?? ''),
          color: isFortune ? GOLD : RESP_COL[a.response],
          rightColor: isFortune ? GOLD : RESP_COL[a.response],
          value: () => act(a),
        };
      });
      let oddsFooter = null;
      try {
        const _atk = A.resolveUnit(st, st.battle?.attacker);
        const _def = A.resolveUnit(st, st.battle?.defender);
        if (_atk && _def) {
          const atkAT = _atk.internal
            ? (_atk.internal.at + (effectiveStats(_atk).at ?? 0))
            : (_atk.at ?? 1);
          const defDF = _def.internal
            ? (Math.floor(_def.internal.df / 2) + (effectiveStats(_def).df ?? 0))
            : (_def.df ?? 0);
          const defAT = _def.internal ? (_def.internal.at ?? 0) : (_def.at ?? 0);
          oddsFooter = describeOdds(battleOdds({ at: atkAT, oppAt: defAT, df: defDF }));
        }
      } catch { /* odds are a bonus, never fatal */ }
      showTip('response');
      host.push(makeMenu(items, { title: 'BATTLE - respond!', footer: oddsFooter, onPick: (fn) => fn() }));
      return;
    }

    if (phase === 'battle.defCard' || phase === 'battle.atkCard') {
      host.push(subMenu(phase === 'battle.defCard' ? 'DEFENSE CARD' : 'ATTACK CARD', acts));
      return;
    }

    if (phase.startsWith('choice') || st.pendingChoice) {
      const titles = { steal: 'VICTORY - take an item', surrenderGive: 'Hand over an item', discardOverflow: 'Bag full - discard one' };
      host.push(subMenu(titles[st.pendingChoice?.kind] ?? 'CHOOSE', acts));
      return;
    }

    if (phase === 'mission.over') {
      const overTitle = g.outcome.won === false ? 'MISSION FAILED' : 'MISSION COMPLETE';
      host.push(subMenu(overTitle, acts.length ? acts : [{ type: 'confirm' }]));
      return;
    }

    // Unknown phase: generic list keeps the game playable across contract drift.
    if (acts.length) host.push(subMenu(phase || 'CHOOSE', acts));
  }

  function pickItemColor(a) {
    const opt = a.option;
    if (!opt) return null;
    const id = typeof opt === 'string' ? opt : opt.itemId;
    return id ? (ITEM_CAT_COLOR[ITEMS[id]?.category] ?? null) : null;
  }

  function subMenu(title, acts) {
    return makeMenu(acts.map((a) => ({
      label: actionLabel(g.state, a),
      color: a.card ? (CARD_HEX[cardColor(a.card)] ?? null) : (a.type === 'pick' ? pickItemColor(a) : null),
      value: a,
    })), {
      title,
      onPick: (a) => act(a),
      onCancel: host.menus.length ? () => { host.pop(); } : null,
    });
  }

  // ---- screen object ----

  return {
    enter() {
      g.songBase = ((g.state.seed ^ (g.state.seed >>> 7)) & 1) ? 'dungeon2' : 'dungeon1';
      app.music(g.songBase);
      fadeIn = 0;
    },
    update(dt) {
      frameDt = dt;
      fadeIn += dt;
      hudT += dt;
      if (banner && (banner.t -= dt) <= 0) banner = null;
      if (wyrmCinState) { wyrmCinState.t = Math.max(0, wyrmCinState.t - dt); if (!wyrmCinState.t) wyrmCinState = null; }
      if (tipOverlay) { tipOverlay.t -= dt; if (tipOverlay.t <= 0) tipOverlay = null; }
      if (broken || finished) return;
      const st = g.state;

      if (st.result) {
        // Wait for animations to finish before transitioning to results
        if (!A.rendererBusy(g.renderer)) {
          finished = true;
          app.stack.replace(makeResultsScreen(app, g));
        }
        return;
      }

      if (!A.isHumanTurn(st)) {
        // AI actions fire immediately without waiting for renderer animations
        host.clear(); steering = false; timing = null; uiKey = null; pendingPath = [];
        aiDelay -= dt;
        if (aiDelay > 0) return;
        aiDelay = 0.3 / aiSpeed;
        try {
          act(A.aiAction(st));
        } catch (err) {
          console.error('AI error', err);
          say('AI error - press Esc to leave', 10);
          broken = true;
        }
        return;
      }

      // human's decision — detect hotseat handoff (new human player's turn)
      { const chooser = A.resolveUnit(st, A.currentChooser(st));
        if (chooser && chooser.id !== lastHumanId) {
          const wasKnown = lastHumanId !== null;
          lastHumanId = chooser.id;
          const multiHuman = (st.hunters || []).filter((h) => h.human).length > 1;
          if (wasKnown && multiHuman) handoff = { name: chooser.name ?? chooser.id };
        } }
      if (handoff) return; // wait for handoff confirmation

      // wait for animations before showing UI
      if (A.rendererBusy(g.renderer)) return;
      // Click-to-move: walk one queued step per idle tick toward the tapped tile.
      // Driven off the live phase (not the steering flag, which act() toggles each
      // step); the queue clears the instant movement ends (trap/box/exit/range).
      if (pendingPath.length) {
        if (g.state.phase !== 'turn.steer') { pendingPath = []; }
        else {
          let stepActs = [];
          try { stepActs = A.legalActions(g.state) || []; } catch { /* ignore */ }
          const dir = pendingPath.shift();
          const step = stepActs.find((a) => a.type === 'step' && a.dir === dir);
          if (step) { act(step); return; }
          pendingPath = [];
        }
      }
      if (timing) {
        timing.t += dt;
        if (timing.t >= TIMING.timeout) act({ type: 'timing', hit: false });
        return;
      }
      const key = `${st.phase}|${st.current?.kind}:${st.current?.index}|${st.pendingChoice?.kind ?? ''}`;
      if (uiKey !== key) { uiKey = key; buildUi(st); }
    },

    onKey(k, e) {
      if (broken) { if (k === 'cancel') { app.music('hub'); app.stack.pop(); } return; }
      if (handoff) { handoff = null; return; }
      if (tipOverlay) dismissTip();
      // D21: while steering, Esc must commit/stop the move (handled below), not
      // open pause — no menu is open during steer so !host.top() is always true.
      if (k === 'cancel' && !host.top() && !steering) { openPauseMenu(); return; }
      // D23: a held Enter auto-repeats; don't re-fire confirm into an open menu
      // (YOUR TURN → Move/Attack push a submenu synchronously and would fall through).
      if (host.top()) { if (!(k === 'confirm' && e?.repeat)) host.key(k); return; }
      if (k === 'speedDown') { aiSpeed = Math.max(1, Math.floor(aiSpeed / 2)); say(`AI speed: ${aiSpeed}x`, 1.2); return; }
      if (k === 'speedUp') { aiSpeed = Math.min(64, aiSpeed * 2); say(`AI speed: ${aiSpeed}x`, 1.2); return; }
      if (A.rendererBusy(g.renderer)) { A.rendererSkip(g.renderer); return; } // any key skips animations
      if (timing) {
        if (k === 'confirm' && !e?.repeat) {
          const pos = markerPos(timing.t);
          act({ type: 'timing', hit: Math.abs(pos - 0.5) <= TIMING.window });
        }
        return;
      }
      if (steering) {
        const st = g.state;
        if (k === 'undo') { undoStep(); return; }
        let acts = [];
        try { acts = A.legalActions(st) || []; } catch { /* ignore */ }
        if (DIR_BY_KEY[k] && !e?.repeat) { // D22: ignore OS auto-repeat so a held arrow doesn't overshoot
          pendingPath = []; // a manual step cancels any in-progress click-to-move walk
          const step = acts.find((a) => a.type === 'step' && a.dir === DIR_BY_KEY[k]);
          if (step) { undoStack.push(snapshot(st)); act(step); } else sfx.error();
        } else if (k === 'confirm' || k === 'cancel') {
          const stop = acts.find((a) => a.type === 'stop');
          if (stop) act(stop); else sfx.error();
        }
        return;
      }
      if (k === 'info') { infoIndex = (infoIndex + 1) % (g.state.hunters?.length || 1); return; }
      host.key(k);
    },

    onClick(pos) {
      if (broken) return;
      if (handoff) { handoff = null; return; }
      if (tipOverlay) { dismissTip(); return; }
      // On-screen controls (top-left) take precedence and work even mid-animation
      // — except during the timing minigame (the whole screen is the tap) and the
      // pause menu. Pause/speed/info always; undo only while steering.
      if (!timing && host.top()?.title !== 'Paused') {
        if (inRect(pos, PAUSE_BTN)) { openPauseMenu(); return; }
        if (inRect(pos, SPEED_BTN)) { aiSpeed = aiSpeed >= 64 ? 1 : aiSpeed * 2; say(`AI speed: ${aiSpeed}x`, 1.2); return; }
        if (inRect(pos, INFO_BTN)) { infoIndex = (infoIndex + 1) % (g.state.hunters?.length || 1); return; }
        if (steering && undoStack.length && inRect(pos, UNDO_BTN)) { undoStep(); return; }
      }
      if (A.rendererBusy(g.renderer)) { A.rendererSkip(g.renderer); return; }
      if (timing) {
        const p = markerPos(timing.t);
        act({ type: 'timing', hit: Math.abs(p - 0.5) <= TIMING.window });
        return;
      }
      if (host.click(pos)) return;
      if (steering) {
        const tile = A.tileAt(g.renderer, pos);
        if (!tile) return;
        const st = g.state;
        const me = A.resolveUnit(st, A.currentChooser(st));
        let acts = [];
        try { acts = A.legalActions(st) || []; } catch { /* ignore */ }
        if (me?.pos && tile.x === me.pos.x && tile.y === me.pos.y) {
          const stop = acts.find((a) => a.type === 'stop');
          if (stop) act(stop);
          return;
        }
        if (me?.pos) {
          // Click-to-move: walk the whole way to the tapped tile if it is one of
          // the reachable ("available") squares — not just a single step. update()
          // consumes the queued path one step per idle tick so traps/boxes still
          // resolve per step and a trap-dodge cleanly interrupts the walk.
          const path = A.movePath(st, me.pos, tile);
          if (path && path.length) { undoStack.push(snapshot(st)); pendingPath = path; }
          else sfx.error();
        }
      }
    },

    draw(ctx) {
      ctx.fillStyle = '#06060c';
      ctx.fillRect(0, 0, app.W, app.H);
      const st = g.state;
      // Steering: show how far this move can still reach + the path walked so
      // far (the renderer's range/path overlays). Cleared in every other phase.
      if (steering) A.steerOverlay(g.renderer, st); else A.clearOverlays(g.renderer);
      // Fast-forward trivial AI animation (walks/dice/draws) by aiSpeed while it
      // is not a human's decision; battles/steals/boss spawns stay readable, and
      // the player's own turns + the results sequence always play at full speed.
      const turbo = (!A.isHumanTurn(st) && !st.result) ? aiSpeed : 1;
      A.rendererDraw(g.renderer, st, frameDt, turbo);
      // Soft vertical shadow at dungeon/HUD boundary (x=720)
      { const sg = ctx.createLinearGradient(706, 0, 724, 0);
        sg.addColorStop(0, 'transparent'); sg.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = sg; ctx.fillRect(706, 0, 18, app.H); }
      drawHud(ctx, st);
      // Touch controls — visible during normal play (incl. the turn menu, which
      // is always on host); hidden only when the pause menu is already open or
      // during the timing minigame / handoff / tip / results.
      if (host.top()?.title !== 'Paused' && !timing && !handoff && !tipOverlay && !st.result) {
        drawPauseButton(ctx);
        drawToolbar(ctx);
      }
      const m = host.top();
      if (m) {
        // Dim the board + show PAUSED ONLY for the actual pause menu — the turn /
        // sub / battle / choice menus are normal in-play menus and must NOT dim
        // the board or claim the game is paused (they go through host too).
        if (m.title === 'Paused') {
          ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 720, app.H); ctx.restore();
          ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#b07a08';
          text(ctx, 'PAUSED', 360, 340, { size: 28, align: 'center', color: GOLD, shadow: false });
          ctx.restore();
        }
        if (app.isTouch && m.title !== 'Paused') {
          // Phone: render the in-play decision menu (Move/Rest/Attack, battle
          // response, choices, mission-over) as a large centered dialog with a
          // dimmed board behind it — the compact side menu is unreadable/untappable
          // on a phone. drawMenu recomputes m.rects for this geometry, so the
          // bigger rows are also the tap targets (hit-testing stays consistent).
          const dw = 460, lineH = 46, size = 24, pad = 16;
          const headH = m.title ? 40 : 0, footH = m.footer ? 30 : 0;
          const dh = m.items.length * lineH + pad * 2 + headH + footH;
          const dx = Math.round((720 - dw) / 2);
          const dy = Math.round(Math.max(12, (app.H - dh) / 2));
          ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#04040a';
          ctx.fillRect(0, 0, 720, app.H); ctx.restore();
          drawMenu(ctx, m, dx, dy, dw, { lineH, size, pad, headH, footH });
        } else {
          drawMenu(ctx, m, 724, 420, 232, { lineH: 22, size: 13 });
        }
      }
      if (steering) drawSteerHint(ctx, st);
      if (timing) drawTiming(ctx, timing);
      // WYRM full-screen cinematic overlay: dramatic purple wash + large title text
      if (wyrmCinState) {
        const { max, t: ct, line2 } = wyrmCinState;
        const cinAge = max - ct;
        const cinIn = Math.min(1, cinAge / 0.22);
        const cinOut = Math.min(1, ct / 0.85);
        const cAlpha = cinIn * cinOut;
        if (cAlpha > 0.01) {
          ctx.save();
          ctx.globalAlpha = cAlpha * 0.80;
          const cg = ctx.createRadialGradient(app.W / 2, app.H / 2, 40, app.W / 2, app.H / 2, 470);
          cg.addColorStop(0, '#300050'); cg.addColorStop(0.6, '#160028'); cg.addColorStop(1, '#040008');
          ctx.fillStyle = cg; ctx.fillRect(0, 0, app.W, app.H);
          ctx.restore();
          const pulse = 0.93 + 0.07 * Math.sin(cinAge * 7.5);
          const sz = Math.round(54 * pulse);
          ctx.save();
          ctx.globalAlpha = Math.min(1, cAlpha * 1.35);
          ctx.shadowBlur = 52; ctx.shadowColor = '#b040ff';
          text(ctx, 'THE WYRM', app.W / 2, app.H / 2 - 32, { size: sz, align: 'center', color: '#dda8ff', shadow: false });
          text(ctx, line2, app.W / 2, app.H / 2 + sz - 4, { size: sz, align: 'center', color: '#ffffff', shadow: false });
          ctx.restore();
        }
      }
      if (banner) {
        const w = Math.max(280, banner.text.length * 12 + 60);
        const bAlpha = Math.min(1, banner.t * 2.5);
        const bx0 = (680 - w) / 2 + 40;
        ctx.save(); ctx.globalAlpha = bAlpha;
        const bc = banner.color ?? GOLD;
        box(ctx, bx0, 30, w, 44, { stroke: bc });
        // Themed bloom behind text
        const bloom = ctx.createRadialGradient(380, 52, 4, 380, 52, 80);
        bloom.addColorStop(0, bc + '38'); bloom.addColorStop(1, 'transparent');
        ctx.fillStyle = bloom; ctx.fillRect(bx0, 30, w, 44);
        // Shimmer scan across banner
        const shX = bx0 + ((hudT % 1.8) / 1.8) * (w + 40) - 20;
        const sh = ctx.createLinearGradient(shX - 16, 0, shX + 16, 0);
        sh.addColorStop(0, 'transparent'); sh.addColorStop(0.5, 'rgba(255,240,160,0.20)'); sh.addColorStop(1, 'transparent');
        ctx.save(); ctx.beginPath(); ctx.rect(bx0, 30, w, 44); ctx.clip();
        ctx.fillStyle = sh; ctx.fillRect(shX - 16, 30, 32, 44); ctx.restore();
        ctx.save(); ctx.shadowBlur = 12; ctx.shadowColor = bc;
        text(ctx, banner.text, 380, 42, { size: 17, align: 'center', color: bc, shadow: false });
        ctx.restore();
        ctx.restore();
      }
      if (tipOverlay) {
        const TH = 68, TX = 20, TW = 680, TY = app.H - TH - 10;
        const ta = Math.min(1, tipOverlay.t * 4, (6 - tipOverlay.t) * 4);
        ctx.save();
        ctx.globalAlpha = ta * 0.93;
        ctx.fillStyle = '#08080f';
        ctx.fillRect(TX, TY, TW, TH);
        ctx.strokeStyle = '#7e4aaa';
        ctx.lineWidth = 1;
        ctx.strokeRect(TX + 0.5, TY + 0.5, TW - 1, TH - 1);
        ctx.globalAlpha = ta;
        text(ctx, 'HINT', TX + 8, TY + 5, { size: 9, color: '#9060cc', shadow: false, bold: false });
        text(ctx, tipOverlay.lines[0], TX + TW / 2, TY + 13, { size: 14, align: 'center', color: '#ffffff', shadow: false });
        text(ctx, tipOverlay.lines[1], TX + TW / 2, TY + 34, { size: 11, align: 'center', color: '#b0a0c0', shadow: false, bold: false });
        ctx.fillStyle = '#1a1030';
        ctx.fillRect(TX + 8, TY + TH - 9, TW - 16, 3);
        ctx.fillStyle = '#7e4aaa';
        ctx.fillRect(TX + 8, TY + TH - 9, (TW - 16) * (tipOverlay.t / 6), 3);
        ctx.globalAlpha = ta * 0.5;
        text(ctx, 'any key or click to dismiss', TX + TW / 2, TY + TH - 18, { size: 8, align: 'center', color: DIM, shadow: false, bold: false });
        ctx.restore();
      }
      if (A.rendererBusy(g.renderer)) text(ctx, 'any key: skip', 712, 700, { size: 11, align: 'right', color: DIM });
      // Always-visible AI-speed control hint (the [ ] keys are otherwise hidden);
      // brightens while the AI is acting, which is when it actually matters.
      {
        const aiActing = !A.isHumanTurn(st) && !st.result;
        text(ctx, `[ / ] AI speed ${aiSpeed}×`, 8, 700,
          { size: 11, align: 'left', color: aiActing ? '#7e9fee' : DIM });
      }
      // Entry fade-in from black (0.75s)
      if (fadeIn < 0.75) {
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - fadeIn / 0.75);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, app.W, app.H); ctx.restore();
      }
    },
  };

  // ---- HUD drawing ----

  function markerPos(t) {
    // triangle wave 0..1..0 with period TIMING.period
    const ph = (t % TIMING.period) / TIMING.period;
    return ph < 0.5 ? ph * 2 : 2 - ph * 2;
  }

  function drawTiming(ctx, tm) {
    const isDodge = tm.kind === 'react.dodge';
    const boxStroke = isDodge ? '#3a6ee0' : '#cc4a3a';
    const zoneCol = isDodge ? '#3a78d4' : '#d8a830';
    const markerGlow = isDodge ? '#a0c8ff' : '#ffe98a';
    const x = 160, y = 320, w = 400, h = 84;
    box(ctx, x, y, w, h, { stroke: boxStroke, title: isDodge ? 'DODGE! press at center' : 'BRACE! press at center' });
    const bx = x + 20, bw = w - 40, by = y + 46;
    // Track
    ctx.fillStyle = '#151828';
    ctx.fillRect(bx, by, bw, 18);
    // Zone with feathered glow
    const zw = bw * TIMING.window * 2;
    const zx = bx + bw / 2 - zw / 2;
    const zg = ctx.createLinearGradient(zx - 8, 0, zx + zw + 8, 0);
    zg.addColorStop(0, 'transparent');
    zg.addColorStop(0.2, zoneCol);
    zg.addColorStop(0.8, zoneCol);
    zg.addColorStop(1, 'transparent');
    ctx.save();
    ctx.fillStyle = zoneCol;
    ctx.fillRect(zx, by, zw, 18);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = zg;
    ctx.fillRect(zx - 8, by, zw + 16, 18);
    ctx.restore();
    // Shine on zone
    ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
    ctx.fillRect(zx, by, zw, 5); ctx.restore();
    // Marker
    const mx = bx + markerPos(tm.t) * bw;
    const inZone = Math.abs(markerPos(tm.t) - 0.5) <= TIMING.window;
    // marker glow when in zone
    if (inZone) {
      const mg = ctx.createRadialGradient(mx, by + 9, 0, mx, by + 9, 14);
      mg.addColorStop(0, isDodge ? 'rgba(160,200,255,0.55)' : 'rgba(255,255,200,0.55)'); mg.addColorStop(1, 'transparent');
      ctx.save(); ctx.fillStyle = mg; ctx.fillRect(mx - 14, by - 6, 28, 30); ctx.restore();
    }
    if (inZone) {
      ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = markerGlow;
      ctx.fillStyle = markerGlow; ctx.fillRect(mx - 3, by - 6, 6, 30); ctx.restore();
    } else {
      ctx.fillStyle = '#f0f4ff'; ctx.fillRect(mx - 3, by - 6, 6, 30);
    }
  }

  // Pause menu (Esc on desktop, the top-left button on touch).
  function openPauseMenu() {
    host.push(makeMenu(
      [
        { label: 'Resume', value: 'resume', color: OK },
        { label: 'Return to Hub', value: 'hub', color: BAD },
      ],
      {
        title: 'Paused',
        onPick(v) {
          if (v === 'resume') host.pop();
          else if (v === 'hub') { app.music('hub'); app.stack.pop(); }
        },
        onCancel() { host.pop(); },
      }
    ));
  }

  function btnBox(ctx, r) {
    ctx.save();
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#11131e';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#4a5280'; ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.restore();
  }

  function drawPauseButton(ctx) {
    const { x, y, w, h } = PAUSE_BTN;
    btnBox(ctx, PAUSE_BTN);
    ctx.save();
    ctx.globalAlpha = 0.92; ctx.fillStyle = '#cfd6f0';
    const bw = 6, bh = 20, gap = 8, cx = x + w / 2, cy = y + h / 2;
    ctx.fillRect(cx - gap / 2 - bw, cy - bh / 2, bw, bh);
    ctx.fillRect(cx + gap / 2, cy - bh / 2, bw, bh);
    ctx.restore();
  }

  // The touch toolbar: speed (cycles AI speed), info (cycles hunter readout), and
  // undo (only while steering, when there's a step to take back).
  function drawToolbar(ctx) {
    btnBox(ctx, SPEED_BTN);
    // Speed label
    text(ctx, `${aiSpeed}×`, SPEED_BTN.x + SPEED_BTN.w / 2, SPEED_BTN.y + 6, { size: 12, align: 'center', color: '#cfd6f0' });
    // 7-segment bar: one pip per speed level (1×/2×/4×/8×/16×/32×/64×)
    { const LEVELS = [1, 2, 4, 8, 16, 32, 64];
      const curIdx = LEVELS.indexOf(aiSpeed);
      const nSegs = LEVELS.length, segW = 4, segGap = 1;
      const totalBarW = nSegs * segW + (nSegs - 1) * segGap;
      const bsx = (SPEED_BTN.x + (SPEED_BTN.w - totalBarW) / 2) | 0;
      const bsy = SPEED_BTN.y + 22;
      const segH = 10;
      for (let i = 0; i < nSegs; i++) {
        const filled = i <= curIdx;
        const sx = bsx + i * (segW + segGap);
        ctx.fillStyle = filled ? '#f0c050' : '#222638';
        ctx.fillRect(sx, bsy, segW, segH);
        if (filled) {
          ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = '#fff';
          ctx.fillRect(sx, bsy, segW, 2); ctx.restore();
        }
      }
    }
    text(ctx, 'speed', SPEED_BTN.x + SPEED_BTN.w / 2, SPEED_BTN.y + 35, { size: 8, align: 'center', color: '#8088a8' });

    btnBox(ctx, INFO_BTN);
    text(ctx, 'i', INFO_BTN.x + INFO_BTN.w / 2, INFO_BTN.y + 10, { size: 20, align: 'center', color: '#cfd6f0' });
    text(ctx, 'info', INFO_BTN.x + INFO_BTN.w / 2, INFO_BTN.y + 32, { size: 8, align: 'center', color: '#8088a8' });

    if (steering && undoStack.length) {
      btnBox(ctx, UNDO_BTN);
      text(ctx, '↶', UNDO_BTN.x + UNDO_BTN.w / 2, UNDO_BTN.y + 11, { size: 22, align: 'center', color: '#cfd6f0' });
      text(ctx, 'undo', UNDO_BTN.x + UNDO_BTN.w / 2, UNDO_BTN.y + 32, { size: 8, align: 'center', color: '#8088a8' });
    }
  }

  function drawSteerHint(ctx, st) {
    const _sh = st.current?.kind === 'hunter' ? st.hunters?.[st.current.index] : null;
    const _sc = _sh ? (SLOT_COLORS[(_sh.slot ?? 0) % 4] ?? '#3c4364') : '#3c4364';
    box(ctx, 724, 420, 232, 84, { title: 'STEER', stroke: _sc });
    const rem = st.move?.remaining ?? 0;
    const used = st.move?.path?.length ?? 0;
    const total = Math.max(rem + used, 1);
    // Step progress dots: green→yellow→red as steps drain
    const dotW = 11, dotH = 7, n = Math.min(total, 8);
    for (let d = 0; d < n; d++) {
      const filled = d < rem;
      ctx.fillStyle = filled ? (rem <= 2 ? BAD : rem <= Math.ceil(total / 2) ? '#f2df4a' : OK) : '#1e2134';
      ctx.fillRect(736 + d * 14, 439, dotW, dotH);
      if (filled) {
        ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
        ctx.fillRect(736 + d * 14, 439, dotW, 3); ctx.restore();
        if (rem <= 2) {
          // Urgency halo on remaining steps
          const up = 0.20 + 0.18 * Math.sin(hudT * 6.0);
          const ug = ctx.createRadialGradient(736 + d * 14 + dotW / 2, 443, 1, 736 + d * 14 + dotW / 2, 443, 12);
          ug.addColorStop(0, BAD); ug.addColorStop(1, 'transparent');
          ctx.save(); ctx.globalAlpha = up; ctx.fillStyle = ug;
          ctx.fillRect(736 + d * 14 - 6, 432, dotW + 12, 20); ctx.restore();
        }
      }
    }
    if (rem <= 2) {
      ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = BAD;
      text(ctx, `${rem} step${rem !== 1 ? 's' : ''} left`, 736, 456, { size: 12, color: BAD, shadow: false });
      ctx.restore();
    } else {
      text(ctx, `${rem} step${rem !== 1 ? 's' : ''} left`, 736, 456, { size: 12, color: FG });
    }
    text(ctx, 'arrows: step \xb7 Enter: stop', 736, 472, { size: 11, color: DIM });
    text(ctx, used > 0 ? 'Z / Backspace: undo step' : 'Z: undo (after a step)', 736, 486,
      { size: 11, color: undoStack.length ? OK : DIM });
  }

  function drawHud(ctx, st) {
    const X = 724, W = 232;
    box(ctx, X, 6, W, 30);
    // Active-unit slot-color dot + ambient wash on round info bar
    const _cur = st.current;
    const _ci = _cur?.kind === 'hunter' ? (st.hunters?.[_cur.index]?.slot ?? _cur.index) : -1;
    const _sc = SLOT_COLORS[_ci >= 0 ? _ci % 4 : 0] ?? '#cc4a3a';
    if (_ci >= 0) {
      const rwash = 0.06 + 0.04 * Math.sin(hudT * 2.4);
      ctx.save(); ctx.globalAlpha = rwash;
      const rg = ctx.createLinearGradient(X + 4, 8, X + W - 4, 8);
      rg.addColorStop(0, _sc); rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg; ctx.fillRect(X + 4, 8, W - 8, 26); ctx.restore();
    }
    ctx.fillStyle = _sc; ctx.fillRect(X + 3, 9, 3, 22);
    const _deckCount = st.deck?.length ?? '?';
    const _deckLow = typeof _deckCount === 'number' && _deckCount < 20;
    const _deckUrgent = typeof _deckCount === 'number' && _deckCount < 5;
    const _deckCol = _deckUrgent ? BAD : _deckLow ? '#e0a850' : FG;
    if (_deckUrgent) {
      const dp = 0.13 + 0.11 * Math.sin(hudT * 5.5);
      const dr = ctx.createRadialGradient(X + 100, 20, 2, X + 100, 20, 42);
      dr.addColorStop(0, BAD); dr.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = dp; ctx.fillStyle = dr;
      ctx.fillRect(X + 58, 6, 76, 26); ctx.restore();
    }
    ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = '#906000';
    text(ctx, `R${st.round ?? '?'}`, X + 10, 13, { size: 13, color: GOLD, shadow: false });
    ctx.restore();
    if (_deckUrgent || _deckLow) {
      ctx.save(); ctx.shadowBlur = _deckUrgent ? 8 : 4; ctx.shadowColor = _deckUrgent ? BAD : '#c07830';
      text(ctx, `deck ${_deckCount}`, X + 62, 13, { size: 13, color: _deckCol, shadow: false });
      ctx.restore();
    } else {
      text(ctx, `deck ${_deckCount}`, X + 62, 13, { size: 13, color: _deckCol });
    }
    { const rp = 0.06 + 0.04 * Math.sin(hudT * 1.5);
      const rrg = ctx.createRadialGradient(X + 164, 20, 2, X + 164, 20, 38);
      rrg.addColorStop(0, '#a898c8'); rrg.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = rp; ctx.fillStyle = rrg;
      ctx.fillRect(X + 126, 6, 78, 26); ctx.restore(); }
    ctx.save(); ctx.shadowBlur = 4; ctx.shadowColor = '#7860a8';
    const _relicLabel = g.runState
      ? `D${g.runState.depth} · L${st.relicLevel ?? '?'}`
      : `relic L${st.relicLevel ?? '?'}`;
    text(ctx, _relicLabel, X + 138, 13, { size: 13, color: '#a898c8', shadow: false });
    ctx.restore();
    if ((st.fortune ?? 0) > 0) {
      ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = GOLD;
      text(ctx, `✦${st.fortune}`, X + W - 8, 13, { size: 12, align: 'right', color: GOLD, shadow: false });
      ctx.restore();
    }

    (st.hunters || []).forEach((h, i) => {
      const y = 42 + i * 62;
      const activeNow = st.current?.kind === 'hunter' && st.current.index === i;
      box(ctx, X, y, W, 58, { stroke: activeNow ? GOLD : '#3c4364' });
      // Slot-color thin bar on left edge of every hunter panel
      { const sc = SLOT_COLORS[h.slot ?? i];
        ctx.save(); ctx.globalAlpha = activeNow ? 0.80 : 0.30;
        ctx.fillStyle = sc; ctx.fillRect(X + 2, y + 2, 3, 54); ctx.restore(); }
      // Slot-color glow wash behind active hunter panel
      if (activeNow) {
        const sc = SLOT_COLORS[h.slot ?? i];
        const pulse = 0.08 + 0.06 * Math.sin(hudT * 2.4);
        ctx.save(); ctx.globalAlpha = pulse;
        const ag = ctx.createLinearGradient(X + 4, y, X + W - 4, y);
        ag.addColorStop(0, sc); ag.addColorStop(1, 'transparent');
        ctx.fillStyle = ag; ctx.fillRect(X + 4, y + 2, W - 8, 54); ctx.restore();
      }
      { const ia = PALETTE_ACCENT[h.palette] ?? '#3c4364';
        const ig = ctx.createRadialGradient(X + 32, y + 30, 2, X + 32, y + 30, 26);
        ig.addColorStop(0, ia + '28'); ig.addColorStop(1, 'transparent');
        ctx.fillStyle = ig; ctx.fillRect(X + 4, y + 2, 56, 54); }
      sprite(app, `hunter${h.spriteId}.${h.palette}.icon`, X + 6, y + 6, 4);
      { const nc = SLOT_COLORS[h.slot ?? i];
        ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = nc;
        text(ctx, h.name ?? `P${i + 1}`, X + 60, y + 6, { size: 14, color: nc, shadow: false });
        ctx.restore(); }
      if (h.hasTarget) {
        const tp = 0.18 + 0.14 * Math.sin(hudT * 3.2);
        const tr = ctx.createRadialGradient(X + W - 18, y + 14, 2, X + W - 18, y + 14, 18);
        tr.addColorStop(0, GOLD); tr.addColorStop(1, 'transparent');
        ctx.save(); ctx.globalAlpha = tp; ctx.fillStyle = tr;
        ctx.fillRect(X + W - 36, y + 2, 32, 24); ctx.restore();
        sprite(app, 'ui.targetMark', X + W - 24, y + 6, 2);
      }
      // HP bar
      const ratio = Math.max(0, (h.hp ?? 0) / (h.maxHp || 1));
      ctx.fillStyle = '#1a1c2e';
      ctx.fillRect(X + 60, y + 26, 120, 10);
      if (ratio > 0) {
        const [c0, c1] = ratio > 0.5 ? ['#52da68', '#2d8f40'] : ratio > 0.25 ? ['#f2df4a', '#b89818'] : ['#f07060', '#a83028'];
        const hg = ctx.createLinearGradient(X + 60, y + 26, X + 60, y + 36);
        hg.addColorStop(0, c0); hg.addColorStop(1, c1);
        ctx.fillStyle = hg;
        ctx.fillRect(X + 60, y + 26, 120 * ratio, 10);
        ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
        ctx.fillRect(X + 60, y + 26, 120 * ratio, 4); ctx.restore();
        if (ratio <= 0.25) {
          const urgency = 0.5 + 0.5 * Math.sin(hudT * 6.5);
          ctx.save(); ctx.globalAlpha = urgency * 0.45; ctx.fillStyle = '#ff9a7e';
          ctx.fillRect(X + 60, y + 26, Math.round(120 * ratio), 10); ctx.restore();
        }
      }
      const hpCol = ratio <= 0.25 ? (0.5 + 0.5 * Math.sin(hudT * 6)) > 0.5 ? BAD : '#9d2a2a' : DIM;
      if (ratio <= 0.25) {
        ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = BAD;
        text(ctx, `${h.hp}/${h.maxHp}`, X + 186, y + 22, { size: 11, color: hpCol, shadow: false });
        ctx.restore();
      } else {
        text(ctx, `${h.hp}/${h.maxHp}`, X + 186, y + 22, { size: 11, color: hpCol });
      }
      { const hc = h.hand?.length ?? 0, bc = h.items?.length ?? 0;
        const bagFull = bc >= 6;
        if (bagFull) {
          // Pulsing danger glow behind bag count when full
          const bp2 = 0.18 + 0.14 * Math.sin(hudT * 5);
          ctx.save(); ctx.globalAlpha = bp2; ctx.fillStyle = BAD;
          ctx.fillRect(X + 118, y + 38, 60, 14); ctx.restore();
        }
        ctx.font = '11px Consolas, "Courier New", monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        let hbx = X + 60;
        const hsegs = [
          { t: 'hand ', c: DIM }, { t: String(hc), c: hc > 0 ? '#4a7dff' : DIM },
          { t: '  bag ', c: DIM }, { t: bagFull ? `${bc} FULL` : String(bc), c: bagFull ? BAD : bc > 0 ? GOLD : DIM },
        ];
        for (const seg of hsegs) {
          ctx.fillStyle = seg.c; ctx.fillText(seg.t, hbx, y + 40);
          hbx += ctx.measureText(seg.t).width;
        } }
      // status glyphs — pulsing colored background behind each icon
      let sx = X + 160;
      for (const sk of ['stun', 'leg', 'panic', 'empty']) {
        if (!h.status?.[sk]) continue;
        const sp2 = 0.40 + 0.40 * Math.sin(hudT * 4.5 + (sk === 'stun' ? 0 : sk === 'leg' ? 2.1 : sk === 'panic' ? 4.2 : 1.05));
        ctx.save(); ctx.globalAlpha = sp2 * 0.72; ctx.fillStyle = STATUS_GLOW_COLORS[sk] ?? '#9aa0b4';
        ctx.fillRect(sx - 1, y + 39, 18, 16); ctx.restore();
        sprite(app, `status.${sk}`, sx, y + 40, 2);
        // Turn-count badge on countable statuses (stun/panic/empty > 1)
        const skVal = h.status[sk];
        if (sk !== 'leg' && typeof skVal === 'number' && skVal > 1) {
          ctx.save();
          ctx.font = 'bold 8px Consolas, "Courier New", monospace'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
          ctx.fillStyle = '#000'; ctx.fillText(String(skVal), sx + 16, y + 54);
          ctx.fillStyle = STATUS_GLOW_COLORS[sk] ?? '#fff'; ctx.fillText(String(skVal), sx + 15, y + 53);
          ctx.restore();
        }
        sx += 18;
      }
    });

    if ((st.monsters || []).length > 0) {
      ctx.save(); ctx.globalAlpha = 0.30; ctx.fillStyle = BAD;
      ctx.fillRect(X + 4, 286, W - 8, 1); ctx.restore();
    }
    (st.monsters || []).forEach((mo, i) => {
      const my = 290 + i * 22;
      const mkc = MONSTER_KIND_COLOR[mo.kind] ?? BAD;
      ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = mkc;
      text(ctx, mo.kind, X + 10, my, { size: 11, color: mkc, shadow: false });
      ctx.restore();
      const mr = Math.max(0, mo.maxHp ? mo.hp / mo.maxHp : 0);
      const mfill = Math.round(88 * mr);
      ctx.fillStyle = '#151828'; ctx.fillRect(X + 52, my + 2, 88, 7);
      if (mfill > 0) {
        const isWyrm = mo.kind === 'WYRM';
        const [mc0, mc1] = isWyrm
          ? (mr > 0.5 ? ['#9850d8', '#6030a8'] : mr > 0.25 ? ['#c060f0', '#8030c0'] : ['#e050ff', '#a020d0'])
          : (mr > 0.5 ? ['#e05a3a', '#a02820'] : mr > 0.25 ? ['#f07020', '#a04810'] : ['#ff4a3a', '#c02020']);
        const mmg = ctx.createLinearGradient(X + 52, my + 2, X + 52, my + 9);
        mmg.addColorStop(0, mc0); mmg.addColorStop(1, mc1);
        ctx.fillStyle = mmg; ctx.fillRect(X + 52, my + 2, mfill, 7);
        ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
        ctx.fillRect(X + 52, my + 2, mfill, 3); ctx.restore();
        if (mr <= 0.25) {
          ctx.save(); ctx.globalAlpha = 0.10 + 0.09 * Math.sin(hudT * 6);
          ctx.fillStyle = isWyrm ? '#c020ff' : '#ff2020';
          ctx.fillRect(X + 52, my, 88, 11); ctx.restore();
        }
      }
      ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = mkc;
      text(ctx, `${mo.hp}/${mo.maxHp}`, X + W - 8, my, { size: 10, align: 'right', color: mkc, shadow: false });
      ctx.restore();
    });

    // info panel (Tab cycles)
    const h = (st.hunters || [])[infoIndex];
    if (h) {
      const infoAccent = PALETTE_ACCENT[h.palette] ?? '#3c4364';
      box(ctx, X, 344, W, 72, { title: `INFO: ${h.name} (Tab)`, stroke: infoAccent + '88' });
      { const ig = ctx.createLinearGradient(X + 4, 344, X + 70, 344);
        ig.addColorStop(0, infoAccent + '22'); ig.addColorStop(1, 'transparent');
        ctx.fillStyle = ig; ctx.fillRect(X + 4, 346, W - 8, 68); }
      const d = displayStats(h.internal ?? { mv: 1, at: 1, df: 1, hp: 1 }, h.level ?? 1);
      { const iSegs = [
          { t: `Lv${h.level}  `, c: GOLD },
          { t: `MV+${d.mv} `, c: '#3a6ee0' },
          { t: `AT${d.at} `, c: '#cc4a3a' },
          { t: `DF${d.df}`, c: '#e0c63a' },
        ];
        ctx.font = font(12, true);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        let isx = X + 10;
        for (const seg of iSegs) {
          ctx.fillStyle = '#000'; ctx.fillText(seg.t, isx + 1, 371);
          ctx.fillStyle = seg.c; ctx.fillText(seg.t, isx, 370);
          isx += Math.round(ctx.measureText(seg.t).width);
        } }
      // Info panel item names: per-category color, wrapping to two rows
      { const slots = h.items || [];
        if (!slots.length) {
          text(ctx, 'no items', X + 10, 386, { size: 11, color: DIM });
        } else {
          ctx.font = font(11, true); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
          const maxW = W - 22;
          let ix = 0, iy = 386, rowW = 0;
          for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            const nm = itemName(slot);
            const cat = slot.identified ? ITEMS[slot.itemId]?.category : null;
            const nc = cat ? (ITEM_CAT_COLOR[cat] ?? DIM) : DIM;
            const sep = si > 0 ? ', ' : '';
            const sw = Math.round(ctx.measureText(sep + nm).width);
            if (rowW + sw > maxW && rowW > 0) {
              if (iy >= 400) break; // only 2 rows
              ix = X + 10; iy = 400; rowW = 0;
            }
            if (sep) { ctx.fillStyle = DIM; ctx.fillText(sep, ix, iy); ix += Math.round(ctx.measureText(sep).width); }
            ctx.fillStyle = '#000'; ctx.fillText(nm, ix + 1, iy + 1);
            ctx.fillStyle = nc; ctx.fillText(nm, ix, iy);
            const nw = Math.round(ctx.measureText(nm).width);
            ix += nw; rowW += sw;
          }
        } }
    }

    // mission goal
    const targetName = st.targetItemId ? (ITEMS[st.targetItemId]?.name ?? st.targetItemId) : 'Target';
    const GOAL_TEXT = {
      fetch: 'Grab ' + targetName + ' → EXIT',
      rescue: 'Reach survivor first',
      resteal: 'Steal Target from carrier → EXIT',
    };
    const goalLine = GOAL_TEXT[st.missionType] ?? ('Grab ' + targetName + ' → EXIT');
    const rivalHold = st.missionType === 'rescue' && (st.rescueHoldRounds ?? 0) > 0;
    const targetHeld = (st.hunters || []).some((h) => h.hasTarget);
    if (targetHeld) {
      // Gold pulse behind GOAL box — signals Target is live on the board
      const tgp = 0.10 + 0.08 * Math.sin(hudT * 2.5);
      const tgr = ctx.createRadialGradient(X + W / 2, 446, 6, X + W / 2, 446, W * 0.55);
      tgr.addColorStop(0, GOLD); tgr.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = tgp; ctx.fillStyle = tgr;
      ctx.fillRect(X, 424, W, rivalHold ? 60 : 44); ctx.restore();
    }
    box(ctx, X, 424, W, rivalHold ? 60 : 44, { title: st.missionTitle ?? 'GOAL', stroke: targetHeld ? GOLD : undefined });
    if (targetHeld) {
      ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = '#906000';
      text(ctx, goalLine, X + 10, 450, { size: 11, color: GOLD, shadow: false });
      ctx.restore();
    } else {
      const goalIdleColor = { rescue: OK, resteal: BAD }[st.missionType] ?? DIM;
      text(ctx, goalLine, X + 10, 450, { size: 11, color: goalIdleColor });
    }
    if (rivalHold) {
      const rivalsFree = st.round > (st.rescueHoldRounds ?? 0);
      const holdText = rivalsFree ? 'rivals active!' : ('rivals hold R1-R' + st.rescueHoldRounds);
      if (rivalsFree) {
        ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = BAD;
        text(ctx, holdText, X + 10, 466, { size: 10, color: BAD, shadow: false });
        ctx.restore();
      } else {
        text(ctx, holdText, X + 10, 466, { size: 10, color: DIM });
      }
    }

    // Live score — shows the human hunter's running tally so decisions feel legible
    { const human = (st.hunters || []).find((h) => h.human);
      if (human) {
        const rows = scoreRows(st);
        const row = rows.find((r) => r.id === human.id);
        if (row) {
          const pts = row.total;
          const topScore = Math.max(...rows.map((r) => r.total));
          const isLeading = pts >= topScore;
          const scoreCol = isLeading ? OK : '#8090d8';
          ctx.save(); ctx.shadowBlur = 4; ctx.shadowColor = isLeading ? OK : '#304080';
          text(ctx, `Score: ${pts} pts`, X + 10, 474, { size: 10, color: scoreCol, shadow: false });
          ctx.restore();
        }
      }
    }
    // Active run perks — remind player of accumulated perks during Relic Dive
    if (g.runState?.perks?.length) {
      const perkNames = g.runState.perks.map((id) => describePerk(id)?.name ?? id).filter(Boolean);
      const MAX_SHOW = 3;
      const shown = perkNames.slice(0, MAX_SHOW);
      const extra = perkNames.length - MAX_SHOW;
      const pLine = shown.join(' · ') + (extra > 0 ? ` +${extra}` : '');
      text(ctx, pLine, X + 10, 486, { size: 10, color: '#9060d8' });
    }
    // AI speed hint — always visible so players discover the [ / ] keys
    text(ctx, `[ / ] AI speed: ${aiSpeed}\xd7`, X + 10, 498, { size: 10, color: DIM });

    // Minimap — board overview in the sidebar gap between GOAL and HAND panels
    if (st.board) {
      const b2 = st.board;
      const MSCALE = 3, MW = b2.w * MSCALE, MH = b2.h * MSCALE;
      const mx = X + Math.floor((W - MW) / 2), mmy = 514;
      ctx.save();
      ctx.fillStyle = '#0c0d12';
      ctx.fillRect(mx, mmy, MW, MH);
      ctx.fillStyle = '#22253a';
      for (let ty = 0; ty < b2.h; ty++)
        for (let tx = 0; tx < b2.w; tx++)
          if (b2.floor[ty][tx]) ctx.fillRect(mx + tx * MSCALE, mmy + ty * MSCALE, MSCALE, MSCALE);
      // Exit
      ctx.fillStyle = '#3eca74';
      ctx.fillRect(mx + b2.exit.x * MSCALE, mmy + b2.exit.y * MSCALE, MSCALE, MSCALE);
      // Boxes: gold pulse for TARGET, brown for others, skip opened
      (b2.boxes || []).forEach((bx) => {
        if (bx.opened) return;
        if (bx.contents === 'TARGET') {
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(hudT * 3);
          ctx.fillStyle = '#e8d87e';
        } else { ctx.fillStyle = '#7a5a28'; }
        ctx.fillRect(mx + bx.x * MSCALE, mmy + bx.y * MSCALE, MSCALE, MSCALE);
        ctx.globalAlpha = 1;
      });
      // Flags — dim colored dot for each unclaimed flag
      const FLAG_MAP_COLOR = { Red: '#cc3333', Blue: '#3a6ee0', Green: '#3aa84a', Yellow: '#e0c63a' };
      (b2.flags || []).forEach((f) => {
        if (f.taken) return;
        const cap = f.color[0].toUpperCase() + f.color.slice(1);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = FLAG_MAP_COLOR[cap] ?? '#aaa';
        ctx.fillRect(mx + f.x * MSCALE, mmy + f.y * MSCALE, MSCALE, MSCALE);
        ctx.globalAlpha = 1;
      });
      // Revealed traps — dim orange pixel
      ctx.globalAlpha = 0.50;
      ctx.fillStyle = '#e07830';
      (b2.traps || []).forEach((tr) => {
        if (tr.revealed) ctx.fillRect(mx + tr.x * MSCALE, mmy + tr.y * MSCALE, MSCALE, MSCALE);
      });
      ctx.globalAlpha = 1;
      // Rescue NPC — cyan pulse
      if (b2.rescue && !b2.rescue.claimed) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(hudT * 2.5);
        ctx.fillStyle = '#4af0c4';
        ctx.fillRect(mx + b2.rescue.x * MSCALE, mmy + b2.rescue.y * MSCALE, MSCALE, MSCALE);
        ctx.globalAlpha = 1;
      }
      // Monsters — red
      ctx.fillStyle = '#cc3333';
      (st.monsters || []).forEach((m) => {
        if (m.pos) ctx.fillRect(mx + m.pos.x * MSCALE, mmy + m.pos.y * MSCALE, MSCALE, MSCALE);
      });
      // Hunters — slot-colored dot with black outline
      (st.hunters || []).forEach((h, i) => {
        if (!h.pos) return;
        const sc = SLOT_COLORS[(h.slot ?? i) % 4] ?? '#fff';
        ctx.fillStyle = '#000';
        ctx.fillRect(mx + h.pos.x * MSCALE - 1, mmy + h.pos.y * MSCALE - 1, MSCALE + 2, MSCALE + 2);
        ctx.fillStyle = sc;
        ctx.fillRect(mx + h.pos.x * MSCALE, mmy + h.pos.y * MSCALE, MSCALE, MSCALE);
      });
      ctx.strokeStyle = '#383c58';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - 0.5, mmy - 0.5, MW + 1, MH + 1);
      ctx.restore();
    }

    // the human's hand, mini cards — show active human's hand; handoff card in multi-human games
    const me = A.isHumanTurn(st) ? A.resolveUnit(st, A.currentChooser(st)) : null;
    if (me && handoff) {
      box(ctx, X, 576, W, 136, { title: 'HAND', stroke: '#4a7dff' });
      ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#4a7dff';
      ctx.fillRect(X + 4, 580, W - 8, 128); ctx.restore();
      text(ctx, `${handoff.name}'s HAND`, X + W / 2, 608, { size: 13, align: 'center', color: '#4a7dff' });
      text(ctx, 'pass the device', X + W / 2, 630, { size: 11, align: 'center', color: DIM });
      text(ctx, 'press any key to reveal', X + W / 2, 648, { size: 11, align: 'center', color: DIM });
    } else if (me) {
      box(ctx, X, 576, W, 136, { title: 'HAND' });
      (me.hand || []).slice(0, 6).forEach((cid, i) => {
        const cx = X + 10 + (i % 5) * 43, cy = 604 + Math.floor(i / 5) * 50;
        let color = 'red';
        try { color = cardColor(cid); } catch { /* unknown id */ }
        ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
        ctx.fillRect(cx + 3, cy + 3, 42, 60); ctx.restore();
        // Color-matched glow behind every card; first card gets a brighter gold pulse
        { const cc2 = CARD_HEX[color] ?? '#ffe98a';
          const baseAlpha = i === 0 ? (0.12 + 0.08 * Math.sin(hudT * 2.2)) : 0.06;
          const cg = ctx.createRadialGradient(cx + 21, cy + 28, 2, cx + 21, cy + 28, 28);
          cg.addColorStop(0, i === 0 ? GOLD : cc2); cg.addColorStop(1, 'transparent');
          ctx.save(); ctx.globalAlpha = baseAlpha; ctx.fillStyle = cg;
          ctx.fillRect(cx - 4, cy - 2, 50, 64); ctx.restore(); }
        sprite(app, `card.${color}`, cx, cy, 3);
        { const cv = String(cid).slice(1), cc = CARD_HEX[color] ?? FG;
          text(ctx, cv, cx + 21, cy + 22, { size: 14, align: 'center', color: cc });
          ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = cc;
          text(ctx, cv, cx + 21, cy + 22, { size: 14, align: 'center', color: cc, shadow: false });
          ctx.restore(); }
      });
      // Deck composition — surfaces known-quantity input randomness (F5 / design-principles doc)
      if (st.deck) {
        const byColor = { red: 0, yellow: 0, blue: 0, green: 0 };
        let eCards = 0;
        for (const cid of (st.deck || [])) {
          try { const col = cardColor(cid); byColor[col] = (byColor[col] || 0) + 1; } catch {}
          if (cid === 'BE') eCards++;
        }
        const dyY = 670;
        ctx.font = font(9, false);
        ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        let bx2 = X + 10;
        const dsegs = [
          { t: `R:${byColor.red}`, c: CARD_HEX.red },
          { t: `  Y:${byColor.yellow}`, c: CARD_HEX.yellow },
          { t: `  B:${byColor.blue - eCards}`, c: CARD_HEX.blue },
          { t: `  G:${byColor.green}`, c: CARD_HEX.green },
        ];
        if (eCards > 0) dsegs.push({ t: `  E:${eCards}`, c: BAD });
        for (const seg of dsegs) {
          ctx.fillStyle = '#000'; ctx.fillText(seg.t, bx2 + 1, dyY + 1);
          ctx.fillStyle = seg.c; ctx.fillText(seg.t, bx2, dyY);
          bx2 += Math.round(ctx.measureText(seg.t).width);
        }
        text(ctx, 'deck remaining', X + W - 8, dyY, { size: 9, align: 'right', color: DIM, shadow: false, bold: false });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RESULTS — §2.12 score rows + placements, then roster updates + save.

const PLACE = ['1st', '2nd', '3rd', '4th'];

export function makeResultsScreen(app, g) {
  const st = g.state;
  const rows = scoreRows(st);
  const order = st.result?.placements && Array.isArray(st.result.placements)
    ? st.result.placements.map((ref) => rows.find((r) => r.id === (ref?.id ?? ref)) ?? null).filter(Boolean)
    : [...rows].sort((a, b) => b.total - a.total);
  const placeOf = (id) => order.findIndex((r) => r.id === id);
  const win = !!(st.result?.win ?? g.outcome.won);
  let applied = false;
  let depthScore = 0; // primary hunter's score for this depth (relic dive)

  function applyToRoster() {
    if (applied) return;
    applied = true;
    const humans = st.hunters.filter((h) => h.human);
    if (!humans.length) return;
    const winnerId = g.outcome.winnerRef != null ? app.adapt.resolveUnit(st, g.outcome.winnerRef)?.id : null;
    const wipe = !win && app.session.mode === 'normal' && /wyrm/i.test(String(g.outcome.reason ?? ''));
    // Primary (P1) hunter drives story-mode clear.
    const primaryId = app.session.hunterId;
    const primary = humans.find((h) => h.id === primaryId) ?? humans[0];
    const primaryWon = win && (winnerId ? winnerId === primary.id : !!primary.hasTarget);
    const storyCleared = app.session.mode === 'story' && primaryWon;
    const hunterEntries = humans.map((human) => {
      const row = rows.find((r) => r.id === human.id);
      const humanWon = win && (winnerId ? winnerId === human.id : !!human.hasTarget);
      return {
        id: human.id, _won: humanWon,
        score: row?.total ?? 0,
        items: (human.items || []).map((s) => ({ ...s })),
        maxHp: human.maxHp,
        returnedTarget: humanWon && !!human.hasTarget,
        targetPrice: ITEMS[st.targetItemId]?.price ?? 0,
      };
    });
    // Capture primary score for relic dive depth result
    const primaryEntry = hunterEntries.find((e) => e.id === primaryId) ?? hunterEntries[0];
    { const raw = primaryEntry?.score ?? 0;
      depthScore = (g.runState && perkHasEffect(g.runState.perks ?? [], 'descendBonus'))
        ? Math.floor(raw * 1.5) : raw; }
    app.roster.hunters = applyResults(app.roster.hunters, {
      relicLevel: st.relicLevel, win: primaryWon, wipe, storyCleared,
      hunters: hunterEntries,
    }, g.runState?.perks ?? []);
    for (const entry of hunterEntries) {
      const fresh = app.roster.hunters.find((r) => r.id === entry.id);
      if (!fresh) continue;
      fresh.record = { missions: (fresh.record?.missions ?? 0) + 1, wins: (fresh.record?.wins ?? 0) + (entry._won ? 1 : 0) };
      if (storyCleared && entry.id === primary.id && typeof g.mission?.id === 'number') {
        fresh.storyProgress = Math.max(fresh.storyProgress ?? 0, g.mission.id);
      }
    }
    // Record the primary human hunter's score in the personal-best board.
    // Relic Dive: total run score is recorded in makeRunSummaryScreen instead.
    if (primaryEntry && primaryEntry.score > 0 && app.session.mode !== 'relic-dive') {
      const lbMode = app.session.mode === 'story' ? 'story' : 'normal';
      addLeaderboardEntry(lbMode, {
        name: primary.name ?? 'Hunter',
        score: primaryEntry.score,
        extras: { missionId: g.mission?.id ?? null },
      });
    }
    app.save();
  }

  let t = 0;
  // pre-seed celebration particles so they're deterministic (same positions every draw before t updates)
  const CONFETTI_COLORS = ['#ffe98a', '#7ee8a0', '#9adfe8', '#e88aff', '#ff9a7e'];
  const confetti = win ? Array.from({ length: 60 }, (_, i) => ({
    x: (i * 137.508) % app.W,
    y: -((i * 47) % app.H),
    vx: ((i % 7) - 3) * 0.4,
    vy: 1.2 + (i % 5) * 0.35,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    w: 6 + (i % 4) * 2,
    h: 4 + (i % 3),
    rot: (i * 0.44) % (Math.PI * 2),
    spin: ((i % 7) - 3) * 0.04,
  })) : [];
  // Ash motes drift slowly downward on failure
  const ASH_COLORS = ['#3c2030', '#4a2828', '#302030', '#483838', '#201820'];
  const ashMotes = !win ? Array.from({ length: 28 }, (_, i) => ({
    x: (i * 179.13) % app.W,
    y: (i * 83.7) % app.H,
    vx: ((i % 5) - 2) * 0.15,
    vy: 0.35 + (i % 4) * 0.12,
    color: ASH_COLORS[i % ASH_COLORS.length],
    w: 4 + (i % 3) * 2,
    h: 4 + (i % 3) * 2,
    rot: (i * 0.71) % (Math.PI * 2),
    spin: ((i % 5) - 2) * 0.012,
  })) : [];
  return {
    enter() { app.music(win ? 'results' : 'gameover'); },
    update(dt) {
      t += dt;
      if (win) {
        for (const c of confetti) {
          c.x += c.vx;
          c.y += c.vy;
          c.rot += c.spin;
          if (c.y > app.H + 20) c.y = -20;
        }
      } else {
        for (const m of ashMotes) {
          m.x += m.vx;
          m.y += m.vy;
          m.rot += m.spin;
          if (m.y > app.H + 20) m.y = -20;
        }
      }
    },
    onKey(k, e) {
      if (k === 'confirm' || k === 'cancel') {
        if (t < 1.8) { t = 1.8; return; } // skip count-up on first press
        sfx.menuConfirm();
        applyToRoster();
        if (g.runState) {
          g.runState.depthResults.push({ won: win, score: depthScore });
          if (win) {
            // Save ending HP so next depth can carry it over
            g.runState.hunterHps = {};
            for (const h of (st.hunters || []).filter((h) => h.human)) {
              g.runState.hunterHps[h.id] = h.hp;
            }
            app.stack.replace(makePerkPickScreen(app, g));
          } else {
            app.stack.replace(makeRunSummaryScreen(app, g));
          }
          return;
        }
        app.stack.pop(); // back to the hub
        return;
      }
      if (e?.code === 'KeyR' && g.mission && !g.runState) {
        if (t < 1.8) t = 1.8;
        sfx.menuConfirm();
        applyToRoster();
        app.startMission(g.mission); // replay — replaces RESULTS with GAME
      }
      if (e?.code === 'KeyH' && win && !g.runState && t >= 1.8) {
        sfx.menuConfirm();
        applyToRoster();
        // Route back to the actual Hub before launching the Daily Hunt (D20):
        // story leaves Client below RESULTS, so a blind single pop misses the Hub.
        if (!app.stack.popToTag('hub')) app.stack.pop();
        app.stack.push(makeRelicDiveScreen(app, { daily: true }));
      }
    },
    onClick() { this.onKey('confirm'); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      // Confetti particles on win; ash motes on fail
      if (win) {
        ctx.save();
        for (const c of confetti) {
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.rot);
          ctx.globalAlpha = 0.82;
          ctx.fillStyle = c.color;
          ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
          ctx.restore();
        }
        ctx.restore();
      } else {
        ctx.save();
        for (const m of ashMotes) {
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.rotate(m.rot);
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = m.color;
          ctx.fillRect(-m.w / 2, -m.h / 2, m.w, m.h);
          ctx.restore();
        }
        ctx.restore();
      }
      // Atmospheric bloom behind the result header
      const rcx = app.W / 2;
      const rbloom = ctx.createRadialGradient(rcx, 42, 8, rcx, 42, 200);
      rbloom.addColorStop(0, win ? 'rgba(180, 140, 20, 0.38)' : 'rgba(140, 30, 30, 0.38)');
      rbloom.addColorStop(1, 'transparent');
      ctx.fillStyle = rbloom;
      ctx.fillRect(rcx - 200, 10, 400, 130);
      // Layered result header text with pulsing glow
      const rtext = win ? 'MISSION COMPLETE' : 'MISSION FAILED';
      const rlay = win ? '#7a5400' : '#7a1010';
      text(ctx, rtext, rcx + 3, 29, { size: 34, align: 'center', color: '#000', shadow: false });
      text(ctx, rtext, rcx + 1, 27, { size: 34, align: 'center', color: rlay, shadow: false });
      ctx.save();
      ctx.shadowBlur = 24 + 10 * Math.sin(t * 1.8);
      ctx.shadowColor = win ? '#c8960a' : '#aa2020';
      text(ctx, rtext, rcx, 26, { size: 34, align: 'center', color: win ? GOLD : BAD, shadow: false });
      ctx.restore();
      if (g.mission?.id != null)
        text(ctx, `M${String(g.mission.id).padStart(2, '0')} · ${g.mission.title ?? ''}`, rcx, 66,
          { size: 14, align: 'center', color: win ? GOLD : DIM });
      else if (!win && g.outcome.reason)
        text(ctx, String(g.outcome.reason), app.W / 2, 66, { size: 14, align: 'center', color: BAD });
      // Separator + score table
      ctx.save(); ctx.fillStyle = win ? GOLD : BAD; ctx.globalAlpha = 0.45;
      ctx.fillRect(40, 92, app.W - 80, 1); ctx.restore();
      const x0 = 40, cw = 168, lx = x0 + 160;
      // Subtle table area tint
      ctx.save(); ctx.fillStyle = win ? GOLD : BAD; ctx.globalAlpha = 0.06;
      ctx.fillRect(lx, 95, rows.length * cw, 435); ctx.restore();
      // 1st-place column highlight on win
      if (win && order.length > 0) {
        const fi = rows.findIndex((r) => r.id === order[0].id);
        if (fi >= 0) { ctx.save(); ctx.fillStyle = GOLD; ctx.globalAlpha = 0.09;
          ctx.fillRect(lx + fi * cw, 95, cw, 435); ctx.restore(); }
      }
      const labels = ['', 'Movement', 'Damage', 'Flags', 'Kills', 'Handicap', 'Items', 'TOTAL', 'Place', 'Credits'];
      const LABEL_COLORS = ['', '#3a6ee0', '#cc4a3a', '#e0c63a', '#cc4a3a', '#a060d8', '#3aa84a'];
      // Per-category color matching label rows (indices 0-5 = moved/damage/flags/kills/handicap/items)
      const SCORE_CAT_COLORS = ['#3a6ee0', '#cc4a3a', '#e0c63a', '#cc4a3a', '#a060d8', '#3aa84a'];
      // Subtle alternating row tints
      labels.forEach((s, i) => {
        if (i % 2 === 0 && i > 0 && i < 7) {
          ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(x0, 122 + i * 40, app.W - x0 * 2, 40); ctx.restore();
        }
        const lc = i >= 7 ? GOLD : (LABEL_COLORS[i] ?? DIM);
        text(ctx, s, x0, 130 + i * 40, { size: 16, color: lc });
      });
      // Per-category maximum for proportional score bars
      const maxVals = [
        Math.max(1, ...rows.map(r => r.moved)),
        Math.max(1, ...rows.map(r => r.damage)),
        Math.max(1, ...rows.map(r => r.flagPts)),
        Math.max(1, ...rows.map(r => r.killPts)),
        Math.max(1, ...rows.map(r => r.handicap)),
        Math.max(1, ...rows.map(r => r.itemPts)),
      ];
      rows.forEach((r, i) => {
        const x = lx + i * cw;
        const h = st.hunters[i];
        const isFirst = win && placeOf(r.id) === 0;
        // Left border per column in slot color
        ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = SLOT_COLORS[h.slot ?? i];
        ctx.fillRect(x, 95, 2, 435); ctx.restore();
        // Animated icon: winner marches after count-up; others stay idle
        const rIconFrame = (isFirst && t >= 1.8) ? (Math.floor(t * 3) % 2 ? 'step' : 'idle') : 'icon';
        const iconBob = (isFirst && t >= 1.8) ? Math.round(Math.sin(t * 4) * 2) : 0;
        sprite(app, `hunter${h.spriteId}.${h.palette}.${rIconFrame}`, x + 30, 96 + iconBob, rIconFrame === 'icon' ? 4 : 3);
        if (isFirst) {
          // Persistent soft winner tint + continuous column pulse after reveal
          ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = GOLD;
          ctx.fillRect(x + 2, 95, cw - 2, 48); ctx.restore();
          if (t >= 2.4) {
            const colPulse = 0.06 + 0.04 * Math.sin(t * 1.8);
            ctx.save(); ctx.globalAlpha = colPulse; ctx.fillStyle = GOLD;
            ctx.fillRect(x + 2, 95, cw - 2, 435); ctx.restore();
            // Floating gold sparkles rising above the winner portrait
            for (let sj = 0; sj < 5; sj++) {
              const sphase = ((t * 0.55 + sj * 0.23) % 1 + 1) % 1;
              const sx = x + 50 + Math.sin(t * 0.7 + sj * 1.9) * 22;
              const sy = 130 - sphase * 60;
              const sa = Math.min(sphase, 1 - sphase) * 2 * 0.65;
              const ss = sj % 2 === 0 ? 2 : 1.5;
              ctx.save(); ctx.globalAlpha = Math.max(0, sa); ctx.fillStyle = GOLD;
              ctx.fillRect((sx - ss * 0.3) | 0, (sy - ss) | 0, Math.max(1, ss * 0.6) | 0, ss * 2);
              ctx.fillRect((sx - ss) | 0, (sy - ss * 0.3) | 0, ss * 2, Math.max(1, ss * 0.6) | 0);
              ctx.restore();
            }
          }
          // Reveal pulse when count-up finishes (t 1.8–2.4s)
          if (t >= 1.8 && t < 2.4) {
            const fp = Math.sin(((t - 1.8) / 0.6) * Math.PI);
            ctx.save(); ctx.globalAlpha = fp * 0.30; ctx.fillStyle = GOLD;
            ctx.fillRect(x + 2, 95, cw - 2, 435); ctx.restore();
          }
        }
        { const nc = SLOT_COLORS[h.slot ?? i];
          ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = nc;
          text(ctx, r.name, x + 84, 130, { size: 15, align: 'center', color: nc, shadow: false });
          ctx.restore(); }
        // Score count-up animation: values tick from 0 to final over 1.8s
        const cnt = (v) => Math.round(v * Math.min(1, t / 1.8));
        const vals = [r.moved, r.damage, r.flagPts, r.killPts, r.handicap, r.itemPts];
        // Category-colored fill bars behind each score value, proportional to per-category leader
        { const bw2 = cw - 32, bx2 = x + 16;
          vals.forEach((v, j) => {
            const fill = maxVals[j] > 0 ? cnt(v) / maxVals[j] : 0;
            if (fill > 0) {
              const bFill = (bw2 * fill) | 0;
              ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = SCORE_CAT_COLORS[j];
              ctx.fillRect(bx2, 188 + j * 40, bFill, 5); ctx.restore();
              ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff';
              ctx.fillRect(bx2, 188 + j * 40, bFill, 2); ctx.restore();
            }
          }); }
        vals.forEach((v, j) => {
          const counted = cnt(v);
          const catCol = SCORE_CAT_COLORS[j];
          if (t < 1.8 && v > 0) {
            ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = catCol;
            text(ctx, String(counted), x + 84, 170 + j * 40, { size: 15, align: 'center', color: catCol, shadow: false });
            ctx.restore();
          } else if (v > 0) {
            text(ctx, String(counted), x + 84, 170 + j * 40, { size: 15, align: 'center', color: catCol });
          } else {
            text(ctx, '0', x + 84, 170 + j * 40, { size: 15, align: 'center', color: DIM });
          }
        });
        // Winner total score: glowing gold text
        if (isFirst) {
          ctx.save(); ctx.shadowBlur = 18 + 8 * Math.sin(t * 1.8); ctx.shadowColor = '#c8960a';
          text(ctx, String(cnt(r.total)), x + 84, 410, { size: 18, align: 'center', color: GOLD, shadow: false });
          ctx.restore();
        } else {
          ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = '#806010';
          text(ctx, String(cnt(r.total)), x + 84, 410, { size: 18, align: 'center', color: GOLD, shadow: false });
          ctx.restore();
        }
        { const pl = placeOf(r.id);
          const BADGE = ['#c8a020', '#9abce0', '#c87040', null];
          const bc = BADGE[pl] ?? null;
          // 1st place badge gets a pulsing glow
          if (pl === 0 && win) {
            const bgp = 0.22 + 0.18 * Math.sin(t * 2.2);
            const bgg = ctx.createRadialGradient(x + 84, 457, 2, x + 84, 457, 26);
            bgg.addColorStop(0, GOLD); bgg.addColorStop(1, 'transparent');
            ctx.save(); ctx.globalAlpha = bgp; ctx.fillStyle = bgg;
            ctx.fillRect(x + 58, 432, 52, 44); ctx.restore();
          }
          if (bc) {
            ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = bc;
            ctx.fillRect(x + 66, 446, 36, 22); ctx.restore();
            ctx.strokeStyle = bc; ctx.lineWidth = 1;
            ctx.strokeRect(x + 66.5, 446.5, 35, 21);
          }
          { const ptc = pl === 0 ? GOLD : pl === 1 ? '#c0d8f0' : pl === 2 ? '#e09050' : DIM;
            const pGlow = pl === 0 ? '#c09010' : pl === 1 ? '#6090c0' : pl === 2 ? '#b05820' : null;
            if (pGlow) {
              ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = pGlow;
              text(ctx, PLACE[pl] ?? '-', x + 84, 450, { size: 16, align: 'center', color: ptc, shadow: false });
              ctx.restore();
            } else {
              text(ctx, PLACE[pl] ?? '-', x + 84, 450, { size: 16, align: 'center', color: ptc, shadow: false });
            } } }
        ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = OK;
        text(ctx, String(cnt(r.credits)), x + 84, 490, { size: 15, align: 'center', color: OK, shadow: false });
        ctx.restore();
      });
      // Story mode new-mission unlock banner
      if (win && app.session.mode === 'story' && typeof g.mission?.id === 'number' && g.mission.id < 15) {
        const unlockPulse = 0.7 + 0.3 * Math.sin(t * 2.6);
        ctx.save(); ctx.globalAlpha = Math.min(1, (t - 1.8) / 0.4) * unlockPulse;
        ctx.shadowBlur = 14; ctx.shadowColor = OK;
        text(ctx, `NEW MISSION UNLOCKED: M${String(g.mission.id + 1).padStart(2, '0')} · ${STORY_MISSIONS[g.mission.id]?.title ?? ''}`,
          app.W / 2, 560, { size: 15, align: 'center', color: OK, shadow: false });
        ctx.restore();
      } else if (win && app.session.mode === 'story' && g.mission?.id === 15) {
        const cpulse = 0.75 + 0.25 * Math.sin(t * 2.0);
        ctx.save(); ctx.globalAlpha = Math.min(1, (t - 1.8) / 0.4) * cpulse;
        ctx.shadowBlur = 18; ctx.shadowColor = GOLD;
        text(ctx, 'STORY COMPLETE! All 15 missions cleared.', app.W / 2, 560, { size: 15, align: 'center', color: GOLD, shadow: false });
        ctx.restore();
      }
      const replayHint = (g.mission && !g.runState) ? '   R: replay' : '';
      const exitHint = t < 1.8 ? 'Enter: skip'
        : g.runState && win ? 'Enter: Descend or Bank Out'
        : g.runState ? 'Enter: end run'
        : 'Enter: return to hub';
      text(ctx, exitHint + replayHint, app.W / 2, 600, { size: 15, align: 'center', color: FG });
      // Daily Hunt nudge — show for story/normal wins when today's daily hasn't been played
      if (win && !g.runState && app.session.mode !== 'relic-dive') {
        const todayPlayed = loadRelicDiveBest().daily?.dateKey === todayDateKey();
        if (!todayPlayed) {
          const nudgePulse = 0.60 + 0.40 * Math.sin(t * 1.6);
          ctx.save(); ctx.globalAlpha = Math.min(1, (t - 2.0) / 0.5) * nudgePulse;
          ctx.shadowBlur = 8; ctx.shadowColor = '#3aacc8';
          text(ctx, '[ H ] Play today\'s Daily Hunt!', app.W / 2, 626, { size: 12, align: 'center', color: '#3aacc8', shadow: false });
          ctx.restore();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// PERK PICK — choose 1 of 3 perks between depths (Phase 2 horizontal perks).
// Shown after a won depth, before the DESCEND / BANK OUT choice.

export function makePerkPickScreen(app, g) {
  const rs = g.runState;
  const perkSeed = hashRunSeed(rs.rootSeed ^ 0x5e4b3a2c, rs.depth);
  const rng = makeRng(perkSeed);
  const choices = rollPerkChoices(rng, rs.perks ?? []).map(describePerk);
  let idx = 0;
  let t = 0;
  const RARITY_COL = { common: '#60a860', uncommon: '#7090d8', rare: '#d08040' };

  function pick(i) {
    sfx.menuConfirm();
    rs.perks = [...(rs.perks ?? []), choices[i].id];
    app.stack.replace(makeDepthTransitionScreen(app, g));
  }

  return {
    enter() { app.music('hub'); },
    update(dt) { t += dt; },
    onKey(k) {
      if (k === 'left') { idx = (idx + 2) % 3; sfx.menuMove(); }
      else if (k === 'right') { idx = (idx + 1) % 3; sfx.menuMove(); }
      else if (k === 'confirm') pick(idx);
    },
    onClick(pos) {
      const cx = app.W / 2;
      const cardW = 200, cardH = 220, cardY = 230;
      const xs = [cx - 300, cx - 100, cx + 100];
      for (let i = 0; i < 3; i++) {
        if (pos.x >= xs[i] && pos.x < xs[i] + cardW && pos.y >= cardY && pos.y < cardY + cardH) {
          pick(i); return;
        }
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      const cx = app.W / 2;
      ctx.save(); ctx.shadowBlur = 22; ctx.shadowColor = '#9060d8';
      text(ctx, 'CHOOSE A PERK', cx, 50, { size: 32, align: 'center', color: '#c090ff', shadow: false });
      ctx.restore();
      text(ctx, `After Depth ${rs.depth}  ·  Run perks: ${(rs.perks ?? []).length}`,
        cx, 84, { size: 14, align: 'center', color: DIM });
      const myPerks = (rs.perks ?? []).map(describePerk).filter(Boolean);
      if (myPerks.length > 0) {
        const pLine = myPerks.map((p) => p.name).join('  ·  ');
        text(ctx, pLine, cx, 116, { size: 12, align: 'center', color: '#a060d8' });
      }

      const cardW = 200, cardH = 220, cardY = 230;
      const xs = [cx - 300, cx - 100, cx + 100];
      for (let i = 0; i < 3; i++) {
        const p = choices[i];
        const sel = idx === i;
        const col = RARITY_COL[p.rarity] ?? FG;
        box(ctx, xs[i], cardY, cardW, cardH, { stroke: sel ? col : '#3c3464' });
        if (sel) {
          ctx.save(); ctx.globalAlpha = 0.14 + 0.06 * Math.sin(t * 2.5);
          ctx.fillStyle = col; ctx.fillRect(xs[i] + 1, cardY + 1, cardW - 2, cardH - 2);
          ctx.restore();
        }
        text(ctx, p.rarity.toUpperCase(), xs[i] + cardW / 2, cardY + 22,
          { size: 11, align: 'center', color: col });
        text(ctx, p.name, xs[i] + cardW / 2, cardY + 60,
          { size: 18, align: 'center', color: sel ? '#ffffff' : FG });
        // word-wrap description into ~22-char lines
        const words = p.desc.split(' ');
        let line = '', lineY = cardY + 104;
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          if (test.length > 22 && line) {
            text(ctx, line, xs[i] + cardW / 2, lineY, { size: 13, align: 'center', color: DIM });
            lineY += 18; line = w;
          } else line = test;
        }
        if (line) text(ctx, line, xs[i] + cardW / 2, lineY, { size: 13, align: 'center', color: DIM });
        if (sel) text(ctx, '▼ SELECT', xs[i] + cardW / 2, cardY + cardH - 22,
          { size: 12, align: 'center', color: col });
      }
      text(ctx, '← → navigate   Enter: select perk', cx, 484,
        { size: 13, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// DEPTH TRANSITION — "DESCEND or BANK OUT" push-your-luck choice between depths.

export function makeDepthTransitionScreen(app, g) {
  const rs = g.runState;
  const depth = rs.depth;
  const totalScore = rs.depthResults.reduce((s, d) => s + d.score, 0);
  const nextRelicLevel = Math.min(15, rs.startRelicLevel + depth); // depth N+1
  const canDescend = nextRelicLevel <= 15 && depth < 10;
  let t = 0;
  let idx = canDescend ? 0 : 1; // 0 = DESCEND, 1 = BANK OUT

  function descend() {
    rs.depth++;
    sfx.menuConfirm();
    app.startRelicDiveDepth(rs); // replaces screen with GAME for next depth
  }

  function bankOut() {
    sfx.menuConfirm();
    app.stack.replace(makeRunSummaryScreen(app, g));
  }

  return {
    enter() { app.music('hub'); },
    update(dt) { t += dt; },
    onKey(k) {
      if (k === 'left' || k === 'right') {
        if (canDescend) { idx = 1 - idx; sfx.menuMove(); }
      } else if (k === 'confirm') {
        if (idx === 0 && canDescend) descend(); else bankOut();
      } else if (k === 'cancel') bankOut();
    },
    onClick(pos) {
      if (canDescend && pos.x < app.W / 2 && pos.y > 440 && pos.y < 490) descend();
      else if (pos.x >= app.W / 2 && pos.y > 440 && pos.y < 490) bankOut();
      else if (pos.y > 440 && pos.y < 490) bankOut();
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      const cx = app.W / 2;

      // Header
      const bloom = ctx.createRadialGradient(cx, 55, 8, cx, 55, 160);
      bloom.addColorStop(0, `rgba(20,120,60,${(0.32 + 0.06 * Math.sin(t * 1.1)).toFixed(3)})`);
      bloom.addColorStop(1, 'transparent');
      ctx.fillStyle = bloom; ctx.fillRect(cx - 160, 0, 320, 140);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = OK;
      text(ctx, `DEPTH ${depth} CLEARED`, cx, 46, { size: 34, align: 'center', color: OK, shadow: false });
      ctx.restore();
      const relicLvLabel = `Relic Level ${rs.startRelicLevel + depth - 1}`;
      text(ctx, relicLvLabel, cx, 84, { size: 15, align: 'center', color: DIM });

      // Depth row so far
      ctx.save(); ctx.fillStyle = '#2a2a3c'; ctx.globalAlpha = 0.6;
      ctx.fillRect(cx - 200, 108, 400, 36); ctx.restore();
      const depthEmoji = rs.depthResults.map((d) => (d.won ? '▣' : '▢')).join('  ');
      text(ctx, depthEmoji, cx, 116, { size: 14, align: 'center', color: GOLD });
      text(ctx, `Run Score: ${totalScore}  (${rs.depthResults.length} depth${rs.depthResults.length !== 1 ? 's' : ''})`,
        cx, 134, { size: 14, align: 'center', color: FG });

      // Separator
      ctx.save(); ctx.fillStyle = OK; ctx.globalAlpha = 0.35;
      ctx.fillRect(120, 156, app.W - 240, 1); ctx.restore();

      // Next depth preview
      if (canDescend) {
        text(ctx, `DEPTH ${depth + 1}  ›  Relic Level ${nextRelicLevel}`,
          cx, 184, { size: 16, align: 'center', color: '#a090ff' });
        text(ctx, 'Harder dungeon, better score multiplier, items carry over.',
          cx, 206, { size: 13, align: 'center', color: DIM });
      } else {
        text(ctx, 'Maximum depth reached.', cx, 190, { size: 15, align: 'center', color: DIM });
      }

      // Carry-over status — shows HP/items/perks going into the next depth,
      // so DESCEND vs BANK OUT is an informed push-your-luck dilemma (F1)
      { const human = (g.state?.hunters || []).find((h) => h.human);
        if (human) {
          const hpFrac = human.maxHp > 0 ? human.hp / human.maxHp : 0;
          const hpCol = hpFrac > 0.5 ? OK : hpFrac > 0.25 ? '#e0a840' : BAD;
          const items = human.items || [];
          const perks = rs.perks || [];
          box(ctx, cx - 220, 226, 440, canDescend ? 84 : 80, { title: 'CARRY OVER →', stroke: '#3c4364' });
          // HP row with mini-bar
          text(ctx, `HP ${human.hp}/${human.maxHp}`, cx - 200, 254, { size: 12, color: hpCol });
          const barW = 80, barX = cx - 148, barY = 257;
          ctx.fillStyle = '#151828'; ctx.fillRect(barX, barY, barW, 7);
          if (hpFrac > 0) {
            const bfill = Math.round(barW * hpFrac);
            const hg = ctx.createLinearGradient(barX, barY, barX, barY + 7);
            hg.addColorStop(0, hpFrac > 0.5 ? '#50c870' : hpFrac > 0.25 ? '#e0a840' : '#e04040');
            hg.addColorStop(1, hpFrac > 0.5 ? '#30a050' : hpFrac > 0.25 ? '#b07820' : '#c02020');
            ctx.fillStyle = hg; ctx.fillRect(barX, barY, bfill, 7);
          }
          // Items
          const itemLabel = items.length
            ? items.slice(0, 5).map((it) => (it.identified ? ITEMS[it.itemId]?.name : '???') ?? it.itemId).join(', ')
              + (items.length > 5 ? '…' : '')
            : 'no items';
          text(ctx, `Bag: ${itemLabel}`, cx - 200, 272, { size: 11, color: items.length ? GOLD : DIM });
          // Perks
          if (perks.length) {
            const perkLabel = perks.map((id) => describePerk(id)?.name ?? id).join(' · ');
            text(ctx, `Perks: ${perkLabel}`, cx - 200, 288, { size: 10, color: '#a090cc' });
          }
        }
      }

      // DESCEND / BANK OUT buttons
      const BW = 200, BH = 44;
      if (canDescend) {
        const dSel = idx === 0;
        box(ctx, cx - 230, 440, BW, BH, { stroke: dSel ? '#a090ff' : '#3c3464' });
        if (dSel) {
          ctx.save(); ctx.globalAlpha = 0.14 + 0.06 * Math.sin(t * 2.5);
          ctx.fillStyle = '#9060d8'; ctx.fillRect(cx - 229, 441, BW - 2, BH - 2); ctx.restore();
        }
        text(ctx, 'DESCEND ▼', cx - 130, 458, { size: 17, align: 'center', color: dSel ? '#c090ff' : DIM });
      }
      const bSel = idx === 1;
      const bx = canDescend ? cx + 30 : cx - BW / 2;
      box(ctx, bx, 440, BW, BH, { stroke: bSel ? GOLD : '#3c3464' });
      if (bSel) {
        ctx.save(); ctx.globalAlpha = 0.14 + 0.06 * Math.sin(t * 2.5);
        ctx.fillStyle = '#806010'; ctx.fillRect(bx + 1, 441, BW - 2, BH - 2); ctx.restore();
      }
      text(ctx, 'BANK OUT ✓', bx + BW / 2, 458, { size: 17, align: 'center', color: bSel ? GOLD : DIM });

      if (canDescend)
        text(ctx, '← → choose   Enter: confirm', cx, 506, { size: 13, align: 'center', color: DIM });
      else
        text(ctx, 'Enter: bank out and see results', cx, 506, { size: 13, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// RUN SUMMARY — final screen after a relic dive ends (bank out or loss).

export function makeRunSummaryScreen(app, g) {
  const rs = g.runState;
  const totalScore = rs.depthResults.reduce((s, d) => s + d.score, 0);
  const depthsCleared = rs.depthResults.filter((d) => d.won).length;
  const ranOut = rs.depthResults.length > 0 && !rs.depthResults.at(-1).won;
  let t = 0;
  let saved = false;
  let shareStr = '';
  let newBest = false;

  function saveRun() {
    if (saved) return;
    saved = true;
    const record = loadRelicDiveBest();
    const mult = scoreMultiplier(rs.modifiers ?? []);
    const finalScore = Math.round(totalScore * mult);
    shareStr = buildShareString({ daily: rs.daily, dateKey: rs.dateKey, startLevel: rs.startRelicLevel, depthResults: rs.depthResults, finalScore });
    // Personal best and leaderboard both use the multiplied score so the hub
    // and leaderboard display the same number for the same run.
    if (!record.best || finalScore > record.best.score) {
      record.best = { score: finalScore, depths: depthsCleared, shareStr };
      newBest = true;
    }
    if (rs.daily) {
      if (!record.daily || record.daily.dateKey !== rs.dateKey || finalScore > record.daily.score) {
        record.daily = { dateKey: rs.dateKey, score: finalScore, depths: depthsCleared, shareStr };
      }
    }
    saveRelicDiveBest(record);
    const hunterName = app.roster?.hunters?.find((r) => r.id === rs.hunterId)?.name ?? 'Hunter';
    addLeaderboardEntry('relic-dive', {
      name: hunterName,
      score: finalScore,
      extras: { depths: depthsCleared, mult: mult !== 1 ? mult : undefined },
    });
  }

  function copyShare() {
    try {
      if (typeof navigator?.clipboard?.writeText === 'function') {
        navigator.clipboard.writeText(shareStr).catch(() => {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareStr;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch { /* clipboard unavailable */ }
  }

  return {
    enter() { saveRun(); app.music(ranOut ? 'gameover' : 'results'); },
    update(dt) { t += dt; },
    onKey(k, e) {
      if (k === 'confirm' || k === 'cancel') {
        sfx.menuConfirm();
        // Unwind to the actual Hub (D20) — story leaves Client below, so a blind pop misses it.
        if (!app.stack.popToTag('hub')) app.stack.pop();
      }
      if (e?.code === 'KeyS') copyShare();
    },
    onClick(pos) {
      const metaRows = (rs.perks?.length ? 1 : 0) + (rs.modifiers?.length ? 1 : 0);
      const shareBoxY = Math.max(330 + metaRows * 20 + 6, 340);
      const btnY = shareBoxY + 92;
      if (pos.y >= btnY && pos.y < btnY + 36) copyShare();
      else {
        sfx.menuConfirm();
        if (!app.stack.popToTag('hub')) app.stack.pop();
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      const cx = app.W / 2;

      // Header
      const headerColor = ranOut ? BAD : GOLD;
      const headerText = ranOut ? 'RUN ENDED' : 'RUN COMPLETE';
      const bloom = ctx.createRadialGradient(cx, 55, 8, cx, 55, 160);
      bloom.addColorStop(0, ranOut ? `rgba(120,20,20,0.34)` : `rgba(140,110,10,0.34)`);
      bloom.addColorStop(1, 'transparent');
      ctx.fillStyle = bloom; ctx.fillRect(cx - 160, 0, 320, 140);
      ctx.save(); ctx.shadowBlur = 22; ctx.shadowColor = headerColor;
      text(ctx, headerText, cx, 46, { size: 34, align: 'center', color: headerColor, shadow: false });
      ctx.restore();
      const typeLabel = rs.daily ? `Daily Hunt — ${rs.dateKey}` : 'Relic Dive';
      text(ctx, typeLabel, cx, 84, { size: 14, align: 'center', color: rs.daily ? '#3aacc8' : '#9060d8' });

      // Depth row
      ctx.save(); ctx.fillStyle = '#2a2a3c'; ctx.globalAlpha = 0.6;
      ctx.fillRect(cx - 220, 108, 440, 36); ctx.restore();
      const depthRow = rs.depthResults.map((d) => (d.won ? '▣' : '▢')).join('  ');
      text(ctx, depthRow, cx, 116, { size: 14, align: 'center', color: GOLD });
      text(ctx, `Depths reached: ${rs.depthResults.length}  ·  Cleared: ${depthsCleared}`,
        cx, 134, { size: 13, align: 'center', color: FG });

      // Separator
      ctx.save(); ctx.fillStyle = headerColor; ctx.globalAlpha = 0.35;
      ctx.fillRect(120, 156, app.W - 240, 1); ctx.restore();

      // Score (with modifier multiplier if active)
      const mult = scoreMultiplier(rs.modifiers ?? []);
      const finalScore = Math.round(totalScore * mult);
      ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = GOLD;
      text(ctx, `${finalScore}`, cx, 210, { size: 48, align: 'center', color: GOLD, shadow: false });
      ctx.restore();
      if (mult !== 1) {
        text(ctx, `${totalScore} × ${mult.toFixed(2)} (modifiers)`, cx, 242, { size: 12, align: 'center', color: DIM });
        text(ctx, 'total score', cx, 258, { size: 14, align: 'center', color: DIM });
      } else {
        text(ctx, 'total score', cx, 246, { size: 14, align: 'center', color: DIM });
      }

      // New best callout
      if (newBest) {
        const bp = 0.75 + 0.25 * Math.sin(t * 2.0);
        ctx.save(); ctx.globalAlpha = bp; ctx.shadowBlur = 14; ctx.shadowColor = GOLD;
        text(ctx, 'NEW PERSONAL BEST!', cx, 278, { size: 16, align: 'center', color: GOLD, shadow: false });
        ctx.restore();
      }

      // Start level info
      text(ctx, `Started at Relic Level ${rs.startRelicLevel}`,
        cx, 310, { size: 13, align: 'center', color: DIM });

      // Perks + modifiers used this run
      let metaY = 330;
      if (rs.perks?.length) {
        const perkNames = rs.perks.map((id) => describePerk(id)?.name ?? id).join(' · ');
        text(ctx, `Perks: ${perkNames}`, cx, metaY, { size: 11, align: 'center', color: '#a060d8' });
        metaY += 20;
      }
      if (rs.modifiers?.length) {
        const modNames = rs.modifiers.map((id) => MODIFIERS[id]?.name ?? id).join(' · ');
        text(ctx, `Mods: ${modNames}`, cx, metaY, { size: 11, align: 'center', color: '#c07060' });
        metaY += 20;
      }
      const shareBoxY = Math.max(metaY + 6, 340);
      const btnY = shareBoxY + 92;
      const enterY = btnY + 68;

      // Share string box
      if (shareStr) {
        box(ctx, 120, shareBoxY, app.W - 240, 80, { stroke: '#3c3464' });
        const lines = shareStr.split('\n');
        lines.forEach((line, i) => text(ctx, line, cx, shareBoxY + 18 + i * 20, { size: 13, align: 'center', color: FG }));
      }

      // Copy button
      box(ctx, cx - 100, btnY, 200, 36, { stroke: '#3a6ee0' });
      ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = '#3a6ee0';
      ctx.fillRect(cx - 99, btnY + 1, 198, 34); ctx.restore();
      text(ctx, '[ S ] COPY SHARE', cx, btnY + 13, { size: 14, align: 'center', color: '#6a9eee' });

      text(ctx, 'Enter: return to hub', cx, enterY, { size: 14, align: 'center', color: FG });
    },
  };
}

// ---------------------------------------------------------------------------
// MISSION BRIEFING — shown after story mission select, before game start.

export function makeMissionBriefingScreen(app, mission) {
  const TYPE_HINT = {
    fetch:   'Find the Target Item in a box, then carry it to the EXIT to win.',
    rescue:  'Reach the marked survivor before any RAVEN agent does.',
    resteal: 'The Target is already in a rival\'s hands. Steal it, then reach EXIT.',
  };
  const TYPE_COLOR = { fetch: FG, rescue: OK, resteal: BAD };

  let brt = 0;
  // 12 drifting background motes seeded to position — type-colored
  const MOTE_COL = { fetch: GOLD, rescue: OK, resteal: BAD };
  const moteCol = MOTE_COL[mission.type] ?? GOLD;
  const motes = Array.from({ length: 12 }, (_, i) => ({
    x: ((i * 137.508) % 1) * app.W,
    y: ((i * 61.803) % 1) * app.H,
    vx: ((i % 5) - 2) * 0.18,
    vy: -0.22 - (i % 3) * 0.08,
  }));
  return {
    update(dt) {
      brt += dt;
      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;
        if (m.y < -8) m.y = app.H + 4;
        if (m.x < -8) m.x = app.W + 4;
        if (m.x > app.W + 8) m.x = -4;
      }
    },
    onKey(k) {
      if (k === 'confirm') { sfx.menuConfirm(); app.startMission(mission); }
      else if (k === 'cancel') { sfx.menuCancel(); app.stack.pop(); }
    },
    onClick(pos) {
      if (pos.y > app.H - 110) this.onKey('confirm');
      else this.onKey('cancel');
    },
    draw(ctx) {
      const BX = 60, BY = 44, BW = 840, BH = 596;
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      // Floating background motes
      for (const m of motes) {
        const ma = 0.06 + 0.06 * Math.sin(brt * 0.9 + m.x * 0.04);
        ctx.save(); ctx.globalAlpha = ma; ctx.fillStyle = moteCol;
        ctx.fillRect((m.x - 0.5) | 0, (m.y - 1.5) | 0, 2, 4);
        ctx.fillRect((m.x - 1.5) | 0, (m.y - 0.5) | 0, 4, 2);
        ctx.restore();
      }
      // Mission-type colored atmospheric bloom behind the box header
      const tcol = { fetch: 'rgba(200,160,30,', rescue: 'rgba(30,200,80,', resteal: 'rgba(200,50,50,' }[mission.type] ?? 'rgba(200,160,30,';
      const mbloom = ctx.createRadialGradient(app.W / 2, BY + 30, 10, app.W / 2, BY + 30, 200);
      mbloom.addColorStop(0, tcol + '0.32)'); mbloom.addColorStop(1, tcol + '0.0)');
      ctx.fillStyle = mbloom; ctx.fillRect(BX, BY - 20, BW, 120);
      box(ctx, BX, BY, BW, BH, { title: 'MISSION BRIEFING' });

      ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = '#b07a08';
      text(ctx, 'M' + String(mission.id).padStart(2, '0') + '  ' + mission.title,
        BX + 20, BY + 36, { size: 22, color: GOLD, shadow: false });
      ctx.restore();
      // Active hunter card — top-right corner of briefing panel
      { const rec = currentHunter(app);
        if (rec) drawHunterCard(app, rec, BX + BW - 300, BY + 26, 280); }

      { const lvStr = 'Level ';
        ctx.font = font(14, false); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        const lvW = Math.round(ctx.measureText(lvStr).width);
        text(ctx, lvStr, BX + 20, BY + 70, { size: 14, color: DIM });
        ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = '#7860a8';
        text(ctx, String(mission.level), BX + 20 + lvW, BY + 70, { size: 14, color: '#a898c8', shadow: false });
        ctx.restore(); }
      { const tc = TYPE_COLOR[mission.type] || FG;
        ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = tc;
        text(ctx, mission.type.toUpperCase(), BX + 130, BY + 70, { size: 14, color: tc, shadow: false });
        ctx.restore(); }

      ctx.fillStyle = '#3c4364';
      ctx.fillRect(BX + 20, BY + 94, BW - 40, 1);

      let nextY = wrapText(ctx, mission.briefing || 'No briefing on file.',
        BX + 20, BY + 106, BW - 60, 22, { size: 15 });

      nextY = Math.max(nextY, BY + 260);
      ctx.fillStyle = '#3c4364';
      ctx.fillRect(BX + 20, nextY, BW - 40, 1);

      ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#b07a08';
      text(ctx, 'OBJECTIVE', BX + 20, nextY + 10, { size: 12, color: GOLD, shadow: false });
      ctx.restore();
      wrapText(ctx, TYPE_HINT[mission.type] || '', BX + 20, nextY + 28, BW - 60, 20, { size: 14, color: TYPE_COLOR[mission.type] || FG });

      const oppY = nextY + 78;
      ctx.fillStyle = '#3c4364';
      ctx.fillRect(BX + 20, oppY, BW - 40, 1);
      ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#b07a08';
      text(ctx, 'OPPOSITION', BX + 20, oppY + 10, { size: 12, color: GOLD, shadow: false });
      ctx.restore();
      // Per-opponent multi-segment colored rendering
      { const OPP_COLOR = { RAVEN: BAD, keld: '#cc4a3a', mira: '#3a6ee0' };
        const OPP_LABEL = { RAVEN: 'RAVEN agent', keld: 'Keld', mira: 'Mira' };
        ctx.font = font(14, false);
        ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        let ox = BX + 20;
        mission.opponents.forEach((o, oi) => {
          if (oi > 0) {
            ctx.fillStyle = DIM; ctx.fillText(',  ', ox, oppY + 28);
            ox += Math.round(ctx.measureText(',  ').width);
          }
          const label = OPP_LABEL[o] ?? o;
          const col = OPP_COLOR[o] ?? DIM;
          if (OPP_COLOR[o]) {
            ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = col + '80';
            ctx.fillStyle = col; ctx.fillText(label, ox, oppY + 28);
            ctx.restore();
          } else {
            ctx.fillStyle = col; ctx.fillText(label, ox, oppY + 28);
          }
          ox += Math.round(ctx.measureText(label).width);
        }); }

      const depY = BY + BH - 54;
      // Deploy button pulse
      const dpulse = 0.55 + 0.45 * Math.sin(brt * 2.2);
      ctx.save(); ctx.globalAlpha = dpulse * 0.18; ctx.fillStyle = '#3aa84a';
      ctx.fillRect(BX + 20, depY, BW - 40, 44); ctx.restore();
      ctx.fillStyle = 'rgba(20,50,20,0.60)';
      ctx.fillRect(BX + 20, depY, BW - 40, 44);
      ctx.save(); ctx.globalAlpha = dpulse; ctx.strokeStyle = '#3a8a3a'; ctx.lineWidth = 1;
      ctx.strokeRect(BX + 21, depY, BW - 42, 44); ctx.restore();
      // Pulsing green glow along the top edge of the deploy button
      ctx.save(); ctx.globalAlpha = dpulse * 0.55; ctx.fillStyle = '#3aa84a';
      ctx.fillRect(BX + 20, depY, BW - 40, 2); ctx.restore();
      ctx.save(); ctx.shadowBlur = Math.round(12 * dpulse); ctx.shadowColor = '#3aa84a';
      text(ctx, 'Enter: DEPLOY', app.W / 2, depY + 6, { size: 17, align: 'center', color: OK, shadow: false });
      ctx.restore();
      text(ctx, 'Esc: back', app.W / 2, depY + 26, { size: 12, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// MANUAL — multi-page in-game reference, accessible from the title screen.

export function makeManualScreen(app) {
  const PAGES = [
    {
      title: 'THE BASICS',
      sections: [
        { head: 'Goal', headColor: GOLD, body: 'Be the first hunter to carry the Target Item out through the EXIT tile. The Target is hidden inside one of the boxes on the board.' },
        { head: 'Your Turn', headColor: '#3a6ee0', body: 'Each turn: Move (roll 1d6, use cards to extend), Rest (draw 2 cards; 3 from empty hand), or play cards for their effects. You must take at least one action.' },
        { head: 'Target Found', headColor: '#e0c63a', body: 'Once a hunter opens the Target box, everyone on the board knows who holds it. From that point, rivals will pursue the holder.' },
        { head: 'Winning', headColor: OK, body: 'Step onto EXIT while holding the Target to win. In Story mode, a rival exiting with the Target, or the WYRM defeating the holder, ends the game as a loss.' },
      ],
    },
    {
      title: 'MOVEMENT',
      sections: [
        { head: 'Rolling', headColor: '#4a7dff', body: 'Choose Move to roll 1d6. Play Blue cards before or during movement to add +1, +2, or +3 to your budget. You must move at least 1 step.' },
        { head: 'Steering', headColor: '#3a6ee0', body: 'Move one tile at a time with arrow keys. You can backtrack freely. Press Enter to stop early. Movement ends when your budget hits zero.' },
        { head: 'Boxes & Flags', headColor: GOLD, body: 'Boxes open at the end of movement on their tile. Flag tiles trigger a 1d6 roll for points each turn you land or stay on them.' },
        { head: 'Traps', headColor: BAD, body: 'Traps trigger when you step onto their tile. Press a direction key at the right moment to dodge (human players only). Monsters ignore traps.' },
        { head: 'Green Cards', headColor: '#3aa84a', body: 'Playing a Green card places a trap on your current tile before you move. You can dodge your own trap.' },
      ],
    },
    {
      title: 'BATTLE',
      sections: [
        { head: 'Starting a Battle', headColor: '#cc4a3a', body: 'Move onto a tile occupied by another hunter or monster. You are the attacker; they defend.' },
        { head: 'Attacker Options', headColor: '#cc4a3a', body: 'Attack: deal AT damage (play Red cards for +AT). Guard: double your DF (play Yellow). Escape: flee roll vs pursuer MV (play Blue to boost).' },
        { head: 'Defender Options', headColor: '#e0c63a', body: 'Counter: fight back with Red or Yellow cards. Guard: Yellow cards for DF boost, no return damage. Surrender: hand over one item and end combat.' },
        { head: 'Damage & Crits', headColor: BAD, body: 'Damage = (AT + card) - (DF + card), minimum 0. Rolling doubles = Critical Hit. Attacker gains a bonus effect; defender may get Panic. Human defenders can negate crits by pressing a key at the right moment.' },
        { head: 'Defeat', headColor: BAD, body: 'At 0 HP: warp to a random tile, lose 1 permanent max HP, attacker picks one item. HP restores fully on the next turn. The Target changes hands on defeat.' },
      ],
    },
    {
      title: 'CARDS',
      sections: [
        { head: 'Red (20) — Battle AT bonus', headColor: '#e05a4a', body: '+3x3  +4x3  +5x3  +6x3  +7x2  +8x2  +9x2  C (match opp AT)  S (double your AT). Only usable in battle.' },
        { head: 'Yellow (30) — DF / dodge', headColor: '#e0c63a', body: '+3x7  +4x6  +5x5  +6x4  +7x3  +8x2  +9x1  D (double DF / 100% trap dodge)  A (negate all damage / 100% dodge). Raises trap evasion by value x10% while moving.' },
        { head: 'Blue (30) — Movement', headColor: '#4a7dff', body: '+1x16  +2x8  +3x4  E (warp to EXIT; cures Leg Damage; always wins flee roll). E cards are placed in the bottom 49 of the deck.' },
        { head: 'Green (20) — Set Traps', headColor: '#3aa84a', body: 'D (Damage: relicLv+1d6 HP)  S (Stun)  L (Leg Damage)  E (Empty: discard hand). Place on your starting tile before you move.' },
        { head: 'Rest', body: 'An action, not a card. Draw 2 cards (3 from empty hand). If hand is already full (5), still uses your turn.' },
      ],
    },
    {
      title: 'FLAGS',
      sections: [
        { head: 'How Flags Work', body: 'Land on a flag to roll 1-6. You roll again each turn you remain on the same flag. The color determines what the numbers mean.' },
        { head: 'Red Flags', headColor: '#e05a4a', body: '1: 250pts + HP damage trap.  2: 250pts.  3: 500pts.  4: 1000pts.  5: 250pts + HP restore.  6: 250pts + full HP + partial maxHP restore.' },
        { head: 'Blue Flags', headColor: '#4a7dff', body: '1: 250pts + Leg Damage trap.  2: 250pts.  3: 500pts.  4: 1000pts.  5: 250pts + Leg cured.  6: 250pts + Leg cured + act again this turn.' },
        { head: 'Green Flags', headColor: '#3aa84a', body: '1: 250pts + Empty trap.  2: 250pts.  3: 500pts.  4: 1000pts.  5: 250pts + draw 2 cards.  6: 250pts + fill hand to 5.' },
        { head: 'Yellow Flags', headColor: '#e0c63a', body: '1: 250pts + Stun trap.  2: 250pts.  3: 500pts.  4: 1000pts.  5: 1500pts.  6: 2000pts.' },
      ],
    },
    {
      title: 'STATUS EFFECTS',
      sections: [
        { head: 'Stun', headColor: '#d8b83a', body: 'Your next turn is skipped. You cannot counter-attack while stunned. Caused by Stun traps or WYRM critical hits.' },
        { head: 'Leg Damage', headColor: '#4a7dff', body: 'Movement bonus drops to +0 (+1 with a Crutch item). Cured by: landing on EXIT, playing a Blue E card, or a Blue Flag roll of 5 or 6.' },
        { head: 'Panic', headColor: '#e05a4a', body: 'Caused by Critical Hits (if you miss the negate window). AI controls your turn, cycling behaviour patterns each round. A Calmant item clears Panic at the start of your turn.' },
        { head: 'Empty', headColor: '#9aa0b4', body: 'Your entire hand is discarded. You cannot draw new cards while Empty. Clears at end of the current round. Caused by Empty traps or FNG critical hits.' },
      ],
    },
    {
      title: 'MONSTERS',
      sections: [
        { head: 'Spawning', body: 'Up to 2 regular monsters can be present at once. One may appear next to you when you finish a move turn. An identified Wardstone item prevents spawns near you.' },
        { head: 'FNG  (Hunter-Killer)', headColor: '#e09040', body: 'Balanced stats. Critical hit inflicts Empty status. Counter item: Patch.' },
        { head: 'OOZ  (Slime)', headColor: '#50c84a', body: 'High HP, low attack. No special critical rider. Counter item: Repellent.' },
        { head: 'VAC  (Cleaner Bot)', headColor: '#50b0e8', body: 'Fast movement. No special critical rider. Counter item: Override.' },
        { head: 'WYRM  (Dragon)', headColor: '#9870d8', body: 'Appears when the deck runs out. Very high HP. Critical hit inflicts Stun. If WYRM defeats the Target holder the mission ends as a loss. Counter item: Tamer.' },
      ],
    },
    {
      title: 'ITEMS',
      sections: [
        { head: 'Found Sealed', headColor: '#3aacc8', body: 'Items found in boxes arrive sealed (effects inactive). Visit the CLIENT between missions to Appraise them. Fee: 50cr × your level. Monsters sometimes drop counter items — these are always identified.' },
        { head: 'Cursed Items ☠', headColor: BAD, body: 'Cursed items (Black Gem, Fear Stone, Dark Gem, Cursed Gem) activate immediately — identified or not. Their effects are always live, for better or worse. Check what you pick up.' },
        { head: 'Equipment', headColor: GOLD, body: 'Weapons (+AT), Armour (+DF), Escape (+flee roll), Sensors (+trap dodge%) — same category does not stack, strongest applies. Up to 6 inventory slots. AI hunters start with auto-identified items at higher levels.' },
        { head: 'Selling (CLIENT)', headColor: GOLD, body: 'Sell identified items at the CLIENT. Base price uses relic level. Haggle for +10% (30% odds) — failure forces sale at 50% of base. Only identified items can be sold.' },
        { head: 'Counter Items', headColor: '#cc4a3a', body: 'Override (vs VAC), Repellent (vs OOZ), Patch (vs FNG), Tamer (vs WYRM). Attack the matching monster while holding its identified counter item and it fights stunned: DF 0, no counter.' },
      ],
    },
    {
      title: 'SCORING & CREDITS',
      sections: [
        { head: 'Score Sources', headColor: GOLD, body: 'Movement: 15pts/tile.  Damage: 25pts/HP dealt.  Flags: face value per roll.  Monster kills: 500-750 bonus.  Handicap: (relic level - your level) x 250.  Items held: 250pts each.  Target Item: +1250pts.  Cap: 50,000pts.' },
        { head: 'Credits Earned', headColor: GOLD, body: 'Credits = floor(score / 15 x relic level). The hunter who returned the Target also receives its sale price.' },
        { head: 'Story Bonus', headColor: '#3aacc8', body: 'Story mode clear pays an extra 1/4 of the next level-up cost.' },
        { head: 'Hospital', headColor: OK, body: 'Level up costs 1,000cr (Lv1->2) scaling to 46,500cr (Lv14->15). Max HP repair: 50cr x your level per 1 HP restored.' },
      ],
    },
    {
      title: 'MISSION TYPES',
      sections: [
        { head: 'Fetch', headColor: GOLD, body: 'Standard mission. The Target Item is sealed inside one of the boxes. Find it, pick it up, and reach EXIT.' },
        { head: 'Rescue', headColor: OK, body: 'A survivor waits at a fixed position on the board. Reach them first. If a RAVEN agent gets there before you, the mission is lost. RAVEN teams hold back for the first couple of rounds.' },
        { head: 'Re-steal', headColor: BAD, body: 'A RAVEN agent starts the mission already holding the Target. Defeat or outmanoeuvre them to take it, then escape via EXIT.' },
        { head: 'Story Rivals', headColor: '#cc4a3a', body: 'Keld (attack specialist) and Mira (speed specialist) are recurring rivals with stats that scale with mission level. Both use Clever AI: collect items until the Target is found, then pursue relentlessly.' },
      ],
    },
    {
      title: 'RELIC DIVE & DAILY HUNT',
      sections: [
        { head: 'Relic Dive', headColor: '#9060d8', body: 'A chained run of escalating dungeons. Each depth raises the relic level (and the difficulty). Win a depth to DESCEND deeper or BANK OUT and lock in your score.' },
        { head: 'Daily Hunt', headColor: '#3aacc8', body: 'One fixed seed per day — everyone in the world faces the same dungeon. Play once; results are final. Share your score line to compare with friends.' },
        { head: 'Fortune Tokens', headColor: GOLD, body: 'Each depth starts with one Fortune token. Use it before your dice roll to reroll the die. The Lucky perk grants +1 token per depth. Iron Hunter modifier disables Fortune.' },
        { head: 'Carry-Over', headColor: OK, body: 'Your HP and items persist between depths. Manage resources carefully — healing is scarce and every defeat costs max HP until your next hospital visit.' },
      ],
    },
    {
      title: 'PERKS & MODIFIERS',
      sections: [
        { head: 'Perks', headColor: '#a060d8', body: 'After each won depth you choose 1 of 3 perks. Stat perks (+AT/DF/MV, +max HP) stack on every descend. Utility perks: Restless (+1 rest draw), Hoarder (+1 hand cap), Surefoot (safe own traps), Iron Legs (Leg immune), Composed (auto Panic cure), Scout (reveal traps), Warded (no nearby spawns), Lucky (+1 Fortune/depth), Prepared (first box ID\'d), Merchant (+25% credits), Survivor (full heal on descend), Gambler (+50% score / start at half HP).' },
        { head: 'Rarity', headColor: GOLD, body: 'Common (grey): always in the pool.  Uncommon (green): slightly rarer.  Rare (gold): powerful, rarely offered.' },
        { head: 'Modifiers', headColor: BAD, body: 'Optional challenge flags on Relic Dive (not Daily). Each adds a score multiplier. Minefield (2× traps), Sprint (deck 25, fast WYRM), No Rest (no resting), Swarm (3 monsters), Iron Hunter (no Fortune), Exposed (Target box revealed from start).' },
        { head: 'Score Multiplier', headColor: GOLD, body: 'Each active modifier multiplies your total score. Stack modifiers for a higher leaderboard ceiling — but every extra flag makes each depth harder.' },
      ],
    },
  ];

  let page = 0;
  let mt = 0;

  return {
    update(dt) { mt += dt; },
    onKey(k) {
      if (k === 'cancel' || k === 'confirm') { sfx.menuCancel(); app.stack.pop(); }
      else if (k === 'right' || k === 'down') { if (page < PAGES.length - 1) { page++; sfx.menuMove(); } }
      else if (k === 'left' || k === 'up')   { if (page > 0)               { page--; sfx.menuMove(); } }
    },
    onClick(pos) {
      if (pos.x > app.W * 0.72) { if (page < PAGES.length - 1) { page++; sfx.menuMove(); } }
      else if (pos.x < app.W * 0.28) { if (page > 0) { page--; sfx.menuMove(); } }
      else this.onKey('cancel');
    },
    draw(ctx) {
      const BX = 44, BY = 44, BW = 872, BH = 614;
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      drawGoldBloom(ctx, app.W / 2);
      box(ctx, BX, BY, BW, BH, { title: 'HOW TO PLAY' });

      const pg = PAGES[page];
      ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = '#b07a08';
      text(ctx, pg.title, BX + 20, BY + 36, { size: 22, color: GOLD, shadow: false });
      ctx.restore();
      text(ctx, (page + 1) + ' / ' + PAGES.length, BX + BW - 24, BY + 36,
        { size: 14, align: 'right', color: DIM });

      ctx.fillStyle = '#3c4364';
      ctx.fillRect(BX + 20, BY + 66, BW - 40, 1);

      let curY = BY + 78;
      const bodyBottom = BY + BH - 58;
      for (let si = 0; si < pg.sections.length; si++) {
        const sec = pg.sections[si];
        if (curY >= bodyBottom) break;
        const hc = sec.headColor ?? GOLD;
        const hShadow = sec.headColor ? sec.headColor + '80' : '#906000';
        ctx.save(); ctx.shadowBlur = 6; ctx.shadowColor = hShadow;
        text(ctx, sec.head, BX + 20, curY, { size: 13, color: hc, shadow: false });
        ctx.restore();
        curY = wrapText(ctx, sec.body, BX + 28, curY + 18, BW - 60, 17, { size: 13, color: FG });
        curY += 6;
      }

      const navY = BY + BH - 50;
      ctx.fillStyle = 'rgba(10,12,24,0.85)';
      ctx.fillRect(BX + 1, navY, BW - 2, 49);
      ctx.fillStyle = '#3c4364';
      ctx.fillRect(BX + 20, navY, BW - 40, 1);

      if (page > 0) {
        ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = DIM;
        text(ctx, '< Prev', BX + 30, navY + 12, { size: 13, color: FG, shadow: false });
        ctx.restore();
      } else {
        text(ctx, '< Prev', BX + 30, navY + 12, { size: 13, color: '#444', shadow: false });
      }
      text(ctx, 'Esc / Enter: close', app.W / 2, navY + 12,
        { size: 13, align: 'center', color: DIM, shadow: false });
      if (page < PAGES.length - 1) {
        ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = DIM;
        text(ctx, 'Next >', BX + BW - 30, navY + 12, { size: 13, align: 'right', color: FG, shadow: false });
        ctx.restore();
      } else {
        text(ctx, 'Next >', BX + BW - 30, navY + 12, { size: 13, align: 'right', color: '#444', shadow: false });
      }

      const spacing = 14;
      const dotsX = app.W / 2 - ((PAGES.length - 1) * spacing) / 2;
      for (let di = 0; di < PAGES.length; di++) {
        const isCur = di === page;
        const dpulse = isCur ? 3.5 + 1.5 * Math.sin(mt * 3.2) : 3;
        if (isCur) {
          ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = GOLD;
          ctx.beginPath(); ctx.arc(dotsX + di * spacing, navY + 34, dpulse + 5, 0, Math.PI * 2);
          ctx.fill(); ctx.restore();
        }
        ctx.fillStyle = isCur ? GOLD : '#3c4364';
        ctx.beginPath();
        ctx.arc(dotsX + di * spacing, navY + 34, dpulse, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// LEADERBOARD — top-10 per mode; accessible from Hub with [ L ].

export function makeLeaderboardScreen(app) {
  const MODES = [
    { key: 'normal',      label: 'NORMAL',      col: '#7090d8' },
    { key: 'story',       label: 'STORY',       col: GOLD },
    { key: 'relic-dive',  label: 'RELIC DIVE',  col: '#c090ff' },
  ];
  let modeIdx = 0;
  let t = 0;

  return {
    enter() { app.music('hub'); },
    update(dt) { t += dt; },
    onKey(k) {
      if (k === 'left')  { modeIdx = (modeIdx + MODES.length - 1) % MODES.length; sfx.menuMove(); }
      else if (k === 'right') { modeIdx = (modeIdx + 1) % MODES.length; sfx.menuMove(); }
      else if (k === 'cancel') { sfx.menuCancel(); app.stack.pop(); }
    },
    onClick(pos) {
      for (let i = 0; i < MODES.length; i++) {
        const tx = 120 + i * 240;
        if (pos.x >= tx && pos.x < tx + 200 && pos.y >= 60 && pos.y < 106) {
          if (modeIdx !== i) { modeIdx = i; sfx.menuMove(); }
          return;
        }
      }
      if (pos.y > 640) { sfx.menuCancel(); app.stack.pop(); }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      const cx = app.W / 2;
      ctx.save(); ctx.shadowBlur = 18; ctx.shadowColor = GOLD;
      text(ctx, 'PERSONAL BEST', cx, 36, { size: 32, align: 'center', color: GOLD, shadow: false });
      ctx.restore();

      // Mode tabs
      for (let i = 0; i < MODES.length; i++) {
        const m = MODES[i];
        const sel = i === modeIdx;
        const tx = 120 + i * 240;
        box(ctx, tx, 60, 200, 46, { stroke: sel ? m.col : '#3c4364' });
        if (sel) {
          ctx.save(); ctx.globalAlpha = 0.16 + 0.06 * Math.sin(t * 2);
          ctx.fillStyle = m.col; ctx.fillRect(tx + 1, 61, 199, 44); ctx.restore();
        }
        text(ctx, m.label, tx + 100, 78, { size: 15, align: 'center', color: sel ? m.col : DIM });
      }

      // Entries
      const mode = MODES[modeIdx];
      const entries = getLeaderboard(mode.key);
      const listY = 128;
      if (!entries.length) {
        text(ctx, 'No entries yet.', cx, listY + 60, { size: 16, align: 'center', color: DIM });
      } else {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const ey = listY + i * 48;
          const rowCol = i === 0 ? GOLD : i < 3 ? '#c0c8e0' : DIM;
          // Rank badge
          const rankStr = i === 0 ? '★ 1' : `  ${i + 1}`;
          text(ctx, rankStr, 140, ey + 14, { size: i < 3 ? 18 : 15, color: rowCol });
          // Name
          text(ctx, e.name ?? '—', 200, ey + 14, { size: 16, color: i < 3 ? FG : DIM });
          // Score
          text(ctx, `${e.score} pts`, 580, ey + 14, { size: 16, color: rowCol, align: 'right' });
          // Extras (depths for relic-dive, missionId for story)
          if (e.extras?.depths != null)
            text(ctx, `Depth ${e.extras.depths}`, 680, ey + 14, { size: 13, color: DIM });
          else if (e.extras?.missionId != null)
            text(ctx, `M${e.extras.missionId}`, 680, ey + 14, { size: 13, color: DIM });
          // Separator
          if (i < entries.length - 1) {
            ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#a0a8c0';
            ctx.fillRect(120, ey + 34, 720, 1); ctx.restore();
          }
        }
      }
      text(ctx, '← → switch mode   Esc: back', cx, 670, { size: 13, align: 'center', color: DIM });
    },
  };
}

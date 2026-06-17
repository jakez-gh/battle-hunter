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
import { ITEMS, sellPrice } from '../engine/items.js';
import { STORY_MISSIONS, makeNormalMission, applyResults, displayStats, LEVEL_UP_FEES } from '../engine/missions.js';
import { PALETTE_NAMES, HUNTERS as HUNTER_SPRITES } from '../render/sprites.js';
import { setVolumes } from '../audio/synth.js';
import { sfx } from '../audio/sfx.js';
import { makeHunterRecord } from '../save.js';

// ---------------------------------------------------------------------------
// Screen stack

export function createScreenStack() {
  const stack = [];
  const top = () => stack[stack.length - 1] ?? null;
  return {
    top,
    depth: () => stack.length,
    push(s) { stack.push(s); s.enter?.(); },
    pop() {
      const s = stack.pop();
      s?.exit?.();
      top()?.resume?.();
      return s;
    },
    replace(s) {
      const old = stack.pop();
      old?.exit?.();
      stack.push(s);
      s.enter?.();
    },
    update(dt) { top()?.update?.(dt); },
    draw(ctx) { top()?.draw?.(ctx); },
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

const font = (px, bold = true) => `${bold ? 'bold ' : ''}${px}px "Courier New", monospace`;
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

function box(ctx, x, y, w, h, opt = {}) {
  ctx.fillStyle = opt.fill ?? 'rgba(10,12,24,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = opt.stroke ?? '#3c4364';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  if (opt.title) text(ctx, opt.title, x + 10, y + 8, { size: 14, color: GOLD });
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
  { name: 'Tide Lines', base: '#0e1420', accent: '#1c2c4e', pattern: 'stripes' },
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
  ctx.fillStyle = wp.base;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = wp.accent;
  ctx.strokeStyle = wp.accent;
  ctx.lineWidth = 2;
  const S = 48;
  if (wp.pattern === 'grid') {
    for (let x = 0; x <= W; x += S) ctx.fillRect(x, 0, 2, H);
    for (let y = 0; y <= H; y += S) ctx.fillRect(0, y, W, 2);
  } else if (wp.pattern === 'dots') {
    for (let y = S / 2; y < H; y += S) for (let x = S / 2; x < W; x += S) ctx.fillRect(x - 3, y - 3, 6, 6);
  } else if (wp.pattern === 'stripes') {
    for (let y = 0; y < H; y += S) ctx.fillRect(0, y, W, 10);
  } else if (wp.pattern === 'diag') {
    ctx.beginPath();
    for (let x = -H; x < W; x += S) { ctx.moveTo(x, 0); ctx.lineTo(x + H, H); }
    ctx.stroke();
  } else if (wp.pattern === 'rings') {
    for (let y = S; y < H; y += S * 2) for (let x = S; x < W; x += S * 2) {
      ctx.beginPath(); ctx.arc(x, y, S / 3, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Menus — vertical option lists with keyboard + click-to-select-click-to-pick.

function makeMenu(items, { title = '', onPick, onCancel, footer = '' } = {}) {
  const m = {
    title, items, footer, idx: 0, rects: [],
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
          if (m.idx === i) m.pick();
          else if (!m.items[i].disabled) { m.idx = i; sfx.menuMove(); }
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
  const pad = 10;
  const headH = m.title ? 26 : 0;
  const footH = m.footer ? 20 : 0;
  const h = m.items.length * lh + pad * 2 + headH + footH;
  box(ctx, x, y, w, h, { title: m.title });
  m.rects = [];
  let oy = y + pad + headH;
  m.items.forEach((it, i) => {
    const sel = i === m.idx;
    if (sel) {
      ctx.fillStyle = 'rgba(80,100,200,0.35)';
      ctx.fillRect(x + 4, oy - 2, w - 8, lh);
    }
    const color = it.disabled ? '#565d75' : it.color ?? (sel ? '#ffffff' : FG);
    text(ctx, (sel ? '>' : ' ') + it.label, x + 10, oy, { size: opt.size ?? 15, color });
    if (it.right) text(ctx, it.right, x + w - 10, oy, { align: 'right', size: opt.size ?? 14, color: it.disabled ? '#565d75' : DIM });
    m.rects.push({ x: x + 4, y: oy - 2, w: w - 8, h: lh });
    oy += lh;
  });
  if (m.footer) text(ctx, m.footer, x + 10, oy + 2, { size: 12, color: DIM });
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
const itemName = (slot) => {
  const it = ITEMS[slot.itemId];
  if (!it) return slot.itemId;
  if (slot.identified || !it.cursed) return slot.identified ? it.name : `??? (${it.cursed ? 'cursed' : 'sealed'})`;
  return '??? (cursed)';
};

function drawHunterCard(app, rec, x, y, w) {
  const ctx = app.ctx;
  box(ctx, x, y, w, 76);
  sprite(app, `hunter${rec.spriteId}.${rec.palette}.icon`, x + 8, y + 8, 5);
  const d = displayStats(rec.internal, rec.level);
  text(ctx, rec.name, x + 76, y + 8, { size: 18, color: GOLD });
  text(ctx, `Lv ${rec.level}   ${rec.credits} cr`, x + 76, y + 30, { size: 14 });
  text(ctx, fmtStats({ ...d, maxHp: rec.maxHp }) + (rec.maxHp < baseMaxHp(rec) ? `/${baseMaxHp(rec)}` : ''), x + 76, y + 50, { size: 13, color: DIM });
}

// ---------------------------------------------------------------------------
// TITLE

export function makeTitleScreen(app) {
  let t = 0;
  const menu = makeMenu([
    { label: 'STORY', value: 'story' },
    { label: 'NORMAL', value: 'normal' },
    { label: 'OPTIONS', value: 'options' },
  ], {
    onPick(v) {
      if (v === 'options') { app.stack.push(makeOptionsScreen(app)); return; }
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
      // Chunky layered logo
      const cx = app.W / 2;
      const bob = Math.sin(t * 2) * 4;
      for (const [dx, dy, c] of [[8, 8, '#000'], [4, 4, '#5c1d8f'], [0, 0, FG]]) {
        text(ctx, 'BATTLE', cx + dx, 110 + dy + bob, { size: 84, align: 'center', shadow: false, color: c });
      }
      for (const [dx, dy, c] of [[8, 8, '#000'], [4, 4, '#8f6f1d'], [0, 0, GOLD]]) {
        text(ctx, 'HUNTER', cx + dx, 200 + dy + bob, { size: 84, align: 'center', shadow: false, color: c });
      }
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx - 260, 300, 520, 4);
      text(ctx, 'relic dives of the Meridian Salvage Guild', cx, 316, { size: 16, align: 'center', color: DIM });
      // marching hunter sprites
      const step = Math.floor(t * 3) % 2 ? 'step' : 'idle';
      PALETTE_NAMES.slice(0, 4).forEach((pal, i) => {
        sprite(app, `hunter${i * 2}.${pal}.${step}`, cx - 200 + i * 110, 360, 5);
      });
      drawMenu(ctx, menu, cx - 130, 480, 260, { lineH: 34, size: 22 });
      text(ctx, 'arrows/WASD move - Enter confirm - Esc back - Tab info', cx, 660, { size: 13, align: 'center', color: DIM });
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
    const items = hs.map((h) => ({ label: h.name, right: `Lv${h.level} ${h.credits}cr`, value: { kind: 'hunter', id: h.id } }));
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

  return {
    enter() { host.push(rootMenu()); },
    resume() { host.clear(); host.push(rootMenu()); }, // refresh after creation
    onKey(k) { host.key(k); },
    onClick(pos) { host.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      text(ctx, 'HUNTER ROSTER', app.W / 2, 30, { size: 36, align: 'center', color: GOLD });
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
          sprite(app, `hunter${rec.spriteId}.${rec.palette}.idle`, 520, 230, 8);
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
          lines.forEach((s, i) => text(ctx, s, 680, 226 + i * 26, { size: 15 }));
          rec.items.slice(0, 6).forEach((slot, i) =>
            text(ctx, '- ' + itemName(slot), 520, 372 + i * 18, { size: 12, color: DIM }));
        }
      }
      if (!app.roster.hunters.length) {
        text(ctx, 'No hunters registered yet - create one!', 500, 120, { size: 16, color: DIM });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CREATION — 11-point internal allocation (§2.1), live derived stats, name
// entry (<= 7 chars), sprite/palette picker.

export function makeCreationScreen(app) {
  const POOL = 11;
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
    },
    onClick(pos) {
      // click a row to focus it; click again on done/adjustables to act
      for (let i = 0; i < ROWS.length; i++) {
        const r = { x: 60, y: 120 + i * 56 - 4, w: 480, h: 52 };
        if (inRect(pos, r)) {
          if (state.row === i) {
            if (ROWS[i] === 'done') done();
            else if (pos.x > r.x + r.w / 2) adjust(1);
            else adjust(-1);
          } else { state.row = i; sfx.menuMove(); }
          return;
        }
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      text(ctx, 'REGISTER HUNTER', app.W / 2, 26, { size: 32, align: 'center', color: GOLD });
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
      ROWS.forEach((row, i) => {
        const y = 120 + i * 56;
        const sel = state.row === i;
        if (sel) {
          ctx.fillStyle = 'rgba(80,100,200,0.3)';
          ctx.fillRect(56, y - 8, 488, 48);
        }
        const [lab, val] = labels[row];
        if (lab) text(ctx, lab, 70, y, { size: 18, color: sel ? '#fff' : DIM });
        text(ctx, val, 220, y, { size: 18, color: row === 'done' ? (canDone() ? OK : BAD) : FG });
      });
      text(ctx, `Points left: ${left()} / ${POOL}`, 70, 80, { size: 18, color: left() ? GOLD : OK });
      // live preview
      box(ctx, 600, 100, 300, 420, { title: 'PREVIEW' });
      const pal = PALETTE_NAMES[state.palette];
      const frame = Math.floor(state.t * 3) % 2 ? 'step' : 'idle';
      sprite(app, `hunter${state.spriteId}.${pal}.${frame}`, 660, 150, 11);
      text(ctx, state.name || '-------', 750, 350, { size: 22, align: 'center', color: GOLD });
      text(ctx, fmtStats(d), 750, 385, { size: 14, align: 'center' });
      text(ctx, 'displayed: MV=iMV/3  DF=iDF/2', 750, 420, { size: 12, align: 'center', color: DIM });
      text(ctx, 'HP = 7 + 3*iHP', 750, 440, { size: 12, align: 'center', color: DIM });
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
    { id: 'hospital', label: 'HOSPITAL', icon: 'icon.rest', info: 'Repair lost max HP and buy level-ups.' },
    { id: 'options', label: 'OPTIONS', icon: 'icon.move', info: 'Volumes and wallpapers.' },
  ];
  let idx = 0;
  let t = 0;
  const open = (id) => {
    sfx.menuConfirm();
    if (id === 'office') app.stack.push(makeRosterScreen(app, { manage: true }));
    else if (id === 'client') app.stack.push(makeClientScreen(app));
    else if (id === 'hospital') app.stack.push(makeHospitalScreen(app));
    else app.stack.push(makeOptionsScreen(app));
  };
  const iconRect = (i) => ({ x: 120 + i * 190, y: 160, w: 150, h: 130 });
  return {
    enter() { app.music('hub'); },
    resume() { app.music('hub'); },
    update(dt) { t += dt; },
    onKey(k) {
      if (k === 'left') { idx = (idx + ICONS.length - 1) % ICONS.length; sfx.menuMove(); }
      else if (k === 'right') { idx = (idx + 1) % ICONS.length; sfx.menuMove(); }
      else if (k === 'confirm') open(ICONS[idx].id);
      else if (k === 'cancel') { sfx.menuCancel(); app.stack.pop(); } // back to title
    },
    onClick(pos) {
      for (let i = 0; i < ICONS.length; i++) {
        if (inRect(pos, iconRect(i))) {
          if (idx === i) open(ICONS[i].id);
          else { idx = i; sfx.menuMove(); }
          return;
        }
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      text(ctx, 'GUILD HUB', app.W / 2, 40, { size: 40, align: 'center', color: GOLD });
      ICONS.forEach((ic, i) => {
        const r = iconRect(i);
        const sel = i === idx;
        box(ctx, r.x, r.y, r.w, r.h, { stroke: sel ? GOLD : '#3c4364', fill: sel ? 'rgba(40,44,80,0.95)' : 'rgba(10,12,24,0.92)' });
        sprite(app, ic.icon, r.x + r.w / 2 - 30, r.y + 16 + (sel ? Math.sin(t * 5) * 3 : 0), 5);
        text(ctx, ic.label, r.x + r.w / 2, r.y + 96, { size: 16, align: 'center', color: sel ? GOLD : FG });
      });
      box(ctx, 120, 320, 720, 60, {});
      text(ctx, ICONS[idx].info, 140, 340, { size: 15, color: DIM });
      const rec = currentHunter(app);
      if (rec) {
        drawHunterCard(app, rec, 120, 410, 480);
        text(ctx, `${app.session.mode === 'story' ? `STORY - next mission ${Math.min(15, rec.storyProgress + 1)}` : 'NORMAL free-play'}`, 120, 500, { size: 15, color: OK });
        rec.items.slice(0, 6).forEach((slot, i) =>
          text(ctx, '- ' + itemName(slot), 640, 412 + i * 18, { size: 12, color: DIM }));
      } else {
        text(ctx, 'No active hunter - visit the OFFICE first.', 120, 430, { size: 16, color: BAD });
      }
      text(ctx, 'Esc: back to title', app.W / 2, 680, { size: 13, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// CLIENT — mission select, sell with haggle, appraise (§2.13).

export function makeClientScreen(app) {
  const host = makeMenuHost();
  let note = '';

  function rootMenu() {
    const rec = currentHunter(app);
    return makeMenu([
      { label: 'Accept a mission', value: 'mission', disabled: !rec },
      { label: 'Sell items', value: 'sell', disabled: !rec || !rec.items.some((s) => s.identified) },
      { label: 'Appraise items', value: 'appraise', disabled: !rec || !rec.items.some((s) => !s.identified) },
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
      const items = STORY_MISSIONS.map((m) => ({
        label: `M${String(m.id).padStart(2)} ${m.title}`,
        right: m.id <= unlockedTo ? `Lv${m.level} ${m.type}` : 'locked',
        value: m,
        disabled: m.id > unlockedTo,
      }));
      items.push({ label: 'Cancel', value: null });
      return makeMenu(items, {
        title: 'STORY MISSIONS',
        onPick(m) { m ? app.startMission(m) : host.pop(); },
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
      items.push({ label: `Start  (relic Lv${m.level})`, value: { kind: 'start', mission: m }, color: OK });
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
      const items = available.map((h) => ({ label: h.name, right: `Lv${h.level}`, value: h.id }));
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
      { label: `Sell for ${base}cr`, value: 'sell' },
      { label: 'Haggle (30%: +10% / fail: half)', value: 'haggle' },
      { label: 'Keep it', value: 'keep' },
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
      .map(({ slot, i }) => ({ label: itemName(slot), right: `${fee}cr`, value: i, disabled: rec.credits < fee }));
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
    onKey(k) { host.key(k); },
    onClick(pos) { host.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      text(ctx, 'CLIENT DESK', app.W / 2, 30, { size: 34, align: 'center', color: GOLD });
      const rec = currentHunter(app);
      if (rec) drawHunterCard(app, rec, 540, 90, 380);
      host.menus.forEach((m, i) => drawMenu(ctx, m, 60 + i * 30, 100 + i * 40, 440, { lineH: 26 }));
      if (note) text(ctx, note, app.W / 2, 640, { size: 16, align: 'center', color: OK });
      if (app.bootNote) text(ctx, app.bootNote, app.W / 2, 668, { size: 13, align: 'center', color: BAD });
    },
  };
}

// ---------------------------------------------------------------------------
// HOSPITAL — repair maxHP (50cr x level / point), buy level-ups (§2.13).

export function makeHospitalScreen(app) {
  const host = makeMenuHost();
  let note = '';

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
        value: 'repair1',
        disabled: lost <= 0 || rec.credits < perPt,
      },
      {
        label: lost > 0 ? `Repair all (${lost} pts)` : ' ',
        right: lost > 0 ? `${perPt * lost}cr` : '',
        value: 'repairAll',
        disabled: lost <= 0 || rec.credits < perPt * lost,
      },
      {
        label: fee ? `Level up to ${rec.level + 1}` : 'Level up (at cap 15)',
        right: fee ? `${fee}cr` : '',
        value: 'levelup',
        disabled: !fee || rec.credits < fee,
      },
      { label: 'Back', value: 'back' },
    ], {
      title: `HOSPITAL - ${rec.credits}cr`,
      footer: lost > 0 ? `Max HP ${rec.maxHp} / base ${baseMaxHp(rec)}` : `Max HP ${rec.maxHp} (full)`,
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
      { label: 'MV', right: `iMV ${rec.internal.mv} -> move +${Math.floor((rec.internal.mv + 1) / 3)}`, value: 'mv' },
      { label: 'AT', right: `iAT ${rec.internal.at} -> attack ${rec.internal.at + 1}`, value: 'at' },
      { label: 'DF', right: `iDF ${rec.internal.df} -> defense ${Math.floor((rec.internal.df + 1) / 2)}`, value: 'df' },
      { label: 'HP', right: `iHP ${rec.internal.hp} -> max ${d.maxHp + 3}`, value: 'hp' },
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
    onKey(k) { host.key(k); },
    onClick(pos) { host.click(pos); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      text(ctx, 'HOSPITAL', app.W / 2, 30, { size: 34, align: 'center', color: GOLD });
      const rec = currentHunter(app);
      if (rec) drawHunterCard(app, rec, 540, 90, 380);
      host.menus.forEach((m, i) => drawMenu(ctx, m, 60 + i * 30, 100 + i * 40, 440, { lineH: 26 }));
      if (note) text(ctx, note, app.W / 2, 640, { size: 16, align: 'center', color: OK });
      const fees = LEVEL_UP_FEES.map((f, i) => `L${i + 1}>${i + 2}: ${f}`).slice(Math.max(0, (rec?.level ?? 1) - 2), (rec?.level ?? 1) + 2);
      text(ctx, fees.join('   '), app.W / 2, 668, { size: 12, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// OPTIONS — volumes (synth.setVolumes) + wallpaper picker (§2.13).

export function makeOptionsScreen(app) {
  const rows = ['master', 'music', 'sfx', 'wallpaper', 'back'];
  let idx = 0;
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
    } else if (row !== 'back') {
      opts.volumes[row] = Math.round(Math.max(0, Math.min(1, opts.volumes[row] + dir * 0.05)) * 100) / 100;
      setVolumes(opts.volumes);
      sfx.menuMove();
    }
  }

  const leave = () => { app.save(); sfx.menuCancel(); app.stack.pop(); };

  return {
    onKey(k) {
      if (k === 'up') { idx = (idx + rows.length - 1) % rows.length; sfx.menuMove(); }
      else if (k === 'down') { idx = (idx + 1) % rows.length; sfx.menuMove(); }
      else if (k === 'left') adjust(-1);
      else if (k === 'right') adjust(1);
      else if (k === 'confirm' && rows[idx] === 'back') leave();
      else if (k === 'cancel') leave();
    },
    onClick(pos) {
      for (let i = 0; i < rows.length; i++) {
        const r = { x: 240, y: 156 + i * 64, w: 480, h: 56 };
        if (inRect(pos, r)) {
          if (idx === i) {
            if (rows[i] === 'back') leave();
            else adjust(pos.x > r.x + r.w / 2 ? 1 : -1);
          } else { idx = i; sfx.menuMove(); }
          return;
        }
      }
    },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, opts.wallpaper);
      text(ctx, 'OPTIONS', app.W / 2, 50, { size: 36, align: 'center', color: GOLD });
      rows.forEach((row, i) => {
        const y = 160 + i * 64;
        const sel = i === idx;
        if (sel) {
          ctx.fillStyle = 'rgba(80,100,200,0.3)';
          ctx.fillRect(236, y - 10, 488, 52);
        }
        if (row === 'back') {
          text(ctx, 'BACK', 260, y, { size: 20, color: sel ? '#fff' : FG });
          return;
        }
        if (row === 'wallpaper') {
          text(ctx, 'Wallpaper', 260, y, { size: 20, color: sel ? '#fff' : FG });
          text(ctx, `< ${WALLPAPERS[opts.wallpaper].name} >`, 500, y, { size: 18, color: GOLD });
          text(ctx, `${unlocked.length}/${WALLPAPERS.length} unlocked (find Discs)`, 500, y + 24, { size: 12, color: DIM });
          return;
        }
        text(ctx, cap(row), 260, y, { size: 20, color: sel ? '#fff' : FG });
        const v = opts.volumes[row];
        ctx.fillStyle = '#23263a';
        ctx.fillRect(500, y + 4, 200, 14);
        ctx.fillStyle = sel ? GOLD : '#7e9fee';
        ctx.fillRect(500, y + 4, 200 * v, 14);
        text(ctx, `${Math.round(v * 100)}%`, 712, y, { size: 15, color: DIM });
      });
      text(ctx, 'left/right to adjust - Esc saves and exits', app.W / 2, 620, { size: 13, align: 'center', color: DIM });
    },
  };
}

// ---------------------------------------------------------------------------
// GAME — the in-mission screen. Renderer draws the board (through app.adapt);
// this screen runs the human/AI turn pump, builds Actions from input per
// DESIGN §3.2, and draws the HUD/menus/timing minigame on top.

const DIR_BY_KEY = { up: 'N', down: 'S', left: 'W', right: 'E' };
const TIMING = { period: 0.9, window: 0.08, timeout: 2.7 };

export function makeGameScreen(app, g) {
  // g: { state, renderer, mission, outcome:{} } built by app.startMission
  const A = app.adapt;
  const host = makeMenuHost();
  let uiKey = null;        // phase signature the menus were built for
  let steering = false;
  let timing = null;       // { t } while a react.* minigame runs
  let aiDelay = 0.2;
  let infoIndex = 0;
  let banner = null;       // { text, t }
  let inBattleMusic = false;
  let frameDt = 1 / 60;
  let broken = false;
  let finished = false;

  const say = (s, dur = 2.2) => { banner = { text: s, t: dur }; };

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
  }

  function handleEvents(events) {
    for (const ev of events || []) {
      playEventSfx(ev);
      switch (ev.type) {
        case 'battleStarted':
          if (!inBattleMusic) { inBattleMusic = true; app.music('battle'); }
          break;
        case 'turnStarted':
          if (inBattleMusic) { inBattleMusic = false; app.music(g.songBase); }
          break;
        case 'targetFound': say('TARGET ITEM FOUND!'); break;
        case 'boxOpened':
          if (ev.contents && ev.contents !== 'TARGET') say(`Found: ${ITEMS[ev.contents]?.name ?? ev.contents}`);
          break;
        case 'flagClaimed': say(`${cap(ev.color)} flag - rolled ${ev.roll}!`); break;
        case 'monsterSpawned': say(`A ${ev.kind} appears!`); break;
        case 'wyrmSpawned': say('THE WYRM RISES!', 3); break;
        case 'wyrmRespawned': say('The WYRM returns...', 3); break;
        case 'missionWon':
          g.outcome.winnerRef = ev.winner ?? ev.unit ?? null;
          g.outcome.won = true;
          break;
        case 'missionLost':
          g.outcome.reason = ev.reason ?? 'lost';
          g.outcome.won = false;
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
      case 'strikeRolled':
        if (ev.crit) sfx.crit();
        else if ((ev.damage ?? 0) > 0) sfx.hit(ev.damage);
        else sfx.block();
        break;
      case 'critNegated': sfx.block(); break;
      case 'statusInflicted': sfx.error(); break;
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

  const RESPONSE_HINTS = {
    counter: 'Strike back after defending',
    guard: 'DF doubled, no counter',
    escape: 'Roll to flee (2d6+MV+blue)',
    surrender: 'Give 1 item, warp away unhurt',
  };

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

    if (phase === 'turn.steer') { steering = true; return; }
    if (phase === 'react.dodge' || phase === 'react.crit') { timing = { t: 0, kind: phase }; return; }

    if (phase === 'turn.action') {
      const moves = acts.filter((a) => a.type === 'move');
      const attacks = acts.filter((a) => a.type === 'attack');
      const rest = acts.find((a) => a.type === 'rest');
      const items = [];
      if (moves.length) items.push({ label: 'Move', value: () => host.push(subMenu('MOVE - play a card?', moves)) });
      if (attacks.length) items.push({ label: 'Attack', value: () => (attacks.length === 1 ? act(attacks[0]) : host.push(subMenu('ATTACK - target', attacks))) });
      if (rest) items.push({ label: actionLabel(st, rest), value: () => act(rest) });
      for (const a of acts) {
        if (!['move', 'attack', 'rest'].includes(a.type)) items.push({ label: actionLabel(st, a), value: () => act(a) });
      }
      host.push(makeMenu(items, { title: 'YOUR TURN', onPick: (fn) => fn() }));
      return;
    }

    if (phase === 'battle.response') {
      const items = acts.map((a) => ({
        label: actionLabel(st, a),
        right: RESPONSE_HINTS[a.response] ?? '',
        value: () => act(a),
      }));
      host.push(makeMenu(items, { title: 'BATTLE - respond!', onPick: (fn) => fn() }));
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
      host.push(subMenu('MISSION COMPLETE', acts.length ? acts : [{ type: 'confirm' }]));
      return;
    }

    // Unknown phase: generic list keeps the game playable across contract drift.
    if (acts.length) host.push(subMenu(phase || 'CHOOSE', acts));
  }

  function subMenu(title, acts) {
    return makeMenu(acts.map((a) => ({ label: actionLabel(g.state, a), value: a })), {
      title,
      onPick: (a) => act(a),
      onCancel: host.menus.length ? () => { host.pop(); } : null,
    });
  }

  // ---- screen object ----

  return {
    enter() {
      g.songBase = Math.random() < 0.5 ? 'dungeon1' : 'dungeon2';
      app.music(g.songBase);
    },
    update(dt) {
      frameDt = dt;
      if (banner && (banner.t -= dt) <= 0) banner = null;
      if (broken || finished) return;
      if (A.rendererBusy(g.renderer)) return;
      const st = g.state;

      if (st.result) {
        finished = true;
        app.stack.replace(makeResultsScreen(app, g));
        return;
      }

      if (!A.isHumanTurn(st)) {
        host.clear(); steering = false; timing = null; uiKey = null;
        aiDelay -= dt;
        if (aiDelay > 0) return;
        aiDelay = 0.3;
        try {
          act(A.aiAction(st));
        } catch (err) {
          console.error('AI error', err);
          say('AI error - press Esc to leave', 10);
          broken = true;
        }
        return;
      }

      // human's decision
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
        let acts = [];
        try { acts = A.legalActions(st) || []; } catch { /* ignore */ }
        if (DIR_BY_KEY[k]) {
          const step = acts.find((a) => a.type === 'step' && a.dir === DIR_BY_KEY[k]);
          if (step) act(step); else sfx.error();
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
          const dx = tile.x - me.pos.x, dy = tile.y - me.pos.y;
          const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
          const step = acts.find((a) => a.type === 'step' && a.dir === dir);
          if (step) act(step);
        }
      }
    },

    draw(ctx) {
      ctx.fillStyle = '#06060c';
      ctx.fillRect(0, 0, app.W, app.H);
      const st = g.state;
      A.rendererDraw(g.renderer, st, frameDt);
      drawHud(ctx, st);
      const m = host.top();
      if (m) drawMenu(ctx, m, 724, 420, 232, { lineH: 22, size: 13 });
      if (steering) drawSteerHint(ctx, st);
      if (timing) drawTiming(ctx, timing);
      if (banner) {
        const w = Math.max(280, banner.text.length * 12 + 60);
        box(ctx, (680 - w) / 2 + 40, 30, w, 44, { stroke: GOLD });
        text(ctx, banner.text, 380, 42, { size: 17, align: 'center', color: GOLD });
      }
      if (A.rendererBusy(g.renderer)) text(ctx, 'any key: skip', 712, 700, { size: 11, align: 'right', color: DIM });
    },
  };

  // ---- HUD drawing ----

  function markerPos(t) {
    // triangle wave 0..1..0 with period TIMING.period
    const ph = (t % TIMING.period) / TIMING.period;
    return ph < 0.5 ? ph * 2 : 2 - ph * 2;
  }

  function drawTiming(ctx, tm) {
    const x = 160, y = 320, w = 400, h = 84;
    box(ctx, x, y, w, h, { stroke: GOLD, title: tm.kind === 'react.dodge' ? 'DODGE! press at center' : 'BRACE! press at center' });
    const bx = x + 20, bw = w - 40, by = y + 46;
    ctx.fillStyle = '#23263a';
    ctx.fillRect(bx, by, bw, 18);
    const zw = bw * TIMING.window * 2;
    ctx.fillStyle = '#3aa84a';
    ctx.fillRect(bx + bw / 2 - zw / 2, by, zw, 18);
    const mx = bx + markerPos(tm.t) * bw;
    ctx.fillStyle = '#fff';
    ctx.fillRect(mx - 3, by - 6, 6, 30);
  }

  function drawSteerHint(ctx, st) {
    box(ctx, 724, 420, 232, 84, { title: 'STEER' });
    const rem = st.move?.remaining;
    text(ctx, `Steps left: ${rem ?? '?'}`, 736, 448, { size: 15 });
    text(ctx, 'arrows: step', 736, 468, { size: 12, color: DIM });
    text(ctx, 'Enter: stop here', 736, 484, { size: 12, color: DIM });
  }

  function drawHud(ctx, st) {
    const X = 724, W = 232;
    box(ctx, X, 6, W, 30);
    text(ctx, `R${st.round ?? '?'}  deck ${st.deck?.length ?? '?'}  relic L${st.relicLevel ?? '?'}`, X + 10, 13, { size: 13 });

    (st.hunters || []).forEach((h, i) => {
      const y = 42 + i * 62;
      const activeNow = st.current?.kind === 'hunter' && st.current.index === i;
      box(ctx, X, y, W, 58, { stroke: activeNow ? GOLD : '#3c4364' });
      sprite(app, `hunter${h.spriteId}.${h.palette}.icon`, X + 6, y + 6, 4);
      text(ctx, h.name ?? `P${i + 1}`, X + 60, y + 6, { size: 14, color: SLOT_COLORS[h.slot ?? i] });
      if (h.hasTarget) sprite(app, 'ui.targetMark', X + W - 24, y + 6, 2);
      // HP bar
      const ratio = Math.max(0, (h.hp ?? 0) / (h.maxHp || 1));
      ctx.fillStyle = '#23263a';
      ctx.fillRect(X + 60, y + 26, 120, 10);
      ctx.fillStyle = ratio > 0.5 ? '#3aa84a' : ratio > 0.25 ? '#e0c63a' : '#e05a4a';
      ctx.fillRect(X + 60, y + 26, 120 * ratio, 10);
      text(ctx, `${h.hp}/${h.maxHp}`, X + 186, y + 22, { size: 11, color: DIM });
      text(ctx, `hand ${h.hand?.length ?? 0}  bag ${h.items?.length ?? 0}`, X + 60, y + 40, { size: 11, color: DIM });
      // status glyphs
      let sx = X + 160;
      for (const sk of ['stun', 'leg', 'panic', 'empty']) {
        if (h.status?.[sk]) { sprite(app, `status.${sk}`, sx, y + 40, 2); sx += 18; }
      }
    });

    (st.monsters || []).forEach((mo, i) => {
      text(ctx, `${mo.kind} ${mo.hp}/${mo.maxHp}`, X + 10, 296 + i * 16, { size: 12, color: BAD });
    });

    // info panel (Tab cycles)
    const h = (st.hunters || [])[infoIndex];
    if (h) {
      box(ctx, X, 344, W, 72, { title: `INFO: ${h.name} (Tab)` });
      const d = displayStats(h.internal ?? { mv: 1, at: 1, df: 1, hp: 1 }, h.level ?? 1);
      text(ctx, `Lv${h.level}  MV+${d.mv} AT${d.at} DF${d.df}`, X + 10, 370, { size: 12 });
      const names = (h.items || []).map((s) => (s.identified ? ITEMS[s.itemId]?.name ?? s.itemId : '???'));
      text(ctx, names.slice(0, 3).join(', ') || 'no items', X + 10, 386, { size: 11, color: DIM });
      text(ctx, names.slice(3).join(', '), X + 10, 400, { size: 11, color: DIM });
    }

    // mission goal
    const GOAL_TEXT = {
      fetch: 'Grab Target → EXIT',
      rescue: 'Reach survivor first',
      resteal: 'Steal Target from carrier → EXIT',
    };
    box(ctx, X, 424, W, 44, { title: st.missionTitle ?? 'GOAL' });
    text(ctx, GOAL_TEXT[st.missionType] ?? 'Grab Target → EXIT', X + 10, 450, { size: 11, color: DIM });

    // the human's hand, mini cards
    const me = (st.hunters || []).find((x) => x.human);
    if (me) {
      box(ctx, X, 576, W, 136, { title: 'HAND' });
      (me.hand || []).slice(0, 6).forEach((cid, i) => {
        const cx = X + 10 + (i % 5) * 43, cy = 604 + Math.floor(i / 5) * 50;
        let color = 'red';
        try { color = cardColor(cid); } catch { /* unknown id */ }
        sprite(app, `card.${color}`, cx, cy, 3);
        text(ctx, String(cid).slice(1), cx + 21, cy + 22, { size: 14, align: 'center', color: CARD_HEX[color] ?? FG });
      });
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
    app.roster.hunters = applyResults(app.roster.hunters, {
      relicLevel: st.relicLevel, win: primaryWon, wipe, storyCleared,
      hunters: hunterEntries,
    });
    for (const entry of hunterEntries) {
      const fresh = app.roster.hunters.find((r) => r.id === entry.id);
      if (!fresh) continue;
      fresh.record = { missions: (fresh.record?.missions ?? 0) + 1, wins: (fresh.record?.wins ?? 0) + (entry._won ? 1 : 0) };
      if (storyCleared && entry.id === primary.id && typeof g.mission?.id === 'number') {
        fresh.storyProgress = Math.max(fresh.storyProgress ?? 0, g.mission.id);
      }
    }
    app.save();
  }

  return {
    enter() { app.music(win ? 'results' : 'gameover'); },
    onKey(k) {
      if (k === 'confirm' || k === 'cancel') {
        sfx.menuConfirm();
        applyToRoster();
        app.stack.pop(); // back to the hub
      }
    },
    onClick() { this.onKey('confirm'); },
    draw(ctx) {
      drawWallpaper(ctx, app.W, app.H, app.options().wallpaper);
      text(ctx, win ? 'MISSION COMPLETE' : 'MISSION FAILED', app.W / 2, 26, { size: 34, align: 'center', color: win ? GOLD : BAD });
      if (!win && g.outcome.reason) text(ctx, String(g.outcome.reason), app.W / 2, 66, { size: 14, align: 'center', color: DIM });
      const x0 = 40, cw = 168, lx = x0 + 160;
      const labels = ['', 'Movement', 'Damage', 'Flags', 'Kills', 'Handicap', 'Items', 'TOTAL', 'Place', 'Credits'];
      labels.forEach((s, i) => text(ctx, s, x0, 130 + i * 40, { size: 16, color: i >= 7 ? GOLD : DIM }));
      rows.forEach((r, i) => {
        const x = lx + i * cw;
        const h = st.hunters[i];
        sprite(app, `hunter${h.spriteId}.${h.palette}.icon`, x + 30, 96, 4);
        text(ctx, r.name, x + 84, 130, { size: 15, align: 'center', color: SLOT_COLORS[h.slot ?? i] });
        const vals = [r.moved, r.damage, r.flagPts, r.killPts, r.handicap, r.itemPts];
        vals.forEach((v, j) => text(ctx, String(v), x + 84, 170 + j * 40, { size: 15, align: 'center' }));
        text(ctx, String(r.total), x + 84, 410, { size: 18, align: 'center', color: GOLD });
        text(ctx, PLACE[placeOf(r.id)] ?? '-', x + 84, 450, { size: 16, align: 'center', color: placeOf(r.id) === 0 ? OK : FG });
        text(ctx, String(r.credits), x + 84, 490, { size: 15, align: 'center', color: OK });
      });
      text(ctx, 'Enter: collect and return to the hub', app.W / 2, 600, { size: 15, align: 'center', color: DIM });
    },
  };

  // §2.12 rows from the documented tally fields: 15/tile, 25/HP, flag and
  // kill points at face value, handicap (relic - level) x 250, items 250 each
  // and Target 1250, capped at 50,000. Credits = floor(score / 15 x relic).
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
}

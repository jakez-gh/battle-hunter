// Emulator-based mobile validation. Renders the game in real Chromium emulating
// a Samsung Galaxy A15 (landscape, touch, DPR) so we get TRUSTWORTHY mobile
// progress: screenshots to inspect layout/fit, real touch taps, and any runtime
// errors surfaced. Not part of the zero-dep game — requires a one-time:
//   npm i playwright --no-save && npx playwright install chromium   (gitignored)
//
// Run:  node tools/mobile-shot.mjs
// Shots land in tools/shots/ (gitignored).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 8388;
const SHOTS = 'tools/shots';
mkdirSync(SHOTS, { recursive: true });

// Samsung Galaxy A15: 1080x2340 px, ~6.5". Landscape CSS ≈ 873x393 @ ~2.75 DPR.
const A15 = {
  viewport: { width: 873, height: 393 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
};

// Internal game coords are 960x720; the canvas is CSS-scaled to fit the viewport.
// Convert an internal (ix,iy) point to a CSS tap coordinate for touchscreen.tap.
function internalToCss(vw, vh) {
  const cw = Math.min(vw, (vh * 4) / 3);
  const ch = Math.min(vh, (vw * 3) / 4);
  const left = (vw - cw) / 2, top = (vh - ch) / 2;
  return (ix, iy) => ({ x: left + (ix / 960) * cw, y: top + (iy / 720) * ch });
}

const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
await sleep(700);

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext(A15);
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const toCss = internalToCss(A15.viewport.width, A15.viewport.height);
const shot = async (name) => { await page.screenshot({ path: join(SHOTS, name) }); console.log('shot:', name); };
const tapInternal = async (ix, iy, label) => {
  const { x, y } = toCss(ix, iy);
  await page.touchscreen.tap(x, y);
  console.log(`tap ${label ?? ''} @internal(${ix},${iy}) -> css(${x.toFixed(0)},${y.toFixed(0)})`);
  await sleep(500);
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await sleep(1800); // let the rAF loop draw the title
await shot('01-title.png');

// A scripted session can be passed as args, each followed by a screenshot so
// the whole flow is inspectable:
//   "ix,iy,label"     -> a touch tap at internal game coords
//   "key:KeyD,label"  -> a keyboard press (for fast nav via shortcuts)
const script = process.argv.slice(2);
for (let i = 0; i < script.length; i++) {
  const parts = script[i].split(',');
  if (parts[0].startsWith('key:')) {
    const code = parts[0].slice(4);
    await page.keyboard.press(code);
    console.log(`key ${code}`);
    await sleep(600);
  } else {
    await tapInternal(Number(parts[0]), Number(parts[1]), parts[2]);
  }
  await shot(`${String(i + 2).padStart(2, '0')}-${parts[parts.length - 1] || 'step'}.png`);
}

console.log(errors.length ? `\nRUNTIME ERRORS (${errors.length}):\n` + errors.join('\n') : '\nno runtime errors ✓');

await browser.close();
srv.kill();

// Keyboard + mouse + TOUCH routing (DESIGN.md §1.2). Raw DOM events become
// semantic keys and canvas-space points, dispatched to the active screen's
// onKey(sem, e) / onClick(pos, e) / onHover(pos, e). The first user gesture
// calls synth.unlock() (browsers block WebAudio until then). Touch is wired so
// the game is fully playable on a phone (Android): a tap is an onClick, so
// tap-to-move/steer, tap-a-menu, and the tap-timed minigame all work.
import { unlock } from '../audio/synth.js';

// Arrows/WASD steer + move cursors, Enter/Space confirm, Esc cancels,
// Tab cycles HUD info. Screens still receive the raw event for text entry.
export const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
  Escape: 'cancel',
  Tab: 'info',
  Backspace: 'undo', KeyZ: 'undo',
  BracketLeft: 'speedDown', BracketRight: 'speedUp',
};

export function semanticKey(e) {
  return KEY_MAP[e.code] ?? null;
}

// Client coords -> internal canvas pixels (canvas is CSS-scaled, style.css).
// Accepts a mouse event OR a touch event (reads the first/changed touch point).
export function canvasPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const p = e.touches?.[0] ?? e.changedTouches?.[0] ?? e;
  return {
    x: (p.clientX - r.left) * (canvas.width / r.width),
    y: (p.clientY - r.top) * (canvas.height / r.height),
  };
}

// Wire global listeners that route to whatever screen getScreen() returns
// (pass () => stack.top()). Returns { mouse, dispose }.
export function initInput(canvas, getScreen, { onFirstGesture } = {}) {
  let unlocked = false;
  let mouse = { x: 0, y: 0 };

  const gesture = () => {
    if (unlocked) return;
    unlocked = true;
    unlock();
    onFirstGesture?.();
  };

  const keydown = (e) => {
    gesture();
    const sem = semanticKey(e);
    // Mapped keys never scroll the page / steal focus (Space, arrows, Tab).
    if (sem) e.preventDefault();
    getScreen()?.onKey?.(sem, e);
  };
  // mousedown rather than click so the timing minigame measures the press.
  const mousedown = (e) => {
    gesture();
    getScreen()?.onClick?.(canvasPos(canvas, e), e);
  };
  const mousemove = (e) => {
    mouse = canvasPos(canvas, e);
    getScreen()?.onHover?.(mouse, e);
  };
  // Touch: a tap is a press (onClick) at the touch point. preventDefault stops
  // the browser from scrolling/zooming the page or firing a delayed synthetic
  // mousedown (which would double-handle the tap). touchstart fires on contact,
  // so it measures the press for the timing minigame just like mousedown.
  const touchstart = (e) => {
    gesture();
    if (e.cancelable) e.preventDefault();
    mouse = canvasPos(canvas, e);
    getScreen()?.onClick?.(mouse, e);
  };
  const touchmove = (e) => {
    if (e.cancelable) e.preventDefault();
    mouse = canvasPos(canvas, e);
    getScreen()?.onHover?.(mouse, e);
  };
  const touchend = (e) => { if (e.cancelable) e.preventDefault(); };

  window.addEventListener('keydown', keydown);
  canvas.addEventListener('mousedown', mousedown);
  canvas.addEventListener('mousemove', mousemove);
  canvas.addEventListener('touchstart', touchstart, { passive: false });
  canvas.addEventListener('touchmove', touchmove, { passive: false });
  canvas.addEventListener('touchend', touchend, { passive: false });
  return {
    mouse: () => mouse,
    dispose() {
      window.removeEventListener('keydown', keydown);
      canvas.removeEventListener('mousedown', mousedown);
      canvas.removeEventListener('mousemove', mousemove);
      canvas.removeEventListener('touchstart', touchstart);
      canvas.removeEventListener('touchmove', touchmove);
      canvas.removeEventListener('touchend', touchend);
    },
  };
}

// Convenience for driving a single fixed screen (demos/tests).
export function bindScreen(canvas, screen, opts) {
  return initInput(canvas, () => screen, opts);
}

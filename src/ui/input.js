// Keyboard + mouse routing (DESIGN.md §1.2). Raw DOM events become semantic
// keys and canvas-space clicks, dispatched to the active screen's
// onKey(sem, e) / onClick(pos, e) / onHover(pos, e). The first user gesture
// calls synth.unlock() (browsers block WebAudio until then).
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
export function canvasPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
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

  window.addEventListener('keydown', keydown);
  canvas.addEventListener('mousedown', mousedown);
  canvas.addEventListener('mousemove', mousemove);
  return {
    mouse: () => mouse,
    dispose() {
      window.removeEventListener('keydown', keydown);
      canvas.removeEventListener('mousedown', mousedown);
      canvas.removeEventListener('mousemove', mousemove);
    },
  };
}

// Convenience for driving a single fixed screen (demos/tests).
export function bindScreen(canvas, screen, opts) {
  return initInput(canvas, () => screen, opts);
}

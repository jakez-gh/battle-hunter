import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_MAP, semanticKey, canvasPos } from '../src/ui/input.js';

// ---------------------------------------------------------------------------
// KEY_MAP structure.

test('KEY_MAP covers all expected semantic actions', () => {
  const required = {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    confirm: ['Enter', 'NumpadEnter', 'Space'],
    cancel: ['Escape'],
    info: ['Tab'],
  };
  for (const [action, codes] of Object.entries(required)) {
    for (const code of codes) {
      assert.equal(KEY_MAP[code], action, `${code} should map to '${action}'`);
    }
  }
});

// ---------------------------------------------------------------------------
// semanticKey.

test('semanticKey returns the correct semantic for known keycodes', () => {
  assert.equal(semanticKey({ code: 'ArrowUp' }), 'up');
  assert.equal(semanticKey({ code: 'KeyW' }), 'up');
  assert.equal(semanticKey({ code: 'Enter' }), 'confirm');
  assert.equal(semanticKey({ code: 'Space' }), 'confirm');
  assert.equal(semanticKey({ code: 'Escape' }), 'cancel');
  assert.equal(semanticKey({ code: 'Tab' }), 'info');
});

test('semanticKey returns null for unknown keycodes', () => {
  assert.equal(semanticKey({ code: 'KeyZ' }), null);
  assert.equal(semanticKey({ code: 'F1' }), null);
  assert.equal(semanticKey({ code: '' }), null);
  assert.equal(semanticKey({}), null);
});

// ---------------------------------------------------------------------------
// canvasPos: coordinate scaling.

test('canvasPos scales client coords into canvas pixel space', () => {
  const canvas = {
    width: 320,
    height: 240,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 640, height: 480 }),
  };
  // Click at CSS pixel (10 + 320, 20 + 240) → center of the CSS rect.
  const pos = canvasPos(canvas, { clientX: 10 + 320, clientY: 20 + 240 });
  // CSS center → canvas center: 320/2, 240/2
  assert.equal(pos.x, 160);
  assert.equal(pos.y, 120);
});

test('canvasPos handles 1:1 (no CSS scaling)', () => {
  const canvas = {
    width: 320,
    height: 240,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 240 }),
  };
  const pos = canvasPos(canvas, { clientX: 50, clientY: 75 });
  assert.equal(pos.x, 50);
  assert.equal(pos.y, 75);
});

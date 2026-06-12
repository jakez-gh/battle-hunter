import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY, storageArea, freshRoster, defaultOptions, makeHunterRecord,
  loadRoster, saveRoster, exportSave, importSave,
} from '../src/save.js';

const wipe = () => storageArea().removeItem(SAVE_KEY);

test('storageArea falls back to an in-memory store under Node', () => {
  const area = storageArea();
  area.setItem('k', 'v');
  assert.equal(area.getItem('k'), 'v');
  area.removeItem('k');
  assert.equal(area.getItem('k'), null);
});

test('loadRoster with nothing saved returns a fresh roster', () => {
  wipe();
  const r = loadRoster();
  assert.deepEqual(r, freshRoster());
  assert.equal(r.version, 1);
  assert.deepEqual(r.hunters, []);
  assert.deepEqual(r.options, defaultOptions());
});

test('save/load roundtrip preserves the roster', () => {
  wipe();
  const r = freshRoster();
  const rec = makeHunterRecord({
    name: 'KAEL', spriteId: 2, palette: 'ember',
    internal: { mv: 4, at: 5, df: 3, hp: 3 },
  });
  rec.credits = 1234;
  rec.items.push({ itemId: 'wardstone', identified: true });
  rec.storyProgress = 3;
  r.hunters.push(rec);
  r.options.wallpaper = 5;
  saveRoster(r);
  assert.deepEqual(loadRoster(), { ...r, version: 1 });
});

test('saveRoster writes under the versioned key with the current version', () => {
  wipe();
  saveRoster(freshRoster());
  assert.equal(SAVE_KEY, 'battle-hunter-save-v1');
  const raw = storageArea().getItem(SAVE_KEY);
  assert.ok(raw, 'payload stored under SAVE_KEY');
  assert.equal(JSON.parse(raw).version, 1);
});

test('makeHunterRecord derives maxHp per DESIGN 2.1 and gives unique ids', () => {
  const a = makeHunterRecord({ name: 'A', spriteId: 0, palette: 'cobalt', internal: { mv: 1, at: 1, df: 1, hp: 12 } });
  const b = makeHunterRecord({ name: 'B', spriteId: 1, palette: 'moss', internal: { mv: 5, at: 5, df: 4, hp: 1 } });
  assert.equal(a.maxHp, 7 + 3 * 12); // 7 + 3*iHP at level 1
  assert.equal(b.maxHp, 10);
  assert.equal(a.level, 1);
  assert.notEqual(a.id, b.id);
});

test('corrupt JSON is tolerated: loadRoster returns a fresh roster', () => {
  wipe();
  storageArea().setItem(SAVE_KEY, '{not json!!');
  assert.deepEqual(loadRoster(), freshRoster());
});

test('non-object / wrong-version / malformed payloads are tolerated', () => {
  for (const bad of ['42', '"hi"', 'null', JSON.stringify({ version: 99, hunters: [], options: {} }),
    JSON.stringify({ version: 1, hunters: 'nope', options: {} }),
    JSON.stringify({ version: 1, hunters: [] })]) {
    wipe();
    storageArea().setItem(SAVE_KEY, bad);
    assert.deepEqual(loadRoster(), freshRoster(), bad);
  }
});

test('older saves get missing option fields backfilled from defaults', () => {
  wipe();
  storageArea().setItem(SAVE_KEY, JSON.stringify({
    version: 1, hunters: [], options: { volumes: { music: 0.1 } },
  }));
  const r = loadRoster();
  assert.equal(r.options.volumes.music, 0.1); // saved value kept
  assert.equal(r.options.volumes.master, defaultOptions().volumes.master);
  assert.equal(r.options.wallpaper, 0);
  assert.deepEqual(r.options.wallpapersUnlocked, []);
});

test('export/import JSON roundtrip restores the save', () => {
  wipe();
  const r = freshRoster();
  r.hunters.push(makeHunterRecord({
    name: 'MIRA', spriteId: 5, palette: 'glacier',
    internal: { mv: 6, at: 4, df: 1, hp: 4 },
  }));
  saveRoster(r);
  const dump = exportSave();
  wipe();
  assert.deepEqual(loadRoster(), freshRoster()); // really gone
  importSave(dump);
  assert.deepEqual(loadRoster(), { ...r, version: 1 });
});

test('importSave rejects payloads that are not battle-hunter saves', () => {
  assert.throws(() => importSave('{"version":2,"x":1}'));
  assert.throws(() => importSave('not json'));
});

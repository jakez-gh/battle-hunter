import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import {
  ITEMS, rollBoxItem, effectiveStats, hunterHasEffect, sellPrice,
} from '../src/engine/items.js';

const all = Object.values(ITEMS);
const byCategory = (cat) => all.filter((it) => it.category === cat);
const slot = (itemId, identified = true) => ({ itemId, identified });
const hunter = (...items) => ({ items });

test('catalog keys match entry ids and entries are well-formed', () => {
  for (const [id, it] of Object.entries(ITEMS)) {
    assert.equal(it.id, id);
    assert.equal(typeof it.name, 'string');
    assert.ok(it.name.length > 0);
    assert.ok(Number.isInteger(it.price) && it.price > 0, `${id} price`);
    assert.ok(
      it.excavation === null || (Number.isInteger(it.excavation) && it.excavation >= 1 && it.excavation <= 15),
      `${id} excavation`);
    assert.equal(typeof it.multiplied, 'boolean');
    assert.equal(typeof it.cursed, 'boolean');
    assert.ok(it.effect === null || typeof it.effect === 'string');
  }
  assert.equal(all.length, 87);
});

test('every effect key DESIGN.md relies on exists in the catalog', () => {
  const required = [
    'wardstone', 'warbanner', 'aegis', 'voyager', 'blackgem', 'amulet',
    'angelfeather', 'medkit', 'crutch', 'calmant', 'fearstone', 'darkgem',
    'olddoll', 'actuator', 'generator', 'cursedgem',
    'escape+1', 'escape+2', 'escape+3', 'df+1', 'df+2', 'at+1', 'at+2', 'at+3',
    'sensor+5', 'sensor+10', 'sensor+15', 'sensor+20', 'sensor+25',
    'counter-VAC', 'counter-OOZ', 'counter-FNG', 'counter-WYRM',
  ];
  const present = new Set(all.map((it) => it.effect).filter(Boolean));
  for (const key of required) assert.ok(present.has(key), `missing effect: ${key}`);
});

test('category expansion counts per DESIGN.md 2.14', () => {
  assert.equal(byCategory('gem').length, 12);
  assert.equal(byCategory('disc').length, 15);
  assert.equal(byCategory('weapon').length, 15); // 5 families x 3 tiers
  assert.equal(byCategory('sensor').length, 5);
  assert.equal(byCategory('armor').length, 4);
  assert.equal(byCategory('escape').length, 3);
  assert.equal(byCategory('counter').length, 4);
  for (const tier of [1, 2, 3]) {
    assert.equal(byCategory('weapon').filter((it) => it.effect === `at+${tier}`).length, 5);
  }
});

test('cursed items: exactly four, active-unidentified flag, no excavation level', () => {
  const cursed = all.filter((it) => it.cursed);
  assert.deepEqual(cursed.map((it) => it.id).sort(),
    ['blackgem', 'cursedgem', 'darkgem', 'fearstone']);
  for (const it of cursed) {
    assert.equal(it.price, 6666);
    assert.equal(it.excavation, null);
  }
});

test('spot-check prices and excavation levels against DESIGN.md 2.14', () => {
  const expect = (id, price, exc) => {
    assert.equal(ITEMS[id].price, price, `${id} price`);
    assert.equal(ITEMS[id].excavation, exc, `${id} excavation`);
  };
  expect('wardstone', 250, 1);
  expect('amulet', 20000, 12);
  expect('angelfeather', 8000, 10);
  expect('olddoll', 25, 1);
  expect('prototype', 15000, 14);
  expect('slickboots', 100, 1);
  expect('jumpsuit', 650, 4);
  expect('longcoat', 2500, 7);
  expect('cap', 750, 2);
  expect('plate', 3000, 6);
  expect('pistol1', 500, 3);
  expect('rifle2', 1000, 6);
  expect('blade3', 2000, 8);
  expect('sensor1', 200, 1);
  expect('sensor5', 3200, 8);
  expect('gold', 1500, 5);
  expect('platinum', 3000, 7);
  // counters are drop-only and xL
  for (const [id, price] of [['override', 250], ['repellent', 250], ['patch', 500], ['tamer', 750]]) {
    assert.equal(ITEMS[id].price, price);
    assert.equal(ITEMS[id].multiplied, true);
    assert.equal(ITEMS[id].excavation, null);
  }
  // discs span 100-950, excavation = disc number
  for (let n = 1; n <= 15; n++) {
    const d = ITEMS[`disc${n}`];
    assert.equal(d.excavation, n);
    assert.ok(d.price >= 100 && d.price <= 950);
  }
  assert.equal(ITEMS.disc1.price, 100);
  assert.equal(ITEMS.disc15.price, 950);
  for (const g of byCategory('gem')) {
    assert.equal(g.price, 200);
    assert.equal(g.multiplied, true);
    assert.ok(g.excavation >= 1 && g.excavation <= 5);
  }
});

test('rollBoxItem gates by excavation level and excludes counters/Prototype', () => {
  const rng = makeRng(42);
  for (let i = 0; i < 500; i++) {
    const it = ITEMS[rollBoxItem(rng, 1)];
    assert.notEqual(it.category, 'counter');
    assert.notEqual(it.id, 'prototype');
    assert.ok(it.excavation === null ? it.cursed : it.excavation <= 1,
      `level-1 box gave ${it.id} (exc ${it.excavation})`);
  }
  // at relic 15 everything but counters/Prototype is fair game; deep items appear
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const it = ITEMS[rollBoxItem(rng, 15)];
    assert.notEqual(it.category, 'counter');
    assert.notEqual(it.id, 'prototype');
    seen.add(it.id);
  }
  assert.ok(seen.has('amulet') || seen.has('disc15') || seen.has('actuator'),
    'high-excavation items never rolled at relic 15');
});

test('rollBoxItem is deterministic per seed', () => {
  const a = makeRng(7);
  const b = makeRng(7);
  for (let i = 0; i < 50; i++) assert.equal(rollBoxItem(a, 8), rollBoxItem(b, 8));
});

test('effectiveStats: same-category equipment does not stack, strongest wins', () => {
  const h = hunter(slot('cap'), slot('plate'), slot('pistol1'), slot('blade3'),
    slot('slickboots'), slot('longcoat'), slot('sensor2'), slot('sensor5'));
  assert.deepEqual(effectiveStats(h), { mv: 0, at: 3, df: 2, escape: 3, sensor: 25 });
});

test('effectiveStats: unidentified non-cursed equipment is inert', () => {
  const h = hunter(slot('plate', false), slot('blade3', false), slot('voyager', false));
  assert.deepEqual(effectiveStats(h), { mv: 0, at: 0, df: 0, escape: 0, sensor: 0 });
});

test('effectiveStats: identified Voyager grants mv +1; empty inventory is all zero', () => {
  assert.equal(effectiveStats(hunter(slot('voyager'))).mv, 1);
  assert.deepEqual(effectiveStats(hunter()), { mv: 0, at: 0, df: 0, escape: 0, sensor: 0 });
  assert.deepEqual(effectiveStats({}), { mv: 0, at: 0, df: 0, escape: 0, sensor: 0 });
});

test('hunterHasEffect: cursed items work unidentified, others only identified', () => {
  assert.equal(hunterHasEffect(hunter(slot('blackgem', false)), 'blackgem'), true);
  assert.equal(hunterHasEffect(hunter(slot('cursedgem', false)), 'cursedgem'), true);
  assert.equal(hunterHasEffect(hunter(slot('amulet', false)), 'amulet'), false);
  assert.equal(hunterHasEffect(hunter(slot('amulet')), 'amulet'), true);
  assert.equal(hunterHasEffect(hunter(slot('wardstone')), 'wardstone'), true);
  assert.equal(hunterHasEffect(hunter(slot('override')), 'counter-VAC'), true);
  assert.equal(hunterHasEffect(hunter(slot('wardstone')), 'amulet'), false);
  assert.equal(hunterHasEffect(hunter(), 'wardstone'), false);
});

test('sellPrice: xL items scale with relic level, others do not', () => {
  assert.equal(sellPrice('ruby', 7), 1400); // 200 x 7
  assert.equal(sellPrice('gold', 7), 1500);
  assert.equal(sellPrice('override', 3), 750);
  assert.equal(sellPrice('tamer', 15), 11250);
  assert.equal(sellPrice('silverring', 2), 300);
  assert.equal(sellPrice('amulet', 15), 20000);
  assert.throws(() => sellPrice('nonsense', 1));
});

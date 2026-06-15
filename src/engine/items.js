// Item catalog and inventory helpers (DESIGN.md §2.1, §2.14, §3.4).
// Inventory slots are { itemId, identified } (GameState §3.1). Effects are
// inert until appraised EXCEPT cursed items, which work while unidentified.
// `multiplied` items sell at price × relic level (the "×L" flag in §2.14).

export const ITEMS = {};

// flags: 'x' = price multiplied by relic level, 'c' = cursed.
// excavation: minimum relic level for box pools; null = no documented level
// (cursed items: any level; counter items: drop-only, never in boxes).
function def(id, name, price, excavation, category, effect = null, flags = '') {
  if (ITEMS[id]) throw new Error(`duplicate item id: ${id}`);
  ITEMS[id] = {
    id, name, price, excavation, category, effect,
    multiplied: flags.includes('x'), cursed: flags.includes('c'),
  };
}

// --- Special effect items ---
def('wardstone', 'Wardstone', 250, 1, 'special', 'wardstone');
def('warbanner', 'Warbanner', 6000, 10, 'special', 'warbanner');
def('aegis', 'Aegis', 6000, 10, 'special', 'aegis');
def('voyager', 'Voyager', 6000, 10, 'special', 'voyager');
def('blackgem', 'Black Gem', 6666, null, 'special', 'blackgem', 'c');
def('amulet', 'Amulet', 20000, 12, 'special', 'amulet');
def('angelfeather', 'Angel Feather', 8000, 10, 'special', 'angelfeather');
def('medkit', 'Medkit', 1000, 3, 'special', 'medkit');
def('crutch', 'Crutch', 500, 1, 'special', 'crutch');
def('calmant', 'Calmant', 750, 2, 'special', 'calmant');
def('fearstone', 'Fear Stone', 6666, null, 'special', 'fearstone', 'c');
def('darkgem', 'Dark Gem', 6666, null, 'special', 'darkgem', 'c');
def('olddoll', 'Old Doll', 25, 1, 'special', 'olddoll');
def('actuator', 'Actuator', 10000, 12, 'special', 'actuator');
def('generator', 'Generator', 10000, 12, 'special', 'generator');
def('cursedgem', 'Cursed Gem', 6666, null, 'special', 'cursedgem', 'c');
def('prototype', 'Prototype', 15000, 14, 'trophy'); // story-only, never in boxes

// --- Equipment (same-category non-stacking; strongest applies) ---
def('slickboots', 'Slick Boots', 100, 1, 'escape', 'escape+1');
def('jumpsuit', 'Jumpsuit', 650, 4, 'escape', 'escape+2');
def('longcoat', 'Longcoat', 2500, 7, 'escape', 'escape+3');

def('cap', 'Cap', 750, 2, 'armor', 'df+1');
def('vest', 'Vest', 750, 2, 'armor', 'df+1');
def('helm', 'Helm', 3000, 6, 'armor', 'df+2');
def('plate', 'Plate', 3000, 6, 'armor', 'df+2');

const WEAPON_NAMES = {
  pistol: ['Pistol', 'Twin Pistol', 'Mag Pistol'],
  rifle: ['Rifle', 'Scope Rifle', 'Pulse Rifle'],
  scatter: ['Scatter', 'Wide Scatter', 'Storm Scatter'],
  claw: ['Claw', 'Steel Claw', 'Razor Claw'],
  blade: ['Blade', 'Edge Blade', 'Nova Blade'],
};
const WEAPON_TIERS = [[500, 3], [1000, 6], [2000, 8]]; // [price, excavation] per +1/+2/+3
for (const [family, names] of Object.entries(WEAPON_NAMES)) {
  WEAPON_TIERS.forEach(([price, exc], i) =>
    def(`${family}${i + 1}`, names[i], price, exc, 'weapon', `at+${i + 1}`));
}

const SENSOR_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];
[[5, 200, 1], [10, 400, 2], [15, 800, 4], [20, 1600, 6], [25, 3200, 8]].forEach(
  ([pct, price, exc], i) =>
    def(`sensor${i + 1}`, `Sensor ${SENSOR_NUMERALS[i]}`, price, exc, 'sensor', `sensor+${pct}`));

// --- Counter items (monster drops only; stun the matching monster, §2.8) ---
def('override', 'Override', 250, null, 'counter', 'counter-VAC', 'x');
def('repellent', 'Repellent', 250, null, 'counter', 'counter-OOZ', 'x');
def('patch', 'Patch', 500, null, 'counter', 'counter-FNG', 'x');
def('tamer', 'Tamer', 750, null, 'counter', 'counter-WYRM', 'x');

// --- Treasure (sell fodder, no in-mission effect) ---
def('scrap', 'Scrap', 50, 1, 'treasure');
def('silver', 'Silver', 750, 1, 'treasure');
def('gold', 'Gold', 1500, 5, 'treasure');
def('platinum', 'Platinum', 3000, 7, 'treasure');
def('silverring', 'Silver Ring', 150, 2, 'treasure', null, 'x');
def('goldring', 'Gold Ring', 250, 5, 'treasure', null, 'x');
def('oldbook', 'Old Book', 25, 1, 'treasure');
def('bottle', 'Glass Bottle', 75, 1, 'treasure');
def('figurine', 'Brass Figurine', 250, 2, 'treasure');
def('rarebook', 'Rare Book', 500, 3, 'treasure');
def('finewine', 'Vintage Bottle', 750, 4, 'treasure');
def('tome', 'Ancient Tome', 1250, 6, 'treasure');

const GEMS = [
  ['quartz', 1], ['garnet', 1], ['amethyst', 2], ['topaz', 2], ['peridot', 2],
  ['moonstone', 3], ['aquamarine', 3], ['opal', 3], ['sapphire', 4], ['ruby', 4],
  ['emerald', 5], ['diamond', 5],
];
for (const [g, exc] of GEMS) def(g, g[0].toUpperCase() + g.slice(1), 200, exc, 'gem', null, 'x');

// Discs 1-15: excavation = disc number; each unlocks a wallpaper (§2.13).
const DISC_PRICES = [100, 150, 200, 250, 300, 350, 400, 450, 550, 600, 650, 700, 800, 900, 950];
DISC_PRICES.forEach((price, i) => def(`disc${i + 1}`, `Disc ${i + 1}`, price, i + 1, 'disc'));

// An inventory slot's effect is live if appraised, or if the item is cursed.
const isActive = (slot) => {
  const item = ITEMS[slot.itemId];
  return !!item && (slot.identified || item.cursed);
};

// Uniform pick over every item excavatable at this relic level. Excludes
// drop-only counter items and the story-only Prototype; cursed items (no
// documented excavation level) are in every pool.
export function rollBoxItem(rng, relicLevel) {
  const pool = Object.values(ITEMS).filter((it) =>
    it.category !== 'counter' && it.id !== 'prototype' &&
    (it.excavation === null || it.excavation <= relicLevel));
  return rng.pick(pool).id;
}

// Equipment stat bonuses from active items. Same-category items don't stack:
// only the strongest applies (max per stat, since each equipment category
// feeds exactly one stat). mv +1 comes from Voyager. escape (escape-roll
// bonus) and sensor (trap-evasion %) ride along for game.js convenience.
export function effectiveStats(hunter) {
  const best = { mv: 0, at: 0, df: 0, escape: 0, sensor: 0 };
  for (const slot of hunter.items || []) {
    if (!isActive(slot)) continue;
    const effect = ITEMS[slot.itemId].effect || '';
    const m = /^(at|df|escape|sensor)\+(\d+)$/.exec(effect);
    if (m) best[m[1]] = Math.max(best[m[1]], +m[2]);
    else if (effect === 'voyager') best.mv = Math.max(best.mv, 1);
  }
  return best;
}

export function hunterHasEffect(hunter, effectKey) {
  return (hunter.items || []).some(
    (slot) => isActive(slot) && ITEMS[slot.itemId].effect === effectKey);
}

// Returns true if the hunter holds an active counter item matching the given monster kind.
export function hunterHasCounter(hunter, monsterKind) {
  const target = `counter-${monsterKind}`;
  return (hunter.items || []).some((slot) => isActive(slot) && ITEMS[slot.itemId]?.effect === target);
}

// Base sale price at the Client (haggling applied by the hub on top).
export function sellPrice(itemId, relicLevel) {
  const item = ITEMS[itemId];
  if (!item) throw new Error(`unknown item id: ${itemId}`);
  return item.multiplied ? item.price * relicLevel : item.price;
}

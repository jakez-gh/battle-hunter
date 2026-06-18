// ORIGINAL pixel-art data for the whole game (DESIGN 1.4). Everything here is
// hand-authored for this project; designs are our own. Grids feed
// pixelart.js bake()/recolor()/flipGrid(). Pure data + helpers — safe to
// import in Node (only buildAtlas touches the DOM).
import { flipGrid, recolor, bake, validateGrid } from './pixelart.js';

// Semantic palette keys shared by all hunter sprites:
// O outline, S skin, H hair, P primary outfit, Q secondary, B accent/boots,
// W white (eyes/highlights), D dark shade of primary.
export const PALETTES = {
  cobalt:  { O: '#1a1626', S: '#f2c79b', H: '#4a3623', P: '#2d5bd1', Q: '#7e9fee', B: '#23304f', W: '#f7f7ff', D: '#1d3c8f' },
  ember:   { O: '#1a1626', S: '#eebc92', H: '#191215', P: '#c8372d', Q: '#f0975e', B: '#4f2323', W: '#f7f7ff', D: '#8f1d1d' },
  citrine: { O: '#1a1626', S: '#ffd9ae', H: '#b46b2a', P: '#d1a52d', Q: '#eed87e', B: '#4f4423', W: '#f7f7ff', D: '#8f6f1d' },
  moss:    { O: '#1a1626', S: '#d9a878', H: '#23351c', P: '#3d8f3a', Q: '#8fd17e', B: '#234f2a', W: '#f7f7ff', D: '#1d5c25' },
  orchid:  { O: '#1a1626', S: '#f2c79b', H: '#d8d3e8', P: '#8b3dc1', Q: '#c98fe0', B: '#3a234f', W: '#f7f7ff', D: '#5c1d8f' },
  rust:    { O: '#1a1626', S: '#c98e62', H: '#6e3b1c', P: '#b4642a', Q: '#e0a16b', B: '#4f3423', W: '#f7f7ff', D: '#7a3f15' },
  glacier: { O: '#1a1626', S: '#ffe2c4', H: '#e8eef5', P: '#3aa9b8', Q: '#9adfe8', B: '#1f4a52', W: '#f7f7ff', D: '#1d6f7a' },
  onyx:    { O: '#1a1626', S: '#e2b288', H: '#54416b', P: '#3c3c46', Q: '#8d8d9e', B: '#23232b', W: '#f7f7ff', D: '#222228' },
};
export const PALETTE_NAMES = Object.keys(PALETTES);
const HUNTER_KEYS = ['O', 'S', 'H', 'P', 'Q', 'B', 'W', 'D'];

// ---------------------------------------------------------------------------
// HUNTERS — eight original 16x16 designs (4 masc 0-3, 4 fem 4-7), idle frame.
// Step frame and 12x12 face icons are derived programmatically below.
export const HUNTER_GRIDS = [
  [ // 0 "drifter" — masc, spiky hair, scarf
    '....H..HH.H.....',
    '...OHHHHHHHO....',
    '..OHHHHHHHHHO...',
    '..OHSSSSSSHO....',
    '..OSWSSSWSSO....',
    '..OSSSSSSSSO....',
    '...OSSSSSSO.....',
    '...OQQQQQQO.....',
    '..OPPPPPPPPO....',
    '.OPSPPPPPPSPO...',
    '.OPSPPDDPPSPO...',
    '..OOPPPPPPOO....',
    '....OPPPPO......',
    '...OBBOOBBO.....',
    '...OBBO.OBBO....',
    '....OO...OO.....',
  ],
  [ // 1 "captain" — masc, peaked cap, long coat
    '....OOOOOO......',
    '...OQQQQQQO.....',
    '..OQQQQQQQQO....',
    '...OSSSSSSO.....',
    '..OSWSSSWSSO....',
    '..OSSSSSSSSO....',
    '...OSSSSSSO.....',
    '..OPPPPPPPPO....',
    '.OPPQPPPPQPPO...',
    '.OPSPPPPPPSPO...',
    '.OPSPDPPDPSPO...',
    '.OOPPDPPDPPOO...',
    '...OPDPPDPO.....',
    '...OBBOOBBO.....',
    '...OBBO.OBBO....',
    '....OO...OO.....',
  ],
  [ // 2 "bruiser" — masc, bald + headband, heavy build
    '.....OOOOO......',
    '....OQQQQQO.....',
    '...OSSSSSSSO....',
    '..OSSWSSSWSO....',
    '..OSSSSSSSSO....',
    '...OSSSSSSO.....',
    '..OOPPPPPPOO....',
    '.OPPPPPPPPPPO...',
    'OPSPPPPPPPPSPO..',
    'OPSPPDDDDPPSPO..',
    'OSSOPPPPPPOSSO..',
    '.OOOPPPPPPOOO...',
    '....OPPPPO......',
    '...OBBOOBBO.....',
    '..OBBBO.OBBBO...',
    '...OOO...OOO....',
  ],
  [ // 3 "scout" — masc, hooded, slight build
    '.....OOOOO......',
    '....OPPPPPO.....',
    '...OPPPPPPPO....',
    '...OPSSSSPPO....',
    '..OPSWSSWSPO....',
    '..OPSSSSSSPO....',
    '...OPSSSSPO.....',
    '....OQQQQO......',
    '...OPPPPPPO.....',
    '..OPSPPPPSPO....',
    '..OPSPDDPSPO....',
    '...OPPPPPPO.....',
    '....OPPPPO......',
    '....OBOOBO......',
    '....OBO.OBO.....',
    '.....O...O......',
  ],
  [ // 4 "vela" — fem, long hair, field jacket
    '....OOOOOO......',
    '...OHHHHHHO.....',
    '..OHHHHHHHHO....',
    '..OHSSSSSSHO....',
    '..OHWSSSWSHO....',
    '..OHSSSSSSHO....',
    '..OHHSSSSHHO....',
    '..OHOQQQQOHO....',
    '..OHPPPPPPHO....',
    '..OHSPPPPSHO....',
    '...OSPDDPSO.....',
    '....OPPPPO......',
    '....OQPPQO......',
    '....OBOOBO......',
    '...OBBO.OBBO....',
    '....OO...OO.....',
  ],
  [ // 5 "wren" — fem, short bob + goggles up
    '....OOOOOO......',
    '...OHHHHHHO.....',
    '..OHWWHHWWHO....',
    '..OHHHHHHHHO....',
    '..OHSSSSSSHO....',
    '..OSWSSSWSSO....',
    '..OHSSSSSSHO....',
    '...OOSSSSOO.....',
    '...OPPPPPPO.....',
    '..OPSPPPPSPO....',
    '..OPSPPPPSPO....',
    '...OPDPPDPO.....',
    '....OQQQQO......',
    '....OBOOBO......',
    '....OBO.OBO.....',
    '.....O...O......',
  ],
  [ // 6 "nadia" — fem, high ponytail, sleeveless
    '....OOOOO..H....',
    '...OHHHHHOHH....',
    '..OHHHHHHHHH....',
    '..OHSSSSSSHOH...',
    '..OSWSSSWSSO.H..',
    '..OHSSSSSSHO....',
    '...OSSSSSSO.....',
    '....OQQQQO......',
    '...OPPPPPPO.....',
    '..OSPPPPPPSO....',
    '..OSPPDDPPSO....',
    '...OPPPPPPO.....',
    '....OQPPQO......',
    '....OBOOBO......',
    '...OBBO.OBBO....',
    '....OO...OO.....',
  ],
  [ // 7 "matron" — fem, braided crown, armored vest
    '....OOOOOO......',
    '...OHHHHHHO.....',
    '..OHQHQHQHHO....',
    '..OHSSSSSSHO....',
    '..OSWSSSWSSO....',
    '..OSSSSSSSSO....',
    '...OSSSSSSO.....',
    '..OQQQQQQQQO....',
    '..OQPPPPPPQO....',
    '.OQSPPPPPPSQO...',
    '.OQSPPDDPPSQO...',
    '..OQPPPPPPQO....',
    '....OPPPPO......',
    '...OBBOOBBO.....',
    '...OBBO.OBBO....',
    '....OO...OO.....',
  ],
];

// Derive the step frame: legs region (rows 12+) mirrored for a stance change.
export function stepFrame(grid) {
  const top = grid.slice(0, 12);
  const legs = flipGrid(grid.slice(12));
  return [...top, ...legs];
}

// Derive a 12x12 face icon: head region rows 0-11, columns 2-13.
export function faceIcon(grid) {
  return grid.slice(0, 12).map((row) => row.slice(2, 14));
}

export const HUNTERS = HUNTER_GRIDS.map((grid, i) => ({
  id: i,
  body: i === 2 ? 'heavy' : i >= 4 ? 'fem' : 'masc',
  grids: { idle: grid, step: stepFrame(grid) },
  icon: faceIcon(grid),
}));

// ---------------------------------------------------------------------------
// MONSTERS — own palettes (M-prefixed keys to keep them self-contained).
export const MONSTER_PALETTES = {
  VAC:  { O: '#101418', M: '#7e8a96', N: '#aab6c2', E: '#ffd23e', T: '#39424c', W: '#e8f0f7' },
  OOZ:  { O: '#0f1a10', M: '#4fae3f', N: '#8fe07e', E: '#1d2e1a', T: '#2a6e23', W: '#d8f7d0' },
  FNG:  { O: '#1a1014', M: '#8a4a5a', N: '#c27e8a', E: '#ff5e3e', T: '#4c2934', W: '#f7e8ea' },
  WYRM: { O: '#0a0a12', M: '#2e2a44', N: '#544e7a', E: '#ff3e3e', T: '#1a1828', W: '#cfc8ff' },
};

export const MONSTER_GRIDS = {
  VAC: [ // boxy cleaner robot on a roller skirt
    '................',
    '....OOOOOOOO....',
    '...ONNNNNNNNO...',
    '...ONWEOOEWNO...',
    '...ONNNNNNNNO...',
    '...OMMMMMMMMO...',
    '..OMMTMMMMTMMO..',
    '..OMMMMMMMMMMO..',
    '..OMTMMMMMMTMO..',
    '..OMMMMMMMMMMO..',
    '...OMMMMMMMMO...',
    '...OTTTTTTTTO...',
    '..OTTOTTTTOTTO..',
    '..OTTOTTTTOTTO..',
    '...OOO.OO.OOO...',
    '................',
  ],
  OOZ: [ // slime blob with two stalk eyes
    '................',
    '................',
    '....OE....EO....',
    '....OEO..OEO....',
    '.....ON..NO.....',
    '....ONNNNNNO....',
    '...ONNWNNWNNO...',
    '..ONNNNNNNNNNO..',
    '..ONMMNNNNMMNO..',
    '.OMMMMMMMMMMMMO.',
    '.OMMMTMMMMTMMMO.',
    'OMMMMMMMMMMMMMMO',
    'OMTMMMMMTMMMMTMO',
    'OMMMMMMMMMMMMMMO',
    '.OOOOOOOOOOOOOO.',
    '................',
  ],
  FNG: [ // low four-legged hunter mech with jaw
    '................',
    '................',
    '..OO............',
    '.OEEO...OOOO....',
    '.OEEOOOONNNNOO..',
    '..ONNNNNNNNNNNO.',
    '.ONWNNNNNNNNNNO.',
    '.ONNNNMMMMMMNO..',
    '..OMMMMMMMMMMO..',
    '..OMMTMMMMTMMO..',
    '.OMMTOMMMMOTMMO.',
    '.OMTO.OMMO.OTMO.',
    '.OTO..OTTO..OTO.',
    '.OO...OO.OO..OO.',
    '................',
    '................',
  ],
  WYRM: [ // 24x24 dark dragon-beast, wings folded
    '........................',
    '......O.....O...........',
    '.....ONO...ONO..........',
    '....ONNNO.ONNNO.........',
    '....ONNNNONNNNO.........',
    '.....ONNNNNNNO..........',
    '....ONNEONEONNO.........',
    '....ONNNNNNNNNO.........',
    '.....ONNWWWNNO..........',
    '......ONNNNNO...........',
    '...OOOMMMMMMMOOO........',
    '..OMMMMMMMMMMMMMO.......',
    '.OMMNMMMMMMMMNMMMO......',
    '.OMNNMMTTTTMMNNMMO......',
    'OMMNMMMMMMMMMMNMMMO.....',
    'OMMMMMTMMMMTMMMMMMO.....',
    'OMTMMMMMMMMMMMMTMMO.....',
    '.OMMMMMMMMMMMMMMMO......',
    '.OMTMMMMMMMMMMTMO.......',
    '..OMMMOMMMMOMMMO........',
    '...OOOOMMMMOOOO.........',
    '......ONNO.ONNO.........',
    '.....ONNO...ONNO........',
    '......OO.....OO.........',
  ],
};

// Bob frame: shift the whole grid down one row (drop last, blank on top).
export function bobFrame(grid) {
  const blank = '.'.repeat(grid[0].length);
  return [blank, ...grid.slice(0, -1)];
}

export const MONSTERS = Object.fromEntries(
  Object.entries(MONSTER_GRIDS).map(([kind, grid]) => [kind, {
    grids: { idle: grid, step: bobFrame(grid) },
    palette: MONSTER_PALETTES[kind],
  }]),
);

// ---------------------------------------------------------------------------
// TILES — 16x16. Shared palette; flags recolor key F per color.
export const TILE_PALETTE = {
  O: '#101018', G: '#5a5f6e', g: '#4c5160', d: '#3e4350', X: '#191b24',
  c: '#717987',
  E: '#7ee8a0', e: '#2e6e48', B: '#8a6a3a', b: '#5e4828', F: '#cc3333',
  Y: '#e8d87e', W: '#f0f4ff',
};

const FLOOR_A = [
  'GcGGGGGGGGGGGGGG', 'GggGGGGGGGGGGGgG', 'GGGGGGGGdGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGdGGGGGGGGGGGG', 'GGGGGGGGGGGGgGGG', 'GGGGcGgGGGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGdGGGGG', 'GgGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGcGG', 'GGGGGdGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG', 'GGgGGGGGGdGGGGGG', 'GGGGGGGGGGcGGGGG', 'dGGGGGGGGGGGGGGd',
];
const FLOOR_B = [
  'GGGGGGGGGGGGGGGG', 'GgGGGGGGGGGGGGgG', 'GGGGGGGGGGGGGGdG', 'GGGGGGGGGGGGGdgG',
  'GGGGGGGGGGGGdgGG', 'GGGGGGGGGGGdgGGG', 'GGGGGGGGGGdgGGGG', 'GGGGGGGGGdgGGGGG',
  'GGGGGGGGdgGGGGGG', 'GGGGGGGdgGGGGGGG', 'GGGGGGdgGGGGGGGG', 'GGGGGdgGGGGGGGGG',
  'GGGGdgGGGGGGGGGG', 'GGGdgGGGGGGGGGGG', 'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGGGG',
];
const FLOOR_C = [
  'GGGGGGGGGGGGGGGG', 'GgGGGGGGGGGGGGgG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGgGG', 'GdddddddddddddGG',
  'GdddddddddddddGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGGGG',
];
const FLOOR_D = [
  'GddGGGGGGGGGGGGG', 'GgdgGGGGGGGGGGgG', 'GggdGGGGGGGGGGGG', 'GGggGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGGGG',
];
const FLOOR_E = [ // diamond groove carved into center of tile
  'GGGGGGGGGGGGGGGG', 'GgGGGGGGGGGGGGgG', 'GGGGGGGGGGGGGGGG', 'GGGGGGGdGGGGGGGG',
  'GGGGGGdGdGGGGGGG', 'GGGGGdGGGdGGGGGG', 'GGGGdGGGGGdGGGGG', 'GGGdGGGGGGGdGGGG',
  'GGGGdGGGGGdGGGGG', 'GGGGGdGGGdGGGGGG', 'GGGGGGdGdGGGGGGG', 'GGGGGGGdGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGGGG',
];
const FLOOR_F = [ // diagonal slash top-left to bottom-right (mirrors FLOOR_B)
  'gGGGGGGGGGGGGGGG', 'GdgGGGGGGGGGGGgG', 'GGdGGGGGGGGGGGGG', 'GGGdGGGGGGGGGGGG',
  'GGGGdGGGGGGGGGGG', 'GGGGGdGGGGGGGGGG', 'GGGGGGdGGGGGGGGG', 'GGGGGGGdGGGGGGGG',
  'GGGGGGGGdGGGGGGG', 'GGGGGGGGGdGGGGGG', 'GGGGGGGGGGdGGGGG', 'GGGGGGGGGGGdGGGG',
  'GGGGGGGGGGGGdGGG', 'GGGGGGGGGGGGGdgG', 'GGGGGGGGGGGGGGgG', 'GGGGGGGGGGGGGGGg',
];
const FLOOR_G = [ // X-cross groove: both diagonals combined corner-to-corner
  'dGGGGGGGGGGGGGGd', 'GgGGGGGGGGGGGGgG',
  'GGdGGGGGGGGGGdGG', 'GGGdGGGGGGGGdGGG',
  'GGGGdGGGGGGdGGGG', 'GGGGGdGGGGdGGGGG',
  'GGGGGGdGGdGGGGGG', 'GGGGGGGddGGGGGGG',
  'GGGGGGGddGGGGGGG', 'GGGGGGdGGdGGGGGG',
  'GGGGGdGGGGdGGGGG', 'GGGGdGGGGGGdGGGG',
  'GGGdGGGGGGGGdGGG', 'GGdGGGGGGGGGGdGG',
  'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGGGG',
];
const FLOOR_H = [ // plus-cross groove: orthogonal cross (vertical + horizontal)
  'GGGGGGGGGGGGGGGG', 'GgGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGdG', 'GGGGGGGGGGGGGdgG',
  'GGGGGGGGdGGGGGGG', 'GGGGGGGGdGGGGGGG',
  'GGGGGGGGdGGGGGGG', 'dddddddddddddddG',
  'GGGGGGGGdGGGGGGG', 'GGGGGGGGdGGGGGGG',
  'GGGGGGGGdGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGgGG', 'GGGGGGGGGGGGGGGG',
];
const PIT = Array.from({ length: 16 }, (_, y) =>
  y === 0 ? 'XXXdXXXXXXXdXXXX' : 'X'.repeat(16));
const EXIT = [
  'GGGGGGGGGGGGGGGG', 'GOOOOOOOOOOOOOOG', 'GOeeeeeeeeeeeeOG', 'GOeEEEEEEEEEEeOG',
  'GOeEeeeeeeeeEeOG', 'GOeEeEEEEEEeEeOG', 'GOeEeEeeeeEeEeOG', 'GOeEeEeWWeEeEeOG',
  'GOeEeEeWWeEeEeOG', 'GOeEeEeeeeEeEeOG', 'GOeEeEEEEEEeEeOG', 'GOeEeeeeeeeeEeOG',
  'GOeEEEEEEEEEEeOG', 'GOeeeeeeeeeeeeOG', 'GOOOOOOOOOOOOOOG', 'GGGGGGGGGGGGGGGG',
];
const BOX_CLOSED = [
  '................', '................', '................', '....OOOOOOOO....',
  '...OBBBBBBBBO...', '..OBbBBBBBBbBO..', '..OBBBBBBBBBBO..', '..OOOOOOOOOOOO..',
  '..OBBBYYBBBBBO..', '..OBBBYYBBBBBO..', '..ObBBBBBBBbBO..', '..OBBBBBBBBBBO..',
  '..ObBBBBBBBBbO..', '...OOOOOOOOOO...', '................', '................',
];
const BOX_OPEN = [
  '................', '................', '..OOOOOOOOOOOO..', '..OXXXXXXXXXXO..',
  '..OXXXXXXXXXXO..', '..OOOOOOOOOOOO..', '..OBBBBBBBBBBO..', '..OBbBBBBBBbBO..',
  '..OBBBBBBBBBBO..', '..OBBBYYBBBBBO..', '..OBBBYYBBBBBO..', '..ObBBBBBBBbBO..',
  '..OBBBBBBBBBBO..', '...OOOOOOOOOO...', '................', '................',
];
const FLAG = [ // key F recolored per flag color
  '................', '.....OO.........', '....OFFO........', '....OFFFFO......',
  '....OFFFFFFO....', '....OFFFFFFFO...', '....OFFFFFO.....', '....OFFFO.......',
  '....OFO.........', '....OO..........', '....OO..........', '....OO..........',
  '....OO..........', '...OOOO.........', '..OOOOOO........', '................',
];
const CURSOR = Array.from({ length: 16 }, (_, y) => {
  if (y === 0 || y === 15) return 'WWWW' + '.'.repeat(8) + 'WWWW';
  if (y < 4 || y > 11) return 'W' + '.'.repeat(14) + 'W';
  return '.'.repeat(16);
});
const RANGE_DOT = [
  '................', '................', '................', '................',
  '................', '................', '......WWWW......', '.....WWWWWW.....',
  '.....WWWWWW.....', '......WWWW......', '................', '................',
  '................', '................', '................', '................',
];

const WALL = [ // stone-block face — front face of a wall, viewed from corridor below
  'XXXXXXXXXXXXXXXX',  // top: ceiling cap shadow
  'XcGGGGGGGGGGGGgX',  // upper block row — lit top-left corner, right edge darker
  'XGgGGGGGGGGGGGGX',  // stone texture fleck top-left
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',  // base shadow on both sides
  'XXXXXXXXXXXXXXXX',  // horizontal mortar joint
  'XcGGGGGGXcGGGGgX',  // lower block row — lit corners on both sub-blocks
  'XGgGGGGGXGGGGGGX',  // stone texture fleck
  'XGGGGGGGXGGGGGGX',
  'XGGGGGGGXGGGGGGX',
  'XGGGGGGGXGGGGGGX',
  'XgGGGGGGXGGGGGgX',  // base shadow
  'XXXXXXXXXXXXXXXX',  // mortar joint
  'GGGGGGGGGGGGGGGG',  // bottom ledge — transitions to floor
];

const WALL_B = [ // stone-block face — three narrow sub-blocks in lower band
  'XXXXXXXXXXXXXXXX',  // ceiling cap
  'XcGGGGGGGGGGGGgX',  // upper block, lit corner
  'XGgGGGGGGGGGGGGX',  // texture fleck
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',  // base shadows
  'XXXXXXXXXXXXXXXX',  // mortar joint
  'XcGGGGXcGGGXcGGX',  // three-block row — lit corners
  'XGGGGGXGGGGXGGdX',  // faces, dark accent on right sub-block
  'XGGGGGXGGGGXGGGX',
  'XgGGGGXGGGGXgGGX',  // base shadows
  'XXXXXXXXXXXXXXXX',  // mortar joint
  'XcGGGGGGGGGGGGgX',  // thin ledge
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',  // mortar cap
  'GGGGGGGGGGGGGGGG',  // floor transition
];

const FLOOR_I = [ // diagonal scratch — single dark groove from top-left toward bottom-right
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',  // corner accent
  'GGGGGGGGGGGGGGdG',
  'GGdGGGGGGGGGGGGG',  // scratch start
  'GGGdGGGGGGGGGGGG',
  'GGGGdGGGGGGGGGGG',
  'GGGGGdGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',  // gap in scratch
  'GGGGGGGGdGGGGGGG',  // scratch resumes
  'GGGGGGGGGdGGGGGG',
  'GGGGGGGGGGdGGGGG',
  'GGGGGGGGGGGdGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',  // corner accent
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_J = [ // inset square — raised flagstone-within-flagstone
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',  // corner accent
  'GGGGGGGGGGGGGGGG',
  'GGGddddddddddGGG',  // top edge of inset square
  'GGGdGGGGGGGGdGGG',
  'GGGdGGGGGGGGdGGG',
  'GGGdGGgGGGGGdGGG',  // texture fleck
  'GGGdGGGGGGGGdGGG',
  'GGGdGGGGGGGGdGGG',
  'GGGdGGGGGGgGdGGG',  // texture fleck
  'GGGdGGGGGGGGdGGG',
  'GGGdGGGGGGGGdGGG',
  'GGGGdddddddddGGG',  // bottom edge of inset (shifted right for 3D)
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGgGG',  // corner accent
  'GGGGGGGGGGGGGGGG',
];

export const TILES = {
  floorA: { grid: FLOOR_A, palette: TILE_PALETTE },
  floorB: { grid: FLOOR_B, palette: TILE_PALETTE },
  floorC: { grid: FLOOR_C, palette: TILE_PALETTE },
  floorD: { grid: FLOOR_D, palette: TILE_PALETTE },
  floorE: { grid: FLOOR_E, palette: TILE_PALETTE },
  floorF: { grid: FLOOR_F, palette: TILE_PALETTE },
  floorG: { grid: FLOOR_G, palette: TILE_PALETTE },
  floorH: { grid: FLOOR_H, palette: TILE_PALETTE },
  floorI: { grid: FLOOR_I, palette: TILE_PALETTE },
  floorJ: { grid: FLOOR_J, palette: TILE_PALETTE },
  pit: { grid: PIT, palette: TILE_PALETTE },
  wall: { grid: WALL, palette: TILE_PALETTE },
  wallB: { grid: WALL_B, palette: TILE_PALETTE },
  exit: { grid: EXIT, palette: TILE_PALETTE },
  boxClosed: { grid: BOX_CLOSED, palette: TILE_PALETTE },
  boxOpen: { grid: BOX_OPEN, palette: TILE_PALETTE },
  flagRed: { grid: FLAG, palette: recolor(TILE_PALETTE, { F: '#cc3333' }) },
  flagBlue: { grid: FLAG, palette: recolor(TILE_PALETTE, { F: '#3a6ee0' }) },
  flagGreen: { grid: FLAG, palette: recolor(TILE_PALETTE, { F: '#3aa84a' }) },
  flagYellow: { grid: FLAG, palette: recolor(TILE_PALETTE, { F: '#e0c63a' }) },
  cursor: { grid: CURSOR, palette: TILE_PALETTE },
  rangeDot: { grid: RANGE_DOT, palette: TILE_PALETTE },
};

// ---------------------------------------------------------------------------
// UI — card frames (14x20, K = color band), icons, chips, statuses.
const UI_PALETTE = {
  O: '#101018', K: '#888888', W: '#f0f4ff', X: '#23232e', Y: '#e8d87e',
  R: '#cc4a3a', G: '#3aa84a', L: '#ffffff',
};

const CARD_FRAME = [
  '.OOOOOOOOOOOO.',
  'OWWWWWWWWWWWWO', 'OWLLLLLLLLLLWO', 'OWKKKKKKKKKKWO', 'OWKKKKKKKKKKWO',
  'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO',
  'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO',
  'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO', 'OWWWWWWWWWWWWO',
  'OWKKKKKKKKKKWO', 'OWWWWWWWWWWWWO',
  '.OOOOOOOOOOOO.',
];
const CARD_COLORS = { red: '#cc4a3a', yellow: '#d8b83a', blue: '#3a6ee0', green: '#3aa84a' };

const ICONS = { // 12x12 action icons
  move: [
    '............', '....OO......', '...OWWO.....', '...OWWO.....', '..OWWWWO....',
    '..OWWWWO....', '..OWWWWOO...', '..OWWWWWWO..', '..OWWWWWWO..', '..OOOOOOOO..',
    '............', '............',
  ],
  attack: [
    '............', '.........O..', '........OWO.', '.......OWO..', '......OWO...',
    '.....OWO....', '.OO.OWO.....', '..OOWO......', '..OOO.......', '.OO.OO......',
    '............', '............',
  ],
  rest: [
    '............', '............', '..OOOOOOO...', '..OWWWWWOO..', '..OWWWWWOWO.',
    '..OWWWWWOWO.', '..OWWWWWOO..', '..OWWWWWO...', '...OWWWO....', '....OOO.....',
    '............', '............',
  ],
  bag: [
    '............', '....OOOO....', '...OO..OO...', '..OOOOOOOO..', '..OYYYYYYO..',
    '..OYYYYYYO..', '..OYYYYYYO..', '..OYYYYYYO..', '..OYYYYYYO..', '..OOOOOOOO..',
    '............', '............',
  ],
  flag: [
    '............', '...OO.......', '...OROO.....', '...ORRRO....', '...ORRRRO...',
    '...ORRRO....', '...OROO.....', '...OO.......', '...OO.......', '...OO.......',
    '............', '............',
  ],
};

// 8x8 numeric chips 1-6 (die faces as pips).
const PIP_LAYOUTS = {
  1: ['33'], 2: ['11', '55'], 3: ['11', '33', '55'],
  4: ['11', '15', '51', '55'], 5: ['11', '15', '33', '51', '55'],
  6: ['11', '15', '31', '35', '51', '55'],
};
export function chipGrid(n) {
  const rows = Array.from({ length: 8 }, () => Array(8).fill('W'));
  for (let i = 0; i < 8; i++) { rows[0][i] = 'O'; rows[7][i] = 'O'; rows[i][0] = 'O'; rows[i][7] = 'O'; }
  for (const [r, c] of PIP_LAYOUTS[n].map((s) => [+s[0] + 1, +s[1] + 1])) rows[r][c] = 'X';
  // Bottom-right inner bevel shadow; top-left highlight — subtle 3-D depth
  for (let i = 1; i < 7; i++) {
    if (rows[6][i] === 'W') rows[6][i] = 'K';
    if (rows[i][6] === 'W') rows[i][6] = 'K';
  }
  // Top & left highlight strip (key 'L' = near-white highlight)
  for (let i = 1; i < 6; i++) {
    if (rows[1][i] === 'W') rows[1][i] = 'L';
    if (rows[i][1] === 'W') rows[i][1] = 'L';
  }
  return rows.map((r) => r.join(''));
}

const STATUS = { // 8x8 status glyphs
  stun: ['........', '..WWWW..', '.WW..WW.', '....WW..', '...WW...', '...WW...', '........', '...WW...'],
  leg: ['........', '..WW....', '..WW....', '..WWWW..', '..WW....', '..WW....', '..WWWW..', '........'],
  panic: ['..W..W..', '.W.WW.W.', '...WW...', '..W..W..', '.W....W.', '...WW...', '..WWWW..', '........'],
  empty: ['........', '.WWWWWW.', '.W....W.', '.W.XX.W.', '.W.XX.W.', '.W....W.', '.WWWWWW.', '........'],
};
const TARGET_MARK = ['...YY...', '..YYYY..', '.YYYYYY.', 'YYYOOYYY', '.YY..YY.', '.YYYYYY.', '..YYYY..', '...YY...'];
const ARROW = ['...WW...', '..WWWW..', '.WWWWWW.', 'WWWWWWWW', '...WW...', '...WW...', '...WW...', '........'];

export const UI = {
  cardFrames: Object.fromEntries(Object.entries(CARD_COLORS).map(([name, color]) =>
    [name, { grid: CARD_FRAME, palette: recolor(UI_PALETTE, { K: color }) }])),
  icons: Object.fromEntries(Object.entries(ICONS).map(([name, grid]) =>
    [name, { grid, palette: UI_PALETTE }])),
  chips: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) =>
    [n, { grid: chipGrid(n), palette: UI_PALETTE }])),
  status: Object.fromEntries(Object.entries(STATUS).map(([name, grid]) =>
    [name, { grid, palette: UI_PALETTE }])),
  targetMark: { grid: TARGET_MARK, palette: UI_PALETTE },
  arrow: { grid: ARROW, palette: UI_PALETTE },
};

export const SPRITES = { hunters: HUNTERS, monsters: MONSTERS, tiles: TILES, ui: UI };

// Every (grid, palette) pair the atlas will bake — used by tests and buildAtlas.
export function allSpriteEntries() {
  const out = [];
  for (const h of HUNTERS) {
    for (const pal of PALETTE_NAMES) {
      out.push([`hunter${h.id}.${pal}.idle`, h.grids.idle, PALETTES[pal]]);
      out.push([`hunter${h.id}.${pal}.step`, h.grids.step, PALETTES[pal]]);
      out.push([`hunter${h.id}.${pal}.icon`, h.icon, PALETTES[pal]]);
    }
  }
  for (const [kind, m] of Object.entries(MONSTERS)) {
    out.push([`monster.${kind}.idle`, m.grids.idle, m.palette]);
    out.push([`monster.${kind}.step`, m.grids.step, m.palette]);
  }
  for (const [name, t] of Object.entries(TILES)) out.push([`tile.${name}`, t.grid, t.palette]);
  for (const [name, c] of Object.entries(UI.cardFrames)) out.push([`card.${name}`, c.grid, c.palette]);
  for (const [name, i] of Object.entries(UI.icons)) out.push([`icon.${name}`, i.grid, i.palette]);
  for (const [n, c] of Object.entries(UI.chips)) out.push([`chip.${n}`, c.grid, c.palette]);
  for (const [name, s] of Object.entries(UI.status)) out.push([`status.${name}`, s.grid, s.palette]);
  out.push(['ui.targetMark', UI.targetMark.grid, UI.targetMark.palette]);
  out.push(['ui.arrow', UI.arrow.grid, UI.arrow.palette]);
  return out;
}

// Browser-only: bake everything into canvases keyed by name.
export function buildAtlas(scale = 1) {
  if (typeof document === 'undefined') {
    throw new Error('buildAtlas requires a DOM; import data exports in Node instead');
  }
  const atlas = {};
  for (const [name, grid, palette] of allSpriteEntries()) {
    const errors = validateGrid(grid, palette);
    if (errors.length) throw new Error(`sprite ${name}: ${errors[0]}`);
    atlas[name] = bake(grid, palette, scale);
  }
  return atlas;
}

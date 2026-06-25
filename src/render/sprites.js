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
const PIT = [
  'ddXXXXXXXXXXXXdd',  // lighter shadow rim
  'dXXXXXXXXXXXXXXd',
  'XOOOOOOOOOOOOOOX',  // deep void interior
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XOOOdOOOOOOdOOOX',  // faint crack suggestion
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XOOdOOOOOOOOdOOX',  // second crack band
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XOOOOOOOOOOOOOOX',
  'XXXXXXXXXXXXXXXX',  // bottom edge
];
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
// Worn/aged chest variant — same shape, added crack pixels ('d') for weathered look
const BOX_WORN = [
  '................', '................', '................', '....OOOOOOOO....',
  '...OBBdBBBBBO...', '..OBbBBBBBBbBO..', '..OBBBBBdBBBBO..', '..OOOOOOOOOOOO..',
  '..OBBdYYBBBBBO..', '..OBBBYYBBBdBO..', '..ObBBBBBBBbBO..', '..OBBBdBBBBBBO..',
  '..ObBBBBdBBBbO..', '...OOOOOOOOOO...', '................', '................',
];
const BOX_WORN_OPEN = [
  '................', '................', '..OOOOOOOOOOOO..', '..OXXXXXXXXXXO..',
  '..OXXXXXXXXXXO..', '..OOOOOOOOOOOO..', '..OBBBBBdBBBBO..', '..OBbBBBBBBbBO..',
  '..OBBdBBBBBBBO..', '..OBBBYYBBBBdO..', '..OBBBYYBBBdBO..', '..ObBBBBBBBbBO..',
  '..OBBBBBBdBBBO..', '...OOOOOOOOOO...', '................', '................',
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

const WALL_D = [ // rough-cut stone — weathered texture marks inside each block face
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGgGGGGdGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGgGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGXcGGGGXcGX',
  'XGGGGGXGGdGGXGGX',
  'XGGGGGXGGGGGXGgX',
  'XgGGGGXGGGGGXgGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGdGGGGGgGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_C = [ // stone-block face — one wide upper block, three narrow lower blocks
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGgGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGXcGGGXcGgX',
  'XGGGGGXGGGGXGGdX',
  'XGGGGGXGGGGXGGGX',
  'XgGGGGXGGGGXgGGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_E = [ // colonnade face — two equal sub-blocks with centre pillar divider
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGgGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGXcGGGGGgX',
  'XGgGGGGXGGGGdGGX',
  'XGGGGGGXGGGGGGGX',
  'XgGGGGGXGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_F = [ // mossy stone — scattered dark-green lichen patches on block faces
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGgGX',
  'XGeGGGGGGGGGGGGX',
  'XGGGGGGgGGeGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGXcGGGGgX',
  'XGGGGeGGXGGGGGGX',
  'XGGGGGGGXGGGGGeX',
  'XgGGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGeGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_G = [ // cracked stone — a jagged fissure cuts diagonally through the block face
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGdGGGGGgX',
  'XGgGGGGdGGGGGGGX',
  'XGGGGGdGGGGGGGGX',
  'XGGGGGGdGGGGGGGX',
  'XgGGGGdGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGdGXcGGGGgX',
  'XGgGGdGGXGGGGGGX',
  'XGGGGdGGXGGGGGGX',
  'XgGGdGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_P = [ // toothed cornice — crenelated top course with notched parapet marks
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGdGGGGdGGGGdGX',
  'XddGGGGddGGGGddX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGXcGGGGgX',
  'XGGGGGGGXGGGGGgX',
  'XGGGGGGGXGGGGGgX',
  'XGGGGGGGXGGGGGgX',
  'XgGGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_T = [ // engaged column — central pilaster shaft with capital and base bands
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGdddGGGGGX',
  'XGGGGGGdddGGGGGX',
  'XGGGGGGGdGGGGGGX',
  'XGGGGGGGdGGGGGGX',
  'XGGGGGGGdGGGGGGX',
  'XgGGGGGGdGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGdGGGGgX',
  'XGGGGGGGGdGGGGGX',
  'XGGGGGGdddGGGGGX',
  'XGgGGGGdddGGGggX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_U = [ // diamond lattice — shallow cut-diamond facets across two courses
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGdGGGGGdGGGGX',
  'XGGdGGGGGdGGGGGX',
  'XGdGGGGGdGGGGGGX',
  'XGGdGGGGGdGGGGGX',
  'XGGGdGGGGGdGGGGX',
  'XGgGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGdGGGGdGGgX',
  'XGGGdGGGGGdGGGGX',
  'XGGdGGGGGdGGGGGX',
  'XGdGGGGGdGGGGGGX',
  'XGGdGGGGGdGGGGGX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_V = [ // drip face — stalactite moisture streaks on block surface
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGdGGGGGGGGGGX',
  'XGGGdGGGGGGdGGGX',
  'XGGGdGGGGGGdGGGX',
  'XGGGXGGGGGGdGGGX',
  'XGGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGdGGgX',
  'XGGGGGGGGGGdGGGX',
  'XGGdGGGGGGGXGGGX',
  'XGGdGGGGGGGGGGGX',
  'XGGdGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_W = [ // recessed panel — large inset rectangle suggesting architectural paneling
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGgX',
  'XGGdGGGGGGGGdGGX',
  'XGGdGGGGGGGGdGGX',
  'XGGdGGGGGGGGdGGX',
  'XGGdGGGGGGGGdGGX',
  'XGgGddddddddGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGdGGGGGGdGGgX',
  'XGGGdGGGGGdGGGGX',
  'XGGGGdGGGdGGGGGX',
  'XGGGGGdGdGGGGGGX',
  'XGGGGGGdGGGGGGGX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_X = [ // basket weave — alternating horizontal and vertical stone courses
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGXGGGGGGX',
  'XGGGGGGGXGGGGGGX',
  'XGGXGGGGGGGGXGGX',
  'XGGXGGGGGGGGXGGX',
  'XGGGGGGGXGGGGGGX',
  'XGgGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGXGGGGXGGgX',
  'XGGGGXGGGGXGGGGX',
  'XGXGGGGGXGGGGXGX',
  'XGXGGGGGXGGGGXGX',
  'XGGGGXGGGGXGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_S = [ // vermiculated — scattered worm-track pits across two-course block faces
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGdGGGGGGGdGGGX',
  'XGGGGdGGGGGGGdGX',
  'XGdGGGGdGGGGGGGX',
  'XGGGGGGGGdGGdGGX',
  'XgGdGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGdGGGGGGGgX',
  'XGGGGGGGGdGGdGGX',
  'XGGdGGGGGGGGGGGX',
  'XGGGGGGdGGGGdGGX',
  'XgGGGGGGGdGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_R = [ // dado wall — dado rail divides blank upper zone from panelled lower zone
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XddddddddddddddX',
  'XcGGGGGGXcGGGGgX',
  'XGGdGGGGXGGGdGGX',
  'XGGGGGGGXGGGGGGX',
  'XGGGGGGGXGGGGGGX',
  'XgGGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_Q = [ // medallion — oval seal carved into upper wall face, d centre mark
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGdddddGGGGX',
  'XGGGGdGGGGGdGGGX',
  'XGGGdGGGGGGGdGGX',
  'XGGdGGGGGGGGGdGX',
  'XGGdGGGGdGGGGdGX',
  'XGGdGGGGGGGGGdGX',
  'XGGGdGGGGGGGdGGX',
  'XGGGGdGGGGGdGGGX',
  'XGGGGGdddddGGGGX',
  'XGGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_O = [ // diagonal slash — angled dark marks across two courses suggest raked brickwork
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGdGGGGGdGGGGX',
  'XGGdGGGGGdGGGGGX',
  'XGdGGGGGdGGGGGGX',
  'XdGGGGGdGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGdGGGGGdGGgX',
  'XGGdGGGGGdGGGGGX',
  'XGdGGGGGdGGGGGGX',
  'XdGGGGGdGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_N = [ // arch niche — shallow semicircular alcove carved into upper wall face
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGdOOOOOdGGGX',
  'XGGGdOdddddOdGGX',
  'XGGdOdddddddOdGX',
  'XGGOdddddddddOGX',
  'XGGOdddddddddOGX',
  'XGGGOOOOOOOOOOGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_M = [ // coursed ashlar — two large cut-stone blocks with deep interlocking joints
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGdGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGXGGGGGGX',
  'XGGGGGGGXGGGGGGX',
  'XgGGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XGGGGdGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGXGGGGGGGGgX',
  'XGGGGXGGGGGGGGGX',
  'XgGGGXGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_L = [ // slot drain — a narrow horizontal channel etched into the lower wall face
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XGGGOOOOOOOOGGGX',
  'XGGGOddddddOGGGX',
  'XGGGOOOOOOOOGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_K = [ // barred window — deep-set arched opening with iron bars
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGOOOOOOOOGGGX',
  'XGGGOdXdXdXOGGGX',
  'XGGGOdXdXdXOGGGX',
  'XGGGOdXdXdXOGGGX',
  'XGGGOdXdXdXOGGGX',
  'XGGGOdXdXdXOGGGX',
  'XGGGOdXdXdXOGGGX',
  'XGGGOOOOOOOOGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_J = [ // carved cross — sunken panel bearing a chisel-cut cross rune
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGddddddddGGGX',
  'XGGGdGGddGGdGGGX',
  'XGGGdGGddGGdGGGX',
  'XGGGddddddddGGGX',
  'XGGGdGGddGGdGGGX',
  'XGGGdGGddGGdGGGX',
  'XGGGddddddddGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_I = [ // monolith — one tall slab, no horizontal mortar joint, subtle texture flecks
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGgGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGgX',
  'XGGdGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGdGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_H = [ // pillar-panel — slim stone columns flank a deep recessed centre
  'XXXXXXXXXXXXXXXX',
  'XcGXdddddddddXgX',
  'XGGXdddddddddXGX',
  'XGGXdddddddddXGX',
  'XGGXdddddddddXGX',
  'XgGXdddddddddXgX',
  'XXXXXXXXXXXXXXXX',
  'XcGXdddddddddXgX',
  'XGGXdddddddddXGX',
  'XGGXdddddddddXGX',
  'XgGXdddddddddXgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_Y = [ // dentil frieze — classical toothed molding row above a plain lower panel
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGXcGGXcGGXcGX',
  'XGGGXGGGXGGGXGGX',
  'XgGGXgGGXgGGXgGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_Z = [ // offset running bond — classic half-offset coursed masonry, three full courses
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGXGGGGGgX',
  'XGGGGGGGXGGGGGgX',
  'XgGGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGXcGGGGGXGgX',
  'XGGGGXGGGGGGXGgX',
  'XgGGGXGGGGGGXGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGXGGGGGgX',
  'XGGGGGGGXGGGGGgX',
  'XgGGGGGGXGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGXcGGGGGXGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_AA = [ // blind niche — shadow-filled recessed niche framed by dressed stone
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGXXXXXXXXGGgX',
  'XGGGXddddddXGGGX',
  'XGGGXddddddXGGGX',
  'XGGGXddddddXGGGX',
  'XGGGXddddddXGGGX',
  'XGGGXXXXXXXXGGgX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_AB = [ // banded ashlar — smooth dressed stone with a band of dense small brickwork
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XcGXcGXcGXcGXcGX',
  'XGGXGGXGGXGGXGGX',
  'XgGXgGXgGXgGXgGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XGGGGGGGGGGGGGGX',
  'XGGGGGGGGGGGGGGX',
  'XgGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_AC = [ // stacked grid bond — three courses of square-stacked bricks, no offset
  'XXXXXXXXXXXXXXXX',
  'XcGGgXcGGgXcGGgX',
  'XGGGGXGGGGXGGGGX',
  'XgGGGXgGGGXgGGGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGgXcGGgXcGGgX',
  'XGGGGXGGGGXGGGGX',
  'XgGGGXgGGGXgGGGX',
  'XXXXXXXXXXXXXXXX',
  'XcGGgXcGGgXcGGgX',
  'XGGGGXGGGGXGGGGX',
  'XgGGGXgGGGXgGGGX',
  'XXXXXXXXXXXXXXXX',
  'XGGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
];

const WALL_AD = [ // fluted pilasters — four vertical flute shafts divided by a horizontal capital band
  'XXXXXXXXXXXXXXXX',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XXXXXXXXXXXXXXXX',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XcGgXcGgXcGgXcGg',
  'XXXXXXXXXXXXXXXX',
  'XcGGGGGGGGGGGGgX',
  'XXXXXXXXXXXXXXXX',
  'GGGGGGGGGGGGGGGG',
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

const FLOOR_K = [ // paired vertical grooves — stone panel joint running top to bottom
  'GGGGGGGGGGGGGGGg',
  'GgGGGGGGGGGGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_M = [ // horizontal ashlar seams — two full-width mortar lines splitting tile into slabs
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGGG',
  'GGdddddddddddddG',
  'GGGGGGGGGGGGGGGG',
  'GGGGgGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGgGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGdddddddddddddG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_N = [ // V-chevron herringbone — two stacked V-grooves across the tile
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGgG',
  'GGGGGGGGdGGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGdGGdGGGGGG',
  'GGGGGdGGGGdGGGGG',
  'GGGGdGGGGGGdGGGG',
  'GGGdGGGGGGGGdGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGdGGGGGGGGdGGG',
  'GGGGdGGGGGGdGGGG',
  'GGGGGdGGGGdGGGGG',
  'GGGGGGdGGdGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGGgGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_O = [ // double concentric square grooves — ornate flagstone panel
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGgG',
  'GGddddddddddddGG',
  'GGdGGGGGGGGGGdGG',
  'GGdGGddddddGGdGG',
  'GGdGGdGGGGdGGdGG',
  'GGdGGdGGgGdGGdGG',
  'GGdGGdGGGGdGGdGG',
  'GGdGGdGGGGdGGdGG',
  'GGdGGdGgGGdGGdGG',
  'GGdGGdGGGGdGGdGG',
  'GGdGGGddddddGdGG',
  'GGdGGGGGGGGGGdGG',
  'GGGddddddddddddG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_L = [ // corner bracket marks — layout survey marks at each quadrant corner
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGgG',
  'GGdGGGGGGGGGGdGG',
  'GGdGGGGGGGGGGdGG',
  'GGGddGGGGGGddGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGddGGGGGGddGGG',
  'GGdGGGGGGGGGGdGG',
  'GGdGGGGGGGGGGdGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_P = [ // diagonal X — two crossing grooves from opposite corners
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGgG',
  'GGdGGGGGGGGGGdGG',
  'GGGdGGGGGGGGdGGG',
  'GGGGdGGGGGGdGGGG',
  'GGGGGdGGGGdGGGGG',
  'GGGGGGdGGdGGGGGG',
  'GGGGGGGddGGGGGGG',
  'GGGGGGGddGGGGGGG',
  'GGGGGGdGGdGGGGGG',
  'GGGGGdGGGGdGGGGG',
  'GGGGdGGGGGGdGGGG',
  'GGGdGGGGGGGGdGGG',
  'GGdGGGGGGGGGGdGG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_Q = [ // mason's mark — a faint cross etched into the stone face
  'GGGGGGGGGGGGGGgG',
  'GGgGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGdddddddddddGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_R = [ // four-diamond — dark stone inlays at quarter positions
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGGG',
  'GGGdGGGGGGGdGGGG',
  'GGdddGGGGGdddGGG',
  'GGGdGGGGGGGdGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'GGGdGGGGGGGdGGGG',
  'GGdddGGGGGdddGGG',
  'GGGdGGGGGGGdGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_S = [ // worn center — polished diamond where foot traffic brightens the stone
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGcGGGGcGGGGG',
  'GGGGGGcGGcGGGGGG',
  'GGGGGGGccGGGGGGG',
  'GGGGGGGccGGGGGGG',
  'GGGGGGcGGcGGGGGG',
  'GGGGGcGGGGcGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_X = [ // cobblestone joints — organic d marks suggest irregular stone edges
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGdGGGGGGGdGGG',
  'GGGdGGGGGGGdGGGG',
  'GGdGGGGGdGGGGdGG',
  'GGGdGGGdGGGdGGGG',
  'GGGGdGdGGGdGGGGG',
  'GGGGGdGGGdGGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGdGGGGGGGdGGGG',
  'GGdGGGGGdGGGGdGG',
  'GGGdGGGdGGGdGGGG',
  'GGGGdGdGGGdGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_Y = [ // herringbone — diagonal brick pairs alternate direction every course
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'dGGGGGdGGGGGdGGG',
  'GdGGGGGdGGGGGdGG',
  'GGdGGGGGdGGGGGdG',
  'GGGdGGGGGdGGGGGd',
  'GGGGdGGGGGdGGGGG',
  'GGGGGdGGGGGdGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGdGGGGGdGGGGGd',
  'GGdGGGGGdGGGGGdG',
  'GdGGGGGdGGGGGdGG',
  'dGGGGGdGGGGGdGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_Z = [ // wide slab — horizontal coursed stone with thick mortar lines
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'dddddddddddddddd',
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'dddddddddddddddd',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGGdG',
  'GgGGGGGGGGGGGGGG',
  'dddddddddddddddd',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_W = [ // running bond — brick rows with half-offset vertical mortar joints
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'dddddddGdddddddG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'dddGdddddddGdddG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'dddddddGdddddddG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'dddGdddddddGdddG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_V = [ // chevron groove — V-shaped channels across the tile suggest carved stone coursing
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGdG',
  'dGGGGGGGdGGGGGGd',
  'GdGGGGGdGdGGGGdG',
  'GGdGGGdGGGdGGdGG',
  'GGGdGdGGGGGdGdGG',
  'GGGGdGGGGGGGdGGG',
  'GGGGdGGGGGGGdGGG',
  'GGGdGdGGGGGdGdGG',
  'GGdGGGdGGGdGGdGG',
  'GdGGGGGdGdGGGGdG',
  'dGGGGGGGdGGGGGGd',
  'GGGGGGGGGGGGGGdG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_U = [ // lozenge inlay — paired diamond motifs with darker centre stones
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGdGGGGGGGdGGG',
  'GGGdGgGGGGGdGgGG',
  'GGdGGGdGGGdGGGdG',
  'GGGdGgGGGGGdGgGG',
  'GGGGdGGGGGGGdGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGdGGGGGGGdGGG',
  'GGGdGgGGGGGdGgGG',
  'GGdGGGdGGGdGGGdG',
  'GGGdGgGGGGGdGgGG',
  'GGGGdGGGGGGGdGGG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_T = [ // compass rose — N/S/E/W arms with intercardinal ticks, c hub
  'GGGGGGGGGGGGGGGG',
  'GgGGGGGGGGGGGGgG',
  'GGGGGGGdGGGGGGGG',
  'GGGGgGGdGGGgGGGG',
  'GGGGGgGdGgGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGdddddccdddddGG',
  'GGdddddccdddddGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGgGdGgGGGGGG',
  'GGGGgGGdGGGgGGGG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_AA = [ // large inset diamond — full-tile diamond outline, classic geometric paving
  'GGGGGGGGGGGGGGgG',
  'GGGGGGGdGGGGGGGG',
  'GGGGGGdGdGGGGGGG',
  'GGGGGdGGGdGGGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGdGGGGGGGdGGGG',
  'GGdGGGGGGGGGdGGG',
  'GdGGGGGGGGGGGdGG',
  'dGGGGGGGGGGGGGdG',
  'GdGGGGGGGGGGGdGG',
  'GGdGGGGGGGGGdGGG',
  'GGGdGGGGGGGdGGGG',
  'GGGGdGGGGGdGGGGG',
  'GGGGGdGGGdGGGGGG',
  'GGGGGGdGdGGGGGGG',
  'GGGGGGGdGGGGGGGG',
];

const FLOOR_AB = [ // tudor rose — 8-pointed light star with dark centre, medieval floor motif
  'GGGGGGGGGGGGGGgG',
  'GgGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGcGGGGGGG',
  'GGGGGGcGGGcGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGcGGdGGcGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGcGGGcGGGGG',
  'GGGGGGGGcGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGgGG',
  'GGGGGGGGGGGGGGGG',
];

const FLOOR_AC = [ // diagonal slab — three parallel 45° mortar joints (top-right to bottom-left), period-5, seamlessly tiling
  'GGGGGdGGGGdGGGGd',
  'GGGGdGGGGdGGGGdG',
  'GGGdGGGGdGGGGdGG',
  'GGdGGGGdGGGGdGGG',
  'GdGGGGdGGGGdGGGG',
  'dGGGGdGGGGdGGGGG',
  'GGGGdGGGGdGGGGGd',
  'GGGdGGGGdGGGGGdG',
  'GGdGGGGdGGGGGdGG',
  'GdGGGGdGGGGGdGGG',
  'dGGGGdGGGGGdGGGG',
  'GGGGdGGGGGdGGGGd',
  'GGGdGGGGGdGGGGdG',
  'GGdGGGGGdGGGGdGG',
  'GdGGGGGdGGGGdGGG',
  'dGGGGGdGGGGdGGGG',
];

const FLOOR_AD = [ // diamond crosshatch — two families of 45° diagonal grooves at period-8 create a continuous diamond grid
  'dGGGGGGGdGGGGGGG',
  'GdGGGGGdGdGGGGGd',
  'GGdGGGdGGGdGGGdG',
  'GGGdGdGGGGGdGdGG',
  'GGGGdGGGGGGGdGGG',
  'GGGdGdGGGGGdGdGG',
  'GGdGGGdGGGdGGGdG',
  'GdGGGGGdGdGGGGGd',
  'dGGGGGGGdGGGGGGG',
  'GdGGGGGdGdGGGGGd',
  'GGdGGGdGGGdGGGdG',
  'GGGdGdGGGGGdGdGG',
  'GGGGdGGGGGGGdGGG',
  'GGGdGdGGGGGdGdGG',
  'GGdGGGdGGGdGGGdG',
  'GdGGGGGdGdGGGGGd',
];

const FLOOR_AE = [ // basketweave — alternating horizontal-stripe and vertical-stripe 4×4 panels tile as a classic basketweave
  'GGGGGgGgGGGGGgGg',
  'ggggGgGgggggGgGg',
  'GGGGGgGgGGGGGgGg',
  'ggggGgGgggggGgGg',
  'GgGgGGGGGgGgGGGG',
  'GgGgggggGgGggggg',
  'GgGgGGGGGgGgGGGG',
  'GgGgggggGgGggggg',
  'GGGGGgGgGGGGGgGg',
  'ggggGgGgggggGgGg',
  'GGGGGgGgGGGGGgGg',
  'ggggGgGgggggGgGg',
  'GgGgGGGGGgGgGGGG',
  'GgGgggggGgGggggg',
  'GgGgGGGGGgGgGGGG',
  'GgGgggggGgGggggg',
];

const FLOOR_AF = [ // sunken oculus — a circular dark medallion inlaid at tile center, r=5
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGgGGGGGGG',
  'GGGGGgdddddgGGGG',
  'GGGGgdddddddgGGG',
  'GGGGgdddddddgGGG',
  'GGGGgdddddddgGGG',
  'GGGgdddddddddgGG',
  'GGGGgdddddddgGGG',
  'GGGGgdddddddgGGG',
  'GGGGgdddddddgGGG',
  'GGGGGgdddddgGGGG',
  'GGGGGGGGgGGGGGGG',
  'GGGGGGGGGGGGGGGG',
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
  floorK: { grid: FLOOR_K, palette: TILE_PALETTE },
  floorL: { grid: FLOOR_L, palette: TILE_PALETTE },
  floorM: { grid: FLOOR_M, palette: TILE_PALETTE },
  floorN: { grid: FLOOR_N, palette: TILE_PALETTE },
  floorO: { grid: FLOOR_O, palette: TILE_PALETTE },
  floorP: { grid: FLOOR_P, palette: TILE_PALETTE },
  floorQ: { grid: FLOOR_Q, palette: TILE_PALETTE },
  floorR: { grid: FLOOR_R, palette: TILE_PALETTE },
  floorS: { grid: FLOOR_S, palette: TILE_PALETTE },
  floorT: { grid: FLOOR_T, palette: TILE_PALETTE },
  floorU: { grid: FLOOR_U, palette: TILE_PALETTE },
  floorV: { grid: FLOOR_V, palette: TILE_PALETTE },
  floorW: { grid: FLOOR_W, palette: TILE_PALETTE },
  floorX: { grid: FLOOR_X, palette: TILE_PALETTE },
  floorY: { grid: FLOOR_Y, palette: TILE_PALETTE },
  floorZ: { grid: FLOOR_Z, palette: TILE_PALETTE },
  floorAA: { grid: FLOOR_AA, palette: TILE_PALETTE },
  floorAB: { grid: FLOOR_AB, palette: TILE_PALETTE },
  floorAC: { grid: FLOOR_AC, palette: TILE_PALETTE },
  floorAD: { grid: FLOOR_AD, palette: TILE_PALETTE },
  floorAE: { grid: FLOOR_AE, palette: TILE_PALETTE },
  floorAF: { grid: FLOOR_AF, palette: TILE_PALETTE },
  pit: { grid: PIT, palette: TILE_PALETTE },
  wall: { grid: WALL, palette: TILE_PALETTE },
  wallB: { grid: WALL_B, palette: TILE_PALETTE },
  wallC: { grid: WALL_C, palette: TILE_PALETTE },
  wallD: { grid: WALL_D, palette: TILE_PALETTE },
  wallE: { grid: WALL_E, palette: TILE_PALETTE },
  wallF: { grid: WALL_F, palette: TILE_PALETTE },
  wallG: { grid: WALL_G, palette: TILE_PALETTE },
  wallH: { grid: WALL_H, palette: TILE_PALETTE },
  wallI: { grid: WALL_I, palette: TILE_PALETTE },
  wallJ: { grid: WALL_J, palette: TILE_PALETTE },
  wallK: { grid: WALL_K, palette: TILE_PALETTE },
  wallL: { grid: WALL_L, palette: TILE_PALETTE },
  wallM: { grid: WALL_M, palette: TILE_PALETTE },
  wallN: { grid: WALL_N, palette: TILE_PALETTE },
  wallO: { grid: WALL_O, palette: TILE_PALETTE },
  wallP: { grid: WALL_P, palette: TILE_PALETTE },
  wallQ: { grid: WALL_Q, palette: TILE_PALETTE },
  wallR: { grid: WALL_R, palette: TILE_PALETTE },
  wallS: { grid: WALL_S, palette: TILE_PALETTE },
  wallT: { grid: WALL_T, palette: TILE_PALETTE },
  wallU: { grid: WALL_U, palette: TILE_PALETTE },
  wallV: { grid: WALL_V, palette: TILE_PALETTE },
  wallW: { grid: WALL_W, palette: TILE_PALETTE },
  wallX: { grid: WALL_X, palette: TILE_PALETTE },
  wallY: { grid: WALL_Y, palette: TILE_PALETTE },
  wallZ: { grid: WALL_Z, palette: TILE_PALETTE },
  wallAA: { grid: WALL_AA, palette: TILE_PALETTE },
  wallAB: { grid: WALL_AB, palette: TILE_PALETTE },
  wallAC: { grid: WALL_AC, palette: TILE_PALETTE },
  wallAD: { grid: WALL_AD, palette: TILE_PALETTE },
  exit: { grid: EXIT, palette: TILE_PALETTE },
  boxClosed: { grid: BOX_CLOSED, palette: TILE_PALETTE },
  boxOpen: { grid: BOX_OPEN, palette: TILE_PALETTE },
  boxWorn: { grid: BOX_WORN, palette: TILE_PALETTE },
  boxWornOpen: { grid: BOX_WORN_OPEN, palette: TILE_PALETTE },
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
  plus: [
    '............', '....OOOO....', '....ORRO....', '....ORRO....', '.OOOORROOO..',
    '.ORRRRRRRO..', '.ORRRRRRRO..', '.OOOORROOO..', '....ORRO....', '....ORRO....',
    '....OOOO....', '............',
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

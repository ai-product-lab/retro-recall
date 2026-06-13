/**
 * Splash Squad levels (SPEC.md §10). Per the approved authoring convention for a
 * multi-screen scroller, terrain is composed by `buildRows` into the same ASCII
 * `string[]` that `TileMap.parse` consumes — so the parse/physics path is
 * byte-identical to Bubble Buddies — and each level's camera-triggered spawn
 * waves live alongside it as data. Pure / deterministic (no RNG, no wall-clock):
 * the replay fixtures keep all of this honest.
 *
 * Legend: `#` solid, `=` one-way platform, `.` empty, and markers
 * `P` squad anchor · `S` spigot · `M`/`W`/`U` stream/spread/burst pickup ·
 * `B` boss anchor. A `pit` opens the ground row so a fall downs the player (§7).
 */
import { LEVEL_HEIGHT, SCREEN_TILES_W, TILE_SIZE } from './constants';

export type RobotType = 'trundle' | 'sentry' | 'hopper' | 'boss';

export interface WaveSpawn {
  type: RobotType;
  tx: number;
  ty: number;
}

/** A camera-triggered wave: fires once when the window's right edge passes `trigger` (world-px). */
export interface Wave {
  id: number;
  trigger: number;
  spawns: WaveSpawn[];
}

export interface LevelDef {
  name: string;
  /** 0-based zone (0..2); boss HP scales with this. */
  zone: number;
  /** Width in screens. */
  screens: number;
  rows: readonly string[];
  schedule: readonly Wave[];
  /** True for the zone-ending boss level. */
  boss: boolean;
}

interface Feats {
  platforms?: [tx: number, ty: number, len: number][];
  blocks?: [tx: number, ty: number, w: number, h: number][];
  pits?: [tx: number, len: number][];
  markers?: [char: string, tx: number, ty: number][];
}

/** Compose feature lists into an enclosed ASCII level `screens` wide, 24 tall. */
function buildRows(screens: number, f: Feats): string[] {
  const W = screens * SCREEN_TILES_W;
  const H = LEVEL_HEIGHT;
  const g: string[][] = [];
  for (let y = 0; y < H; y++) {
    const row: string[] = [];
    for (let x = 0; x < W; x++) {
      let c = '.';
      if (y === 0 || y === H - 1 || x === 0 || x === W - 1) c = '#';
      row.push(c);
    }
    g.push(row);
  }
  const set = (x: number, y: number, c: string): void => {
    if (y >= 0 && y < H && x >= 0 && x < W) g[y]![x] = c;
  };
  for (const [tx, ty, len] of f.platforms ?? []) for (let i = 0; i < len; i++) set(tx + i, ty, '=');
  for (const [tx, ty, w, h] of f.blocks ?? [])
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) set(tx + xx, ty + yy, '#');
  for (const [tx, len] of f.pits ?? []) for (let i = 0; i < len; i++) set(tx + i, H - 1, '.');
  for (const [char, tx, ty] of f.markers ?? []) set(tx, ty, char);
  return g.map((r) => r.join(''));
}

const GROUND = LEVEL_HEIGHT - 1; // row index of the ground
const STAND = GROUND - 1; // a marker resting on the ground sits here

/** A wave appearing as tile column `tx` reaches the window's right edge. */
const wave = (id: number, spawns: WaveSpawn[]): Wave => ({
  id,
  trigger: Math.min(...spawns.map((s) => s.tx)) * TILE_SIZE,
  spawns,
});

const t = (tx: number, ty = STAND): WaveSpawn => ({ type: 'trundle', tx, ty });
const sentry = (tx: number, ty = STAND): WaveSpawn => ({ type: 'sentry', tx, ty });
const hop = (tx: number, ty = STAND): WaveSpawn => ({ type: 'hopper', tx, ty });

// --- Zone 0: Backyard (4 screens) -----------------------------------------

const L1: LevelDef = {
  name: 'Sprinkler Run',
  zone: 0,
  screens: 4,
  boss: false,
  rows: buildRows(4, {
    platforms: [
      [10, 13, 6],
      [22, 17, 5],
      [44, 12, 7],
      [70, 16, 6],
      [96, 13, 6],
    ],
    pits: [[58, 3], [84, 3]],
    markers: [
      ['P', 2, STAND],
      ['S', 30, STAND],
      ['W', 46, 11],
      ['S', 92, STAND],
    ],
  }),
  schedule: [
    wave(0, [t(36), t(42)]),
    wave(1, [t(54)]),
    wave(2, [t(66), t(72)]),
    wave(3, [t(88), t(94), t(100)]),
    wave(4, [t(114), t(120)]),
  ],
};

const L2: LevelDef = {
  name: 'Patio Standoff',
  zone: 0,
  screens: 4,
  boss: true,
  rows: buildRows(4, {
    platforms: [
      [12, 14, 6],
      [34, 16, 5],
      [52, 12, 6],
      [74, 15, 6],
    ],
    pits: [[44, 3]],
    blocks: [[112, GROUND - 4, 1, 4]], // arena lip
    markers: [
      ['P', 2, STAND],
      ['S', 28, STAND],
      ['U', 54, 11],
      ['S', 88, STAND],
      ['B', 118, STAND],
    ],
  }),
  schedule: [
    wave(0, [t(36), sentry(48, 15)]),
    wave(1, [t(58), t(64)]),
    wave(2, [sentry(78, 14), t(84)]),
    wave(3, [t(96), sentry(104, STAND)]),
    wave(10, [{ type: 'boss', tx: 118, ty: STAND }]),
  ],
};

// --- Zone 1: Jungle Gym (5 screens) ---------------------------------------

const L3: LevelDef = {
  name: 'Vine Climb',
  zone: 1,
  screens: 5,
  boss: false,
  rows: buildRows(5, {
    platforms: [
      [10, 16, 5],
      [20, 12, 5],
      [40, 14, 6],
      [60, 10, 6],
      [82, 15, 6],
      [104, 12, 6],
      [130, 16, 6],
    ],
    pits: [[52, 3], [96, 4]],
    markers: [
      ['P', 2, STAND],
      ['S', 34, STAND],
      ['W', 62, 9],
      ['S', 100, STAND],
      ['U', 132, 15],
    ],
  }),
  schedule: [
    wave(0, [t(36), hop(44)]),
    wave(1, [hop(56), t(62)]),
    wave(2, [t(74), hop(80)]),
    wave(3, [hop(98), hop(104)]),
    wave(4, [t(120), hop(128), t(134)]),
    wave(5, [hop(150), t(156)]),
  ],
};

const L4: LevelDef = {
  name: 'Canopy Clash',
  zone: 1,
  screens: 5,
  boss: true,
  rows: buildRows(5, {
    platforms: [
      [14, 15, 6],
      [36, 12, 6],
      [58, 16, 5],
      [80, 13, 6],
      [104, 15, 6],
    ],
    pits: [[48, 3], [92, 4]],
    blocks: [[144, GROUND - 4, 1, 4]],
    markers: [
      ['P', 2, STAND],
      ['S', 30, STAND],
      ['W', 60, 15],
      ['U', 106, 14],
      ['S', 120, STAND],
      ['B', 150, STAND],
    ],
  }),
  schedule: [
    wave(0, [t(36), sentry(46, 11), hop(52)]),
    wave(1, [hop(64), t(70)]),
    wave(2, [sentry(84, 12), hop(90), t(96)]),
    wave(3, [t(112), hop(118), sentry(126, STAND)]),
    wave(10, [{ type: 'boss', tx: 150, ty: STAND }]),
  ],
};

// --- Zone 2: Waterworks (6 screens) ---------------------------------------

const L5: LevelDef = {
  name: 'Pipe Maze',
  zone: 2,
  screens: 6,
  boss: false,
  rows: buildRows(6, {
    platforms: [
      [10, 14, 5],
      [24, 17, 5],
      [40, 12, 6],
      [60, 15, 6],
      [80, 11, 6],
      [104, 14, 6],
      [128, 16, 6],
      [156, 13, 6],
    ],
    blocks: [
      [50, GROUND - 3, 2, 3],
      [114, GROUND - 3, 2, 3],
    ],
    pits: [[68, 3], [98, 4], [142, 4]],
    markers: [
      ['P', 2, STAND],
      ['S', 36, STAND],
      ['W', 42, 11],
      ['U', 82, 10],
      ['S', 110, STAND],
      ['M', 130, 15],
      ['S', 170, STAND],
    ],
  }),
  schedule: [
    wave(0, [t(36), sentry(44, 11), hop(50)]),
    wave(1, [hop(62), t(68), hop(74)]),
    wave(2, [sentry(86, 10), t(92), hop(98)]),
    wave(3, [t(110), hop(116), sentry(124, STAND)]),
    wave(4, [hop(136), t(142), hop(148)]),
    wave(5, [sentry(162, STAND), t(168), hop(174)]),
  ],
};

const L6: LevelDef = {
  name: 'Boiler Room',
  zone: 2,
  screens: 6,
  boss: true,
  rows: buildRows(6, {
    platforms: [
      [14, 15, 6],
      [38, 12, 6],
      [62, 16, 5],
      [84, 13, 6],
      [108, 15, 6],
      [132, 12, 6],
    ],
    blocks: [
      [54, GROUND - 3, 2, 3],
      [100, GROUND - 4, 2, 4],
      [176, GROUND - 5, 1, 5], // arena lip
    ],
    pits: [[48, 3], [94, 4], [126, 3]],
    markers: [
      ['P', 2, STAND],
      ['S', 32, STAND],
      ['W', 40, 11],
      ['U', 110, 14],
      ['S', 150, STAND],
      ['B', 182, STAND],
    ],
  }),
  schedule: [
    wave(0, [t(36), sentry(46, 11), hop(52)]),
    wave(1, [hop(64), t(70), sentry(78, STAND)]),
    wave(2, [t(88), hop(94), sentry(102, 11), t(108)]),
    wave(3, [hop(120), t(126), sentry(136, 11), hop(142)]),
    wave(4, [t(154), hop(160), t(166)]),
    wave(10, [{ type: 'boss', tx: 182, ty: STAND }]),
  ],
};

export const LEVELS: readonly LevelDef[] = [L1, L2, L3, L4, L5, L6];

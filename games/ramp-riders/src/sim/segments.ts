/**
 * Track segment modules (SPEC §12). A track is an ordered recipe of named
 * segments concatenated left-to-right; this is the seam the (parked) track
 * editor will eventually write, and what "tracks as shareable seeds/links"
 * encodes.
 *
 * Each segment is authored as its bottom rows (the rest is air); `seg()` pads it
 * to SEGMENT_HEIGHT. Terrain chars are RetroKit tiles (`# = / \ < [ ] >`).
 * Markers live in the ASCII too:
 *   - `R` rider spawn, `X` finish line.
 *   - `m` mud, `s` sprinkler, `h` hose, `o` cone — obstacles, whose **row**
 *     encodes the lane (row 14 → front/0, row 13 → mid/1, row 12 → back/2),
 *     so the 2-D ASCII carries the 3-lane obstacle layout (SPEC §5).
 */
import { TileMap, type SpawnMarker } from '@retro-recall/retrokit/sim';
import * as C from './constants';

/** Marker row → lane index (front/mid/back). */
export const MARKER_ROW_LANE: Readonly<Record<number, number>> = { 14: 0, 13: 1, 12: 2 };
export const OBSTACLE_CHARS = new Set(['m', 's', 'h', 'o']);

/** Pad authored bottom rows up to SEGMENT_HEIGHT with air rows on top. */
const seg = (bottom: readonly string[]): string[] => {
  const w = bottom[0]!.length;
  const air = '.'.repeat(w);
  const pad = C.SEGMENT_HEIGHT - bottom.length;
  return [...Array<string>(pad).fill(air), ...bottom];
};

// Rows below are 12..17 (ground = rows 15-17, ramps rise into 14/13/12).
export const SEGMENTS: Readonly<Record<string, string[]>> = {
  // Start gate: flat ground with the rider spawn.
  start: seg([
    '........',
    '........',
    '.R......',
    '########',
    '########',
    '########',
  ]),

  // Plain cruising ground.
  flat: seg([
    '........',
    '........',
    '........',
    '########',
    '########',
    '########',
  ]),

  // Gentle 22.5° roller (Lo+Hi up to a point, Hi+Lo down) — rideable, no
  // launch. No solid deck: a solid tile at the cresting box's foot row would
  // wall it, so the peak is a slope-tile apex.
  bump22: seg([
    '........',
    '........',
    '.<[]>...',
    '########',
    '########',
    '########',
  ]),

  // 45° kicker: a clean two-tile diagonal to a lip, then open ground ahead →
  // launch. The triangular interior is empty (solid only at ground rows) — a
  // ~2-tile-tall hitbox climbing a ramp must never meet a solid tile at its
  // foot row, or it wedges; the slope resolver lifts it onto the surface.
  ramp45: seg([
    '..........',
    '.../......',
    '../.......',
    '##########',
    '##########',
    '##########',
  ]),

  // Big-air kicker: a clean three-tile diagonal, open ground ahead → a big
  // launch. (RetroKit's X-then-Y resolver can't deliver a ~2-tile hitbox onto
  // an elevated solid deck horizontally, so v1 ramps are pure launch kickers
  // with flat landings — landable decks/down-ramp landings are a polish
  // follow-up; see the devlog.)
  bigkick: seg([
    '..../.....',
    '.../......',
    '../.......',
    '##########',
    '##########',
    '##########',
  ]),

  // Mud puddle in the mid lane.
  muddy: seg([
    '..........',
    '....m.....',
    '..........',
    '##########',
    '##########',
    '##########',
  ]),

  // Sprinklers: front lane then back lane.
  sprink: seg([
    '......s...',
    '..........',
    '..s.......',
    '##########',
    '##########',
    '##########',
  ]),

  // Hoses across all three lanes (front, mid, back).
  hoses: seg([
    '........h.',
    '.....h....',
    '..h.......',
    '##########',
    '##########',
    '##########',
  ]),

  // Cones in front and back lanes (wipeout hazards).
  cones: seg([
    '......o...',
    '..........',
    '...o......',
    '##########',
    '##########',
    '##########',
  ]),

  // Finish: flat run-in with the finish line.
  finish: seg([
    '........',
    '........',
    '....X...',
    '########',
    '########',
    '########',
  ]),
};

export interface BuiltTrack {
  map: TileMap;
  /** Rider spawn marker (R). */
  spawn: { tx: number; ty: number };
  /** Finish line tile-x (from the X marker). */
  finishX: number;
  /** Obstacles parsed from markers: tile-x, lane, kind. */
  obstacles: Obstacle[];
}

export type ObstacleKind = 'mud' | 'sprinkler' | 'hose' | 'cone';
export interface Obstacle {
  tx: number;
  lane: number;
  kind: ObstacleKind;
}

const OBSTACLE_KIND: Readonly<Record<string, ObstacleKind>> = {
  m: 'mud',
  s: 'sprinkler',
  h: 'hose',
  o: 'cone',
};

/** Assemble a track from a recipe of segment ids and parse it. */
export function buildTrack(recipe: readonly string[]): BuiltTrack {
  const blocks = recipe.map((id) => {
    const s = SEGMENTS[id];
    if (!s) throw new Error(`unknown segment '${id}'`);
    return s;
  });
  const rows: string[] = [];
  for (let row = 0; row < C.SEGMENT_HEIGHT; row++) {
    rows.push(blocks.map((b) => b[row]!).join(''));
  }
  const { map, spawns } = TileMap.parse(rows, C.TILE_SIZE);

  let spawn: { tx: number; ty: number } | undefined;
  let finishX: number | undefined;
  const obstacles: Obstacle[] = [];
  for (const s of spawns as SpawnMarker[]) {
    if (s.char === 'R') spawn = { tx: s.tx, ty: s.ty };
    else if (s.char === 'X') finishX = s.tx;
    else if (OBSTACLE_CHARS.has(s.char)) {
      const lane = MARKER_ROW_LANE[s.ty];
      if (lane === undefined) throw new Error(`obstacle '${s.char}' on non-lane row ${s.ty}`);
      obstacles.push({ tx: s.tx, lane, kind: OBSTACLE_KIND[s.char]! });
    } else throw new Error(`unknown marker '${s.char}'`);
  }
  if (!spawn) throw new Error('track has no R spawn');
  if (finishX === undefined) throw new Error('track has no X finish');
  // Trigger order / tie stability: obstacles sorted by x then lane.
  obstacles.sort((a, b) => a.tx - b.tx || a.lane - b.lane);
  return { map, spawn, finishX, obstacles };
}

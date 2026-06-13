/**
 * The five v1 tracks (SPEC §12), each a recipe of segment modules. Difficulty
 * ramps left → right across the list. Lengths are first-pass and tuned to the
 * 45–90 s target during the playtest. Obstacles are carried by the segments
 * themselves (markers in the ASCII — see segments.ts).
 */
import { Tile, type TileKind, type TileMap, isSlope } from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { buildTrack, type BuiltTrack } from './segments';

export interface TrackDef {
  name: string;
  recipe: readonly string[];
}

export const TRACKS: readonly TrackDef[] = [
  {
    name: 'Driveway Dash',
    recipe: [
      'start',
      ...rep('flat', 6), ...rep('bump22', 3), ...rep('flat', 6),
      'muddy', ...rep('flat', 6), ...rep('bump22', 2), ...rep('flat', 6),
      'muddy', ...rep('flat', 5), 'finish',
    ],
  },
  {
    name: 'Sprinkler Sprint',
    recipe: [
      'start',
      ...rep('flat', 5), ...rep('bump22', 2), 'sprink', ...rep('flat', 4),
      ...rep('bump22', 2), 'sprink', ...rep('flat', 4), 'ramp45', ...rep('flat', 5),
      'sprink', ...rep('flat', 4), 'finish',
    ],
  },
  {
    name: 'Hose Hop',
    recipe: [
      'start',
      ...rep('flat', 4), 'ramp45', ...rep('flat', 3), 'hoses', ...rep('bump22', 2),
      ...rep('flat', 3), 'ramp45', ...rep('flat', 3), 'hoses', ...rep('flat', 4),
      'muddy', ...rep('flat', 4), 'finish',
    ],
  },
  {
    name: 'Mud Mayhem',
    recipe: [
      'start',
      ...rep('flat', 3), 'muddy', ...rep('flat', 2), 'muddy', ...rep('bump22', 2),
      'muddy', ...rep('flat', 2), 'cones', 'ramp45', ...rep('flat', 3), 'muddy',
      ...rep('flat', 3), 'cones', ...rep('flat', 4), 'finish',
    ],
  },
  {
    name: 'Backyard Big Air',
    recipe: [
      'start',
      ...rep('flat', 3), ...rep('bigkick', 2), 'ramp45', ...rep('flat', 2), 'sprink',
      'bigkick', 'ramp45', ...rep('flat', 2), 'hoses', 'bigkick', 'ramp45',
      ...rep('flat', 2), 'cones', ...rep('flat', 3), 'finish',
    ],
  },
];

function rep(id: string, n: number): string[] {
  return Array<string>(n).fill(id);
}

/** Build a track by index (wraps via modulo — the room derives index from seed). */
export function trackByIndex(index: number): BuiltTrack & { name: string } {
  const i = ((index % C.TRACK_COUNT) + C.TRACK_COUNT) % C.TRACK_COUNT;
  const def = TRACKS[i]!;
  return { ...buildTrack(def.recipe), name: def.name };
}

/** Landing surface angle (deg) under a world-x column; sign matches tilt (>0 nose down). */
export function surfaceAngleAt(map: TileMap, worldPxX: number): number {
  const tx = Math.floor(worldPxX / map.tileSize);
  let best = 0;
  for (let ty = 0; ty < map.height; ty++) {
    const t = map.at(tx, ty);
    if (!isSlope(t)) continue;
    const a = slopeAngle(t);
    if (Math.abs(a) > Math.abs(best)) best = a;
  }
  return best;
}

function slopeAngle(t: TileKind): number {
  switch (t) {
    case Tile.Slope45L:
      return C.SURFACE_ANGLE_45; // `\` descends right → nose down
    case Tile.Slope45R:
      return -C.SURFACE_ANGLE_45; // `/` rises right → nose up
    case Tile.Slope22LHi:
    case Tile.Slope22LLo:
      return C.SURFACE_ANGLE_22;
    case Tile.Slope22RLo:
    case Tile.Slope22RHi:
      return -C.SURFACE_ANGLE_22;
    default:
      return 0;
  }
}

/** True if the slope under this column rises in the +x (travel) direction — a launch ramp. */
export function isRisingRamp(map: TileMap, worldPxX: number): TileKind | null {
  const tx = Math.floor(worldPxX / map.tileSize);
  for (let ty = 0; ty < map.height; ty++) {
    const t = map.at(tx, ty);
    if (t === Tile.Slope45R || t === Tile.Slope22RLo || t === Tile.Slope22RHi) return t;
  }
  return null;
}

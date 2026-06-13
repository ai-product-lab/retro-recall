/**
 * Slope tiles (the one real physics-core change of Phase 4a, ADR-009).
 *
 * The additivity guarantee is structural: a map with no slope tiles has
 * `hasSlopes === false`, and moveAABB then runs the exact pre-slope path. The
 * Bubble Buddies replay fixtures are the integration proof; these are the unit
 * proofs for the slope geometry and resolver.
 */
import { describe, expect, it } from 'vitest';
import { SUBPX, moveAABB } from './physics';
import { Tile, TileMap, slopeColumnHeight } from './tilemap';

const TS = 8;

describe('slope column geometry', () => {
  it('45° rises one pixel per pixel', () => {
    const r = Array.from({ length: TS }, (_, x) => slopeColumnHeight(Tile.Slope45R, TS, x));
    expect(r).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const l = Array.from({ length: TS }, (_, x) => slopeColumnHeight(Tile.Slope45L, TS, x));
    expect(l).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('22.5° rises a half tile, and Lo+Hi form a continuous full-tile climb', () => {
    const lo = Array.from({ length: TS }, (_, x) => slopeColumnHeight(Tile.Slope22RLo, TS, x));
    const hi = Array.from({ length: TS }, (_, x) => slopeColumnHeight(Tile.Slope22RHi, TS, x));
    expect(lo).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(hi).toEqual([5, 5, 6, 6, 7, 7, 8, 8]);
    // Heights are monotonic and span 1..ts across the pair (a clean ramp).
    expect([...lo, ...hi]).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  });

  it('left-rising 22.5° mirrors the right-rising pair', () => {
    const lo = Array.from({ length: TS }, (_, x) => slopeColumnHeight(Tile.Slope22LLo, TS, x));
    const hi = Array.from({ length: TS }, (_, x) => slopeColumnHeight(Tile.Slope22LHi, TS, x));
    expect(lo).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
    expect(hi).toEqual([8, 8, 7, 7, 6, 6, 5, 5]);
  });
});

describe('TileMap slope parsing & surface query', () => {
  it('parses slope chars and flags the map', () => {
    const { map } = TileMap.parse(['..../...', '....#...', '########'], TS);
    expect(map.at(4, 0)).toBe(Tile.Slope45R);
    expect(map.hasSlopes).toBe(true);
    expect(map.isSolid(4, 0)).toBe(false); // slopes are not solid
  });

  it('a slope-free map has hasSlopes === false (the additivity guard)', () => {
    const { map } = TileMap.parse(['#..#', '#==#', '####'], TS);
    expect(map.hasSlopes).toBe(false);
    expect(map.slopeSurfaceY(8)).toBe(null);
  });

  it('reports the ramp surface y at a world column', () => {
    // `/` at tile (4,2): tileBottomY = 24. height(localX)=localX+1.
    const { map } = TileMap.parse(['........', '........', '..../...', '....#...', '########'], TS);
    expect(map.slopeSurfaceY(32)).toBe(24 - 1); // localX 0 → height 1
    expect(map.slopeSurfaceY(36)).toBe(24 - 5); // localX 4 → height 5
    expect(map.slopeSurfaceY(39)).toBe(24 - 8); // localX 7 → height 8 = tileTopY(16)
  });
});

describe('moveAABB on slopes', () => {
  // `/` ramp tile at (4,2) with solid fill beneath it; floor at ty=4.
  const { map } = TileMap.parse(
    ['........', '........', '..../...', '....#...', '########'],
    TS,
  );

  it('lands an entity falling onto the ramp surface', () => {
    // 8×8 box centered over the ramp column (center x = 36 → localX 4 → surf 19).
    // Fall under gravity, as a real sim does, until it settles on the ramp.
    let y = 0;
    let vy = 0;
    let res = moveAABB(map, 32 * SUBPX, y, 8, 8, 0, vy);
    for (let i = 0; i < 30 && !res.grounded; i++) {
      vy = Math.min(vy + 32, 4 * SUBPX);
      res = moveAABB(map, 32 * SUBPX, y, 8, 8, 0, vy);
      y = res.y;
    }
    expect(res.grounded).toBe(true);
    expect(res.y).toBe((19 - 8) * SUBPX); // bottom rests on surf=19
  });

  it('climbs the ramp as it walks into it (45°: +2px right → -2px up)', () => {
    // Resting at center x=33 (localX 1 → surf 22 → y top = 14).
    const start = (22 - 8) * SUBPX;
    const res = moveAABB(map, 29 * SUBPX, start, 8, 8, 2 * SUBPX, 16);
    // Center advances to ~35 (localX 3 → surf 20 → top 12): risen two pixels.
    expect(res.grounded).toBe(true);
    expect(res.y).toBe((20 - 8) * SUBPX);
  });

  it('does not snap a box that is still airborne above the ramp', () => {
    // High above the ramp, descending slowly: stays in the air this tick.
    const res = moveAABB(map, 32 * SUBPX, 0, 8, 8, 0, 2 * SUBPX);
    expect(res.grounded).toBe(false);
    expect(res.y).toBe(2 * SUBPX); // free fall, untouched by the slope pass
  });

  it('ignores ramps for solidOnly movers (flyers/bubbles)', () => {
    const res = moveAABB(map, 32 * SUBPX, 0, 8, 8, 0, 8 * SUBPX, true);
    expect(res.grounded).toBe(false);
  });
});

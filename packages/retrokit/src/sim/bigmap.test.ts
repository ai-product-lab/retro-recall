/**
 * Levels larger than one screen. The tile grid was always dimension-agnostic;
 * these tests pin that down as a supported capability — a map many screens
 * wide parses, queries at far-from-origin tiles, reports its pixel bounds for
 * the camera, and round-trips through render culling.
 */
import { describe, expect, it } from 'vitest';
import { Camera, visibleTileRange } from '../camera/index';
import { Tile, TileMap } from './tilemap';

const TILE = 8;
const SCREEN_W = 256;

describe('big maps', () => {
  // 8 screens wide (256 tiles), 3 tiles tall: floor row, a marker far to the
  // right, walls implied by out-of-bounds = solid.
  const widthTiles = (SCREEN_W / TILE) * 8; // 256 tiles
  const floor = '#'.repeat(widthTiles);
  const mid = '.'.repeat(widthTiles - 10) + 'F' + '.'.repeat(9);
  const top = '.'.repeat(widthTiles);
  const { map, spawns } = TileMap.parse([top, mid, floor], TILE);

  it('parses a multi-screen-wide map', () => {
    expect(map.width).toBe(widthTiles);
    expect(map.pixelWidth).toBe(widthTiles * TILE); // 2048px = 8 screens
    expect(map.pixelHeight).toBe(3 * TILE);
  });

  it('queries tiles far from the origin', () => {
    expect(map.at(widthTiles - 1, 2)).toBe(Tile.Solid); // floor at the far end
    expect(map.at(widthTiles - 1, 0)).toBe(Tile.Empty);
  });

  it('reports spawn markers in far-right tiles with correct coords', () => {
    expect(spawns).toEqual([{ char: 'F', tx: widthTiles - 10, ty: 1 }]);
  });

  it('drives a camera across the whole world and culls to the visible window', () => {
    const cam = new Camera(SCREEN_W, 192);
    const world = { w: map.pixelWidth, h: map.pixelHeight };

    cam.follow(map.pixelWidth - 1, 0, world); // chase the far edge
    expect(cam.x).toBe(map.pixelWidth - SCREEN_W); // clamped to the last screen

    const r = visibleTileRange(cam, TILE, map.width, map.height);
    expect(r.tx1).toBe(map.width - 1); // last column visible
    expect(r.tx0).toBeGreaterThan(map.width - 1 - SCREEN_W / TILE - 2); // ~one screen of tiles
    // Culling never walks the whole 256-tile row — only the visible span.
    expect(r.tx1 - r.tx0).toBeLessThan(SCREEN_W / TILE + 2);
  });
});

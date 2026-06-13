import { Tile, type TileMap } from './tilemap';

/** Subpixels per pixel. All positions and velocities are integer subpixels. */
export const SUBPX = 256;

export interface MoveResult {
  x: number;
  y: number;
  /** Blocked by a tile while moving horizontally. */
  hitX: boolean;
  /** Blocked by a tile while moving vertically. */
  hitY: boolean;
  /** Landed on (or rests flush on) a supporting tile this move. */
  grounded: boolean;
}

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

/**
 * Move an AABB through the tile grid, X axis then Y axis, clamping at
 * collisions. Velocities must be < tileSize px/tick (true for every entity —
 * max speed in the games is 2 px/tick vs 8 px tiles), so single-edge checks
 * cannot tunnel.
 *
 * @param x,y    top-left of the hitbox in subpixels
 * @param w,h    hitbox size in whole pixels
 * @param vx,vy  velocity in subpixels/tick
 * @param solidOnly  ignore one-way platforms (flyers, rising bubbles)
 */
export function moveAABB(
  map: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  vx: number,
  vy: number,
  solidOnly = false,
): MoveResult {
  const ts = map.tileSize;
  let hitX = false;
  let hitY = false;
  let grounded = false;

  // --- X axis ---
  let nx = x + vx;
  if (vx !== 0) {
    const topPx = floorDiv(y, SUBPX);
    const ty0 = floorDiv(topPx, ts);
    const ty1 = floorDiv(topPx + h - 1, ts);
    if (vx > 0) {
      const edgePx = floorDiv(nx, SUBPX) + w - 1;
      const tx = floorDiv(edgePx, ts);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (map.isSolid(tx, ty)) {
          nx = (tx * ts - w) * SUBPX;
          hitX = true;
          break;
        }
      }
    } else {
      const edgePx = floorDiv(nx, SUBPX);
      const tx = floorDiv(edgePx, ts);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (map.isSolid(tx, ty)) {
          nx = (tx + 1) * ts * SUBPX;
          hitX = true;
          break;
        }
      }
    }
  }

  // --- Y axis ---
  let ny = y + vy;
  const leftPx = floorDiv(nx, SUBPX);
  const tx0 = floorDiv(leftPx, ts);
  const tx1 = floorDiv(leftPx + w - 1, ts);
  if (vy > 0) {
    // prevBottom is exclusive: first pixel row below the box before the move.
    const prevBottom = floorDiv(y, SUBPX) + h;
    const newBottomPx = floorDiv(ny, SUBPX) + h - 1;
    const ty = floorDiv(newBottomPx, ts);
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = map.at(tx, ty);
      const lands =
        t === Tile.Solid ||
        (!solidOnly && t === Tile.Platform && prevBottom <= ty * ts);
      if (lands) {
        ny = (ty * ts - h) * SUBPX;
        hitY = true;
        grounded = true;
        break;
      }
    }
  } else if (vy < 0) {
    const newTopPx = floorDiv(ny, SUBPX);
    const ty = floorDiv(newTopPx, ts);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (map.isSolid(tx, ty)) {
        ny = (ty + 1) * ts * SUBPX;
        hitY = true;
        break;
      }
    }
  }

  // --- Slopes ---
  // Only entered when the map actually contains slope tiles, so slope-free
  // maps (every pre-slope game) keep a byte-identical resolution path. Slope
  // tiles are non-solid to the AABB passes above; here we lift the box onto the
  // ramp surface sampled under its horizontal center. Flyers/bubbles
  // (solidOnly) skip ramps, as they skip one-way platforms.
  if (map.hasSlopes && vy >= 0 && !solidOnly) {
    const centerPx = floorDiv(nx, SUBPX) + (w >> 1);
    const surf = map.slopeSurfaceY(centerPx);
    if (surf !== null) {
      const bottomPx = floorDiv(ny, SUBPX) + h; // exclusive: first row below box
      if (bottomPx >= surf) {
        ny = (surf - h) * SUBPX;
        grounded = true;
        hitY = true;
      }
    }
  }

  if (!grounded && vy >= 0) {
    grounded = isSupported(map, nx, ny, w, h, solidOnly);
  }

  return { x: nx, y: ny, hitX, hitY, grounded };
}

/**
 * True when the box rests exactly flush on a solid tile (or platform, unless
 * solidOnly). Needed because a standing entity accumulates sub-pixel gravity
 * without actually moving a pixel — it is still grounded.
 */
export function isSupported(
  map: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  solidOnly = false,
): boolean {
  const ts = map.tileSize;
  const bottom = floorDiv(y, SUBPX) + h; // exclusive — pixel row below the box
  if (bottom % ts !== 0) return false; // not flush with a tile top
  const ty = floorDiv(bottom, ts);
  const leftPx = floorDiv(x, SUBPX);
  const tx0 = floorDiv(leftPx, ts);
  const tx1 = floorDiv(leftPx + w - 1, ts);
  for (let tx = tx0; tx <= tx1; tx++) {
    const t = map.at(tx, ty);
    if (t === Tile.Solid || (!solidOnly && t === Tile.Platform)) return true;
  }
  return false;
}

/** AABB overlap test. Positions in subpixels, sizes in pixels. */
export function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  const a0x = floorDiv(ax, SUBPX);
  const a0y = floorDiv(ay, SUBPX);
  const b0x = floorDiv(bx, SUBPX);
  const b0y = floorDiv(by, SUBPX);
  return a0x < b0x + bw && b0x < a0x + aw && a0y < b0y + bh && b0y < a0y + ah;
}

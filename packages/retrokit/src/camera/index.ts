/**
 * Camera — view-layer scrolling for levels larger than one screen.
 *
 * Deliberately NOT part of the sim core. A camera is a *per-client viewpoint*:
 * in a race every client follows its own rider, so the camera must never feed
 * the deterministic simulation (different clients would diverge). It is pure
 * integer math with no DOM, so the renderer and the sim-owned scroll logic can
 * both use it, but it carries no authoritative state — anything gameplay
 * depends on (e.g. spawn-region triggers) reads a sim-owned progress scalar,
 * not a Camera.
 *
 * Positions are whole logical pixels (the unit RetroKit renders in), so the
 * viewport snaps to the pixel grid and art stays crisp.
 */

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** World extent the camera may roam over, in whole pixels. */
export interface CameraWorld {
  /** Total level width in pixels (e.g. map.width * tileSize). */
  w: number;
  /** Total level height in pixels. */
  h: number;
}

/**
 * Per-axis scroll rule.
 * - `free`    — follows the target both directions, clamped to world bounds.
 * - `forward` — lock-and-advance: the axis may only ever increase, never
 *   scroll back (classic run-and-gun / racing forward lock). Still clamped to
 *   world bounds, so it stops at the level's end.
 */
export type CameraLock = 'free' | 'forward';

export interface FollowOptions {
  /** Horizontal slack, in px: the target drifts this wide a band before the
   *  camera moves. 0 = hard-center. */
  deadzoneW?: number;
  /** Vertical slack, in px. */
  deadzoneH?: number;
  lockX?: CameraLock;
  lockY?: CameraLock;
}

/**
 * A scrolling viewport over a world. The camera's (x, y) is the top-left of
 * the visible window in world pixels; render by translating world coords by
 * `-camera.x, -camera.y`.
 */
export class Camera {
  /** Left edge of the view in world pixels. */
  x = 0;
  /** Top edge of the view in world pixels. */
  y = 0;

  readonly viewW: number;
  readonly viewH: number;

  constructor(viewW: number, viewH: number) {
    // The camera promises whole-pixel positions; a fractional view would make
    // the `>> 1` centering silently truncate and skew by a sub-pixel. Floor at
    // the boundary so every downstream calc stays integer.
    this.viewW = Math.floor(viewW);
    this.viewH = Math.floor(viewH);
  }

  /** The maximum top-left x for this world (0 when the world fits the view). */
  private maxX(world: CameraWorld): number {
    return Math.max(0, world.w - this.viewW);
  }

  private maxY(world: CameraWorld): number {
    return Math.max(0, world.h - this.viewH);
  }

  /**
   * Scroll so the target point stays inside the deadzone band, clamped to the
   * world and honoring per-axis locks. `tx, ty` are a world-pixel point to
   * keep in view — usually the followed entity's center.
   */
  follow(tx: number, ty: number, world: CameraWorld, opts: FollowOptions = {}): void {
    const { deadzoneW = 0, deadzoneH = 0, lockX = 'free', lockY = 'free' } = opts;
    this.x = this.solveAxis(this.x, tx, this.viewW, deadzoneW, this.maxX(world), lockX);
    this.y = this.solveAxis(this.y, ty, this.viewH, deadzoneH, this.maxY(world), lockY);
  }

  /**
   * One axis of follow. Keeps `t` within a centered deadzone of the current
   * view, then clamps to [0, max], then applies a forward lock if asked.
   */
  private solveAxis(
    cur: number,
    t: number,
    view: number,
    deadzone: number,
    max: number,
    lock: CameraLock,
  ): number {
    const dz = clamp(deadzone, 0, view);
    const nearEdge = (view - dz) >> 1; // px from view edge to the deadzone edge
    const near = cur + nearEdge; // left/top deadzone boundary
    const far = cur + view - nearEdge; // right/bottom deadzone boundary
    let next = cur;
    if (t < near) next = t - nearEdge;
    else if (t > far) next = t - (view - nearEdge);
    next = clamp(next, 0, max);
    if (lock === 'forward') next = Math.max(next, cur);
    return next;
  }

  /**
   * Hard-pin the left/top edge to a world-x (boss-arena lock). Clamps into the
   * world; pass the start-of-arena x to freeze scrolling there.
   */
  pinX(worldX: number, world: CameraWorld): void {
    this.x = clamp(worldX, 0, this.maxX(world));
  }

  pinY(worldY: number, world: CameraWorld): void {
    this.y = clamp(worldY, 0, this.maxY(world));
  }

  /** Snap instantly to center the target (e.g. on level load), clamped. */
  centerOn(tx: number, ty: number, world: CameraWorld): void {
    this.x = clamp(tx - (this.viewW >> 1), 0, this.maxX(world));
    this.y = clamp(ty - (this.viewH >> 1), 0, this.maxY(world));
  }
}

/** World point → screen point for the given camera (both in whole pixels). */
export function worldToScreen(cam: Camera, wx: number, wy: number): { sx: number; sy: number } {
  return { sx: wx - cam.x, sy: wy - cam.y };
}

/**
 * Inclusive tile-index window visible through the camera, for render culling
 * on big maps. `tileSize` is the map's tile size in px. One tile of bleed is
 * included on each edge so partially-scrolled tiles still draw.
 */
export function visibleTileRange(
  cam: Camera,
  tileSize: number,
  mapW: number,
  mapH: number,
): { tx0: number; ty0: number; tx1: number; ty1: number } {
  const tx0 = clamp(Math.floor(cam.x / tileSize), 0, mapW - 1);
  const ty0 = clamp(Math.floor(cam.y / tileSize), 0, mapH - 1);
  const tx1 = clamp(Math.floor((cam.x + cam.viewW - 1) / tileSize), 0, mapW - 1);
  const ty1 = clamp(Math.floor((cam.y + cam.viewH - 1) / tileSize), 0, mapH - 1);
  return { tx0, ty0, tx1, ty1 };
}

import { describe, expect, it } from 'vitest';
import { Camera, visibleTileRange, worldToScreen } from './index';

// A 256×192 view over worlds of various sizes.
const VIEW_W = 256;
const VIEW_H = 192;

describe('camera follow — horizontal', () => {
  const world = { w: 256 * 8, h: 192 }; // 8 screens wide, one tall

  it('centers the target when there is room', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.follow(1000, 96, world);
    expect(cam.x).toBe(1000 - VIEW_W / 2);
    expect(cam.y).toBe(0); // world is exactly one screen tall → no vertical room
  });

  it('clamps at the left edge (never shows < 0)', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.follow(10, 96, world);
    expect(cam.x).toBe(0);
  });

  it('clamps at the right edge (never shows past the world)', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.follow(world.w - 5, 96, world);
    expect(cam.x).toBe(world.w - VIEW_W);
  });

  it('does not move while the target stays inside the deadzone', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.centerOn(1000, 96, world);
    const x0 = cam.x;
    // Drift within half the deadzone width of center: no scroll.
    cam.follow(1000 + 20, 96, world, { deadzoneW: 80 });
    expect(cam.x).toBe(x0);
  });

  it('moves once the target leaves the deadzone, keeping it on the band edge', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.centerOn(1000, 96, world);
    cam.follow(1000 + 100, 96, world, { deadzoneW: 80 });
    // Target now sits exactly on the right deadzone boundary.
    const far = cam.x + VIEW_W - ((VIEW_W - 80) >> 1);
    expect(far).toBe(1000 + 100);
  });
});

describe('camera follow — vertical (Puck Pals: ~1.5 screens tall)', () => {
  const world = { w: 256, h: 288 }; // 1.5 screens tall, one wide

  it('scrolls vertically and clamps top/bottom', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.follow(128, 0, world);
    expect(cam.y).toBe(0);
    cam.follow(128, 288, world);
    expect(cam.y).toBe(288 - VIEW_H);
    expect(cam.x).toBe(0); // one screen wide → no horizontal room
  });
});

describe('camera forward lock (lock-and-advance)', () => {
  const world = { w: 256 * 8, h: 192 };

  it('never scrolls backward once advanced', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.follow(1000, 96, world, { lockX: 'forward' });
    const advanced = cam.x;
    expect(advanced).toBeGreaterThan(0);
    // Target retreats — camera holds its ground.
    cam.follow(300, 96, world, { lockX: 'forward' });
    expect(cam.x).toBe(advanced);
    // Target pushes further forward (still short of the world end) — advances.
    cam.follow(1500, 96, world, { lockX: 'forward' });
    expect(cam.x).toBeGreaterThan(advanced);
  });

  it('still clamps to the world end under a forward lock', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.follow(1e9, 96, world, { lockX: 'forward' });
    expect(cam.x).toBe(world.w - VIEW_W);
  });
});

describe('camera pin (boss arena)', () => {
  const world = { w: 256 * 8, h: 192 };

  it('freezes the view at a world-x, clamped to bounds', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.pinX(1024, world);
    expect(cam.x).toBe(1024);
    cam.pinX(1e9, world);
    expect(cam.x).toBe(world.w - VIEW_W);
  });
});

describe('camera view dimensions stay integer', () => {
  it('floors fractional view sizes so whole-pixel positions hold', () => {
    const cam = new Camera(255.7, 191.2);
    expect(cam.viewW).toBe(255);
    expect(cam.viewH).toBe(191);
  });

  it('centerOn yields integer positions for odd view widths', () => {
    const cam = new Camera(255, 191);
    cam.centerOn(1000, 96, { w: 256 * 8, h: 192 });
    expect(Number.isInteger(cam.x)).toBe(true);
    expect(Number.isInteger(cam.y)).toBe(true);
  });
});

describe('worldToScreen', () => {
  it('translates by the camera offset', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.x = 100;
    cam.y = 40;
    expect(worldToScreen(cam, 150, 60)).toEqual({ sx: 50, sy: 20 });
  });
});

describe('visibleTileRange (render culling on big maps)', () => {
  it('returns the inclusive tile window with one tile of bleed, clamped', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    cam.x = 800; // tileSize 8 → tile 100
    cam.y = 0;
    const r = visibleTileRange(cam, 8, 8 * 256, 24);
    expect(r.tx0).toBe(100);
    expect(r.tx1).toBe(Math.floor((800 + VIEW_W - 1) / 8));
    expect(r.ty0).toBe(0);
    expect(r.ty1).toBe(23); // clamped to mapH-1
  });

  it('never returns negative indices at the world origin', () => {
    const cam = new Camera(VIEW_W, VIEW_H);
    const r = visibleTileRange(cam, 8, 100, 100);
    expect(r.tx0).toBe(0);
    expect(r.ty0).toBe(0);
  });
});

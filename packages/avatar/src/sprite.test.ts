import { describe, expect, it } from 'vitest';
import { HEAD_SIZE, type AvatarHead } from './types.js';
import {
  HEAD_ANCHOR,
  HEAD_SLOT,
  POSES,
  SPRITE_SIZE,
  composeSheet,
  fitHead,
  sheetToRgba,
} from './sprite.js';
import { FRAMES } from './rigs.js';

/** A 24×24 head filled with one opaque palette index. */
const solidHead = (index: number): AvatarHead => ({
  size: HEAD_SIZE,
  indices: new Uint8Array(HEAD_SIZE * HEAD_SIZE).fill(index),
});

describe('rig manifest', () => {
  it('poses cover every frame exactly once, contiguously', () => {
    const ordered = Object.values(POSES).sort((a, b) => a.start - b.start);
    let next = 0;
    for (const pose of ordered) {
      expect(pose.start).toBe(next);
      next += pose.count;
    }
    expect(next).toBe(FRAMES.length);
  });

  it('every frame is tagged with a real pose', () => {
    for (const frame of FRAMES) expect(POSES[frame.pose]).toBeDefined();
    // ...and each frame's index falls inside its pose's range.
    FRAMES.forEach((frame, i) => {
      const pose = POSES[frame.pose];
      expect(i).toBeGreaterThanOrEqual(pose.start);
      expect(i).toBeLessThan(pose.start + pose.count);
    });
  });
});

describe('fitHead', () => {
  it('downscales the stored head to the head slot, palette-pure', () => {
    const fitted = fitHead(solidHead(10));
    expect(fitted.size).toBe(HEAD_SLOT);
    // A uniform head stays uniform (no new colors invented on downscale).
    expect([...fitted.indices].every((i) => i === 10)).toBe(true);
  });

  it('is a no-op when the head is already slot-sized', () => {
    const already: AvatarHead = { size: HEAD_SLOT, indices: new Uint8Array(HEAD_SLOT * HEAD_SLOT).fill(7) };
    expect(fitHead(already)).toBe(already);
  });
});

describe('composeSheet', () => {
  it('lays out one cell per frame in a horizontal strip', () => {
    const sheet = composeSheet(solidHead(10));
    expect(sheet.frameSize).toBe(SPRITE_SIZE);
    expect(sheet.frameCount).toBe(FRAMES.length);
    expect(sheet.width).toBe(SPRITE_SIZE * FRAMES.length);
    expect(sheet.height).toBe(SPRITE_SIZE);
    expect(sheet.indices.length).toBe(sheet.width * sheet.height);
  });

  it('is byte-deterministic (same head → identical sheet)', () => {
    const a = composeSheet(solidHead(10));
    const b = composeSheet(solidHead(10));
    expect([...a.indices]).toEqual([...b.indices]);
  });

  it('places the head over the body at the anchor in every frame', () => {
    const sheet = composeSheet(solidHead(10));
    // The head-anchor pixel of each frame must carry the head color, never the
    // transparent cell background — proves the head landed in all 12 frames.
    FRAMES.forEach((frame, f) => {
      const ox = f * SPRITE_SIZE;
      const x = ox + HEAD_ANCHOR.x + frame.headDx + Math.floor(HEAD_SLOT / 2);
      const y = HEAD_ANCHOR.y + frame.headDy + Math.floor(HEAD_SLOT / 2);
      expect(sheet.indices[y * sheet.width + x]).toBe(10);
    });
  });

  it('leaves the cell corners transparent (sprite is not a full rectangle)', () => {
    const sheet = composeSheet(solidHead(10));
    expect(sheet.indices[0]).toBe(0); // top-left of frame 0
    expect(sheet.indices[(SPRITE_SIZE - 1) * sheet.width]).toBe(0); // bottom-left
  });
});

describe('sheetToRgba', () => {
  it('expands to RGBA with transparent index 0 and opaque colors', () => {
    const sheet = composeSheet(solidHead(10));
    const rgba = sheetToRgba(sheet);
    expect(rgba.width).toBe(sheet.width);
    expect(rgba.height).toBe(sheet.height);
    expect(rgba.data.length).toBe(sheet.width * sheet.height * 4);
    // Corner is transparent…
    expect(rgba.data[3]).toBe(0);
    // …and at least one pixel is fully opaque (the head).
    let sawOpaque = false;
    for (let i = 3; i < rgba.data.length; i += 4) if (rgba.data[i] === 255) sawOpaque = true;
    expect(sawOpaque).toBe(true);
  });
});

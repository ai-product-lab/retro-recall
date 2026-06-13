/**
 * Avatar compositor (ADR-004 step 2): turn one generated head into a full
 * animated sprite sheet by laying the head over the hand-authored body rigs
 * (`rigs.ts`), frame by frame.
 *
 * Pure functions over palette indices — no DOM, no canvas. This runs in the
 * browser at join time (the worker only ever produces a head), but keeping it
 * DOM-free means the same code is unit-testable in Node and byte-deterministic:
 * the same head always yields the same sheet, so two players who upload the
 * same photo share pixels and a cache key.
 *
 * Output is a palette-indexed strip; `sheetToRgba` expands it to RGBA for the
 * renderer to turn into an ImageBitmap. Nothing here knows the slot tint or the
 * game state — identity lives entirely in the head.
 */

import { PALETTE_P1 } from './palette.js';
import { headToRgba, quantizeToHead } from './quantize.js';
import { FRAMES, HEAD_ANCHOR, HEAD_SLOT, POSES, SPRITE_SIZE, type PoseName } from './rigs.js';
import type { AvatarHead, RgbaImage } from './types.js';

export { FRAMES, HEAD_ANCHOR, HEAD_SLOT, POSES, SPRITE_SIZE };
export type { Pose, PoseName, Frame } from './rigs.js';

/** A composed, palette-indexed sprite sheet: every frame in one horizontal
 *  strip. `indices[y * width + x]` is a PALETTE_P1 index (0 = transparent). */
export interface SpriteSheet {
  /** SPRITE_SIZE × frameCount. */
  readonly width: number;
  /** SPRITE_SIZE. */
  readonly height: number;
  /** Edge length of one frame cell. */
  readonly frameSize: number;
  /** Number of frames in the strip. */
  readonly frameCount: number;
  /** Pose name → frame range/playback (mirrors rigs POSES). */
  readonly poses: Readonly<Record<PoseName, (typeof POSES)[PoseName]>>;
  /** width × height palette indices, row-major. */
  readonly indices: Uint8Array;
}

/**
 * Fit the stored 24×24 head into the HEAD_SLOT box. Reuses the same
 * downscale+quantize the worker runs (just to a smaller size), so the head
 * stays strictly within PALETTE_P1 — no new colors leak in at composite time.
 */
export function fitHead(head: AvatarHead): AvatarHead {
  if (head.size === HEAD_SLOT) return head;
  return quantizeToHead(headToRgba(head), HEAD_SLOT);
}

/** Composite `head` onto every body rig and lay the frames out in a strip. */
export function composeSheet(head: AvatarHead): SpriteSheet {
  const fitted = fitHead(head);
  const frameCount = FRAMES.length;
  const width = SPRITE_SIZE * frameCount;
  const indices = new Uint8Array(width * SPRITE_SIZE);

  FRAMES.forEach((frame, f) => {
    const ox = f * SPRITE_SIZE;
    // Body first…
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        indices[y * width + ox + x] = frame.body[y * SPRITE_SIZE + x]!;
      }
    }
    // …then the head over it, at the per-frame anchor (opaque head pixels win).
    const hx = HEAD_ANCHOR.x + frame.headDx;
    const hy = HEAD_ANCHOR.y + frame.headDy;
    for (let y = 0; y < fitted.size; y++) {
      const dy = hy + y;
      if (dy < 0 || dy >= SPRITE_SIZE) continue;
      for (let x = 0; x < fitted.size; x++) {
        const dx = hx + x;
        if (dx < 0 || dx >= SPRITE_SIZE) continue;
        const idx = fitted.indices[y * fitted.size + x]!;
        if (idx !== 0) indices[dy * width + ox + dx] = idx;
      }
    }
  });

  return { width, height: SPRITE_SIZE, frameSize: SPRITE_SIZE, frameCount, poses: POSES, indices };
}

/** Expand any palette-indexed grid to RGBA (renderer → ImageBitmap, or PNG). */
export function indicesToRgba(indices: Uint8Array, width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < indices.length; i++) {
    const c = PALETTE_P1[indices[i]!]!;
    const d = i * 4;
    data[d] = c.r;
    data[d + 1] = c.g;
    data[d + 2] = c.b;
    data[d + 3] = c.a;
  }
  return { width, height, data };
}

/** The composed sheet as RGBA, ready for `createImageBitmap`/PNG encoding. */
export const sheetToRgba = (sheet: SpriteSheet): RgbaImage =>
  indicesToRgba(sheet.indices, sheet.width, sheet.height);

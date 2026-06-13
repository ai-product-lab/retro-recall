/**
 * Fallback gallery (ADR-004 step 3): 8 original, house-style creature heads,
 * shown when a player declines AI, or generation fails / is rate-limited.
 * Picking one is instant and never blocks play (Principle 2: outage degrades).
 *
 * These are AvatarHeads in the exact format the worker produces, so they flow
 * through the same compositor (`composeSheet`) and renderer as generated heads —
 * a fallback player animates identically to everyone else.
 *
 * Original designs only (ADR-005): generic rounded "blob creatures" distinguished
 * by color + one feature (ears, antenna, horn…). They reference no existing
 * character. The art is generated from first principles below, not hand-pixeled,
 * so the step-5 art pass can refine the generator in one place.
 */

import { HEAD_SIZE, type AvatarHead } from './types.js';

/** Stable id scheme: `gallery:0` … `gallery:7`. The client resolves these
 *  locally (no network); the room just stores the string like any avatarId. */
export const GALLERY_PREFIX = 'gallery:';
export const GALLERY_SIZE = 8;

export const galleryId = (i: number): string => `${GALLERY_PREFIX}${i}`;
export const isGalleryId = (id: string): boolean =>
  id.startsWith(GALLERY_PREFIX) && /^\d+$/.test(id.slice(GALLERY_PREFIX.length));
export const galleryIndex = (id: string): number => Number(id.slice(GALLERY_PREFIX.length));

// --- tiny pixel-art DSL over a 24×24 index grid ------------------------------

const S = HEAD_SIZE; // 24
const idx = (g: Uint8Array, x: number, y: number): number =>
  x >= 0 && x < S && y >= 0 && y < S ? g[y * S + x]! : 0;
const set = (g: Uint8Array, x: number, y: number, c: number): void => {
  if (x >= 0 && x < S && y >= 0 && y < S) g[y * S + x] = c;
};

/** Fill a filled disc (cx,cy,r) with `c`. Slightly squashed for a rounder, more
 *  forehead-y head shape. */
function disc(g: Uint8Array, cx: number, cy: number, rx: number, ry: number, c: number): void {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(g, x, y, c);
    }
  }
}

/** Stamp a 1px outline (index 1) around every opaque pixel that touches
 *  transparency — turns any silhouette into a clean outlined sprite. */
function outline(g: Uint8Array): void {
  const edges: number[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (idx(g, x, y) !== 0) continue;
      if (idx(g, x - 1, y) > 1 || idx(g, x + 1, y) > 1 || idx(g, x, y - 1) > 1 || idx(g, x, y + 1) > 1) {
        edges.push(y * S + x);
      }
    }
  }
  for (const p of edges) g[p] = 1;
}

interface CreatureSpec {
  body: number;
  shade: number;
  /** A top feature for silhouette variety. */
  feature: 'none' | 'ears' | 'antenna' | 'horn' | 'tuft' | 'fin';
  /** Coral cheek blush dots. */
  cheeks?: boolean;
  /** Eye color (default cyan-light). */
  eye?: number;
}

/** Draw one creature head into a fresh 24×24 indexed grid. */
function creature(spec: CreatureSpec): AvatarHead {
  const g = new Uint8Array(S * S);
  const cx = 11.5;
  const cy = 13;

  // Top feature drawn first (behind the head), in body color so the outline
  // pass wraps head + feature as one silhouette.
  if (spec.feature === 'ears') {
    disc(g, 5, 5, 3, 4, spec.body);
    disc(g, 18, 5, 3, 4, spec.body);
  } else if (spec.feature === 'horn') {
    for (let y = 0; y < 6; y++) for (let x = 11; x <= 12; x++) set(g, x, y, spec.body);
  } else if (spec.feature === 'tuft') {
    disc(g, 11.5, 4, 4, 3, spec.body);
  } else if (spec.feature === 'fin') {
    for (let y = 1; y < 6; y++) {
      set(g, 11, y, spec.body);
      set(g, 12, y, spec.body);
    }
    set(g, 10, 4, spec.body);
    set(g, 13, 4, spec.body);
  }

  // Head.
  disc(g, cx, cy, 10.5, 10, spec.body);
  // Belly shade: lower third in the shade tone.
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (idx(g, x, y) === spec.body && y > cy + 4) set(g, x, y, spec.shade);
  }

  // Antenna sits on top of the finished head (stalk + glowing tip).
  if (spec.feature === 'antenna') {
    for (let y = 1; y < 5; y++) set(g, 12, y, 1);
    disc(g, 12, 1, 2, 2, spec.eye ?? 13);
  }

  // Eyes: white-ish sclera + dark pupil, looking forward.
  const eye = spec.eye ?? 8;
  for (const ex of [8, 15]) {
    disc(g, ex, 12, 2.4, 2.8, 15);
    disc(g, ex, 12, 1.2, 1.6, eye);
    set(g, ex, 12, 1);
    set(g, ex, 11, 15); // glint
  }

  // Mouth: a small dark smile.
  for (const mx of [10, 11, 12, 13]) set(g, mx, 17, 1);
  set(g, 9, 16, 1);
  set(g, 14, 16, 1);

  // Cheeks.
  if (spec.cheeks) {
    disc(g, 6, 15, 1.6, 1.4, 10);
    disc(g, 17, 15, 1.6, 1.4, 10);
  }

  outline(g);
  return { size: S, indices: g };
}

/** The 8 fallback creatures. Order is the id order and the gallery UI order. */
export const GALLERY: readonly AvatarHead[] = [
  creature({ body: 4, shade: 3, feature: 'ears', cheeks: true }), //  0 mint kit
  creature({ body: 7, shade: 6, feature: 'fin', eye: 1 }), //          1 cyan finling
  creature({ body: 10, shade: 9, feature: 'horn', cheeks: true }), //  2 coral horned
  creature({ body: 13, shade: 12, feature: 'antenna' }), //            3 star bug
  creature({ body: 5, shade: 4, feature: 'tuft', cheeks: true }), //   4 pale puff
  creature({ body: 11, shade: 9, feature: 'ears' }), //                5 peach bun
  creature({ body: 8, shade: 7, feature: 'antenna', eye: 1 }), //      6 sky sprite
  creature({ body: 14, shade: 2, feature: 'horn', eye: 7 }), //        7 stone golem
] as const;

/** Resolve a `gallery:N` id to its head, or null if it isn't a valid id. */
export function galleryHead(id: string): AvatarHead | null {
  if (!isGalleryId(id)) return null;
  return GALLERY[galleryIndex(id)] ?? null;
}

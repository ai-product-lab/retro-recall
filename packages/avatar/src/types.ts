/** Shared avatar types. The pipeline (worker) produces a head; the compositor
 *  (client, Phase 3 step 2) turns a head into a full animated sheet. */

import type { Rgba } from './palette.js';

/** Head sprite edge length in logical pixels. Small on purpose: a readable
 *  silhouette at game scale, and a cheap, reliable target for the image model
 *  (ADR-004 — ask for one good head, not a whole sheet). */
export const HEAD_SIZE = 24;

/** A palette-indexed head. `indices[y * size + x]` is an index into PALETTE_P1
 *  (0 = transparent). This is the unit the worker stores and the compositor
 *  consumes — never raw RGBA, so the palette contract can't drift. */
export interface AvatarHead {
  readonly size: number;
  readonly indices: Uint8Array;
}

/** Raw 8-bit RGBA image, width*height*4 bytes, row-major. The lingua franca
 *  between the PNG codec, sharp (in the harness), and quantize. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Source of a player's avatar, for telemetry/debug and the devlog — never a
 *  reason to block play (Principle: outage degrades, never blocks). */
export type AvatarSource = 'generated' | 'fallback';

/** What the worker returns to the client after a successful request. The photo
 *  is never part of this — it is dropped the moment generation finishes. */
export interface AvatarResult {
  /** Content-hash id; also the R2 key and the protocol `avatarId`. */
  readonly avatarId: string;
  readonly source: AvatarSource;
}

/** Reasons a generation can fall back to the gallery, surfaced to the client so
 *  the UI can explain (kindly) what happened. */
export type FallbackReason =
  | 'declined' //  parent/player chose a pre-made creature
  | 'rate_limited' //  per-room or per-IP cap hit
  | 'moderation' //  input or output failed the safety pass
  | 'api_error' //  model unavailable / key missing / timeout
  | 'bad_input'; //  not a decodable image, too large, etc.

export const decodeColor = (c: Rgba): number => (c.r << 16) | (c.g << 8) | c.b;

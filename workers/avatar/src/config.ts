/** Tunables for the Avatar Worker. Kept together and boring on purpose — these
 *  are the knobs Kevin will reach for (ADR-004 "rate limit per room/IP"). */

/** Rate limits. Generation is the only per-unit cost in the whole product
 *  (Principle 6), so these are deliberately low and easy to raise. */
export const RATE_LIMITS = {
  perRoomPerDay: 10,
  perIpPerDay: 30,
} as const;

/** Reject obviously-too-large uploads early. The client downscales to ≤512px
 *  before sending (ADR-004); a generous ceiling catches abuse without fighting
 *  legitimate phone photos. */
export const MAX_PHOTO_BYTES = 1_500_000;

/** Gemini models (ADR-004: Gemini image editing primary). Configurable so a
 *  model rename doesn't need a code change beyond this line. */
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

/** Generations are cached forever in R2 keyed by content hash, so the served
 *  PNG is immutable. */
export const SPRITE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

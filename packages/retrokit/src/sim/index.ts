/**
 * RetroKit deterministic simulation core.
 *
 * Everything under src/sim/ must be pure and headless: no DOM, no network,
 * no wall-clock time, no Math.random (lint-enforced — see eslint.config.js).
 * The real core (fixed 60Hz loop, tile physics, seeded RNG, state hashing)
 * lands in Phase 1 step 3.
 */
export const RETROKIT_VERSION = '0.0.1';

/** Fixed simulation rate for every RetroKit game. */
export const TICKS_PER_SECOND = 60;

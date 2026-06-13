/**
 * RetroKit deterministic simulation core.
 *
 * Everything under src/sim/ must be pure and headless: no DOM, no network,
 * no wall-clock time, no Math.random (lint-enforced — see eslint.config.js).
 */
export const RETROKIT_VERSION = '0.1.0';

/** Fixed simulation rate for every RetroKit game. */
export const TICKS_PER_SECOND = 60;

export * from './types';
export * from './rng';
export * from './hash';
export * from './tilemap';
export * from './physics';
export * from './spawn';

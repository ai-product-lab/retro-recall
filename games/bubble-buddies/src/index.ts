/**
 * Bubble Buddies — public module surface (sim only; the browser entry point
 * is src/main.ts via Vite).
 */
export const GAME_ID = 'bubble-buddies';
export * from './sim/sim';
export * as constants from './sim/constants';
export { LEVELS } from './sim/levels';

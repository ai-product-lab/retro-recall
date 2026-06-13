/**
 * Server-side game registry: game id → room sim factory.
 *
 * A room is one Durable Object hosting one game's deterministic sim. This map
 * is how a room knows which sim to run. Per ADR-009, a new game worktree's only
 * touch to the rooms worker is appending one entry here (additive — it never
 * edits room logic). The `pnpm new-game` scaffolder inserts the entry at the
 * marker below.
 */
import type { NetSim } from '@retro-recall/netcode';
import { BubbleBuddiesSim } from '@retro-recall/bubble-buddies';
import { SplashSquadSim } from '@retro-recall/splash-squad';
import { RampRidersSim } from '@retro-recall/ramp-riders';

/** Build a fresh room sim for a seed. Player slots fill via joinPlayer(). */
export type SimFactory = (seed: number) => NetSim;

export const GAME_SIMS: Record<string, SimFactory> = {
  'bubble-buddies': (seed) => new BubbleBuddiesSim(seed, 0, 0),
  'splash-squad': (seed) => new SplashSquadSim(seed),
  'ramp-riders': (seed) => new RampRidersSim(seed),
  // <scaffold:games> — `pnpm new-game` inserts new game entries above this line.
};

/** The game a room runs when none was recorded (keeps pre-registry rooms valid). */
export const DEFAULT_GAME = 'bubble-buddies';

/** True for a registered game id. */
export function isKnownGame(game: string): boolean {
  return Object.prototype.hasOwnProperty.call(GAME_SIMS, game);
}

/** Sim factory for a game id, falling back to the default game. */
export function simFactory(game: string | undefined): SimFactory {
  return (game !== undefined && GAME_SIMS[game]) || GAME_SIMS[DEFAULT_GAME]!;
}

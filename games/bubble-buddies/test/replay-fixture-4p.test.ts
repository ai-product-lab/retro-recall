/**
 * 4-player replay regression fixture (the multiplayer determinism gate),
 * alongside the Phase 1 solo fixture. Records all four input streams per
 * spec §11: `null` entries mean "no input received" and drive the
 * disconnect-grace despawn; the events list replays a netcode-driven rejoin.
 *
 * Regenerate intentionally with REGEN_FIXTURES=1 pnpm test.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button, type SlotInputs } from '@retro-recall/retrokit/sim';
import { BubbleBuddiesSim } from '../src/sim/sim';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/replay-002-4p.json', import.meta.url));
const SEED = 0x4bdd1e5;
const PLAYERS = 4;
const HASH_EVERY = 600;

const { Left: L, Right: R, A, B, Start } = Button;
const n = null;

// ~80 seconds of 4-player co-op: all four roaming and blowing bubbles,
// slot 3 going silent long enough to despawn (grace is 300 ticks), then
// rejoining via the netcode hook, then more play.
const LOG: [SlotInputs, number][] = [
  [[0, 0, 0, 0], 30],
  [[R, L, R | A, L | A], 60],
  [[R | A, L, B, R], 30],
  [[B, B, R, R], 2],
  [[0, L | B, 0, A], 2],
  [[0, 0, 0, 0], 120],
  [[L, R, L | A, B], 90],
  [[L | A, R | B, 0, R], 30],
  [[B, 0, R, R], 2],
  [[0, 0, B, 0], 60],
  // Slot 3 disconnects here (no inputs → despawn after 300 ticks).
  [[R, L, 0, n], 300],
  [[R | A, L | A, B, n], 30],
  [[0, R, 0, n], 144],
  // Rejoin event fires at tick 900 (see EVENTS).
  [[B, 0, L, 0], 2],
  [[L, R, L, R], 200],
  [[L | A, R | A, B, B], 30],
  [[0, 0, 0, 0], 400],
  [[R | B, L | B, R | A, L | A], 2],
  [[R, L, R, L], 300],
  [[Start, 0, 0, 0], 2],
  [[0, 0, 0, 0], 598],
  [[L, R | A, A, B], 120],
  [[B, B, B, B], 2],
  [[0, 0, 0, 0], 476],
  [[L | B, R | B, 0, A], 2],
  [[0, 0, 0, 0], 598],
  [[R, R | A, L, L | A], 90],
  [[B, B, B, B], 2],
  [[0, 0, 0, 0], 1076],
];

/** Netcode-driven sim calls, applied just before ticking `atTick`. */
const EVENTS: { atTick: number; slot: number; action: 'rejoin' }[] = [
  { atTick: 900, slot: 3, action: 'rejoin' },
];

interface Fixture {
  seed: number;
  players: number;
  hashEvery: number;
  log: [SlotInputs, number][];
  events: typeof EVENTS;
  hashes: number[];
  finalSerializedLength: number;
}

const runAndSample = (): {
  sim: BubbleBuddiesSim;
  hashes: number[];
  finalSerializedLength: number;
} => {
  const sim = new BubbleBuddiesSim(SEED, 0, PLAYERS);
  const hashes: number[] = [];
  let t = 0;
  let nextEvent = 0;
  for (const [inputs, count] of LOG) {
    for (let i = 0; i < count; i++) {
      while (nextEvent < EVENTS.length && EVENTS[nextEvent]!.atTick === t) {
        sim.rejoinPlayer(EVENTS[nextEvent]!.slot);
        nextEvent++;
      }
      sim.tick(inputs);
      t++;
      if (t % HASH_EVERY === 0) hashes.push(sim.hash());
    }
  }
  hashes.push(sim.hash());
  return { sim, hashes, finalSerializedLength: sim.serialize().length };
};

describe('replay fixture (4-player)', () => {
  it('replaying the recorded 4-player log reproduces the recorded state hashes', () => {
    const { sim, ...actual } = runAndSample();

    // The scenario must actually exercise §11: slot 3 despawned and rejoined.
    expect(sim.state.players.every((p) => p !== null)).toBe(true);
    expect(sim.state.players[3]!.phase).not.toBe('despawned');
    expect(sim.state.reviveRules).toBe(true);

    if (!existsSync(FIXTURE_PATH) || process.env['REGEN_FIXTURES'] === '1') {
      const fixture: Fixture = {
        seed: SEED, players: PLAYERS, hashEvery: HASH_EVERY, log: LOG, events: EVENTS, ...actual,
      };
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
      console.warn(`[replay-fixture-4p] wrote ${FIXTURE_PATH} — commit it`);
      return;
    }

    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    expect(fixture.seed).toBe(SEED);
    expect(fixture.log).toEqual(LOG);
    expect(fixture.events).toEqual(EVENTS);
    expect(actual.hashes).toEqual(fixture.hashes);
    expect(actual.finalSerializedLength).toBe(fixture.finalSerializedLength);
  });
});

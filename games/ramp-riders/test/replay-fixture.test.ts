/**
 * Replay regression fixture (the CI determinism gate) — scaffolded by
 * `pnpm new-game`. The fixture is an input log plus state hashes sampled during
 * playback. On the first run (no fixture yet) it writes one — commit it. If a
 * later change alters gameplay this fails; fix the regression, or regenerate
 * intentionally with `REGEN_FIXTURES=1 pnpm test` and review the diff.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button, type InputLogEntry } from '@retro-recall/retrokit/sim';
import { RampRidersSim } from '../src/sim/sim';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/replay-001.json', import.meta.url));
const SEED = 0xc0ffee; // → track 0 (Driveway Dash); see seed % TRACK_COUNT
const HASH_EVERY = 60; // sample every second of sim time

// A full solo race: sit through the 3-2-1 gate, then pedal / pump / switch
// lanes / lean over ramps to the finish. Exercises every mechanic so the gate
// catches any gameplay drift.
const LOG: InputLogEntry[] = [
  [0, 180], // countdown
  [Button.A, 180], // pedal off the line
  [Button.A | Button.B, 240], // pump
  [Button.A | Button.Up, 12], // lane up
  [Button.A | Button.B, 300],
  [Button.A | Button.Down, 12], // lane down
  [Button.A | Button.Right, 40], // lean over a ramp
  [Button.A | Button.B, 360],
  [Button.A, 240],
  [0, 240], // coast across the line
];

interface Fixture {
  seed: number;
  hashEvery: number;
  log: InputLogEntry[];
  hashes: number[];
  finalSerializedLength: number;
}

const runAndSample = (): { hashes: number[]; finalSerializedLength: number } => {
  const sim = new RampRidersSim(SEED);
  sim.joinPlayer(0);
  const hashes: number[] = [];
  let t = 0;
  for (const [bits, count] of LOG) {
    for (let i = 0; i < count; i++) {
      sim.tick([bits]);
      t++;
      if (t % HASH_EVERY === 0) hashes.push(sim.hash());
    }
  }
  hashes.push(sim.hash());
  return { hashes, finalSerializedLength: sim.serialize().length };
};

describe('Ramp Riders replay fixture', () => {
  it('replaying the recorded log reproduces the recorded state hashes', () => {
    const actual = runAndSample();

    if (!existsSync(FIXTURE_PATH) || process.env['REGEN_FIXTURES'] === '1') {
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      const fixture: Fixture = { seed: SEED, hashEvery: HASH_EVERY, log: LOG, ...actual };
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
      console.warn('[replay-fixture] wrote ' + FIXTURE_PATH + ' — commit it');
      return;
    }

    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    expect(fixture.seed).toBe(SEED);
    expect(fixture.log).toEqual(LOG);
    expect(actual.hashes).toEqual(fixture.hashes);
    expect(actual.finalSerializedLength).toBe(fixture.finalSerializedLength);
  });
});

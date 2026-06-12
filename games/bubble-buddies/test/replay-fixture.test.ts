/**
 * Replay regression fixture (the CI determinism gate).
 *
 * The fixture is an input log plus state hashes sampled during playback. If
 * this test fails, a change altered gameplay: either fix the regression, or —
 * if the change is intentional — regenerate with
 *
 *   REGEN_FIXTURES=1 pnpm test
 *
 * and review the fixture diff alongside the spec change.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button, type InputLogEntry } from '@retro-recall/retrokit/sim';
import { BubbleBuddiesSim } from '../src/sim/sim';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/replay-001.json', import.meta.url));
const SEED = 0xb0bb1e5;
const HASH_EVERY = 600; // sample every 10 seconds of sim time

// ~2 minutes of varied play: roaming, jumping between layers, blowing
// bubbles, idling long enough for traps to escape and grumbles to hit ledges.
const LOG: InputLogEntry[] = [
  [0, 30],
  [Button.Right, 100],
  [Button.Right | Button.A, 25],
  [Button.Right, 60],
  [Button.B, 2],
  [0, 90],
  [Button.Left | Button.A, 30],
  [Button.Left, 90],
  [Button.B, 2],
  [0, 240],
  [Button.Right | Button.B, 2],
  [Button.Right, 180],
  [Button.A, 25],
  [Button.Right | Button.A, 25],
  [0, 300],
  [Button.Left, 200],
  [Button.B, 2],
  [Button.Left | Button.A, 40],
  [0, 600],
  [Button.Right, 150],
  [Button.A, 2],
  [Button.B, 2],
  [0, 540],
  [Button.Left | Button.B, 2],
  [Button.Left, 250],
  [Button.A, 30],
  [0, 900],
  [Button.Right | Button.A, 60],
  [Button.B, 2],
  [0, 1200],
  [Button.Start, 2],
  [0, 1500],
];

interface Fixture {
  seed: number;
  hashEvery: number;
  log: InputLogEntry[];
  hashes: number[];
  finalSerializedLength: number;
}

const runAndSample = (): { hashes: number[]; finalSerializedLength: number } => {
  const sim = new BubbleBuddiesSim(SEED);
  const hashes: number[] = [];
  let t = 0;
  for (const [bits, count] of LOG) {
    for (let i = 0; i < count; i++) {
      sim.tick(bits);
      t++;
      if (t % HASH_EVERY === 0) hashes.push(sim.hash());
    }
  }
  hashes.push(sim.hash());
  return { hashes, finalSerializedLength: sim.serialize().length };
};

describe('replay fixture', () => {
  it('replaying the recorded log reproduces the recorded state hashes', () => {
    const actual = runAndSample();

    if (!existsSync(FIXTURE_PATH) || process.env['REGEN_FIXTURES'] === '1') {
      const fixture: Fixture = { seed: SEED, hashEvery: HASH_EVERY, log: LOG, ...actual };
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
      console.warn(`[replay-fixture] wrote ${FIXTURE_PATH} — commit it`);
      return;
    }

    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    expect(fixture.seed).toBe(SEED);
    expect(fixture.log).toEqual(LOG);
    expect(actual.hashes).toEqual(fixture.hashes);
    expect(actual.finalSerializedLength).toBe(fixture.finalSerializedLength);
  });
});

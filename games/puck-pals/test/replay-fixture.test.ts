/**
 * Replay regression fixture (the CI determinism gate). A multi-slot input log
 * (1v1: two humans, the rest CPU) plus state hashes sampled during playback.
 * On the first run (no fixture) it writes one — commit it. If a later change
 * alters gameplay this fails; fix the regression, or regenerate intentionally
 * with `REGEN_FIXTURES=1 pnpm test` and review the diff alongside the SPEC.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button, type MultiInputLogEntry, type SlotInputs } from '@retro-recall/retrokit/sim';
import { PuckPalsSim } from '../src/sim/sim';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/replay-001.json', import.meta.url));
const SEED = 0xc0ffee;
const HASH_EVERY = 60; // sample every second of sim time

// Slot 0 = Home center, slot 1 = Away center; CPUs fill the rest. The log skates
// both around, jostles for the puck, charges and shoots — a representative
// minute of play that exercises possession, checks, shots, and the clock.
const LOG: MultiInputLogEntry[] = [
  [[0, 0], 95], // faceoff freeze
  [[Button.Up, Button.Down], 40],
  [[Button.Up | Button.B, Button.Down | Button.B], 40],
  [[Button.Right, Button.Left], 30],
  [[Button.A, Button.B], 6],
  [[Button.Down, Button.Up], 50],
  [[Button.Left | Button.B, Button.Right | Button.B], 30],
  [[0, Button.A], 6],
  [[Button.Up, Button.Up], 60],
  [[0, 0], 60],
];

interface Fixture {
  seed: number;
  hashEvery: number;
  log: MultiInputLogEntry[];
  hashes: number[];
  finalSerializedLength: number;
}

const runAndSample = (): { hashes: number[]; finalSerializedLength: number } => {
  const sim = new PuckPalsSim(SEED);
  sim.joinPlayer(0);
  sim.joinPlayer(1);
  const hashes: number[] = [];
  let t = 0;
  for (const [inputs, count] of LOG) {
    for (let i = 0; i < count; i++) {
      sim.tick(inputs as SlotInputs);
      t++;
      if (t % HASH_EVERY === 0) hashes.push(sim.hash());
    }
  }
  hashes.push(sim.hash());
  return { hashes, finalSerializedLength: sim.serialize().length };
};

describe('Puck Pals replay fixture', () => {
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

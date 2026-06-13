import { describe, expect, it } from 'vitest';
import { Button, replay, type InputLogEntry } from '@retro-recall/retrokit/sim';
import { SplashSquadSim } from './sim';

const LOG: InputLogEntry[] = [
  [Button.Right, 30],
  [Button.Right | Button.A, 10],
  [0, 20],
  [Button.Left, 25],
];

describe('SplashSquadSim', () => {
  it('is deterministic for a fixed seed and input log', () => {
    const a = new SplashSquadSim(0x1234);
    const b = new SplashSquadSim(0x1234);
    a.joinPlayer(0);
    b.joinPlayer(0);
    replay(a, LOG);
    replay(b, LOG);
    expect(a.hash()).toBe(b.hash());
    expect(a.serialize()).toBe(b.serialize());
  });

  it('a different seed produces a different state hash', () => {
    const a = new SplashSquadSim(1);
    const b = new SplashSquadSim(2);
    a.joinPlayer(0);
    b.joinPlayer(0);
    replay(a, LOG);
    replay(b, LOG);
    // The hero path is identical, but the serialized RNG state differs.
    expect(a.hash()).not.toBe(b.hash());
  });

  it('round-trips through snapshot / restore', () => {
    const s = new SplashSquadSim(7);
    s.joinPlayer(0);
    replay(s, LOG);
    const snap = s.snapshot();
    const s2 = new SplashSquadSim(7);
    s2.restore(snap);
    expect(s2.hash()).toBe(s.hash());
  });
});

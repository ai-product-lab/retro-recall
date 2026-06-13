import { describe, expect, it } from 'vitest';
import { Button, type InputBits } from '@retro-recall/retrokit/sim';
import { RampRidersSim } from './sim';
import * as C from './constants';

/** Run `n` ticks holding `bits` for slot 0 (other slots empty). */
const run = (sim: RampRidersSim, bits: InputBits, n: number): void => {
  for (let i = 0; i < n; i++) sim.tick([bits]);
};

/** Tick until the race resolves (mode `results`) or a tick cap, return ticks used. */
const raceToEnd = (sim: RampRidersSim, bits: InputBits, cap = 6000): number => {
  let t = 0;
  while (sim.state.mode !== 'results' && sim.state.mode !== 'done' && t < cap) {
    sim.tick([bits]);
    t++;
  }
  return t;
};

describe('RampRidersSim — determinism', () => {
  const LOG: [InputBits, number][] = [
    [0, 200],
    [Button.A, 120],
    [Button.A | Button.B, 90],
    [Button.Up, 12],
    [Button.A, 150],
    [Button.Left, 30],
    [Button.A | Button.Down, 60],
  ];
  const play = (s: RampRidersSim): void => {
    for (const [bits, n] of LOG) run(s, bits, n);
  };

  it('same seed + log ⇒ identical serialize and hash', () => {
    const a = new RampRidersSim(0x1234, { players: 1 });
    const b = new RampRidersSim(0x1234, { players: 1 });
    play(a);
    play(b);
    expect(a.serialize()).toBe(b.serialize());
    expect(a.hash()).toBe(b.hash());
  });

  it('round-trips through snapshot / restore mid-race', () => {
    const s = new RampRidersSim(7, { players: 2 });
    play(s);
    const snap = s.snapshot();
    const s2 = new RampRidersSim(999, { players: 1 }); // different seed/track on purpose
    s2.restore(snap);
    expect(s2.hash()).toBe(s.hash());
    // And continues identically after restore.
    run(s, Button.A, 100);
    run(s2, Button.A, 100);
    expect(s2.hash()).toBe(s.hash());
  });
});

describe('RampRidersSim — race flow', () => {
  it('holds riders at the gate during the countdown, then races', () => {
    const s = new RampRidersSim(0, { track: 0, players: 1 });
    const startX = s.state.players[0]!.x;
    run(s, Button.A, C.COUNTDOWN_TICKS - 1);
    expect(s.state.mode).toBe('countdown');
    expect(s.state.players[0]!.x).toBe(startX); // frozen
    s.tick([Button.A]);
    expect(s.state.mode).toBe('racing');
    run(s, Button.A, 30);
    expect(s.state.players[0]!.x).toBeGreaterThan(startX); // moving now
  });

  it('a pedaling rider finishes the track and is placed 1st', () => {
    const s = new RampRidersSim(0, { track: 0, players: 1 });
    raceToEnd(s, Button.A);
    expect(s.state.mode).toBe('results');
    expect(s.state.players[0]!.phase).toBe('finished');
    expect(s.state.players[0]!.finishPlace).toBe(1);
  });

  it('the faster rider finishes ahead', () => {
    // Slot 0 pumps (boost), slot 1 only coasts (no pedal).
    const s = new RampRidersSim(0, { track: 0, players: 2 });
    let t = 0;
    while ((s.state.mode === 'countdown' || s.state.mode === 'racing') && t < 8000) {
      s.tick([Button.A | Button.B, 0]);
      t++;
    }
    const p0 = s.state.players[0]!;
    const p1 = s.state.players[1]!;
    expect(p0.finishPlace).toBe(1);
    expect(p1.finishPlace).toBe(2);
    expect(p0.finishTick).toBeLessThan(p1.finishTick);
  });
});

describe('RampRidersSim — mechanics', () => {
  const past = (s: RampRidersSim): void => run(s, 0, C.COUNTDOWN_TICKS);

  it('pumping drains legs; coasting regenerates them', () => {
    const s = new RampRidersSim(0, { track: 0, players: 1 });
    past(s);
    run(s, Button.A | Button.B, 50);
    const drained = s.state.players[0]!.legs;
    expect(drained).toBeLessThan(C.LEGS_MAX);
    run(s, Button.A, 80);
    expect(s.state.players[0]!.legs).toBeGreaterThan(drained);
  });

  it('Up/Down switch lanes with a cooldown', () => {
    const s = new RampRidersSim(0, { track: 0, players: 1 });
    past(s);
    expect(s.state.players[0]!.lane).toBe(C.START_LANE);
    s.tick([Button.Up]);
    expect(s.state.players[0]!.lane).toBe(C.START_LANE + 1);
    s.tick([Button.Up]); // within cooldown — ignored
    expect(s.state.players[0]!.lane).toBe(C.START_LANE + 1);
    run(s, 0, C.LANE_SWITCH_COOLDOWN);
    s.tick([Button.Down]);
    expect(s.state.players[0]!.lane).toBe(C.START_LANE);
  });

  it('a rider launches off a ramp (goes airborne)', () => {
    // Track 4 (Big Air) is full of kickers.
    const s = new RampRidersSim(0, { track: 4, players: 1 });
    let airborneSeen = false;
    let t = 0;
    while (s.state.mode !== 'results' && t < 6000) {
      s.tick([Button.A | Button.B]);
      if (s.state.players[0]!.airborne) airborneSeen = true;
      t++;
    }
    expect(airborneSeen).toBe(true);
  });

  it('junior boost speeds up a trailing rider', () => {
    // Two riders; slot 1 trails (no input). Compare slot 1 progress with the
    // assist on vs. off after the same script.
    // Slot 0 boosts to open a gap; slot 1 coasts on open flat (no obstacle yet),
    // so its x is governed only by the assist.
    const trailDist = (jb: boolean): number => {
      const s = new RampRidersSim(0, { track: 0, players: 2, juniorBoost: jb });
      while (s.state.mode === 'countdown') s.tick([0, 0]);
      for (let i = 0; i < 300; i++) s.tick([Button.A | Button.B, 0]);
      return s.state.players[1]!.x;
    };
    expect(trailDist(true)).toBeGreaterThan(trailDist(false));
  });
});

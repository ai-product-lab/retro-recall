import { describe, expect, it } from 'vitest';
import {
  Button,
  SUBPX,
  replay,
  replayMulti,
  type InputLogEntry,
  type MultiInputLogEntry,
} from '@retro-recall/retrokit/sim';
import { SplashSquadSim, type RobotState } from './sim';
import { LEVELS } from './levels';
import * as C from './constants';

// A solo run that walks right, soaks, jumps, and pauses — exercises movement,
// firing, the scroll window, and camera-triggered spawns.
const LOG: InputLogEntry[] = [
  [Button.Right, 40],
  [Button.Right | Button.B, 40],
  [Button.B, 10],
  [0, 20],
  [Button.A | Button.Right, 5],
  [Button.Right | Button.B, 30],
];

describe('SplashSquadSim determinism', () => {
  it('is deterministic for a fixed seed and input log', () => {
    const a = new SplashSquadSim(0x1234);
    const b = new SplashSquadSim(0x1234);
    replay(a, LOG);
    replay(b, LOG);
    expect(a.hash()).toBe(b.hash());
    expect(a.serialize()).toBe(b.serialize());
  });

  it('a different seed produces a different state hash', () => {
    const a = new SplashSquadSim(1);
    const b = new SplashSquadSim(2);
    replay(a, LOG);
    replay(b, LOG);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('round-trips through snapshot / restore and stays in lockstep', () => {
    const s = new SplashSquadSim(7);
    replay(s, LOG);
    const snap = s.snapshot();
    const s2 = new SplashSquadSim(7);
    s2.restore(snap);
    expect(s2.hash()).toBe(s.hash());
    const more: InputLogEntry[] = [[Button.Right | Button.B, 60]];
    replay(s, more);
    replay(s2, more);
    expect(s2.hash()).toBe(s.hash());
  });

  it('co-op replay (4 input streams) is deterministic', () => {
    const log: MultiInputLogEntry[] = [
      [[Button.Right, Button.Right, Button.B, 0], 30],
      [[Button.B, Button.A, Button.Right, Button.Right], 30],
      [[0, 0, 0, 0], 20],
    ];
    const a = new SplashSquadSim(0xabc, 0, 4);
    const b = new SplashSquadSim(0xabc, 0, 4);
    replayMulti(a, log);
    replayMulti(b, log);
    expect(a.hash()).toBe(b.hash());
    expect(a.state.reviveRules).toBe(true); // 4 active → revive rules (§11)
  });
});

describe('Splash Squad levels', () => {
  it('every level is rectangular and the expected size', () => {
    expect(LEVELS.length).toBe(C.LEVEL_COUNT);
    for (const lvl of LEVELS) {
      const w = lvl.rows[0]!.length;
      expect(w).toBe(lvl.screens * C.SCREEN_TILES_W);
      expect(lvl.rows.length).toBe(C.LEVEL_HEIGHT);
      for (const r of lvl.rows) expect(r.length).toBe(w);
    }
  });

  it('boss levels are exactly the three zone enders', () => {
    expect([LEVELS[1]!.boss, LEVELS[3]!.boss, LEVELS[5]!.boss]).toEqual([true, true, true]);
    expect([LEVELS[0]!.boss, LEVELS[2]!.boss, LEVELS[4]!.boss]).toEqual([false, false, false]);
  });

  it('starting any level constructs without throwing', () => {
    for (let i = 0; i < LEVELS.length; i++) {
      expect(() => new SplashSquadSim(1, i)).not.toThrow();
    }
  });
});

describe('Splash Squad gameplay', () => {
  const mkTrundle = (x: number, y: number): RobotState => ({
    id: 999,
    kind: 'trundle',
    x,
    y,
    vy: 0,
    facing: -1,
    grounded: true,
    soak: 0,
    born: 0,
    winddown: -1,
    lastHitBy: 0,
  });

  it('firing spends the tank and emits a droplet', () => {
    const s = new SplashSquadSim(3);
    const tank0 = s.state.players[0]!.tank;
    s.tick([Button.B]);
    expect(s.state.droplets.length).toBe(1); // stream nozzle = 1 droplet
    expect(s.state.players[0]!.tank).toBe(tank0 - 1);
  });

  it('the spread nozzle fires three droplets (spends three tank units)', () => {
    const s = new SplashSquadSim(3);
    s.state.players[0]!.nozzle = C.NOZZLE_SPREAD;
    const tank0 = s.state.players[0]!.tank;
    s.tick([Button.B]);
    expect(tank0 - s.state.players[0]!.tank).toBe(3);
  });

  it('soaking a trundle winds it down and scores', () => {
    const s = new SplashSquadSim(3);
    const p = s.state.players[0]!;
    s.state.robots = [mkTrundle(p.x + 24 * SUBPX, p.y)]; // 24px to the right, same row
    for (let i = 0; i < 90; i++) s.tick([Button.B]);
    const r = s.state.robots.find((x) => x.id === 999);
    expect(p.score).toBeGreaterThan(0);
    // either despawned (sputter finished) or currently winding down
    expect(r === undefined || r.winddown >= 0).toBe(true);
  });

  it('an empty tank fires nothing', () => {
    const s = new SplashSquadSim(3);
    s.state.players[0]!.tank = 0;
    s.tick([Button.B]);
    expect(s.state.droplets.length).toBe(0);
  });

  it('the scroll window only ever advances (forward lock)', () => {
    const s = new SplashSquadSim(3);
    let prev = s.state.scrollX;
    for (let i = 0; i < 400; i++) {
      s.tick([Button.Right | Button.B]); // fire to clear pursuers off the path
      expect(s.state.scrollX).toBeGreaterThanOrEqual(prev); // forward-only
      prev = s.state.scrollX;
    }
    expect(s.state.scrollX).toBeGreaterThan(0); // leader pulled the window right
  });
});

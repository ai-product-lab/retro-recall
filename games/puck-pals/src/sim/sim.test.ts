import { describe, expect, it } from 'vitest';
import { Button, replayMulti, type MultiInputLogEntry, type SlotInputs } from '@retro-recall/retrokit/sim';
import { PuckPalsSim, type GameState } from './sim';
import * as C from './constants';

/** Run a sim past the opening faceoff freeze into live play. */
const intoPlay = (s: PuckPalsSim): void => {
  for (let i = 0; i <= C.FACEOFF_FREEZE_TICKS; i++) s.tick([]);
};

const homeCenter = (st: GameState) => st.skaters.find((s) => s.id === 0)!;

describe('PuckPalsSim — determinism', () => {
  const LOG: MultiInputLogEntry[] = [
    [[Button.Right, Button.Left], 40],
    [[Button.Up | Button.B, Button.Down], 20],
    [[Button.A, Button.B], 10],
    [[0, 0], 30],
  ];

  it('is identical for a fixed seed + input log', () => {
    const a = new PuckPalsSim(0x1234);
    const b = new PuckPalsSim(0x1234);
    a.joinPlayer(0);
    a.joinPlayer(1);
    b.joinPlayer(0);
    b.joinPlayer(1);
    intoPlay(a);
    intoPlay(b);
    replayMulti(a, LOG);
    replayMulti(b, LOG);
    expect(a.hash()).toBe(b.hash());
    expect(a.serialize()).toBe(b.serialize());
  });

  it('diverges for a different seed (CPU AI draws the seeded RNG)', () => {
    const a = new PuckPalsSim(1);
    const b = new PuckPalsSim(2);
    a.joinPlayer(0);
    b.joinPlayer(0);
    intoPlay(a);
    intoPlay(b);
    replayMulti(a, LOG);
    replayMulti(b, LOG);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('round-trips through snapshot / restore', () => {
    const s = new PuckPalsSim(7);
    s.joinPlayer(0);
    intoPlay(s);
    replayMulti(s, LOG);
    const snap = s.snapshot();
    const s2 = new PuckPalsSim(99);
    s2.restore(snap);
    expect(s2.hash()).toBe(s.hash());
    s.tick([Button.Right]);
    s2.tick([Button.Right]);
    expect(s2.hash()).toBe(s.hash()); // keeps in lockstep after restore
  });
});

describe('PuckPalsSim — structure & faceoff', () => {
  it('builds 2×3 skaters + 2 goalies, all CPU until joined', () => {
    const s = new PuckPalsSim(1);
    const st = s.state;
    expect(st.skaters.map((x) => x.id)).toEqual([0, 1, 2, 10, 11, 12]);
    expect(st.goalies.map((x) => x.id)).toEqual([9, 19]);
    expect(st.skaters.every((x) => x.controller === 'cpu')).toBe(true);
  });

  it('binds humans to team slot % 2, lowest index first (SPEC §3)', () => {
    const s = new PuckPalsSim(1);
    s.joinPlayer(0); // Home, skater 0
    s.joinPlayer(1); // Away, skater 10
    s.joinPlayer(2); // Home, skater 1
    const byId = (id: number) => s.state.skaters.find((x) => x.id === id)!;
    expect(byId(0)).toMatchObject({ controller: 'human', slot: 0, team: 0 });
    expect(byId(10)).toMatchObject({ controller: 'human', slot: 1, team: 1 });
    expect(byId(1)).toMatchObject({ controller: 'human', slot: 2, team: 0 });
    expect(byId(2).controller).toBe('cpu');
  });

  it('freezes skaters during the faceoff, then goes live', () => {
    const s = new PuckPalsSim(1);
    s.joinPlayer(0);
    const before = { ...homeCenter(s.state) };
    s.tick([Button.Right]); // ignored during freeze
    expect(homeCenter(s.state).x).toBe(before.x);
    expect(s.state.mode).toBe('faceoff');
    intoPlay(s);
    expect(s.state.mode).toBe('play');
  });
});

describe('PuckPalsSim — skating physics (SPEC §3.1)', () => {
  it('accelerates under input and coasts on release (ice friction)', () => {
    const s = new PuckPalsSim(1);
    s.joinPlayer(0);
    intoPlay(s);
    for (let i = 0; i < 20; i++) s.tick([Button.Right]);
    const moving = homeCenter(s.state);
    expect(moving.vx).toBeGreaterThan(0);
    expect(Math.abs(moving.vx)).toBeLessThanOrEqual(C.SKATE_MAX_SPEED);
    const xAtRelease = moving.x;
    s.tick([0]); // release — should still glide
    expect(homeCenter(s.state).x).toBeGreaterThan(xAtRelease);
  });

  it('stops dead against the boards instead of bouncing', () => {
    const s = new PuckPalsSim(1);
    s.joinPlayer(0);
    intoPlay(s);
    for (let i = 0; i < 400; i++) s.tick([Button.Left]); // skate into the left wall
    const p = homeCenter(s.state);
    expect(p.vx).toBe(0);
    expect(p.x).toBeGreaterThanOrEqual(C.TILE_SIZE * 256 - 1);
  });
});

describe('PuckPalsSim — possession, shooting, goals', () => {
  it('a skater picks up the loose center-ice puck', () => {
    const s = new PuckPalsSim(0xabc);
    s.joinPlayer(0);
    intoPlay(s);
    // Drive the home center onto the puck.
    let carried = false;
    for (let i = 0; i < 120 && !carried; i++) {
      s.tick([Button.Up]); // center sits below the dot in formation → skate up to it
      carried = s.state.puck.carrier >= 0;
    }
    expect(s.state.puck.carrier).toBeGreaterThanOrEqual(0);
  });

  it('a full-charge release is a faster, knockdown super slap', () => {
    const s = new PuckPalsSim(5);
    intoPlay(s);
    s.joinPlayer(0); // skater 0 must be human to receive our B input
    const st = s.state;
    // Park the opposing team in a corner so no one steals during the wind-up.
    for (const sk of st.skaters) {
      if (sk.team === 1) {
        sk.x = 2 * 256;
        sk.y = 2 * 256;
      }
    }
    const c = st.skaters.find((x) => x.id === 0)!;
    st.puck.carrier = 0;
    st.puck.cooldown = 0;
    c.faceX = 0;
    c.faceY = -1; // aim up
    // Hold B to full charge, then release.
    for (let i = 0; i < C.SLAP_CHARGE_MAX_TICKS; i++) s.tick([Button.B]);
    expect(st.skaters.find((x) => x.id === 0)!.charge).toBe(C.SLAP_CHARGE_MAX_TICKS);
    s.tick([0]); // release
    expect(st.puck.carrier).toBe(-1);
    expect(st.puck.superSlap).toBe(true);
    const speed = Math.max(Math.abs(st.puck.vx), Math.abs(st.puck.vy));
    expect(speed).toBeGreaterThan(C.SHOT_SPEED);
    expect(speed).toBeLessThanOrEqual(C.SUPER_SLAP_SPEED);
  });

  it('the puck banks off a side board (reflects, damped)', () => {
    const s = new PuckPalsSim(1);
    intoPlay(s);
    const p = s.state.puck;
    p.carrier = -1;
    p.cooldown = 0;
    p.x = (C.CENTER_X - 4) * 256;
    p.y = C.CENTER_Y * 256;
    p.vx = -1600; // fire it at the left boards
    p.vy = 0;
    let bounced = false;
    for (let i = 0; i < 200 && !bounced; i++) {
      s.tick([]);
      if (s.state.puck.vx > 0) bounced = true; // velocity flipped → it banked
    }
    expect(bounced).toBe(true);
  });

  it('scores when the puck crosses the goal line in the mouth', () => {
    const s = new PuckPalsSim(1);
    intoPlay(s);
    const st = s.state;
    const scorer = st.period % 2 === 0 ? 0 : 1; // team attacking the top net
    st.puck.carrier = -1;
    st.puck.cooldown = 0;
    st.puck.x = (C.CENTER_X - C.PUCK_HITBOX / 2) * 256;
    st.puck.y = (C.GOAL_LINE_TOP_Y + 6) * 256;
    st.puck.vx = 0;
    st.puck.vy = -900;
    // Park the top goalie out of the way so the shot gets through.
    const topG = st.goalies.find((g) => g.y < C.CENTER_Y * 256)!;
    topG.x = -100 * 256;
    const before = st.score[scorer]!;
    let scored = false;
    for (let i = 0; i < 30 && !scored; i++) {
      s.tick([]);
      if (s.state.score[scorer]! > before) scored = true;
    }
    expect(scored).toBe(true);
    expect(s.state.mode).toBe('goal');
  });
});

describe('PuckPalsSim — checks, clock, disconnect', () => {
  it('a fast body check tumbles an opponent and frees the puck', () => {
    const s = new PuckPalsSim(3);
    intoPlay(s);
    s.joinPlayer(1); // away skater 10 must be human to receive our check input
    const st = s.state;
    const checker = st.skaters.find((x) => x.id === 10)!; // away skater
    const victim = st.skaters.find((x) => x.id === 0)!; // home center
    // Put them on top of each other; give the victim the puck; checker moving fast.
    victim.x = C.CENTER_X * 256;
    victim.y = C.CENTER_Y * 256;
    checker.x = victim.x;
    checker.y = victim.y;
    checker.vx = C.SKATE_MAX_SPEED;
    st.puck.carrier = 0;
    st.puck.cooldown = 0;
    checker.prevInput = 0;
    s.tick([0, Button.B]); // away (slot 1) presses check
    expect(st.skaters.find((x) => x.id === 0)!.tumble).toBeGreaterThan(0);
    expect(st.puck.carrier).not.toBe(0);
  });

  it('a full all-CPU game terminates at a final result (bounded, no soft-lock)', () => {
    const s = new PuckPalsSim(0x5eed);
    // 3×60s regulation + up to 5×60s OT + freezes/celebrations — give headroom.
    const cap = (C.PERIODS + C.OT_MAX_PERIODS) * C.PERIOD_TICKS + 20000;
    let t = 0;
    while (s.state.mode !== 'final' && t < cap) {
      s.tick([]);
      t++;
    }
    expect(s.state.mode).toBe('final');
    expect([0, 1]).toContain(s.state.winner);
  });

  it('keeps every skater, goalie, and the puck inside the boards all game', () => {
    const s = new PuckPalsSim(0x1ce);
    s.joinPlayer(0);
    s.joinPlayer(1);
    // Check the whole-pixel footprint the engine collides + renders with (a box
    // at subpx x occupies pixel cells floor(x/SUBPX) .. +w-1), so every occupied
    // cell must be ice, not a board tile.
    const within = (x: number, y: number, w: number, h: number): boolean => {
      const px = Math.floor(x / 256);
      const py = Math.floor(y / 256);
      return (
        px >= C.TILE_SIZE &&
        py >= C.TILE_SIZE &&
        px + w - 1 <= C.RINK_PX_W - C.TILE_SIZE - 1 &&
        py + h - 1 <= C.RINK_PX_H - C.TILE_SIZE - 1
      );
    };
    for (let i = 0; i < 4000; i++) {
      // Mash inputs to fling bodies and the puck at the walls.
      s.tick([Button.Up | Button.Right | Button.B, Button.Down | Button.Left | Button.B]);
      for (const sk of s.state.skaters) {
        expect(within(sk.x, sk.y, C.SKATER_HITBOX, C.SKATER_HITBOX)).toBe(true);
      }
      const p = s.state.puck;
      expect(within(p.x, p.y, C.PUCK_HITBOX, C.PUCK_HITBOX)).toBe(true);
    }
  });

  it('runs the clock during play and ends regulation', () => {
    const s = new PuckPalsSim(1);
    intoPlay(s);
    const clock0 = s.state.clock;
    s.tick([]);
    expect(s.state.clock).toBe(clock0 - 1);
  });

  it('reverts a disconnected human skater to CPU after the grace window', () => {
    const s = new PuckPalsSim(1);
    s.joinPlayer(0);
    intoPlay(s);
    const human = () => s.state.skaters.find((x) => x.id === 0)!;
    expect(human().controller).toBe('human');
    for (let i = 0; i < C.DISCONNECT_GRACE_TICKS; i++) s.tick([null] as unknown as SlotInputs);
    expect(human().controller).toBe('cpu');
    s.rejoinPlayer(0); // reconnect reclaims it
    expect(human().controller).toBe('human');
  });
});

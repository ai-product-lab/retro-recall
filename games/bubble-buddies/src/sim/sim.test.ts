import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button, SUBPX, replay, type SlotInputs } from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { LEVELS } from './levels';
import { BubbleBuddiesSim, type EnemyState } from './sim';

describe('levels', () => {
  it('match the maps in SPEC.md exactly', () => {
    const specPath = fileURLToPath(new URL('../../SPEC.md', import.meta.url));
    const spec = readFileSync(specPath, 'utf8');
    const blocks = [...spec.matchAll(/```\n([\s\S]*?)```/g)].map((m) =>
      m[1]!.trimEnd().split('\n'),
    );
    expect(blocks).toHaveLength(C.LEVEL_COUNT);
    LEVELS.forEach((lvl, i) => {
      expect(lvl.rows, `level ${i + 1} (${lvl.name})`).toEqual(blocks[i]);
    });
  });

  it('are well-formed 32×24 grids with one player spawn', () => {
    for (const lvl of LEVELS) {
      expect(lvl.rows).toHaveLength(C.LEVEL_HEIGHT);
      for (const row of lvl.rows) expect(row).toHaveLength(C.LEVEL_WIDTH);
      expect(lvl.rows.join('').split('P')).toHaveLength(2);
    }
  });
});

/** A grumble standing on the level-1 floor (top at y=184). */
const grumbleAt = (xPx: number, id = 900): EnemyState => ({
  id,
  kind: 'grumble',
  x: xPx * SUBPX,
  y: (184 - C.ENEMY_HITBOX_H) * SUBPX,
  vy: 0,
  facing: -1,
  dy: 1,
  angry: false,
  ledgeTile: -1,
});

const run = (sim: BubbleBuddiesSim, ticks: number, input = 0): void => {
  for (let i = 0; i < ticks; i++) sim.tick([input]);
};

const runM = (sim: BubbleBuddiesSim, ticks: number, inputs: SlotInputs): void => {
  for (let i = 0; i < ticks; i++) sim.tick(inputs);
};

/**
 * Park an uncollectable fruit in the far corner so the level-clear condition
 * stays unmet while a test empties the enemy list.
 */
const holdLevelOpen = (sim: BubbleBuddiesSim): void => {
  sim.state.fruit.push({
    id: 999,
    kind: 'grumble',
    x: 232 * SUBPX,
    y: (184 - C.FRUIT_HITBOX) * SUBPX,
    vy: 0,
    age: -1_000_000,
  });
};

describe('player', () => {
  it('walks, faces, and stays inside walls', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const p = sim.state.players[0]!;
    const startX = p.x;
    run(sim, 10, Button.Right);
    expect(p.x).toBe(startX + 10 * C.PLAYER_WALK_SPEED);
    expect(p.facing).toBe(1);
    run(sim, 60, Button.Left); // more than enough to reach the left wall
    expect(Math.floor(p.x / SUBPX)).toBe(C.TILE_SIZE); // flush with left wall
  });

  it('jumps only from the ground and clears a 4-tile layer', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const p = sim.state.players[0]!;
    const startY = p.y;
    sim.tick([Button.A]);
    expect(p.vy).toBeLessThan(0);
    let peak = startY;
    for (let i = 0; i < 80; i++) {
      sim.tick([0]);
      peak = Math.min(peak, p.y);
    }
    const risePx = (startY - peak) / SUBPX;
    expect(risePx).toBeGreaterThan(4 * C.TILE_SIZE); // reaches the next layer
    expect(risePx).toBeLessThan(6 * C.TILE_SIZE);
  });

  it('blowing respects the cooldown and re-press rule', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    run(sim, 5, Button.B); // held: only the initial press spawns
    expect(sim.state.bubbles).toHaveLength(1);
    sim.tick([0]);
    sim.tick([Button.B]); // re-press while still cooling down
    expect(sim.state.bubbles).toHaveLength(1);
    run(sim, C.BLOW_COOLDOWN_TICKS, 0);
    sim.tick([Button.B]);
    expect(sim.state.bubbles).toHaveLength(2);
  });
});

describe('bubbles and enemies', () => {
  /** Sim with one grumble 5 tiles right of the player, both on the floor. */
  const trapSetup = (): BubbleBuddiesSim => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [grumbleAt(62)];
    return sim;
  };

  it('blow-phase bubble traps an enemy', () => {
    const sim = trapSetup();
    sim.tick([Button.B]);
    run(sim, 15, 0);
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.bubbles).toHaveLength(1);
    expect(sim.state.bubbles[0]!.trapped).toBe('grumble');
  });

  it('float-phase bubble does not trap', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    sim.tick([Button.B]);
    run(sim, C.BUBBLE_BLOW_TICKS + 5, 0); // bubble now floating upward, empty
    const bubble = sim.state.bubbles[0]!;
    sim.state.enemies = [grumbleAt(62, 901)];
    sim.state.enemies[0]!.x = bubble.x;
    sim.state.enemies[0]!.y = bubble.y;
    sim.tick([0]);
    expect(sim.state.bubbles[0]!.trapped).toBeNull();
    expect(sim.state.enemies).toHaveLength(1);
  });

  it('popping a full bubble kills the enemy into fruit and scores', () => {
    const sim = trapSetup();
    sim.tick([Button.B]);
    run(sim, 15, 0);
    const b = sim.state.bubbles[0]!;
    sim.state.players[0]!.x = b.x;
    sim.state.players[0]!.y = b.y;
    sim.tick([0]);
    expect(sim.state.bubbles).toHaveLength(0);
    // Fruit spawns at the bubble and is collected on contact immediately.
    expect(sim.state.fruit).toHaveLength(0);
    expect(sim.state.players[0]!.score).toBe(C.SCORE_POP_BASE + C.SCORE_FRUIT_GRUMBLE);
  });

  it('trapped enemy escapes angry after TRAP_ESCAPE_TICKS', () => {
    const sim = trapSetup();
    sim.tick([Button.B]);
    run(sim, 15, 0);
    expect(sim.state.bubbles[0]!.trapped).toBe('grumble');
    run(sim, C.TRAP_ESCAPE_TICKS, 0);
    expect(sim.state.bubbles).toHaveLength(0);
    expect(sim.state.enemies).toHaveLength(1);
    expect(sim.state.enemies[0]!.angry).toBe(true);
  });

  it('empty bubbles self-pop with no score', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    sim.tick([Button.B]);
    run(sim, C.BUBBLE_LIFETIME_TICKS + 1, 0);
    expect(sim.state.bubbles).toHaveLength(0);
    expect(sim.state.players[0]!.score).toBe(0);
  });

  it('chain pops double the score per enemy up to the cap', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const p = sim.state.players[0]!;
    // Five full bubbles in a tight cluster on the player.
    for (let i = 0; i < 5; i++) {
      sim.state.bubbles.push({
        id: 800 + i,
        x: p.x + i * 4 * SUBPX,
        y: p.y,
        dir: 1,
        age: 30,
        blowLeft: 0,
        restY: p.y,
        trapped: 'grumble',
        trappedAngry: false,
        trapAge: 1,
      });
    }
    sim.tick([0]);
    expect(sim.state.bubbles).toHaveLength(0);
    // 1000+2000+4000+8000+8000 (cap), plus whatever fruit got auto-collected.
    const popScore = 1000 + 2000 + 4000 + 8000 + 8000;
    expect(p.score).toBeGreaterThanOrEqual(popScore);
    const droppedFruit = sim.state.fruit.filter((f) => f.id !== 999).length;
    expect(droppedFruit + (p.score - popScore) / C.SCORE_FRUIT_GRUMBLE).toBe(5);
  });
});

describe('lives, levels, game over', () => {
  it('enemy contact costs a life and respawns with invulnerability', () => {
    const sim = new BubbleBuddiesSim(1);
    const p = sim.state.players[0]!;
    sim.state.enemies = [grumbleAt(Math.floor(p.x / SUBPX))];
    sim.tick([0]);
    expect(sim.state.mode).toBe('death');
    expect(sim.state.lives).toBe(C.PLAYER_START_LIVES - 1);
    run(sim, C.DEATH_PAUSE_TICKS, 0);
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.players[0]!.invuln).toBeGreaterThan(0);
  });

  it('clearing all enemies and fruit advances to the next level', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    sim.tick([0]);
    expect(sim.state.mode).toBe('levelclear');
    run(sim, C.LEVEL_CLEAR_PAUSE_TICKS, 0);
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.level).toBe(1);
    expect(sim.state.enemies).toHaveLength(3); // Side Steps has 3 grumbles
  });

  it('clearing level 5 wins; losing the last life ends the game; any key restarts', () => {
    const win = new BubbleBuddiesSim(1, C.LEVEL_COUNT - 1);
    win.state.enemies = [];
    win.tick([0]);
    run(win, C.LEVEL_CLEAR_PAUSE_TICKS, 0);
    expect(win.state.mode).toBe('win');

    const lose = new BubbleBuddiesSim(1);
    lose.state.lives = 1;
    lose.state.enemies = [grumbleAt(Math.floor(lose.state.players[0]!.x / SUBPX))];
    lose.tick([0]);
    run(lose, C.DEATH_PAUSE_TICKS, 0);
    expect(lose.state.mode).toBe('gameover');
    lose.tick([Button.Start]);
    expect(lose.state.mode).toBe('playing');
    expect(lose.state.level).toBe(0);
    expect(lose.state.lives).toBe(C.PLAYER_START_LIVES);
    expect(lose.state.players[0]!.score).toBe(0);
  });

  it('a trapped enemy still counts against level clear', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [grumbleAt(62)];
    sim.tick([Button.B]);
    run(sim, 15, 0);
    expect(sim.state.bubbles[0]!.trapped).toBe('grumble');
    expect(sim.state.mode).toBe('playing');
  });
});

describe('multiplayer (§11)', () => {
  /** Level 1 `P` is at tile (3, 21); spawn x for a slot at P+offset tiles. */
  const slotSpawnX = (offset: number): number =>
    ((3 + offset) * C.TILE_SIZE + C.TILE_SIZE / 2 - C.PLAYER_HITBOX_W / 2) * SUBPX;

  it('spawns players at the per-slot offsets', () => {
    const sim = new BubbleBuddiesSim(1, 0, 4);
    const xs = sim.state.players.map((p) => p!.x);
    expect(xs).toEqual(C.PLAYER_SPAWN_OFFSETS.map((o) => slotSpawnX(o)));
    expect(sim.state.reviveRules).toBe(true);
  });

  it('solo games keep classic rules; a solo game serializes in the v1 shape', () => {
    const sim = new BubbleBuddiesSim(1);
    expect(sim.state.reviveRules).toBe(false);
    const parsed = JSON.parse(sim.serialize()) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'mode', 'modeTicks', 'level', 'score', 'lives', 'extraLifeAwarded',
      'tick', 'rng', 'nextId', 'prevInput', 'player', 'bubbles', 'enemies', 'fruit',
    ]);
    expect(Object.keys(parsed['player'] as object)).toEqual([
      'x', 'y', 'vy', 'facing', 'grounded', 'blowCooldown', 'invuln',
    ]);
  });

  it('with 2+ players a death becomes a rescue bubble and a teammate revives it', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    const [p0, p1] = [sim.state.players[0]!, sim.state.players[1]!];
    sim.state.enemies = [grumbleAt(Math.floor(p1.x / SUBPX))];
    holdLevelOpen(sim);
    sim.tick([0, 0]);
    expect(p1.phase).toBe('bubble');
    expect(sim.state.mode).toBe('playing'); // game continues, no lives lost
    expect(sim.state.lives).toBe(C.PLAYER_START_LIVES);

    sim.state.enemies = [];
    runM(sim, 20, [0, 0]); // rescue bubble drifts up
    expect(p1.y).toBeLessThan(p0.y);

    p0.x = p1.x;
    p0.y = p1.y;
    const bubbleY = p1.y;
    sim.tick([0, 0]);
    expect(p1.phase).toBe('alive');
    expect(p1.invuln).toBe(C.RESCUE_POP_INVULN_TICKS);
    expect(Math.abs(p1.y - bubbleY)).toBeLessThanOrEqual(C.MAX_FALL_SPEED);
  });

  it('game over only when every active player is a rescue bubble; any press restarts', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    holdLevelOpen(sim);
    sim.state.enemies = [grumbleAt(30)]; // overlaps both spawn positions
    sim.tick([0, 0]);
    expect(sim.state.players[0]!.phase).toBe('bubble');
    expect(sim.state.players[1]!.phase).toBe('bubble');
    expect(sim.state.mode).toBe('gameover');

    sim.tick([Button.Start, 0]);
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.players[0]!.phase).toBe('alive');
    expect(sim.state.players[1]!.phase).toBe('alive');
    expect(sim.state.players.map((p) => p?.score ?? 0)).toEqual([0, 0, 0, 0]);
  });

  it('mid-level joiners spectate, then spawn at the next level load (revive rules on)', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.tick([0]);
    sim.joinPlayer(1);
    const p1 = sim.state.players[1]!;
    expect(p1.phase).toBe('pending');
    runM(sim, 10, [0, 0]);
    expect(p1.phase).toBe('pending'); // spectating: not spawned, not updated
    expect(sim.state.reviveRules).toBe(false);

    sim.state.enemies = [];
    sim.state.fruit = [];
    sim.tick([0, 0]); // level clear
    runM(sim, C.LEVEL_CLEAR_PAUSE_TICKS, [0, 0]);
    expect(sim.state.level).toBe(1);
    expect(p1.phase).toBe('alive');
    expect(sim.state.reviveRules).toBe(true);
  });

  it('chain pops credit the popper; fruit credits the collector', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const p1 = sim.state.players[1]!;
    sim.state.bubbles.push({
      id: 800,
      x: p1.x,
      y: p1.y,
      dir: 1,
      age: 30,
      blowLeft: 0,
      restY: p1.y,
      trapped: 'grumble',
      trappedAngry: false,
      trapAge: 1,
    });
    sim.tick([0, 0]);
    // Slot 1 popped the bubble (and auto-collected the fruit at its feet).
    expect(p1.score).toBe(C.SCORE_POP_BASE + C.SCORE_FRUIT_GRUMBLE);
    expect(sim.state.players[0]!.score).toBe(0);
  });

  it('a slot with no inputs for the grace period despawns (rescue bubble too)', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    holdLevelOpen(sim);
    const p1 = sim.state.players[1]!;
    sim.state.enemies = [grumbleAt(Math.floor(p1.x / SUBPX))];
    sim.tick([0, 0]);
    expect(p1.phase).toBe('bubble');
    sim.state.enemies = [];

    runM(sim, C.DISCONNECT_GRACE_TICKS, [0, null]);
    expect(p1.phase).toBe('despawned');
    // Game-over evaluation ignores despawned slots: slot 0 plays on alone.
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.players[0]!.phase).toBe('alive');
  });

  it('a despawn leaving only rescue bubbles active triggers game over', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    holdLevelOpen(sim);
    const p0 = sim.state.players[0]!;
    sim.state.enemies = [grumbleAt(Math.floor(p0.x / SUBPX))];
    sim.tick([0, 0]);
    expect(p0.phase).toBe('bubble');
    expect(sim.state.mode).toBe('playing');
    sim.state.enemies = [];

    runM(sim, C.DISCONNECT_GRACE_TICKS, [0, null]);
    expect(sim.state.players[1]!.phase).toBe('despawned');
    expect(sim.state.mode).toBe('gameover');
  });

  it('rejoin reactivates a despawned slot at its offset, score kept, invulnerable', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const p1 = sim.state.players[1]!;
    p1.score = 1500;
    runM(sim, C.DISCONNECT_GRACE_TICKS, [0, null]);
    expect(p1.phase).toBe('despawned');

    sim.rejoinPlayer(1);
    expect(p1.phase).toBe('alive');
    expect(p1.score).toBe(1500);
    expect(p1.invuln).toBe(C.RESCUE_POP_INVULN_TICKS);
    expect(p1.x).toBe(slotSpawnX(C.PLAYER_SPAWN_OFFSETS[1]!));
  });

  it('rescue bubbles auto-pop (revive) on level clear', () => {
    const sim = new BubbleBuddiesSim(1, 0, 2);
    holdLevelOpen(sim);
    const p1 = sim.state.players[1]!;
    sim.state.enemies = [grumbleAt(Math.floor(p1.x / SUBPX))];
    sim.tick([0, 0]);
    expect(p1.phase).toBe('bubble');

    sim.state.enemies = [];
    sim.state.fruit = [];
    sim.tick([0, 0]); // level clears
    expect(sim.state.mode).toBe('levelclear');
    expect(p1.phase).toBe('alive');
    expect(p1.invuln).toBe(C.RESCUE_POP_INVULN_TICKS);
  });

  it('snapshot/restore is lossless and resumes deterministically', () => {
    const log: [SlotInputs, number][] = [
      [[Button.Right, Button.Left, 0, Button.A], 90],
      [[Button.B, Button.B, Button.Right, 0], 2],
      [[0, 0, 0, null], 200],
      [[Button.Left | Button.A, Button.Right, Button.B, null], 60],
    ];
    const a = new BubbleBuddiesSim(0xfeed, 0, 4);
    for (const [inputs, count] of log) runM(a, count, inputs);

    const b = new BubbleBuddiesSim(0, 0, 1);
    b.restore(a.snapshot());
    expect(b.serialize()).toBe(a.serialize());

    for (const [inputs, count] of log) {
      runM(a, count, inputs);
      runM(b, count, inputs);
    }
    expect(b.serialize()).toBe(a.serialize());
    expect(b.hash()).toBe(a.hash());
  });
});

describe('determinism', () => {
  // A long scripted session: roaming, jumping, blowing bubbles. Long enough
  // (~45s) for grumbles to hit ledges and consume RNG.
  const LOG: [number, number][] = [
    [Button.Right, 90],
    [Button.Right | Button.A, 20],
    [Button.Right, 40],
    [Button.B, 2],
    [0, 60],
    [Button.Left | Button.A, 30],
    [Button.Left, 120],
    [Button.B, 2],
    [0, 120],
    [Button.Right | Button.B, 2],
    [Button.Right, 200],
    [Button.A, 20],
    [0, 300],
    [Button.Left, 150],
    [Button.B, 2],
    [0, 600],
    [Button.Right | Button.A, 60],
    [0, 900],
  ];

  it('same seed + same inputs → identical state and hash', () => {
    const a = new BubbleBuddiesSim(0xc0ffee);
    const b = new BubbleBuddiesSim(0xc0ffee);
    replay(a, LOG);
    replay(b, LOG);
    expect(a.serialize()).toBe(b.serialize());
    expect(a.hash()).toBe(b.hash());
  });

  it('a different seed diverges', () => {
    const a = new BubbleBuddiesSim(0xc0ffee);
    const b = new BubbleBuddiesSim(0xdecaf);
    replay(a, LOG);
    replay(b, LOG);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('4-player: same seed + same input streams → identical state and hash', () => {
    const log: [SlotInputs, number][] = [
      [[Button.Right, Button.Left, Button.Right | Button.A, Button.Left | Button.A], 120],
      [[Button.B, 0, Button.B, 0], 2],
      [[0, Button.Right | Button.B, 0, null], 300],
      [[Button.Left | Button.A, 0, Button.Right, null], 200],
    ];
    const a = new BubbleBuddiesSim(0xc0ffee, 0, 4);
    const b = new BubbleBuddiesSim(0xc0ffee, 0, 4);
    for (const [inputs, count] of log) {
      runM(a, count, inputs);
      runM(b, count, inputs);
    }
    expect(a.serialize()).toBe(b.serialize());
    expect(a.hash()).toBe(b.hash());
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button, SUBPX, replay } from '@retro-recall/retrokit/sim';
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
  for (let i = 0; i < ticks; i++) sim.tick(input);
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
    const startX = sim.state.player.x;
    run(sim, 10, Button.Right);
    expect(sim.state.player.x).toBe(startX + 10 * C.PLAYER_WALK_SPEED);
    expect(sim.state.player.facing).toBe(1);
    run(sim, 60, Button.Left); // more than enough to reach the left wall
    expect(Math.floor(sim.state.player.x / SUBPX)).toBe(C.TILE_SIZE); // flush with left wall
  });

  it('jumps only from the ground and clears a 4-tile layer', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const startY = sim.state.player.y;
    sim.tick(Button.A);
    expect(sim.state.player.vy).toBeLessThan(0);
    let peak = startY;
    for (let i = 0; i < 80; i++) {
      sim.tick(0);
      peak = Math.min(peak, sim.state.player.y);
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
    sim.tick(0);
    sim.tick(Button.B); // re-press while still cooling down
    expect(sim.state.bubbles).toHaveLength(1);
    run(sim, C.BLOW_COOLDOWN_TICKS, 0);
    sim.tick(Button.B);
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
    sim.tick(Button.B);
    run(sim, 15, 0);
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.bubbles).toHaveLength(1);
    expect(sim.state.bubbles[0]!.trapped).toBe('grumble');
  });

  it('float-phase bubble does not trap', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    sim.tick(Button.B);
    run(sim, C.BUBBLE_BLOW_TICKS + 5, 0); // bubble now floating upward, empty
    const bubble = sim.state.bubbles[0]!;
    sim.state.enemies = [grumbleAt(62, 901)];
    sim.state.enemies[0]!.x = bubble.x;
    sim.state.enemies[0]!.y = bubble.y;
    sim.tick(0);
    expect(sim.state.bubbles[0]!.trapped).toBeNull();
    expect(sim.state.enemies).toHaveLength(1);
  });

  it('popping a full bubble kills the enemy into fruit and scores', () => {
    const sim = trapSetup();
    sim.tick(Button.B);
    run(sim, 15, 0);
    const b = sim.state.bubbles[0]!;
    sim.state.player.x = b.x;
    sim.state.player.y = b.y;
    sim.tick(0);
    expect(sim.state.bubbles).toHaveLength(0);
    // Fruit spawns at the bubble and is collected on contact immediately.
    expect(sim.state.fruit).toHaveLength(0);
    expect(sim.state.score).toBe(C.SCORE_POP_BASE + C.SCORE_FRUIT_GRUMBLE);
  });

  it('trapped enemy escapes angry after TRAP_ESCAPE_TICKS', () => {
    const sim = trapSetup();
    sim.tick(Button.B);
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
    sim.tick(Button.B);
    run(sim, C.BUBBLE_LIFETIME_TICKS + 1, 0);
    expect(sim.state.bubbles).toHaveLength(0);
    expect(sim.state.score).toBe(0);
  });

  it('chain pops double the score per enemy up to the cap', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    holdLevelOpen(sim);
    const p = sim.state.player;
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
    sim.tick(0);
    expect(sim.state.bubbles).toHaveLength(0);
    // 1000+2000+4000+8000+8000 (cap), plus whatever fruit got auto-collected.
    const popScore = 1000 + 2000 + 4000 + 8000 + 8000;
    expect(sim.state.score).toBeGreaterThanOrEqual(popScore);
    const droppedFruit = sim.state.fruit.filter((f) => f.id !== 999).length;
    expect(droppedFruit + (sim.state.score - popScore) / C.SCORE_FRUIT_GRUMBLE).toBe(5);
  });
});

describe('lives, levels, game over', () => {
  it('enemy contact costs a life and respawns with invulnerability', () => {
    const sim = new BubbleBuddiesSim(1);
    const p = sim.state.player;
    sim.state.enemies = [grumbleAt(Math.floor(p.x / SUBPX))];
    sim.tick(0);
    expect(sim.state.mode).toBe('death');
    expect(sim.state.lives).toBe(C.PLAYER_START_LIVES - 1);
    run(sim, C.DEATH_PAUSE_TICKS, 0);
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.player.invuln).toBeGreaterThan(0);
  });

  it('clearing all enemies and fruit advances to the next level', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [];
    sim.tick(0);
    expect(sim.state.mode).toBe('levelclear');
    run(sim, C.LEVEL_CLEAR_PAUSE_TICKS, 0);
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.level).toBe(1);
    expect(sim.state.enemies).toHaveLength(3); // Side Steps has 3 grumbles
  });

  it('clearing level 5 wins; losing the last life ends the game; any key restarts', () => {
    const win = new BubbleBuddiesSim(1, C.LEVEL_COUNT - 1);
    win.state.enemies = [];
    win.tick(0);
    run(win, C.LEVEL_CLEAR_PAUSE_TICKS, 0);
    expect(win.state.mode).toBe('win');

    const lose = new BubbleBuddiesSim(1);
    lose.state.lives = 1;
    lose.state.enemies = [grumbleAt(Math.floor(lose.state.player.x / SUBPX))];
    lose.tick(0);
    run(lose, C.DEATH_PAUSE_TICKS, 0);
    expect(lose.state.mode).toBe('gameover');
    lose.tick(Button.Start);
    expect(lose.state.mode).toBe('playing');
    expect(lose.state.level).toBe(0);
    expect(lose.state.lives).toBe(C.PLAYER_START_LIVES);
    expect(lose.state.score).toBe(0);
  });

  it('a trapped enemy still counts against level clear', () => {
    const sim = new BubbleBuddiesSim(1);
    sim.state.enemies = [grumbleAt(62)];
    sim.tick(Button.B);
    run(sim, 15, 0);
    expect(sim.state.bubbles[0]!.trapped).toBe('grumble');
    expect(sim.state.mode).toBe('playing');
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
});

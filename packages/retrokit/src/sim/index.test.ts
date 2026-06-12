import { describe, expect, it } from 'vitest';
import {
  Button,
  Rng,
  SUBPX,
  Tile,
  TileMap,
  TICKS_PER_SECOND,
  aabbOverlap,
  fnv1a,
  isSupported,
  moveAABB,
  replay,
  type GameSim,
  type SlotInputs,
} from './index';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('round-trips through serialized state', () => {
    const a = new Rng(99);
    a.next();
    a.next();
    const b = Rng.fromState(a.state());
    expect(b.next()).toBe(a.next());
  });

  it('never gets stuck at zero seed', () => {
    const r = new Rng(0);
    expect(r.next()).not.toBe(0);
  });
});

describe('fnv1a', () => {
  it('matches known reference values', () => {
    // Reference FNV-1a 32-bit values.
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('tilemap', () => {
  const rows = [
    '####',
    '#..#',
    '#==P',
    '####',
  ];

  it('parses tiles and spawn markers', () => {
    const { map, spawns } = TileMap.parse(rows, 8);
    expect(map.at(0, 0)).toBe(Tile.Solid);
    expect(map.at(1, 1)).toBe(Tile.Empty);
    expect(map.at(1, 2)).toBe(Tile.Platform);
    expect(spawns).toEqual([{ char: 'P', tx: 3, ty: 2 }]);
  });

  it('treats out-of-bounds as solid', () => {
    const { map } = TileMap.parse(rows, 8);
    expect(map.at(-1, 0)).toBe(Tile.Solid);
    expect(map.at(0, 99)).toBe(Tile.Solid);
  });
});

describe('physics', () => {
  // 8 tiles wide, 8 tall, tileSize 8: walls around, platform row at y=4.
  const { map } = TileMap.parse([
    '########',
    '#......#',
    '#......#',
    '#......#',
    '#..==..#',
    '#......#',
    '#......#',
    '########',
  ], 8);

  it('clamps horizontal movement at walls', () => {
    // 8×8 box at x=40px moving right 2px/tick toward the wall at x=56.
    const res = moveAABB(map, 40 * SUBPX, 16 * SUBPX, 8, 8, 2 * SUBPX, 0);
    expect(res.x).toBe(42 * SUBPX);
    const blocked = moveAABB(map, 47 * SUBPX, 16 * SUBPX, 8, 8, 2 * SUBPX, 0);
    expect(blocked.x).toBe(48 * SUBPX); // flush against wall tile at tx=7
    expect(blocked.hitX).toBe(true);
  });

  it('lands on solid ground', () => {
    const res = moveAABB(map, 8 * SUBPX, 47 * SUBPX, 8, 8, 0, 2 * SUBPX);
    expect(res.y).toBe(48 * SUBPX); // resting on floor row at y=56
    expect(res.grounded).toBe(true);
    expect(res.hitY).toBe(true);
  });

  it('lands on a one-way platform only from above', () => {
    // Falling onto the platform at ty=4 (top y=32): box bottom approaches from above.
    const falling = moveAABB(map, 24 * SUBPX, 23 * SUBPX, 8, 8, 0, 2 * SUBPX);
    expect(falling.y).toBe(24 * SUBPX); // clamped so bottom sits at 32
    expect(falling.grounded).toBe(true);
    // Rising through the same platform from below passes freely.
    const rising = moveAABB(map, 24 * SUBPX, 34 * SUBPX, 8, 8, 0, -2 * SUBPX);
    expect(rising.y).toBe(32 * SUBPX);
    expect(rising.hitY).toBe(false);
    // And falling from below the platform top does not snap up onto it.
    const inside = moveAABB(map, 24 * SUBPX, 30 * SUBPX, 8, 8, 0, 2 * SUBPX);
    expect(inside.y).toBe(32 * SUBPX);
    expect(inside.grounded).toBe(false);
  });

  it('ignores platforms when solidOnly', () => {
    const res = moveAABB(map, 24 * SUBPX, 23 * SUBPX, 8, 8, 0, 2 * SUBPX, true);
    expect(res.y).toBe(25 * SUBPX);
    expect(res.grounded).toBe(false);
  });

  it('reports support for a box resting flush with sub-pixel velocity', () => {
    // Resting on the floor (bottom flush at y=48+8=56): tiny gravity does not unground.
    const rest = 48 * SUBPX;
    expect(isSupported(map, 8 * SUBPX, rest, 8, 8)).toBe(true);
    const res = moveAABB(map, 8 * SUBPX, rest, 8, 8, 0, 16);
    expect(res.grounded).toBe(true);
  });

  it('detects AABB overlap in subpixels', () => {
    expect(aabbOverlap(0, 0, 8, 8, 7 * SUBPX, 0, 8, 8)).toBe(true);
    expect(aabbOverlap(0, 0, 8, 8, 8 * SUBPX, 0, 8, 8)).toBe(false);
  });
});

describe('determinism replay', () => {
  /**
   * Mini-sim exercising every determinism-relevant kit feature: physics,
   * RNG draws driven by input, serialization, hashing.
   */
  class MiniSim implements GameSim {
    private readonly map = TileMap.parse([
      '##########',
      '#........#',
      '#..==....#',
      '#........#',
      '##########',
    ], 8).map;
    private rng: Rng;
    private x = 12 * SUBPX;
    private y = 8 * SUBPX;
    private vy = 0;
    private score = 0;
    private t = 0;

    constructor(seed: number) {
      this.rng = new Rng(seed);
    }

    tick(inputs: SlotInputs): void {
      const input = inputs[0] ?? 0;
      const vx = (input & Button.Right ? 192 : 0) - (input & Button.Left ? 192 : 0);
      this.vy = Math.min(this.vy + 16, 512);
      const res = moveAABB(this.map, this.x, this.y, 8, 8, vx, this.vy);
      this.x = res.x;
      this.y = res.y;
      if (res.grounded) {
        this.vy = 0;
        if (input & Button.A) this.vy = -300;
      }
      if (input & Button.B) this.score += this.rng.int(100);
      this.t++;
    }

    serialize(): string {
      return JSON.stringify({
        t: this.t,
        x: this.x,
        y: this.y,
        vy: this.vy,
        score: this.score,
        rng: this.rng.state(),
      });
    }

    hash(): number {
      return fnv1a(this.serialize());
    }
  }

  it('same input log produces identical state hashes', () => {
    // A scripted input log mixing movement, jumps, and RNG-consuming actions.
    const log: [number, number][] = [
      [Button.Right, 30],
      [Button.Right | Button.A, 10],
      [0, 20],
      [Button.Left | Button.B, 25],
      [Button.A | Button.B, 15],
      [Button.Left, 40],
    ];
    const a = new MiniSim(42);
    const b = new MiniSim(42);
    replay(a, log);
    replay(b, log);
    expect(a.hash()).toBe(b.hash());
    expect(a.serialize()).toBe(b.serialize());

    // A different seed must diverge (sanity that the hash sees the state).
    const c = new MiniSim(43);
    replay(c, log);
    expect(c.hash()).not.toBe(a.hash());
  });

  it('ticks are stable across interleaving (no hidden frame state)', () => {
    const a = new MiniSim(7);
    const b = new MiniSim(7);
    const inputs = Array.from({ length: 120 }, (_, i) =>
      (i % 3 === 0 ? Button.Right : 0) | (i % 17 === 0 ? Button.A : 0) | (i % 5 === 0 ? Button.B : 0),
    );
    for (const bits of inputs) a.tick([bits]);
    // b replays the same inputs but hashes after every tick.
    const hashes: number[] = [];
    for (const bits of inputs) {
      b.tick([bits]);
      hashes.push(b.hash());
    }
    expect(b.hash()).toBe(a.hash());
    expect(hashes.at(-1)).toBe(a.hash());
  });

  it('runs at the canonical 60Hz tick rate', () => {
    expect(TICKS_PER_SECOND).toBe(60);
  });
});

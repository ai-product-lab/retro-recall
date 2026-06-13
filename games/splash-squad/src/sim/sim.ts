/**
 * Splash Squad — deterministic sim, scaffolded by `pnpm new-game`.
 *
 * A minimal but real starting point: up to four hero boxes that walk and jump
 * on a small tilemap, with seeded RNG, stable serialization, and the full
 * NetSim contract the rooms server needs. Build the real game on top of this
 * per games/splash-squad/SPEC.md.
 *
 * Determinism rules (lint-enforced in src/sim/): integer / fixed-point math
 * only, all randomness from `this.rng`, no DOM / wall-clock / network.
 */
import {
  Button,
  Rng,
  SUBPX,
  TileMap,
  fnv1a,
  isSupported,
  moveAABB,
  type GameSim,
  type InputBits,
  type SlotInputs,
} from '@retro-recall/retrokit/sim';
import * as C from './constants';

export interface HeroState {
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  prevInput: number;
}

export interface GameState {
  tick: number;
  /** NetSim requires a string mode field. */
  mode: string;
  rng: number;
  /** Indexed by slot 0–3; null = slot never joined. */
  players: (HeroState | null)[];
}

// 16×8 tiles (128×64 px). `#` solid border + floor, `=` a platform to land on.
const LEVEL = [
  '################',
  '#..............#',
  '#..............#',
  '#.....====.....#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

export class SplashSquadSim implements GameSim {
  state: GameState;
  private readonly map: TileMap;
  private rng: Rng;

  constructor(seed: number) {
    this.map = TileMap.parse(LEVEL, C.TILE_SIZE).map;
    this.rng = new Rng(seed);
    this.state = {
      tick: 0,
      mode: 'playing',
      rng: this.rng.state(),
      players: [null, null, null, null],
    };
  }

  // --- NetSim player lifecycle ---

  joinPlayer(slot: number): void {
    if (slot < 0 || slot >= C.MAX_PLAYERS) throw new Error('bad slot ' + slot);
    if (this.state.players[slot]) return;
    this.state.players[slot] = {
      x: (C.SPAWN_TX + slot) * C.TILE_SIZE * SUBPX,
      y: C.SPAWN_TY * C.TILE_SIZE * SUBPX,
      vy: 0,
      facing: 1,
      grounded: false,
      prevInput: 0,
    };
  }

  rejoinPlayer(slot: number): void {
    if (!this.state.players[slot]) this.joinPlayer(slot);
  }

  // --- Tick ---

  tick(inputs: SlotInputs): void {
    const st = this.state;
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p) continue;
      const input = inputs[slot] ?? 0;
      this.updateHero(p, input);
      p.prevInput = input;
    }
    st.rng = this.rng.state();
    st.tick++;
  }

  private updateHero(p: HeroState, input: InputBits): void {
    let vx = 0;
    if (input & Button.Left) {
      vx = -C.WALK_SPEED;
      p.facing = -1;
    } else if (input & Button.Right) {
      vx = C.WALK_SPEED;
      p.facing = 1;
    }

    const supported = p.vy >= 0 && isSupported(this.map, p.x, p.y, C.HERO_W, C.HERO_H);
    if (supported) {
      p.vy = 0;
      if (input & Button.A) p.vy = C.JUMP_VELOCITY;
    } else {
      p.vy = Math.min(p.vy + C.GRAVITY, C.MAX_FALL);
    }

    const res = moveAABB(this.map, p.x, p.y, C.HERO_W, C.HERO_H, vx, p.vy);
    p.x = res.x;
    p.y = res.y;
    if (res.hitY) p.vy = 0;
    p.grounded = res.grounded;
  }

  // --- GameSim / NetSim serialization ---

  serialize(): string {
    return JSON.stringify(this.state);
  }

  hash(): number {
    return fnv1a(this.serialize());
  }

  snapshot(): string {
    return JSON.stringify(this.state);
  }

  restore(json: string): void {
    this.state = JSON.parse(json) as GameState;
    this.rng = Rng.fromState(this.state.rng);
  }
}

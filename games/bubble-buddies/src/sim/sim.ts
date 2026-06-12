import {
  Button,
  Rng,
  SUBPX,
  TileMap,
  Tile,
  aabbOverlap,
  fnv1a,
  isSupported,
  moveAABB,
  type GameSim,
  type InputBits,
} from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { LEVELS } from './levels';

export type Mode = 'playing' | 'death' | 'levelclear' | 'gameover' | 'win';
export type EnemyKind = 'grumble' | 'flitter';

export interface PlayerState {
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  blowCooldown: number;
  invuln: number;
}

export interface BubbleState {
  id: number;
  x: number;
  y: number;
  dir: 1 | -1;
  age: number;
  /** Ticks left in the blow phase; 0 means floating. */
  blowLeft: number;
  /** Base y once resting under a ceiling; -1 while still rising. */
  restY: number;
  trapped: EnemyKind | null;
  trappedAngry: boolean;
  trapAge: number;
}

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  /** Flitter vertical direction. */
  dy: 1 | -1;
  angry: boolean;
  /** Tile of the last ledge RNG decision; -1 when not at a ledge. */
  ledgeTile: number;
}

export interface FruitState {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vy: number;
  age: number;
}

export interface GameState {
  mode: Mode;
  modeTicks: number;
  level: number;
  score: number;
  lives: number;
  extraLifeAwarded: boolean;
  tick: number;
  rng: number;
  nextId: number;
  prevInput: number;
  player: PlayerState;
  bubbles: BubbleState[];
  enemies: EnemyState[];
  fruit: FruitState[];
}

const angrySpeed = (base: number): number =>
  Math.floor((base * C.ANGRY_SPEED_NUM) / C.ANGRY_SPEED_DEN);

/** Triangle-wave bob offset in subpixels, 0..2·amplitude below rest. */
const bobOffset = (age: number): number => {
  const half = C.BUBBLE_BOB_PERIOD / 2;
  const p = age % C.BUBBLE_BOB_PERIOD;
  const tri = p < half ? p : C.BUBBLE_BOB_PERIOD - p; // 0..half..0
  return (tri * C.BUBBLE_BOB_AMPLITUDE * SUBPX) / half;
};

interface ParsedLevel {
  map: TileMap;
  playerSpawn: { tx: number; ty: number };
  enemySpawns: { kind: EnemyKind; tx: number; ty: number }[];
}

const parseLevel = (index: number): ParsedLevel => {
  const def = LEVELS[index];
  if (!def) throw new Error(`no level ${index}`);
  const { map, spawns } = TileMap.parse(def.rows, C.TILE_SIZE);
  let playerSpawn: { tx: number; ty: number } | undefined;
  const enemySpawns: ParsedLevel['enemySpawns'] = [];
  for (const s of spawns) {
    if (s.char === 'P') playerSpawn = { tx: s.tx, ty: s.ty };
    else if (s.char === 'G') enemySpawns.push({ kind: 'grumble', tx: s.tx, ty: s.ty });
    else if (s.char === 'F') enemySpawns.push({ kind: 'flitter', tx: s.tx, ty: s.ty });
    else throw new Error(`unknown spawn marker '${s.char}' in level ${index}`);
  }
  if (!playerSpawn) throw new Error(`level ${index} has no player spawn`);
  return { map, playerSpawn, enemySpawns };
};

/** Marker tile → hitbox top-left subpixel position (bottom-centered, per spec §2). */
const spawnPos = (tx: number, ty: number, w: number, h: number): { x: number; y: number } => ({
  x: (tx * C.TILE_SIZE + Math.floor(C.TILE_SIZE / 2) - Math.floor(w / 2)) * SUBPX,
  y: ((ty + 1) * C.TILE_SIZE - h) * SUBPX,
});

export class BubbleBuddiesSim implements GameSim {
  readonly state: GameState;
  private levels: ParsedLevel[];
  private rng: Rng;

  constructor(seed: number, startLevel = 0) {
    this.levels = LEVELS.map((_, i) => parseLevel(i));
    this.rng = new Rng(seed);
    this.state = {
      mode: 'playing',
      modeTicks: 0,
      level: startLevel,
      score: 0,
      lives: C.PLAYER_START_LIVES,
      extraLifeAwarded: false,
      tick: 0,
      rng: this.rng.state(),
      nextId: 1,
      prevInput: 0,
      player: { x: 0, y: 0, vy: 0, facing: 1, grounded: true, blowCooldown: 0, invuln: 0 },
      bubbles: [],
      enemies: [],
      fruit: [],
    };
    this.loadLevel(startLevel);
  }

  get map(): TileMap {
    return this.levels[this.state.level]!.map;
  }

  get levelName(): string {
    return LEVELS[this.state.level]!.name;
  }

  private loadLevel(index: number): void {
    const st = this.state;
    const lvl = this.levels[index]!;
    st.level = index;
    st.bubbles = [];
    st.fruit = [];
    st.enemies = lvl.enemySpawns.map((s) => {
      const pos = spawnPos(s.tx, s.ty, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H);
      return {
        id: st.nextId++,
        kind: s.kind,
        x: pos.x,
        y: pos.y,
        vy: 0,
        facing: -1 as const,
        dy: 1 as const,
        angry: false,
        ledgeTile: -1,
      };
    });
    this.respawnPlayer(false);
    st.mode = 'playing';
    st.modeTicks = 0;
  }

  private respawnPlayer(invulnerable: boolean): void {
    const st = this.state;
    const lvl = this.levels[st.level]!;
    const pos = spawnPos(lvl.playerSpawn.tx, lvl.playerSpawn.ty, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H);
    st.player = {
      x: pos.x,
      y: pos.y,
      vy: 0,
      facing: 1,
      grounded: true,
      blowCooldown: 0,
      invuln: invulnerable ? C.RESPAWN_INVULN_TICKS : 0,
    };
  }

  private restart(): void {
    const st = this.state;
    st.score = 0;
    st.lives = C.PLAYER_START_LIVES;
    st.extraLifeAwarded = false;
    this.loadLevel(0);
  }

  tick(input: InputBits): void {
    const st = this.state;
    const pressed = input & ~st.prevInput;

    switch (st.mode) {
      case 'playing':
        this.updatePlaying(input, pressed);
        break;
      case 'death':
        st.modeTicks--;
        if (st.modeTicks <= 0) {
          if (st.lives > 0) {
            this.respawnPlayer(true);
            st.mode = 'playing';
          } else {
            st.mode = 'gameover';
          }
        }
        break;
      case 'levelclear':
        st.modeTicks--;
        if (st.modeTicks <= 0) {
          if (st.level + 1 < C.LEVEL_COUNT) this.loadLevel(st.level + 1);
          else st.mode = 'win';
        }
        break;
      case 'gameover':
      case 'win':
        if (pressed !== 0) this.restart();
        break;
    }

    st.prevInput = input;
    st.rng = this.rng.state();
    st.tick++;
  }

  private updatePlaying(input: InputBits, pressed: number): void {
    this.updatePlayer(input, pressed);
    this.updateBubbles();
    this.updateEnemies();
    this.updateFruit();
    this.resolveContacts();
    this.checkLevelClear();
  }

  // --- Player (spec §3) ---

  private updatePlayer(input: InputBits, pressed: number): void {
    const st = this.state;
    const p = st.player;
    const map = this.map;

    if (p.blowCooldown > 0) p.blowCooldown--;
    if (p.invuln > 0) p.invuln--;

    let vx = 0;
    if (input & Button.Left) {
      vx = -C.PLAYER_WALK_SPEED;
      p.facing = -1;
    } else if (input & Button.Right) {
      vx = C.PLAYER_WALK_SPEED;
      p.facing = 1;
    }

    const supported =
      p.vy >= 0 && isSupported(map, p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H);
    if (supported) {
      p.vy = 0;
      if (input & Button.A) p.vy = C.PLAYER_JUMP_VELOCITY;
    } else {
      p.vy = Math.min(p.vy + C.GRAVITY, C.MAX_FALL_SPEED);
    }

    const res = moveAABB(map, p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H, vx, p.vy);
    p.x = res.x;
    p.y = res.y;
    if (res.hitY) p.vy = 0;
    p.grounded = res.grounded;

    if (pressed & Button.B && p.blowCooldown <= 0) {
      const bx =
        p.facing === 1
          ? p.x + (C.PLAYER_HITBOX_W + 1) * SUBPX
          : p.x - (C.BUBBLE_HITBOX + 1) * SUBPX;
      st.bubbles.push({
        id: st.nextId++,
        x: bx,
        y: p.y,
        dir: p.facing,
        age: 0,
        blowLeft: C.BUBBLE_BLOW_TICKS,
        restY: -1,
        trapped: null,
        trappedAngry: false,
        trapAge: 0,
      });
      p.blowCooldown = C.BLOW_COOLDOWN_TICKS;
    }
  }

  // --- Bubbles (spec §4) ---

  private updateBubbles(): void {
    const st = this.state;
    const map = this.map;
    const kept: BubbleState[] = [];

    for (const b of st.bubbles) {
      b.age++;

      if (b.blowLeft > 0) {
        // Blow phase: horizontal travel, the only phase that traps.
        b.blowLeft--;
        const res = moveAABB(
          map, b.x, b.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX, b.dir * C.BUBBLE_BLOW_SPEED, 0, true,
        );
        b.x = res.x;
        b.y = res.y;
        if (res.hitX) b.blowLeft = 0;

        if (b.trapped === null) {
          for (const e of st.enemies) {
            if (
              aabbOverlap(
                b.x, b.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX,
                e.x, e.y, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H,
              )
            ) {
              b.trapped = e.kind;
              b.trappedAngry = e.angry;
              b.blowLeft = 0;
              st.enemies = st.enemies.filter((other) => other.id !== e.id);
              break;
            }
          }
        }
      } else if (b.restY < 0) {
        // Float phase: rise through everything but solids.
        const res = moveAABB(
          map, b.x, b.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX, 0, C.BUBBLE_FLOAT_SPEED, true,
        );
        b.x = res.x;
        b.y = res.y;
        if (res.hitY) b.restY = res.y;
      } else {
        // Resting: bob on a triangle wave just below the ceiling.
        b.y = b.restY + bobOffset(b.age);
      }

      if (b.trapped !== null) {
        b.trapAge++;
        if (b.trapAge >= C.TRAP_ESCAPE_TICKS) {
          // Escape: enemy breaks out angry; the bubble is gone.
          st.enemies.push(this.escapedEnemy(b));
          continue;
        }
      } else if (b.age >= C.BUBBLE_LIFETIME_TICKS) {
        continue; // empty bubble self-pops, no score
      }

      kept.push(b);
    }

    st.bubbles = kept;
  }

  private escapedEnemy(b: BubbleState): EnemyState {
    return {
      id: this.state.nextId++,
      kind: b.trapped!,
      x: b.x,
      y: b.y,
      vy: 0,
      facing: -1,
      dy: 1,
      angry: true,
      ledgeTile: -1,
    };
  }

  // --- Enemies (spec §5) ---

  private updateEnemies(): void {
    for (const e of this.state.enemies) {
      if (e.kind === 'grumble') this.updateGrumble(e);
      else this.updateFlitter(e);
    }
  }

  private updateGrumble(e: EnemyState): void {
    const map = this.map;
    const speed = e.angry ? angrySpeed(C.GRUMBLE_WALK_SPEED) : C.GRUMBLE_WALK_SPEED;
    const supported = e.vy >= 0 && isSupported(map, e.x, e.y, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H);
    let vx = e.facing * speed;

    if (supported) {
      e.vy = 0;
      // Ledge check: is there support under the leading edge after this step?
      const nx = e.x + vx;
      const frontPx =
        e.facing === 1
          ? Math.floor(nx / SUBPX) + C.ENEMY_HITBOX_W - 1
          : Math.floor(nx / SUBPX);
      const footRow = Math.floor((Math.floor(e.y / SUBPX) + C.ENEMY_HITBOX_H) / C.TILE_SIZE);
      const frontTile = Math.floor(frontPx / C.TILE_SIZE);
      const ahead = map.at(frontTile, footRow);
      const supportAhead = ahead === Tile.Solid || ahead === Tile.Platform;
      if (supportAhead) {
        e.ledgeTile = -1;
      } else if (e.ledgeTile !== frontTile) {
        e.ledgeTile = frontTile;
        if (this.rng.chance(C.GRUMBLE_EDGE_TURN_NUM, C.GRUMBLE_EDGE_TURN_DEN)) {
          e.facing = e.facing === 1 ? -1 : 1;
          vx = 0; // turn in place this tick
        }
      }
    } else {
      e.vy = Math.min(e.vy + C.GRAVITY, C.MAX_FALL_SPEED);
    }

    const res = moveAABB(map, e.x, e.y, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H, vx, e.vy);
    e.x = res.x;
    e.y = res.y;
    if (res.hitY) e.vy = 0;
    if (res.hitX) e.facing = e.facing === 1 ? -1 : 1;
  }

  private updateFlitter(e: EnemyState): void {
    const speed = e.angry ? angrySpeed(C.FLITTER_SPEED) : C.FLITTER_SPEED;
    const res = moveAABB(
      this.map, e.x, e.y, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H,
      e.facing * speed, e.dy * speed, true,
    );
    e.x = res.x;
    e.y = res.y;
    if (res.hitX) e.facing = e.facing === 1 ? -1 : 1;
    if (res.hitY) e.dy = e.dy === 1 ? -1 : 1;
  }

  // --- Fruit (spec §6) ---

  private updateFruit(): void {
    const st = this.state;
    const map = this.map;
    const kept: FruitState[] = [];
    for (const f of st.fruit) {
      f.age++;
      if (f.age >= C.FRUIT_LIFETIME_TICKS) continue;
      const supported = f.vy >= 0 && isSupported(map, f.x, f.y, C.FRUIT_HITBOX, C.FRUIT_HITBOX);
      f.vy = supported ? 0 : Math.min(f.vy + C.GRAVITY, C.MAX_FALL_SPEED);
      const res = moveAABB(map, f.x, f.y, C.FRUIT_HITBOX, C.FRUIT_HITBOX, 0, f.vy);
      f.x = res.x;
      f.y = res.y;
      if (res.hitY) f.vy = 0;
      kept.push(f);
    }
    st.fruit = kept;
  }

  // --- Pops, collection, and player contact (spec §4, §6) ---

  private resolveContacts(): void {
    const st = this.state;
    const p = st.player;

    // Player touching any bubble pops it, chaining to nearby bubbles.
    const seeds = st.bubbles.filter((b) =>
      aabbOverlap(
        p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
        b.x, b.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX,
      ),
    );
    if (seeds.length > 0) this.popChain(seeds);

    // Collect fruit.
    const remaining: FruitState[] = [];
    for (const f of st.fruit) {
      if (
        aabbOverlap(
          p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
          f.x, f.y, C.FRUIT_HITBOX, C.FRUIT_HITBOX,
        )
      ) {
        this.addScore(f.kind === 'grumble' ? C.SCORE_FRUIT_GRUMBLE : C.SCORE_FRUIT_FLITTER);
      } else {
        remaining.push(f);
      }
    }
    st.fruit = remaining;

    // Enemy contact kills (unless invulnerable).
    if (p.invuln <= 0) {
      for (const e of st.enemies) {
        if (
          aabbOverlap(
            p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
            e.x, e.y, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H,
          )
        ) {
          st.lives--;
          st.mode = 'death';
          st.modeTicks = C.DEATH_PAUSE_TICKS;
          break;
        }
      }
    }
  }

  private popChain(seeds: BubbleState[]): void {
    const st = this.state;
    const popping = new Set<number>(seeds.map((b) => b.id));
    // Transitive chain: bubbles within CHAIN_POP_RADIUS of a popping bubble.
    const r = C.CHAIN_POP_RADIUS;
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of st.bubbles) {
        if (popping.has(b.id)) continue;
        for (const other of st.bubbles) {
          if (!popping.has(other.id)) continue;
          const half = (C.BUBBLE_HITBOX * SUBPX) / 2;
          const dx = Math.floor((b.x + half) / SUBPX) - Math.floor((other.x + half) / SUBPX);
          const dy = Math.floor((b.y + half) / SUBPX) - Math.floor((other.y + half) / SUBPX);
          if (dx * dx + dy * dy <= r * r) {
            popping.add(b.id);
            grew = true;
            break;
          }
        }
      }
    }

    // Score and resolve in ascending bubble-ID order.
    let enemyChain = 0;
    for (const b of st.bubbles) {
      if (!popping.has(b.id)) continue;
      if (b.trapped !== null) {
        enemyChain++;
        const value = Math.min(C.SCORE_POP_BASE * 2 ** (enemyChain - 1), C.SCORE_POP_MAX);
        this.addScore(value);
        st.fruit.push({
          id: st.nextId++,
          kind: b.trapped,
          x: b.x,
          y: b.y,
          vy: 0,
          age: 0,
        });
      } else {
        this.addScore(C.SCORE_POP_EMPTY);
      }
    }
    st.bubbles = st.bubbles.filter((b) => !popping.has(b.id));
  }

  private addScore(points: number): void {
    const st = this.state;
    st.score += points;
    if (!st.extraLifeAwarded && st.score >= C.EXTRA_LIFE_SCORE) {
      st.extraLifeAwarded = true;
      st.lives++;
    }
  }

  // --- Level clear (spec §7) ---

  private checkLevelClear(): void {
    const st = this.state;
    if (st.mode !== 'playing') return;
    const anyTrapped = st.bubbles.some((b) => b.trapped !== null);
    if (st.enemies.length === 0 && !anyTrapped && st.fruit.length === 0) {
      st.mode = 'levelclear';
      st.modeTicks = C.LEVEL_CLEAR_PAUSE_TICKS;
    }
  }

  // --- GameSim contract ---

  serialize(): string {
    return JSON.stringify(this.state);
  }

  hash(): number {
    return fnv1a(this.serialize());
  }
}

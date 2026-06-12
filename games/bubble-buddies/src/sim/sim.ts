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
  type SlotInputs,
} from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { LEVELS } from './levels';

export type Mode = 'playing' | 'death' | 'levelclear' | 'gameover' | 'win';
export type EnemyKind = 'grumble' | 'flitter';

/**
 * Slot lifecycle (spec §11):
 * - `alive`     in play (in classic solo mode this is the only living phase)
 * - `bubble`    downed under revive rules — a rescue bubble a teammate can pop
 * - `pending`   joined mid-level; spectates until the next level loads
 * - `despawned` no inputs for DISCONNECT_GRACE_TICKS; may be reactivated via
 *               rejoinPlayer(), keeping its score
 */
export type PlayerPhase = 'alive' | 'bubble' | 'pending' | 'despawned';

export interface PlayerState {
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  blowCooldown: number;
  invuln: number;
  phase: PlayerPhase;
  score: number;
  /** Rescue bubble rest y once it reaches the ceiling; -1 while rising. */
  restY: number;
  /** Rescue bubble age, for the bob wave. */
  bubbleAge: number;
  /** Consecutive ticks with no input received (disconnect grace counter). */
  idleTicks: number;
  prevInput: number;
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
  /** Classic solo mode only (spec §11: revive rules do not use lives). */
  lives: number;
  extraLifeAwarded: boolean;
  tick: number;
  rng: number;
  nextId: number;
  /** True when ≥2 players were active at the last level load (spec §11). */
  reviveRules: boolean;
  /** Indexed by slot 0–3; null = slot never joined. */
  players: (PlayerState | null)[];
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
  state: GameState;
  private levels: ParsedLevel[];
  private rng: Rng;

  constructor(seed: number, startLevel = 0, playerCount = 1) {
    this.levels = LEVELS.map((_, i) => parseLevel(i));
    this.rng = new Rng(seed);
    this.state = {
      mode: 'playing',
      modeTicks: 0,
      level: startLevel,
      lives: C.PLAYER_START_LIVES,
      extraLifeAwarded: false,
      tick: 0,
      rng: this.rng.state(),
      nextId: 1,
      reviveRules: false,
      players: [null, null, null, null],
      bubbles: [],
      enemies: [],
      fruit: [],
    };
    this.loadLevel(startLevel);
    for (let slot = 0; slot < playerCount; slot++) this.joinPlayer(slot);
  }

  get map(): TileMap {
    return this.levels[this.state.level]!.map;
  }

  get levelName(): string {
    return LEVELS[this.state.level]!.name;
  }

  /** Slots currently in play (alive or downed-as-rescue-bubble). */
  private activeSlots(): number[] {
    const out: number[] = [];
    this.state.players.forEach((p, slot) => {
      if (p && (p.phase === 'alive' || p.phase === 'bubble')) out.push(slot);
    });
    return out;
  }

  // --- Player lifecycle (spec §11) ---

  /**
   * Add a player to a slot. Before the first tick the player spawns active;
   * mid-level joiners spectate (`pending`) until the next level loads.
   */
  joinPlayer(slot: number): void {
    const st = this.state;
    if (slot < 0 || slot >= C.MAX_PLAYERS) throw new Error(`bad slot ${slot}`);
    if (st.players[slot]) throw new Error(`slot ${slot} already joined`);
    st.players[slot] = {
      x: 0,
      y: 0,
      vy: 0,
      facing: 1,
      grounded: true,
      blowCooldown: 0,
      invuln: 0,
      phase: 'pending',
      score: 0,
      restY: -1,
      bubbleAge: 0,
      idleTicks: 0,
      prevInput: 0,
    };
    if (st.tick === 0) {
      this.spawnSlot(slot, 0);
      st.reviveRules = this.activeSlots().length >= 2;
    }
  }

  /**
   * Reactivate a despawned slot after a rejoin (netcode-driven, spec §11):
   * spawn at the slot offset with invulnerability, score kept.
   */
  rejoinPlayer(slot: number): void {
    const p = this.state.players[slot];
    if (!p) {
      this.joinPlayer(slot);
      return;
    }
    p.idleTicks = 0;
    if (p.phase === 'despawned') this.spawnSlot(slot, C.RESCUE_POP_INVULN_TICKS);
  }

  /** Place a slot at its spawn offset, alive. */
  private spawnSlot(slot: number, invuln: number): void {
    const st = this.state;
    const p = st.players[slot]!;
    const lvl = this.levels[st.level]!;
    const tx = Math.min(
      Math.max(lvl.playerSpawn.tx + C.PLAYER_SPAWN_OFFSETS[slot]!, 1),
      C.LEVEL_WIDTH - 2,
    );
    const pos = spawnPos(tx, lvl.playerSpawn.ty, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H);
    p.x = pos.x;
    p.y = pos.y;
    p.vy = 0;
    p.facing = 1;
    p.grounded = true;
    p.blowCooldown = 0;
    p.invuln = invuln;
    p.phase = 'alive';
    p.restY = -1;
    p.bubbleAge = 0;
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
    // All joined, non-despawned slots (including mid-level joiners) spawn in.
    st.players.forEach((p, slot) => {
      if (p && p.phase !== 'despawned') this.spawnSlot(slot, 0);
    });
    st.reviveRules = this.activeSlots().length >= 2;
    st.mode = 'playing';
    st.modeTicks = 0;
  }

  private restart(): void {
    const st = this.state;
    for (const p of st.players) if (p) p.score = 0;
    st.lives = C.PLAYER_START_LIVES;
    st.extraLifeAwarded = false;
    this.loadLevel(0);
  }

  tick(inputs: SlotInputs): void {
    const st = this.state;

    // Resolve per-slot inputs; null (no input received) feeds disconnect grace.
    const bits: number[] = [0, 0, 0, 0];
    const pressed: number[] = [0, 0, 0, 0];
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p) continue;
      const raw = inputs[slot] ?? null;
      if (raw === null) {
        p.idleTicks++;
        if (p.idleTicks >= C.DISCONNECT_GRACE_TICKS && p.phase !== 'despawned') {
          p.phase = 'despawned'; // rescue bubble, if any, despawns with the slot
        }
      } else {
        p.idleTicks = 0;
        bits[slot] = raw;
      }
      pressed[slot] = bits[slot]! & ~p.prevInput;
    }
    this.checkReviveGameOver(); // a despawn can leave only rescue bubbles active

    switch (st.mode) {
      case 'playing':
        this.updatePlaying(bits, pressed);
        break;
      case 'death': {
        // Classic solo mode only: world frozen during the death pause.
        st.modeTicks--;
        if (st.modeTicks <= 0) {
          if (st.lives > 0) {
            const slot = this.activeSlots()[0];
            if (slot !== undefined) this.spawnSlot(slot, C.RESPAWN_INVULN_TICKS);
            st.mode = 'playing';
          } else {
            st.mode = 'gameover';
          }
        }
        break;
      }
      case 'levelclear':
        st.modeTicks--;
        if (st.modeTicks <= 0) {
          if (st.level + 1 < C.LEVEL_COUNT) this.loadLevel(st.level + 1);
          else st.mode = 'win';
        }
        break;
      case 'gameover':
      case 'win':
        if (st.players.some((p, slot) => p && p.phase !== 'despawned' && pressed[slot] !== 0)) {
          this.restart();
        }
        break;
    }

    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (p) p.prevInput = bits[slot]!;
    }
    st.rng = this.rng.state();
    st.tick++;
  }

  private updatePlaying(bits: number[], pressed: number[]): void {
    const st = this.state;
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p) continue;
      if (p.phase === 'alive') this.updateAlivePlayer(p, bits[slot]!, pressed[slot]!);
      else if (p.phase === 'bubble') this.updateRescueBubble(p);
    }
    this.updateBubbles();
    this.updateEnemies();
    this.updateFruit();
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      if (st.mode !== 'playing') break; // a classic-mode death freezes the tick
      const p = st.players[slot];
      if (p && p.phase === 'alive') this.resolveContactsFor(slot, p);
    }
    this.checkReviveGameOver();
    this.checkLevelClear();
  }

  // --- Player (spec §3) ---

  private updateAlivePlayer(p: PlayerState, input: InputBits, pressed: number): void {
    const st = this.state;
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

  // --- Rescue bubble (spec §11) ---

  private updateRescueBubble(p: PlayerState): void {
    p.bubbleAge++;
    if (p.restY < 0) {
      // Rising: same feel as a floating bubble; passes through platforms.
      const res = moveAABB(
        this.map, p.x, p.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX, 0, C.RESCUE_FLOAT_SPEED, true,
      );
      p.x = res.x;
      p.y = res.y;
      if (res.hitY) p.restY = res.y;
    } else {
      p.y = p.restY + bobOffset(p.bubbleAge);
    }
  }

  /** Turn a downed player into a rescue bubble (revive rules). */
  private downPlayer(p: PlayerState): void {
    p.phase = 'bubble';
    p.vy = 0;
    p.restY = -1;
    p.bubbleAge = 0;
  }

  /** Revive a downed player at its rescue bubble's position. */
  private revivePlayer(p: PlayerState): void {
    p.phase = 'alive';
    p.vy = 0;
    p.grounded = false;
    p.invuln = C.RESCUE_POP_INVULN_TICKS;
    p.restY = -1;
    p.bubbleAge = 0;
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

  // --- Pops, collection, rescue, and player contact (spec §4, §6, §11) ---

  private resolveContactsFor(slot: number, p: PlayerState): void {
    const st = this.state;

    // Player touching any bubble pops it, chaining to nearby bubbles.
    const seeds = st.bubbles.filter((b) =>
      aabbOverlap(
        p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
        b.x, b.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX,
      ),
    );
    if (seeds.length > 0) this.popChain(seeds, slot);

    // Collect fruit (credited to the collector).
    const remaining: FruitState[] = [];
    for (const f of st.fruit) {
      if (
        aabbOverlap(
          p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
          f.x, f.y, C.FRUIT_HITBOX, C.FRUIT_HITBOX,
        )
      ) {
        this.addScore(slot, f.kind === 'grumble' ? C.SCORE_FRUIT_GRUMBLE : C.SCORE_FRUIT_FLITTER);
      } else {
        remaining.push(f);
      }
    }
    st.fruit = remaining;

    // Pop teammates' rescue bubbles: revive them where the bubble is.
    for (const other of st.players) {
      if (!other || other === p || other.phase !== 'bubble') continue;
      if (
        aabbOverlap(
          p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
          other.x, other.y, C.BUBBLE_HITBOX, C.BUBBLE_HITBOX,
        )
      ) {
        this.revivePlayer(other);
      }
    }

    // Enemy contact kills (unless invulnerable).
    if (p.invuln <= 0) {
      for (const e of st.enemies) {
        if (
          aabbOverlap(
            p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
            e.x, e.y, C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H,
          )
        ) {
          if (st.reviveRules) {
            this.downPlayer(p);
          } else {
            st.lives--;
            st.mode = 'death';
            st.modeTicks = C.DEATH_PAUSE_TICKS;
          }
          break;
        }
      }
    }
  }

  private popChain(seeds: BubbleState[], creditSlot: number): void {
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

    // Score and resolve in ascending bubble-ID order, credited to the popper.
    let enemyChain = 0;
    for (const b of st.bubbles) {
      if (!popping.has(b.id)) continue;
      if (b.trapped !== null) {
        enemyChain++;
        const value = Math.min(C.SCORE_POP_BASE * 2 ** (enemyChain - 1), C.SCORE_POP_MAX);
        this.addScore(creditSlot, value);
        st.fruit.push({
          id: st.nextId++,
          kind: b.trapped,
          x: b.x,
          y: b.y,
          vy: 0,
          age: 0,
        });
      } else {
        this.addScore(creditSlot, C.SCORE_POP_EMPTY);
      }
    }
    st.bubbles = st.bubbles.filter((b) => !popping.has(b.id));
  }

  private addScore(slot: number, points: number): void {
    const st = this.state;
    const p = st.players[slot];
    if (!p) return;
    p.score += points;
    // Extra life applies only in classic solo mode (spec §11).
    if (!st.reviveRules && !st.extraLifeAwarded && p.score >= C.EXTRA_LIFE_SCORE) {
      st.extraLifeAwarded = true;
      st.lives++;
    }
  }

  // --- Game over under revive rules (spec §11) ---

  private checkReviveGameOver(): void {
    const st = this.state;
    if (!st.reviveRules || st.mode !== 'playing') return;
    const active = this.activeSlots().map((s) => st.players[s]!);
    if (active.length > 0 && active.every((p) => p.phase === 'bubble')) {
      st.mode = 'gameover';
      st.modeTicks = 0;
    }
  }

  // --- Level clear (spec §7, §11) ---

  private checkLevelClear(): void {
    const st = this.state;
    if (st.mode !== 'playing') return;
    const anyTrapped = st.bubbles.some((b) => b.trapped !== null);
    if (st.enemies.length === 0 && !anyTrapped && st.fruit.length === 0) {
      st.mode = 'levelclear';
      st.modeTicks = C.LEVEL_CLEAR_PAUSE_TICKS;
      // Rescue bubbles auto-pop (revive) on level clear.
      for (const p of st.players) {
        if (p && p.phase === 'bubble') this.revivePlayer(p);
      }
    }
  }

  // --- GameSim contract ---

  /** True when this game has only ever been slot 0 playing classic rules. */
  private isClassicSoloShape(): boolean {
    const st = this.state;
    return (
      !st.reviveRules &&
      st.players[0] !== null &&
      st.players[1] === null &&
      st.players[2] === null &&
      st.players[3] === null
    );
  }

  /**
   * Canonical state for hashing and replay fixtures. Classic solo games
   * serialize in the exact pre-multiplayer (v1) shape so the Phase 1 golden
   * replay fixture remains valid byte-for-byte; everything else serializes
   * the full multiplayer state. Netcode snapshots use snapshot()/restore(),
   * which are always lossless.
   */
  serialize(): string {
    const st = this.state;
    if (this.isClassicSoloShape()) {
      const p = st.players[0]!;
      return JSON.stringify({
        mode: st.mode,
        modeTicks: st.modeTicks,
        level: st.level,
        score: p.score,
        lives: st.lives,
        extraLifeAwarded: st.extraLifeAwarded,
        tick: st.tick,
        rng: st.rng,
        nextId: st.nextId,
        prevInput: p.prevInput,
        player: {
          x: p.x,
          y: p.y,
          vy: p.vy,
          facing: p.facing,
          grounded: p.grounded,
          blowCooldown: p.blowCooldown,
          invuln: p.invuln,
        },
        bubbles: st.bubbles,
        enemies: st.enemies,
        fruit: st.fruit,
      });
    }
    return JSON.stringify(st);
  }

  hash(): number {
    return fnv1a(this.serialize());
  }

  /** Lossless full state, for netcode snapshots. */
  snapshot(): string {
    return JSON.stringify(this.state);
  }

  /** Restore from a snapshot() string. */
  restore(json: string): void {
    this.state = JSON.parse(json) as GameState;
    this.rng = Rng.fromState(this.state.rng);
  }
}

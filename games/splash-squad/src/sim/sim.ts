/**
 * Splash Squad — deterministic co-op run-and-soak sim (SPEC.md).
 *
 * A pure function of inputs: no DOM, network, wall-clock, or Math.random
 * (lint-enforced under src/sim/). Implements RetroKit's `GameSim` and the rooms
 * `NetSim` contract; reuses Bubble Buddies' co-op revive rules verbatim (§11).
 * The scroll window and every projectile are sim-authoritative (server-owned).
 */
import {
  Button,
  Rng,
  SUBPX,
  SpawnRegions,
  Tile,
  TileMap,
  aabbOverlap,
  fnv1a,
  isSupported,
  moveAABB,
  type GameSim,
  type InputBits,
  type SlotInputs,
} from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { LEVELS, type RobotType, type Wave } from './levels';

export type Mode = 'playing' | 'death' | 'levelclear' | 'gameover' | 'win';
export type PlayerPhase = 'alive' | 'bubble' | 'pending' | 'despawned';
export type NozzleId = 0 | 1 | 2;
/** The three grunt robots (the boss is separate `BossState`). */
export type GruntKind = Exclude<RobotType, 'boss'>;

export interface PlayerState {
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  crouch: boolean;
  fireCooldown: number;
  invuln: number;
  phase: PlayerPhase;
  score: number;
  nozzle: NozzleId;
  tank: number;
  /** Rescue-bubble rest y once it reaches the ceiling; -1 while rising. */
  restY: number;
  bubbleAge: number;
  idleTicks: number;
  prevInput: number;
}

export interface DropletState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** Player slot that fired it (score credit). */
  owner: number;
}

export interface RobotState {
  id: number;
  kind: GruntKind;
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  soak: number;
  /** Spawn tick, for phase-stable attack timing. */
  born: number;
  /** Ticks of harmless sputter left; -1 while alive. */
  winddown: number;
  /** Last slot to soak it (chain/score credit). */
  lastHitBy: number;
}

export type PelletKind = 'rust' | 'steam';

export interface PelletState {
  id: number;
  kind: PelletKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface PickupState {
  id: number;
  nozzle: NozzleId;
  x: number;
  y: number;
}

export interface SpigotState {
  x: number;
  y: number;
}

export interface BossState {
  x: number;
  y: number;
  hp: number;
  cycleTick: number;
  winddown: number;
  lastHitBy: number;
}

export interface GameState {
  mode: Mode;
  modeTicks: number;
  level: number;
  lives: number;
  extraLifeAwarded: boolean;
  tick: number;
  rng: number;
  nextId: number;
  reviveRules: boolean;
  /** Left edge of the shared scroll window, world px (monotonic). */
  scrollX: number;
  /** Serializable SpawnRegions latch (cursor + high-water). */
  spawnState: { cursor: number; highWater: number };
  bossDefeated: boolean;
  players: (PlayerState | null)[];
  droplets: DropletState[];
  robots: RobotState[];
  pellets: PelletState[];
  pickups: PickupState[];
  spigots: SpigotState[];
  boss: BossState | null;
}

interface ParsedLevel {
  map: TileMap;
  worldW: number;
  maxScroll: number;
  zone: number;
  boss: boolean;
  playerSpawn: { tx: number; ty: number };
  spigots: { tx: number; ty: number }[];
  pickups: { nozzle: NozzleId; tx: number; ty: number }[];
  byId: Map<number, Wave>;
}

// 8-dir compass, ordered E, NE, N, NW, W, SW, S, SE (spread neighbours are
// adjacent entries). Each is an integer aim vector (SPEC §4).
const COMPASS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1],
];
const compassIndex = (ax: number, ay: number): number =>
  COMPASS.findIndex(([x, y]) => x === ax && y === ay);

const NOZZLE = {
  [C.NOZZLE_STREAM]: { cd: C.STREAM_CD, life: C.STREAM_LIFE, count: 1 },
  [C.NOZZLE_SPREAD]: { cd: C.SPREAD_CD, life: C.SPREAD_LIFE, count: 3 },
  [C.NOZZLE_BURST]: { cd: C.BURST_CD, life: C.BURST_LIFE, count: 1 },
} as const;

const robotMaxHp = (kind: GruntKind): number =>
  kind === 'trundle' ? C.TRUNDLE_HP : kind === 'sentry' ? C.SENTRY_HP : C.HOPPER_HP;
const robotScore = (kind: GruntKind): number =>
  kind === 'trundle'
    ? C.SCORE_SOAK_TRUNDLE
    : kind === 'sentry'
      ? C.SCORE_SOAK_SENTRY
      : C.SCORE_SOAK_HOPPER;

/** Triangle-wave bob offset in subpixels (shared with Bubble Buddies §4). */
const bobOffset = (age: number): number => {
  const half = C.BUBBLE_BOB_PERIOD / 2;
  const p = age % C.BUBBLE_BOB_PERIOD;
  const tri = p < half ? p : C.BUBBLE_BOB_PERIOD - p;
  return (tri * C.BUBBLE_BOB_AMPLITUDE * SUBPX) / half;
};

/** Marker tile → hitbox top-left subpixel position (bottom-centered). */
const spawnPos = (tx: number, ty: number, w: number, h: number): { x: number; y: number } => ({
  x: (tx * C.TILE_SIZE + Math.floor(C.TILE_SIZE / 2) - Math.floor(w / 2)) * SUBPX,
  y: ((ty + 1) * C.TILE_SIZE - h) * SUBPX,
});

const NOZZLE_OF_CHAR: Record<string, NozzleId> = {
  M: C.NOZZLE_STREAM,
  W: C.NOZZLE_SPREAD,
  U: C.NOZZLE_BURST,
};

const parseLevel = (index: number): ParsedLevel => {
  const def = LEVELS[index];
  if (!def) throw new Error(`no level ${index}`);
  const { map, spawns } = TileMap.parse(def.rows, C.TILE_SIZE);
  let playerSpawn: { tx: number; ty: number } | undefined;
  const spigots: { tx: number; ty: number }[] = [];
  const pickups: { nozzle: NozzleId; tx: number; ty: number }[] = [];
  for (const s of spawns) {
    if (s.char === 'P') playerSpawn = { tx: s.tx, ty: s.ty };
    else if (s.char === 'S') spigots.push({ tx: s.tx, ty: s.ty });
    else if (s.char === 'B') {
      /* boss anchor: lives in the schedule's boss wave, marker is cosmetic */
    } else if (s.char in NOZZLE_OF_CHAR)
      pickups.push({ nozzle: NOZZLE_OF_CHAR[s.char]!, tx: s.tx, ty: s.ty });
    else throw new Error(`unknown marker '${s.char}' in level ${index}`);
  }
  if (!playerSpawn) throw new Error(`level ${index} has no player spawn`);
  const worldW = map.width * C.TILE_SIZE;
  const byId = new Map<number, Wave>();
  for (const w of def.schedule) byId.set(w.id, w);
  return {
    map,
    worldW,
    maxScroll: Math.max(0, worldW - C.SCREEN_W),
    zone: def.zone,
    boss: def.boss,
    playerSpawn,
    spigots,
    pickups,
    byId,
  };
};

export class SplashSquadSim implements GameSim {
  state: GameState;
  private levels: ParsedLevel[];
  private rng: Rng;
  private regions: SpawnRegions;

  constructor(seed: number, startLevel = 0, playerCount = 1) {
    this.levels = LEVELS.map((_, i) => parseLevel(i));
    this.rng = new Rng(seed);
    this.regions = new SpawnRegions([]);
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
      scrollX: 0,
      spawnState: { cursor: 0, highWater: -1 },
      bossDefeated: false,
      players: [null, null, null, null],
      droplets: [],
      robots: [],
      pellets: [],
      pickups: [],
      spigots: [],
      boss: null,
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

  private cur(): ParsedLevel {
    return this.levels[this.state.level]!;
  }

  private activeSlots(): number[] {
    const out: number[] = [];
    this.state.players.forEach((p, slot) => {
      if (p && (p.phase === 'alive' || p.phase === 'bubble')) out.push(slot);
    });
    return out;
  }

  // --- Player lifecycle (spec §11) ---

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
      crouch: false,
      fireCooldown: 0,
      invuln: 0,
      phase: 'pending',
      score: 0,
      nozzle: C.NOZZLE_STREAM,
      tank: C.TANK_CAPACITY,
      restY: -1,
      bubbleAge: 0,
      idleTicks: 0,
      prevInput: 0,
    };
    if (st.tick === 0) {
      this.spawnAtAnchor(slot, 0);
      st.reviveRules = this.activeSlots().length >= 2;
    }
  }

  rejoinPlayer(slot: number): void {
    const p = this.state.players[slot];
    if (!p) {
      this.joinPlayer(slot);
      return;
    }
    p.idleTicks = 0;
    if (p.phase === 'despawned') this.spawnAtLeftEdge(slot, C.RESCUE_POP_INVULN_TICKS);
  }

  /** Place a slot at the level's `P` anchor (level load / first join). */
  private spawnAtAnchor(slot: number, invuln: number): void {
    const lvl = this.cur();
    const tx = Math.min(
      Math.max(lvl.playerSpawn.tx + C.PLAYER_SPAWN_OFFSETS[slot]!, 1),
      lvl.map.width - 2,
    );
    this.placeSlot(slot, tx, lvl.playerSpawn.ty, invuln);
  }

  /** Place a slot just inside the window's left edge (mid-level respawn). */
  private spawnAtLeftEdge(slot: number, invuln: number): void {
    const lvl = this.cur();
    const baseTx = Math.floor(this.state.scrollX / C.TILE_SIZE) + 2;
    const tx = Math.min(Math.max(baseTx + C.PLAYER_SPAWN_OFFSETS[slot]!, 1), lvl.map.width - 2);
    this.placeSlot(slot, tx, lvl.playerSpawn.ty, invuln);
  }

  private placeSlot(slot: number, tx: number, ty: number, invuln: number): void {
    const p = this.state.players[slot]!;
    const pos = spawnPos(tx, ty, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H);
    p.x = pos.x;
    p.y = pos.y;
    p.vy = 0;
    p.facing = 1;
    p.grounded = true;
    p.crouch = false;
    p.fireCooldown = 0;
    p.invuln = invuln;
    p.phase = 'alive';
    p.nozzle = C.NOZZLE_STREAM;
    p.tank = C.TANK_CAPACITY;
    p.restY = -1;
    p.bubbleAge = 0;
  }

  private loadLevel(index: number): void {
    const st = this.state;
    st.level = index;
    const lvl = this.cur();
    st.droplets = [];
    st.robots = [];
    st.pellets = [];
    st.boss = null;
    st.bossDefeated = false;
    st.scrollX = 0;
    st.pickups = lvl.pickups.map((pk) => {
      const pos = spawnPos(pk.tx, pk.ty, C.TILE_SIZE, C.TILE_SIZE);
      return { id: st.nextId++, nozzle: pk.nozzle, x: pos.x, y: pos.y };
    });
    st.spigots = lvl.spigots.map((s) => {
      const pos = spawnPos(s.tx, s.ty, C.SPIGOT_W, C.SPIGOT_H);
      return { x: pos.x, y: pos.y };
    });
    this.regions = new SpawnRegions(
      LEVELS[index]!.schedule.map((w) => ({ id: w.id, trigger: w.trigger })),
    );
    st.spawnState = this.regions.state();
    st.players.forEach((p, slot) => {
      if (p && p.phase !== 'despawned') this.spawnAtAnchor(slot, 0);
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

  // --- Tick ---

  tick(inputs: SlotInputs): void {
    const st = this.state;
    const bits: number[] = [0, 0, 0, 0];
    const pressed: number[] = [0, 0, 0, 0];
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p) continue;
      const raw = inputs[slot] ?? null;
      if (raw === null) {
        p.idleTicks++;
        if (p.idleTicks >= C.DISCONNECT_GRACE_TICKS && p.phase !== 'despawned') {
          p.phase = 'despawned';
        }
      } else {
        p.idleTicks = 0;
        bits[slot] = raw;
      }
      pressed[slot] = bits[slot]! & ~p.prevInput;
    }
    this.checkReviveGameOver();

    switch (st.mode) {
      case 'playing':
        this.updatePlaying(bits);
        break;
      case 'death':
        st.modeTicks--;
        if (st.modeTicks <= 0) {
          if (st.lives > 0) {
            const slot = this.activeSlots()[0];
            if (slot !== undefined) this.spawnAtLeftEdge(slot, C.RESPAWN_INVULN_TICKS);
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

  private updatePlaying(bits: number[]): void {
    const st = this.state;
    // 2. players
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p) continue;
      if (p.phase === 'alive') this.updateAlivePlayer(slot, p, bits[slot]!);
      else if (p.phase === 'bubble') this.updateRescueBubble(p);
    }
    // 3. droplets
    this.updateDroplets();
    // 4. robots & boss
    this.updateRobots();
    this.updateBoss();
    // 5. pellets / steam
    this.updatePellets();
    // 6. pickups & spigots
    this.updatePickupsAndSpigots();
    // 7. scroll front + left wall
    this.updateScroll();
    // 8. spawn regions
    this.runSpawns();
    // 9. winddowns & chains; downing & revives
    this.resolveSoak();
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      if (st.mode !== 'playing') break;
      const p = st.players[slot];
      if (p && p.phase === 'alive') this.resolveContactsFor(slot, p);
    }
    this.checkReviveGameOver();
    // 10. level state
    this.checkLevelClear();
  }

  // --- Player (spec §3, §4, §5) ---

  private updateAlivePlayer(slot: number, p: PlayerState, input: InputBits): void {
    const map = this.map;
    if (p.fireCooldown > 0) p.fireCooldown--;
    if (p.invuln > 0) p.invuln--;

    if (input & Button.Left) p.facing = -1;
    else if (input & Button.Right) p.facing = 1;
    p.crouch = !!(input & Button.Down) && p.grounded;

    let vx = 0;
    if (!p.crouch) {
      if (input & Button.Left) vx = -C.PLAYER_WALK_SPEED;
      else if (input & Button.Right) vx = C.PLAYER_WALK_SPEED;
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

    // Fire — auto-repeats while B is held, gated by the nozzle cooldown (§4).
    if (input & Button.B && p.fireCooldown <= 0 && p.tank > 0) this.fire(slot, p, input);
  }

  private fire(slot: number, p: PlayerState, input: InputBits): void {
    const st = this.state;
    const lr = !!(input & (Button.Left | Button.Right));
    const up = !!(input & Button.Up);
    const down = !!(input & Button.Down);
    let ax = p.facing as number;
    let ay = 0;
    if (down && p.grounded) {
      ax = p.facing;
      ay = 0;
    } else if (up) {
      ay = -1;
      ax = lr ? p.facing : 0;
    } else if (down) {
      ay = 1;
      ax = lr ? p.facing : 0;
    }

    const params = NOZZLE[p.nozzle];
    let dirs: (readonly [number, number])[] = [[ax, ay]];
    if (params.count === 3) {
      const i = compassIndex(ax, ay);
      dirs = [COMPASS[i]!, COMPASS[(i + 7) % 8]!, COMPASS[(i + 1) % 8]!];
    }

    const cx = p.x + (C.PLAYER_HITBOX_W / 2) * SUBPX;
    const chestDy = (p.crouch ? C.MUZZLE_DY_CROUCH : C.MUZZLE_DY_STAND) + C.PLAYER_HITBOX_H / 2;
    const cy = p.y + chestDy * SUBPX;
    for (const [dx, dy] of dirs) {
      if (p.tank <= 0 || st.droplets.length >= C.MAX_DROPLETS) break;
      st.droplets.push({
        id: st.nextId++,
        x: cx - (C.DROPLET_HITBOX / 2) * SUBPX + dx * C.MUZZLE_DX * SUBPX,
        y: cy - (C.DROPLET_HITBOX / 2) * SUBPX + dy * C.MUZZLE_DX * SUBPX,
        vx: dx * C.DROPLET_SPEED,
        vy: dy * C.DROPLET_SPEED,
        life: params.life,
        owner: slot,
      });
      p.tank--;
    }
    p.fireCooldown = params.cd;
  }

  private updateRescueBubble(p: PlayerState): void {
    p.bubbleAge++;
    if (p.restY < 0) {
      const res = moveAABB(
        this.map, p.x, p.y, C.RESCUE_HITBOX, C.RESCUE_HITBOX, 0, C.RESCUE_FLOAT_SPEED, true,
      );
      p.x = res.x;
      p.y = res.y;
      if (res.hitY) p.restY = res.y;
    } else {
      p.y = p.restY + bobOffset(p.bubbleAge);
    }
  }

  private downPlayer(slot: number, p: PlayerState): void {
    const st = this.state;
    if (st.reviveRules) {
      p.phase = 'bubble';
      p.vy = 0;
      p.restY = -1;
      p.bubbleAge = 0;
    } else {
      st.lives--;
      st.mode = 'death';
      st.modeTicks = C.DEATH_PAUSE_TICKS;
    }
  }

  private revivePlayer(p: PlayerState): void {
    p.phase = 'alive';
    p.vy = 0;
    p.grounded = false;
    p.crouch = false;
    p.invuln = C.RESCUE_POP_INVULN_TICKS;
    p.nozzle = C.NOZZLE_STREAM;
    p.tank = C.TANK_CAPACITY;
    p.restY = -1;
    p.bubbleAge = 0;
  }

  // --- Droplets (spec §4, §7) ---

  private updateDroplets(): void {
    const st = this.state;
    const map = this.map;
    const kept: DropletState[] = [];
    for (const d of st.droplets) {
      d.life--;
      if (d.life < 0) continue;
      const res = moveAABB(map, d.x, d.y, C.DROPLET_HITBOX, C.DROPLET_HITBOX, d.vx, d.vy, true);
      d.x = res.x;
      d.y = res.y;
      if (res.hitX || res.hitY) continue; // splashed on a wall

      let consumed = false;
      for (const r of st.robots) {
        if (r.winddown >= 0) continue;
        if (
          aabbOverlap(
            d.x, d.y, C.DROPLET_HITBOX, C.DROPLET_HITBOX,
            r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX,
          )
        ) {
          r.soak++;
          r.lastHitBy = d.owner;
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      const pelletIdx = st.pellets.findIndex(
        (pl) =>
          pl.kind === 'rust' &&
          aabbOverlap(
            d.x, d.y, C.DROPLET_HITBOX, C.DROPLET_HITBOX,
            pl.x, pl.y, C.RUST_PELLET_HITBOX, C.RUST_PELLET_HITBOX,
          ),
      );
      if (pelletIdx >= 0) {
        st.pellets.splice(pelletIdx, 1);
        this.addScore(d.owner, C.SCORE_DISSOLVE_PELLET);
        continue;
      }

      const boss = st.boss;
      if (boss && boss.winddown < 0 && this.boilerOpen(boss)) {
        const bx = boss.x + ((C.BOSS_HITBOX_W - C.BOSS_BOILER_W) / 2) * SUBPX;
        const by = boss.y + ((C.BOSS_HITBOX_H - C.BOSS_BOILER_H) / 2) * SUBPX;
        if (
          aabbOverlap(
            d.x, d.y, C.DROPLET_HITBOX, C.DROPLET_HITBOX,
            bx, by, C.BOSS_BOILER_W, C.BOSS_BOILER_H,
          )
        ) {
          boss.hp--;
          boss.lastHitBy = d.owner;
          continue;
        }
      }
      kept.push(d);
    }
    st.droplets = kept;
  }

  // --- Robots (spec §6) ---

  private nearestPlayer(x: number): PlayerState | null {
    const st = this.state;
    let best: PlayerState | null = null;
    let bestDx = Infinity;
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p || p.phase !== 'alive') continue;
      const dx = Math.abs(p.x - x);
      if (dx < bestDx) {
        bestDx = dx;
        best = p;
      }
    }
    return best;
  }

  private updateRobots(): void {
    const st = this.state;
    const kept: RobotState[] = [];
    for (const r of st.robots) {
      if (r.winddown >= 0) {
        r.winddown--;
        if (r.winddown < 0) continue; // sputter finished — despawn
        kept.push(r);
        continue;
      }
      if (r.kind === 'trundle') this.updateTrundle(r);
      else if (r.kind === 'sentry') this.updateSentry(r);
      else this.updateHopper(r);
      if (Math.floor(r.y / SUBPX) + C.ROBOT_HITBOX >= C.LEVEL_HEIGHT * C.TILE_SIZE) continue;
      kept.push(r);
    }
    st.robots = kept;
  }

  private updateTrundle(r: RobotState): void {
    const map = this.map;
    const target = this.nearestPlayer(r.x);
    if (target) r.facing = target.x >= r.x ? 1 : -1;
    const supported = r.vy >= 0 && isSupported(map, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX);
    let vx = target ? r.facing * C.TRUNDLE_SPEED : 0;
    if (supported) {
      r.vy = 0;
      const nx = r.x + vx;
      const frontPx =
        r.facing === 1 ? Math.floor(nx / SUBPX) + C.ROBOT_HITBOX - 1 : Math.floor(nx / SUBPX);
      const footRow = Math.floor((Math.floor(r.y / SUBPX) + C.ROBOT_HITBOX) / C.TILE_SIZE);
      const ahead = map.at(Math.floor(frontPx / C.TILE_SIZE), footRow);
      if (ahead !== Tile.Solid && ahead !== Tile.Platform) {
        r.facing = r.facing === 1 ? -1 : 1;
        vx = 0;
      }
    } else {
      r.vy = Math.min(r.vy + C.GRAVITY, C.MAX_FALL_SPEED);
    }
    const res = moveAABB(map, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX, vx, r.vy);
    r.x = res.x;
    r.y = res.y;
    if (res.hitY) r.vy = 0;
    if (res.hitX) r.facing = r.facing === 1 ? -1 : 1;
    r.grounded = res.grounded;
  }

  private updateSentry(r: RobotState): void {
    const map = this.map;
    const st = this.state;
    const supported = r.vy >= 0 && isSupported(map, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX);
    r.vy = supported ? 0 : Math.min(r.vy + C.GRAVITY, C.MAX_FALL_SPEED);
    const res = moveAABB(map, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX, 0, r.vy);
    r.x = res.x;
    r.y = res.y;
    if (res.hitY) r.vy = 0;
    r.grounded = res.grounded;

    const target = this.nearestPlayer(r.x);
    if (target && (st.tick - r.born) % C.SENTRY_FIRE_PERIOD === 0) {
      const dir = target.x >= r.x ? 1 : -1;
      st.pellets.push({
        id: st.nextId++,
        kind: 'rust',
        x: r.x + (C.ROBOT_HITBOX / 2 - C.RUST_PELLET_HITBOX / 2) * SUBPX,
        y: r.y,
        vx: dir * C.RUST_PELLET_SPEED,
        vy: C.RUST_PELLET_LOB_VY,
        life: C.BOSS_STEAM_LIFE,
      });
    }
  }

  private updateHopper(r: RobotState): void {
    const map = this.map;
    const st = this.state;
    const target = this.nearestPlayer(r.x);
    const supported = r.vy >= 0 && isSupported(map, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX);
    let vx = 0;
    if (supported) {
      r.vy = 0;
      if (target && (st.tick - r.born) % C.HOPPER_JUMP_PERIOD === 0) {
        r.vy = C.HOPPER_JUMP_VY;
        r.facing = target.x >= r.x ? 1 : -1;
      }
    } else {
      r.vy = Math.min(r.vy + C.GRAVITY, C.MAX_FALL_SPEED);
      vx = r.facing * C.HOPPER_HOP_VX;
    }
    const res = moveAABB(map, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX, vx, r.vy);
    r.x = res.x;
    r.y = res.y;
    if (res.hitY) r.vy = 0;
    if (res.hitX) r.facing = r.facing === 1 ? -1 : 1;
    r.grounded = res.grounded;
  }

  // --- Boss (spec §6) ---

  private boilerOpen(boss: BossState): boolean {
    return boss.cycleTick % C.BOSS_CYCLE_TICKS >= C.BOSS_CYCLE_TICKS - C.BOSS_OPEN_TICKS;
  }

  private updateBoss(): void {
    const st = this.state;
    const boss = st.boss;
    if (!boss) return;
    if (boss.winddown >= 0) {
      boss.winddown--;
      if (boss.winddown < 0) {
        st.boss = null;
        st.bossDefeated = true;
      }
      return;
    }
    if (boss.hp <= 0) {
      boss.winddown = C.WINDDOWN_TICKS;
      this.addScore(boss.lastHitBy, C.SCORE_BOSS);
      return;
    }
    const phase = boss.cycleTick % C.BOSS_CYCLE_TICKS;
    if (phase === 0) {
      const target = this.nearestPlayer(boss.x);
      if (target) {
        const dir = target.x >= boss.x ? 1 : -1;
        st.pellets.push({
          id: st.nextId++,
          kind: 'steam',
          x: boss.x + (C.BOSS_HITBOX_W / 2 - C.BOSS_STEAM_HITBOX / 2) * SUBPX,
          y: boss.y + (C.BOSS_HITBOX_H / 2) * SUBPX,
          vx: dir * C.BOSS_STEAM_SPEED,
          vy: 0,
          life: C.BOSS_STEAM_LIFE,
        });
      }
    }
    boss.cycleTick++;
  }

  // --- Pellets / steam (spec §6) ---

  private updatePellets(): void {
    const st = this.state;
    const map = this.map;
    const kept: PelletState[] = [];
    for (const pl of st.pellets) {
      pl.life--;
      if (pl.life < 0) continue;
      if (pl.kind === 'rust') pl.vy = Math.min(pl.vy + C.RUST_PELLET_GRAVITY, C.MAX_FALL_SPEED);
      const size = pl.kind === 'rust' ? C.RUST_PELLET_HITBOX : C.BOSS_STEAM_HITBOX;
      const res = moveAABB(map, pl.x, pl.y, size, size, pl.vx, pl.vy, true);
      pl.x = res.x;
      pl.y = res.y;
      if (res.hitX || res.hitY) continue; // splashes on terrain
      if (Math.floor(pl.y / SUBPX) >= C.LEVEL_HEIGHT * C.TILE_SIZE) continue;
      kept.push(pl);
    }
    st.pellets = kept;
  }

  // --- Pickups & spigots (spec §4, §5) ---

  private updatePickupsAndSpigots(): void {
    const st = this.state;
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      const p = st.players[slot];
      if (!p || p.phase !== 'alive') continue;
      const remaining: PickupState[] = [];
      for (const pk of st.pickups) {
        if (
          aabbOverlap(
            p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
            pk.x, pk.y, C.TILE_SIZE, C.TILE_SIZE,
          )
        ) {
          p.nozzle = pk.nozzle;
        } else {
          remaining.push(pk);
        }
      }
      st.pickups = remaining;
      for (const s of st.spigots) {
        if (
          aabbOverlap(
            p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
            s.x, s.y, C.SPIGOT_W, C.SPIGOT_H,
          )
        ) {
          p.tank = Math.min(C.TANK_CAPACITY, p.tank + C.REFILL_RATE);
          break;
        }
      }
    }
  }

  // --- Scroll window (spec §2) ---

  private updateScroll(): void {
    const st = this.state;
    const lvl = this.cur();
    let lead = -Infinity;
    for (const p of st.players) {
      if (p && p.phase === 'alive') {
        lead = Math.max(lead, Math.floor(p.x / SUBPX) + C.PLAYER_HITBOX_W / 2);
      }
    }
    if (lead > -Infinity) {
      const target = Math.min(Math.max(lead - C.SCROLL_LEAD_PX, st.scrollX), lvl.maxScroll);
      st.scrollX = Math.max(st.scrollX, target); // forward-only
    }
    const leftMin = st.scrollX * SUBPX;
    for (const p of st.players) {
      if (p && (p.phase === 'alive' || p.phase === 'bubble') && p.x < leftMin) p.x = leftMin;
    }
  }

  // --- Camera-triggered spawns (spec §8/§10) ---

  private runSpawns(): void {
    const st = this.state;
    const lvl = this.cur();
    const fired = this.regions.advance(st.scrollX + C.SCREEN_W);
    for (const id of fired) {
      const w = lvl.byId.get(id);
      if (!w) continue;
      for (const s of w.spawns) {
        if (s.type === 'boss') {
          const pos = spawnPos(s.tx, s.ty, C.BOSS_HITBOX_W, C.BOSS_HITBOX_H);
          st.boss = {
            x: pos.x,
            y: pos.y,
            hp: C.BOSS_HP_BASE + lvl.zone * C.BOSS_HP_PER_ZONE,
            cycleTick: 0,
            winddown: -1,
            lastHitBy: 0,
          };
        } else {
          const pos = spawnPos(s.tx, s.ty, C.ROBOT_HITBOX, C.ROBOT_HITBOX);
          st.robots.push({
            id: st.nextId++,
            kind: s.type,
            x: pos.x,
            y: pos.y,
            vy: 0,
            facing: -1,
            grounded: false,
            soak: 0,
            born: st.tick,
            winddown: -1,
            lastHitBy: 0,
          });
        }
      }
    }
    st.spawnState = this.regions.state();
  }

  // --- Soak resolution & splash chains (spec §7) ---

  private resolveSoak(): void {
    const st = this.state;
    const queue: RobotState[] = [];
    for (const r of st.robots) {
      if (r.winddown < 0 && r.soak >= robotMaxHp(r.kind)) queue.push(r);
    }
    queue.sort((a, b) => a.id - b.id);
    let felled = 0;
    while (queue.length > 0) {
      const r = queue.shift()!;
      if (r.winddown >= 0) continue;
      r.winddown = C.WINDDOWN_TICKS;
      this.addScore(r.lastHitBy, robotScore(r.kind) + felled * C.SCORE_SPLASH_BONUS);
      felled++;
      const rcx = Math.floor(r.x / SUBPX) + C.ROBOT_HITBOX / 2;
      const rcy = Math.floor(r.y / SUBPX) + C.ROBOT_HITBOX / 2;
      const newly: RobotState[] = [];
      for (const o of st.robots) {
        if (o.winddown >= 0 || o === r) continue;
        const ocx = Math.floor(o.x / SUBPX) + C.ROBOT_HITBOX / 2;
        const ocy = Math.floor(o.y / SUBPX) + C.ROBOT_HITBOX / 2;
        const dx = rcx - ocx;
        const dy = rcy - ocy;
        if (dx * dx + dy * dy <= C.SPLASH_RADIUS * C.SPLASH_RADIUS) {
          o.soak++;
          o.lastHitBy = r.lastHitBy;
          if (o.soak >= robotMaxHp(o.kind) && !queue.includes(o)) newly.push(o);
        }
      }
      newly.sort((a, b) => a.id - b.id);
      queue.push(...newly);
    }
  }

  // --- Contact, revives & downing (spec §7, §11) ---

  private resolveContactsFor(slot: number, p: PlayerState): void {
    const st = this.state;

    for (const other of st.players) {
      if (!other || other === p || other.phase !== 'bubble') continue;
      if (
        aabbOverlap(
          p.x, p.y, C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H,
          other.x, other.y, C.RESCUE_HITBOX, C.RESCUE_HITBOX,
        )
      ) {
        this.revivePlayer(other);
      }
    }

    if (p.invuln > 0) return;

    // Vulnerability hitbox shrinks when crouching (bottom-aligned, §3).
    const hh = p.crouch ? C.CROUCH_HITBOX_H : C.PLAYER_HITBOX_H;
    const hy = p.y + (C.PLAYER_HITBOX_H - hh) * SUBPX;

    if (Math.floor(p.y / SUBPX) + C.PLAYER_HITBOX_H >= C.LEVEL_HEIGHT * C.TILE_SIZE) {
      this.downPlayer(slot, p);
      return;
    }

    for (const r of st.robots) {
      if (r.winddown >= 0) continue;
      if (aabbOverlap(p.x, hy, C.PLAYER_HITBOX_W, hh, r.x, r.y, C.ROBOT_HITBOX, C.ROBOT_HITBOX)) {
        this.downPlayer(slot, p);
        return;
      }
    }

    for (const pl of st.pellets) {
      const size = pl.kind === 'rust' ? C.RUST_PELLET_HITBOX : C.BOSS_STEAM_HITBOX;
      if (aabbOverlap(p.x, hy, C.PLAYER_HITBOX_W, hh, pl.x, pl.y, size, size)) {
        this.downPlayer(slot, p);
        return;
      }
    }

    const boss = st.boss;
    if (
      boss &&
      boss.winddown < 0 &&
      aabbOverlap(p.x, hy, C.PLAYER_HITBOX_W, hh, boss.x, boss.y, C.BOSS_HITBOX_W, C.BOSS_HITBOX_H)
    ) {
      this.downPlayer(slot, p);
    }
  }

  private addScore(slot: number, points: number): void {
    const st = this.state;
    const p = st.players[slot];
    if (!p) return;
    p.score += points;
    if (!st.reviveRules && !st.extraLifeAwarded && p.score >= C.EXTRA_LIFE_SCORE) {
      st.extraLifeAwarded = true;
      st.lives++;
    }
  }

  private checkReviveGameOver(): void {
    const st = this.state;
    if (!st.reviveRules || st.mode !== 'playing') return;
    const active = this.activeSlots().map((s) => st.players[s]!);
    if (active.length > 0 && active.every((p) => p.phase === 'bubble')) {
      st.mode = 'gameover';
      st.modeTicks = 0;
    }
  }

  // --- Level / zone clear (spec §10) ---

  private checkLevelClear(): void {
    const st = this.state;
    if (st.mode !== 'playing') return;
    const lvl = this.cur();
    const liveRobots = st.robots.some((r) => r.winddown < 0);
    const cleared = lvl.boss
      ? st.bossDefeated
      : st.scrollX >= lvl.maxScroll && this.regions.exhausted && !liveRobots;
    if (!cleared) return;
    st.mode = 'levelclear';
    st.modeTicks = C.LEVEL_CLEAR_PAUSE_TICKS;
    for (const p of st.players) if (p && p.phase === 'bubble') this.revivePlayer(p);
  }

  // --- GameSim / NetSim contract (spec §9) ---

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
    this.regions = new SpawnRegions(
      LEVELS[this.state.level]!.schedule.map((w) => ({ id: w.id, trigger: w.trigger })),
    );
    this.regions.restore(this.state.spawnState);
  }
}

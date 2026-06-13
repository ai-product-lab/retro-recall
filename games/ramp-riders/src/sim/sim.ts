/**
 * Ramp Riders — deterministic race sim (SPEC.md).
 *
 * Riders auto-roll forward; the player pedals (A) / pumps (B, drains legs),
 * switches lane (Up/Down), leans in the air (Left/Right), launches off ramps and
 * lands clean to keep momentum. Riders never collide — lanes only gate which
 * obstacles hit you. First across the finish wins; the server's authoritative
 * sim adjudicates the order.
 *
 * Determinism rules (lint-enforced in src/sim/): integer / fixed-point math
 * only, no DOM / wall-clock / network / Math.random. No gameplay RNG in v1
 * (sprinklers are tick-periodic); a seeded Rng is still owned + serialized for
 * forward-compat and snapshot parity with the other games. Implements RetroKit's
 * GameSim and the rooms NetSim contract.
 */
import {
  Button,
  Rng,
  SUBPX,
  Tile,
  TileMap,
  fnv1a,
  moveAABB,
  type GameSim,
  type InputBits,
  type SlotInputs,
} from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { trackByIndex, surfaceAngleAt, isRisingRamp } from './tracks';
import type { Obstacle } from './segments';

export type Mode = 'countdown' | 'racing' | 'results' | 'done';
export type RiderPhase = 'racing' | 'wipeout' | 'finished' | 'pending';

export interface RiderState {
  x: number; // subpx, hitbox top-left
  y: number;
  speed: number; // subpx/tick, forward, >= 0
  vy: number; // subpx/tick
  lane: number; // 0 front .. LANE_COUNT-1 back
  laneCooldown: number;
  tilt: number; // degrees, <0 nose up / >0 nose down
  airborne: boolean;
  grounded: boolean;
  legs: number;
  gassed: boolean;
  phase: RiderPhase;
  wipeoutTicks: number;
  /** Launch velocity armed while on a rising ramp (<=0); 0 = none. */
  rampArmed: number;
  prejumpBonus: number;
  prejumpUsed: boolean;
  /** Generic "stumble" cooldown gating sprinkler/hose re-triggers. */
  staggerTicks: number;
  finishTick: number; // -1 until finished
  finishPlace: number; // 0 until placed
  disconnected: boolean;
  idleTicks: number;
  prevInput: number;
}

export interface GameState {
  tick: number;
  /** NetSim requires a string mode field. */
  mode: Mode;
  modeTicks: number;
  track: number;
  juniorBoost: boolean;
  finishX: number; // tile-x of the finish line
  nextPlace: number; // next finishing place to assign (1-based)
  rng: number;
  /** Indexed by slot 0–3; null = slot never joined. */
  players: (RiderState | null)[];
}

export interface SimOptions {
  /** Track index; defaults to `seed % TRACK_COUNT`. */
  track?: number;
  /** Auto-join this many slots (tests/local); the room fills slots via joinPlayer. */
  players?: number;
  /** Room-level rubber-band assist (SPEC §6). */
  juniorBoost?: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Hitbox center x in whole pixels. */
const centerPx = (p: RiderState): number => Math.floor(p.x / SUBPX) + (C.RIDER_HITBOX_W >> 1);

export class RampRidersSim implements GameSim {
  state: GameState;
  private map: TileMap;
  private obstacles: Obstacle[];
  private spawn: { tx: number; ty: number };
  private rng: Rng;

  constructor(seed: number, opts: SimOptions = {}) {
    const trackIndex = opts.track ?? ((seed % C.TRACK_COUNT) + C.TRACK_COUNT) % C.TRACK_COUNT;
    const built = trackByIndex(trackIndex);
    this.map = built.map;
    this.obstacles = built.obstacles;
    this.spawn = built.spawn;
    this.rng = new Rng(seed);
    this.state = {
      tick: 0,
      mode: 'countdown',
      modeTicks: 0,
      track: trackIndex,
      juniorBoost: opts.juniorBoost ?? false,
      finishX: built.finishX,
      nextPlace: 1,
      rng: this.rng.state(),
      players: [null, null, null, null],
    };
    for (let slot = 0; slot < (opts.players ?? 0); slot++) this.joinPlayer(slot);
  }

  // --- NetSim player lifecycle ---

  joinPlayer(slot: number): void {
    if (slot < 0 || slot >= C.MAX_PLAYERS) throw new Error('bad slot ' + slot);
    if (this.state.players[slot]) return;
    // Joining before the gate (countdown) races; joining mid-race spectates.
    const racing = this.state.mode === 'countdown';
    this.state.players[slot] = this.freshRider(racing ? 'racing' : 'pending');
  }

  rejoinPlayer(slot: number): void {
    const p = this.state.players[slot];
    if (!p) {
      this.joinPlayer(slot);
      return;
    }
    p.idleTicks = 0;
    p.disconnected = false;
  }

  private freshRider(phase: RiderPhase): RiderState {
    const w = C.RIDER_HITBOX_W;
    const h = C.RIDER_HITBOX_H;
    const x = (this.spawn.tx * C.TILE_SIZE + (C.TILE_SIZE >> 1) - (w >> 1)) * SUBPX;
    const y = ((this.spawn.ty + 1) * C.TILE_SIZE - h) * SUBPX;
    return {
      x,
      y,
      speed: 0,
      vy: 0,
      lane: C.START_LANE,
      laneCooldown: 0,
      tilt: 0,
      airborne: false,
      grounded: true,
      legs: C.LEGS_MAX,
      gassed: false,
      phase,
      wipeoutTicks: 0,
      rampArmed: 0,
      prejumpBonus: 0,
      prejumpUsed: false,
      staggerTicks: 0,
      finishTick: -1,
      finishPlace: 0,
      disconnected: false,
      idleTicks: 0,
      prevInput: 0,
    };
  }

  // --- Tick ---

  tick(inputs: SlotInputs): void {
    const st = this.state;

    if (st.mode === 'countdown') {
      // Riders frozen at the gate; just count down.
      for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
        const p = st.players[slot];
        if (p) p.prevInput = inputs[slot] ?? 0;
      }
      if (++st.modeTicks >= C.COUNTDOWN_TICKS) {
        st.mode = 'racing';
        st.modeTicks = 0;
      }
      st.rng = this.rng.state();
      st.tick++;
      return;
    }

    if (st.mode === 'racing') {
      const leaderX = this.leaderX();
      for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
        const p = st.players[slot];
        if (!p || p.phase === 'pending') continue;
        const raw = inputs[slot] ?? null;
        if (raw === null) {
          if (++p.idleTicks >= C.DISCONNECT_GRACE_TICKS) p.disconnected = true;
        } else {
          p.idleTicks = 0;
          p.disconnected = false;
        }
        this.updateRider(p, raw ?? 0, leaderX);
        p.prevInput = raw ?? 0;
      }
      this.checkRaceEnd();
    } else if (st.mode === 'results') {
      if (++st.modeTicks >= C.FINISH_LINGER_TICKS) st.mode = 'done';
    }

    st.rng = this.rng.state();
    st.tick++;
  }

  /** Furthest forward x among riders in the race (for junior boost). */
  private leaderX(): number {
    let max = 0;
    for (const p of this.state.players) {
      if (p && p.phase !== 'pending' && p.x > max) max = p.x;
    }
    return max;
  }

  private updateRider(p: RiderState, input: InputBits, leaderX: number): void {
    if (p.phase === 'finished') {
      this.coast(p);
      return;
    }
    if (p.phase === 'wipeout') {
      if (--p.wipeoutTicks <= 0) this.remount(p);
      return;
    }
    if (p.staggerTicks > 0) p.staggerTicks--;
    if (p.laneCooldown > 0) p.laneCooldown--;

    // Disconnected riders coast to a stop, no input applied (SPEC §10).
    if (p.disconnected) {
      this.coast(p);
      this.finishCheck(p);
      return;
    }

    // 1. Lane switch (air or ground).
    if (p.laneCooldown === 0) {
      if (input & Button.Up && p.lane < C.LANE_COUNT - 1) {
        p.lane++;
        p.laneCooldown = C.LANE_SWITCH_COOLDOWN;
      } else if (input & Button.Down && p.lane > 0) {
        p.lane--;
        p.laneCooldown = C.LANE_SWITCH_COOLDOWN;
      }
    }

    if (p.airborne) this.airStep(p, input);
    else this.groundStep(p, input, leaderX);

    this.finishCheck(p);
  }

  private groundStep(p: RiderState, input: InputBits, leaderX: number): void {
    const pumping = !!(input & Button.B) && !p.gassed && p.legs > 0;
    const pedaling = !!(input & Button.A);

    // Legs.
    if (pumping) {
      p.legs -= C.LEGS_BOOST_DRAIN;
      if (p.legs <= 0) {
        p.legs = 0;
        p.gassed = true;
      }
    } else {
      p.legs = Math.min(C.LEGS_MAX, p.legs + C.LEGS_REGEN);
      if (p.gassed && p.legs >= C.LEGS_RECOVER_THRESHOLD) p.gassed = false;
    }

    // Target speed.
    let target = p.gassed ? C.GASSED_SPEED : pumping ? C.BOOST_SPEED : pedaling ? C.CRUISE_SPEED : C.ROLL_SPEED;
    if (this.state.juniorBoost) {
      const gapPx = Math.max(0, Math.floor((leaderX - p.x) / SUBPX));
      target += Math.min(C.JUNIOR_BOOST_MAX, Math.floor(gapPx / C.JUNIOR_BOOST_DIVISOR));
    }
    this.approach(p, target);

    // Ground obstacles (only when grounded — airborne riders jump them).
    this.applyGroundObstacles(p);

    // Ramp arming + pre-jump.
    const ramp = isRisingRamp(this.map, centerPx(p));
    if (ramp !== null) {
      const [num, den] =
        ramp === Tile.Slope45R ? [C.LAUNCH_NUM_45, C.LAUNCH_DEN_45] : [C.LAUNCH_NUM_22, C.LAUNCH_DEN_22];
      p.rampArmed = clamp(-Math.floor((p.speed * num) / den), -C.MAX_LAUNCH_VY, 0);
      if (input & Button.B && !p.prejumpUsed && p.legs >= C.PREJUMP_LEGS_COST) {
        p.prejumpBonus = C.PREJUMP_BONUS_VY;
        p.legs -= C.PREJUMP_LEGS_COST;
        p.prejumpUsed = true;
      }
    }

    // Integrate, hugging the surface with a gentle downward probe.
    const res = moveAABB(this.map, p.x, p.y, C.RIDER_HITBOX_W, C.RIDER_HITBOX_H, p.speed, C.GRAVITY);
    p.x = res.x;
    p.y = res.y;
    if (res.grounded) {
      p.vy = 0;
      p.grounded = true;
      if (ramp === null) {
        p.rampArmed = 0;
        p.prejumpBonus = 0;
        p.prejumpUsed = false;
      }
    } else {
      // Left the ground: launch if a ramp was armed, else roll off the edge.
      p.airborne = true;
      p.grounded = false;
      p.tilt = 0; // level pop (AIR_ROTATE governs in-air drift; 0 in v1)
      p.vy = p.rampArmed < 0 ? clamp(p.rampArmed - p.prejumpBonus, -C.MAX_LAUNCH_VY - C.PREJUMP_BONUS_VY, 0) : C.GRAVITY;
      p.rampArmed = 0;
      p.prejumpBonus = 0;
      p.prejumpUsed = false;
    }
  }

  private airStep(p: RiderState, input: InputBits): void {
    p.vy = Math.min(p.vy + C.GRAVITY, C.MAX_FALL_SPEED);
    if (input & Button.Left) p.tilt -= C.LEAN_RATE;
    if (input & Button.Right) p.tilt += C.LEAN_RATE;
    p.tilt += C.AIR_ROTATE;
    p.tilt = clamp(p.tilt, C.TILT_MIN, C.TILT_MAX);
    p.speed = Math.floor((p.speed * C.AIR_DRAG_NUM) / C.AIR_DRAG_DEN);

    const res = moveAABB(this.map, p.x, p.y, C.RIDER_HITBOX_W, C.RIDER_HITBOX_H, p.speed, p.vy);
    p.x = res.x;
    p.y = res.y;
    if (res.hitY && p.vy < 0) p.vy = 0; // bonked a ceiling
    if (res.grounded && p.vy >= 0) this.land(p);
  }

  private land(p: RiderState): void {
    const surface = surfaceAngleAt(this.map, centerPx(p));
    const diff = Math.abs(p.tilt - surface);
    if (diff > C.OK_LANDING_TOLERANCE) {
      this.wipeout(p);
      return;
    }
    if (diff <= C.CLEAN_LANDING_TOLERANCE) {
      p.legs = Math.min(C.LEGS_MAX, p.legs + C.LEGS_CLEAN_LANDING_REFILL);
    } else {
      p.speed = Math.floor((p.speed * C.OK_LANDING_SPEED_NUM) / C.OK_LANDING_SPEED_DEN);
    }
    p.tilt = surface;
    p.airborne = false;
    p.grounded = true;
    p.vy = 0;
  }

  /** Continuous mud cap + gated sprinkler/hose stumble + instant cone wipeout. */
  private applyGroundObstacles(p: RiderState): void {
    const cx = centerPx(p);
    const ctx = Math.floor(cx / C.TILE_SIZE);
    for (const o of this.obstacles) {
      if (o.lane !== p.lane) continue;
      if (ctx < o.tx || ctx >= o.tx + C.OBSTACLE_WIDTH_TILES) continue;
      switch (o.kind) {
        case 'mud':
          if (p.speed > C.MUD_SPEED) p.speed = C.MUD_SPEED;
          p.legs = Math.max(0, p.legs - C.MUD_LEGS_DRAIN);
          if (p.legs === 0) p.gassed = true;
          break;
        case 'sprinkler':
          if (this.sprinklerOn() && p.staggerTicks === 0) {
            p.speed = Math.floor((p.speed * C.SPRINKLER_SLOW_NUM) / C.SPRINKLER_SLOW_DEN);
            p.staggerTicks = C.STAGGER_TICKS;
          }
          break;
        case 'hose':
          if (p.staggerTicks === 0) {
            p.speed = Math.floor((p.speed * C.HOSE_SLOW_NUM) / C.HOSE_SLOW_DEN);
            p.staggerTicks = C.STAGGER_TICKS;
          }
          break;
        case 'cone':
          this.wipeout(p);
          return;
      }
    }
  }

  private sprinklerOn(): boolean {
    return this.state.tick % C.SPRINKLER_PERIOD < C.SPRINKLER_ON_TICKS;
  }

  private approach(p: RiderState, target: number): void {
    if (p.speed < target) p.speed = Math.min(target, p.speed + C.ACCEL);
    else if (p.speed > target) p.speed = Math.max(target, p.speed - C.DECEL);
    if (p.speed < 0) p.speed = 0;
  }

  /** No input: decelerate to a stop and settle on the ground (finished / disconnected). */
  private coast(p: RiderState): void {
    if (p.airborne) {
      this.airStep(p, 0);
      return;
    }
    p.speed = Math.max(0, p.speed - C.DECEL);
    const res = moveAABB(this.map, p.x, p.y, C.RIDER_HITBOX_W, C.RIDER_HITBOX_H, p.speed, C.GRAVITY);
    p.x = res.x;
    p.y = res.y;
    p.grounded = res.grounded;
    if (res.grounded) p.vy = 0;
  }

  private wipeout(p: RiderState): void {
    p.phase = 'wipeout';
    p.wipeoutTicks = C.WIPEOUT_TICKS;
    p.speed = 0;
    p.vy = 0;
    p.tilt = 0;
    p.airborne = false;
    p.rampArmed = 0;
    p.prejumpBonus = 0;
    p.prejumpUsed = false;
  }

  private remount(p: RiderState): void {
    p.phase = 'racing';
    p.legs = Math.min(C.LEGS_MAX, p.legs + C.WIPEOUT_LEGS_REFILL);
    p.gassed = false;
    // Settle onto the ground at the current column.
    p.y = (C.GROUND_ROW * C.TILE_SIZE - C.RIDER_HITBOX_H) * SUBPX;
    p.vy = 0;
    p.airborne = false;
    p.grounded = true;
  }

  private finishCheck(p: RiderState): void {
    if (p.phase === 'finished') return;
    if (centerPx(p) >= this.state.finishX * C.TILE_SIZE) {
      p.phase = 'finished';
      p.finishTick = this.state.tick;
      p.finishPlace = this.state.nextPlace++;
    }
  }

  /** End the race when everyone has finished, or at the timeout. */
  private checkRaceEnd(): void {
    const st = this.state;
    const racers = st.players.filter((p): p is RiderState => p !== null && p.phase !== 'pending');
    if (racers.length === 0) return;
    const timedOut = st.tick - C.COUNTDOWN_TICKS >= C.RACE_TIMEOUT_TICKS;
    const allDone = racers.every((p) => p.phase === 'finished');
    if (!allDone && !timedOut) return;
    // Place any unfinished riders by descending distance (slot order breaks ties).
    const unplaced = racers
      .filter((p) => p.finishPlace === 0)
      .sort((a, b) => b.x - a.x || st.players.indexOf(a) - st.players.indexOf(b));
    for (const p of unplaced) p.finishPlace = st.nextPlace++;
    st.mode = 'results';
    st.modeTicks = 0;
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
    const built = trackByIndex(this.state.track);
    this.map = built.map;
    this.obstacles = built.obstacles;
    this.spawn = built.spawn;
  }
}

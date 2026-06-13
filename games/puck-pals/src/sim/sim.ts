/**
 * Puck Pals — deterministic top-down arcade-hockey sim (games/puck-pals/SPEC.md).
 *
 * Versus is the point: 2 teams of 3 skaters + an auto-goalie, CPU-filled, on a
 * vertically-scrolling rink. Server-authoritative (ADR-003); the puck is always
 * server-owned. Determinism rules (lint-enforced in src/sim/): integer /
 * fixed-point math only, all randomness from `this.rng`, no DOM / wall-clock /
 * network. The exact per-tick update order is SPEC §10.
 */
import {
  Button,
  Rng,
  SUBPX,
  TileMap,
  aabbOverlap,
  fnv1a,
  moveAABB,
  type GameSim,
  type SlotInputs,
} from '@retro-recall/retrokit/sim';
import * as C from './constants';
import { attackDirY, buildRink } from './rink';

export type Mode =
  | 'faceoff'
  | 'play'
  | 'goal'
  | 'intermission'
  | 'overtime-faceoff'
  | 'overtime'
  | 'final';

export type Controller = 'human' | 'cpu';

export interface SkaterState {
  /** Stable id: team*10 + index (Home 0–2, Away 10–12). */
  id: number;
  team: number; // 0 Home, 1 Away
  index: number; // 0 Center, 1 Left Wing, 2 Right Wing
  x: number; // top-left, subpixels
  y: number;
  vx: number;
  vy: number;
  faceX: number; // last non-zero facing component, -1/0/1
  faceY: number;
  controller: Controller;
  /** Bound human slot (0–3), or -1 when CPU-only. */
  slot: number;
  charge: number; // slap charge ticks (0 = not charging)
  checkCooldown: number;
  tumble: number; // ticks left knocked down (0 = upright)
  prevInput: number;
  idleTicks: number; // disconnect-grace counter (human only)
  cpuHold: number; // ticks to keep the prior CPU decision (reaction delay)
}

export interface GoalieState {
  id: number; // team*10 + 9
  team: number;
  x: number; // top-left, subpixels
  y: number;
}

export interface PuckState {
  x: number; // top-left, subpixels
  y: number;
  vx: number;
  vy: number;
  carrier: number; // skater id, or -1 when loose
  cooldown: number; // possession cooldown (no re-grab while > 0)
  superSlap: boolean; // loose puck is a live super-slap (knocks down opponents)
  superSlapTeam: number; // which team fired it
}

export interface GameState {
  mode: Mode;
  modeTicks: number; // countdown within faceoff / goal / intermission
  period: number; // 0-based; regulation 0..PERIODS-1, overtime PERIODS+
  clock: number; // ticks left in the current play/overtime period
  otCount: number; // overtime chunks started (cap is OT_MAX_PERIODS)
  score: number[]; // [home, away]
  shots: number[]; // shots on goal [home, away]
  winner: number; // -1 none yet, else team index
  tick: number;
  rng: number;
  skaters: SkaterState[];
  goalies: GoalieState[];
  puck: PuckState;
}

const HALF_SK = (C.SKATER_HITBOX * SUBPX) / 2;
const HALF_PUCK = (C.PUCK_HITBOX * SUBPX) / 2;
const CARRY = C.PUCK_CARRY_OFFSET * SUBPX;
const PX = SUBPX;
const CENTER_TX = C.CENTER_X / C.TILE_SIZE; // 16
const CENTER_TY = C.CENTER_Y / C.TILE_SIZE; // 18

/** Truncate-toward-zero fixed-point scale (symmetric for ± velocities). */
const mul = (v: number, num: number, den: number): number => ((v * num) / den) | 0;
const clampAbs = (v: number, max: number): number => (v > max ? max : v < -max ? -max : v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class PuckPalsSim implements GameSim {
  state: GameState;
  private readonly map: TileMap;
  private rng: Rng;

  constructor(seed: number) {
    this.map = buildRink();
    this.rng = new Rng(seed);
    const skaters: SkaterState[] = [];
    for (let team = 0; team < C.TEAM_COUNT; team++) {
      for (let index = 0; index < C.SKATERS_PER_TEAM; index++) {
        skaters.push({
          id: team * 10 + index,
          team,
          index,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          faceX: 0,
          faceY: 1,
          controller: 'cpu',
          slot: -1,
          charge: 0,
          checkCooldown: 0,
          tumble: 0,
          prevInput: 0,
          idleTicks: 0,
          cpuHold: 0,
        });
      }
    }
    const goalies: GoalieState[] = [
      { id: 9, team: 0, x: 0, y: 0 },
      { id: 19, team: 1, x: 0, y: 0 },
    ];
    this.state = {
      mode: 'faceoff',
      modeTicks: 0,
      period: 0,
      clock: C.PERIOD_TICKS,
      otCount: 0,
      score: [0, 0],
      shots: [0, 0],
      winner: -1,
      tick: 0,
      rng: this.rng.state(),
      skaters,
      goalies,
      puck: { x: 0, y: 0, vx: 0, vy: 0, carrier: -1, cooldown: 0, superSlap: false, superSlapTeam: 0 },
    };
    this.startPeriod(0);
  }

  // --- NetSim player lifecycle (SPEC §3, §11) ---

  /** Bind a human to the lowest free skater on team `slot % 2`. */
  joinPlayer(slot: number): void {
    if (slot < 0 || slot >= C.MAX_PLAYERS) throw new Error('bad slot ' + slot);
    if (this.state.skaters.some((s) => s.slot === slot)) return; // already bound
    const team = slot % 2;
    const target = this.state.skaters.find((s) => s.team === team && s.slot === -1);
    if (!target) return; // team already full of humans
    target.slot = slot;
    target.controller = 'human';
    target.idleTicks = 0;
  }

  /** Reclaim a skater after a reconnect (SPEC §11): back to human, score kept. */
  rejoinPlayer(slot: number): void {
    const s = this.state.skaters.find((sk) => sk.slot === slot);
    if (!s) {
      this.joinPlayer(slot);
      return;
    }
    s.controller = 'human';
    s.idleTicks = 0;
  }

  get rinkMap(): TileMap {
    return this.map;
  }

  // --- Period / faceoff lifecycle (SPEC §8) ---

  private inOvertime(): boolean {
    return this.state.period >= C.PERIODS;
  }

  private startPeriod(period: number): void {
    const st = this.state;
    st.period = period;
    st.clock = this.inOvertime() ? C.OT_PERIOD_TICKS : C.PERIOD_TICKS;
    this.setFormation();
    st.mode = this.inOvertime() ? 'overtime-faceoff' : 'faceoff';
    st.modeTicks = C.FACEOFF_FREEZE_TICKS;
  }

  /** Faceoff after a goal — same period/clock, just reset the formation. */
  private startGoalFaceoff(): void {
    const st = this.state;
    this.setFormation();
    st.mode = this.inOvertime() ? 'overtime-faceoff' : 'faceoff';
    st.modeTicks = C.FACEOFF_FREEZE_TICKS;
  }

  /** Place both teams in formation and the puck at center ice. */
  private setFormation(): void {
    const st = this.state;
    for (const s of st.skaters) {
      const dir = attackDirY(s.team, st.period); // -1 attacks up
      const defendsBottom = dir === -1;
      const off = C.FORMATION[s.index]!;
      const dy = defendsBottom ? off.dy : -off.dy;
      const tx = CENTER_TX + off.dx;
      const ty = CENTER_TY + dy;
      s.x = (tx * C.TILE_SIZE + C.TILE_SIZE / 2 - C.SKATER_HITBOX / 2) * PX;
      s.y = (ty * C.TILE_SIZE + C.TILE_SIZE / 2 - C.SKATER_HITBOX / 2) * PX;
      s.vx = 0;
      s.vy = 0;
      s.faceX = 0;
      s.faceY = dir;
      s.charge = 0;
      s.checkCooldown = 0;
      s.tumble = 0;
    }
    for (const g of st.goalies) {
      const dir = attackDirY(g.team, st.period);
      // A team defends the net it does not attack.
      const lineY = dir === -1 ? C.GOAL_LINE_BOTTOM_Y : C.GOAL_LINE_TOP_Y;
      const cy = dir === -1 ? lineY - C.GOALIE_LINE_INSET : lineY + C.GOALIE_LINE_INSET;
      g.x = (C.CENTER_X - C.GOALIE_HITBOX_W / 2) * PX;
      g.y = (cy - C.GOALIE_HITBOX_H / 2) * PX;
    }
    st.puck = {
      x: (C.CENTER_X - C.PUCK_HITBOX / 2) * PX,
      y: (C.CENTER_Y - C.PUCK_HITBOX / 2) * PX,
      vx: 0,
      vy: 0,
      carrier: -1,
      cooldown: 0,
      superSlap: false,
      superSlapTeam: 0,
    };
  }

  private restart(): void {
    const st = this.state;
    st.score = [0, 0];
    st.shots = [0, 0];
    st.winner = -1;
    st.otCount = 0;
    this.startPeriod(0);
  }

  // --- Tick (SPEC §10) ---

  tick(inputs: SlotInputs): void {
    const st = this.state;

    // §10.1 resolve human inputs (disconnect grace → CPU); §10.2 CPU inputs.
    const bits = this.resolveBits(inputs);

    let anyStart = false;
    for (let slot = 0; slot < C.MAX_PLAYERS; slot++) {
      if ((inputs[slot] ?? 0) & Button.Start) anyStart = true;
    }

    switch (st.mode) {
      case 'faceoff':
      case 'overtime-faceoff':
        st.modeTicks--;
        if (st.modeTicks <= 0) st.mode = this.inOvertime() ? 'overtime' : 'play';
        break;
      case 'goal':
        st.modeTicks--;
        if (st.modeTicks <= 0) this.startGoalFaceoff();
        break;
      case 'intermission':
        st.modeTicks--;
        if (st.modeTicks <= 0) this.startPeriod(st.period + 1);
        break;
      case 'play':
      case 'overtime':
        this.updatePlay(bits);
        break;
      case 'final':
        if (anyStart) this.restart();
        break;
    }

    st.skaters.forEach((s, i) => (s.prevInput = bits[i]!));
    st.rng = this.rng.state();
    st.tick++;
  }

  /** Resolve a NES bitmask for every skater (human input or CPU heuristic). */
  private resolveBits(inputs: SlotInputs): number[] {
    const st = this.state;
    const out: number[] = [];
    for (const s of st.skaters) {
      if (s.controller === 'human') {
        const raw = s.slot >= 0 ? (inputs[s.slot] ?? null) : null;
        if (raw === null) {
          s.idleTicks++;
          if (s.idleTicks >= C.DISCONNECT_GRACE_TICKS) s.controller = 'cpu';
          out.push(s.controller === 'human' ? 0 : this.cpuInput(s));
        } else {
          s.idleTicks = 0;
          out.push(raw);
        }
      } else {
        out.push(this.cpuInput(s));
      }
    }
    return out;
  }

  // --- Play (SPEC §10 steps 3–8) ---

  private updatePlay(bits: number[]): void {
    const st = this.state;
    const skaters = st.skaters;

    // Intent pass: charge slaps and queue shoot/pass/check from input edges.
    const shootQ: { id: number; charge: number }[] = [];
    const passQ: number[] = [];
    const checkQ: number[] = [];
    skaters.forEach((s, i) => {
      const held = bits[i]!;
      const pressed = held & ~s.prevInput;
      const released = s.prevInput & ~held;
      if (s.tumble > 0) {
        s.charge = 0;
        return;
      }
      if (st.puck.carrier === s.id) {
        if (held & Button.B) s.charge = Math.min(s.charge + 1, C.SLAP_CHARGE_MAX_TICKS);
        if (released & Button.B && s.charge > 0) {
          shootQ.push({ id: s.id, charge: s.charge });
          s.charge = 0;
        }
        if (pressed & Button.A) passQ.push(s.id);
      } else {
        s.charge = 0;
        if (pressed & Button.B && s.checkCooldown <= 0) checkQ.push(s.id);
      }
    });

    // Step 3: skaters. Step 4: goalies.
    skaters.forEach((s, i) => this.moveSkater(s, bits[i]!));
    for (const g of st.goalies) this.moveGoalie(g);

    // Step 5: possession events — checks/steals, then loose pickups.
    for (const id of checkQ) this.resolveCheck(id);
    this.resolvePickups();

    // Step 6: puck.
    const scored = this.updatePuck();

    // Step 7: shots & passes (only if the skater still carries).
    for (const sh of shootQ) if (st.puck.carrier === sh.id) this.doShoot(sh.id, sh.charge);
    for (const id of passQ) if (st.puck.carrier === id) this.doPass(id);

    // Step 8: goals, clock, transitions.
    if (scored >= 0) this.handleGoal(scored);
    else this.tickClock();
  }

  private moveSkater(s: SkaterState, bits: number): void {
    if (s.checkCooldown > 0) s.checkCooldown--;

    if (s.tumble > 0) {
      s.vx = mul(s.vx, C.TUMBLE_FRICTION_NUM, C.TUMBLE_FRICTION_DEN);
      s.vy = mul(s.vy, C.TUMBLE_FRICTION_NUM, C.TUMBLE_FRICTION_DEN);
      s.tumble--;
    } else {
      const charging = s.charge > 0;
      const accel = charging ? mul(C.SKATE_ACCEL, C.CHARGE_MOVE_NUM, C.CHARGE_MOVE_DEN) : C.SKATE_ACCEL;
      const maxS = charging ? mul(C.SKATE_MAX_SPEED, C.CHARGE_MOVE_NUM, C.CHARGE_MOVE_DEN) : C.SKATE_MAX_SPEED;
      const fx = (bits & Button.Right ? 1 : 0) - (bits & Button.Left ? 1 : 0);
      const fy = (bits & Button.Down ? 1 : 0) - (bits & Button.Up ? 1 : 0);

      if (fx !== 0) s.vx = clampAbs(s.vx + fx * accel, maxS);
      else {
        s.vx = mul(s.vx, C.ICE_FRICTION_NUM, C.ICE_FRICTION_DEN);
        if (Math.abs(s.vx) < C.SKATE_STOP_EPS) s.vx = 0;
      }
      if (fy !== 0) s.vy = clampAbs(s.vy + fy * accel, maxS);
      else {
        s.vy = mul(s.vy, C.ICE_FRICTION_NUM, C.ICE_FRICTION_DEN);
        if (Math.abs(s.vy) < C.SKATE_STOP_EPS) s.vy = 0;
      }
      if (fx !== 0 || fy !== 0) {
        s.faceX = fx;
        s.faceY = fy;
      }
    }

    const res = moveAABB(this.map, s.x, s.y, C.SKATER_HITBOX, C.SKATER_HITBOX, s.vx, s.vy);
    s.x = res.x;
    s.y = res.y;
    if (res.hitX) s.vx = 0;
    if (res.hitY) s.vy = 0;
  }

  private moveGoalie(g: GoalieState): void {
    const st = this.state;
    const puckCx = st.puck.x + HALF_PUCK;
    const desiredCx = clamp(
      puckCx,
      (C.CENTER_X - C.GOALIE_CREASE_HALF) * PX,
      (C.CENTER_X + C.GOALIE_CREASE_HALF) * PX,
    );
    const desiredX = desiredCx - (C.GOALIE_HITBOX_W * PX) / 2;
    g.x += clampAbs(desiredX - g.x, C.GOALIE_SPEED);
  }

  // --- Possession (SPEC §4, §7) ---

  private resolveCheck(id: number): void {
    const st = this.state;
    const s = this.skater(id);
    if (!s || s.tumble > 0) return;
    s.checkCooldown = C.CHECK_COOLDOWN_TICKS;
    let target: SkaterState | null = null;
    let bestD = (C.STEAL_RADIUS * PX) ** 2;
    for (const o of st.skaters) {
      if (o.team === s.team || o.tumble > 0) continue;
      const d = this.distSq(s, o);
      if (d <= bestD) {
        bestD = d;
        target = o;
      }
    }
    if (!target) return;
    const fast = s.vx * s.vx + s.vy * s.vy > C.CHECK_MIN_SPEED * C.CHECK_MIN_SPEED;
    if (fast) {
      this.tumbleSkater(target, Math.sign(s.vx || s.faceX), Math.sign(s.vy || s.faceY));
    } else if (st.puck.carrier === target.id) {
      this.dropPuck(target, true, s); // poke-steal: pop the puck loose
    }
  }

  private resolvePickups(): void {
    const st = this.state;
    if (st.puck.carrier >= 0 || st.puck.cooldown > 0) return;
    const r = (C.PUCK_PICKUP_RADIUS * PX) ** 2;
    const pcx = st.puck.x + HALF_PUCK;
    const pcy = st.puck.y + HALF_PUCK;
    for (const s of st.skaters) {
      if (s.tumble > 0) continue;
      const dx = s.x + HALF_SK - pcx;
      const dy = s.y + HALF_SK - pcy;
      if (dx * dx + dy * dy <= r) {
        st.puck.carrier = s.id;
        st.puck.vx = 0;
        st.puck.vy = 0;
        st.puck.superSlap = false;
        return;
      }
    }
  }

  // --- Puck (SPEC §6) ---

  /** Advance the puck. Returns the scoring team, or -1 if no goal this tick. */
  private updatePuck(): number {
    const st = this.state;
    const p = st.puck;
    if (p.cooldown > 0) p.cooldown--;

    if (p.carrier >= 0) {
      const c = this.skater(p.carrier);
      if (!c || c.tumble > 0) {
        if (c) this.dropPuck(c, false, null);
      } else {
        const cx = c.x + HALF_SK + c.faceX * CARRY;
        const cy = c.y + HALF_SK + c.faceY * CARRY;
        p.x = clamp(cx - HALF_PUCK, C.TILE_SIZE * PX, (C.RINK_PX_W - C.TILE_SIZE - C.PUCK_HITBOX) * PX);
        p.y = clamp(cy - HALF_PUCK, C.TILE_SIZE * PX, (C.RINK_PX_H - C.TILE_SIZE - C.PUCK_HITBOX) * PX);
        p.vx = 0;
        p.vy = 0;
        return -1;
      }
    }

    // Loose: friction, move + board reflect, goalie save, then goal test.
    p.vx = mul(p.vx, C.PUCK_FRICTION_NUM, C.PUCK_FRICTION_DEN);
    p.vy = mul(p.vy, C.PUCK_FRICTION_NUM, C.PUCK_FRICTION_DEN);
    if (Math.abs(p.vx) < C.PUCK_STOP_EPS && Math.abs(p.vy) < C.PUCK_STOP_EPS) {
      p.vx = 0;
      p.vy = 0;
      p.superSlap = false;
    }

    const res = moveAABB(this.map, p.x, p.y, C.PUCK_HITBOX, C.PUCK_HITBOX, p.vx, p.vy, true);
    p.x = res.x;
    p.y = res.y;
    if (res.hitX) p.vx = -mul(p.vx, C.BOARD_RESTITUTION_NUM, C.BOARD_RESTITUTION_DEN);
    if (res.hitY) p.vy = -mul(p.vy, C.BOARD_RESTITUTION_NUM, C.BOARD_RESTITUTION_DEN);

    if (this.goalieSave()) return -1;
    if (p.superSlap) this.superSlapKnockdowns();
    return this.goalTest();
  }

  /** Reflect the puck off a goalie if it overlaps one; counts a shot on goal. */
  private goalieSave(): boolean {
    const st = this.state;
    const p = st.puck;
    for (const g of st.goalies) {
      if (!aabbOverlap(p.x, p.y, C.PUCK_HITBOX, C.PUCK_HITBOX, g.x, g.y, C.GOALIE_HITBOX_W, C.GOALIE_HITBOX_H)) {
        continue;
      }
      const rebound = Math.abs(mul(p.vy, C.BOARD_RESTITUTION_NUM, C.BOARD_RESTITUTION_DEN)) || C.PUCK_STOP_EPS;
      if (g.y + (C.GOALIE_HITBOX_H * PX) / 2 < C.CENTER_Y * PX) {
        p.y = g.y + C.GOALIE_HITBOX_H * PX; // top-net goalie shoves the puck back down
        p.vy = rebound;
      } else {
        p.y = g.y - C.PUCK_HITBOX * PX;
        p.vy = -rebound;
      }
      p.superSlap = false;
      p.cooldown = C.POSSESSION_COOLDOWN_TICKS;
      st.shots[1 - g.team] = (st.shots[1 - g.team] ?? 0) + 1; // a save = a shot on goal
      return true;
    }
    return false;
  }

  private superSlapKnockdowns(): void {
    const st = this.state;
    const p = st.puck;
    for (const s of st.skaters) {
      if (s.team === p.superSlapTeam || s.tumble > 0) continue;
      if (aabbOverlap(p.x, p.y, C.PUCK_HITBOX, C.PUCK_HITBOX, s.x, s.y, C.SKATER_HITBOX, C.SKATER_HITBOX)) {
        this.tumbleSkater(s, Math.sign(p.vx), Math.sign(p.vy));
      }
    }
  }

  /** Returns the scoring team if the puck crossed a goal line in the mouth. */
  private goalTest(): number {
    const st = this.state;
    const p = st.puck;
    const pcx = p.x + HALF_PUCK;
    const pcy = p.y + HALF_PUCK;
    if (Math.abs(pcx - C.CENTER_X * PX) > C.GOAL_MOUTH_HALF * PX) return -1;
    if (pcy <= C.GOAL_LINE_TOP_Y * PX) return attackDirY(0, st.period) === -1 ? 0 : 1;
    if (pcy >= C.GOAL_LINE_BOTTOM_Y * PX) return attackDirY(0, st.period) === 1 ? 0 : 1;
    return -1;
  }

  // --- Shots & passes (SPEC §4, §5) ---

  private doShoot(id: number, charge: number): void {
    const s = this.skater(id)!;
    const speed = C.SHOT_SPEED + mul(C.SUPER_SLAP_SPEED - C.SHOT_SPEED, charge, C.SLAP_CHARGE_MAX_TICKS);
    const [fx, fy] = this.facingOr(s);
    const p = this.state.puck;
    p.carrier = -1;
    p.vx = fx * speed;
    p.vy = fy * speed;
    p.cooldown = C.POSSESSION_COOLDOWN_TICKS;
    p.superSlap = charge >= C.SUPER_SLAP_THRESHOLD;
    p.superSlapTeam = s.team;
  }

  private doPass(id: number): void {
    const s = this.skater(id)!;
    const [fx, fy] = this.facingOr(s);
    const p = this.state.puck;
    p.carrier = -1;
    p.vx = fx * C.PASS_SPEED;
    p.vy = fy * C.PASS_SPEED;
    p.cooldown = C.POSSESSION_COOLDOWN_TICKS;
    p.superSlap = false;
  }

  /** Facing as a direction; falls back to the team's attack direction. */
  private facingOr(s: SkaterState): [number, number] {
    if (s.faceX !== 0 || s.faceY !== 0) return [s.faceX, s.faceY];
    return [0, attackDirY(s.team, this.state.period)];
  }

  /** Knock a skater down; drop the puck if they carried it. */
  private tumbleSkater(s: SkaterState, dirx: number, diry: number): void {
    if (this.state.puck.carrier === s.id) this.dropPuck(s, false, null);
    s.tumble = C.TUMBLE_TICKS;
    s.charge = 0;
    s.vx = (dirx || 0) * C.SKATE_MAX_SPEED;
    s.vy = (diry || 0) * C.SKATE_MAX_SPEED;
  }

  /** Carrier loses the puck — it goes loose at its current spot. */
  private dropPuck(carrier: SkaterState, kick: boolean, stealer: SkaterState | null): void {
    const p = this.state.puck;
    if (p.carrier !== carrier.id) return;
    p.carrier = -1;
    p.cooldown = C.POSSESSION_COOLDOWN_TICKS;
    p.superSlap = false;
    if (kick && stealer) {
      p.vx = (Math.sign(carrier.x - stealer.x) || carrier.faceX || 1) * C.STEAL_KICK_SPEED;
      p.vy = (Math.sign(carrier.y - stealer.y) || carrier.faceY) * C.STEAL_KICK_SPEED;
    } else {
      p.vx = 0;
      p.vy = 0;
    }
  }

  // --- Goals, clock, end-of-game (SPEC §8) ---

  private handleGoal(team: number): void {
    const st = this.state;
    st.score[team] = (st.score[team] ?? 0) + 1;
    st.shots[team] = (st.shots[team] ?? 0) + 1;
    if (this.inOvertime()) {
      this.finalize(team); // golden goal
      return;
    }
    st.mode = 'goal';
    st.modeTicks = C.GOAL_CELEBRATE_TICKS;
  }

  private tickClock(): void {
    const st = this.state;
    st.clock--;
    if (st.clock > 0) return;
    if (!this.inOvertime()) {
      if (st.period < C.PERIODS - 1) {
        st.mode = 'intermission';
        st.modeTicks = C.INTERMISSION_TICKS;
      } else if (st.score[0] !== st.score[1]) {
        this.finalize(st.score[0]! > st.score[1]! ? 0 : 1);
      } else {
        st.otCount = 1;
        this.startPeriod(C.PERIODS); // first overtime chunk
      }
    } else if (st.otCount >= C.OT_MAX_PERIODS) {
      this.finalize(this.tiebreakWinner());
    } else {
      st.otCount++;
      this.startPeriod(st.period + 1);
    }
  }

  /** Shots-on-goal decides; Away (challenger) wins a dead-even marathon. */
  private tiebreakWinner(): number {
    const st = this.state;
    if (st.shots[0]! > st.shots[1]!) return 0;
    return 1;
  }

  private finalize(team: number): void {
    this.state.mode = 'final';
    this.state.winner = team;
  }

  // --- CPU AI (SPEC §11.1) ---

  private cpuInput(s: SkaterState): number {
    if (s.tumble > 0) return 0;
    if (s.cpuHold > 0) {
      s.cpuHold--;
      return s.prevInput;
    }
    s.cpuHold = this.rng.int(C.CPU_REACT_JITTER); // reaction delay (deterministic)
    return this.cpuDecision(s);
  }

  private cpuDecision(s: SkaterState): number {
    const st = this.state;
    const p = st.puck;
    const cx = s.x + HALF_SK;
    const cy = s.y + HALF_SK;
    const dir = attackDirY(s.team, st.period);
    const goalLineY = (dir === -1 ? C.GOAL_LINE_TOP_Y : C.GOAL_LINE_BOTTOM_Y) * PX;
    const goalX = C.CENTER_X * PX;

    if (p.carrier === s.id) {
      // I have the puck: drive to the net, shoot in range, pass under pressure.
      const distGoalSq = (cx - goalX) ** 2 + (cy - goalLineY) ** 2;
      const opp = this.nearestOpponent(s);
      if (opp && this.distSq(s, opp) <= (C.CPU_PRESSURE_RANGE * PX) ** 2) return Button.A;
      if (distGoalSq <= (C.CPU_SHOOT_RANGE * PX) ** 2) {
        return s.charge > 0 && distGoalSq <= ((C.CPU_SHOOT_RANGE / 2) * PX) ** 2
          ? this.bitsToward(cx, cy, goalX, goalLineY) // release (no B) → fire
          : Button.B | this.bitsToward(cx, cy, goalX, goalLineY);
      }
      return this.bitsToward(cx, cy, goalX, goalLineY);
    }

    if (p.carrier >= 0 && this.skater(p.carrier)!.team !== s.team) {
      // Opponent has it: nearest defender forechecks; others cover the slot.
      const carrier = this.skater(p.carrier)!;
      const tcx = carrier.x + HALF_SK;
      const tcy = carrier.y + HALF_SK;
      if (this.isTeamNearestTo(s, tcx, tcy)) {
        let b = this.bitsToward(cx, cy, tcx, tcy);
        if (this.distSq(s, carrier) <= (C.STEAL_RADIUS * PX) ** 2 && s.checkCooldown <= 0) b |= Button.B;
        return b;
      }
      const slotY = (dir === -1 ? C.GOAL_LINE_TOP_Y + 48 : C.GOAL_LINE_BOTTOM_Y - 48) * PX;
      return this.bitsToward(cx, cy, goalX, slotY);
    }

    // Loose puck: the nearest skater chases; others hold a supporting spot.
    const pcx = p.x + HALF_PUCK;
    const pcy = p.y + HALF_PUCK;
    if (this.isTeamNearestTo(s, pcx, pcy)) return this.bitsToward(cx, cy, pcx, pcy);
    const homeY = (dir === -1 ? C.CENTER_Y - 40 : C.CENTER_Y + 40) * PX;
    return this.bitsToward(cx, cy, pcx, homeY);
  }

  private bitsToward(cx: number, cy: number, tx: number, ty: number): number {
    const eps = 3 * PX;
    let b = 0;
    if (tx < cx - eps) b |= Button.Left;
    else if (tx > cx + eps) b |= Button.Right;
    if (ty < cy - eps) b |= Button.Up;
    else if (ty > cy + eps) b |= Button.Down;
    return b;
  }

  private nearestOpponent(s: SkaterState): SkaterState | null {
    let best: SkaterState | null = null;
    let bestD = Infinity;
    for (const o of this.state.skaters) {
      if (o.team === s.team) continue;
      const d = this.distSq(s, o);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** True if s is the closest upright skater on its team to (tx,ty). */
  private isTeamNearestTo(s: SkaterState, tx: number, ty: number): boolean {
    const mine = (s.x + HALF_SK - tx) ** 2 + (s.y + HALF_SK - ty) ** 2;
    for (const o of this.state.skaters) {
      if (o.team !== s.team || o.id === s.id || o.tumble > 0) continue;
      const d = (o.x + HALF_SK - tx) ** 2 + (o.y + HALF_SK - ty) ** 2;
      if (d < mine || (d === mine && o.id < s.id)) return false;
    }
    return true;
  }

  private distSq(a: SkaterState, b: SkaterState): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  private skater(id: number): SkaterState | undefined {
    return this.state.skaters.find((s) => s.id === id);
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

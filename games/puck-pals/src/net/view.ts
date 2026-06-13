/**
 * View assembly for online play (ADR-003). Remote entities (the puck, opponents,
 * CPUs, goalies) interpolate between the last two server snapshots (~50 ms
 * display delay); the local skater comes from the predicted sim, with visual
 * corrections capped per frame unless divergence is large (then snap).
 * Shell-side only — nothing here feeds back into any sim. The puck is always
 * server-owned (SPEC §11), so it is never predicted, only interpolated.
 */
import { SUBPX } from '@retro-recall/retrokit/sim';
import type { RoomClient } from '@retro-recall/netcode';
import type { PuckPalsSim, GameState } from '../sim/sim';

const SNAP_INTERVAL_MS = 50; // snapshots arrive at ~20 Hz
const CORRECT_PER_FRAME = 3 * SUBPX;
const SNAP_DIVERGENCE = 24 * SUBPX;

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

interface Positioned {
  id: number;
  x: number;
  y: number;
}

const lerpById = <T extends Positioned>(prev: T[], next: T[], t: number): T[] => {
  const byId = new Map(prev.map((e) => [e.id, e]));
  return next.map((e) => {
    const p = byId.get(e.id);
    return p ? { ...e, x: lerp(p.x, e.x, t), y: lerp(p.y, e.y, t) } : e;
  });
};

export class NetView {
  private readonly client: RoomClient<PuckPalsSim>;
  private parsed = new Map<number, GameState>();
  private latestArrivedAt = 0;
  private latestTickSeen = -1;
  /** Smoothed display position of the local skater. */
  private dispX: number | null = null;
  private dispY: number | null = null;

  constructor(client: RoomClient<PuckPalsSim>) {
    this.client = client;
  }

  private parseSnap(ref: { tick: number; state: string } | null): GameState | null {
    if (!ref) return null;
    let st = this.parsed.get(ref.tick);
    if (!st) {
      st = JSON.parse(ref.state) as GameState;
      this.parsed.set(ref.tick, st);
      for (const t of this.parsed.keys()) {
        if (t < ref.tick - 120) this.parsed.delete(t);
      }
    }
    return st;
  }

  /** Compose the state to draw this frame, or null before the first snapshot. */
  frame(nowMs: number): GameState | null {
    const c = this.client;
    const latest = this.parseSnap(c.snapLatest);
    if (!latest) return null;
    if (c.snapLatest!.tick !== this.latestTickSeen) {
      this.latestTickSeen = c.snapLatest!.tick;
      this.latestArrivedAt = nowMs;
    }
    const prev = this.parseSnap(c.snapPrev);

    let view: GameState = latest;
    // Interpolate only within a continuous run of play — a faceoff/goal reset
    // teleports formations, and interpolating across it would smear.
    if (prev && prev.period === latest.period && prev.mode === latest.mode) {
      const alpha = Math.min(Math.max((nowMs - this.latestArrivedAt) / SNAP_INTERVAL_MS, 0), 1);
      const carrierSame = prev.puck.carrier === latest.puck.carrier;
      view = {
        ...latest,
        skaters: lerpById(prev.skaters, latest.skaters, alpha),
        goalies: lerpById(prev.goalies, latest.goalies, alpha),
        puck: carrierSame
          ? {
              ...latest.puck,
              x: lerp(prev.puck.x, latest.puck.x, alpha),
              y: lerp(prev.puck.y, latest.puck.y, alpha),
            }
          : latest.puck,
      };
    }

    // Local skater: predicted, with capped visual correction toward the server.
    const slot = c.slot;
    const pred = slot >= 0 ? c.predicted?.state.skaters.find((s) => s.slot === slot) : undefined;
    if (pred) {
      let { x, y } = pred;
      if (this.dispX === null || this.dispY === null) {
        this.dispX = x;
        this.dispY = y;
      } else {
        const dx = x - this.dispX;
        const dy = y - this.dispY;
        if (Math.abs(dx) > SNAP_DIVERGENCE || Math.abs(dy) > SNAP_DIVERGENCE) {
          this.dispX = x;
          this.dispY = y;
        } else {
          this.dispX += Math.sign(dx) * Math.min(Math.abs(dx), CORRECT_PER_FRAME);
          this.dispY += Math.sign(dy) * Math.min(Math.abs(dy), CORRECT_PER_FRAME);
        }
      }
      x = this.dispX;
      y = this.dispY;
      view = {
        ...view,
        skaters: view.skaters.map((s) => (s.slot === slot ? { ...pred, x, y } : s)),
      };
    }
    return view;
  }
}

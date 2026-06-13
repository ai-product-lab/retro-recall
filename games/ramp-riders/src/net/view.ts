/**
 * View assembly for online play (ADR-003 / SPEC §10): rival riders interpolate
 * between the last two server snapshots (~50 ms display delay); the local rider
 * comes from the predicted sim, with visual corrections capped per frame unless
 * divergence is large (then snap). Riders never collide, so this is all the
 * smoothing a race needs. Shell-side only — nothing here feeds a sim.
 */
import { SUBPX } from '@retro-recall/retrokit/sim';
import type { RoomClient } from '@retro-recall/netcode';
import type { GameState, RampRidersSim, RiderState } from '../sim/sim';

const SNAP_INTERVAL_MS = 50; // snapshots arrive at ~20 Hz
const CORRECT_PER_FRAME = 3 * SUBPX;
const SNAP_DIVERGENCE = 24 * SUBPX;

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

export class NetView {
  private parsed = new Map<number, GameState>();
  private latestArrivedAt = 0;
  private latestTickSeen = -1;
  private dispX: number | null = null;
  private dispY: number | null = null;

  constructor(private readonly client: RoomClient<RampRidersSim>) {}

  private parseSnap(ref: { tick: number; state: string } | null): GameState | null {
    if (!ref) return null;
    let st = this.parsed.get(ref.tick);
    if (!st) {
      st = JSON.parse(ref.state) as GameState;
      this.parsed.set(ref.tick, st);
      for (const t of this.parsed.keys()) if (t < ref.tick - 60) this.parsed.delete(t);
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
    if (prev) {
      const alpha = Math.min(Math.max((nowMs - this.latestArrivedAt) / SNAP_INTERVAL_MS, 0), 1);
      view = {
        ...latest,
        players: latest.players.map((p, slot) => {
          const q = prev.players[slot];
          if (!p || !q || p.phase !== q.phase) return p;
          return { ...p, x: lerp(q.x, p.x, alpha), y: lerp(q.y, p.y, alpha) };
        }),
      };
    }

    // Local rider: predicted, with capped visual correction.
    const slot = c.slot;
    const pred: RiderState | null | undefined = c.predicted?.state.players[slot];
    if (slot >= 0 && pred && view.players[slot]) {
      let { x, y } = pred;
      if (pred.phase !== 'pending') {
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
      } else {
        this.dispX = this.dispY = null;
      }
      view = {
        ...view,
        players: view.players.map((p, s) => (s === slot ? { ...pred, x, y } : p)),
      };
    }
    return view;
  }
}

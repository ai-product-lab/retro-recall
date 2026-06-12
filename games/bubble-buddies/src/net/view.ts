/**
 * View assembly for online play (ADR-003): remote entities interpolate
 * between the last two server snapshots (~50 ms display delay); the local
 * player comes from the predicted sim, with visual corrections capped at
 * 2 px/frame unless divergence exceeds 16 px (then snap). Shell-side only —
 * nothing here feeds back into any sim.
 */
import { SUBPX, TileMap } from '@retro-recall/retrokit/sim';
import type { RoomClient } from '@retro-recall/netcode';
import * as C from '../sim/constants';
import { LEVELS } from '../sim/levels';
import type { BubbleBuddiesSim, GameState } from '../sim/sim';

const SNAP_INTERVAL_MS = 50; // snapshots arrive at 20 Hz
const CORRECT_PER_FRAME = 2 * SUBPX;
const SNAP_DIVERGENCE = 16 * SUBPX;

const mapCache = new Map<number, TileMap>();
export const levelMap = (index: number): TileMap => {
  let m = mapCache.get(index);
  if (!m) {
    m = TileMap.parse(LEVELS[index]!.rows, C.TILE_SIZE).map;
    mapCache.set(index, m);
  }
  return m;
};

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
  private readonly client: RoomClient<BubbleBuddiesSim>;
  private parsed = new Map<number, GameState>();
  private latestArrivedAt = 0;
  private latestTickSeen = -1;
  /** Smoothed display position of the local player. */
  private dispX: number | null = null;
  private dispY: number | null = null;

  constructor(client: RoomClient<BubbleBuddiesSim>) {
    this.client = client;
  }

  private parseSnap(ref: { tick: number; state: string } | null): GameState | null {
    if (!ref) return null;
    let st = this.parsed.get(ref.tick);
    if (!st) {
      st = JSON.parse(ref.state) as GameState;
      this.parsed.set(ref.tick, st);
      for (const t of this.parsed.keys()) {
        if (t < ref.tick - 60) this.parsed.delete(t);
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

    // Remote entities: interpolate prev → latest by arrival-clock alpha.
    let view: GameState = latest;
    if (prev && prev.level === latest.level) {
      const alpha = Math.min(Math.max((nowMs - this.latestArrivedAt) / SNAP_INTERVAL_MS, 0), 1);
      view = {
        ...latest,
        players: latest.players.map((p, slot) => {
          const q = prev.players[slot];
          if (!p || !q || p.phase !== q.phase) return p;
          return { ...p, x: lerp(q.x, p.x, alpha), y: lerp(q.y, p.y, alpha) };
        }),
        bubbles: lerpById(prev.bubbles, latest.bubbles, alpha),
        enemies: lerpById(prev.enemies, latest.enemies, alpha),
        fruit: lerpById(prev.fruit, latest.fruit, alpha),
      };
    }

    // Local player: predicted, with capped visual correction.
    const slot = c.slot;
    const pred = c.predicted?.state.players[slot ?? -1];
    if (slot >= 0 && pred && view.players[slot]) {
      let { x, y } = pred;
      if (pred.phase === 'alive' || pred.phase === 'bubble') {
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

/**
 * Ramp Riders renderer. Reads sim state read-only and draws a camera-scrolled
 * side view: dirt terrain + ramps, obstacles, BMX riders (rotated by tilt,
 * fanned by lane), and the HUD. Floats / ctx transforms are fine here — render
 * never feeds the sim. Per-client: the camera follows the local rider, rivals
 * are drawn as ghosts, and off-screen rivals show as edge pips (SPEC §9).
 *
 * Placeholder art (original, ADR-005): a chunky kid-on-a-BMX silhouette. Avatar
 * body rigs arrive from packages/avatar after that lands on main (SPEC §13).
 */
import type { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Camera, visibleTileRange } from '@retro-recall/retrokit/camera';
import { SUBPX, Tile, isSlope, slopeColumnHeight } from '@retro-recall/retrokit/sim';
import * as C from '../sim/constants';
import { trackByIndex } from '../sim/tracks';
import type { BuiltTrack } from '../sim/segments';
import type { GameState, RiderState } from '../sim/sim';

const px = (subpx: number): number => Math.floor(subpx / SUBPX);

const COLORS = {
  skyTop: '#1a2348',
  skyBottom: '#2b3a6b',
  dirt: '#7a4a24',
  dirtDark: '#5e3417',
  grass: '#3da35d',
  grassDark: '#2c7d44',
  mud: '#3b2a1a',
  cone: '#ff7a1a',
  hose: '#39c06a',
  spray: '#9fe6ff',
  hud: '#f2efe9',
  hudDim: '#9aa3b2',
  legs: '#3df5a6',
  legsLow: '#ff6b6b',
} as const;

/** Per-slot rider tints (BRAND palette). Slot 0 is coral (the cabinet accent). */
const SLOT_COLORS = ['#ff6b6b', '#4cc9f0', '#ffd166', '#3df5a6'];

const PLACE_LABEL = ['', '1st', '2nd', '3rd', '4th'];
/** Vertical fan so 3 lanes read as depth: back lane sits higher/smaller. */
const laneShiftY = (lane: number): number => (lane - 1) * -9;

export class RampRidersView {
  private cam = new Camera(C.VIEW_W, C.VIEW_H);
  private track: BuiltTrack | null = null;
  private trackIdx = -1;

  /** localSlot = the rider this client controls (camera + highlight). */
  render(r: Canvas2DRenderer, state: GameState, localSlot = 0): void {
    if (this.trackIdx !== state.track) {
      this.track = trackByIndex(state.track);
      this.trackIdx = state.track;
    }
    const track = this.track!;
    const world = { w: track.map.pixelWidth, h: track.map.pixelHeight };

    const me = this.viewTarget(state, localSlot);
    if (me) {
      this.cam.follow(px(me.x) + (C.RIDER_HITBOX_W >> 1), C.VIEW_H >> 1, world, {
        deadzoneW: C.CAM_DEADZONE_W,
      });
    }

    this.drawSky(r);
    this.drawTerrain(r, track);
    this.drawFinish(r, track);
    this.drawObstacles(r, track, state.tick);

    // Rivals first (ghosts), then the local rider on top.
    state.players.forEach((p, slot) => {
      if (!p || p.phase === 'pending' || slot === localSlot) return;
      this.drawRider(r, p, slot, true);
    });
    if (me) this.drawRider(r, me, localSlot, false);

    this.drawHud(r, state, localSlot);
  }

  private viewTarget(state: GameState, localSlot: number): RiderState | null {
    const me = state.players[localSlot];
    if (me && me.phase !== 'pending') return me;
    return state.players.find((p): p is RiderState => !!p && p.phase !== 'pending') ?? null;
  }

  // --- world layers (camera-translated) ---

  private drawSky(r: Canvas2DRenderer): void {
    const g = r.ctx.createLinearGradient(0, 0, 0, C.VIEW_H);
    g.addColorStop(0, COLORS.skyTop);
    g.addColorStop(1, COLORS.skyBottom);
    r.ctx.fillStyle = g;
    r.ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
  }

  private drawTerrain(r: Canvas2DRenderer, track: BuiltTrack): void {
    const map = track.map;
    const ts = map.tileSize;
    const groundY = C.GROUND_ROW * ts;
    const { tx0, tx1 } = visibleTileRange(this.cam, ts, map.width, map.height);
    const ctx = r.ctx;
    for (let tx = tx0; tx <= tx1; tx++) {
      const sx = tx * ts - this.cam.x;
      for (let ty = 0; ty < map.height; ty++) {
        const t = map.at(tx, ty);
        const sy = ty * ts - this.cam.y;
        if (t === Tile.Solid) {
          ctx.fillStyle = COLORS.dirt;
          ctx.fillRect(sx, sy, ts, ts);
          if (map.at(tx, ty - 1) === Tile.Empty) {
            ctx.fillStyle = COLORS.grass; // grass cap
            ctx.fillRect(sx, sy, ts, 2);
            ctx.fillStyle = COLORS.grassDark;
            ctx.fillRect(sx, sy + 2, ts, 1);
          }
        } else if (isSlope(t)) {
          const hL = slopeColumnHeight(t, ts, 0);
          const hR = slopeColumnHeight(t, ts, ts - 1);
          // dirt mound: slope top edge down past the ground baseline
          ctx.fillStyle = COLORS.dirt;
          ctx.beginPath();
          ctx.moveTo(sx, sy + ts - hL);
          ctx.lineTo(sx + ts, sy + ts - hR);
          ctx.lineTo(sx + ts, groundY - this.cam.y);
          ctx.lineTo(sx, groundY - this.cam.y);
          ctx.closePath();
          ctx.fill();
          // grass edge along the ramp surface
          ctx.strokeStyle = COLORS.grass;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx, sy + ts - hL);
          ctx.lineTo(sx + ts, sy + ts - hR);
          ctx.stroke();
        }
      }
    }
  }

  private drawFinish(r: Canvas2DRenderer, track: BuiltTrack): void {
    const ts = track.map.tileSize;
    const sx = track.finishX * ts - this.cam.x;
    if (sx < -16 || sx > C.VIEW_W + 16) return;
    const top = C.GROUND_ROW * ts - 40 - this.cam.y;
    const ctx = r.ctx;
    // checkered banner
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#0f1222' : COLORS.hud;
      ctx.fillRect(sx, top + i * 4, 10, 4);
    }
    ctx.fillStyle = COLORS.hudDim;
    ctx.fillRect(sx - 1, top, 2, C.GROUND_ROW * ts - top);
  }

  private drawObstacles(r: Canvas2DRenderer, track: BuiltTrack, tick: number): void {
    const ts = track.map.tileSize;
    const groundY = C.GROUND_ROW * ts - this.cam.y;
    const ctx = r.ctx;
    const sprinklerOn = tick % C.SPRINKLER_PERIOD < C.SPRINKLER_ON_TICKS;
    for (const o of track.obstacles) {
      const sx = o.tx * ts - this.cam.x;
      if (sx < -32 || sx > C.VIEW_W + 32) continue;
      const w = C.OBSTACLE_WIDTH_TILES * ts;
      const y = groundY + laneShiftY(o.lane);
      switch (o.kind) {
        case 'mud':
          ctx.fillStyle = COLORS.mud;
          ctx.beginPath();
          ctx.ellipse(sx + w / 2, y, w / 2, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'sprinkler':
          ctx.fillStyle = COLORS.hudDim;
          ctx.fillRect(sx + w / 2 - 1, y - 6, 2, 6);
          if (sprinklerOn) {
            ctx.fillStyle = COLORS.spray;
            for (let i = -2; i <= 2; i++) ctx.fillRect(sx + w / 2 + i * 3, y - 12, 1, 8);
          }
          break;
        case 'hose':
          ctx.strokeStyle = COLORS.hose;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= w; i += 2) ctx.lineTo(sx + i, y - 1 + (i % 4 < 2 ? 0 : 2));
          ctx.stroke();
          break;
        case 'cone':
          ctx.fillStyle = COLORS.cone;
          ctx.beginPath();
          ctx.moveTo(sx + w / 2, y - 8);
          ctx.lineTo(sx + w / 2 - 4, y);
          ctx.lineTo(sx + w / 2 + 4, y);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = COLORS.hud;
          ctx.fillRect(sx + w / 2 - 4, y - 4, 8, 1);
          break;
      }
    }
  }

  // --- rider sprite ---

  private drawRider(r: Canvas2DRenderer, p: RiderState, slot: number, ghost: boolean): void {
    const ctx = r.ctx;
    const cx = px(p.x) + (C.RIDER_HITBOX_W >> 1) - this.cam.x;
    const cy = px(p.y) + (C.RIDER_HITBOX_H >> 1) - this.cam.y + laneShiftY(p.lane);
    const tint = SLOT_COLORS[slot % SLOT_COLORS.length]!;

    // ground shadow (conveys lane / contact)
    ctx.globalAlpha = ghost ? 0.18 : 0.3;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 9, 7, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = ghost ? 0.55 : 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((p.tilt * Math.PI) / 180);
    if (p.phase === 'wipeout') ctx.rotate(((p.wipeoutTicks * 30) * Math.PI) / 180); // comic tumble

    // wheels
    ctx.strokeStyle = '#1f2430';
    ctx.lineWidth = 1.5;
    for (const wx of [-5, 5]) {
      ctx.beginPath();
      ctx.arc(wx, 5, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // frame
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-5, 5);
    ctx.lineTo(0, 1);
    ctx.lineTo(5, 5);
    ctx.moveTo(0, 1);
    ctx.lineTo(2, -2);
    ctx.stroke();
    // rider body + helmet
    ctx.fillStyle = tint;
    ctx.fillRect(-2, -6, 4, 5);
    ctx.fillStyle = ghost ? tint : COLORS.hud;
    ctx.beginPath();
    ctx.arc(0, -7, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --- HUD (screen-space) ---

  private drawHud(r: Canvas2DRenderer, state: GameState, localSlot: number): void {
    const me = state.players[localSlot];
    const ctx = r.ctx;

    // Countdown / results banners.
    if (state.mode === 'countdown') {
      const remain = Math.ceil((C.COUNTDOWN_TICKS - state.modeTicks) / 60);
      this.banner(r, remain > 0 ? String(remain) : 'GO!', COLORS.hud);
    } else if (state.mode === 'results' || state.mode === 'done') {
      this.drawResults(r, state);
    }

    if (!me || me.phase === 'pending') return;

    // Legs meter.
    const lw = 60;
    const frac = me.legs / C.LEGS_MAX;
    ctx.fillStyle = '#0f1222';
    ctx.fillRect(4, 4, lw + 2, 6);
    ctx.fillStyle = me.gassed ? COLORS.legsLow : COLORS.legs;
    ctx.fillRect(5, 5, Math.round(lw * frac), 4);
    r.text('LEGS', 4, 12, COLORS.hudDim, 6);

    // Place + lane.
    const place = me.finishPlace || this.livePlace(state, localSlot);
    const total = state.players.filter((p) => p && p.phase !== 'pending').length;
    r.text(`${PLACE_LABEL[place] ?? place} / ${total}`, C.VIEW_W - 4, 2, COLORS.hud, 8, 'right');
    for (let i = 0; i < C.LANE_COUNT; i++) {
      ctx.fillStyle = i === me.lane ? SLOT_COLORS[localSlot % 4]! : COLORS.hudDim;
      ctx.fillRect(C.VIEW_W - 4 - (C.LANE_COUNT - i) * 5, 12, 4, 4);
    }

    // Off-screen rival pips.
    state.players.forEach((p, slot) => {
      if (!p || slot === localSlot || p.phase === 'pending') return;
      const sx = px(p.x) - this.cam.x;
      if (sx >= 0 && sx <= C.VIEW_W) return;
      const edge = sx < 0 ? 2 : C.VIEW_W - 4;
      ctx.fillStyle = SLOT_COLORS[slot % 4]!;
      ctx.fillRect(edge, (C.VIEW_H >> 1) + slot * 6, 2, 4);
    });
  }

  /** 1-based live placement by distance among racers (ties → lower slot). */
  private livePlace(state: GameState, slot: number): number {
    const me = state.players[slot]!;
    let ahead = 0;
    state.players.forEach((p, s) => {
      if (!p || s === slot || p.phase === 'pending') return;
      if (p.x > me.x || (p.x === me.x && s < slot)) ahead++;
    });
    return ahead + 1;
  }

  private banner(r: Canvas2DRenderer, text: string, color: string): void {
    r.text(text, C.VIEW_W >> 1, (C.VIEW_H >> 1) - 12, color, 24, 'center');
  }

  private drawResults(r: Canvas2DRenderer, state: GameState): void {
    const ctx = r.ctx;
    ctx.fillStyle = 'rgba(15,18,34,0.78)';
    ctx.fillRect(C.VIEW_W / 2 - 70, 24, 140, 90);
    r.text('FINISH!', C.VIEW_W >> 1, 30, COLORS.hud, 12, 'center');
    const order = state.players
      .map((p, slot) => ({ p, slot }))
      .filter((e): e is { p: RiderState; slot: number } => !!e.p && e.p.finishPlace > 0)
      .sort((a, b) => a.p.finishPlace - b.p.finishPlace);
    order.forEach((e, i) => {
      r.text(
        `${PLACE_LABEL[e.p.finishPlace] ?? e.p.finishPlace}  P${e.slot + 1}`,
        C.VIEW_W >> 1,
        48 + i * 14,
        SLOT_COLORS[e.slot % 4]!,
        10,
        'center',
      );
    });
  }
}

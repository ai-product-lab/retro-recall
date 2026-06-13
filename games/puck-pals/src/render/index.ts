/**
 * Puck Pals renderer (read-only over sim state — never feeds the sim; floats are
 * fine here). Draws the rink through a vertically-scrolling camera that follows
 * the puck, then skaters (team-tinted boxes with a facing notch + charge tell),
 * goalies, the puck, the nets, and the HUD. Real avatar rigs replace the boxes
 * once packages/avatar lands on main (SPEC §12).
 */
import { SUBPX } from '@retro-recall/retrokit/sim';
import { Camera } from '@retro-recall/retrokit/camera';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import * as C from '../sim/constants';
import { attackDirY } from '../sim/rink';
import type { GameState, SkaterState } from '../sim/sim';

/** Camera view = exactly one screen; the rink is ~1.5 screens tall (SPEC §2). */
export const VIEW_W = 256;
export const VIEW_H = 192;

// Brand palette (branding/BRAND.md).
const ICE = '#dfe9f5';
const ICE_SHADE = '#cdddee';
const BOARDS = '#1a1f38';
const RED_LINE = '#ff6b6b';
const BLUE_LINE = '#4cc9f0';
const PAPER = '#f2efe9';
const MIDNIGHT = '#0f1222';
const STAR = '#ffd166';
const TEAM: Record<number, { body: string; trim: string; name: string }> = {
  0: { body: '#4cc9f0', trim: '#0a3a4a', name: 'HOME' },
  1: { body: '#ff6b6b', trim: '#4a1414', name: 'AWAY' },
};

const px = (sub: number): number => sub / SUBPX;

/** Follow the puck vertically, clamped to the rink; x stays put (rink = view). */
export function followPuck(cam: Camera, state: GameState): void {
  const puckCy = px(state.puck.y) + C.PUCK_HITBOX / 2;
  cam.follow(C.CENTER_X, puckCy, { w: C.RINK_PX_W, h: C.RINK_PX_H }, { deadzoneH: 48 });
}

export function render(r: Canvas2DRenderer, state: GameState, cam: Camera, localIds: number[] = []): void {
  const oy = -cam.y;
  r.clear(MIDNIGHT);
  drawRink(r, state, oy);
  for (const g of state.goalies) drawGoalie(r, g, oy);
  drawPuck(r, state, oy);
  for (const s of state.skaters) drawSkater(r, s, oy, localIds.includes(s.id));
  drawHud(r, state);
  drawCenterMessage(r, state);
}

function drawRink(r: Canvas2DRenderer, state: GameState, oy: number): void {
  const W = C.RINK_PX_W;
  const H = C.RINK_PX_H;
  const t = C.TILE_SIZE;
  // Ice + a faint zone shade so vertical scrolling reads as motion.
  r.rect(0, oy, W, H, ICE);
  r.rect(0, oy + H / 3, W, H / 3, ICE_SHADE);
  // Center red line + two blue lines.
  r.rect(0, oy + C.CENTER_Y, W, 2, RED_LINE);
  r.rect(0, oy + 13 * t + 4, W, 1, BLUE_LINE);
  r.rect(0, oy + 21 * t + 4, W, 1, BLUE_LINE);
  // Center faceoff circle + dot.
  r.circleOutline(C.CENTER_X, oy + C.CENTER_Y + 1, 22, RED_LINE, 1);
  r.rect(C.CENTER_X - 2, oy + C.CENTER_Y - 1, 4, 4, RED_LINE);
  // Goal mouths / nets (top and bottom).
  drawNet(r, oy + C.GOAL_LINE_TOP_Y, -1);
  drawNet(r, oy + C.GOAL_LINE_BOTTOM_Y, 1);
  // Creases (in front of each net), tinted to the defending team.
  for (const g of state.goalies) {
    const dir = attackDirY(g.team, state.period);
    const lineY = dir === -1 ? C.GOAL_LINE_BOTTOM_Y : C.GOAL_LINE_TOP_Y;
    r.circleOutline(C.CENTER_X, oy + lineY, 18, BLUE_LINE, 1);
  }
  // Boards (perimeter) drawn last so nothing overlaps the wall.
  r.rect(0, oy, W, t, BOARDS);
  r.rect(0, oy + H - t, W, t, BOARDS);
  r.rect(0, oy, t, H, BOARDS);
  r.rect(W - t, oy, t, H, BOARDS);
}

function drawNet(r: Canvas2DRenderer, lineScreenY: number, side: number): void {
  const x0 = C.CENTER_X - C.GOAL_MOUTH_HALF;
  const w = C.GOAL_MOUTH_HALF * 2;
  // Goal line.
  r.rect(x0, lineScreenY, w, 1, RED_LINE);
  // Net pocket behind the line (toward the boards).
  const depth = 6;
  const y = side === -1 ? lineScreenY - depth : lineScreenY;
  r.rect(x0, y, w, depth, '#ffffff');
  for (let gx = x0; gx <= x0 + w; gx += 4) r.rect(gx, y, 1, depth, '#9fb0c8');
}

function skaterScreen(s: SkaterState): { x: number; y: number } {
  return { x: px(s.x), y: px(s.y) };
}

function drawSkater(r: Canvas2DRenderer, s: SkaterState, oy: number, local: boolean): void {
  const { x, y } = skaterScreen(s);
  const sy = y + oy;
  const col = TEAM[s.team]!;
  const size = C.SKATER_HITBOX;

  if (s.tumble > 0) {
    // Knocked down: a dim, sprawled box with a spin tick.
    r.rect(x, sy + size / 4, size, size / 2, col.trim);
    r.rect(x + size / 2 - 1, sy, 2, 2, col.body);
    return;
  }

  // Charge tell (SPEC §5): a growing ring, star-yellow once it's a super slap.
  if (s.charge > 0) {
    const t = s.charge / C.SLAP_CHARGE_MAX_TICKS;
    const ringColor = s.charge >= C.SUPER_SLAP_THRESHOLD ? STAR : PAPER;
    r.circleOutline(x + size / 2, sy + size / 2, size / 2 + 2 + t * 5, ringColor, 1);
  }

  r.rect(x, sy, size, size, col.body);
  r.rect(x + 1, sy + 1, size - 2, size - 2, col.trim);
  r.rect(x + 2, sy + 2, size - 4, size - 4, col.body);
  // Facing notch — a pip in the direction the skater is pointing.
  const nx = x + size / 2 - 1 + s.faceX * (size / 2 - 1);
  const ny = sy + size / 2 - 1 + s.faceY * (size / 2 - 1);
  r.rect(nx, ny, 2, 2, PAPER);
  // "You" marker (hotseat / online): a small cap dot above the local skater.
  if (local) r.rect(x + size / 2 - 1, sy - 3, 2, 2, STAR);
}

function drawGoalie(r: Canvas2DRenderer, g: { team: number; x: number; y: number }, oy: number): void {
  const col = TEAM[g.team]!;
  r.rect(px(g.x), px(g.y) + oy, C.GOALIE_HITBOX_W, C.GOALIE_HITBOX_H, col.trim);
  r.rect(px(g.x) + 1, px(g.y) + oy + 1, C.GOALIE_HITBOX_W - 2, C.GOALIE_HITBOX_H - 2, col.body);
}

function drawPuck(r: Canvas2DRenderer, state: GameState, oy: number): void {
  const p = state.puck;
  const cx = px(p.x) + C.PUCK_HITBOX / 2;
  const cy = px(p.y) + C.PUCK_HITBOX / 2 + oy;
  if (p.superSlap) r.circle(cx, cy, C.PUCK_HITBOX / 2 + 2, STAR); // super-slap streak
  r.circle(cx, cy, C.PUCK_HITBOX / 2, MIDNIGHT);
  r.circle(cx, cy, C.PUCK_HITBOX / 2 - 1, '#3a3f5a');
}

const PERIOD_LABEL = ['1ST', '2ND', '3RD'];

function clockText(ticks: number): string {
  const secs = Math.max(0, Math.ceil(ticks / 60));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function drawHud(r: Canvas2DRenderer, state: GameState): void {
  // Scoreboard strip across the top of the view.
  r.rect(0, 0, VIEW_W, 14, MIDNIGHT);
  r.rect(0, 14, VIEW_W, 1, '#2a3158');
  r.text(`${TEAM[0]!.name} ${state.score[0]}`, 6, 3, TEAM[0]!.body, 8, 'left');
  r.text(`${state.score[1]} ${TEAM[1]!.name}`, VIEW_W - 6, 3, TEAM[1]!.body, 8, 'right');
  const inOT = state.period >= C.PERIODS;
  const periodStr = inOT ? `OT${state.otCount}` : PERIOD_LABEL[state.period] ?? '';
  const isPlay = state.mode === 'play' || state.mode === 'overtime';
  const mid = isPlay || state.mode === 'goal' ? `${periodStr}  ${clockText(state.clock)}` : periodStr;
  r.text(mid, C.CENTER_X, 3, PAPER, 8, 'center');
  // Attack-direction arrows so each side knows which net is theirs this period.
  const homeUp = attackDirY(0, state.period) === -1;
  r.text(homeUp ? '▲' : '▼', 70, 3, TEAM[0]!.body, 8, 'center');
  r.text(homeUp ? '▼' : '▲', VIEW_W - 70, 3, TEAM[1]!.body, 8, 'center');
}

function drawCenterMessage(r: Canvas2DRenderer, state: GameState): void {
  let msg = '';
  let color = PAPER;
  switch (state.mode) {
    case 'faceoff':
    case 'overtime-faceoff':
      msg = 'FACE-OFF';
      break;
    case 'goal':
      msg = 'GOAL!';
      color = STAR;
      break;
    case 'intermission':
      msg = 'INTERMISSION';
      break;
    case 'final':
      msg = `${TEAM[state.winner]?.name ?? ''} WINS!`;
      color = STAR;
      break;
    default:
      return;
  }
  // Shadowed banner at mid-view.
  r.text(msg, C.CENTER_X + 1, VIEW_H / 2 - 5, MIDNIGHT, 16, 'center');
  r.text(msg, C.CENTER_X, VIEW_H / 2 - 6, color, 16, 'center');
  if (state.mode === 'final') r.text('press START', C.CENTER_X, VIEW_H / 2 + 12, PAPER, 8, 'center');
}

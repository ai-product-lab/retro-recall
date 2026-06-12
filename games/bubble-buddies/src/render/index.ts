import { SUBPX, Tile } from '@retro-recall/retrokit/sim';
import type { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import * as C from '../sim/constants';
import type { BubbleBuddiesSim, EnemyKind } from '../sim/sim';

const px = (subpx: number): number => Math.floor(subpx / SUBPX);

const COLORS = {
  bg: '#0d0d2b',
  solid: '#3b4ec9',
  solidShade: '#27348f',
  platform: '#8be0ff',
  platformShade: '#4aa8d8',
  player: '#4ade80',
  playerShade: '#22a857',
  grumble: '#fb923c',
  grumbleShade: '#d96a16',
  flitter: '#a78bfa',
  flitterShade: '#7c52e8',
  angry: '#ef4444',
  bubbleFill: 'rgba(150, 220, 255, 0.30)',
  bubbleRim: '#aee6ff',
  banana: '#fde047',
  berry: '#f87171',
  hud: '#ffffff',
  hudDim: '#9ca3af',
} as const;

function drawTiles(r: Canvas2DRenderer, sim: BubbleBuddiesSim): void {
  const map = sim.map;
  const ts = map.tileSize;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = map.at(tx, ty);
      if (t === Tile.Solid) {
        r.rect(tx * ts, ty * ts, ts, ts, COLORS.solid);
        r.rect(tx * ts, ty * ts + ts - 2, ts, 2, COLORS.solidShade);
        r.rect(tx * ts + ts - 1, ty * ts, 1, ts, COLORS.solidShade);
      } else if (t === Tile.Platform) {
        r.rect(tx * ts, ty * ts, ts, 3, COLORS.platform);
        r.rect(tx * ts, ty * ts + 3, ts, 1, COLORS.platformShade);
      }
    }
  }
}

/** Chunky two-tone critter with eyes — our placeholder "sprite". */
function drawCritter(
  r: Canvas2DRenderer,
  x: number,
  y: number,
  w: number,
  h: number,
  facing: 1 | -1,
  body: string,
  shade: string,
  blink = false,
): void {
  if (blink) return;
  r.rect(x, y + 1, w, h - 1, body);
  r.rect(x + 1, y, w - 2, 2, body); // rounded top
  r.rect(x, y + h - 3, w, 3, shade); // belly shade
  // Feet
  r.rect(x + 1, y + h - 2, 3, 2, shade);
  r.rect(x + w - 4, y + h - 2, 3, 2, shade);
  // Eyes look in the facing direction.
  const eyeShift = facing === 1 ? 1 : -1;
  const exL = x + 2 + (eyeShift === 1 ? 1 : 0);
  const exR = x + w - 5 + (eyeShift === 1 ? 1 : 0);
  r.rect(exL, y + 3, 3, 4, '#ffffff');
  r.rect(exR, y + 3, 3, 4, '#ffffff');
  r.rect(exL + (eyeShift === 1 ? 1 : 0), y + 4, 2, 2, '#1f2937');
  r.rect(exR + (eyeShift === 1 ? 1 : 0), y + 4, 2, 2, '#1f2937');
}

function enemyColors(kind: EnemyKind, angry: boolean): { body: string; shade: string } {
  if (angry) return { body: COLORS.angry, shade: '#b91c1c' };
  return kind === 'grumble'
    ? { body: COLORS.grumble, shade: COLORS.grumbleShade }
    : { body: COLORS.flitter, shade: COLORS.flitterShade };
}

function drawHud(r: Canvas2DRenderer, sim: BubbleBuddiesSim): void {
  const st = sim.state;
  r.text(`SCORE ${String(st.score).padStart(6, '0')}`, 4, 0, COLORS.hud);
  r.text(`LV ${st.level + 1}`, r.width / 2, 0, COLORS.hud, 8, 'center');
  for (let i = 0; i < st.lives; i++) {
    r.rect(r.width - 8 - i * 7, 1, 5, 5, COLORS.player);
  }
}

function drawCenteredBanner(r: Canvas2DRenderer, lines: string[], color: string): void {
  r.rect(0, 70, r.width, 50, 'rgba(0, 0, 0, 0.7)');
  lines.forEach((line, i) => {
    r.text(line, r.width / 2, 80 + i * 12, i === 0 ? color : COLORS.hudDim, 8, 'center');
  });
}

export function render(r: Canvas2DRenderer, sim: BubbleBuddiesSim): void {
  const st = sim.state;
  r.clear(COLORS.bg);
  drawTiles(r, sim);

  for (const f of st.fruit) {
    if (f.kind === 'grumble') {
      r.rect(px(f.x), px(f.y) + 2, C.FRUIT_HITBOX, C.FRUIT_HITBOX - 3, COLORS.banana);
      r.rect(px(f.x) + 3, px(f.y), 2, 3, '#a16207');
    } else {
      r.circle(px(f.x) + C.FRUIT_HITBOX / 2, px(f.y) + C.FRUIT_HITBOX / 2, C.FRUIT_HITBOX / 2, COLORS.berry);
      r.rect(px(f.x) + 3, px(f.y) - 1, 2, 3, '#15803d');
    }
  }

  for (const e of st.enemies) {
    const { body, shade } = enemyColors(e.kind, e.angry);
    drawCritter(r, px(e.x), px(e.y), C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H, e.facing, body, shade);
    if (e.kind === 'flitter') {
      // Flapping wing nubs.
      const flap = Math.floor(st.tick / 8) % 2 === 0 ? 0 : 2;
      r.rect(px(e.x) - 2, px(e.y) + 3 + flap, 2, 4, shade);
      r.rect(px(e.x) + C.ENEMY_HITBOX_W, px(e.y) + 3 + flap, 2, 4, shade);
    }
  }

  if (st.mode !== 'death') {
    const p = st.player;
    const blink = p.invuln > 0 && Math.floor(st.tick / 4) % 2 === 0;
    drawCritter(
      r, px(p.x), px(p.y), C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H, p.facing,
      COLORS.player, COLORS.playerShade, blink,
    );
  }

  for (const b of st.bubbles) {
    const cx = px(b.x) + C.BUBBLE_HITBOX / 2;
    const cy = px(b.y) + C.BUBBLE_HITBOX / 2;
    const radius = C.BUBBLE_HITBOX / 2;
    if (b.trapped !== null) {
      const { body, shade } = enemyColors(b.trapped, b.trappedAngry);
      // Squished captive, shaking as escape nears.
      const wiggle = b.trapAge > C.TRAP_ESCAPE_TICKS - 120 ? (Math.floor(b.age / 3) % 2) : 0;
      drawCritter(r, cx - 4 + wiggle, cy - 4, 8, 8, -1, body, shade);
    }
    r.circle(cx, cy, radius, COLORS.bubbleFill);
    r.circleOutline(cx, cy, radius, COLORS.bubbleRim);
    r.rect(cx - 3, cy - 4, 2, 2, '#ffffff'); // shine
  }

  drawHud(r, sim);

  if (st.mode === 'levelclear') {
    drawCenteredBanner(r, ['LEVEL CLEAR!', `get ready for level ${Math.min(st.level + 2, C.LEVEL_COUNT)}`], COLORS.player);
  } else if (st.mode === 'gameover') {
    drawCenteredBanner(r, ['GAME OVER', `score ${st.score}`, 'press any key'], COLORS.angry);
  } else if (st.mode === 'win') {
    drawCenteredBanner(r, ['YOU WIN!', `score ${st.score}`, 'press any key'], COLORS.banana);
  }
}

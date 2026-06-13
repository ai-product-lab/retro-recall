import { SUBPX, Tile } from '@retro-recall/retrokit/sim';
import type { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import * as C from '../sim/constants';
import type { EnemyKind, GameState, PlayerState } from '../sim/sim';
import type { TileMap } from '@retro-recall/retrokit/sim';
import type { PoseName } from '@retro-recall/avatar';
import type { AvatarSprite } from '../avatar/store';

const px = (subpx: number): number => Math.floor(subpx / SUBPX);

// House palette (BRAND.md / PALETTE_P1) — the same 16 colors avatars quantize
// to, so generated buddies sit naturally in the world. ADR-005: original look,
// no traceable trade dress.
const COLORS = {
  bg: '#0f1222', //          Midnight
  solid: '#1e2440', //       deep navy block
  solidEdge: '#4cc9f0', //   Bubble cyan top bevel
  solidShade: '#0b0e1c', //  block shadow
  platform: '#3df5a6', //    Phosphor mint
  platformShade: '#2ba877', // mint shadow
  grumble: '#ffd166', //     Star yellow walker
  grumbleShade: '#e0a93b',
  flitter: '#4cc9f0', //     Bubble cyan flyer
  flitterShade: '#2a8fb8',
  angry: '#ff6b6b', //       Cabinet coral
  angryShade: '#c24a4a',
  eye: '#0f1222',
  bubbleFill: 'rgba(76, 201, 240, 0.22)',
  bubbleRim: '#bdeeff',
  banana: '#ffd166', //      Star
  bananaShade: '#e0a93b',
  berry: '#ff6b6b', //       Cabinet
  leaf: '#3df5a6', //        Phosphor
  hud: '#f2efe9', //         Paper
  hudDim: '#8a7e6b', //      warm gray
} as const;

/** Per-slot palette tints (spec §11). Slot 0 is the classic green buddy. */
export const SLOT_COLORS: readonly { body: string; shade: string }[] = [
  { body: '#4ade80', shade: '#22a857' },
  { body: '#60a5fa', shade: '#2563eb' },
  { body: '#facc15', shade: '#ca8a04' },
  { body: '#f472b6', shade: '#db2777' },
];

/** Extra, shell-owned things to draw on top of sim state. */
export interface RenderOverlay {
  /** Slot whose character is "you" (gets a marker). */
  localSlot?: number;
  /** Active emotes: slot → glyph (already filtered to the display window). */
  emotes?: ReadonlyMap<number, string>;
  /** Loaded avatar sheets by slot; a missing slot draws the placeholder. */
  sprites?: ReadonlyMap<number, AvatarSprite>;
}

/** Per-slot last drawn x, so we can tell walk from idle (sim has no vx). */
const lastDrawX = new Map<number, number>();

/** Pick an animation pose from the player's state. */
function poseFor(p: PlayerState, slot: number): PoseName {
  if (!p.grounded) return 'jump';
  if (p.blowCooldown > C.BLOW_COOLDOWN_TICKS - 8) return 'blow';
  const moved = lastDrawX.has(slot) && lastDrawX.get(slot) !== px(p.x);
  return moved ? 'walk' : 'idle';
}

/** Resolve a pose to a concrete sheet frame index for this tick. */
function frameIndex(sprite: AvatarSprite, pose: PoseName, tick: number, vy: number): number {
  const ps = sprite.poses[pose];
  if (pose === 'jump') return ps.start + (vy < 0 ? 0 : 1); // ascend / descend
  return ps.start + (Math.floor((tick * ps.fps) / 60) % ps.count);
}

/** Blit one 16×16 frame, mirrored for left-facing. */
function drawAvatar(
  r: Canvas2DRenderer,
  sprite: AvatarSprite,
  frame: number,
  dx: number,
  dy: number,
  facing: 1 | -1,
): void {
  const fs = sprite.frameSize;
  const sx = frame * fs;
  const ctx = r.ctx;
  if (facing === -1) {
    ctx.save();
    ctx.translate(dx + fs, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.bitmap, sx, 0, fs, fs, 0, 0, fs, fs);
    ctx.restore();
  } else {
    ctx.drawImage(sprite.bitmap, sx, 0, fs, fs, dx, dy, fs, fs);
  }
}

function drawTiles(r: Canvas2DRenderer, map: TileMap): void {
  const ts = map.tileSize;
  const solidAbove = (tx: number, ty: number): boolean => map.at(tx, ty - 1) === Tile.Solid;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = map.at(tx, ty);
      const x = tx * ts;
      const y = ty * ts;
      if (t === Tile.Solid) {
        r.rect(x, y, ts, ts, COLORS.solid);
        // Cyan bevel only on the exposed top face (a lit ledge); inner shadow.
        if (!solidAbove(tx, ty)) r.rect(x, y, ts, 1, COLORS.solidEdge);
        r.rect(x, y + ts - 1, ts, 1, COLORS.solidShade);
        r.rect(x + ts - 1, y + 1, 1, ts - 1, COLORS.solidShade);
      } else if (t === Tile.Platform) {
        r.rect(x, y, ts, 2, COLORS.platform);
        r.rect(x, y + 2, ts, 1, COLORS.platformShade);
        // Little drip studs so one-way platforms read as distinct from solids.
        r.rect(x + 1, y + 3, 1, 1, COLORS.platformShade);
        r.rect(x + ts - 2, y + 3, 1, 1, COLORS.platformShade);
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
  if (angry) return { body: COLORS.angry, shade: COLORS.angryShade };
  return kind === 'grumble'
    ? { body: COLORS.grumble, shade: COLORS.grumbleShade }
    : { body: COLORS.flitter, shade: COLORS.flitterShade };
}

/** A grumpy little monster: rounded body, angry brows + frown so it reads as a
 *  foe (cute, but clearly not a buddy). Flitters get flapping wings. */
function drawEnemy(
  r: Canvas2DRenderer,
  kind: EnemyKind,
  x: number,
  y: number,
  w: number,
  h: number,
  facing: 1 | -1,
  body: string,
  shade: string,
  tick: number,
): void {
  if (kind === 'flitter') {
    const flap = Math.floor(tick / 8) % 2 === 0 ? 0 : 2;
    r.rect(x - 2, y + 3 + flap, 2, 4, shade);
    r.rect(x + w, y + 3 + flap, 2, 4, shade);
  }
  // Body.
  r.rect(x, y + 1, w, h - 1, body);
  r.rect(x + 1, y, w - 2, 1, body); // rounded crown
  r.rect(x, y + h - 3, w, 3, shade); // belly shade
  // Feet/claws.
  r.rect(x, y + h - 2, 3, 2, shade);
  r.rect(x + w - 3, y + h - 2, 3, 2, shade);
  // Eyes (look in facing direction).
  const dx = facing === 1 ? 1 : 0;
  const exL = x + 2 + dx;
  const exR = x + w - 5 + dx;
  r.rect(exL, y + 4, 3, 3, COLORS.hud);
  r.rect(exR, y + 4, 3, 3, COLORS.hud);
  r.rect(exL + dx, y + 5, 2, 2, COLORS.eye);
  r.rect(exR + dx, y + 5, 2, 2, COLORS.eye);
  // Angry slanted brows — the "foe" tell.
  r.rect(exL - 1, y + 2, 3, 1, COLORS.eye);
  r.rect(exL, y + 3, 2, 1, COLORS.eye);
  r.rect(exR, y + 2, 3, 1, COLORS.eye);
  r.rect(exR, y + 3, 2, 1, COLORS.eye);
  // Frown.
  r.rect(x + 4, y + h - 4, w - 8, 1, COLORS.eye);
}

const isMultiplayer = (st: GameState): boolean =>
  st.players.filter((p) => p !== null).length > 1;

function drawHud(r: Canvas2DRenderer, st: GameState): void {
  if (!isMultiplayer(st)) {
    const p0 = st.players[0];
    r.text(`SCORE ${String(p0?.score ?? 0).padStart(6, '0')}`, 4, 0, COLORS.hud);
    r.text(`LV ${st.level + 1}`, r.width / 2, 0, COLORS.hud, 8, 'center');
    for (let i = 0; i < st.lives; i++) {
      r.rect(r.width - 8 - i * 7, 1, 5, 5, SLOT_COLORS[0]!.body);
    }
    return;
  }
  // Multiplayer: one tinted score per joined slot, level in the middle.
  st.players.forEach((p, slot) => {
    if (!p) return;
    const x = 4 + slot * 56;
    const color = p.phase === 'despawned' ? COLORS.hudDim : SLOT_COLORS[slot]!.body;
    r.text(String(p.score).padStart(6, '0'), x, 0, color, 8);
  });
  r.text(`LV ${st.level + 1}`, r.width - 4, 0, COLORS.hud, 8, 'right');
}

function drawCenteredBanner(r: Canvas2DRenderer, lines: string[], color: string): void {
  r.rect(0, 70, r.width, 50, 'rgba(0, 0, 0, 0.7)');
  lines.forEach((line, i) => {
    r.text(line, r.width / 2, 80 + i * 12, i === 0 ? color : COLORS.hudDim, 8, 'center');
  });
}

function drawPlayer(
  r: Canvas2DRenderer,
  st: GameState,
  p: PlayerState,
  slot: number,
  overlay: RenderOverlay,
): void {
  const { body, shade } = SLOT_COLORS[slot]!;
  const sprite = overlay.sprites?.get(slot);
  if (p.phase === 'bubble') {
    // Rescue bubble: the buddy squished inside a bubble, drifting up.
    const cx = px(p.x) + C.BUBBLE_HITBOX / 2;
    const cy = px(p.y) + C.BUBBLE_HITBOX / 2;
    if (sprite) {
      drawAvatar(r, sprite, frameIndex(sprite, 'rescue', st.tick, p.vy), cx - sprite.frameSize / 2, cy - sprite.frameSize / 2, p.facing);
    } else {
      drawCritter(r, cx - 4, cy - 4, 8, 8, -1, body, shade);
    }
    r.circle(cx, cy, C.BUBBLE_HITBOX / 2, COLORS.bubbleFill);
    r.circleOutline(cx, cy, C.BUBBLE_HITBOX / 2, body);
    return;
  }
  if (p.phase !== 'alive') return;
  const blink = p.invuln > 0 && Math.floor(st.tick / 4) % 2 === 0;
  if (sprite) {
    // 16×16 sprite centered on the 12×14 hitbox, feet aligned to its base.
    if (!blink) {
      const pose = poseFor(p, slot);
      drawAvatar(r, sprite, frameIndex(sprite, pose, st.tick, p.vy), px(p.x) - 2, px(p.y) - 2, p.facing);
    }
    lastDrawX.set(slot, px(p.x));
  } else {
    drawCritter(r, px(p.x), px(p.y), C.PLAYER_HITBOX_W, C.PLAYER_HITBOX_H, p.facing, body, shade, blink);
  }
  if (overlay.localSlot === slot && isMultiplayer(st)) {
    // Tiny "you" marker above your own buddy.
    r.rect(px(p.x) + C.PLAYER_HITBOX_W / 2 - 1, px(p.y) - 4, 2, 2, body);
  }
  const emote = overlay.emotes?.get(slot);
  if (emote) {
    const ex = px(p.x) + C.PLAYER_HITBOX_W / 2;
    const ey = px(p.y) - 12;
    const half = Math.max(emote.length * 5, 8) / 2 + 2;
    r.rect(ex - half, ey - 2, half * 2, 12, '#ffffff');
    r.rect(ex - 1, ey + 10, 2, 2, '#ffffff'); // speech tail
    r.text(emote, ex, ey, '#1f2937', 8, 'center');
  }
}

export function render(
  r: Canvas2DRenderer,
  map: TileMap,
  st: GameState,
  overlay: RenderOverlay = {},
): void {
  r.clear(COLORS.bg);
  drawTiles(r, map);

  for (const f of st.fruit) {
    const fx = px(f.x);
    const fy = px(f.y);
    if (f.kind === 'grumble') {
      // Sunny round candy with a highlight and a little stem.
      r.rect(fx, fy + 2, C.FRUIT_HITBOX, C.FRUIT_HITBOX - 3, COLORS.banana);
      r.rect(fx, fy + C.FRUIT_HITBOX - 2, C.FRUIT_HITBOX, 1, COLORS.bananaShade);
      r.rect(fx + 1, fy + 3, 2, 1, COLORS.hud); // shine
      r.rect(fx + 3, fy, 2, 3, COLORS.bananaShade); // stem
    } else {
      // Coral berry with a phosphor leaf.
      r.circle(fx + C.FRUIT_HITBOX / 2, fy + C.FRUIT_HITBOX / 2, C.FRUIT_HITBOX / 2, COLORS.berry);
      r.rect(fx + 2, fy + 3, 1, 1, COLORS.hud); // shine
      r.rect(fx + 3, fy - 1, 2, 2, COLORS.leaf); // leaf
    }
  }

  for (const e of st.enemies) {
    const { body, shade } = enemyColors(e.kind, e.angry);
    drawEnemy(r, e.kind, px(e.x), px(e.y), C.ENEMY_HITBOX_W, C.ENEMY_HITBOX_H, e.facing, body, shade, st.tick);
  }

  if (st.mode !== 'death') {
    st.players.forEach((p, slot) => {
      if (p) drawPlayer(r, st, p, slot, overlay);
    });
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
    r.rect(cx - 3, cy - 4, 2, 2, COLORS.hud); // shine
  }

  drawHud(r, st);

  const teamScore = st.players.reduce((sum, p) => sum + (p?.score ?? 0), 0);
  if (st.mode === 'levelclear') {
    drawCenteredBanner(r, ['LEVEL CLEAR!', `get ready for level ${Math.min(st.level + 2, C.LEVEL_COUNT)}`], SLOT_COLORS[0]!.body);
  } else if (st.mode === 'gameover') {
    // "any button" works for keyboard and touch alike (sim restarts on any bit).
    drawCenteredBanner(r, ['GAME OVER', `score ${teamScore}`, 'press any button'], COLORS.angry);
  } else if (st.mode === 'win') {
    drawCenteredBanner(r, ['YOU WIN!', `score ${teamScore}`, 'press any button'], COLORS.banana);
  }
}

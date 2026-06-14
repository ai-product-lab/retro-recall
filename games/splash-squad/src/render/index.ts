/**
 * Splash Squad renderer. Reads sim state read-only and draws the scrolling
 * world through a camera pinned to the sim's authoritative `scrollX` (the whole
 * co-op squad shares one window — §2). Floats are fine here; render never feeds
 * the sim. Placeholder rectangle art per the v1 SPEC; avatar body rigs land with
 * the shared Phase 3 "Get Sprited" pipeline.
 */
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Camera, visibleTileRange } from '@retro-recall/retrokit/camera';
import { SUBPX, Tile, TileMap } from '@retro-recall/retrokit/sim';
import type { PoseName } from '@retro-recall/avatar';
import * as C from '../sim/constants';
import { LEVELS } from '../sim/levels';
import type { AvatarSprite } from '../avatar/store';
import type { BossState, GameState, NozzleId, PlayerState } from '../sim/sim';

/** Shell-owned extras drawn on top of sim state (online play supplies these). */
export interface RenderOverlay {
  /** Slot that is "you" (gets a small marker). */
  localSlot?: number;
  /** Loaded avatar sheets by slot; a missing slot draws the placeholder. */
  sprites?: ReadonlyMap<number, AvatarSprite>;
}

// Brand palette (branding/BRAND.md).
const MIDNIGHT = '#0f1222';
const PAPER = '#f2efe9';
const STAR = '#ffd166';
const CORAL = '#ff6b6b';
const BUBBLE = '#4cc9f0';
const SLOT_TINT = ['#3df5a6', '#4cc9f0', '#ffd166', '#ff6b6b'];

const SOLID = '#34503a'; // backyard dirt
const PLATFORM = '#6b8e4e'; // turf ledge
const ROBOT_TINT = { trundle: '#9aa0b5', sentry: '#7a8290', hopper: '#c98a4e' } as const;
const NOZZLE_TINT: Record<NozzleId, string> = {
  [C.NOZZLE_STREAM]: '#3df5a6',
  [C.NOZZLE_SPREAD]: '#4cc9f0',
  [C.NOZZLE_BURST]: '#ff6b6b',
};
const NOZZLE_LETTER: Record<NozzleId, string> = {
  [C.NOZZLE_STREAM]: 'M',
  [C.NOZZLE_SPREAD]: 'W',
  [C.NOZZLE_BURST]: 'U',
};

const camera = new Camera(C.SCREEN_W, C.SCREEN_H);

const mapCache = new Map<number, TileMap>();
const levelMap = (index: number): TileMap => {
  let m = mapCache.get(index);
  if (!m) {
    m = TileMap.parse(LEVELS[index]!.rows, C.TILE_SIZE).map;
    mapCache.set(index, m);
  }
  return m;
};

const px = (v: number): number => Math.floor(v / SUBPX);

/** Per-slot last drawn world-x, so we can tell walk from idle (sim has no vx). */
const lastDrawX = new Map<number, number>();

/** Pick a pose from the player's state (shared rig: idle/walk/jump/blow/rescue). */
function poseFor(p: PlayerState, slot: number): PoseName {
  if (p.phase === 'bubble') return 'rescue';
  if (!p.grounded) return 'jump';
  if (p.fireCooldown > 0) return 'blow'; // firing — reuse the rig's "blow" pose
  const moved = lastDrawX.has(slot) && lastDrawX.get(slot) !== px(p.x);
  return moved ? 'walk' : 'idle';
}

/** Resolve a pose to a concrete sheet frame for this tick (animation is cosmetic). */
function frameIndex(sprite: AvatarSprite, pose: PoseName, tick: number, vy: number): number {
  const ps = sprite.poses[pose];
  if (pose === 'jump') return ps.start + (vy < 0 ? 0 : 1); // ascend / descend
  return ps.start + (Math.floor((tick * ps.fps) / 60) % ps.count);
}

/** Blit one frame, mirrored for left-facing (rigs are authored facing right). */
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

export function render(r: Canvas2DRenderer, state: GameState, overlay: RenderOverlay = {}): void {
  const map = levelMap(state.level);
  const world = { w: map.pixelWidth, h: map.pixelHeight };
  camera.pinX(state.scrollX, world); // sim owns the scroll; the view just follows
  camera.pinY(0, world);
  const cx = camera.x;

  r.clear(MIDNIGHT);

  // Tiles (culled to the visible window).
  const { tx0, ty0, tx1, ty1 } = visibleTileRange(camera, C.TILE_SIZE, map.width, map.height);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = map.at(tx, ty);
      if (t === Tile.Solid) r.rect(tx * C.TILE_SIZE - cx, ty * C.TILE_SIZE, C.TILE_SIZE, C.TILE_SIZE, SOLID);
      else if (t === Tile.Platform)
        r.rect(tx * C.TILE_SIZE - cx, ty * C.TILE_SIZE + 1, C.TILE_SIZE, 3, PLATFORM);
    }
  }

  // Spigots (refill posts).
  for (const s of state.spigots) {
    const x = px(s.x) - cx;
    const y = px(s.y);
    r.rect(x + 5, y + 4, 6, C.SPIGOT_H - 4, '#5a6072');
    r.rect(x + 3, y, C.SPIGOT_W - 6, 5, BUBBLE);
  }

  // Nozzle pickups.
  for (const pk of state.pickups) {
    const x = px(pk.x) - cx;
    const y = px(pk.y);
    r.rect(x, y, C.TILE_SIZE, C.TILE_SIZE, NOZZLE_TINT[pk.nozzle]);
    r.text(NOZZLE_LETTER[pk.nozzle], x + 1, y, MIDNIGHT, 6);
  }

  // Droplets.
  for (const d of state.droplets) {
    const x = px(d.x) - cx + C.DROPLET_HITBOX / 2;
    r.circle(x, px(d.y) + C.DROPLET_HITBOX / 2, C.DROPLET_HITBOX / 2, BUBBLE);
  }

  // Pellets / steam.
  for (const pl of state.pellets) {
    const size = pl.kind === 'rust' ? C.RUST_PELLET_HITBOX : C.BOSS_STEAM_HITBOX;
    const x = px(pl.x) - cx;
    r.rect(x, px(pl.y), size, size, pl.kind === 'rust' ? '#b5723a' : '#dfe6ef');
  }

  // Robots.
  for (const rb of state.robots) {
    const x = px(rb.x) - cx;
    const y = px(rb.y);
    if (rb.winddown >= 0) {
      r.rect(x, y, C.ROBOT_HITBOX, C.ROBOT_HITBOX, '#5b6070'); // sputtering, harmless
      r.text('z', x + 4, y - 6, PAPER, 6);
      continue;
    }
    r.rect(x, y, C.ROBOT_HITBOX, C.ROBOT_HITBOX, ROBOT_TINT[rb.kind]);
    // a little "eye" facing the player + soak tint as it gets wet
    const ex = rb.facing === 1 ? x + C.ROBOT_HITBOX - 5 : x + 1;
    r.rect(ex, y + 3, 4, 4, MIDNIGHT);
    if (rb.soak > 0) r.rect(x, y + C.ROBOT_HITBOX - 3, C.ROBOT_HITBOX, 3, BUBBLE);
  }

  // Boss.
  if (state.boss) drawBoss(r, state.boss, cx);

  // Players.
  state.players.forEach((p, slot) => {
    if (!p || p.phase === 'pending' || p.phase === 'despawned') return;
    drawPlayer(r, state, p, slot, cx, overlay.sprites?.get(slot), overlay.localSlot === slot);
  });

  drawHud(r, state);
  drawBanner(r, state);
}

function drawPlayer(
  r: Canvas2DRenderer,
  state: GameState,
  p: PlayerState,
  slot: number,
  cx: number,
  sprite: AvatarSprite | undefined,
  isLocal: boolean,
): void {
  const tint = SLOT_TINT[slot % SLOT_TINT.length]!;
  const x = px(p.x) - cx;
  const y = px(p.y);

  if (p.phase === 'bubble') {
    // Rescue bubble — your buddy squished inside, drifting up; a teammate pops it (§11).
    const bcx = x + C.RESCUE_HITBOX / 2;
    const bcy = y + C.RESCUE_HITBOX / 2;
    if (sprite) {
      const f = frameIndex(sprite, 'rescue', state.tick, p.vy);
      drawAvatar(r, sprite, f, bcx - sprite.frameSize / 2, bcy - sprite.frameSize / 2, p.facing);
    }
    r.circleOutline(bcx, bcy, C.RESCUE_HITBOX / 2, tint, 2);
    return;
  }

  // Blink while invulnerable.
  const blink = p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0;
  const top = y + (C.PLAYER_HITBOX_H - (p.crouch ? C.CROUCH_HITBOX_H : C.PLAYER_HITBOX_H));
  if (!blink) {
    if (sprite) {
      // 16×16 sheet centered on the 12×14 hitbox, feet aligned to its base.
      drawAvatar(r, sprite, frameIndex(sprite, poseFor(p, slot), state.tick, p.vy), x - 2, y - 2, p.facing);
      lastDrawX.set(slot, px(p.x));
    } else {
      const h = p.crouch ? C.CROUCH_HITBOX_H : C.PLAYER_HITBOX_H;
      r.rect(x, top, C.PLAYER_HITBOX_W, h, tint);
    }
    // Aim nub + tank bar over either art — gameplay readability (aim, water left).
    const nx = p.facing === 1 ? x + C.PLAYER_HITBOX_W : x - 3;
    r.rect(nx, top + 3, 3, 3, PAPER);
    const w = C.PLAYER_HITBOX_W;
    const fill = Math.round((p.tank / C.TANK_CAPACITY) * w);
    r.rect(x, top - 4, w, 2, '#2a2f44');
    r.rect(x, top - 4, fill, 2, p.tank > 0 ? BUBBLE : CORAL);
    if (isLocal) r.rect(x + C.PLAYER_HITBOX_W / 2 - 1, top - 7, 2, 2, tint); // "you" marker
  }
}

function drawBoss(r: Canvas2DRenderer, boss: BossState, cx: number): void {
  const x = px(boss.x) - cx;
  const y = px(boss.y);
  r.rect(x, y, C.BOSS_HITBOX_W, C.BOSS_HITBOX_H, boss.winddown >= 0 ? '#5b6070' : '#8a93a8');
  // Boiler weak point: red & open during the vulnerable window, else sealed gray.
  const open = boss.winddown < 0 && boss.cycleTick % C.BOSS_CYCLE_TICKS >= C.BOSS_CYCLE_TICKS - C.BOSS_OPEN_TICKS;
  const bx = x + (C.BOSS_HITBOX_W - C.BOSS_BOILER_W) / 2;
  const by = y + (C.BOSS_HITBOX_H - C.BOSS_BOILER_H) / 2;
  r.rect(bx, by, C.BOSS_BOILER_W, C.BOSS_BOILER_H, open ? CORAL : '#444b5e');
}

function drawHud(r: Canvas2DRenderer, state: GameState): void {
  const active = state.players.filter((p) => p && p.phase !== 'pending' && p.phase !== 'despawned');
  // Team total (or solo score).
  const total = state.players.reduce((sum, p) => sum + (p ? p.score : 0), 0);
  r.text(String(total).padStart(6, '0'), 4, 3, PAPER, 8);
  // Per-player score chips (co-op).
  if (active.length > 1) {
    state.players.forEach((p, slot) => {
      if (!p || p.phase === 'pending' || p.phase === 'despawned') return;
      r.text(String(p.score), 4 + slot * 56, 13, SLOT_TINT[slot]!, 6);
    });
  } else if (!state.reviveRules) {
    // Solo lives.
    r.text('x' + state.lives, 64, 3, CORAL, 8);
  }
  r.text(LEVELS[state.level]!.name.toUpperCase(), C.SCREEN_W - 4, 3, STAR, 6, 'right');
}

function drawBanner(r: Canvas2DRenderer, state: GameState): void {
  const mid = C.SCREEN_W / 2;
  const say = (msg: string, color: string): void => {
    r.rect(0, C.SCREEN_H / 2 - 12, C.SCREEN_W, 24, 'rgba(15,18,34,0.7)');
    r.text(msg, mid, C.SCREEN_H / 2 - 6, color, 12, 'center');
  };
  if (state.mode === 'levelclear') say(LEVELS[state.level]!.boss ? 'ZONE CLEAR!' : 'AREA CLEAR!', STAR);
  else if (state.mode === 'gameover') say('ALL SOAKED — TAP TO RETRY', CORAL);
  else if (state.mode === 'win') say('SQUAD WINS!', '#3df5a6');
}

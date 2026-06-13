/**
 * Splash Squad tuning constants — every value from SPEC.md, by section.
 * Integer / fixed-point only (determinism). Changing any of these is a gameplay
 * change: replay fixtures will (correctly) fail until regenerated.
 */

// §1 Coordinate system & units
export const TILE_SIZE = 8;
export const SCREEN_W = 256; // logical screen width in px (32 tiles)
export const SCREEN_H = 192; // logical screen height in px (24 tiles)
export const SCREEN_TILES_W = 32;
export const LEVEL_HEIGHT = 24; // tiles — v1 scrolls horizontally only

// §2 Scroll window
export const SCROLL_LEAD_PX = 144; // leader held this far from the window's left edge

// §3 Player ("Squaddie")
export const PLAYER_HITBOX_W = 12;
export const PLAYER_HITBOX_H = 14;
export const CROUCH_HITBOX_H = 8;
export const PLAYER_WALK_SPEED = 256; // subpx/tick (1 px/tick)
export const PLAYER_JUMP_VELOCITY = -544;
export const GRAVITY = 16;
export const MAX_FALL_SPEED = 512;
export const PLAYER_START_LIVES = 3; // solo only
export const RESPAWN_INVULN_TICKS = 120;
export const DEATH_PAUSE_TICKS = 60;
export const MUZZLE_DX = 8; // px ahead of player center
export const MUZZLE_DY_STAND = -2; // px from center (chest) standing
export const MUZZLE_DY_CROUCH = 4; // px from center crouched (low)

// §4 Water blaster: droplets & nozzles
export const DROPLET_SPEED = 384; // subpx/tick per axis (diagonals ×√2)
export const DROPLET_HITBOX = 6;
export const MAX_DROPLETS = 64; // hard cap; at cap, new shots are dropped

export const NOZZLE_STREAM = 0;
export const NOZZLE_SPREAD = 1;
export const NOZZLE_BURST = 2;

export const STREAM_CD = 9;
export const STREAM_LIFE = 56;
export const SPREAD_CD = 15;
export const SPREAD_LIFE = 44;
export const BURST_CD = 5;
export const BURST_LIFE = 28;

// §5 Tank & spigots
export const TANK_CAPACITY = 60;
export const REFILL_RATE = 3; // units/tick at a spigot
export const SPIGOT_W = 16;
export const SPIGOT_H = 16;

// §6 Robots (bestiary) + boss
export const WINDDOWN_TICKS = 30; // harmless sputter before despawn
export const ROBOT_HITBOX = 14; // square, the three grunt types

export const TRUNDLE_SPEED = 128;
export const TRUNDLE_HP = 2;

export const SENTRY_HP = 4;
export const SENTRY_FIRE_PERIOD = 90;
export const RUST_PELLET_SPEED = 192; // subpx/tick horizontal
export const RUST_PELLET_LOB_VY = -160; // initial upward lob
export const RUST_PELLET_GRAVITY = 8;
export const RUST_PELLET_HITBOX = 8;

export const HOPPER_HP = 3;
export const HOPPER_JUMP_PERIOD = 70;
export const HOPPER_JUMP_VY = -480;
export const HOPPER_HOP_VX = 160;

export const BOSS_HP_BASE = 30; // at zone 1
export const BOSS_HP_PER_ZONE = 10; // +per later zone
export const BOSS_HITBOX_W = 32;
export const BOSS_HITBOX_H = 32;
export const BOSS_BOILER_W = 12;
export const BOSS_BOILER_H = 12;
export const BOSS_CYCLE_TICKS = 150;
export const BOSS_OPEN_TICKS = 60; // boiler vulnerable for the cycle's tail
export const BOSS_STEAM_SPEED = 224;
export const BOSS_STEAM_HITBOX = 8;
export const BOSS_STEAM_LIFE = 120;

// §7 Soak, splash chains, downing & score
export const SPLASH_RADIUS = 24; // px between hitbox centers for a chain
export const SCORE_SOAK_TRUNDLE = 200;
export const SCORE_SOAK_SENTRY = 400;
export const SCORE_SOAK_HOPPER = 300;
export const SCORE_DISSOLVE_PELLET = 50;
export const SCORE_SPLASH_BONUS = 100; // per extra robot felled in one chain
export const SCORE_BOSS = 5000;
export const EXTRA_LIFE_SCORE = 20000; // solo only

// §10 Levels & zones
export const LEVEL_CLEAR_PAUSE_TICKS = 180;
export const LEVEL_COUNT = 6;

// §11 Multiplayer (co-op) — reuses Bubble Buddies conventions
export const MAX_PLAYERS = 4;
/** Tiles right of the level's `P` anchor, per slot (same as Bubble Buddies). */
export const PLAYER_SPAWN_OFFSETS = [0, 2, -2, 4] as const;
export const RESCUE_FLOAT_SPEED = -64;
export const RESCUE_POP_INVULN_TICKS = 120;
export const DISCONNECT_GRACE_TICKS = 300;
/** Rescue-bubble hitbox + bob (shared feel with Bubble Buddies §4/§11). */
export const RESCUE_HITBOX = 14;
export const BUBBLE_BOB_AMPLITUDE = 2;
export const BUBBLE_BOB_PERIOD = 64;

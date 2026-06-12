/**
 * Every tuning value from SPEC.md, by section. Changing any of these is a
 * gameplay change: replay fixtures will (correctly) fail until regenerated.
 */

// §1 Coordinate system
export const TILE_SIZE = 8;
export const LEVEL_WIDTH = 32;
export const LEVEL_HEIGHT = 24;

// §3 Player
export const PLAYER_HITBOX_W = 12;
export const PLAYER_HITBOX_H = 14;
export const PLAYER_WALK_SPEED = 288;
export const PLAYER_JUMP_VELOCITY = -560;
export const GRAVITY = 16;
export const MAX_FALL_SPEED = 512;
export const PLAYER_START_LIVES = 3;
export const RESPAWN_INVULN_TICKS = 120;
export const DEATH_PAUSE_TICKS = 90;
export const BLOW_COOLDOWN_TICKS = 18;

// §4 Bubble
export const BUBBLE_HITBOX = 14;
export const BUBBLE_BLOW_SPEED = 512;
export const BUBBLE_BLOW_TICKS = 24;
export const BUBBLE_FLOAT_SPEED = -64;
export const BUBBLE_BOB_AMPLITUDE = 2;
export const BUBBLE_BOB_PERIOD = 64;
export const BUBBLE_LIFETIME_TICKS = 360;
export const TRAP_ESCAPE_TICKS = 480;
export const CHAIN_POP_RADIUS = 20;

// §5 Enemies
export const ENEMY_HITBOX_W = 12;
export const ENEMY_HITBOX_H = 14;
export const GRUMBLE_WALK_SPEED = 192;
export const GRUMBLE_EDGE_TURN_NUM = 1;
export const GRUMBLE_EDGE_TURN_DEN = 2;
export const FLITTER_SPEED = 192;
/** Angry speed is ×ANGRY_SPEED_NUM/ANGRY_SPEED_DEN (integer math). */
export const ANGRY_SPEED_NUM = 3;
export const ANGRY_SPEED_DEN = 2;

// §6 Fruit & score
export const FRUIT_HITBOX = 8;
export const SCORE_POP_EMPTY = 10;
export const SCORE_POP_BASE = 1000;
export const SCORE_POP_MAX = 8000;
export const SCORE_FRUIT_GRUMBLE = 500;
export const SCORE_FRUIT_FLITTER = 700;
export const FRUIT_LIFETIME_TICKS = 600;
export const EXTRA_LIFE_SCORE = 30000;

// §7 Levels
export const LEVEL_CLEAR_PAUSE_TICKS = 180;
export const LEVEL_COUNT = 5;

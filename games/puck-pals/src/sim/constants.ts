/**
 * Puck Pals tuning constants (SPEC.md). Integer / fixed-point only — the sim is
 * deterministic (lint-enforced in src/sim/). Fractional factors are integer
 * ratios applied with truncation. Positions/velocities are subpixels
 * (SUBPX = 256 per pixel); the camera and HUD live in the renderer.
 */

// --- §1 Coordinate system & units ---
export const TILE_SIZE = 8;
export const RINK_W = 32; // tiles → 256 px (one screen wide)
export const RINK_H = 36; // tiles → 288 px (~1.5 screens tall)

// Pixel geometry derived from the rink (kept here so sim + renderer agree).
export const RINK_PX_W = RINK_W * TILE_SIZE; // 256
export const RINK_PX_H = RINK_H * TILE_SIZE; // 288
export const CENTER_X = 128; // px — rink horizontal center + goal-mouth center
export const CENTER_Y = 144; // px — center-ice faceoff dot

// --- §2 Goals ---
export const GOAL_MOUTH_HALF = 28; // px; mouth spans CENTER_X ± this
export const GOAL_LINE_TOP_Y = 16; // px; puck center ≤ this (in mouth) = top-net goal
export const GOAL_LINE_BOTTOM_Y = 272; // px; puck center ≥ this (in mouth) = bottom-net goal

// --- §3 Teams ---
export const TEAM_COUNT = 2; // Home (0), Away (1)
export const SKATERS_PER_TEAM = 3; // 0 Center, 1 Left Wing, 2 Right Wing
export const MAX_PLAYERS = 4; // human slots 0–3

// --- §3.1 Skater physics ---
export const SKATER_HITBOX = 10; // px (square)
export const SKATE_ACCEL = 56; // subpx/tick² per axis
export const SKATE_MAX_SPEED = 360; // subpx/tick per-axis cap
export const ICE_FRICTION_NUM = 244;
export const ICE_FRICTION_DEN = 256; // ≈ 4.7 %/tick decay (long slides)
export const SKATE_STOP_EPS = 24; // subpx/tick; below this an unpowered axis → 0
export const CHARGE_MOVE_NUM = 1;
export const CHARGE_MOVE_DEN = 3; // accel + cap scale while charging a slap (the tell)
export const TUMBLE_TICKS = 48; // ticks knocked down, no control
export const TUMBLE_FRICTION_NUM = 250;
export const TUMBLE_FRICTION_DEN = 256; // gentler decay — slides far
export const CHECK_COOLDOWN_TICKS = 30; // min ticks between a skater's checks
export const CHECK_MIN_SPEED = 200; // subpx/tick; checker must exceed to knock down

// --- §4 Puck & possession ---
export const PUCK_HITBOX = 6; // px (square)
export const PUCK_FRICTION_NUM = 252;
export const PUCK_FRICTION_DEN = 256; // glides much farther than a skater
export const PUCK_STOP_EPS = 16; // subpx/tick; below this on both axes a loose puck rests
export const PUCK_PICKUP_RADIUS = 9; // px center-to-center to gain possession
export const PUCK_CARRY_OFFSET = 7; // px ahead of carrier along facing
export const POSSESSION_COOLDOWN_TICKS = 18; // no re-grab for this long after a release
export const STEAL_RADIUS = 11; // px; poke-check reach
export const PASS_SPEED = 700; // subpx/tick
export const PASS_CONE_HALF = 40; // px lateral half-width of the auto-aim cone
export const STEAL_KICK_SPEED = 220; // subpx/tick the stolen puck pops away

// --- §5 Shooting & super slap ---
export const SHOT_SPEED = 900; // subpx/tick wrist shot
export const SLAP_CHARGE_MAX_TICKS = 45; // ticks to full charge
export const SUPER_SLAP_THRESHOLD = 30; // charge ≥ this on release = super slap (knockdown)
export const SUPER_SLAP_SPEED = 1800; // subpx/tick at full charge (< 1 tile/tick)

// --- §5.1 Goalie ---
export const GOALIE_HITBOX_W = 16;
export const GOALIE_HITBOX_H = 10;
export const GOALIE_SPEED = 300; // subpx/tick lateral
export const GOALIE_CREASE_HALF = 30; // px; slides within CENTER_X ± this
export const GOALIE_LINE_INSET = 24; // px; y sits this far inside its goal line

// --- §6 Board bounces ---
export const BOARD_RESTITUTION_NUM = 236;
export const BOARD_RESTITUTION_DEN = 256; // puck keeps ~92 % of speed off the boards

// --- §8 Periods, clock, overtime ---
export const PERIODS = 3;
export const PERIOD_TICKS = 3600; // 60 s
export const FACEOFF_FREEZE_TICKS = 90; // 1.5 s formation freeze
export const INTERMISSION_TICKS = 150; // 2.5 s; teams switch ends
export const GOAL_CELEBRATE_TICKS = 120; // 2 s goal-horn freeze
export const OT_PERIOD_TICKS = 3600; // 60 s sudden-death chunk
export const OT_MAX_PERIODS = 5; // cap before the shots-on-goal tiebreak

// --- §11 Netcode ---
export const DISCONNECT_GRACE_TICKS = 180; // 3 s without inputs → skater reverts to CPU

// --- §11.1 CPU AI ---
export const CPU_SHOOT_RANGE = 80; // px from the mouth a CPU carrier will shoot
export const CPU_PRESSURE_RANGE = 24; // px; opponent this close makes a CPU carrier pass
export const CPU_REACT_JITTER = 6; // max ticks of RNG reaction delay on a CPU decision

// --- §8.2 Faceoff formation (tiles, relative to CENTER, for the team
// defending the BOTTOM / attacking UP). The top-defending team mirrors dy. ---
export const FORMATION: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: 2 }, // Center
  { dx: -6, dy: 5 }, // Left Wing
  { dx: 6, dy: 5 }, // Right Wing
];
export const GOALIE_FORMATION = { dx: 0, dy: 16 }; // before the inset adjustment

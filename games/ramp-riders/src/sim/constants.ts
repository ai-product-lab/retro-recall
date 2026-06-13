/**
 * Ramp Riders tuning constants — every value from SPEC.md, by section.
 * Integer / fixed-point only (determinism, lint-enforced under src/sim/).
 * Changing any of these is a gameplay change: the golden replay fixture will
 * (correctly) fail until regenerated with REGEN_FIXTURES=1.
 */

// §1 Coordinate system
export const TILE_SIZE = 8;
export const LEVEL_HEIGHT = 18; // tiles (144 px) — one screen tall, no vertical scroll
export const VIEW_W = 256; // logical viewport px
export const VIEW_H = 144;

// §2 Camera
export const CAM_DEADZONE_W = 96; // px of horizontal slack, biased forward

// §3 Rider
export const RIDER_HITBOX_W = 12;
export const RIDER_HITBOX_H = 14;
export const MAX_PLAYERS = 4;

// §3.1 Throttle, speed & legs
export const ROLL_SPEED = 200; // subpx/tick coasting target
export const CRUISE_SPEED = 480; // subpx/tick pedaling (A)
export const BOOST_SPEED = 720; // subpx/tick pumping (B) with legs
export const GASSED_SPEED = 360; // subpx/tick forced when legs empty
export const ACCEL = 12; // subpx/tick² toward a higher target
export const DECEL = 8; // subpx/tick² toward a lower target / friction
export const LEGS_MAX = 600;
export const LEGS_BOOST_DRAIN = 4; // per tick pumping on the ground
export const LEGS_REGEN = 2; // per tick grounded, not pumping
export const LEGS_RECOVER_THRESHOLD = 120; // gassed → can pump again at this
export const LEGS_CLEAN_LANDING_REFILL = 120;

// §3.2 Lanes
export const LANE_COUNT = 3; // 0 front, 1 mid, 2 back
export const LANE_SWITCH_COOLDOWN = 10; // ticks
export const START_LANE = 1;

// §3.3 Air, tilt & lean (tilt in integer degrees; <0 nose up, >0 nose down)
export const GRAVITY = 20; // subpx/tick² airborne
export const MAX_FALL_SPEED = 640;
export const AIR_DRAG_NUM = 63;
export const AIR_DRAG_DEN = 64;
export const TILT_MIN = -90;
export const TILT_MAX = 90;
export const LEAN_RATE = 4; // deg/tick while leaning
/**
 * Natural nose-down rotation per airborne tick. **0 in v1** (forgiving: a level
 * pop lands flat with no input, so kids clear ramps without fighting the bike;
 * leaning is then opt-in for down-ramp/tabletop landings and not over-rotating
 * into a wipeout). Raise it for a future skill mode. (Refinement on SPEC §3.3,
 * recorded in the devlog.)
 */
export const AIR_ROTATE = 0;

// §3.4 Wipeout
export const WIPEOUT_TICKS = 70;
export const WIPEOUT_LEGS_REFILL = 200;

// §4 Ramps, launch & landing
export const LAUNCH_NUM_45 = 1;
export const LAUNCH_DEN_45 = 1;
export const LAUNCH_NUM_22 = 1;
export const LAUNCH_DEN_22 = 2;
export const MAX_LAUNCH_VY = 800;
export const PREJUMP_WINDOW = 8; // ticks armed before the lip
export const PREJUMP_BONUS_VY = 180;
export const PREJUMP_LEGS_COST = 40;
export const CLEAN_LANDING_TOLERANCE = 12; // deg
export const OK_LANDING_TOLERANCE = 30; // deg
export const OK_LANDING_SPEED_NUM = 7;
export const OK_LANDING_SPEED_DEN = 8;

/** Landing surface angle (deg) by ground steepness; sign matches tilt (>0 nose down). */
export const SURFACE_ANGLE_FLAT = 0;
export const SURFACE_ANGLE_22 = 22;
export const SURFACE_ANGLE_45 = 45;

// §5 Obstacles
export const MUD_SPEED = 280; // subpx/tick cap in mud
export const MUD_LEGS_DRAIN = 3;
export const SPRINKLER_PERIOD = 150; // ticks per on/off cycle
export const SPRINKLER_ON_TICKS = 60;
export const SPRINKLER_SLOW_NUM = 1;
export const SPRINKLER_SLOW_DEN = 2;
export const STAGGER_TICKS = 24;
export const HOSE_SLOW_NUM = 3;
export const HOSE_SLOW_DEN = 4;
/** Obstacle x-extent in tiles (how wide the hazard footprint is). */
export const OBSTACLE_WIDTH_TILES = 2;

// §6 Junior boost (rubber-band assist, room-level)
export const JUNIOR_BOOST_DIVISOR = 64; // gap-px ÷ this = bonus subpx/tick
export const JUNIOR_BOOST_MAX = 160;

// §10 Multiplayer
export const DISCONNECT_GRACE_TICKS = 300; // 5 s without inputs → coast to a stop

// §7 Race structure
export const COUNTDOWN_TICKS = 180; // 3-2-1-GO
export const RACE_TIMEOUT_TICKS = 7200; // 120 s hard cap
export const FINISH_LINGER_TICKS = 300;

// §12 Tracks
export const TRACK_COUNT = 5;
export const SEGMENT_HEIGHT = LEVEL_HEIGHT;
/** Row (0-indexed from top) where solid ground begins; rows below are dirt. */
export const GROUND_ROW = 15;

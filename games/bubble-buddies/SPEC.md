# Bubble Buddies — Game Spec (v1, Phase 1 single-player)

Design grammar: single-screen co-op platformer — trap enemies in projectiles,
pop them for points, clear the screen, next level. This spec is the source of
truth: the sim is implemented from it, tests verify against it, and every
tuning value below is a named constant in code (`src/sim/constants.ts`).

Phase 1 scope is **one player, keyboard, 5 levels, placeholder sprites**.
Multiplayer hooks (entity IDs, input-stream design) are kept in mind but not
implemented.

---

## 1. Coordinate system & units

| Constant | Value | Meaning |
|---|---|---|
| `TILE_SIZE` | 8 | pixels per tile |
| `LEVEL_WIDTH` | 32 | tiles |
| `LEVEL_HEIGHT` | 24 | tiles |
| `SUBPX` | 256 | subpixels per pixel — all positions/velocities are integers in subpixels |
| `TICKS_PER_SECOND` | 60 | fixed sim rate (from RetroKit) |

- Logical screen: 256×192 px, scaled by the renderer (sim never knows).
- Y grows downward. Positions are entity top-left corners in subpixels.
- All arithmetic is integer. Where a multiplier is fractional it is expressed
  as an integer ratio (e.g. ×3/2 = `v * 3 / 2` with truncation).
- Levels are fully enclosed (ceiling, floor, side walls). No screen wrap in v1.

## 2. Tiles

| Symbol | Tile | Behavior |
|---|---|---|
| `#` | Solid | blocks movement from all sides |
| `=` | Platform | one-way: solid only when falling onto it from above |
| `.` | Empty | — |
| `P` | Player spawn | empty tile; marker = tile containing entity's bottom-left |
| `G` | Grumble spawn | empty tile, same convention |
| `F` | Flitter spawn | empty tile, same convention |

Collision is AABB vs. tile grid, resolved per axis (X then Y). An entity is
*grounded* when its bottom edge rests on a solid tile, or on a platform tile it
approached from above (previous tick's bottom edge was at or above the
platform's top).

## 3. Player ("Buddy")

Sprite 16×16 px; hitbox `PLAYER_HITBOX_W`×`PLAYER_HITBOX_H` = 12×14 px,
centered horizontally, bottom-aligned.

| Constant | Value | Meaning |
|---|---|---|
| `PLAYER_WALK_SPEED` | 288 | subpx/tick (1.125 px/tick = 67.5 px/s) |
| `PLAYER_JUMP_VELOCITY` | −560 | subpx/tick at jump start |
| `GRAVITY` | 16 | subpx/tick², applies to player, escaped enemies, fruit |
| `MAX_FALL_SPEED` | 512 | subpx/tick (2 px/tick) |
| `PLAYER_START_LIVES` | 3 | |
| `RESPAWN_INVULN_TICKS` | 120 | 2 s of invulnerability after respawn (sprite blinks) |
| `DEATH_PAUSE_TICKS` | 90 | death animation before respawn |
| `BLOW_COOLDOWN_TICKS` | 18 | min ticks between bubbles |

Rules:

- **Move:** LEFT/RIGHT set horizontal velocity to ±`PLAYER_WALK_SPEED`
  (instant, no acceleration — NES feel). No input → 0. Facing follows last
  nonzero horizontal input.
- **Jump:** only when grounded; sets vy = `PLAYER_JUMP_VELOCITY`. Gravity adds
  every airborne tick; vy clamps to `MAX_FALL_SPEED`. Max jump height ≈ 38 px
  ≈ 4.7 tiles — level platforms are spaced 4 tiles apart, so every layer is
  reachable. Jumping passes through `=` platforms from below.
- **Blow:** BLOW spawns a bubble one tile ahead of the player's facing edge,
  if cooldown elapsed. Holding BLOW does not auto-repeat; it must be released
  and pressed again.
- **Death:** touching a live (non-trapped, non-fruit) enemy while not
  invulnerable. Lose a life, pause `DEATH_PAUSE_TICKS`, respawn at the level's
  `P` with invulnerability. At 0 lives → game over.

## 4. Bubble

Sprite 16×16 px; hitbox 14×14 px centered. A bubble has two phases:

| Constant | Value | Meaning |
|---|---|---|
| `BUBBLE_BLOW_SPEED` | 512 | subpx/tick horizontal, in facing direction |
| `BUBBLE_BLOW_TICKS` | 24 | blow phase duration (travels 48 px = 6 tiles) |
| `BUBBLE_FLOAT_SPEED` | −64 | subpx/tick upward during float phase |
| `BUBBLE_BOB_AMPLITUDE` | 2 | px, triangle-wave bob while resting at ceiling |
| `BUBBLE_BOB_PERIOD` | 64 | ticks per bob cycle |
| `BUBBLE_LIFETIME_TICKS` | 360 | empty bubble self-pops 6 s after spawn |
| `TRAP_ESCAPE_TICKS` | 480 | trapped enemy breaks out after 8 s |
| `CHAIN_POP_RADIUS` | 20 | px between bubble centers for chain pops |

Rules:

- **Blow phase** (first `BUBBLE_BLOW_TICKS` ticks): moves horizontally; this is
  the only phase that **traps** enemies. Hitting a solid tile ends the phase
  early.
- **Float phase:** moves up at `BUBBLE_FLOAT_SPEED` until blocked by a solid
  tile above, then rests there bobbing ±`BUBBLE_BOB_AMPLITUDE` px (triangle
  wave, period `BUBBLE_BOB_PERIOD`). Bubbles pass through `=` platforms.
- **Trap:** blow-phase bubble overlapping a live enemy captures it (one enemy
  per bubble; first overlap in update order wins). The bubble immediately
  enters float phase. Trapped enemies are harmless.
- **Escape:** after `TRAP_ESCAPE_TICKS`, the enemy breaks out where the bubble
  is, becomes **angry** (speed ×3/2, tinted sprite) and falls/resumes. The
  bubble is gone.
- **Pop:** player hitbox overlapping any bubble pops it (jumping into it,
  walking into it — any contact). Popping a bubble also pops every bubble
  whose center is within `CHAIN_POP_RADIUS` of one already popping, applied
  transitively in the same tick (chain).
- Popping an **empty** bubble: small score, nothing else. Popping a **full**
  bubble kills the enemy: it becomes fruit at the bubble's position.
- Empty bubbles self-pop (no score) at `BUBBLE_LIFETIME_TICKS`. Full bubbles
  never self-pop; the enemy escapes instead.

## 5. Enemies

Both are 16×16 px sprites with 12×14 px hitboxes. Spawn facing left. When
angry (after escaping a bubble), speed is ×3/2 for the rest of their life.

### Grumble (walker)

| Constant | Value | Meaning |
|---|---|---|
| `GRUMBLE_WALK_SPEED` | 192 | subpx/tick (0.75 px/tick) |
| `GRUMBLE_EDGE_TURN_CHANCE` | 1/2 | chance to turn at a ledge (else walks off) |

Walks in its facing direction; gravity applies. Turns around at solid walls.
At a ledge (next step would leave it unsupported), it consults the sim RNG:
with `GRUMBLE_EDGE_TURN_CHANCE` it turns, otherwise it walks off and falls
(continuing to walk on landing).

### Flitter (flyer)

| Constant | Value | Meaning |
|---|---|---|
| `FLITTER_SPEED` | 192 | subpx/tick per axis (moves diagonally) |

Ignores gravity. Moves diagonally (vx = ±`FLITTER_SPEED`, vy =
±`FLITTER_SPEED`); initial direction is down-left. Bounces: hitting a tile
horizontally flips vx, vertically flips vy. Passes through `=` platforms.

## 6. Fruit & score

| Constant | Value | Meaning |
|---|---|---|
| `SCORE_POP_EMPTY` | 10 | popping an empty bubble |
| `SCORE_POP_BASE` | 1000 | first enemy popped in a chain |
| `SCORE_POP_MAX` | 8000 | chain doubles per enemy: 1000, 2000, 4000, 8000 (cap) |
| `SCORE_FRUIT_GRUMBLE` | 500 | banana |
| `SCORE_FRUIT_FLITTER` | 700 | berry |
| `FRUIT_LIFETIME_TICKS` | 600 | fruit despawns after 10 s uncollected |
| `EXTRA_LIFE_SCORE` | 30000 | one extra life the first time score crosses this |

- Fruit spawns where the enemy died, falls under gravity, lands on
  solid/platform tiles, and waits. Player contact collects it.
- Chain scoring: within one tick's chain pop, the n-th *enemy-carrying* bubble
  scores `min(SCORE_POP_BASE × 2^(n−1), SCORE_POP_MAX)`.
- Score is per-game, shown in the HUD, resets on game over → restart.

## 7. Levels, clear & game over

- **Level clear:** no live enemies, no trapped enemies, and no fruit on screen
  (collected or expired). Hold `LEVEL_CLEAR_PAUSE_TICKS` = 180, then load the
  next level (player position resets to its `P`, score/lives carry over).
- **Win:** clearing level 5 shows a "YOU WIN" screen with final score; any
  key restarts at level 1 (fresh score/lives).
- **Game over:** "GAME OVER" screen with score; any key restarts at level 1
  (fresh score/lives).

## 8. Input

Logical inputs (the sim sees only these as per-tick booleans — this is also
the netcode/replay format):

| Logical | Default keys |
|---|---|
| `LEFT` / `RIGHT` | Arrow Left / Arrow Right |
| `JUMP` | Z or Space |
| `BLOW` | X |
| `START` | Enter (confirm on win/game-over screens) |

## 9. Determinism & update order

- The sim implements RetroKit's `GameSim` interface: `init(seed, level)`,
  `tick(inputs)`, `serialize()`, `hash()`. No DOM, network, wall-clock, or
  `Math.random` (lint-enforced).
- One seeded RNG owned by the sim; consumers draw in entity-ID order.
- Fixed update order per tick: read inputs → player (move/jump/blow) →
  bubbles (move, trap, escape, lifetime) → enemies → fruit → pops & contact
  resolution → score/lives/level-state. Entities update in ascending ID order.
- Every replay test fixture is an input log + expected final state hash.

## 10. Level maps

5 levels, each exactly 32×24 tiles. Difficulty ramps: walkers only → flyer
introduced → mixed finale. Platform layers are 4 tiles apart (jump is 4.7).

### Level 1 — "Warm-Up" (2 Grumbles)

```
################################
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#....G.........................#
#==========..........==========#
#..............................#
#..............................#
#...............G..............#
#.......================.......#
#..............................#
#..............................#
#..............................#
#============......============#
#..............................#
#..............................#
#..............................#
#...========================...#
#..............................#
#..............................#
#..P...........................#
################################
```

### Level 2 — "Side Steps" (3 Grumbles)

```
################################
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............G...............#
#.........============.........#
#..............................#
#..............................#
#...G......................G...#
#=========............=========#
#..............................#
#..............................#
#..............................#
#.....====================.....#
#..............................#
#..............................#
#..............................#
#=========............=========#
#..............................#
#..............................#
#...............P..............#
################################
```

### Level 3 — "First Flight" (2 Grumbles, 1 Flitter)

```
################################
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#...G..........................#
#========..............========#
#..............................#
#...............F..............#
#..............................#
#...........========...........#
#..............................#
#..............................#
#..........................G...#
#========..............========#
#..............................#
#..............................#
#..............................#
#...........========...........#
#..............................#
#..............................#
#...............P..............#
################################
```

### Level 4 — "The Tower" (2 Grumbles, 2 Flitters)

```
################################
#..............................#
#..............................#
#..............................#
#..............................#
#.......F......................#
#........................G.....#
#..................============#
#..............................#
#..............................#
#.....G........................#
#============..................#
#..............................#
#...............F..............#
#..............................#
#..................============#
#..............................#
#..............................#
#..............................#
#============..................#
#..............................#
#..............................#
#..P...........................#
################################
```

### Level 5 — "Bubble Keep" (3 Grumbles, 2 Flitters)

```
################################
#..............................#
#..............................#
#..............................#
#.........F....................#
#..............................#
#...............G..............#
#........==============........#
#..............................#
#..............................#
#...G......................G...#
#========..............========#
#..............................#
#.....................F........#
#..............................#
#######....==========....#######
#..............................#
#..............................#
#..............................#
#...========================...#
#..............................#
#..............##..............#
#..P...........##..............#
################################
```

## 11. Out of scope for v1 (parking lot)

- Second player / netcode (Phase 2)
- Vertical screen wrap through floor gaps
- Riding/bouncing on bubbles as platforms
- Special bubbles (water, lightning), power-ups, "hurry up" anti-stall enemy
- Sound and music
- Real sprites (Phase 1 uses colored rectangles; avatars are Phase 3)

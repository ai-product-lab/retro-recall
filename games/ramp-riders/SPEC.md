# Ramp Riders — Game Spec (v1: 1–4 online race)

Design grammar: side-scrolling motocross-style racing (inspiration: a NES
dirt-bike racer — internal reference only, ADR-005), reskinned as **backyard
BMX**. Pump for speed, hit dirt ramps for air, lean to land clean and keep
momentum, dodge mud and sprinklers by switching lanes, first across the
finish-line wins. Short races (45–90 s) so "one more!" always wins.

This spec is the source of truth: the sim is implemented from it, tests verify
against it, and every tuning value below is a named constant in
`src/sim/constants.ts`. v1 scope is **1–4 riders, 5 tracks, placeholder
sprites** (avatars are a later dependency — see §13). The track editor is
**parked** (§12).

> Conventions follow Bubble Buddies' SPEC: integer/fixed-point constants, ASCII
> maps, explicit §determinism and §multiplayer. Built on RetroKit's shared
> engine (camera, big maps, slope tiles, spawn regions — ADR-009 Stage 1); no
> `packages/*` changes are needed (§14).

---

## 0. Open-for-SPEC resolutions (from the BRIEF)

| BRIEF question | Resolution | Where |
|---|---|---|
| Pump / boost / landing values | Legs meter (drains on pump, refills on clean landings); cruise/boost/gassed speeds; tilt-vs-surface landing grades | §3, §4 |
| Slope angle set | 22.5° and 45° (RetroKit's `/ \ < [ ] >` tiles), launch ratio per angle | §2, §4 |
| Obstacle table | Mud, sprinkler, hose, cone — per-lane, with effects | §5 |
| Lane count | **3** (front / mid / back), Up/Down to switch, riders pass through each other | §2, §3 |
| v1 track count | **5** authored from reusable segment modules; editor parked | §8, §12 |
| Rubber-band assist | **Room-level "junior boost" toggle** (rubber-bands all trailing riders), default OFF; per-rider targeting parked behind a netcode join-metadata field | §6 |

---

## 1. Coordinate system & units

| Constant | Value | Meaning |
|---|---|---|
| `TILE_SIZE` | 8 | pixels per tile |
| `LEVEL_HEIGHT` | 18 | tiles (144 px — exactly one screen tall; no vertical scroll) |
| `SUBPX` | 256 | subpixels per pixel — all positions/velocities are integers in subpixels |
| `TICKS_PER_SECOND` | 60 | fixed sim rate (from RetroKit) |

- Logical screen (viewport): **256×144 px**, scaled by the renderer (sim never
  knows). 32×18 tiles visible at once.
- X grows rightward (race direction), Y grows downward. Positions are entity
  top-left corners in subpixels.
- All arithmetic is integer. Fractional multipliers are integer ratios
  (e.g. ×7/8 = `v * 7 / 8` with truncation).
- Tracks are **long horizontal maps** (~20 screens ≈ 640 tiles): the camera
  scrolls horizontally; the level is one screen tall so the camera never
  scrolls vertically. Tracks are fully enclosed top/bottom/left, open only at
  the finish wall on the right.

## 2. Tiles & maps

Terrain is RetroKit tiles parsed from ASCII (see `TileMap.parse`):

| Symbol | Tile | Behavior |
|---|---|---|
| `#` | Solid | ground / walls; blocks from all sides |
| `=` | Platform | one-way landing ledge (land from above, pass from below) |
| `.` | Empty | air |
| `/` | Slope45R | 45° rising to the right (a launch ramp) |
| `\` | Slope45L | 45° rising to the left (a landing down-ramp / back of a jump) |
| `<` `[` | Slope22RLo / Hi | 22.5° rising right, lower then upper half (a Lo+Hi pair = one full-tile ramp) |
| `]` `>` | Slope22LHi / Lo | 22.5° rising left, upper then lower half |
| `R` | Rider spawn | empty tile; marker = the rider's start (bottom-left convention, as Bubble Buddies §2) |
| `X` | Finish marker | empty tile; its tile-x defines `finishX` (§7) |

Collision and slope resolution are RetroKit's (`moveAABB`, slope-aware): a slope
tile is non-solid; the resolver lifts a grounded box onto the ramp surface
sampled under its horizontal center. This is the **one real physics-core
capability** Ramp Riders needs, and it already landed on `main` in Stage 1 — no
new engine change (§14).

**Lanes.** A separate integer axis `lane ∈ {0,1,2}` (0 = front, 1 = mid, 2 =
back). Lanes do **not** change terrain physics — every lane rides the same
side-view profile (the same hill). Lanes only determine **which obstacles a
rider collides with** (§5) and a small vertical render offset for readability.
Riders never collide with each other (deliberate, BRIEF) — lanes are for dodging
obstacles, not blocking family members.

**Camera.** RetroKit `Camera` over the track world (`map.pixelWidth × pixelHeight`),
**per-client**, following that client's own rider horizontally with a deadzone
biased forward (`deadzoneW = CAM_DEADZONE_W`, `lockX: 'free'`, `lockY: 'free'`).
Vertical never scrolls (level fits the view). Rivals off-screen are shown as HUD
position pips (renderer concern, §9). The camera is never read by the sim
(determinism, §11).

## 3. Rider

Sprite 16×16 px; hitbox `RIDER_HITBOX_W`×`RIDER_HITBOX_H` = 12×14 px, centered
horizontally, bottom-aligned. A rider auto-rolls forward (+x); there is no
manual "walk." The throttle decides target speed; ramps decide air.

### 3.1 Throttle, speed & the legs meter

| Constant | Value | Meaning |
|---|---|---|
| `ROLL_SPEED` | 200 | subpx/tick — coasting target with no pedal (≈0.78 px/tick) |
| `CRUISE_SPEED` | 480 | subpx/tick — target while pedaling (A), ≈1.875 px/tick = 112 px/s |
| `BOOST_SPEED` | 720 | subpx/tick — target while pumping (B) with legs, ≈2.8 px/tick = 168 px/s |
| `GASSED_SPEED` | 360 | subpx/tick — forced target when legs are empty |
| `ACCEL` | 12 | subpx/tick² toward a higher target |
| `DECEL` | 8 | subpx/tick² toward a lower target (and friction) |
| `LEGS_MAX` | 600 | legs meter capacity |
| `LEGS_BOOST_DRAIN` | 4 | per tick while pumping on the ground |
| `LEGS_REGEN` | 2 | per tick while grounded and not pumping |
| `LEGS_RECOVER_THRESHOLD` | 120 | gassed riders must reach this before pumping again |
| `LEGS_CLEAN_LANDING_REFILL` | 120 | legs added on a clean landing (§4) — the core loop |

Rules (per rider, each tick, while racing):

- **Target speed:** pumping (B held) **and** not gassed → `BOOST_SPEED`;
  else pedaling (A held) → `CRUISE_SPEED`; else → `ROLL_SPEED`. Empty legs force
  **gassed**: target `GASSED_SPEED` until `legs ≥ LEGS_RECOVER_THRESHOLD`.
- **Approach:** `speed` moves toward target by `ACCEL` (if below) or `DECEL`
  (if above), clamped, never negative.
- **Legs:** pumping on the ground drains `LEGS_BOOST_DRAIN`; reaching 0 sets
  gassed. Grounded and not pumping regenerates `LEGS_REGEN` (capped at
  `LEGS_MAX`). Clean landings add `LEGS_CLEAN_LANDING_REFILL`. Airborne ticks
  neither drain nor regen.
- **Horizontal motion** integrates at `speed` (in the facing = +1 direction;
  riders never move backward). Mud/sprinklers/hoses cap or cut it (§5).

### 3.2 Lanes

| Constant | Value | Meaning |
|---|---|---|
| `LANE_COUNT` | 3 | front / mid / back |
| `LANE_SWITCH_COOLDOWN` | 10 | ticks between lane changes |
| `START_LANE` | 1 | every rider starts in the mid lane |

Up = toward back (`lane+1`), Down = toward front (`lane−1`), clamped to
`[0, LANE_COUNT)`, ignored during cooldown. Lane changes are instant in the sim
(the renderer tweens the vertical offset). Lanes may be switched in the air.

### 3.3 Air, tilt & lean

A rider is **airborne** when not grounded. In the air:

| Constant | Value | Meaning |
|---|---|---|
| `GRAVITY` | 20 | subpx/tick² while airborne |
| `MAX_FALL_SPEED` | 640 | subpx/tick (2.5 px/tick — still < 8 px tile, no tunneling) |
| `AIR_DRAG_NUM` / `AIR_DRAG_DEN` | 63 / 64 | horizontal speed ×63/64 per airborne tick (gentle bleed) |
| `TILT_MIN` / `TILT_MAX` | −90 / 90 | degrees; **<0 = nose up, >0 = nose down**, 0 = level |
| `LEAN_RATE` | 4 | degrees/tick while leaning |
| `AIR_ROTATE` | 0 | natural nose-down drift/tick — **0 in v1** (forgiving; a level pop lands flat with no input). Raise for a skill mode. |

- Gravity adds to `vy` each airborne tick, clamped to `MAX_FALL_SPEED`.
- **Launch tilt is 0** (a level pop). With `AIR_ROTATE = 0`, doing nothing lands
  flat (clean) — forgiving for kids; leaning is opt-in for down-ramp/tabletop
  landings and for not over-rotating into a wipeout.
- **Lean:** Left rotates nose **up** (`tilt −= LEAN_RATE`), Right rotates nose
  **down** (`tilt += LEAN_RATE`), then `AIR_ROTATE` is added, clamped to
  `[TILT_MIN, TILT_MAX]`.
- Horizontal speed bleeds by `AIR_DRAG_NUM/AIR_DRAG_DEN` per airborne tick.
- Lean has no effect on the ground (tilt is forced toward the ground angle on
  landing).

### 3.4 Wipeout

| Constant | Value | Meaning |
|---|---|---|
| `WIPEOUT_TICKS` | 70 | comic tumble; rider is stopped, then auto-remounts |
| `WIPEOUT_LEGS_REFILL` | 200 | legs restored on remount (you catch your breath) |

On a bad landing or a cone hit (§4, §5) the rider **wipes out**: `speed := 0`,
`vy := 0`, `tilt := 0`, `phase := 'wipeout'`, `wipeoutTicks := WIPEOUT_TICKS`.
Each tick decrements the timer; movement inputs are ignored; the rider does not
advance. At 0 it remounts at its current x/lane on the nearest ground with
`legs += WIPEOUT_LEGS_REFILL` (capped) and `phase := 'racing'`. Fast-recovery,
no lives, no elimination (BRIEF: comic, family-friendly).

## 4. Ramps, launching & landing

Launching and clean landings are the heart of the game.

| Constant | Value | Meaning |
|---|---|---|
| `LAUNCH_NUM_45` / `LAUNCH_DEN_45` | 1 / 1 | 45° ramp launch vy = `−speed × 1/1` |
| `LAUNCH_NUM_22` / `LAUNCH_DEN_22` | 1 / 2 | 22.5° ramp launch vy = `−speed × 1/2` |
| `MAX_LAUNCH_VY` | 800 | cap on upward launch velocity (subpx/tick) |
| `PREJUMP_WINDOW` | 8 | ticks before the lip in which a B-tap counts as a pre-jump |
| `PREJUMP_BONUS_VY` | 180 | extra upward launch velocity for a well-timed pre-jump |
| `PREJUMP_LEGS_COST` | 40 | legs spent on a pre-jump pop |
| `CLEAN_LANDING_TOLERANCE` | 12 | degrees: \|tilt − surfaceAngle\| ≤ this = clean |
| `OK_LANDING_TOLERANCE` | 30 | degrees: ≤ this (but > clean) = ok landing |
| `OK_LANDING_SPEED_NUM` / `_DEN` | 7 / 8 | speed kept on an ok landing |

**Launch.** While grounded, the tile under the rider's center is sampled. On a
**rising ramp** (a `/`/`<`/`[` while moving right) the sim arms
`rampLaunchVy = clamp(−speed × LAUNCH_NUM/LAUNCH_DEN, −MAX_LAUNCH_VY, 0)` and
sets the rider's `tilt` to match the ramp face (so a launch starts aligned). On
the first tick the rider rolls off the **lip** (RetroKit reports no ground
support while `rampLaunchVy` is armed), `vy := rampLaunchVy`, the rider goes
airborne, and `rampLaunchVy` resets. Rolling onto flat ground instead clears the
arm with no launch.

**Pre-jump.** A `B` press while on a rising ramp within `PREJUMP_WINDOW` ticks of
the lip adds `PREJUMP_BONUS_VY` to the launch and costs `PREJUMP_LEGS_COST`
legs — the "pop" that turns a roll into real air. Pressing B too early on the
ramp just spends legs (no bonus); this is the skill expression.

**Landing.** When an airborne rider becomes grounded, compare `tilt` to the
landing surface's angle (`surfaceAngle`: 0 flat, +22 or +45 on a down-ramp face
`\`, etc. — table in `constants.ts`):

- **Clean** (`|tilt − surfaceAngle| ≤ CLEAN_LANDING_TOLERANCE`): keep all speed,
  add `LEGS_CLEAN_LANDING_REFILL` legs, `tilt := surfaceAngle`. This is what
  chains momentum down a track.
- **Ok** (`≤ OK_LANDING_TOLERANCE`): `speed := speed × 7/8`, no legs bonus.
- **Bad** (`> OK_LANDING_TOLERANCE`, or any nose-up landing beyond tolerance):
  **wipeout** (§3.4).

## 5. Obstacles

Obstacles are a per-track data table, each `{ atTile, lane, kind }` (placing them
in a table rather than the ASCII keeps the **lane** axis clean and is the seam
the editor will write). A rider is affected by an obstacle only when **grounded**
and in the **same lane** and overlapping its x-extent — so you dodge by lane
**or** by being airborne (jump it).

| Kind | Art | Effect (grounded, same lane) | Avoid by |
|---|---|---|---|
| `mud` | puddle | speed capped to `MUD_SPEED` while overlapping; legs drain `MUD_LEGS_DRAIN`/tick | other lane, or airborne |
| `sprinkler` | spray | if ON during overlap, stagger: speed ×`SPRINKLER_SLOW_NUM/_DEN` for `STAGGER_TICKS` | time it (cycles), other lane, or airborne |
| `hose` | coil | a stumble: speed ×`HOSE_SLOW_NUM/_DEN` once on contact, brief hop | other lane, or airborne |
| `cone` | cone | **wipeout** (§3.4) | other lane, or airborne |

| Constant | Value | Meaning |
|---|---|---|
| `MUD_SPEED` | 280 | subpx/tick cap while in mud |
| `MUD_LEGS_DRAIN` | 3 | legs/tick while in mud |
| `SPRINKLER_PERIOD` | 150 | ticks per on/off cycle (2.5 s) |
| `SPRINKLER_ON_TICKS` | 60 | ticks ON within each period |
| `SPRINKLER_SLOW_NUM` / `_DEN` | 1 / 2 | speed multiplier during a stagger |
| `STAGGER_TICKS` | 24 | stagger duration |
| `HOSE_SLOW_NUM` / `_DEN` | 3 / 4 | speed multiplier on a hose stumble |

Sprinkler phase is a **pure function of the global tick** (`tick % SPRINKLER_PERIOD
< SPRINKLER_ON_TICKS`) — no per-obstacle state, identical on every client. All
sprinklers share phase in v1.

## 6. "Junior boost" (rubber-band assist)

A **room-level** toggle (`juniorBoost`, default OFF), passed into the sim at
construction (§10). When ON, every rider **behind the leader** gets a gentle
catch-up bonus to its speed targets:

| Constant | Value | Meaning |
|---|---|---|
| `JUNIOR_BOOST_DIVISOR` | 64 | gap-px ÷ this = bonus subpx/tick |
| `JUNIOR_BOOST_MAX` | 160 | cap on the catch-up bonus |

Each tick, `gap = leaderX − riderX` (≥0); the rider's `CRUISE_SPEED` /
`BOOST_SPEED` / `GASSED_SPEED` targets are raised by
`min(JUNIOR_BOOST_MAX, gap / JUNIOR_BOOST_DIVISOR)`. The leader gets nothing.
Uses authoritative positions only, so it is deterministic.

> **Parked refinement:** targeting only the *youngest* rider needs a per-slot
> "junior" flag carried on join, which `JoinMsg` doesn't have yet (a
> `packages/netcode` change, out of scope for this additive worktree — §14). v1
> rubber-bands all trailing riders equally; the per-rider version lands when
> netcode grows a join-metadata field.

## 7. Race structure, win & lose

| Constant | Value | Meaning |
|---|---|---|
| `COUNTDOWN_TICKS` | 180 | 3-2-1-GO (3 s) before riders may move |
| `RACE_TIMEOUT_TICKS` | 7200 | 120 s hard cap; un-finished riders are placed by distance |
| `FINISH_LINGER_TICKS` | 300 | results held 5 s after the last finish/timeout, then `done` |

States (`mode`): `countdown` → `racing` → `results` → `done`.

- **Countdown:** riders are frozen at their `R` spawn (lane = `START_LANE`);
  movement inputs ignored; `Start` is a UI ready-up only (does not gate the sim
  clock). At `COUNTDOWN_TICKS`, `mode := racing`.
- **Finish:** when a racing rider's hitbox center first crosses `finishX`, record
  `finishTick` and assign the next `finishPlace` (1-based). Ties on the same
  tick break by **lower slot** (documented, deterministic — §11).
- **Results:** entered when every active rider has finished **or** at
  `RACE_TIMEOUT_TICKS` (remaining riders placed by descending x, slot-order tie
  break). Holds `FINISH_LINGER_TICKS`, then `mode := done`.
- A race is one track; "one more!" is a new room/seed (the shell rotates tracks).
  No scoring beyond placement in v1; the finish-line **photo** is a shell concern
  (§9) driven off the recorded finish order.

## 8. Input

Logical inputs (the sim sees only these per-tick booleans — also the
netcode/replay format; bits from RetroKit's `Button`):

| Logical | `Button` | Race role |
|---|---|---|
| Pedal | `A` | accelerate toward `CRUISE_SPEED` |
| Pump | `B` | boost toward `BOOST_SPEED` (drains legs); a B-tap near a lip is a **pre-jump** |
| Lane up / down | `Up` / `Down` | switch lane (back / front) |
| Lean up / down | `Left` / `Right` | air only: rotate nose up / down |
| Ready | `Start` | UI ready-up on countdown/results (no sim effect) |

Default keys (keyboard) and dual-orientation touch layout in §9.

## 9. Rendering & controls (shell, non-sim)

- **Per-client camera** follows the local rider (§2). Rivals are drawn as
  **interpolated ghosts** (the netcode client already interpolates remote
  entities — BRIEF); off-screen rivals show as edge pips with their place.
- **HUD:** legs meter, current place (e.g. "2nd / 4"), lane indicator, countdown,
  and a finish-line results card with the placement order (the "photo").
- **Dual-orientation touch (ADR-007):** the scaffolded `src/shell/layout.ts`
  integer-scales the canvas and reports a `Button` bitmask. Ramp Riders' control
  map:
  - **Landscape:** left thumb = lane Up/Down (vertical D-pad); right thumb =
    Pedal (A) + Pump (B); lean (Left/Right) on the lower corners, surfaced only
    while airborne.
  - **Portrait:** canvas top ~55%; controls below — lane pad left, pedal/pump
    right, lean buttons appear (pop-in) when airborne.
- None of this is in the sim. The renderer reads sim state; it never writes it.

## 10. Multiplayer (netcode)

Mode: **1–4 online race**, server-authoritative (ADR-003), hosted by the rooms
Durable Object via this game's entry in `workers/rooms/src/games.ts`
(`'ramp-riders': (seed) => new RampRidersSim(seed)` — already wired by the
scaffolder).

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PLAYERS` | 4 | rider slots 0–3, distinct palette tints |
| `DISCONNECT_GRACE_TICKS` | 300 | 5 s without inputs before a slot is treated as gone |

- **Latency tolerance (BRIEF):** riders never collide, so each client predicts
  **its own** rider and renders rivals interpolated — divergence is invisible.
  The server's authoritative sim adjudicates the finish order (§7).
- **Slots & spawns:** slot `n` spawns at the track's `R` marker, lane
  `START_LANE`; all riders share the same start x (a start gate). Joiners
  mid-race **spectate** until the next race (a race is short; no mid-race spawn).
- **Disconnect:** a slot with no inputs for `DISCONNECT_GRACE_TICKS` **coasts to
  a stop** — `speed` decays by `DECEL` to 0, no input applied, **no CPU
  takeover** (BRIEF). It still occupies a placement (by final distance). On
  rejoin within the netcode rejoin window, the slot resumes control of the same
  rider, keeping its position and place.
- **Server-owned vs. client-predicted:** the whole sim is server-authoritative;
  clients predict only their own rider for feel and reconcile to snapshots. No
  entity is client-owned.
- **Construction:** the room calls `new RampRidersSim(seed)`. The sim selects its
  track as `seed % TRACK_COUNT` (deterministic, no extra plumbing) and defaults
  `juniorBoost = false`, `playerCount` filled by `joinPlayer`. A richer
  constructor (`{ track?, juniorBoost? }`) exists for tests and for when netcode
  carries room settings (§6, §14).

## 11. Determinism & update order

- The sim implements RetroKit's `GameSim` **and** the rooms `NetSim` contract
  (`tick`, `serialize`, `hash`, `snapshot`, `restore`, `joinPlayer`,
  `rejoinPlayer`, `state: {tick, mode}`). No DOM, network, wall-clock, or
  `Math.random` (lint-enforced under `src/sim/`).
- **No gameplay RNG in v1** (sprinklers are tick-periodic; nothing is random).
  The sim still owns a seeded `Rng` and serializes its (unused) state for
  forward-compat and snapshot parity with the other games.
- Fixed update order per tick:
  1. advance race state (countdown → racing → results → done; sprinkler phase is
     derived from `tick`, not stored).
  2. for each rider in **ascending slot order**: lane switch → throttle/legs &
     junior-boost target → ground vs. air branch (ramp arm + pre-jump + obstacle
     effects + legs, **or** gravity + lean + air-drag) → integrate via
     `moveAABB` (slope-aware) → landing grade (clean/ok/bad → wipeout) → wipeout
     timer → finish check.
  3. `tick++`.
- Riders are independent (no collisions), so slot order only decides **same-tick
  finish ties** (lower slot wins) — documented and stable.
- **Stable hashing / fixtures:** `serialize()` emits a canonical object;
  `hash()` is FNV-1a over it. The golden replay fixture lives at
  `test/fixtures/replay-001.json`; regenerate intentionally with
  `REGEN_FIXTURES=1 pnpm test` and review the diff with any spec change.
  Multiplayer fixtures record all four input streams (RLE, per RetroKit's
  `replay` / `replayMulti` helpers).

## 12. Tracks

5 tracks, authored from reusable **segment modules** (`src/sim/segments.ts`): a
track is an ordered recipe of named segments (each a fixed-height ASCII block)
concatenated left-to-right, plus an obstacle table (§5). This is the seam the
**track editor** (parked, §13) will eventually write, and what "tracks as
shareable seeds/links" (BRIEF) will encode.

| Constant | Value | Meaning |
|---|---|---|
| `TRACK_COUNT` | 5 | v1 tracks |
| `SEGMENT_HEIGHT` | 18 | tiles (= `LEVEL_HEIGHT`) |

**ASCII convention.** Segment blocks are `SEGMENT_HEIGHT` rows tall; the top
rows are empty air and are elided here for readability (shown: the bottom rows
with terrain; the real blocks pad to 18 with `.` rows). Ground baseline sits at
row 15.

### Segment modules (representative)

`flat` (8 wide) — cruise/ground:
```
........   (… elided air rows above …)
........
........
########
```

`bump22` (8 wide) — a gentle 22.5° roller (Lo+Hi up to a peak, Hi+Lo down):
```
........
........
.<[]>...
########
```

`ramp45` (10 wide) — a 45° kicker: clean two-tile diagonal to a lip, open ahead:
```
..........
.../......
../.......
##########
```

`bigkick` (10 wide) — a three-tile kicker for big air:
```
..../.....
.../......
../.......
##########
```

> **Terrain learning (devlog):** RetroKit's `moveAABB` resolves X then Y with
> slope tiles non-solid in the X pass, and the rider hitbox is ~2 tiles tall — so
> a **solid tile at the cresting box's foot row walls it**. v1 ramps are
> therefore pure launch kickers (slope diagonals with empty interiors and flat
> landings); elevated **landable decks / down-ramp landings** are a polish
> follow-up. Lean still grades landings (over-rotating wipes out); flat is clean.

`muddy` (10 wide) — flat ground that holds a mud obstacle (table-placed):
```
..........
..........
..........
##########
```

`finish` (6 wide) — flat run-in to the finish wall (`X` marks `finishX`):
```
....X.
....#.
....#.
######
```

### Track recipes (segment id × repeat → ~20 screens)

Each track ends with one `finish`. Difficulty ramps via segment mix + obstacles.

| # | Name | Recipe (left→right) | Obstacles (kind @ lane) |
|---|---|---|---|
| 1 | Driveway Dash | `flat×4, bump22×3, flat×4, muddy×2, flat×3, finish` | 1 mud @ mid |
| 2 | Sprinkler Sprint | `flat×3, bump22×2, flat×2, ramp45×1, flat×3, bump22×2, finish` | 3 sprinklers @ alternating lanes |
| 3 | Hose Hop | `flat×2, ramp45×2, bump22×2, flat×2, ramp45×1, flat×2, finish` | 4 hoses + 1 mud |
| 4 | Mud Mayhem | `flat×2, muddy×3, bump22×1, muddy×2, ramp45×1, flat×2, finish` | 5 mud (lane gauntlet) + 2 cones |
| 5 | Backyard Big Air | `flat×3, bigkick×2, ramp45, sprink, bigkick, ramp45, hoses, bigkick, ramp45, cones, finish` | sprinklers, hoses, cones (front/back lanes) |

(Recipes are first-pass and **expected to be tuned to the 45–90 s target during
the playtest**; the segment lengths above repeat to fill ~20 screens. Full
per-track obstacle tables with exact `atTile`/`lane` live in `src/sim/tracks.ts`,
authored from this design and frozen by the golden fixtures.)

## 13. Avatars (later dependency)

Riders use **placeholder sprites** in v1 (tinted rider boxes per slot, as Bubble
Buddies' Phase 1 used colored rectangles). Avatar **body rigs** (a BMX-rider rig
posed by tilt/lane) come from `packages/avatar`, which is being built
concurrently in the `phase/avatars` worktree and is **not on this branch**. When
it lands on `main`, this worktree rebases and adds a rig (additive, renderer-only
— the sim is avatar-agnostic). Tracked as the one cross-worktree dependency.

## 14. Engine & additive-only check (ADR-009)

- **No `packages/*` changes are needed.** Every capability Ramp Riders requires —
  horizontal camera + big maps, **slope tiles in the physics core**, per-client
  camera, spawn regions — already landed on `main` in Stage 1. This worktree is
  additive: `games/ramp-riders/`, its registry entry, and its one-line
  `workers/rooms/src/games.ts` factory entry (all wired by `pnpm new-game`).
- If implementation uncovers a missing engine capability, **stop**: it lands on
  `main` as a separate minimal PR first (ADR-009 protocol), then this worktree
  rebases. Engine changes never ride inside the game branch.

## 15. Out of scope for v1 (parking lot)

- **Track editor** (the headline later phase) and shareable track seeds/links.
- Per-rider "junior" targeting (needs a netcode join-metadata field — §6).
- Mid-race join (joiners spectate until the next race — §10).
- Rider-vs-rider collision (deliberately absent — BRIEF).
- Variable/independent sprinkler phases, weather, day/night.
- Sound and music.
- Real avatar rigs (Phase 3 dependency — §13); v1 uses tinted placeholder boxes.

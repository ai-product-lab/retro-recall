# Splash Squad — Game Spec (v1: co-op run-and-soak)

Design grammar: side-scrolling co-op run-and-gun, reframed family-friendly —
**water blasters vs. wind-up robots** in backyard playsets (inspiration is
internal-only per ADR-005; nothing here names or resembles it). This spec is the
source of truth: the sim is implemented from it, tests verify against it, and
every tuning value below is a named constant in code (`src/sim/constants.ts`).

v1 scope: **1–4 co-op players, 3 zones × 2 levels = 6 levels, one boss per
zone, placeholder rectangle sprites** (avatars are the shared Phase 3 rig). The
sim is a pure function of inputs (no DOM, network, wall-clock, or `Math.random`,
lint-enforced), implements RetroKit's `GameSim` + the rooms `NetSim` contract,
and reuses Bubble Buddies' co-op revive rules verbatim (§11).

## Engine needs — resolved against the Phase 4a Library (no engine PR needed)

The BRIEF's Stage-1 audit listed four needs; all are already on `main` from
Phase 4a, so this game is **additive-only** (ADR-009) — no `packages/*` change:

| BRIEF need | Satisfied by (already on main) |
|---|---|
| Horizontal-scrolling camera, levels several screens wide | `Camera` with `lockX: 'forward'` + world clamp; `TileMap` is width-agnostic |
| Camera-triggered spawn regions | `SpawnRegions` (sim-owned monotonic progress scalar, serializable latch) |
| Many simultaneous projectiles | `moveAABB` / `aabbOverlap` per-axis integer collision; we cap at `MAX_DROPLETS` |
| Lock-and-advance at boss arenas | **No new flag** — forward-lock + world-bound clamp pins the view at the level's end for free (§2) |

If implementation surfaces a genuinely missing capability, work **stops** and a
minimal spec-driven PR lands on `main` first (ADR-009 protocol); engine changes
never ride inside this game branch.

---

## 1. Coordinate system & units

| Constant | Value | Meaning |
|---|---|---|
| `TILE_SIZE` | 8 | pixels per tile |
| `SCREEN_W` | 256 | logical screen width (px) = 32 tiles |
| `SCREEN_H` | 192 | logical screen height (px) = 24 tiles |
| `LEVEL_HEIGHT` | 24 | tiles — **fixed; v1 scrolls horizontally only** |
| `SUBPX` | 256 | subpixels per pixel — all positions/velocities are integer subpixels |
| `TICKS_PER_SECOND` | 60 | fixed sim rate (from RetroKit) |

- Y grows downward. Positions are entity top-left corners in subpixels.
- All arithmetic is integer. Fractional multipliers are integer ratios with
  truncation (e.g. ×3/2 = `v * 3 / 2`). Diagonals reuse Bubble Buddies' Flitter
  convention: equal per-axis magnitude (so a diagonal droplet is ×√2 faster than
  an axis-aligned one — intended, and integer-clean).
- Levels are **N screens wide** (per-level table in §10), `LEVEL_HEIGHT` tall,
  fully enclosed top/bottom/right; the left edge is the moving scroll wall (§2).

## 2. Tiles, maps & the scroll window

### Tiles

| Symbol | Tile | Behavior |
|---|---|---|
| `#` | Solid | blocks from all sides |
| `=` | Platform | one-way: solid only when landed on from above; droplets/jumps pass through |
| `.` | Empty | — |

Slope tiles exist in the engine (Ramp Riders) but are **unused in v1**, so every
Splash Squad map is slope-free and takes the byte-identical AABB path. Collision
is AABB vs. tile grid, resolved per axis (X then Y), via RetroKit `moveAABB`.

### Markers (non-tile map characters → spawn markers)

`TileMap.parse` reports every non-`.`, non-tile character as a `{char, tx, ty}`
marker; the sim places these at level load:

| Symbol | Places |
|---|---|
| `P` | Squad spawn anchor (slot offsets in §11) — near the level's left edge |
| `S` | Spigot (tank refill zone, §5) |
| `M` | Stream-nozzle pickup (§4) |
| `W` | Spread-nozzle pickup |
| `U` | Burst-nozzle pickup |
| `B` | Boss anchor (boss spawns here when its region fires, §6/§10) |

Robots are **not** map markers — they arrive as camera-triggered waves from the
per-level spawn schedule (§10), keyed by world-x.

### The scroll window (the "pull-along" rule — resolves the BRIEF open item)

The squad shares **one** horizontal window `SCREEN_W` wide. The sim owns its left
edge as an authoritative integer `scrollX` (world px), monotonic non-decreasing:

| Constant | Value | Meaning |
|---|---|---|
| `SCROLL_LEAD_PX` | 144 | the leader is held this far from the window's left edge before pushing it right |

Each tick, **after** players move:

1. `lead = max(center-x in px of every active, non-downed player)`.
2. `scrollX = clamp(lead − SCROLL_LEAD_PX, scrollX, worldRight − SCREEN_W)`
   — `max` with the previous `scrollX` makes it **forward-only**; the world clamp
   stops it at the level's end (this is the boss-arena lock, for free).
3. **Left wall:** every player is clamped so its left edge ≥ `scrollX`
   (leftward velocity zeroed on contact). Nobody is ever left behind or killed by
   the camera — the leader *pulls* the window right and the moving wall *carries*
   stragglers along. Family-friendly, deterministic, no death-by-scroll.

The progress scalar fed to spawn regions is the window's **right edge**,
`scrollX + SCREEN_W`: a wave fires as its trigger column scrolls on-screen.

Because the window is sim-authoritative and shared by the whole co-op squad, the
**render camera is not per-client** here: every client sets `camera.x = scrollX`,
`camera.y = 0`, and culls tiles with `visibleTileRange`. (The per-client camera
matters for races, not shared-screen co-op.)

## 3. Player ("Squaddie")

Sprite 16×16 px; standing hitbox `PLAYER_HITBOX_W`×`PLAYER_HITBOX_H` = 12×14,
centered horizontally, bottom-aligned. Crouching hitbox is 12×`CROUCH_HITBOX_H`.

| Constant | Value | Meaning |
|---|---|---|
| `PLAYER_WALK_SPEED` | 256 | subpx/tick (1 px/tick = 60 px/s) |
| `PLAYER_JUMP_VELOCITY` | −544 | subpx/tick at jump start (max height ≈ 36 px ≈ 4.5 tiles) |
| `GRAVITY` | 16 | subpx/tick² (player, droplets that arc, robots, pellets) |
| `MAX_FALL_SPEED` | 512 | subpx/tick (2 px/tick) |
| `PLAYER_HITBOX_W` / `_H` | 12 / 14 | standing hitbox |
| `CROUCH_HITBOX_H` | 8 | crouch hitbox height (bottom-aligned) |
| `PLAYER_START_LIVES` | 3 | **solo only** (co-op uses revive, §11) |
| `RESPAWN_INVULN_TICKS` | 120 | 2 s invulnerability after respawn/revive (sprite blinks) |
| `DEATH_PAUSE_TICKS` | 60 | downed-animation pause before solo respawn |
| `MUZZLE_DX` | 8 | px ahead of player center where droplets spawn |
| `MUZZLE_DY_STAND` | −2 | px from player center (chest height) standing |
| `MUZZLE_DY_CROUCH` | 4 | px from center when crouched (low) |

Rules:

- **Move:** LEFT/RIGHT set vx to ±`PLAYER_WALK_SPEED` (instant, no acceleration —
  NES feel). Facing follows last nonzero horizontal input.
- **Jump:** A when grounded sets vy = `PLAYER_JUMP_VELOCITY`. Gravity each
  airborne tick, clamped to `MAX_FALL_SPEED`. Jumping passes up through `=`.
- **Crouch:** DOWN while grounded → crouch (hitbox shrinks to `CROUCH_HITBOX_H`,
  low muzzle, no horizontal move). Releasing DOWN stands.
- **Aim & fire:** see §4 (aim compass and nozzles).
- **Downed:** touching a live robot or a hostile pellet while not invulnerable, or
  falling below the level floor (`KILL_Y`, §7) → downed. Solo: lose a life, pause
  `DEATH_PAUSE_TICKS`, respawn at the window's left edge with invulnerability; 0
  lives → game over. Co-op (2+ active): become a rescue bubble (§11).

## 4. Water blaster: aim, nozzles & droplets

### Aim compass

Aim is one of 8 integer directions `(ax, ay)`, each component in `{−1, 0, +1}`
(never both 0), resolved from facing + Up/Down each tick:

| Held (grounded unless noted) | Aim `(ax, ay)` |
|---|---|
| neither Up nor Down | `(facing, 0)` — straight ahead |
| Up, no L/R this tick | `(0, −1)` — straight up |
| Up + facing | `(facing, −1)` — up-diagonal |
| Down, **airborne**, no L/R | `(0, +1)` — straight down |
| Down + facing, **airborne** | `(facing, +1)` — down-diagonal |
| Down, **grounded** | crouch → `(facing, 0)` from low muzzle |

`facing` is +1 right / −1 left.

### Droplets

| Constant | Value | Meaning |
|---|---|---|
| `DROPLET_SPEED` | 384 | subpx/tick **per axis** (1.5 px/tick; diagonals ×√2) |
| `DROPLET_HITBOX` | 6 | px (square) |
| `MAX_DROPLETS` | 64 | hard cap across all players; at cap, new shots are dropped (no spawn) |
| `DROPLET_GRAVITY` | 0 | v1 droplets fly straight (no arc) — kept a constant for future nozzles |

A droplet spawns at the muzzle with velocity `(ax·DROPLET_SPEED,
ay·DROPLET_SPEED)`. It moves via `moveAABB(..., solidOnly=true)` (passes through
`=` platforms and teammates); it **despawns** on hitting a solid tile, on
soaking a robot (§7), or at its nozzle's lifetime. No friendly fire — droplets
ignore players entirely.

### Nozzles (the power-up table — resolves the BRIEF open item)

Three nozzles. All **auto-repeat while B (FIRE) is held**, gated by cooldown.
Each emitted droplet costs 1 tank unit (§5); an empty tank fires nothing.

| Nozzle | id | Droplets/shot | Pattern | `COOLDOWN` (ticks) | `LIFETIME` (ticks) | Tank/shot |
|---|---|---|---|---|---|---|
| **Stream** | 0 | 1 | aim only | `STREAM_CD` = 9 | `STREAM_LIFE` = 56 | 1 |
| **Spread** | 1 | 3 | aim + its two compass neighbors | `SPREAD_CD` = 15 | `SPREAD_LIFE` = 44 | 3 |
| **Burst** | 2 | 1 | aim only, short & fast | `BURST_CD` = 5 | `BURST_LIFE` = 28 | 1 |

- **Spread neighbors:** order the 8 compass dirs E, NE, N, NW, W, SW, S, SE;
  spread emits the aim direction plus the two **adjacent** entries. (Aim E → also
  NE and SE; aim NE → also E and N.) Pure integer, deterministic, no trig.
- Stream is the **starting nozzle** on spawn/respawn. Picking up a nozzle token
  (`M`/`W`/`U` marker, §2) **replaces** the current nozzle (no stacking in v1) and
  is per-player. Tokens are placed level features (not random drops), so loadout
  is deterministic and authored. A token has no lifetime; it waits until taken,
  then despawns.

## 5. Tank & spigots (resolves the capacity/refill open item)

| Constant | Value | Meaning |
|---|---|---|
| `TANK_CAPACITY` | 60 | max units; full on spawn/respawn and at level load |
| `REFILL_RATE` | 3 | units/tick gained while overlapping a spigot zone |
| `SPIGOT_W` / `SPIGOT_H` | 16 / 16 | spigot refill-zone size (px), centered on the `S` marker |

Light resource rhythm instead of lives pressure: fire drains the tank; you top
up by standing in a spigot zone (`REFILL_RATE`/tick, clamped to capacity). **No
passive regen in v1** — spigots are the only refill, which is what creates the
"dash to the spigot, then push on" cadence. An empty tank simply fires nothing
(a dry click in the view layer); the player is never blocked from moving.

## 6. Robots (bestiary) + boss (resolves the open item)

Robots are wind-up toys: when soak ≥ HP they **wind down** (`WINDDOWN_TICKS`
sputter, harmless, then despawn + award score). All face the nearest active
player by x; ties break to the lower player slot (deterministic). Gravity applies
to grounded types. Contact with a **live** (not winding-down) robot soaks a
non-invulnerable player (§7).

| Constant | Value | Meaning |
|---|---|---|
| `WINDDOWN_TICKS` | 30 | sputter animation before despawn (harmless) |
| `ROBOT_HITBOX` | 14 | px (square) for the three grunt types |

### Trundle (ground walker) — grunt #1

| Constant | Value | Meaning |
|---|---|---|
| `TRUNDLE_SPEED` | 128 | subpx/tick toward nearest player (0.5 px/tick) |
| `TRUNDLE_HP` | 2 | soak hits to wind down |

Walks toward the nearest player along x; gravity applies; turns at solid walls;
turns at ledges (never walks off — keeps grunts on their platform, deterministic,
no RNG).

### Sentry (turret) — grunt #2

| Constant | Value | Meaning |
|---|---|---|
| `SENTRY_HP` | 4 | |
| `SENTRY_FIRE_PERIOD` | 90 | ticks between rust-pellet lobs (phase = spawn tick mod period) |
| `RUST_PELLET_SPEED` | 192 | subpx/tick horizontal toward the player's side |
| `RUST_PELLET_GRAVITY` | 8 | subpx/tick² — slow, telegraphed arc, dodgeable |
| `RUST_PELLET_HITBOX` | 8 | px |

Stationary. Every `SENTRY_FIRE_PERIOD` ticks it lobs one rust-pellet toward the
nearest player's side. Pellets arc under `RUST_PELLET_GRAVITY`, despawn on solid
tile or off the bottom; a pellet hitting a non-invuln player downs them. Pellets
are **soakable** (1 droplet dissolves a pellet — small score, §7) so co-op fire
can clear incoming.

### Hopper (jumper) — grunt #3

| Constant | Value | Meaning |
|---|---|---|
| `HOPPER_HP` | 3 | |
| `HOPPER_JUMP_PERIOD` | 70 | ticks between hops (phase = spawn tick mod period) |
| `HOPPER_JUMP_VY` | −480 | subpx/tick hop impulse |
| `HOPPER_HOP_VX` | 160 | subpx/tick horizontal toward nearest player while airborne |

Grounded between hops; every `HOPPER_JUMP_PERIOD` ticks (when grounded) it hops
toward the nearest player. Gravity applies; lands on solid/platform tiles.

### Boiler-Bot (boss, one per zone)

Pinned at the `B` anchor in the boss arena (final screen of each zone's 2nd
level). The scroll window forward-locks at the arena (§2). The boss cycles a
telegraphed pattern; its **boiler** (a weak-point sub-hitbox) opens during the
recovery window — soak it then.

| Constant | Value | Meaning |
|---|---|---|
| `BOSS_HP_BASE` | 30 | soak hits at zone 1 |
| `BOSS_HP_PER_ZONE` | 10 | added per later zone (zone 2 = 40, zone 3 = 50) |
| `BOSS_HITBOX_W` / `_H` | 32 / 32 | body |
| `BOSS_BOILER_W` / `_H` | 12 / 12 | weak-point sub-hitbox (only this counts toward HP) |
| `BOSS_CYCLE_TICKS` | 150 | one attack→recovery cycle |
| `BOSS_OPEN_TICKS` | 60 | of the cycle the boiler is open (vulnerable) |
| `BOSS_STEAM_SPEED` | 224 | subpx/tick steam-burst projectile (telegraphed, dodgeable) |

Defeating the boss = **zone clear** (§10). The boss takes soak only while its
boiler is open; closed, droplets splash harmlessly off the casing.

## 7. Soak, splash chains, downing & score

- **Soak:** each droplet that overlaps a live robot adds 1 to its `soak` and
  despawns. `soak ≥ HP` → the robot enters wind-down.
- **Splash chain (resolves "streams combine into a bigger splash"):** when a
  robot winds down it emits a splash; every live robot whose hitbox center is
  within `SPLASH_RADIUS` takes +1 soak, applied transitively within the same tick
  (a robot pushed to wind-down by the splash chains again), credited to the
  player who fired the initiating droplet. This is Bubble Buddies' chain-pop
  spirit, co-op-flavored.
- **Downing:** a non-invulnerable player overlapping a live robot, a rust-pellet,
  a boss steam-burst, or falling past `KILL_Y` is **downed** (solo: lose a life
  and respawn; co-op: rescue bubble, §11).

| Constant | Value | Meaning |
|---|---|---|
| `SPLASH_RADIUS` | 24 | px between hitbox centers for a splash chain |
| `KILL_Y` | `LEVEL_HEIGHT * TILE_SIZE * SUBPX` | floor of the level (subpx); falling past it → downed |
| `SCORE_SOAK_TRUNDLE` | 200 | |
| `SCORE_SOAK_SENTRY` | 400 | |
| `SCORE_SOAK_HOPPER` | 300 | |
| `SCORE_DISSOLVE_PELLET` | 50 | soaking a rust-pellet out of the air |
| `SCORE_SPLASH_BONUS` | 100 | per extra robot felled in one splash chain (2nd robot +100, 3rd +200, …) |
| `SCORE_BOSS` | 5000 | per boss |
| `EXTRA_LIFE_SCORE` | 20000 | **solo only**: one extra life the first time score crosses this |

Score is per-player; the HUD shows each tint plus the team total (co-op).

## 8. Input

Logical inputs (the sim sees only these per-tick booleans — also the
netcode/replay format), mapped onto RetroKit's NES `Button` bitmask:

| Logical | `Button` | Default key | Touch |
|---|---|---|---|
| LEFT / RIGHT | `Left` / `Right` | Arrow Left / Right | D-pad ◀ ▶ |
| AIM UP | `Up` | Arrow Up | D-pad ▲ |
| AIM DOWN / CROUCH | `Down` | Arrow Down | D-pad ▼ |
| JUMP | `A` | Z or Space | right button (A) |
| FIRE | `B` | X | right button (B) |
| START | `Start` | Enter | pause/confirm |

Touch shell (ADR-007): dual-orientation. **Landscape** — D-pad bottom-left, A/B
bottom-right, game letterboxed between. **Portrait** — game pinned to the top,
controls in a bottom band. Layout reuses Bubble Buddies' shell patterns
(`src/shell/`). Touch layout is a renderer/shell concern; the sim only ever sees
the logical bitmask.

## 9. Determinism & update order

- Implements RetroKit `GameSim` (`tick`, `serialize`, `hash`) **and** the rooms
  `NetSim` extras (`state.tick`/`state.mode`, `snapshot`/`restore`,
  `joinPlayer`/`rejoinPlayer`). Same construction + same input sequence ⇒ same
  `serialize()`/`hash()` forever.
- One seeded `Rng` owned by the sim, its state serialized for snapshot/hash
  parity. **v1 robot AI is fully deterministic from spawn tick** (no RNG draws);
  the RNG is reserved for future variety and kept in state so hashes stay stable.
- Entities carry monotonic integer ids from a sim-owned counter; all per-entity
  phases iterate in ascending id order, players in slot order (0→3).
- **Fixed update order per tick:**
  1. read inputs
  2. players: move (X then Y via `moveAABB`), jump, crouch, aim, fire (spend tank)
  3. droplets: move, dissolve pellets, soak robots, lifetime
  4. robots & boss: AI move/attack, spawn pellets/steam, contact with players
  5. pellets/steam: move, contact, lifetime
  6. pickups & spigots: equip nozzle / refill tank on overlap
  7. **scroll front**: recompute `scrollX` (§2), apply the left wall
  8. spawn regions: `advance(scrollX + SCREEN_W)` → spawn newly-triggered waves
  9. resolve wind-downs & splash chains (§7); downing & revives (§11)
  10. score, lives, level/zone state
- Every replay fixture is an input log + sampled state hashes
  (`test/fixtures/replay-001.json`); multiplayer fixtures record all four slots.
  Regenerate intentionally with `REGEN_FIXTURES=1 pnpm test` and review the diff.

## 10. Levels, zones & spawn schedule

**v1 = 3 zones × 2 levels = 6 levels.** Each zone's **2nd** level ends in a boss
arena (Boiler-Bot, §6). Difficulty ramps Trundle → +Sentry → +Hopper → mixed.

| # | Zone | Level | Screens wide | New this level | Boss |
|---|---|---|---|---|---|
| 1 | Backyard | Sprinkler Run | 4 | Trundle | — |
| 2 | Backyard | Patio Standoff | 4 | + Sentry | ✅ |
| 3 | Jungle Gym | Vine Climb | 5 | + Hopper | — |
| 4 | Jungle Gym | Canopy Clash | 5 | mixed | ✅ |
| 5 | Waterworks | Pipe Maze | 6 | denser mixed | — |
| 6 | Waterworks | Boiler Room | 6 | finale | ✅ |

### Authoring model (a convention note for a side-scroller)

A single-screen game (Bubble Buddies) embeds full ASCII maps in its spec. A
multi-screen scroller can't legibly — six 96–144-tile-wide maps would be
unreviewable. So for Splash Squad the **authoritative artifacts in this spec are
the tables above and the spawn-schedule schema below**; the ASCII terrain and the
schedule data are authored in `src/sim/levels.ts` (parsed by the same
`TileMap.parse` path), and kept honest by the replay fixtures. (Flagged for
approval — see the end of this file.)

### Spawn-schedule schema

Each level is `{ map: string[], width, schedule: Wave[] }` where:

```
Wave = {
  id: number,        // stable SpawnRegion id (firing order = trigger order)
  trigger: number,   // world-x in px; fires when scrollX + SCREEN_W passes it
  spawns: Array<{ type: 'trundle' | 'sentry' | 'hopper' | 'boss', tx: number, ty: number }>,
}
```

At load, the sim builds `new SpawnRegions(schedule.map(w => ({id, trigger})))`;
each tick step 8 (§9) maps fired ids back to their `spawns` and instantiates the
robots at the given tiles. The boss is a wave whose single spawn is the `B`
anchor, triggered as the arena scrolls in (and `scrollX` then forward-locks).

### Example screen + a wave (Level 1, leftmost screen, 32×24)

```
################################
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#.....======.......======......#
#..............................#
#..............................#
#..............................#
#..............................#
#....======................S...#
#..............................#
#..............................#
#..P...........................#
#..............................#
#..............................#
################################
```

`P` = squad spawn anchor; `S` = spigot. Robots arrive by schedule, e.g.
`{ id: 0, trigger: 320, spawns: [{type:'trundle', tx:34, ty:21}, {type:'trundle', tx:40, ty:21}] }`
— two Trundles materialize just past the first screen as it scrolls in. The full
maps and schedules for all six levels live in `src/sim/levels.ts`.

## 11. Multiplayer (netcode) — co-op, reuses Bubble Buddies §11

Pure co-op (the most forgiving netcode profile), server-authoritative per
ADR-003, **identical transport to Bubble Buddies**; the room hosts this game via
its `workers/rooms/src/games.ts` registry entry (`SplashSquadSim`). The sim takes
an array of input bitmasks indexed by slot 0–3; empty/disconnected slots are
`null` (distinct from 0 = connected-but-idle).

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PLAYERS` | 4 | slots 0–3, distinct palette tints |
| `PLAYER_SPAWN_OFFSETS` | [0, +2, −2, +4] | tiles from the `P` anchor, per slot (same as Bubble Buddies) |
| `RESCUE_FLOAT_SPEED` | −64 | subpx/tick; downed player's rescue bubble drifts up |
| `RESCUE_POP_INVULN_TICKS` | 120 | invulnerability after a buddy revives you |
| `DISCONNECT_GRACE_TICKS` | 300 | 5 s of `null` input before a slot despawns |

Rules carried over from Bubble Buddies §11 (the house co-op mechanic):

- **Spawning:** slot n spawns at the window's left edge + `PLAYER_SPAWN_OFFSETS[n]`
  tiles. Mid-level joiners **spectate until the next level loads**, then spawn.
- **Buddy revive (2+ active):** lives are not used. On downing, the player becomes
  a rescue bubble: floats up at `RESCUE_FLOAT_SPEED`, rests bobbing at the
  ceiling (Bubble Buddies bob constants), harmless. A living teammate touching it
  pops it → respawn **at the bubble's position** with `RESCUE_POP_INVULN_TICKS`.
  Bubbles also auto-revive on level clear. **Game over only when every active
  player is a rescue bubble simultaneously.**
- **Solo (exactly 1 active):** §3 classic lives apply (`PLAYER_START_LIVES`,
  respawn at the window's left edge, `EXTRA_LIFE_SCORE`). A 2nd player joining
  switches the game to revive rules at the next level load.
- **Disconnect:** a slot with `null` input for `DISCONNECT_GRACE_TICKS` despawns
  (its rescue bubble too); rejoin re-activates it at the next level with
  invulnerability, score kept. Game-over evaluation ignores despawned slots.
- **No friendly fire:** droplets ignore players; players pass through each other;
  any player's droplet can soak any robot, and splash chains are shared (on
  purpose). Soak/chain credits the firing player; nozzle pickups are per-player.
- **Server owns everything contended:** the scroll window, droplets, pellets,
  robots, and the boss are all sim/server state — never client-predicted (mirrors
  Bubble Buddies; co-op needs no special prediction beyond it).

## 12. Sound design v1 (resolves the open item) — SFX, no music

**Music-free**, like the BRIEF asks; v1 ships a small SFX set only. Sound is a
**view-layer** concern (the sim emits no audio): the renderer diffs sim state /
reads per-tick event flags and triggers SFX via the existing shell audio
(`src/shell/audio.ts` pattern from Bubble Buddies). Determinism is unaffected.

Events: squirt (fire), splash-hit (droplet soaks robot), wind-down sputter,
splash-chain whoosh, nozzle-pickup chime, spigot refill loop, dry-click (empty
tank), player downed, buddy revive, boss boiler-douse, level/zone clear. No music
track in v1 (parked, §13).

## 13. Out of scope for v1 (parking lot)

- Music; richer audio mixing
- Vertical scrolling / multi-height levels (engine supports it; v1 stays 1-screen tall)
- Arcing/charged nozzles, nozzle stacking, water-balloon special
- Random robot drops (v1 pickups are authored, deterministic)
- Boss bullet-hell complexity beyond the single telegraphed cycle
- Real sprites (placeholder rectangles; avatars are the shared Phase 3 rig)
- A 4th zone / endless mode

---

## ⏸ For Kevin's approval (ADR-009 Stage 2 gate)

Two decisions I'd like a thumbs-up on before implementing:

1. **Authoring convention (§10):** for a multi-screen scroller, this spec makes
   the *level table + spawn-schedule schema* authoritative and puts the ASCII
   terrain + schedule data in `src/sim/levels.ts` (replay-fixture-guarded),
   rather than embedding six full wide maps inline like Bubble Buddies did. Same
   spirit (spec is source of truth), adapted to width.
2. **Scope (§10):** 3 zones × 2 levels = 6 levels, levels 4–6 screens wide, one
   boss per zone. Comfortable for a playable v1, or trim to one zone (2 levels +
   1 boss) first to get it on screen sooner, then add zones?

Everything else resolves the BRIEF's "Open for SPEC" list: nozzle table (§4),
tank/refill (§5), bestiary + boss (§6), level count (§10), pull-along camera
(§2), music-free SFX (§12).

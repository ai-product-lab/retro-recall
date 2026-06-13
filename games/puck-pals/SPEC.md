# Puck Pals — Game Spec (v1: local + online versus)

Design grammar: NES-era arcade hockey — top-down rink, exaggerated ice slides,
a charged "super slap" with a visible wind-up tell. Versus is the point: family
rivalry, 1v1 to 2v2 online, empty skater slots filled by CPU. No fighting; body
checks just send skaters comically sliding. Inspiration is internal only
(ADR-005) — no real team, league, or game names anywhere in code or assets.

This spec is the source of truth: the sim is implemented from it, tests verify
against it, and every tuning value below is a named constant in
`src/sim/constants.ts`. v1 scope is **one rink, 2 teams of 3 skaters + an
auto-goalie, 3 short periods, sudden-death overtime, CPU fill, placeholder
art.** It resolves the BRIEF's "Open for SPEC" list (period length, goalie
control, super-slap charge values, board-bounce angles, overtime rule, rink tile
set); each resolution is marked **[SPEC]**.

> **Engine note (ADR-009):** Puck Pals needs **no new RetroKit capability**. The
> rink is a slope-free, platform-free `TileMap` (boards = `Solid`, ice =
> `Empty`); top-down sliding uses `moveAABB` per-axis (gravity unused) and reads
> `hitX/hitY` to reflect the puck; vertical scrolling uses the shared `Camera`.
> No `packages/*` edits — additive-only. The one external dependency is the
> avatar rig (§12), which lands on `main` from the `phase/avatars` worktree;
> until then skaters render as palette boxes.

---

## 1. Coordinate system & units

| Constant | Value | Meaning |
|---|---|---|
| `TILE_SIZE` | 8 | pixels per tile |
| `RINK_W` | 32 | tiles (256 px — exactly one screen wide; camera never scrolls X) |
| `RINK_H` | 36 | tiles (288 px — ~1.5 screens tall; camera scrolls Y) |
| `SUBPX` | 256 | subpixels per pixel — all positions/velocities are integer subpixels |
| `TICKS_PER_SECOND` | 60 | fixed sim rate (from RetroKit) |

- **Top-down view.** Y grows downward; the two goals sit at the top (low y) and
  bottom (high y) of the rink. There is **no gravity** — this is a flat ice
  plane. Positions are entity top-left corners in subpixels.
- Logical screen: 256×192 px, scaled by the renderer. The rink is 256×288, so
  the camera (§9) follows the puck vertically over a 96 px range and never moves
  horizontally.
- All arithmetic is integer. Fractional factors (friction, restitution) are
  expressed as integer ratios applied with truncation, e.g. `v * 240 / 256`.
- Every velocity stays below `TILE_SIZE` px/tick (2048 subpx) so single-edge
  AABB resolution cannot tunnel. The fastest entity is a full super-slap puck at
  `SUPER_SLAP_SPEED` = 1800 < 2048. ✔

## 2. Tiles, rink & goals  **[SPEC: rink tile set]**

The rink uses only two tile kinds — it is deliberately a plain bordered box, so
collision stays trivial and deterministic:

| Symbol | Tile | Behavior |
|---|---|---|
| `#` | Solid (boards) | blocks skaters and goalies from all sides; reflects the puck (§6) |
| `.` | Empty (ice) | skateable; no per-tile friction — friction is a velocity rule, not a tile |

Everything else a hockey rink "has" is **not** a collision tile:

- **Goal mouths** are defined by constants, not tile gaps. The boards form a
  closed rectangle (skaters can never leave). The puck *scores* by crossing a
  goal line inside the mouth's x-range **before** board reflection is applied
  (§6) — so the net opening is a rule, not a hole in the wall.
- **Center line, blue lines, faceoff circles, crease** are cosmetic; the
  renderer draws them. The sim does not know they exist.

| Constant | Value | Meaning |
|---|---|---|
| `GOAL_MOUTH_HALF` | 28 | px; goal mouth spans `CENTER_X ± GOAL_MOUTH_HALF` (56 px ≈ 7 tiles wide) |
| `GOAL_LINE_TOP_Y` | 16 | px; puck center at/above this y (in the mouth) = goal in the **top** net |
| `GOAL_LINE_BOTTOM_Y` | 272 | px; puck center at/below this y (in the mouth) = goal in the **bottom** net |
| `CENTER_X` | 128 | px; rink horizontal center (also the goal-mouth center) |
| `CENTER_Y` | 144 | px; rink vertical center (center-ice faceoff dot) |

```
rink (32×36 tiles; '#' boards, '.' ice). Goal mouths are the two board
segments centered on CENTER_X — drawn with a net, treated as a scoring line for
the puck only. The center dot / lines shown here as glyphs are renderer-only.

################################   row 0   ← top boards + top goal mouth (cols 12–19)
#..............................#
#..............................#
#..............................#
#..............................#          ← top defensive zone
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#   row 13  (blue line — cosmetic)
#..............................#
#..............................#
#..............o...............#   row 16  (center-ice dot @ CENTER — cosmetic 'o')
#..............................#   row 17  (red center line — cosmetic)
#..............................#
#..............................#
#..............................#   row 21  (blue line — cosmetic)
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#
#..............................#          ← bottom defensive zone
#..............................#
#..............................#
#..............................#
#..............................#
################################   row 35  ← bottom boards + bottom goal mouth
```

> The ASCII above is illustrative; the actual parsed map is a solid `#` border
> filled with `.` (no cosmetic glyphs), built in `src/sim/rink.ts`. Corners may
> be drawn rounded by the renderer; collision stays rectangular in v1.

## 3. Teams, skaters & control

Two teams, **Home** and **Away**. Each fields **3 skaters + 1 goalie**. Skaters
are the controllable units; the goalie is always CPU (§5.1).

| Constant | Value | Meaning |
|---|---|---|
| `TEAM_COUNT` | 2 | Home (0), Away (1) |
| `SKATERS_PER_TEAM` | 3 | indices 0 (Center), 1 (Left Wing), 2 (Right Wing) |
| `MAX_PLAYERS` | 4 | human slots 0–3 (1v1 → 2v2) |

**Slot → team → skater (deterministic by join order):**

- Human slot `n` joins team `n % 2` (slots 0,2 → Home; slots 1,3 → Away). This
  yields 1v1 at slots 0–1 and 2v2 at slots 0–3.
- The first human on a team binds to **skater 0**, the second to **skater 1**.
  Skater 2 (and any skater without a bound human) is **CPU**. The binding is
  fixed for the whole match — **no auto-switch in v1** (one fixed skater per
  human is unambiguous, fully deterministic with two humans on a team, and
  avoids two players fighting over one body). *Active-skater auto-switch is a
  parking-lot enhancement (§13).*
- HUD/roster labels every CPU-controlled skater **"CPU"** (Kevin's call, retro
  convention), every goalie "CPU", and every human their player name.

### 3.1 Skater state & skating physics  *(game-local — see BRIEF)*

Skater sprite 12×12 px; hitbox `SKATER_HITBOX` = 10×10 px, centered. Ice skating
is momentum-based: input accelerates, friction decays, top speed caps. This is
distinct from the platformer physics core (no gravity, no grounded test).

| Constant | Value | Meaning |
|---|---|---|
| `SKATER_HITBOX` | 10 | px (square) |
| `SKATE_ACCEL` | 56 | subpx/tick² added toward the input direction, per axis |
| `SKATE_MAX_SPEED` | 360 | subpx/tick per-axis cap (~1.4 px/tick) |
| `ICE_FRICTION_NUM` / `_DEN` | 244 / 256 | per-tick velocity decay when no input on that axis (≈ 4.7 %/tick — long slides) |
| `SKATE_STOP_EPS` | 24 | subpx/tick; below this, an unpowered axis snaps to 0 |
| `CHARGE_MOVE_NUM` / `_DEN` | 1 / 3 | accel + max-speed scale while charging a slap (the wind-up tell roots you, §5) |
| `TUMBLE_TICKS` | 48 | ticks a checked skater slides with no control (§7) |
| `TUMBLE_FRICTION_NUM` / `_DEN` | 250 / 256 | gentler decay while tumbling (slides far, comically) |
| `CHECK_COOLDOWN_TICKS` | 30 | min ticks between a skater's body checks |

Per-axis update each tick (X and Y independent, identical rule):

1. If the input holds that axis (Left/Right for X, Up/Down for Y), add
   `±SKATE_ACCEL` (scaled by `CHARGE_MOVE` while charging), then clamp the axis
   velocity to `±SKATE_MAX_SPEED` (also charge-scaled).
2. Else decay: `v = v * ICE_FRICTION_NUM / ICE_FRICTION_DEN`; if `|v| <
   SKATE_STOP_EPS`, set `v = 0`.
3. While tumbling, ignore input entirely and decay with `TUMBLE_FRICTION`.

Diagonal input accelerates both axes, so diagonal top speed is ≈ √2 × per-axis
cap — an intentional arcade quirk (corners are fast). Movement resolves through
`moveAABB(map, x, y, w, h, vx, vy)`; on `hitX`/`hitY` the corresponding velocity
zeroes (skaters stop dead against the boards — they don't bounce; the puck does).

## 4. Puck & possession  *(game-local — see BRIEF)*

One puck. Hitbox `PUCK_HITBOX` = 6×6 px. The puck is **always server-owned,
never client-predicted** (BRIEF) — it is the contended entity.

| Constant | Value | Meaning |
|---|---|---|
| `PUCK_HITBOX` | 6 | px (square) |
| `PUCK_FRICTION_NUM` / `_DEN` | 252 / 256 | loose-puck decay (glides much farther than a skater) |
| `PUCK_STOP_EPS` | 16 | subpx/tick; below this on both axes, a loose puck rests |
| `PUCK_PICKUP_RADIUS` | 9 | px between puck center and skater center to gain possession |
| `PUCK_CARRY_OFFSET` | 7 | px; carried puck sits this far ahead of the carrier along facing |
| `POSSESSION_COOLDOWN_TICKS` | 18 | after a shot/pass/steal, the puck can't be re-grabbed for this long (no instant snap-back) |
| `STEAL_RADIUS` | 11 | px; a poke-check reaches a carrier within this range |
| `PASS_SPEED` | 700 | subpx/tick (~2.7 px/tick) |
| `PASS_CONE_HALF` | 40 | px lateral half-width of the auto-aim cone |
| `STEAL_KICK_SPEED` | 220 | subpx/tick the stolen puck pops away |

**Facing.** A skater's facing is an 8-direction unit derived from its last
non-zero input (carried over while coasting). The carried puck sits at
`carrier_center + facing * PUCK_CARRY_OFFSET`, clamped inside the boards.

**Possession (loose → carried).** After `POSSESSION_COOLDOWN_TICKS` since the
last possession change, the first skater (in skater-id order, §10) whose center
is within `PUCK_PICKUP_RADIUS` of the loose puck takes possession. The puck then
tracks that carrier and has no independent velocity.

**Steal — poke check (no puck, press B).** A skater without the puck pressing B
(`CHECK`) whose center is within `STEAL_RADIUS` of the opposing carrier knocks
the puck **loose** at the carrier's position with a small kick
(`STEAL_KICK_SPEED`, away from the stealer), starts the possession cooldown, and
puts the stealer's check on cooldown. A poke alone does **not** tumble the
carrier (that's a body check, §7).

**Pass (has puck, press A).** Releases the puck toward the **nearest teammate**
whose center lies within `PASS_CONE_HALF` of the carrier's facing ray; if none,
passes straight along facing. The pass travels at `PASS_SPEED`, may bank off the
boards (§6), and starts the possession cooldown.

## 5. Shooting & the super slap  **[SPEC: super-slap charge values]**

Shooting is on **B while carrying** (B without the puck is a poke check, §4).
Tapping B fires a normal wrist shot; holding B charges a slap, with a visible
wind-up that roots the shooter — the "tell" so kids can dodge.

| Constant | Value | Meaning |
|---|---|---|
| `SHOT_SPEED` | 900 | subpx/tick wrist-shot speed (~3.5 px/tick) |
| `SLAP_CHARGE_MAX_TICKS` | 45 | ticks of hold to reach full charge (0.75 s) |
| `SUPER_SLAP_THRESHOLD` | 30 | charge ticks at/above which the shot is a "super slap" (knockdown, §7) |
| `SUPER_SLAP_SPEED` | 1800 | subpx/tick at full charge (~7 px/tick; < 1 tile/tick) |

- **Charge.** Holding B accumulates `charge` (capped at `SLAP_CHARGE_MAX_TICKS`).
  While charging, the shooter's accel + top speed scale by `CHARGE_MOVE` (§3.1)
  and the renderer shows a growing charge flash — the dodge tell.
- **Release.** Shot speed lerps linearly from `SHOT_SPEED` (charge 0) to
  `SUPER_SLAP_SPEED` (charge `SLAP_CHARGE_MAX_TICKS`), integer-truncated. The
  puck launches along facing from the carry position, starts the possession
  cooldown, and may bank off boards (§6).
- **Super slap.** A released shot with `charge ≥ SUPER_SLAP_THRESHOLD` is a super
  slap: any opposing skater whose hitbox the puck overlaps **before** it reaches
  the goal is sent tumbling (§7), and the puck continues (it is not stopped by
  bodies — only by the goalie, boards, or a goal). The goalie can still save it.
- **Goalie auto-save.** The puck striking the goalie's hitbox (§5.1) is a save:
  it reflects outward like a board (damped by `BOARD_RESTITUTION`) and the
  possession cooldown starts, so a rebound is live.

### 5.1 Goalie  **[SPEC: goalie control = auto in v1]**

The goalie is **always CPU** in v1 (resolves the BRIEF's auto-vs-manual
question: auto, for kid-friendliness and so a human always controls a skater).
*Manual goalie on defense is parked (§13).*

| Constant | Value | Meaning |
|---|---|---|
| `GOALIE_HITBOX_W` / `_H` | 16 / 10 | px; wide, shallow pad block |
| `GOALIE_SPEED` | 300 | subpx/tick lateral tracking speed |
| `GOALIE_CREASE_HALF` | 30 | px; goalie slides within `CENTER_X ± GOALIE_CREASE_HALF` |
| `GOALIE_LINE_INSET` | 24 | px; goalie's y sits this far inside its own goal line |

Each tick the goalie moves its x toward the puck's x (clamped to the crease) at
`GOALIE_SPEED`; its y is fixed at its goal-line inset. Its team's defended goal
is the one that flips when teams switch ends (§8). The goalie blocks (reflects)
the puck; it never holds it in v1 (a blocked puck rebounds live).

## 6. Board bounces & goals  **[SPEC: board-bounce angles]**

A **loose** puck (not carried) moves each tick:

1. Decay velocity by `PUCK_FRICTION`; if both axes < `PUCK_STOP_EPS`, it rests.
2. **Goal-line test first.** If the puck center's y crosses a goal line
   (`≤ GOAL_LINE_TOP_Y` or `≥ GOAL_LINE_BOTTOM_Y`) while its x is within the goal
   mouth (`|x − CENTER_X| ≤ GOAL_MOUTH_HALF`) **and** the goalie did not block it
   this tick → **goal** for the attacking team; whistle and reset (§8). This test
   precedes board reflection, so the mouth scores instead of bouncing.
3. Otherwise move via `moveAABB(...solidOnly=true)`. On `hitX`, reflect:
   `vx = -vx * BOARD_RESTITUTION_NUM / BOARD_RESTITUTION_DEN`. On `hitY`, reflect
   `vy` likewise. Corners flip both. Reflection is a pure axis flip — simple,
   integer, and exactly the "bank a pass off the boards" the BRIEF wants.

| Constant | Value | Meaning |
|---|---|---|
| `BOARD_RESTITUTION_NUM` / `_DEN` | 236 / 256 | puck keeps ~92 % of speed off the boards (lively, not perpetual) |

Skaters and goalies do **not** bounce off boards — they stop (§3.1, §5.1). Only
the puck reflects.

## 7. Body checks & tumbles

No fighting, no penalties (v1). Contact just makes people slide.

- **Body check (no puck, press B near an opponent).** Already a poke-steal if the
  opponent carries the puck (§4); additionally, if the checking skater's *speed*
  exceeds `CHECK_MIN_SPEED`, the checked opponent is sent **tumbling** for
  `TUMBLE_TICKS` (no input, `TUMBLE_FRICTION` slide inheriting the checker's
  momentum direction), dropping the puck loose if they had it. The checker's
  check goes on `CHECK_COOLDOWN_TICKS`.
- **Super-slap knockdown (§5).** A super-slap puck overlapping an opposing skater
  tumbles them.
- A tumbling skater cannot pick up the puck, pass, shoot, or check until the
  tumble ends. Tumbling skaters still collide with boards (stop).

| Constant | Value | Meaning |
|---|---|---|
| `CHECK_MIN_SPEED` | 200 | subpx/tick the checker must exceed to knock the target down (poke-only below it) |

## 8. Periods, clock, scoring, win/lose  **[SPEC: period length, overtime]**

| Constant | Value | Meaning |
|---|---|---|
| `PERIODS` | 3 | regulation periods |
| `PERIOD_TICKS` | 3600 | 60 s per period (snappy; ~3 min regulation) |
| `FACEOFF_FREEZE_TICKS` | 90 | 1.5 s frozen formation before the puck goes live |
| `INTERMISSION_TICKS` | 150 | 2.5 s between periods (teams switch ends) |
| `GOAL_CELEBRATE_TICKS` | 120 | 2 s goal-horn freeze before the center-ice faceoff |
| `OT_PERIOD_TICKS` | 3600 | 60 s sudden-death overtime chunk |
| `OT_MAX_PERIODS` | 5 | cap on sudden-death chunks before the tiebreak (§8.1) |

- **Game modes (sim `mode` field, all strings):** `faceoff`, `play`, `goal`,
  `intermission`, `overtime-faceoff`, `overtime`, `final`.
- **Faceoff.** Skaters snap to their formation (§8.2), puck at center ice (v1
  uses center ice for all faceoffs for simplicity), frozen for
  `FACEOFF_FREEZE_TICKS`, then `play`.
- **Switch ends.** Teams switch which goal they attack at each intermission (and
  on entering overtime). Attack direction is a pure function of period parity, so
  it's deterministic and needs no stored per-skater flip. The camera/orientation
  do **not** flip (one fixed rink orientation; the HUD shows each team's attack
  arrow).
- **Clock.** During `play`/`overtime`, the period clock decrements one tick at a
  time. At 0: if more regulation periods remain → `intermission` →
  next-period faceoff; after the last regulation period → §8.1.
- **Score.** A goal (§6) increments the scoring team, enters `goal` for
  `GOAL_CELEBRATE_TICKS`, then center-ice faceoff. The clock pauses during
  `goal`, `faceoff`, and `intermission`.
- **Shots on goal** are tracked per team (any shot/super-slap that would have
  scored but for a save or post) — used only for the OT tiebreak and the HUD.

### 8.1 Ending the game & overtime  **[SPEC: overtime rule]**

- If a team leads after regulation → `final` (that team wins).
- If tied → **sudden-death overtime**: `overtime-faceoff` then `overtime`. The
  **first goal wins** immediately (`final`). If a 60 s chunk ends with no goal,
  another chunk starts, up to `OT_MAX_PERIODS` chunks.
- If still tied after `OT_MAX_PERIODS` (vanishingly rare) → decided by **shots on
  goal**; if those are equal too, the **Away** team wins (challenger's edge) —
  this guarantees a winner and bounded termination (no draws in a rivalry game).
  *A penalty-shot shootout is the nicer tiebreak and is parked (§13).*
- `final` shows the result + a handshake screen; pressing Start restarts a fresh
  match (scores/clock reset, faceoff).

### 8.2 Faceoff formations

Positions are symmetric and computed from `CENTER` ± offsets (tiles), mirrored in
y for the team defending the **top** vs the **bottom**. For the team defending
the bottom (attacking up):

| Skater | Offset from center (tiles) |
|---|---|
| Center (0) | `(0, +2)` |
| Left Wing (1) | `(−6, +5)` |
| Right Wing (2) | `(+6, +5)` |
| Goalie | `(0, +16)` (at its goal-line inset) |

The team defending the top uses the same offsets with the y sign flipped. Which
team defends which end is the period-parity function above.

## 9. Input

Logical inputs (the sim sees only these as per-tick bitmasks — also the
netcode/replay format). Buttons are **context-sensitive** on possession:

| Logical (RetroKit `Button`) | Default keys | With puck | Without puck |
|---|---|---|---|
| `Left/Right/Up/Down` | Arrow keys | Skate (8-way) | Skate (8-way) |
| `A` | Z or Space | **Pass** | (reserved — no-op v1) |
| `B` | X | **Shoot / hold = charge slap** | **Check / poke-steal** |
| `Start` | Enter | confirm on the `final` handshake | — |

Touch (ADR-007, dual-orientation): a skating thumb-zone (8-way) and two action
buttons whose labels swap with possession (**Pass/Shoot** vs **Check**), built on
the same `createTouchControls` pattern as Bubble Buddies, positioned by the shell
layout for portrait (controls below) and landscape (controls flanking).

## 10. Determinism & update order

- The sim implements RetroKit's `GameSim`/`NetSim`: `tick(slotInputs)`,
  `serialize()`, `hash()`, `snapshot()`, `restore()`, `joinPlayer()`,
  `rejoinPlayer()`. No DOM, network, wall-clock, or `Math.random`
  (lint-enforced). One seeded `Rng` owned by the sim.
- **Entity ids** are stable and ordered: skaters `team*10 + index` (Home 0–2,
  Away 10–12), goalies `team*10 + 9` (9, 19), puck is singular. Every RNG draw
  and every ordered scan happens in ascending id order.
- **Fixed update order per tick:**
  1. Resolve per-slot human inputs; a slot with `null` for
     `DISCONNECT_GRACE_TICKS` flips its skater to CPU (§11).
  2. Compute CPU inputs for every CPU-controlled skater and both goalies
     (heuristics in §11.1; all randomness from the sim RNG, drawn in skater-id
     order) — producing one input bitmask per skater.
  3. Update skaters in id order (accel/friction/facing/move, board stop, tumble
     countdown).
  4. Update goalies in id order (crease tracking).
  5. Resolve possession events in id order: poke-steals, body checks, then loose
     pickups (so a check this tick frees the puck before a teammate grabs it).
  6. Update the puck: if carried, snap to carry position; else friction →
     goal-line test → move/reflect (§6).
  7. Resolve shots/passes requested this tick (charge release ordered by
     skater id).
  8. Goals/score, clock, period/OT/mode transitions (§8).
  9. `tick++`, store `rng` state.
- Every replay fixture is a multi-slot input log (`MultiInputLogEntry[]`) + the
  expected final state hash. The golden fixture is
  `test/fixtures/replay-001.json`; regenerate intentionally with
  `REGEN_FIXTURES=1 pnpm test` and review the diff alongside any spec change.
- **Serialization** is the full `GameState` (no special-case shape — Puck Pals
  has no pre-multiplayer v1 to keep byte-compatible, unlike Bubble Buddies).
  `hash()` = `fnv1a(serialize())`. `snapshot()`/`restore()` are lossless for
  netcode.

## 11. Multiplayer (netcode) — **versus**, server-authoritative (ADR-003)

Online versus is the point. The room hosts Puck Pals via its registry entry in
`workers/rooms/src/games.ts` (`'puck-pals': (seed) => new PuckPalsSim(seed)`).

- **Player count & teams.** 1–4 humans, assigned to teams/skaters by slot (§3).
  1v1 = slots 0–1; 2v2 = slots 0–3. The sim is constructed with **all skaters
  present** (CPU by default); `joinPlayer(slot)` binds a human to the next free
  skater on team `slot % 2`.
- **CPU fill.** Every skater without a bound human, and both goalies, are CPU
  from the opening faceoff — always labeled "CPU" in the HUD/roster.
- **Server-owned vs. predicted.** The **puck is always server-owned, never
  client-predicted** (BRIEF — in versus a mispredicted puck is worse than a
  little input latency). Skaters use the standard transport: the client predicts
  its own skater from local input and reconciles to the snapshot stream;
  opponents and CPUs render from snapshots. (Transport, snapshot cadence, and
  reconciliation are netcode-provided and unchanged — see
  `packages/netcode/SPEC.md`.)
- **Disconnect → CPU takeover (BRIEF).** A slot whose inputs stop for
  `DISCONNECT_GRACE_TICKS` has its skater **revert to CPU** (it does *not* vanish
  — a missing skater would unbalance a versus rink). `rejoinPlayer(slot)` rebinds
  the human to the same skater, keeping the score. This differs from Bubble
  Buddies' despawn-on-disconnect — versus wants the body to keep playing.
- **Determinism note.** Skaters update in id order within step 3 of §10; CPU
  decisions draw RNG in id order. Replay fixtures record all four input streams.

| Constant | Value | Meaning |
|---|---|---|
| `DISCONNECT_GRACE_TICKS` | 180 | 3 s without inputs before a human skater reverts to CPU |

### 11.1 CPU AI (game-local; the house pattern for CPU players)

A deterministic per-skater state machine, evaluated in step 2 of §10, emitting a
NES input bitmask (so CPU and human skaters run the *identical* skater update —
no separate code path). Small reaction jitter and decision coin-flips come from
the sim RNG (drawn in skater-id order), giving lifelike-but-replayable play.

- **Loose puck:** the nearest CPU on each team skates toward the puck; others
  hold loose formation/coverage.
- **Own team carries:** the carrier drives toward the attacking goal, shoots when
  within `CPU_SHOOT_RANGE` of the mouth (charging a slap if unpressured), or
  passes (A) to an open teammate when an opponent is within `CPU_PRESSURE_RANGE`;
  non-carriers move to support/open ice.
- **Opponent carries:** the nearest CPU chases to poke-steal/check (B) within
  range; others mark the other opponents / cover the slot.
- **Goalie:** §5.1 (lateral crease tracking toward the puck x).

| Constant | Value | Meaning |
|---|---|---|
| `CPU_SHOOT_RANGE` | 80 | px from the mouth at which a CPU carrier will shoot |
| `CPU_PRESSURE_RANGE` | 24 | px; an opponent this close makes a CPU carrier pass |
| `CPU_REACT_JITTER` | 6 | max ticks of RNG reaction delay on a CPU decision |

## 12. Avatars (Phase 3 seam — `packages/avatar`)

"Get Sprited" ships across all four games (ADR-009). Puck Pals supplies a
**skater body rig**: skating (directional lean), wind-up (slap charge), shot
follow-through, and tumble poses, plus a goalie rig. The rig consumes a quantized
avatar (house 16-color palette, BRAND.md) and renders the player's face on the
skater body.

> **Dependency, not in this worktree.** `packages/avatar` is being built on the
> `phase/avatars` worktree and is **not yet on `main`**. Until it lands, skaters
> render as solid palette boxes (team-tinted) with a facing notch. The rig
> integration lands additively once the avatar package is on `main` (it is a
> renderer concern only — the sim never knows). **This is the one item in the
> task's step-2 chain blocked on an external dependency; flagged per the ADR-009 /
> additive-only protocol.**

## 13. Out of scope for v1 (parking lot)

- Active-skater **auto-switch** (control the teammate nearest the puck).
- **Manual goalie** on defense.
- **Penalty-shot shootout** tiebreak (v1 uses shots-on-goal then Away-wins).
- Per-client camera **orientation flip** so "your" net is always at the bottom.
- Penalties, fighting, icing/offside, line changes, stamina.
- Real net-pocket geometry, deflections off skates, one-timers.
- Sound and music; real sprites before Phase 3 avatars.

# Devlog

Raw, dated notes after each significant milestone — source material for the
Field Guide.

## 2026-06-13 — Delivery pipeline + staying on the Free tier (the day prod bit back)

Deploying Ramp Riders, the rooms Worker started returning `429 / error 1027`:
the Cloudflare **Workers Free 100k-invocations/day cap**, hit account-wide.
Multiplayer was down and we only found out via a failed smoke test. That turned
a deploy exercise into building the missing non-functionals: a real pipeline
with scale/cost as a measured gate, engineered to stay on Free.

**Did our code cause the burn? No — measured, not guessed.** Built a load test
(`tools/loadtest/`, `pnpm loadtest`) that drives real sessions at a local
`wrangler dev` and counts the only things that hit Free caps: Worker invocations
(create + room-info + per-player WS upgrade — WS *messages* ride the DO and don't
re-invoke) and KV writes (one per room created). A 2-player session = **4
invocations + 1 KV write**. So 100k invocations ≈ **25,000 sessions/day** — orders
of magnitude past real traffic ⇒ **external probing**, not gameplay. Code review
agreed: client reconnect is capped at 8 with backoff, `fetchRoomInfo` runs once
per join, no polling anywhere. (Definitive request-by-path confirmation is queued
on Cloudflare observability once Kevin authorizes the MCP.)

**Free-tier guardrails shipped** (the actual fix, independent of any hosting
change): `workers_dev:false` (kills the unauthenticated probe surface), per-IP
`ratelimits` bindings on create/join (~20 + ~60 /min — generous for play, a
ceiling for a bot), and a throttled `lookupRoom` TTL-refresh — it was writing KV
on *every* request, which alone would blow Free's **1,000 writes/day** cap; now
~4×/lifetime. The load test makes the binding Free constraint explicit:
new-rooms-per-day (KV writes), headroom ~1,000/day, not invocations (~25k/day).

**Pipeline.** The manual stitch is now `tools/build-site.mjs` — registry-driven
(adding a game is a one-line `site/registry.ts` edit). New `pnpm build:site` /
`verify`. CI now builds the deploy artifact on every PR. New `deploy.yml`: merge
to main deploys the Pages site (always) + rooms Worker (only when its code
changed) with a post-deploy smoke test; every PR gets a Pages preview wired to
the prod Worker (`VITE_ROOMS_ORIGIN`) so the QA env has working multiplayer.

**Consolidation explored, deferred (ADR-011).** Folding the site into the Worker
(Static Assets, one deploy) is appealing but gated: couldn't confirm locally that
asset hits stay free of Worker invocations (`wrangler dev` ran the Worker for
every request) — and if that's true in prod too, it would push every page load
onto the 100k cap, worse than today's split where Pages page-loads are already
free. Also entangles the worker's tests with the site build. Recorded with the
routing gotchas + a verify-on-throwaway-deploy gate.

Human-run to close: add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo
secrets; deploy the guardrails Worker (ideally before the ~00:00 UTC quota reset
so the prober can't immediately re-burn); authorize observability for the
definitive burn breakdown. Staying on Free looks viable; Paid + a budget alert
remains the documented fallback if real traffic ever approaches the caps.

## 2026-06-12 — Phase 1: Bubble Buddies is playable

One session from empty repo to a playable game. What happened, in order:

**Scaffold.** pnpm workspaces + TypeScript project references (`retrokit`,
`bubble-buddies`), Vitest, GitHub Actions (typecheck + lint + tests), and the
determinism guardrail: an ESLint block that makes any file under `src/sim/`
error on DOM globals, network APIs, timers, `Math.random`, and wall-clock
time, plus a ban on importing render/input/net/audio modules. The rule was
tested by writing a deliberate violation before trusting it.

**Spec first.** `games/bubble-buddies/SPEC.md` before any game code: integer
subpixel units (256/px), every tuning value a named constant, and the 5 level
maps as ASCII — validated programmatically (32×24, entity counts) before
committing. Jump height (~4.7 tiles) was checked against platform spacing
(4 tiles) at design time, on paper, not by playtesting into a wall.

**RetroKit core.** Built only what Bubble Buddies needs (ADR-002 discipline):
xorshift32 RNG, FNV-1a state hashing, ASCII tilemap, AABB physics with
one-way platforms, `GameSim` contract + RLE input replay; thin shell layers
(Canvas 2D, keyboard → NES-style bitmask, fixed-60Hz accumulator loop).
Subtle bug dodged by test: a standing entity accumulates sub-pixel gravity
without moving a pixel — naive collision marks it airborne every ~16th tick,
which would have made jumping feel randomly dead. `isSupported()` (flush-rest
check) covers it, with a regression test.

**The sim caught my test bugs.** First test run: 4 failures, all the same
root cause — tests that cleared the enemy list to isolate a mechanic
immediately triggered the level-clear transition, freezing the world. The
game logic was right; the tests got a `holdLevelOpen()` helper (park an
uncollectable fruit). A good early signal that the sim's rules compose.

**Determinism gate.** 33 tests green, including a golden replay fixture:
~2 minutes of scripted inputs, state hash sampled every 600 ticks, committed
as `test/fixtures/replay-001.json`. Any gameplay-affecting change now fails
CI until the fixture is intentionally regenerated (`REGEN_FIXTURES=1`) and
reviewed. This is the mechanism ADR-006 promised.

**Placeholder art.** No sprite files yet — characters are code-drawn
two-tone critters with eyes (facing-aware), bubbles are translucent circles
with a shine. Original by construction; real art is Phase 3.

Phase 1 demo target met locally: `pnpm dev` → move, jump, blow, trap, pop,
fruit, chains, 5 levels, lives, game over → restart. Not yet done from the
Phase 1 roadmap: Cloudflare Pages preview deploy.

## 2026-06-12 — Phase 2: online co-op is live

Bubble Buddies is multiplayer: Durable Object rooms, prediction netcode,
room-code invites, emotes. One session, five commits, ~80 tests green.

**The fixture constraint shaped the sim design.** Phase 2's hard rule was
"sim changes only per SPEC §11 — the solo replay fixture must stay green,"
and the fixture hashes `fnv1a(serialize())`. So multiplayer state landed
behind a compatibility seam: the sim's state is now slot-based (4 players,
per-player score, rescue bubbles), but `serialize()` emits the exact v1 byte
shape whenever the game is classic-solo (only slot 0 ever joined). The
Phase 1 golden fixture passed unregenerated on the first run — the proof the
seam works. Netcode snapshots use a separate, always-lossless
`snapshot()/restore()` pair.

**Disconnects are inputs.** SPEC §11 says a slot despawns after 5 s without
inputs — but a zero bitmask is a legitimate "standing still." The sim's tick
input became `(bits | null)[]`: null means "nothing received," and the
disconnect grace counter is just sim state driven by the input stream. That
kept replays complete (the 4-player golden fixture literally records the
nulls of a disconnect and a scripted rejoin event) and the room server
trivial: a disconnected socket contributes null, nothing else.

**RoomCore is transport-agnostic; the DO is a thin shell.** All room logic —
slots, rejoin tokens, input buffering with 3-tick redundancy, 20 Hz
snapshots, hashchecks, emote rate limits — lives in `packages/netcode` with
`send`/`now`/`random` injected. The Durable Object wraps it with the
WebSocket hibernation API, a drift-corrected 60 Hz `setInterval` that stops
when the room empties, SQLite-backed persistence every 10 s, and a 24 h
expiry alarm. The same core runs under vitest with a fake clock, under
miniflare with real sockets, and in production unchanged.

**The two-headless-clients test earns its keep.** Two real sim+RoomClient
instances against RoomCore over an in-memory network (3-tick delay, fake
clock): join, play, hard disconnect, 300-tick despawn, token rejoin — with
the server's periodic hashchecks verified client-side. Zero desyncs. This
plus the miniflare suite means the whole netcode path is CI-gated without a
single real network round trip.

**Prediction per ADR-003.** Clients send inputs stamped with a steered clock
(server tick + RTT-derived lead), predict only their own buddy, rebase onto
every snapshot by replaying buffered local inputs, and render remote
entities interpolated between the last two snapshots. Visual corrections cap
at 2 px/frame (16 px snaps). `?lag=150` wraps the transport in artificial
latency + loss for feel-tuning.

**Invite flow per ADR-008.** `/play/bubble-buddies?room=CODE` with a "start
a call first" nudge, share-sheet/copy link, and an in-app-browser detector
(Messenger/Instagram/WhatsApp WebViews) with an "Open in Safari" escape.
Emote wheel on B-hold — six fixed emotes, rate-limited server-side, no free
text anywhere. A minimal touch pad (◀ ▶ / A B) shipped as a stopgap so the
two-phone demo works before the full Phase 1.5 mobile pass.

**Deploy: everything from the repo.** `wrangler kv namespace create` → id
into `wrangler.jsonc`; SQLite DO migration (`new_sqlite_classes`, free
plan); Worker routes `retro-recall.ruralrooted.com/api/*` and `/room/*`
declared in config; Pages project + custom domain attached via API. The one
step automation refused (correctly): writing the CNAME into the shared
production DNS zone — that's `workers/rooms/scripts/setup-dns.sh`, run by a
human once. Until then the stack is fully playable at
retro-recall.pages.dev against the workers.dev rooms origin; verified in
production with two WebSocket clients sharing a room (20 Hz snapshots,
emote relay, spectate-until-next-level all behaving per spec).

Phase 2 demo target: met pending the DNS one-liner + the two-phone FaceTime
playtest. Known follow-ups: real Phase 1.5 mobile pass (PWA manifest,
orientation layouts), seat reuse after a rejoin window expires, binary
snapshots only if measured necessary.

## 2026-06-12 — Phase 2.5: mobile first, for real

Field report from Kevin's iPhone — keyboard legends on a touch screen,
stretched ratios — drove a full shell rebuild per ADR-007. Strictly
shell-layer: all 64 tests including both golden replay fixtures passed
unregenerated; the sim never knew.

**Integer scaling means *device* pixels.** The naive read of "integer
multiples of 256×192" — CSS pixels — gives 1× on a 393pt iPhone 15: a
256pt-wide postage stamp using 65% of the screen. The layout engine scales
in device pixels instead: at 3× DPR it picks 4 device px per logical px →
a 341×256pt playfield that is still a pixel-perfect upscale (1024×768
device px), just fractional in CSS units. Crisper *and* bigger. The origin
snaps to the device-pixel grid so the upscale never resamples.

**The pillarbox bars are the controller.** Landscape centers the playfield
at max integer scale and puts the d-pad in the left bar, A/B in the right —
the NES-held-sideways layout ADR-007 sketched. Portrait is the Game Boy:
playfield top, controller band below. First screenshots showed the portrait
controls floating mid-band on tall phones; the band now caps at 320px and
anchors to the bottom, where thumbs actually rest. Live relayout on rotate,
resize, and visualViewport changes; safe-area insets pad the whole stage.

**Touch zones, not buttons.** The whole bar/band is the touch surface; the
drawn d-pad and A/B are just visuals. The d-pad recomputes its 8-way octant
every pointermove (slide between directions without lifting), buttons match
by nearest-center-with-slop, and every pointer is tracked by pointerId —
move + jump + blow simultaneously. One subtlety: a pointer that presses B
*locks* to B, so holding for the emote wheel and sliding to pick can't
wander onto A mid-gesture.

**Join surfaces flipped (spec updated).** iOS PWAs can't capture links —
a tapped invite always opens Safari, never the pinned app. So the home
screen now leads with the big 4-letter code input (the regulars' path),
links stay the first-timer path, and the "start a call" banner demoted to
a one-line muted tip on the join overlay. ADR-008 and the netcode SPEC
carry the reasoning.

**PWA with zero image dependencies.** Manifest (standalone,
any-orientation), icons generated from the brand pixel bubble by a ~100-line
PNG encoder on node:zlib (`scripts/make-icons.mjs` — deterministic, no
sharp), service worker (cached shell, network-first navigations, room API
never cached — a stale roster is worse than an error), an iOS "pin me"
share-sheet walkthrough, and a tap-to-start gate that doubles as the audio
unlock for the audio engine we don't have yet.

**Verification.** Playwright (webkit + chromium) drives iPhone SE/15/15
Pro Max viewports in both orientations plus a desktop baseline — 14 tests
asserting the integer-scale contract, control placement, ≥48px buttons,
and that touch devices never see a `<kbd>`. Screenshots committed under
`games/bubble-buddies/e2e/screenshots/` for review. Honest gaps: the e2e
suite is not wired into CI (browser downloads); the Android
beforeinstallprompt path is untested on real hardware; play-page
screenshots show "reconnecting" because the harness stubs the REST API but
runs no WebSocket server.

Deployed to retro-recall.pages.dev. Phase gate remaining: Kevin's two-phone
playtest (now doubling as the Phase 2 leftover), plus the Phase 2 DNS
CNAME, both human-run.

## 2026-06-12 — Phase 4a: the library, the engine it needs, and the factory

The arcade goes from one game to four. ADR-009 splits the work: build the
shared stuff first on one branch (this one), *then* three game worktrees in
parallel. This is that first branch. Three deliverables, in order — engine,
library, scaffolder — because the order is the whole point: freeze the shared
surface before three sessions start writing against it.

**Engine extensions, proven additive.** The three BRIEFs were audited for what
≥2 games need; that landed in RetroKit. A camera (follow-with-deadzone, world
clamp, forward lock for lock-and-advance, boss-pin) — kept deliberately *out*
of the sim core, because a camera is per-client and racing follows your own
rider; a camera feeding the sim would desync netcode. Big maps (the tile grid
was always dimension-agnostic; pinned that down + a cull window). Slope tiles
(22.5°/45°) in the integer physics — the one real physics-core change. And
camera-triggered spawn regions, which despite the name trigger off a *sim-owned
monotonic progress scalar*, never a render camera, so co-op clients spawn the
same enemies.

The slope change is where determinism could have broken. The guard is
structural, not vigilance: `TileMap.hasSlopes` is computed at parse and false
for every Bubble Buddies map, so `moveAABB` runs the byte-identical pre-slope
path unless a map actually contains a ramp. Proof, not assertion — both golden
replay fixtures hash-matched the pre-work baseline byte-for-byte after the
physics edit (checksummed before I touched anything, re-checked after). 31 new
engine tests; 103 green total.

**Library home.** A registry (`site/registry.ts`) is the single source of
truth — one entry per game drives tiles, status, routes, and the coming-soon
teasers. Bubble Buddies live; the other three are coming-soon tiles that *peek*
(a bottom-sheet teaser pulled straight from each BRIEF, so the copy can't drift
from the design). Mobile-first per ADR-007: 2-up portrait / 4-up wide via an
auto-fit grid, safe-area padding, pixel-art thumbnails (original house glyphs,
no trade dress), ≥44px hit areas, the one allowed "pop." Showed Kevin the
layout before building it; both calls (teaser pages, a persistent cross-game
JOIN CODE chip) came back as proposed.

**The factory.** `pnpm new-game <id>` generates a complete game — deterministic
sim implementing the full NetSim contract, SPEC template, renderer + dual-
orientation touch shell, a replay test that self-writes its golden on first
run, the play route — then wires the shared seams *additively* at stable
anchors: the site registry, the rooms game registry, and the TS project graph.
The enabling refactor was making the rooms DO pick its sim from a game→factory
map instead of hardcoding Bubble Buddies; pre-registry rooms default to the
same sim byte-for-byte, so a Stage-2 game worktree's only worker touch is
appending one line (ADR-009's additive rule made literal).

Proof it works: `pnpm new-game demo-game` → typecheck, lint, 4 tests (fixture
self-written), build (both routes), and the stub *renders* a hero box resting
on the floor. Then `--remove demo-game` returned `git status` to spotless —
the factory is reversible, which is what makes it safe to run casually.

**Friction, for the report card.** The cost wasn't the templates, it was the
project-reference web: a new game's sim is imported by the worker, so it needs
entries in the root tsconfig, the worker tsconfig, the worker package.json,
*and* the worker source — four additive edits, all now driven by the
scaffolder's anchors. Worth noting for the factory thesis: game #2 should be
near-free on shared infra, but every game still pays one `pnpm install` (new
workspace member) and owes its own SPEC before any code. Wall-clock for this
branch was dominated by the engine (slopes especially — landing physics wants
care), not the scaffolder.

**Timing / what's left.** Engine + tests, then the gated library, then the
scaffolder — five commits, all on `phase/library`, none on `main` (Kevin
merges). The site's play routes assume the games are co-deployed under
`/play/*` on Cloudflare Pages (true in prod, not in the standalone site dev
server). Next: this branch merges to main first, then the three game worktrees
(`game/puck-pals`, `game/splash-squad`, `game/ramp-riders`) start — each writes
its SPEC for Kevin's approval before building.

## 2026-06-12 — Wave B: Splash Squad (the factory's first report card)

The first game built *through* the ADR-009 factory rather than alongside it.
Worktree `game/splash-squad`, additive-only. ~1 hour wall-clock, empty game dir
to: approved SPEC, deterministic sim, 6 levels, renderer, dual-orientation touch,
an online co-op client, and 15 tests green (full suite 116). ~2,750 lines of
game TS. The headline: **zero engine PRs and zero room-logic edits were needed.**

**What the Stage-1 Library bought us.** Every one of the BRIEF's four engine
needs was already on main: the forward-locking `Camera`, width-agnostic
`TileMap`, `SpawnRegions` (the sim-owned progress-scalar latch — built for this
game's "enemies activate as the screen reaches them"), and AABB physics for a
swarm of droplets. The BRIEF's *guessed* "boss-arena camera feature flag" turned
out unnecessary — forward-lock + world-bound clamp pins the arena for free. And
the rooms registry seam (`POST /api/rooms { game }` → `simFactory`) meant online
hosting was a one-line `games.ts` entry the scaffolder already wrote. This is the
factory thesis holding up: game #2's shared surface didn't move.

**Scaffolder friction (fix-list for the factory).**
1. `pnpm new-game <id>` refuses a non-empty `games/<id>/`, but the BRIEFs already
   live there — had to move `BRIEF.md` aside *and* `rmdir` the empty dir, scaffold,
   then restore. The scaffolder should tolerate a dir containing only `BRIEF.md`.
2. **Duplicate registry entry.** Phase 4a had hand-authored a `coming-soon`
   `splash-squad` tile; the scaffolder appended a second stub because its
   idempotency check keys on the literal insert string, not the game `id`. Deleted
   the dupe by hand. Fix: dedupe by `id`.
3. The generated `package.json` has no `test` script, so `pnpm --filter <pkg> test`
   is a silent no-op (tests only run from the root Vitest). Mildly confusing.
4. No `src/vite-env.d.ts` in the template, so the moment a game uses
   `import.meta.env` (the online client does) `tsc` breaks until you add it.

**Shape of the build.** Sim is a pure tick function: pull-along scroll window
(leader pulls, a moving left wall carries stragglers — no death-by-camera),
8-direction integer aim with Stream/Spread/Burst nozzles, a water tank refilled
only at spigots, Trundle/Sentry/Hopper grunts + a Boiler-Bot boss with an
open-window weak point, soak + transitive splash chains, and Bubble Buddies'
revive rules reused verbatim. Levels are a deterministic ASCII *builder* + spawn
schedules (the approved convention for multi-screen maps) — replay fixtures keep
it honest. The renderer follows sim `scrollX` (co-op shares one window, so no
per-client camera). The online client is RoomClient + a splash `NetView`
(snapshot interpolation + capped local prediction).

**Duplication we took on knowingly.** The touch shell (`layout`/`controls`/
`device`/`shell.css`) was copied from Bubble Buddies to stay additive and keep
games decoupled. That, plus the ADR-008 comms shell (invite/emote/PWA/in-app
escape) we deliberately did *not* re-author, points at a real follow-up: extract
a shared `@retro-recall/shell` (and a comms layer) so game #3/#4 don't copy-paste.

**Deferred / gated (told Kevin).** Avatars are blocked — `packages/avatar` isn't
on main yet (Phase 3, the `phase/avatars` worktree); v1 ships placeholder
rectangles per the SPEC and wires real body rigs when "Get Sprited" lands across
all games. Real pixel art is still deferred. The registry stays `coming-soon`:
the IP review passed (`games/splash-squad/IP-REVIEW.md`) and CI is green, but the
`→ live` flip waits on Kevin's two-phone playtest.

**Follow-up (same session): SFX landed (SPEC §12).** A tiny generated WebAudio
synth (`src/shell/audio.ts`) — no asset files, so ADR-005 provenance stays
trivial — plus a view-layer `SfxObserver` (`src/shell/sfx.ts`) that diffs
consecutive sim states into sound events (squirt, splash-hit, sputter, splash-
chain, pickup, refill, downed, revive, boss-hit/defeat, area/zone-clear, win,
game-over). The sim stays silent and deterministic; the observer resyncs on
level changes so respawns don't trigger phantom sounds, and runs on both the
local sim (solo) and interpolated snapshots (online). Music-free, as asked.
Still open: the shared `@retro-recall/shell`/comms extraction (lands on main as
its own PR per ADR-009, not from this worktree) and real pixel art.

## 2026-06-12 — Phase 3: Get Sprited (avatars + real art)

The signature feature lands: upload a photo, become a pixel buddy, play as
yourself. ADR-004's split held up — **AI makes the identity, templates make
the animation** — and it's why this worked on the first real try where a
full-sprite-sheet ask would have flailed.

**One good head beats a whole sheet.** The Avatar Worker asks Gemini
(`gemini-2.5-flash-image`) for a single 24×24-ish head against a locked,
versioned style prompt, runs input + output moderation (vision pass, fails
closed), palette-quantizes to PALETTE_P1, stores it in R2 by content hash,
and **drops the photo**. The client then composites that head onto
hand-authored body rigs into a 12-frame sheet (idle/walk/jump/blow/rescue) —
the same `composeSheet` for generated *and* fallback buddies, so everyone
animates identically. A local harness (`gen` + `compose`, writing to
`gen-out/`) ran the real pipeline so we could eyeball heads and motion before
wiring any of it into the game.

**The lie the model tells: "transparent background."** It doesn't — it hands
back an opaque fill every time, so the first composited buddies were faces
trapped in a solid square (invisible until composited; the head previews had
blended into the page background and fooled the first eyeball). Fix is two
parts: a border flood-fill **matte** that keys out the connected background
(stops at the head's dark outline, spares background-colored pixels *inside*
the face), and style prompt **v2** — ask for a flat magenta chroma key and
drop the "CRT glow" clause that was painting colored halos. Versioned, so it
re-styles only new players.

**Eight original creatures for free.** The fallback gallery (declined AI /
failure / rate-limit) is generated from one parameterized `creature()` —
silhouette → auto 1px outline → eyes → smile → a top feature (ears, antenna,
horn…). No hand-pixeling, distinct by color + feature, and they flow through
the exact same compositor. Picking one is instant; play never blocks.

**"avatarId already flows through join" — it didn't.** It was in the message
*type* and nothing else: not sent by the client, not stored on the server,
not in the roster, not seen by the renderer. Threaded it end to end
(SlotMeta + DO persistence, set on join *and* rejoin, surfaced in
PeerSlotMeta) and the renderer now blits the per-slot sheet via
`ctx.drawImage` — no RetroKit change needed, `ctx` is already public. Pose
comes from `phase/grounded/vy/blowCooldown`, and since the sim has no `vx`,
walk-vs-idle is an x-delta the renderer tracks itself. Misses fall back to
the placeholder critter, so a slow R2 fetch never drops a frame.

**Real art, by palette cohesion.** The world was drawn in ad-hoc colors that
weren't PALETTE_P1, so avatars wouldn't match it. Recolored everything to the
house palette and gave it shape: navy blocks with a cyan bevel only on
exposed ledges, mint one-way platforms with drip-studs, and enemies that are
now *grumpy* — angry slanted brows + a frown read them as foes, not buddies.
Original shapes throughout; nothing traceable (ADR-005).

**Verification.** 112 unit/integration tests green (sim + replay fixtures
untouched — the avatar work never goes near the deterministic core). The
Playwright gate (chromium + webkit) actually *exercises* the new client: the
join screenshots show the picker rendering 8 composited buddies through the
real `createImageBitmap`→canvas path on every viewport. Honest gaps: the
full key-bound, Gemini-mocked moderation **rejection** e2e is deferred to
keep the worker tests hermetic — the gate's fail-closed decision is unit-
tested (`parseModerationVerdict`) and the reason→422→fallback mapping is a
one-liner — and the two-phone, real-photo phone demo is Kevin's to run.

Phase gate remaining (human-run): Kevin's Gemini key + worker setup (R2
bucket, KV namespace, `wrangler secret put GEMINI_API_KEY`), deploy, the
Phase 2 DNS CNAME, and the photo-on-a-phone demo.

## 2026-06-12 — Wave B: Ramp Riders playable (game #4, the factory's first parallel build)

First game built in a Stage-2 worktree (`game/ramp-riders`), additive-only — no
`packages/*` edits. Empty `games/ramp-riders/` (just a BRIEF) to a playable
1–4 online BMX racer in one session.

**The factory report card (the point of ADR-009 Stage 2).**
- `pnpm new-game ramp-riders` did all the wiring — sim/renderer/shell stubs,
  test+fixture harness, play route, and the four additive seam edits (root
  tsconfig, worker tsconfig/package.json/games.ts) — and it built + tested
  green out of the box. Game #4's *infra* cost was ~zero, exactly the thesis.
- **Scaffolder friction (two real ones, both worth fixing before games #3/#4):**
  (1) it `die`s if `games/<id>/` already exists, but a pre-written `BRIEF.md`
  lives there — so I had to stash the BRIEF, remove the dir, scaffold, restore.
  (2) it blindly inserts a registry entry even when one exists (Ramp Riders had
  a hand-authored coming-soon tile), producing a duplicate I deleted by hand.
  Both argue for a `--brief-exists` / idempotent-by-id registry insert.
- Where the time actually went: **not** scaffolding — the terrain/physics. The
  rest (constants, tracks, renderer, touch, netcode client) flowed from the SPEC
  and from copying Bubble Buddies' conventions.

**The one hard problem: slopes + a tall hitbox.** RetroKit's `moveAABB` resolves
X then Y with slope tiles non-solid in the X pass, and the rider hitbox is ~2
tiles tall. First two terrain attempts wedged the rider dead on a ramp: any
**solid tile at the cresting box's foot row** is a wall the X pass slams into.
Fix was geometric, not engine (additive rule held): ramps are clean slope-tile
diagonals with **empty interiors** (solid only at ground rows); no elevated
solid decks. That cost us the landable tabletop and down-ramp landings — v1
ramps are pure launch kickers with forgiving flat landings (`AIR_ROTATE = 0`, a
level pop lands clean with no input — right call for kids). Landable decks /
lean-to-match-downslope are a polish follow-up. Lesson for the other worktrees:
*the slope core wants either a shorter hitbox or a slope-aware X pass before
mounded terrain gets rich* — a candidate engine PR, not a game hack.

**Determinism held.** No gameplay RNG (sprinklers are tick-periodic), riders
update in slot order, finish ties break by slot. 9 sim unit tests + a full-race
golden fixture (`replay-001.json`, regenerated intentionally). Bubble Buddies'
fixtures stayed **byte-identical** through the build — additive-only, proven.

**Netcode (mode per BRIEF: 1–4 race).** Server side was one line
(`games.ts` factory, scaffolded). Client predicts only its own rider and
interpolates rivals between snapshots (riders never collide, so divergence is
invisible — the latency-tolerant mode the BRIEF promised). Disconnect coasts to
a stop, no CPU takeover. Per-rider "junior boost" (youngest-only) needs a
netcode join-metadata field `JoinMsg` lacks — parked; v1 ships the room-level
rubber-band toggle instead (additive, tested).

**Art / IP (ADR-005 pass).** Original placeholder art only: a chunky kid-on-BMX
silhouette (wheels/frame/helmet), dirt-and-grass terrain, cones/sprinklers/hose/
mud — generic backyard, no Nintendo/Konami/Taito names, characters, or trade
dress in identifiers, assets, or copy. "Excite Bike" appears only as internal
inspiration in the BRIEF, never in code. Avatar body rigs await `packages/avatar`
landing on main (Phase 3, concurrent worktree) — renderer-only, sim is
avatar-agnostic.

**Verified.** typecheck + lint clean; full suite 105 + 8 rooms green; both
routes build; headless-browser smoke of the solo race (renders, no console
errors) and the online join overlay.

**What's left before the registry flips coming-soon → live (gate per ADR-009):**
CI green ✓ and IP review ✓ are done; the **two-phone playtest is human-run** and
still owed, so the tile stays coming-soon. Flipping is a one-liner once it
passes: set `status: 'live'` + `route: '/play/ramp-riders/'` on the registry
entry. Tuning expected from the playtest — track lengths land ~20–26 s at full
boost (short of the 45–90 s target; bump repeat counts), and landing feel.
## 2026-06-13 — Shared shell package (ADR-010), the first Wave-B-driven seam

Splash Squad surfaced the first real duplication of the factory era: it copied
Bubble Buddies' layout engine + 8-way touch pad + device detection verbatim
(correctly — a game worktree can't touch `packages/*`). So those three generic
modules now live in `@retro-recall/shell`, extracted with `git mv` (history
preserved) and consumed by Bubble Buddies; its local copies are gone. Per
ADR-009 this lands on `main` as its own PR — the game worktrees rebase and
switch their imports, dropping their local copies. Verified green: tsc, lint,
full suite + BB e2e graph, both BB web entries build. Game-specific shell
(audio/pwa/invite/emote) and the control CSS stay per-game for now; a shared CSS
and an ADR-008 comms layer are the tracked next extractions.

## 2026-06-13 — Ramp Riders goes live (+ multi-game join routing)

Flipped the registry tile coming-soon → live (`status: 'live'`, `route:
'/play/ramp-riders/'`) — the arcade now has two playable games. That surfaced
the routing seam the registry comment had flagged: the home "join by code" box
resolved a bare code to the *first* live game, so a Ramp Riders code would have
mis-routed to Bubble Buddies (invite links were always fine — they carry the
game path). Closed it the way the comment predicted: `roomInfo()` now returns
the room's `game`, and the home join does a `/api/rooms/<code>` lookup to route
to the right play page, falling back to a sole-live-game guess if the server is
unreachable. Additive across worker + site; no `packages/*` or game-sim changes.
Full suite 138 + 8 rooms + 7 avatar green.

Note: shipped ahead of the two-phone playtest at Kevin's call ("up sooner, then
refine"). Refinements still queued: track-length tuning toward 45–90 s, avatar
body rigs for riders (packages/avatar is on main now), and the landable-deck
slope-engine follow-up.

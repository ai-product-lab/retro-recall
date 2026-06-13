# Devlog

Raw, dated notes after each significant milestone — source material for the
Field Guide.

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

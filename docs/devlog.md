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

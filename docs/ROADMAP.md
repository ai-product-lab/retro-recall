# Roadmap

Each phase ends with something playable (Principle 7). Durations are rough, assuming part-time direction with Claude doing the building.

## Phase 0 — Foundations ✅ (June 2026)

Principles, architecture, ADRs, branding. *This document set.*

## Phase 1 — First playable ✅ (June 2026)

Monorepo scaffold; RetroKit core (sim loop, tiles, AABB physics, sprites, input, seeded RNG, state hashing); Bubble Buddies sim per `SPEC.md` — one player, placeholder sprites, 5 levels, 33 tests including golden replay fixture. See `docs/devlog.md`.

## Phase 2 — Online co-op ✅ (June 2026)

Durable Object room + WebSocket transport; server-authoritative sim with prediction/interpolation (ADR-003); room codes; invite page with call-first flow + emote wheel (ADR-008); 4-player sim per SPEC §11; determinism CI gates. Live at retro-recall.pages.dev (production CNAME pending `setup-dns.sh`). See `docs/devlog.md`.

## Phase 2.5 — Mobile first, for real (~1 week) ← CURRENT

Phase 2 shipped a stopgap touch pad; on a real iPhone the game still assumes keyboards and desktop ratios. Full ADR-007 pass: dual-orientation layout — landscape = centered 4:3 playfield with d-pad/A-B in the pillarbox bars (NES style); portrait = playfield top, controller below (Game Boy style), live switch on rotate; correct integer scaling (no stretched ratios); input hints adapt to device (no keyboard legends on touch); manifest + service worker + "pin me" flow; safe-area layout; tap-to-start audio unlock. Zero sim/level changes.
**Demo:** Kevin's kid plays a full co-op session from a home-screen icon, thumbs only.

## Wave A — two parallel worktrees (after 2.5 closes)

**Phase 3 — Get Sprited** (`docs/PHASE-3-KICKOFF.md`): avatar pipeline per ADR-004, built against Bubble Buddies. Kevin's ops: Gemini API key.
**Demo:** the kids upload photos and chase each other around level 3 as themselves.

**Phase 4a — The Library** (`docs/PHASE-4-KICKOFF.md`, ADR-009): arcade shell with game registry + tiles, `pnpm new-game` scaffolder, and the shared engine extensions the three game BRIEFs demand (camera/scrolling, big maps, slope tiles, spawn regions).
**Demo:** the site is a library; Bubble Buddies is tile #1; three "coming soon" tiles.

Disjoint surfaces (avatar = workers/packages + join flow; library = site shell + engine core), so they can run concurrently; library merges first if both finish together.

## Wave B — three concurrent game worktrees (after Wave A merges)

**Phase 4b — Puck Pals · Splash Squad · Ramp Riders** (BRIEFs in `games/*/BRIEF.md`): one worktree and Claude Code session each, additive-only per ADR-009's engine-change protocol. Spec-first in each. Each adopts avatars via per-game body rigs. Factory metrics in the devlog: wall-clock per game, engine PRs needed, scaffolder gaps.
**Demo:** four playable tiles; family game night has a *choice*.

## Phase 5 — The field guide & the factory's report card (ongoing)

Field Guide section on the site: this doc set, the determinism story, the avatar pipeline, the Wave B parallel-build experiment with real numbers. Skills published. Leaderboards (D1), shareable replays, seasonal level packs, Ramp Riders track editor.

## Later / parking lot

Versus modes (rollback netcode — the deterministic core keeps this open), embedded voice in private rooms via Cloudflare Realtime (ADR-008 Tier 2 — only if FaceTime-alongside proves clumsy), gamepad support, level editor for the kids, sound/music toolchain, accounts (only if a feature truly needs them).

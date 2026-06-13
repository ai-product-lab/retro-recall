# ADR-009: Library first, then parallel game worktrees

**Status:** Accepted · 2026-06-12

## Context

The arcade grows from one game to four: Puck Pals (hockey, versus), Splash
Squad (co-op run-and-gun), Ramp Riders (BMX racing). Kevin wants to build the
three games concurrently in git worktrees. The risk: all three need engine
capabilities RetroKit deliberately lacks (cameras/scrolling, slope physics,
bigger maps), and three worktrees independently extending the engine is merge
hell plus three divergent idioms — the opposite of the factory.

## Decision

**Two-stage topology:**

**Stage 1 — the Library (one worktree, lands on main first):**
- Arcade shell: home screen becomes a game library (tiles, per-game pages,
  "coming soon" states) driven by a **game registry** (`site/registry.ts` —
  one entry per game: id, name, tile art, players, status, route).
- `pnpm new-game <id>` scaffolder (ADR-006, finally built): generates sim
  skeleton implementing `GameSim`, SPEC.md template, renderer/touch-layout
  stubs, test harness + fixture wiring, registry entry, room-server config.
- **Engine extensions, spec-driven:** the three game BRIEFs were audited for
  shared needs; what ≥2 games need lands now on main: camera system (follow
  target, level bounds, per-client viewpoint), levels larger than one screen,
  slope tiles in the physics core, camera-triggered spawn regions. What only
  one game needs stays in that game until a second game wants it.

**Stage 2 — three concurrent game worktrees (after Stage 1 merges):**
- `git worktree add ../rr-puck-pals game/puck-pals` (likewise splash-squad,
  ramp-riders); one Claude Code session per worktree.
- Each game is **additive only**: `games/<id>/`, its registry entry, its
  worker route config. No edits to `packages/*` from a game worktree.
- **Engine-change protocol:** a game discovering a missing engine capability
  stops, lands a minimal spec-driven PR to main, other worktrees rebase.
  Engine changes never ride inside game branches.
- Games merge to main as they reach "playable" (registry flips coming-soon →
  live); merge order doesn't matter because surfaces are disjoint.

## Amended rule

CLAUDE.md's "build RetroKit only as Bubble Buddies needs it" becomes: **the
shared engine grows only from needs written in a game SPEC/BRIEF, and engine
changes land on main before game code uses them.** Same spirit — no
speculative features — adapted to many games.

## Why

Worktrees are the right parallelism tool (shared object store, independent
checkouts, independent Claude Code sessions). The library-first stage is what
makes the parallel stage safe: by the time three sessions run, the engine
surface they share is frozen-ish and their write-sets don't overlap. This is
also the factory thesis made testable: Stage 2 measures how cheap game #2–#4
really are (devlog each game's wall-clock and friction points).

## Consequences

Stage 1 briefly blocks the fun part. Phase 3 (avatars) is deferred by choice
and gets cheaper: "Get Sprited" ships across four games at once, with
per-game body rigs. CI must stay green on main throughout Stage 2 — rebases
are routine, so replay fixtures (which never change from engine work) are
the safety net. IP review now covers Konami trade dress too (ADR-005 applies
unchanged; CLAUDE.md hard rule updated to name it).

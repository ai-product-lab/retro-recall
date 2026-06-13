# Retro Recall — Claude Code instructions

Read these before any work. Full context lives in `docs/` and `branding/`.

## What this is

A web arcade of original games inspired by NES classics, with online multiplayer, built AI-first, with the build process published as a "Field Guide." First game: **Bubble Buddies** (Bubble Bobble-inspired co-op, photo-to-pixel-character avatars).

## Required reading (in order)

1. `docs/PRINCIPLES.md` — non-negotiables; earlier principles win conflicts
2. `docs/ARCHITECTURE.md` — stack, monorepo layout, cross-cutting rules
3. `docs/decisions/ADR-001..008` — the why behind hosting, engine, netcode, avatars, IP, factory, mobile-first PWA, comms
4. `docs/ROADMAP.md` — current phase and demo target

## Hard rules

- **Determinism:** game sims use fixed 60Hz tick, integer/fixed-point math, seeded RNG, serializable state with stable hashing. Sims never import DOM, renderer, or network code.
- **IP (ADR-005):** no Nintendo/Taito names, assets, or trade dress in code identifiers, assets, prompts, or shipped product. Internal docs may name inspirations; code may not.
- **Stack:** TypeScript everywhere, pnpm workspaces, Canvas 2D rendering (RetroKit), Cloudflare (Pages, Workers, Durable Objects, KV, R2), Vitest, GitHub Actions CI.
- **Spec-first:** every game has `games/<name>/SPEC.md`; features land with spec updates and replay test fixtures.
- **Build RetroKit only as Bubble Buddies needs it** — no speculative engine features.
- **Every phase ends playable.** Prefer a worse-looking working game over polished scaffolding.

## Workflow

- Small commits with conventional messages; keep `main` deployable.
- After each significant milestone, append a dated entry to `docs/devlog.md` (create if missing) — raw material for the Field Guide.
- New big decisions get an ADR in `docs/decisions/` (next number).

## Current phase

**Phase 4a — the Library (ADR-009 Stage 1): built on `phase/library`, pending merge to `main`.** This branch builds the shared surface the three parallel game worktrees will share, in order: (1) RetroKit engine extensions — camera, big maps, 22.5°/45° slope tiles, camera-triggered spawn regions — each proven additive by Bubble Buddies' replay fixtures staying byte-identical; (2) the game registry (`site/registry.ts`) + mobile-first library home (Bubble Buddies live, the other three coming-soon with peek teasers); (3) the `pnpm new-game <id>` scaffolder (proven with a throwaway `demo-game`, then removed cleanly). Full suite 103 green; see `docs/devlog.md` 2026-06-12 Phase 4a and `docs/PHASE-4-KICKOFF.md`.

Once this merges to `main`, Wave B starts: three concurrent worktrees (`game/puck-pals`, `game/splash-squad`, `game/ramp-riders`), each additive-only, each writing its `SPEC.md` for Kevin's approval before implementing (ADR-009 Stage 2).

Still outstanding from Phase 2: the production CNAME (human-run `workers/rooms/scripts/setup-dns.sh`) and the two-phone playtest. Phase 3 (avatars, `docs/PHASE-3-KICKOFF.md`) is deferred by choice and gets cheaper run across all four games at once (ADR-009).

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

**Phase 1.5 — Mobile pass** (Phase 1 complete — see `docs/devlog.md`). iPhone-first PWA per ADR-007. Layout: landscape = centered 4:3 playfield, d-pad in left pillarbox bar, A/B in right (NES style); portrait = playfield top, controller below (Game Boy style); live switch on rotate. Touch zones feed the existing input bitmask. Plus: manifest/service worker, "Add to Home Screen" flow, safe-area handling, tap-to-start audio unlock. Strictly shell-layer — the sim, levels, and golden replay fixture must not change.

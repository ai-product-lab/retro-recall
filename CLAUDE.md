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
- **IP (ADR-005):** no Nintendo/Taito/Konami (or any third party's) names, assets, or trade dress in code identifiers, assets, prompts, or shipped product. Internal docs may name inspirations; code may not.
- **Stack:** TypeScript everywhere, pnpm workspaces, Canvas 2D rendering (RetroKit), Cloudflare (Pages, Workers, Durable Objects, KV, R2), Vitest, GitHub Actions CI.
- **Spec-first:** every game has `games/<name>/SPEC.md`; features land with spec updates and replay test fixtures.
- **Engine grows only from a game SPEC/BRIEF need, never speculatively; engine changes land on main before game code uses them** (ADR-009). Game worktrees are additive-only — no `packages/*` edits.
- **Every phase ends playable.** Prefer a worse-looking working game over polished scaffolding.

## Workflow

- Small commits with conventional messages; keep `main` deployable.
- After each significant milestone, append a dated entry to `docs/devlog.md` (create if missing) — raw material for the Field Guide.
- New big decisions get an ADR in `docs/decisions/` (next number).

## Current phase

**Phase 2.5 — Mobile first, for real: built & deployed**, pending Kevin's on-phone playtest to close (`docs/devlog.md` 2026-06-12 Phase 2.5). The full ADR-007 pass landed: integer device-pixel scaled dual-orientation layouts, real touch controls, device-aware hints, PWA (manifest / service worker / pin-me / audio unlock), and the join-surfaces rework (code-entry-first home; netcode SPEC "Join surfaces"). Viewport gate: `pnpm --filter @retro-recall/bubble-buddies test:e2e` (Playwright; not wired into CI).

Still outstanding from Phase 2: the production CNAME (human-run `workers/rooms/scripts/setup-dns.sh`) and the two-phone playtest.

**Next: Wave A — two parallel worktrees** (ADR-009, `docs/PHASE-4-KICKOFF.md`): Phase 3 avatars (`phase/avatars` worktree, `docs/PHASE-3-KICKOFF.md`) + Phase 4a Library (`phase/library` worktree). Then Wave B: three concurrent game worktrees (Puck Pals, Splash Squad, Ramp Riders — `games/*/BRIEF.md`).

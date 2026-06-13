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

**Phase 3 — Get Sprited (avatars + real art): built**, pending Kevin's worker setup + photo-on-a-phone demo to close (`docs/devlog.md` 2026-06-12 Phase 3). All six kickoff steps landed: Avatar Worker (Gemini head → moderation → PALETTE_P1 quantize → R2, photo dropped), client compositor (head → 12-frame sheet, generated + 8-creature fallback gallery share one path), `avatarId` threaded end-to-end through join → renderer (per-slot sheet via `ctx.drawImage`), join-time pick/upload UI, and a house-palette art pass for tiles/enemies/bubbles/fruit. 112 tests green; sim + replay fixtures untouched. Style prompt is versioned (`packages/avatar/src/style-prompt.ts`, currently **v2** — magenta chroma key, no glow). Local eyeball harness: `pnpm --filter @retro-recall/avatar gen <photos>` then `… compose` (writes `gen-out/`, git-ignored).

Outstanding to close Phase 3 (all human-run): Kevin's Gemini key + worker provisioning (R2 bucket `retro-recall-avatars`, KV `AVATAR_RATE` → paste id into `workers/avatar/wrangler.jsonc`, `wrangler secret put GEMINI_API_KEY --name retro-recall-avatar`), deploy, the photo-on-a-phone demo. Still carried from Phase 2: the production CNAME (`workers/rooms/scripts/setup-dns.sh`) and the two-phone playtest.

**Next: Phase 4a — Library** (ADR-009 Wave A, `docs/PHASE-4-KICKOFF.md`), in the `phase/library` worktree — Phase 3 avatars (this branch) was Wave A's other half. Then Wave B: three concurrent game worktrees (Puck Pals, Splash Squad, Ramp Riders — `games/*/BRIEF.md`).

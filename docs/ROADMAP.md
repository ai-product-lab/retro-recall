# Roadmap

Each phase ends with something playable (Principle 7). Durations are rough, assuming part-time direction with Claude doing the building.

## Phase 0 — Foundations ✅ (June 2026)

Principles, architecture, ADRs, branding. *This document set.*

## Phase 1 — First playable (~2–3 weeks)

Monorepo scaffold; RetroKit core (sim loop, tiles, AABB physics, sprites, input, seeded RNG, state hashing); Bubble Buddies sim per `SPEC.md` — one player, placeholder sprites, 5 levels: move, jump, blow bubbles, trap and pop enemies. Deployed to a Cloudflare Pages preview URL.
**Demo:** Kevin plays it in a browser and it feels like the real thing.

## Phase 2 — Online co-op (~2–3 weeks)

Durable Object room + WebSocket transport; server-authoritative sim with prediction/interpolation (ADR-003); room codes ("play with this link"); determinism CI tests; 2–4 players.
**Demo:** Kevin and a friend pop the same enemy from different houses.

## Phase 3 — Become the character (~2 weeks)

Avatar Worker: upload → Gemini image-to-image → palette quantize → composite onto body rigs → moderation → R2 cache (ADR-004). Fallback creature gallery. Original art pass replaces placeholders (house style per BRAND.md).
**Demo:** the kids upload photos and chase each other around level 3 as themselves.

## Phase 4 — The arcade & the field guide (~2–3 weeks)

Arcade site shell (Astro): home, game pages, how-it-works. Field Guide section with the first write-ups (this doc set, the determinism testing story, the avatar pipeline). `pnpm new-game` scaffolder proven by starting game #2.
**Demo:** retrorecall.com (or chosen domain) is live and shareable; a stranger could read how it was built.

## Phase 5 — The factory proves itself (ongoing)

Game #2 from a different design grammar (e.g., maze-chase or vertical climber) built primarily via spec + scaffold + skills, measuring how much faster it goes. Leaderboards (D1), replays as shareable links, seasonal level packs. Publish skills publicly.

## Later / parking lot

Versus modes (rollback netcode — the deterministic core keeps this open), gamepad support, mobile touch controls, level editor for the kids, sound/music toolchain, accounts (only if a feature truly needs them).

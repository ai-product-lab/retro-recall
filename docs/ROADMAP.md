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

## Phase 3 — Become the character (~2 weeks)

Avatar Worker: upload → Gemini image-to-image → palette quantize → composite onto body rigs → moderation → R2 cache (ADR-004). Fallback creature gallery. Original art pass replaces placeholders (house style per BRAND.md).
**Demo:** the kids upload photos and chase each other around level 3 as themselves.

## Phase 4 — The arcade & the field guide (~2–3 weeks)

Arcade site shell (Astro): home, game pages, how-it-works. Field Guide section with the first write-ups (this doc set, the determinism testing story, the avatar pipeline). `pnpm new-game` scaffolder proven by starting game #2.
**Demo:** retrorecall.com (or chosen domain) is live and shareable; a stranger could read how it was built.

## Phase 5 — The factory proves itself (ongoing)

Game #2 from a different design grammar (e.g., maze-chase or vertical climber) built primarily via spec + scaffold + skills, measuring how much faster it goes. Leaderboards (D1), replays as shareable links, seasonal level packs. Publish skills publicly.

## Later / parking lot

Versus modes (rollback netcode — the deterministic core keeps this open), embedded voice in private rooms via Cloudflare Realtime (ADR-008 Tier 2 — only if FaceTime-alongside proves clumsy), gamepad support, level editor for the kids, sound/music toolchain, accounts (only if a feature truly needs them).

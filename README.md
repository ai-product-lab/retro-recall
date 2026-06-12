# Retro Recall

A web arcade of original games inspired by NES classics, rebuilt for the modern web, playable online with friends and family — and a public documentation of how the whole thing is built with Claude and automation.

## The three products

1. **The Arcade** — a website hosting a growing set of browser games, each an original variant of a classic NES-era design, with real-time online multiplayer.
2. **The Factory** — the repeatable pipeline (shared engine, templates, CI/CD) that makes producing each new game variant fast and consistent.
3. **The Field Guide** — published skills, techniques, and devlogs documenting how to do this yourself with AI-assisted development.

## First game

**Bubble Buddies** — a co-op arcade platformer inspired by Bubble Bobble's design grammar (single-screen levels, trap enemies in bubbles, pop them together). Its signature feature: upload a photo and AI transforms you into an original cute pixel character that becomes your playable sprite.

## Key documents

| Doc | Purpose |
|---|---|
| `docs/PRINCIPLES.md` | The non-negotiables that guide every decision |
| `docs/ARCHITECTURE.md` | System design: engine, netcode, avatar pipeline, hosting |
| `docs/ROADMAP.md` | Phased plan from first playable to public arcade |
| `docs/decisions/` | Architecture Decision Records (ADRs) — the why behind each big choice |
| `branding/BRAND.md` | Name, identity, voice, palette |

## Status

**Phase 0 — Foundations.** Frameworks, principles, and branding established 2026-06-12. Next: scaffold the monorepo and build the Bubble Buddies prototype (local play, placeholder sprites).

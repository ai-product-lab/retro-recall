# ADR-005: IP stance — original expression, inspired mechanics

**Status:** Accepted · 2026-06-12

## Context

The whole premise is "variants of old NES games," published publicly with our names on it. Nintendo and Taito actively enforce their IP. We need a bright line that lets us build confidently.

## Decision

Game **mechanics and rules are not copyrightable** and are fair inspiration: single-screen co-op platforming, trapping enemies in projectiles, score chains, power-ups. Everything that is **expression is 100% original**: names, characters, sprites, animations, level art, music, sound effects, fonts, story, and marketing copy. Specifically:

- No ROMs, no emulation, no extracted or traced assets, ever.
- No protected names or characters anywhere — including in code identifiers, AI prompts, and the Field Guide's published prompts. (Internal docs may reference the inspiration by name, as this file does; shipped product and prompts may not.)
- AI generation prompts must steer *away* from existing characters ("an original creature, not resembling any existing video game character") and outputs get a resemblance check during review.
- Avoid trademark-adjacent naming (our Bubble Bobble-inspired game is **Bubble Buddies**, not "Bubble Bobble Online"). "Bubble" alone is generic; the combination must not imitate trade dress.
- Marketing/Field Guide language: "inspired by the classics" — never "play Bubble Bobble," never implying affiliation.

**Pre-release checklist per game:** asset provenance audit (every file has a stated origin), name/trademark search, side-by-side resemblance review of characters and level art, prompt audit.

## Why

This is the line the indie "spiritual successor" genre has operated on for decades. It also forces better creative output — our games should be *better for the web and for families* than the originals, not imitations.

## Consequences

Kevin should treat this as informed engineering judgment, not legal advice — worth a one-time consult with an IP lawyer before any public/commercial launch. Some nostalgic recognizability is deliberately sacrificed.

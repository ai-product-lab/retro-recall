# Principles

These are the non-negotiables. Every game, feature, and tooling decision gets checked against this list. When two principles conflict, the earlier one wins.

## 1. Original work, inspired mechanics

We never ship Nintendo, Taito, or any other company's assets, names, characters, music, or ROMs. Game *mechanics* and *design grammar* (single-screen platforming, bubble-trapping, score chains) are fair inspiration; *expression* (sprites, names, level art, sound) is always ours. Every game gets an IP review before public release (see ADR-005).

## 2. Family-first

Kids play these games. No chat with strangers, no public lobbies by default — play happens in private rooms joined by code or link. Uploaded photos are processed for avatar generation and then deleted; generated sprites are moderated before display. COPPA-conscious: no accounts required to play, minimal data collected.

## 3. The factory is the product

Each game must make the *next* game cheaper to build. Anything built twice gets extracted into the shared kit. A new game variant should eventually be: pick a design grammar, write a game spec, let automation scaffold it, then iterate on what's unique.

## 4. Deterministic core, replaceable shell

Game logic runs as a deterministic, fixed-timestep simulation with no rendering or network code inside it. This is what makes online multiplayer, replays, testing, and automation tractable. Rendering, input, and audio are thin layers around it.

## 5. Work in public

The journey is documented as it happens. Decisions get ADRs, techniques get write-ups, reusable prompts and skills get published. If a step can't be explained to a reader, it isn't done.

## 6. Free to play, cheap to run

Target steady-state cost near zero on free tiers (Cloudflare), with the only meaningful per-unit cost being AI avatar generation (~$0.01–0.04/image), which is rate-limited and cached.

## 7. Ship small, ship playable

Every phase ends with something a kid can play in a browser. No phase is "infrastructure only."

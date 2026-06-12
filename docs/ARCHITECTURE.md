# Architecture

One platform (Cloudflare), one language (TypeScript), one monorepo. Full rationale for each choice lives in `docs/decisions/`.

## System overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │ Arcade site│  │ Game client   │  │ Avatar uploader│  │
│  │ (Astro)    │  │ (RetroKit +   │  │                │  │
│  │            │  │  game module) │  │                │  │
│  └────────────┘  └──────┬────────┘  └───────┬────────┘  │
└─────────────────────────┼───────────────────┼───────────┘
                WebSocket │              HTTPS│
┌─────────────────────────┼───────────────────┼───────────┐
│  Cloudflare             ▼                   ▼           │
│  ┌──────────────────────────┐  ┌─────────────────────┐  │
│  │ Game Room                │  │ Avatar Worker       │  │
│  │ (Durable Object, 1/room) │  │ → image-gen API     │  │
│  │ authoritative simulation │  │ → moderation        │  │
│  └──────────────────────────┘  │ → R2 (sprite cache) │  │
│  Pages (static site + clients) └─────────────────────┘  │
│  KV (room codes) · R2 (sprites) · D1 (scores, later)    │
└─────────────────────────────────────────────────────────┘
```

## The monorepo

```
retro-recall/
├── packages/
│   ├── retrokit/        # Shared engine: deterministic sim loop, physics,
│   │                    #   sprites, input, audio, room-client netcode
│   ├── netcode/         # Shared DO room logic + client transport
│   └── avatar/          # Avatar pipeline client + worker
├── games/
│   └── bubble-buddies/  # Game spec, deterministic sim, renderer, assets
├── site/                # Arcade shell: game pages, lobby UI, field guide
├── workers/             # Cloudflare Workers (rooms, avatar, api)
├── tools/               # Game scaffolder, asset pipeline, automation scripts
└── docs/                # This documentation + field guide source
```

## Core decisions (summaries — see ADRs)

**Hosting: Cloudflare end-to-end** (ADR-001). Pages serves the site and game clients; one Durable Object instance per game room gives us a single-threaded authoritative server with WebSocket hibernation; KV/R2/D1 for storage. Free tier covers ~3M requests/month — effectively free at friends-and-family scale.

**Engine: RetroKit, our own small TypeScript kit on Canvas 2D** (ADR-002). NES-era games need tiles, sprites, and simple physics — not a general engine. Owning the kit keeps the simulation deterministic (integer math, fixed 60Hz tick, seeded RNG), which netcode and automated testing depend on, and the kit itself becomes Field Guide content.

**Netcode: server-authoritative simulation in the Durable Object** (ADR-003). Clients send inputs; the room runs the same deterministic sim at a fixed tick and broadcasts compact state; clients predict locally and interpolate remote players. Co-op arcade pace is forgiving of 50–150ms latency. No rollback complexity in v1.

**Avatars: AI head, template body** (ADR-004). The photo goes to an image-to-image model (Gemini image editing; GPT Image as fallback) with a fixed style prompt that produces an original chibi pixel character head/face. We composite it onto pre-animated shared body rigs (walk, jump, blow-bubble frames) so animation is always consistent and cheap. Moderation gate, then cached in R2. Photos deleted after generation.

**IP stance: original expression, inspired mechanics** (ADR-005). Pre-release checklist per game.

**Automation: the game factory** (ADR-006). `tools/scaffold` generates a new game from a template; GitHub Actions runs determinism tests (replay same inputs → same state hash), builds, and deploys to Cloudflare on merge. Claude Code/Cowork skills for "new game variant," "new level," and "publish devlog" get extracted as they prove out.

## Cross-cutting rules

Game simulations never import from renderer, network, or DOM — enforced by lint rule. All randomness flows from a seeded RNG owned by the sim. State must serialize to a stable hash (this is both the netcode sync check and the regression test). Assets are original, committed with provenance notes.

# Load / capacity test

The "will we stay on the Free tier?" gate. Drives realistic game sessions at the
rooms Worker, measures the per-session cost in the two things that count against
the Cloudflare **Free** caps, and projects to sessions/day.

```bash
pnpm loadtest                                   # auto-spawns `wrangler dev`, 10×2p
pnpm loadtest -- --sessions 8 --players 4       # bigger sessions (keep < 20 to stay
                                                #   under the CREATE_RATE limiter)
pnpm loadtest -- --url https://retro-recall.ruralrooted.com   # measure a live deploy
```

## What it counts (and why only these)

- **Worker invocations** — one per top-level request: `POST /api/rooms` (create),
  `GET /api/rooms/:code` (invite lookup), and **each WebSocket upgrade**. WS
  *messages* are handled by the Durable Object and do **not** re-invoke the
  Worker, so a longer match is free in invocation terms. Free cap: **100k/day**.
- **KV writes** — one per room **created**. Lookups refresh the room-code TTL but
  are throttled (`workers/rooms/src/index.ts`) to ~0 writes. Free cap: **1k/day**.

Per-session cost is deterministic, so a small sample projects accurately — and
keeping the sample under ~20 avoids tripping the Worker's own `CREATE_RATE`.

## What we learned (2026-06-13)

A 2-player session costs **4 invocations + 1 KV write**. Headroom on Free:
**~25,000 sessions/day** before the invocation cap, but only **~1,000/day**
before the KV-write cap — so **new-rooms-per-day is the binding Free constraint**,
not invocations. And the day's ~100k-invocation burn equals ~25,000 sessions —
far beyond real traffic, i.e. **external probing, not gameplay**.

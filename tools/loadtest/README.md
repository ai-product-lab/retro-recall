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

## ⚠️ Known flaw — this tool under-counts (fix before trusting it)

This counts only **fetch** invocations (create + room-info + WS *upgrade*) and
assumes WS *messages* are free. **They are not** — each inbound WebSocket message
to `GameRoomDO` is a billed request, and the client streams one input message per
tick (60 Hz). So the real cost of a ~25 s 2-player race is **~3,000 requests, not
4**, and the true Free ceiling is **~30 sessions/day, not ~25,000**. The
2026-06-13 burn was **self-inflicted 60 Hz input streaming**, not external
probing. See `docs/HANDOFF-ws-input-burn.md`. This tool must be reworked to drive
a session for N seconds and count messages = rate × duration before its
projections mean anything.

# Load / capacity test

The "will we stay on the Free tier?" gate. Drives realistic game sessions at the
rooms Worker, measures the per-session cost in everything that counts against the
Cloudflare **Free** caps, and projects to sessions/day.

```bash
pnpm loadtest                                   # auto-spawns `wrangler dev`, 10×2p×30s
pnpm loadtest -- --sessions 8 --players 4 --seconds 60
pnpm loadtest -- --changes-per-sec 8            # busier pads (worst-case active play)
pnpm loadtest -- --url https://retro-recall.ruralrooted.com   # measure a live deploy
```

Keep `--sessions` under ~20 to avoid tripping the Worker's own `CREATE_RATE`
limiter (one create per session).

## What it counts (and why)

- **Worker invocations** — one per top-level fetch: `POST /api/rooms` (create),
  `GET /api/rooms/:code` (invite lookup), and **each WebSocket upgrade**.
- **Inbound WebSocket messages** — each inbound message to the hibernating
  `GameRoomDO` is its own billed request. This is the dominant cost and the one
  the 2026-06-13 burn came from. To count it honestly the tool replays the real
  client cadence from `packages/netcode/src/client/room-client.ts`: input sent
  **only on pad change**, plus a keepalive every `INPUT_KEEPALIVE_TICKS` and a
  ping every `PING_EVERY_TICKS`. It feeds each player a seeded lively input
  stream for the modeled session, sends it for real, and counts it. (The send
  loop runs fast — message *count* is what bills, not wall-clock pacing.)
- **KV writes** — one per room **created**. Lookups refresh the room-code TTL but
  are throttled (`workers/rooms/src/index.ts`) to ~0 writes. Free cap: **1k/day**.

All three are projected against the Free ceilings (100k requests/day, 1k KV
writes/day), and the report shows the binding constraint plus a before/after
comparison against the old 60 Hz-streaming cost.

## History

Before 2026-06-13 this tool counted **only** fetch invocations and assumed WS
messages were free — under-counting a session ~750× and hiding the real burn
(self-inflicted 60 Hz input streaming, not external probing). The netcode fix
(send-on-change input + server-side held input + DO idle-reap) and this rework
landed together; see `docs/HANDOFF-ws-input-burn.md` and the devlog.

# Handoff: the WebSocket input-streaming burn (the real Free-tier blocker)

**Created 2026-06-13** at the close of the delivery-pipeline session. Start the
next session here.

> **RESOLVED 2026-06-13** (next session). Fixes (1) send-on-change + held input
> and (3) DO idle-reap shipped, engine-first per ADR-009, determinism-validated
> (replay fixtures untouched + green, two-client gate zero desyncs). See the
> devlog entry "Killing the real burn: send-on-change input." Fix (2) Page
> Visibility pause was **not needed** — the DO idle-reap (30 s) covers the
> backgrounded/forgotten-tab case server-side without touching the game shells.
> `tools/loadtest/` was **reworked** to count inbound WS messages (it now
> replays the real send-on-change cadence): a 2p×30s active session measures
> **~342 requests** (was mis-counted as 4), ~11× cheaper than the old 60 Hz
> stream, ~292 active sessions/day of Free headroom, forgotten tab capped at
> ~90 requests by the reaper.
> **Only open item:** re-pull Cloudflare observability after a real 2-phone
> session (post quota reset, ~00:00 UTC 2026-06-14) to confirm the live rate.

## TL;DR

The 2026-06-13 Workers Free-tier exhaustion (`429 / error 1027`) was **not
external probing** (an earlier wrong verdict in this session). It was
**self-inflicted**: the game client sends an `input` WebSocket message **every
tick (60 Hz), unconditionally**, and **each inbound WS message to the
`GameRoomDO` is billed as a request**. Two players × 60 Hz ≈ 120 req/s; one
long-lived/idle session for ~3 h = **~800k requests** → blew the 100k/day cap.

The fix is in the **netcode** (engine), not the HTTP layer. The guardrails
shipped this session (rate limits, `workers_dev:false`, KV throttle) are good
hygiene but **do not touch this** — they act on new HTTP requests, not messages
on an established socket.

## Evidence (Cloudflare observability, worker `retro-recall-rooms`)

Query: count by `$metadata.trigger`, 2026-06-13 00:00–24:00Z → one group
dominates: ~**799,450** events, all between **01:00–04:00 UTC**, then nothing.
Sampling those events:
- `eventType: "websocket"`, `origin: "websocket"`, `message: "websocket:message"`
- `entrypoint: "GameRoomDO"`, `executionModel: "durableObject"`
- **each message has its own `requestId`** (→ each is counted as a request)
- timestamps ~5–11 ms apart → ~120/s (two players at 60 Hz)
- one room (`FGAH`) with 27 WS upgrades (a flaky/long session that kept resuming)

To re-run: observability MCP, `query_worker_observability`, `view:"calculations"`,
filter `$metadata.service eq retro-recall-rooms`, group by `$metadata.trigger`.

## Root cause in code

`packages/netcode/src/client/room-client.ts:139-157` — the per-tick loop sends an
`input` message every tick whenever `!spectator`, regardless of whether `bits`
changed. The `prev:[t-1,t-2,t-3]` field is packet-loss redundancy that is
**unnecessary on WebSocket** (reliable + ordered/TCP).

Compounding: the DO uses **WebSocket Hibernation** (`packages/netcode/src/room/core.ts:41`,
`:109`). With hibernation, *each* inbound message wakes the DO and bills as a
request — so 60 Hz streaming = a per-request explosion. (Without hibernation the
DO stays resident and bills *duration* instead — a different trade-off.)

## Corrected capacity model (the load test was wrong)

`tools/loadtest/` counted only the ~4 **fetch** invocations/session and assumed
"WS messages ride the DO for free." They are **not** free — each is a billed
request. Real cost is dominated by the message stream:

| | load test claimed | actual |
|---|---|---|
| ~25 s 2-player race | 4 requests | **~3,000 requests** (120/s × 25 s) |
| Free ceiling (100k/day) | ~25,000 sessions/day | **~30 sessions/day** |
| one idle tab left open | not modeled | **~5–10M/day** — caps in ~15 min |

The load test must be reworked to count inbound WS messages (drive a session for
N seconds, multiply rate × duration) before its projections mean anything.

## The fix (design — for the next session)

Engine change on the determinism-sensitive input path. Per **ADR-009**: lands on
`main` with replay-fixture validation **before** games consume it; game worktrees
are additive-only.

1. **Send input only on change** (the big win). Client tracks last-sent `bits`;
   send only when it changes, plus a low-rate keepalive (e.g. every ~30 ticks).
   Requires the server to **hold the last input** for gap ticks — verify
   `core.ts bufferInput`/sim already persists last input across ticks with no new
   message (rollback netcode usually does). Drop the `prev[]` redundancy.
   **Replay fixtures encode per-tick inputs → they will need regenerating/format
   update.** This is the determinism-sensitive part — validate hashes.
2. **Pause sending when the tab is hidden** (Page Visibility API) — kills the
   forgotten-tab case directly. Wire `document.hidden` → suppress sends (and
   ideally the client sim loop) in each game's `play.ts` / room-client. Low risk,
   high impact; could ship first as immediate mitigation.
3. **DO-side idle disconnect + empty-room alarm cancel** — defense in depth:
   close a connection with no input change for N s; when no connections remain,
   cancel the auto-tick alarm and let the room expire.

Decision to make: with (1) cutting message rate to near-zero idle and a few/s
active, **hibernation becomes fine and Free is viable again**. If (1) is deferred,
reconsider hibernation vs a resident DO (duration billing).

## Current state at handoff

- **Branch `chore/delivery-pipeline` / PR #8** (CI green): build-site script,
  free-tier guardrails, load test (flawed — see above), ADR-011 (consolidation,
  deferred), CI build gate + CD (prod deploy + PR preview). **Not yet merged.**
- **Deployed live now** (via Kevin's wrangler login): the guardrails Worker
  (`retro-recall-rooms`) — rate limits + `workers_dev:false` + KV throttle. These
  do **not** fix the burn.
- **Free quota** resets ~00:00 UTC 2026-06-14; until then the live Worker 429s.
- GitHub Actions secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are set.
- Observability MCP is authorized (re-auth if a new session needs it).

## First moves next session

1. Read this doc + `room-client.ts:139-157` + `core.ts` input/hibernation paths.
2. Decide ship order — likely (2) visibility-pause as immediate mitigation, then
   (1) send-on-change with replay-fixture validation, then (3) DO idle cleanup.
3. Plan it (ADR-009 engine-first), implement on `main` (or a fresh branch),
   regenerate replay fixtures, verify hashes.
4. Rework `tools/loadtest/` to measure WS message cost and re-confirm the Free
   ceiling. Re-pull observability after a real 2-phone session to validate.

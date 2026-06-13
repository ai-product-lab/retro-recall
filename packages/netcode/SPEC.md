# Netcode & Rooms — Spec (v1, Phase 2)

Implements ADR-003 (server-authoritative + prediction) on ADR-001's platform
(one Durable Object per room). The game sim knows nothing in this file.

## Topology

- **Room** = one Durable Object instance, addressed by room code. Runs the
  authoritative sim at 60 Hz (`alarm()`-driven or hibernation-aware ticking),
  accepts WebSockets via the hibernation API.
- **Room codes:** 4 letters from an unambiguous A–Z subset (no I/O/Q), e.g.
  `BLOB` → `wss://…/room/BLOB`. Created via `POST /api/rooms` (returns code +
  shareable URL `https://<site>/play/bubble-buddies?room=BLOB`). KV maps code
  → DO id; codes expire 24 h after last activity.
- **Capacity:** 4 players + up to 4 spectators (joiners waiting for next
  level). Slot assignment: lowest free slot.

## Message protocol (JSON v1; binary later only if measured necessary)

Client → server: `join {roomCode, playerName, avatarId?, rejoinToken?}` ·
`input {tick, bitmask}` (sent every client tick, redundantly including the
last 3 ticks' bitmasks to ride over loss) · `emote {kind}` · `ping {t}`.

Server → client: `welcome {slot, rejoinToken, snapshot, tick}` ·
`snapshot {tick, state}` (full, sent at `SNAPSHOT_EVERY` = 3 ticks = 20 Hz) ·
`peerMeta {slots: names/avatars/connection states}` · `emote {slot, kind}` ·
`hashcheck {tick, hash}` (every 600 ticks) · `pong {t}` · `levelEvent {kind}`
(clear/gameover/win, for UI sugar only — sim state is the truth).

## Authority, prediction, reconciliation

- Server applies each player's input at `max(receivedTick, serverTick)`;
  late inputs are applied at the current tick, never rewound (co-op forgives).
- Client predicts only its own player entity; remote entities render
  interpolated between the last two snapshots (~50 ms display delay).
- On snapshot: client rebases — restores server state, replays its own
  buffered inputs since `snapshot.tick`. Visual smoothing caps correction at
  2 px/frame unless divergence > 16 px (then snap).
- Desync detection: client compares `hashcheck.hash` against its rebased
  state; on mismatch it requests a full snapshot and logs the tick (these
  logs are gold — file them as determinism bugs).

## Join / rejoin / disconnect

- **Join:** anyone with the link/code, while slots or spectator seats remain.
  Active from the next level load (sim §11 rule).
- **Rejoin:** `rejoinToken` (random 128-bit, held by client in memory/URL)
  reclaims the same slot + score within `REJOIN_WINDOW_S` = 600 s of
  disconnect. The DO keeps the slot reserved that long.
- **Disconnect:** missing inputs ⇒ sim's `DISCONNECT_GRACE_TICKS` handles
  despawn; the room marks the slot reserved and tells peers via `peerMeta`.
- **Empty room:** hibernate; destroy state after code expiry.

## Emotes & pings (ADR-008 Tier 1)

`kind` ∈ {`help`, `over_here`, `nice`, `uh_oh`, `laugh`, `heart`} — fixed
enum, no free text ever. Rendered as a speech bubble over the sender's
character for 120 ticks. Rate limit: 1 per 30 ticks per player, enforced
server-side. (Tap-to-ping a map location: parked until a game needs it.)

## Join surfaces (site scope, but contract lives here)

Two equal paths, because iOS PWAs can't capture links (links always open
Safari, never the pinned app):

- **Link** (`/play/bubble-buddies?room=CODE`) — the first-timer path: who's
  in the room, Join button, **in-app-browser detector** (Messenger/Instagram/
  WhatsApp WebViews) with one-tap "Open in Safari" escape. The call
  suggestion is a single muted footnote line ("tip: hop on a call together"),
  not a step.
- **Code entry** — the regulars' path: the app home screen (especially when
  running installed/standalone) leads with a big 4-letter code input, so
  pinned-app users type `BLOB` instead of tapping links. Codes are read-aloud
  friendly by design (no I/O/Q).

## Testing

- Protocol unit tests with a fake clock; DO integration tests via
  `wrangler dev`/miniflare.
- **Two-headless-clients test:** drive two sim+netcode clients through a
  scripted session (join, play, one disconnects, rejoins) asserting final
  state hashes match the server.
- Latency harness: artificial 50–200 ms delay + 5% loss on the client
  transport in dev mode (`?lag=150`), used for feel-tuning prediction.

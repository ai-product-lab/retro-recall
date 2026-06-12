# ADR-008: Talking while playing — borrow first, embed voice later, never build chat

**Status:** Accepted · 2026-06-12

## Context

Playing with family means talking while playing. Question: build comms, or lean on existing tools? Constraints: kids (Principle 2 — no contact with strangers, minimal moderation surface), iPhone PWA (ADR-007), near-zero cost (Principle 6).

## Decision

Three tiers, adopted in order:

**Tier 0 — borrow (now, zero build):** players call each other on whatever they already use — FaceTime, Facebook Messenger, WhatsApp, Discord, a phone call — and play. iOS keeps call audio running while Safari/the pinned PWA is foregrounded, so this is app-agnostic. The room-link invite page says exactly this: "Start a call, then everyone taps this link." **In-app browser caveat:** links tapped inside Messenger/WhatsApp/Instagram chats open in their embedded WebView, which is unreliable for games and can't Add to Home Screen — the invite page must detect in-app browsers and show a one-tap "Open in Safari" nudge (Phase 2 scope).

**Tier 1 — in-game signals (Phase 2, tiny build):** pings and emotes — tap a spot to flash a marker, a small wheel of preset expressions ("Help!", "Over here!", "😄", "GG"). Travels over the existing game WebSocket as just another input. Zero moderation surface, works for non-readers, COPPA-clean.

**Tier 2 — embedded voice in private rooms (Phase 4+, if Tier 0 friction proves real):** WebRTC voice via **Cloudflare Realtime SFU/TURN** — same platform as everything else, free tier is 1,000 GB egress (4-player Opus voice ≈ ~12 MB/hour/listener; family scale rounds to $0). Voice only, private rooms only, off by default with a parent-visible toggle. Their RealtimeKit SDK can shortcut the client side.

**Never build:** free-text chat (moderation burden, unsafe-by-default for kids, and everyone already has iMessage), and anything enabling contact with strangers.

## Why Twitch/streaming is a different answer

Twitch/YouTube Live are one-to-many *broadcast* with 2–10s latency — wrong shape for playing together. Streaming becomes relevant later only as a Field Guide channel (streaming the *building* of the games), not as player comms.

## Why

Tier 0 costs nothing and is how families already behave; building voice before validating that friction exists violates "factory is the product" priorities. When we do embed voice, staying on Cloudflare keeps one platform, one bill, one mental model (ADR-001). Pings/emotes are the highest fun-per-line-of-code comms feature in co-op games.

## Consequences

Phase 2 scope gains the ping/emote wheel. The invite flow treats "get on FaceTime" as a first-class instruction, not an apology. Revisit Tier 2 only with evidence (kids juggling FaceTime + game complain).

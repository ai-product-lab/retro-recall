# ADR-001: Host everything on Cloudflare

**Status:** Accepted · 2026-06-12

## Context

We need static hosting for the arcade site and game clients, plus a low-latency stateful server for real-time multiplayer rooms, plus object storage for generated sprites — at near-zero cost for friends-and-family scale, and deployable entirely from CI.

## Decision

Cloudflare end-to-end: **Pages** (site + clients), **Workers + Durable Objects** (one DO per game room, WebSocket server with hibernation), **KV** (room codes), **R2** (sprite cache), **D1** (scores/persistence, later).

## Why

A Durable Object is exactly the shape of a game room: a single-threaded, addressable object with in-memory state and WebSocket support — no fleet to manage, rooms spin up on demand and hibernate when idle. The free tier (~3M DO requests/month, ~390K GB-s compute) comfortably covers our scale, and WebSocket hibernation keeps idle rooms free. One platform means one deploy pipeline and one mental model — which matters because the factory (ADR-006) automates deployment.

## Alternatives considered

**Vercel + Fly.io game server:** two platforms, real monthly cost for an always-on server, more ops. **Self-hosted VPS:** full control but ongoing patching/ops burden that fights the automation goal. **P2P (WebRTC):** no server cost but NAT traversal pain and a host-migration problem when the host's kid closes the laptop.

## Consequences

We accept Cloudflare lock-in for the room layer (DO APIs are proprietary). Sim logic stays platform-agnostic (ADR-002/003) so only the thin room wrapper would need porting. DO single-threadedness caps a room's tick budget — fine for 2–4 player NES-scale sims.

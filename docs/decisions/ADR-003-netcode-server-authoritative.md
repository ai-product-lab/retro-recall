# ADR-003: Server-authoritative netcode with client prediction

**Status:** Accepted · 2026-06-12

## Context

First milestone is real-time online co-op for 2–4 players (Kevin's friends/family — typical latency 20–80ms, occasionally worse). The genre is cooperative single-screen arcade: forgiving of small latency, intolerant of desync (a bubble must pop for everyone or no one).

## Decision

The Durable Object room runs the **authoritative simulation** at a fixed tick (sim 60Hz, network snapshots ~20Hz). Clients send timestamped inputs only. Each client runs the same deterministic sim for **local prediction** of its own character and **interpolates** remote entities between snapshots. Server state always wins; mispredictions reconcile by replaying buffered local inputs on top of the corrected state. Periodic state-hash exchange detects desync (then force-snapshot).

## Why

Server-authoritative is the simplest model that guarantees consistency — there's one truth, in one single-threaded place, which is exactly what a DO gives us. Prediction keeps your own jumps feeling instant; interpolation makes friends look smooth. Co-op also removes any cheating pressure, so we don't need competitive-grade anti-lag tricks.

## Alternatives considered

**Deterministic lockstep:** minimal bandwidth, but everyone stalls on the slowest connection — bad with a kid on hotel wifi. **Full rollback (GGPO-style):** best feel, but significant complexity and CPU; overkill for co-op. Our deterministic core (ADR-002) keeps this door open for a future versus game. **Naive state-broadcast without prediction:** simplest, but input latency = RTT, which feels mushy even at 60ms.

## Consequences

Sim must be cheap enough to run twice (client + server) — trivial at NES scale. Snapshot format needs care (compact, delta-friendly). Room joins mid-game get a full snapshot. The same input-log machinery doubles as the replay system for testing and devlogs.

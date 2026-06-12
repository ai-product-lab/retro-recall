# ADR-002: Build RetroKit, a small in-house engine, instead of adopting Phaser

**Status:** Accepted · 2026-06-12

## Context

Every game in the arcade needs tilemaps, sprites, fixed-timestep simulation, simple AABB physics, input, and audio. The engine choice constrains netcode (ADR-003), testing, and the factory model (ADR-006).

## Decision

Build **RetroKit**: a small TypeScript kit rendering to Canvas 2D, with a strictly separated deterministic simulation core — fixed 60Hz tick, integer/fixed-point math, seeded RNG, serializable state with stable hashing. Games are modules that implement a `GameSim` interface; RetroKit provides the loop, renderer, input, audio, and netcode client around it.

## Why

NES-era games are technically tiny; a general engine is mostly dead weight. The decisive factor is **determinism**: server-authoritative netcode, replay-based regression tests, and AI-driven development (run 1,000 simulated games headless in CI) all require same-inputs → same-state. Off-the-shelf engines mix float physics, render-coupled timing, and global state that fight this. Owning ~2–3k lines of kit also means every game shares one idiom — which is what makes "Claude, scaffold a new variant" reliable — and the kit itself is prime Field Guide material.

## Alternatives considered

**Phaser 3:** fastest to first demo, huge community — but its arcade physics isn't deterministic, and netcode would mean fighting the framework. **Excalibur/Kaplay:** same determinism problem, smaller communities. **Rust/WASM core:** maximal determinism, but a second language raises the automation and contribution bar.

## Consequences

We pay an upfront cost (~the first month) building the kit before the first game feels fast. We mitigate by building RetroKit *as* Bubble Buddies needs it — no speculative features. Headless sim must run in both browser and Workers runtime (no DOM imports — lint-enforced).

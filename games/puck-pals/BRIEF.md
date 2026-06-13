# Puck Pals — Game Brief (pre-spec)

**Design grammar:** NES-era arcade hockey (inspiration: Blades of Steel —
internal reference only, per ADR-005). **Mode:** versus is the point — family
rivalry. 1v1 to 2v2 online; empty skater slots filled by **CPU** players
(always labeled "CPU" in HUD/rosters — retro convention, Kevin's call).

## Core loop

Face-off → skate, pass, steal → slapshot on goal → goal horn, center-ice
reset → periods with a clock → handshake screen. No fighting: body checks
send players comically sliding (lost puck, brief tumble animation, no
penalties in v1).

## Twist vs. the source

Tighter rink, 3 skaters + goalie per side, exaggerated ice physics (long
slides, banked passes off boards), and a charged "super slap" with a
satisfying wind-up tell so kids can dodge it.

## Engine needs (Stage 1 audit)

- Vertical-scrolling camera over a rink ~1.5 screens tall (shared: camera)
- Sliding/friction physics — velocity decay on ice, distinct from platformer
  gravity (likely game-local; physics core already integer-velocity based)
- Possession model (puck sticks to carrier with steal rules) — game-local
- CPU skater AI (chase/position/pass heuristics, seeded-RNG deterministic) —
  game-local, but establishes the house pattern for CPU players

## Netcode notes

Server-authoritative fits (ADR-003). Versus means mispredictions matter more
than co-op; puck is the contended entity — always server-owned, never
client-predicted. 2–4 humans, CPU fills the rest. Disconnect: CPU takes over
the slot (rejoin reclaims it) — better fit for versus than vanish.

## Open for SPEC

Period length, goalie control (auto vs. manual on defense), super-slap
charge values, board-bounce angles, overtime rule, rink tile set.

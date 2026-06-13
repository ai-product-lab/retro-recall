# Ramp Riders — Game Brief (pre-spec)

**Design grammar:** side-scrolling motocross-style racing (inspiration:
Excite Bike — internal reference only, per ADR-005), reskinned as **backyard
BMX**: dirt ramps, mud puddles, sprinklers, garden-hose jumps. **Mode:** 1–4
online race; lanes mean riders pass through each other (no collision
griefing between family members — deliberate).

## Core loop

3-2-1-GO → pump for speed, pre-jump and lean in air, land clean to keep
momentum, dodge mud/sprinklers, lane-switch around obstacles → finish-line
photo + results. Short races (45–90 s) so "one more!" always wins.

## Twist vs. the source

Boost = "legs" meter that drains on mash and recovers on clean landings
(replaces engine-overheat with something kids feel instantly). Wipeouts are
fast-recovery comic tumbles. **Track editor is the headline later phase**:
kids build tracks, family races them (tracks as shareable seeds/links).

## Engine needs (Stage 1 audit)

- Horizontal camera, long levels (~20 screens) (shared: camera, big maps)
- **Slope tiles** — ramps need slope collision + landing-angle physics in
  the core integer physics (shared: the one real physics-core change; lands
  on main in Stage 1)
- Per-client camera following own rider (shell concern — renderer already
  client-side; HUD shows rival positions when off-screen)
- Ghost rendering of remote riders (interpolation already exists; just a
  render style)

## Netcode notes

Racing is the most latency-tolerant mode here: riders don't collide, so each
client predicts its own rider and renders rivals interpolated — divergence
is invisible. Server adjudicates finish order from authoritative sim.
Disconnect mid-race: rider coasts to a stop (no CPU takeover).

## Open for SPEC

Pump/boost/landing values, slope angle set (suggest 22.5°/45°), obstacle
table, lane count (suggest 3), v1 track count (suggest 5 + the editor
parked), rubber-band assist for the youngest rider (suggest optional "junior
boost" toggle per room).

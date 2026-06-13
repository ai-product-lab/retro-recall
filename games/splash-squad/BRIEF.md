# Splash Squad — Game Brief (pre-spec)

**Design grammar:** side-scrolling co-op run-and-gun (inspiration: Contra —
internal reference only, per ADR-005), reframed family-friendly: **water
blasters vs. wind-up robots** in backyard/jungle playsets. **Mode:** 1–4
co-op, buddy-revive rules carried over from Bubble Buddies SPEC §11.

## Core loop

Run right, soak splat-bots before they tag you, grab nozzle power-ups
(spread, stream, burst), reach the end-of-level boss-bot, douse its boiler.
Tagged = soaked yourself → rescue bubble (revive convention shared with
Bubble Buddies — house mechanic across co-op games).

## Twist vs. the source

Zero violence: robots wind down with comic sputters when soaked; "ammo" is a
water tank refilled at spigots (light resource rhythm instead of lives
pressure). Co-op crossfire is encouraged — streams combine into a bigger
splash (chain-pop spirit).

## Engine needs (Stage 1 audit)

- Horizontal-scrolling camera, levels ~8 screens wide (shared: camera, big
  maps)
- Camera-triggered spawn regions (enemies activate as the screen reaches
  them) (shared: spawn regions)
- Many simultaneous projectiles — droplet entities; perf check in sim
  benchmarks (engine perf budget, not a feature)
- Scrolling lock-and-advance at boss arenas — likely camera feature flag
  (shared if cheap)

## Netcode notes

Pure co-op = most forgiving profile; identical to Bubble Buddies transport.
Camera follows the leading player with a rubber-band keeping everyone on
screen (classic co-op tension — spec decides pull-along vs. hold-back rule).

## Open for SPEC

Nozzle power-up table, tank capacity/refill values, robot bestiary (3 types
+ boss per zone), level count for v1 (suggest 3 zones × 2 levels), the
pull-along camera rule, music-free sound design v1.

# ADR-007: Mobile-first as a PWA (iPhone is the target device)

**Status:** Accepted · 2026-06-12 (pivot after Phase 1)

## Context

Original framing assumed desktop browser + keyboard. The real audience — Kevin's kids, friends, family — reaches for phones first. Target: iPhone, with the game pinned to the home screen like an app.

## Decision

The arcade is a **PWA**: web app manifest, service worker for offline shell + asset caching, `display: standalone`, installed via Safari's "Add to Home Screen." No App Store, no native wrapper. Games are designed **portrait-first** with touch as the primary input; keyboard and gamepad remain supported (desktop becomes the secondary platform, and is still the dev loop).

Concretely:

- **Playfield is always 4:3,** matching the existing 32×24 grid — levels and replay fixtures are orientation-independent and never change for layout reasons.
- **Landscape = NES layout:** the 4:3 playfield centered and scaled to full height; the natural pillarbox bars become the controller — d-pad zone in the left bar, A/B buttons in the right bar, exactly where thumbs rest holding a phone sideways.
- **Portrait = Game Boy layout:** playfield at top scaled to full width, controller area below it — d-pad left, A/B right, like the handheld every parent remembers. Score in the safe-area top.
- **Touch layer:** both layouts map zones to the same NES-style input bitmask the sim already consumes. The sim doesn't know or care; determinism untouched. Controls respond to `safe-area-inset-*` and `visualViewport`; scroll/zoom/double-tap gestures are suppressed in-game. Buttons sized ≥ 48px with generous hit slop; d-pad supports slide-between-directions without lifting.
- **Orientation:** both supported, switch live on rotate. Landscape is the "big screen" way to play; portrait the one-handed-hold default.
- **iOS realities we design around:** audio starts only after a user gesture (tap-to-start screen doubles as audio unlock); install is a Safari share-sheet flow (we ship a friendly "pin me" instruction screen, since iOS shows no install prompt); WebSockets and canvas at 60fps are fine; push notifications possible for installed PWAs if ever needed.

## Why

A pinned PWA is indistinguishable from an app for this audience, ships instantly through our existing Cloudflare Pages pipeline, and keeps the zero-cost, no-gatekeeper principle. The deterministic core makes the pivot cheap: input is already an abstract bitmask and rendering already a thin shell — this is a shell-layer change, which is exactly what ADR-002 was for.

## Alternatives considered

**Native app / Capacitor wrapper:** App Store review, $99/yr, slower iteration, and unnecessary — we need canvas, touch, and WebSockets, all of which Safari provides. **Portrait-native level grids (~20×28):** would maximize portrait playfield size, but forks every level into two layouts (or abandons 4:3), breaks replay fixtures, and loses the NES-proportioned look. The Game Boy portrait arrangement keeps one truth. Accepted cost: the portrait playfield is width-constrained (~390×293pt on a typical iPhone) — small but authentic; landscape is there when they want it big.

## Consequences

Phase 1.5 (mobile pass) is inserted before online co-op; it is shell-layer only — zero sim or spec changes. Every future game keeps a 4:3 grid and declares its touch mapping in its spec. Playtesting now requires a phone in the loop (Pages preview URLs make this easy). Avatar upload gets *easier* on mobile (camera access from the file input).

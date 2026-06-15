# ADR-012: Landscape-only 16:9 with an analog-feel stick and overlaid fading controls

**Status:** Accepted · 2026-06-14 · **supersedes the layout half of [ADR-007]**

## Context

ADR-007 made the arcade mobile-first and **dual-orientation**: portrait *and*
landscape, a fixed 4:3 (256×192) playfield rendered at an integer scale and
**pillarboxed**, with touch controls (a cross d-pad + A/B) living in *reserved*
layout bands (a side bar in landscape, a band below the playfield in portrait).

Playtesting that paradigm, Kevin wants the games to feel like a handheld console
held sideways:

- **Landscape only.** Portrait is dropped.
- **An analog-feel stick** (like Puck Pals' round skate pad, or an N64 / PS1
  stick) as the universal movement control — a circle you hold and slide
  continuously, with a knob that follows the thumb — replacing the cross d-pad.
- **At most 2–3 buttons** (NES A/B, Genesis A/B/C) on the right.
- **True 16:9** — the playfield expands to fill the landscape screen.
- **Overlaid, fading controls** — the stick and buttons sit *on top* of a
  full-bleed game and fade to near-transparent when idle, so the whole map is
  visible; they snap back to full opacity the instant a thumb lands.

## Decision

1. **Landscape-only.** A `requireLandscape()` rotate-to-play gate covers portrait
   on every game screen; `lockLandscapeOnGesture()` additionally pins orientation
   via Fullscreen + Screen Orientation lock where the platform allows (Android
   Chrome, installed PWA). True locking is impossible in a mobile Safari tab, so
   the gate is the universal fallback, not the lock.
2. **Stick is visually analog, digitally 8-way.** The knob follows the finger,
   but the emitted input stays the existing 8-way `Button` bitmask via the shared
   `createOctantPad`. A true analog axis is explicitly rejected: it would violate
   the determinism hard-rule (integer/fixed-point inputs, ADR-002) and force a
   netcode protocol change. No sim or wire-format changes.
3. **Controls overlay, and fade.** A new `overlay` layout mode positions the
   control zones as bottom-corner overlays that reserve **no** layout space; the
   playfield fills the screen behind them. `attachIdleFade` dims them when idle.
4. **Native 16:9 for all four games.** Scrollers (Splash Squad, Ramp Riders)
   widen their per-client camera to show more world — view-only, no sim change.
   The single-screen arenas (**Bubble Buddies**, **Puck Pals**) are
   **re-authored** to a 16:9 play area (levels / rink geometry), because they
   have no world beyond the current 4:3 frame; widening their camera would only
   reveal out-of-bounds.

## Why

The stick + overlay + landscape lock are pure view/input-shell concerns and ride
on the primitives already built in ADR-010 (`createOctantPad`,
`createTouchControls`, `onViewportChange`, `installZoomGuard`), so the shared
shell absorbs them and all games inherit one consistent feel. Keeping the stick
digital preserves replay/netcode determinism with zero sim risk. Redesigning the
arenas (rather than letterboxing them) is the only way to give those two games a
true 16:9 frame, and Kevin chose the redesign over a half-measure.

## Consequences

- **Rollout is piloted.** The shell changes land on `main` first (ADR-009); the
  paradigm is proven on **Ramp Riders** (already 256×144 = 16:9, camera-only, so
  zero sim/fixture risk) and reviewed on a phone before the other three convert,
  each in its own PR.
- **The arena redesigns touch sims.** Re-authoring Bubble Buddies' levels and
  Puck Pals' rink changes simulation geometry, so their **replay fixtures and sim
  hashes must be regenerated deliberately** and their sim tests updated. This is
  the only sim-touching work; the stick/overlay/landscape shell work never
  touches a sim.
- **Shared control CSS lands here** (`@retro-recall/shell/controls.css`), closing
  the ADR-010 deferred follow-up — games theme via CSS vars instead of copying
  control styles.
- ADR-007 stays the record for the mobile-first/PWA/safe-area stance; only its
  dual-orientation + pillarbox layout decision is superseded by this ADR.

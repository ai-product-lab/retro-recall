# ADR-010: Shared arcade shell package

**Status:** Accepted · 2026-06-13

## Context

The mobile-first shell (ADR-007) — the dual-orientation layout engine
(`startLayout`), the 8-way touch pad (`createTouchControls`), and capability
detection (`device`) — was authored for Bubble Buddies. When Splash Squad (the
first ADR-009 Wave B game) needed the exact same controls, it copied those three
modules verbatim into its own `src/shell/`, because a game worktree is
additive-only and must not edit `packages/*` or other games. That copy was the
right call *in the worktree*, but leaving it duplicated means games #3 and #4
copy-paste the same idiom, and a control-feel fix would have to land N times.

ADR-009's amended rule already tells us what to do: a shared surface that ≥2
games need lands on `main` as its own PR; game worktrees then rebase and adopt
it. This is that PR.

## Decision

Extract the **generic** shell into `@retro-recall/shell`:

- `layout.ts` — `startLayout` (integer-scale playfield + zone placement, both
  orientations, relayout on rotate/resize/visualViewport).
- `controls.ts` — `createTouchControls` (8-way d-pad + A/B, pointer-tracked).
- `device.ts` — `prefersTouchUI` / `isIOS` / `isStandalone` / `applyInputMode`.

Bubble Buddies now imports from the package; its local copies are removed (moved
with `git mv`, history preserved). What stays **per game** (genuinely
game-specific or ADR-008 comms, not yet generalized): `audio`, `pwa`, `invite`,
`emote-wheel`, and the control/HUD **CSS** in each game's `shell.css`.

## Why

Single source for the touch/layout idiom — the factory leverage ADR-009 is
chasing. The three modules are pure of game logic (only `controls.ts` depends on
RetroKit's `Button`), so extraction is mechanical and low-risk. It is verified
by Bubble Buddies' full suite + e2e staying green and both web entries building.

## Consequences

- The in-flight game worktrees (`game/splash-squad`, and later `puck-pals` /
  `ramp-riders`) **rebase onto this and switch their imports to the package**,
  deleting their local copies — the ADR-009 "engine lands first, worktrees
  rebase" protocol. Splash Squad's local shell copies become the thing it drops
  on rebase.
- **Deferred follow-ups** (each its own future `main` PR, not this one):
  - shared **control/layout CSS** (the package currently emits class names that
    each game's `shell.css` styles — works, but still duplicated);
  - a shared **comms layer** (ADR-008: invite / emote wheel / PWA / in-app-browser
    escape), which is larger and game-flavored.

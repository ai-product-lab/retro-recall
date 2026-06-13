# Phase 2.5 kickoff — mobile first, for real

Field report from Kevin's iPhone at retro-recall.pages.dev: keyboard input
legends shown on a touch device, aspect ratios off. This phase makes the
iPhone the primary experience per ADR-007. Shell-layer only.

## Prompt for Claude Code

---

Read CLAUDE.md and ADR-007, then rebuild the game shell mobile-first:

1. **Layout engine:** the playfield always renders at integer multiples of
   256×192 (4:3), centered, never stretched. Landscape = playfield at max
   integer scale, d-pad zone in the left pillarbox bar, A/B in the right
   (NES-held-sideways). Portrait = playfield top at max width-fitting integer
   scale, controller area below — d-pad left, A/B right (Game Boy). Live
   relayout on rotate and on `visualViewport` changes. Respect
   `safe-area-inset-*` everywhere (notch, home indicator).

2. **Touch controls:** zones feed the existing input bitmask. D-pad supports
   slide-between-directions without lifting; buttons ≥48px with hit slop;
   multi-touch (move + jump + blow simultaneously); B-hold still opens the
   emote wheel. No 300ms delays, no scroll/zoom/double-tap/long-press-menu
   inside the game (touch-action, gesture suppression).

3. **Device-aware UI:** input hints/legends switch by capability — touch
   devices never see keyboard keys; desktop keeps them. Same for the invite
   page copy.

4. **PWA:** manifest (name "Bubble Buddies", icons from branding palette,
   `display: standalone`, any-orientation), service worker (cache shell +
   assets, network-first for room API), friendly "pin me" screen explaining
   Safari share-sheet → Add to Home Screen, tap-to-start screen that doubles
   as the iOS audio unlock.

5. **Verify:** sim, levels, replay fixtures untouched (CI proves it). Test
   layouts at iPhone SE/15/15 Pro Max viewport sizes in both orientations
   (Playwright viewport screenshots reviewed in the PR). Deploy; I'll
   playtest on my phone before this phase closes. Devlog entry.

Acceptance: on an iPhone — correct ratios in both orientations, no keyboard
hints, thumbs-only full co-op session, installable from the share sheet, and
it still feels right on desktop.

---

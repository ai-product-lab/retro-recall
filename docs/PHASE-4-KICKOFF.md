# Phase 4 kickoff — the Library (4a), then three games in parallel (4b)

Strategy and rules: ADR-009. Game concepts: `games/*/BRIEF.md`.

## Wave A setup (two worktrees, run concurrently)

```bash
git worktree add ../rr-library -b phase/library
git worktree add ../rr-avatars -b phase/avatars   # runs docs/PHASE-3-KICKOFF.md
```

One Claude Code session in each folder. Library merges to main first.

### Prompt — Library worktree

---

Read CLAUDE.md, ADR-009, and all three `games/*/BRIEF.md`. Execute Phase 4a:

1. **Engine extensions, spec-driven from the BRIEFs** (land these first,
   each with tests + an unchanged-replay-fixture proof for Bubble Buddies):
   camera system (follow target, bounds, lock-and-advance flag), levels
   larger than one screen, slope tiles in the physics core (22.5°/45°),
   camera-triggered spawn regions. Nothing the BRIEFs don't ask for.
2. **Game registry** (`site/registry.ts`) + library home: tile grid, status
   (live/coming-soon), per-game play routes; Bubble Buddies registered;
   Puck Pals / Splash Squad / Ramp Riders as coming-soon tiles (house-style
   placeholder tile art, BRAND.md palette).
3. **`pnpm new-game <id>` scaffolder:** sim skeleton implementing `GameSim`,
   SPEC.md template (modeled on Bubble Buddies'), renderer + dual-orientation
   touch-layout stubs per ADR-007, test harness with replay-fixture wiring,
   registry entry, rooms-worker config. Prove it: `pnpm new-game demo-game`
   builds, tests, and renders its stub, then delete it.
4. **Verify & merge:** CI green, Bubble Buddies fixtures untouched, deploy,
   devlog entry with timing notes.

---

## Wave B setup (after Wave A merges to main)

```bash
git worktree add ../rr-puck-pals  -b game/puck-pals
git worktree add ../rr-splash-squad -b game/splash-squad
git worktree add ../rr-ramp-riders -b game/ramp-riders
```

### Prompt — each game worktree (swap the game id)

---

Read CLAUDE.md, ADR-009, and `games/<id>/BRIEF.md`. Build the game:

1. `pnpm new-game <id>`, then write `games/<id>/SPEC.md` resolving the
   BRIEF's "Open for SPEC" list — Bubble Buddies SPEC conventions (integer
   constants, ASCII maps where applicable, §multiplayer, §determinism).
   Stop for Kevin's approval of the spec before implementing.
2. Implement sim → tests + golden replay fixtures → renderer + touch layouts
   → netcode integration (mode per the BRIEF) → avatar body rigs via
   `packages/avatar` → original art per BRAND.md.
3. **Additive-only discipline:** no edits to `packages/*` or other games. If
   an engine capability is missing, stop and tell Kevin — it lands on main
   as a separate small PR first (ADR-009 protocol), then rebase.
4. Registry flips to live only after: CI green, ADR-005 IP review (Konami/
   Nintendo resemblance pass), phone playtest. Devlog entry with wall-clock
   time and scaffolder friction notes — this is the factory's report card.

---

## Merge & ops notes

- Engine PRs from Wave B: smallest possible, merged to main, all worktrees
  rebase (`git fetch && git rebase origin/main`).
- `git worktree list` to see the floor; `git worktree remove` when a game
  ships.
- Kevin's standing human steps: `setup-dns.sh` (once), spec approvals (one
  per game), phone playtests.

# Phase 1 kickoff prompt

Paste this into Claude Code (run from this project folder). It can also be split into the four session prompts at the bottom if you prefer smaller steps.

---

Read CLAUDE.md and all required reading it lists, then execute Phase 1 of the roadmap:

1. **Scaffold the monorepo** per docs/ARCHITECTURE.md: pnpm workspaces, TypeScript project references, Vitest, ESLint (including the lint rule barring DOM/network imports in sim code), .gitignore, and a GitHub Actions workflow running typecheck + tests on PR. Initialize git and make the first commit.

2. **Write `games/bubble-buddies/SPEC.md`** before any game code: entities (player, bubble, 2 enemy types), movement and jump physics values, bubble blow/float/pop rules, enemy trap/escape/pop-into-fruit rules, score, lives, level-clear condition, and the 5 level layouts as ASCII tile maps. Keep all tuning values in the spec as named constants. Pause and show me the spec for approval before continuing.

3. **Build RetroKit's core** as Bubble Buddies needs it: fixed 60Hz sim loop, tile map + AABB physics, seeded RNG, state serialization with stable hashing, Canvas 2D sprite/tile renderer, keyboard input. Determinism test: record an input log, replay it, assert identical state hashes.

4. **Implement the Bubble Buddies sim** from the spec (placeholder colored-rectangle sprites are fine), wire it to the renderer and input, and serve it with Vite. All 5 levels playable, restart on game over.

5. **Verify and demo:** all tests green including determinism replay; then tell me how to run it locally (`pnpm dev`) and let me play before any deploy setup.

Constraints: no Phaser or game frameworks; no Nintendo/Taito names anywhere in code or assets; commit at each numbered step; append a devlog entry to docs/devlog.md when done.

---

## Alternative: smaller sessions

- Session A: steps 1–2 (scaffold + spec, stop for approval)
- Session B: step 3 (RetroKit core + determinism test)
- Session C: steps 4–5 (game sim + playable demo)

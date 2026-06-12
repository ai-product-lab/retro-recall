# ADR-006: The game factory — monorepo, scaffolding, and CI/CD

**Status:** Accepted · 2026-06-12

## Context

The goal isn't one game; it's a *repeatable way* to produce game variants with AI-driven development, plus published skills documenting the method. The structure must make "build the next game" a mostly-automated act.

## Decision

**One monorepo** (pnpm workspaces + TypeScript project references) on GitHub, structured as in `ARCHITECTURE.md`: shared packages (`retrokit`, `netcode`, `avatar`), one folder per game, the arcade site, workers, and tools.

**Every game starts from a spec.** `games/<name>/SPEC.md` defines the design grammar, entities, rules, win conditions, and netcode notes in a standard format. The spec is the prompt: it's what Claude builds from, what tests verify against, and what the Field Guide publishes.

**Scaffolding:** `pnpm new-game <name>` generates the game module skeleton (sim implementing `GameSim`, renderer stub, spec template, test harness, site page, deploy config).

**CI/CD (GitHub Actions):** on every PR — typecheck, unit tests, and **determinism tests** (replay recorded input logs, assert state hashes; run sim in browser-like and workers-like runtimes, assert identical hashes). On merge to main — build and deploy site/clients to Cloudflare Pages and workers via Wrangler. Preview deploys per PR so friends can playtest a branch from a link.

**Skills as output:** recurring workflows (new game variant, new level, sprite pipeline run, devlog publish) get captured as Claude skills/commands in `tools/skills/`, versioned in-repo, and published to the Field Guide once stable.

## Why

The deterministic core (ADR-002) is what makes automation trustworthy: CI can *prove* a change didn't alter gameplay by replaying inputs. Spec-first development is what makes AI generation consistent across variants. Preview deploys turn the family into the QA team.

## Consequences

Discipline required: features land with spec updates and replay fixtures or they don't land. The monorepo grows; project references and CI caching keep it fast. GitHub becomes the second platform we depend on (acceptable — it's also the publishing venue).

# ADR-011: Consolidate hosting onto Workers Static Assets (proposed, gated)

**Status:** Proposed · 2026-06-13 · _gated on a verification step before adoption_

Supersedes the hosting split in [ADR-001](./ADR-001-hosting-cloudflare.md) **if and when accepted.**

## Context

Today the arcade is served by two Cloudflare products on one hostname:
- **Pages** serves the static site (`/`, `/play/<game>/`, `/assets/`).
- The **rooms Worker** owns `/api/*` and `/room/*` (the authoritative game server + WebSockets).

Deploying means building, stitching `dist-deploy/`, then **two** deploys
(`wrangler pages deploy` + `wrangler deploy`) — two artifacts, two rollback
units, and cross-origin `ROOMS_ORIGIN` plumbing. Cloudflare is also consolidating
Pages into **Workers Static Assets**, which can serve a static site *and* a
`fetch` handler (API/WS) from one Worker, with static-asset requests served free
at the edge. That would collapse the deploy to a single `wrangler deploy`, unify
rollback, and put everything same-origin — directly simplifying the delivery
pipeline.

## Decision (proposed)

Fold the static site into the rooms Worker via an `assets` binding
(`directory: ../../dist-deploy`), so one Worker serves the site + API/WS. Route
the whole hostname to the Worker and detach the custom domain from Pages.

**Not yet adopted** — three findings from a 2026-06-13 spike must be resolved first.

## Why it is gated (findings)

1. **Free-tier benefit is unverified for our setup.** The value rests on asset
   *hits* being served at the edge **without invoking the Worker** (so page loads
   stay off the 100k/day invocation cap). Docs state this, but `wrangler dev`
   ran the Worker for *every* request (it returned the Worker's 404 even for a
   real hashed asset), so we could not confirm it locally. **If asset hits do
   invoke the Worker in production, consolidation makes every page load count
   against the Free cap — actively worse than the split, where Pages page-loads
   are already free.** This must be measured on a real (non-production) deploy
   via the observability/analytics request count before adoption.
2. **It entangles the game server's tests with the site build.** With `assets`
   in `wrangler.jsonc`, the rooms Worker's `vitest-pool-workers` suite refuses to
   start unless `dist-deploy/` exists (`assets.directory does not exist`) — a
   layering violation that breaks a fresh-checkout `pnpm test`. Adoption needs a
   test-config override pointing at a committed stub directory.
3. **The cutover is outward-facing and atomic.** Deploying the Worker with route
   `…/*` + assets takes over the hostname from Pages at deploy time; a stale or
   failed asset upload breaks the *whole* site, not just the API. Needs a
   deliberate cutover with immediate verification and a ready rollback
   (re-attach the Pages domain / `wrangler rollback`).

## Routing notes (for whoever adopts this)

- Use **asset-first** routing (default; no `run_worker_first`). The array form
  `run_worker_first: ["/api/*","/room/*"]` routed *everything* to the Worker on
  wrangler 4.100 — avoid it until confirmed fixed.
- `not_found_handling: "none"` (not `single-page-application`) so an asset miss
  falls through to the Worker instead of an SPA `index.html` shadowing `/api`.
- Add `ASSETS: Fetcher` to `Env` and a fallthrough `return env.ASSETS.fetch(request)`
  for non-`/api`,`/room` paths so local dev and asset misses still serve the site.
- `dist-deploy/` already builds via `tools/build-site.mjs`; a single
  `wrangler deploy` would then ship site + API together.

## Consequences

Until adopted, the delivery pipeline automates the **two-deploy split** (CD runs
`build:site` → `pages deploy` + `wrangler deploy`). The guardrails that actually
keep us on the Free tier — `workers_dev:false`, the `ratelimits` bindings, and
the throttled KV writes — are independent of this decision and already shipped.
Revisit adoption once finding (1) is measured green on a throwaway deploy.

# Phase 2 kickoff prompt (run after Phase 1.5 ships)

## One-time ops first (you, ~10 min)

1. Create the public GitHub repo (`retro-recall`), push: `git remote add origin … && git push -u origin main`.
2. `npx wrangler login` in the project folder (authorizes deploys to your Cloudflare account).

## Prompt for Claude Code

---

Read CLAUDE.md and required reading, plus `games/bubble-buddies/SPEC.md` §11
(multiplayer) and `packages/netcode/SPEC.md`. Execute Phase 2 of the roadmap:

1. **Sim multiplayer:** extend the Bubble Buddies sim to SPEC §11 (input
   array, spawn offsets, rescue-bubble revive, solo-mode fallback, per-player
   score, disconnect despawn). Update the determinism tests; record a new
   4-player golden replay fixture alongside the existing solo one. Show me
   passing tests before going on.

2. **Room server:** implement `packages/netcode` per its SPEC — Durable
   Object room (WebSocket hibernation API), room codes in KV, join/rejoin
   tokens, snapshots at 20 Hz, hashcheck, emotes with server-side rate limit.
   Wrangler config + miniflare integration tests.

3. **Client netcode:** prediction/reconciliation per SPEC (own-player rebase,
   remote interpolation, `?lag=` harness). Two-headless-clients test green.

4. **Invite flow:** room create/join UI, `/play/bubble-buddies?room=CODE`
   page with the "start a call first" nudge and in-app-browser → "Open in
   Safari" escape. Emote wheel as a touch-friendly radial on B-hold.

5. **Deploy & demo:** deploy to Cloudflare (Pages + Worker + DO). Production
   hostname: **retro-recall.ruralrooted.com** (zone `ruralrooted.com` is in
   this account) — Pages custom domain for the site, Worker routes
   `retro-recall.ruralrooted.com/api/*` and `/room/*` for the server, all
   declared in config. Give me the URL and room flow; I'll playtest from two
   phones on FaceTime. Then devlog entry.

Constraints: sim changes only per SPEC §11 — solo replay fixture must stay
green. Commit per step. No free-text chat anywhere. Cloudflare free plan:
Durable Objects must use the SQLite backend (`new_sqlite_classes` migration);
create KV namespaces via wrangler and reference IDs in config — no dashboard
clicking, everything reproducible from the repo.

---

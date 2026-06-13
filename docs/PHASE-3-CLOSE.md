# Phase 3 close — runbook (Kevin, human-run)

Phase 3 (Get Sprited) is **built and merged to `main`** (PR #1). Code is done,
112 tests green, CI green on main. What remains to *close* the phase is your
ops + the demo — none of it needs more code. Do the steps in order; each says
what to expect and when to stop.

Working dir: `/Users/kevinmoormann/Claude/Projects/rr-avatars` (the
`phase/avatars` worktree). If you start fresh elsewhere, `git pull` main first.
pnpm is via corepack (`corepack enable` if `pnpm` isn't found).

---

## Step 1 — Validate the avatar look locally (no infra, ~5 min)

This is the one thing I could not test: prompt **v2** (magenta chroma key +
matte) against the live model. It only needs your Gemini key — it calls Gemini
directly, no worker/R2/deploy. **Do this first**; if the heads look wrong, it's
a `packages/avatar/src/style-prompt.ts` tweak, not a redeploy.

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars
export GEMINI_API_KEY=AIza...                       # your key
pnpm --filter @retro-recall/avatar gen ~/path/to/photo1.jpg ~/path/to/photo2.jpg
pnpm --filter @retro-recall/avatar compose
open packages/avatar/gen-out/index.html             # animated buddies + gallery
```

**Look for:** a clean head silhouette on a transparent background (no opaque
square, no colored halo ring), face recognizable, body/feet animating.

- ✅ Looks good → go to Step 2.
- ❌ Haloed / mis-keyed / square background → the magenta key didn't take. Open
  a new session and tell me "prompt v2 is haloing" — it's a prompt/tolerance
  tweak. Don't deploy until this looks right.

---

## Step 2 — Provision the Avatar Worker (one-time)

Needs `wrangler` logged in (you already are). Creates the storage the worker
binds to. The bucket/namespace names must match `workers/avatar/wrangler.jsonc`.

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars/workers/avatar

npx wrangler r2 bucket create retro-recall-avatars

npx wrangler kv namespace create AVATAR_RATE
#   → prints: id = "xxxxxxxxxxxxxxxx"
#   PASTE that id into workers/avatar/wrangler.jsonc, replacing the string
#   REPLACE_WITH_AVATAR_RATE_KV_ID  (line ~18)

npx wrangler secret put GEMINI_API_KEY --name retro-recall-avatar
#   → paste your key when prompted (never goes in the repo)
```

Sanity check `wrangler.jsonc` no longer contains `REPLACE_WITH_AVATAR_RATE_KV_ID`:
```bash
grep REPLACE workers/avatar/wrangler.jsonc && echo "STILL A PLACEHOLDER — fix it" || echo "ok"
```

> The `wrangler.jsonc` edit (the KV id) is a real change — commit it on a branch
> and PR to main so the deployed config matches the repo.

---

## Step 3 — Deploy the Avatar Worker

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars/workers/avatar
npx wrangler deploy
```

This publishes the worker and its `workers.dev` URL. Its production routes
(`retro-recall.ruralrooted.com/api/avatar*`) only start serving once the DNS
host exists — that's Step 4.

Smoke test the deploy (degrade path — no real generation, just proves it's up):
```bash
curl -s -X POST "https://retro-recall-avatar.<your-subdomain>.workers.dev/api/avatar?room=TEST" \
  -H "Content-Type: image/png" --data-binary @some.png | head
#   expect JSON like {"source":"fallback","reason":...}  (200/4xx/5xx all fine —
#   it means the worker is alive; real generation works once a photo + key flow)
```

---

## Step 4 — Production DNS (gates the real phone demo)

The client only talks to the avatar worker **same-origin on the canonical host**.
On `retro-recall.pages.dev` generation degrades to the gallery (still playable,
but no photo→buddy). So the face-on-phone demo needs the CNAME live. This is the
Phase 2 leftover too.

Needs a **scoped API token** (wrangler's OAuth can't write DNS):
dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit zone DNS",
scoped to `ruralrooted.com`.

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars
CLOUDFLARE_API_TOKEN=<scoped-token> bash workers/rooms/scripts/setup-dns.sh
```
Or skip the script and add it in the dashboard: DNS → ruralrooted.com → Add
record → CNAME `retro-recall` → `retro-recall.pages.dev` (proxied).

Wait until `https://retro-recall.ruralrooted.com` loads the game.

---

## Step 5 — Confirm the deployed client

The `main` merge updated the Pages site. If Pages auto-deploys from GitHub it's
already live; otherwise build + deploy:
```bash
pnpm --filter @retro-recall/bubble-buddies build      # → games/bubble-buddies/dist-web
npx wrangler pages deploy games/bubble-buddies/dist-web --project-name retro-recall
```
Open `https://retro-recall.ruralrooted.com/play/bubble-buddies/?room=TEST` →
the join overlay should show the **avatar picker** (8 creatures + "use my photo").

---

## Step 6 — The demo (the actual close gate)

On your phone, at `retro-recall.ruralrooted.com`:
1. Start/enter a room, tap **use my photo**, take a selfie.
2. Wait for "that's you! ✓", confirm the buddy is *you*, tap **JOIN GAME**.
3. Play. Confirm you render as your avatar (and a 2nd phone shows you too).

If generation fails on the phone but the gallery works → the worker/DNS/key
isn't wired; re-check Steps 2–4. The gallery always working is by design
(degrade-never-block).

---

## Step 7 — Close it out

- Flip `CLAUDE.md` "Current phase" from "Phase 3 — built" to closed; note the
  demo done in `docs/devlog.md`.
- Mark Phase 3 done in `docs/ROADMAP.md`.
- Next: **Phase 4a Library** in the `phase/library` worktree (ADR-009 Wave A,
  `docs/PHASE-4-KICKOFF.md`).

## Rollback / safety
- Everything degrades to the gallery, so a broken worker never blocks play.
- To pull a bad avatar: it's an R2 object `heads/<id>.png` in `retro-recall-avatars`.
- Rate limits (10/room/day, 30/IP/day) live in `workers/avatar/src/config.ts`.
- The style prompt is versioned; changing it re-styles only *new* players.

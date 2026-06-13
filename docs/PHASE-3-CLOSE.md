# Phase 3 close — runbook (Kevin, human-run)

Phase 3 (Get Sprited) is **built and on `main`**. Code is done and intact —
the avatar worker, compositor, gallery, the picker/render wiring in Bubble
Buddies, and the `avatarId` netcode threading all survived the Wave-B games,
the shell extraction (ADR-010), and the netcode WS-burn fix. Bubble Buddies is
`status: 'live'` in `site/registry.ts`, so **the avatar picker is already in the
deployed site**.

What remains to *close* the phase is your ops + the demo. None of it needs more
code.

> **Updated 2026-06-13 for the delivery pipeline.** A CI/CD workflow
> (`.github/workflows/deploy.yml`) now exists. On every merge to `main` it
> **auto-builds + deploys the Pages site** (`pnpm build:site` → `wrangler pages
> deploy dist-deploy`) and **auto-deploys the rooms Worker** when its code/shared
> packages change. So the client and the game server ship themselves now — the
> **only thing still deployed by hand is the avatar Worker** (it's deliberately
> not in CD; see Step 3 and the optional CD step). Your `avatarId` netcode change
> already shipped via CD.

Working dir: `/Users/kevinmoormann/Claude/Projects/rr-avatars`. `corepack enable`
if `pnpm` isn't found. `git pull` first.

**Current live state:** the picker is in production, but on `*.pages.dev` (and
until the avatar Worker + DNS are wired) "use my photo" degrades to the gallery —
the 8 creatures work, photo→buddy returns a fallback. That's by design
(degrade-never-block); Steps 2–4 turn on real generation.

---

## Step 1 — Validate the avatar look locally (no infra, ~5 min)

The one thing never tested: prompt **v2** (magenta chroma key + matte) against
the live model. Needs only your Gemini key — calls Gemini directly, no
worker/R2/deploy. **Do this first**; a bad look is a `style-prompt.ts` tweak,
not a redeploy.

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars
export GEMINI_API_KEY=AIza...
pnpm --filter @retro-recall/avatar gen ~/path/to/photo1.jpg ~/path/to/photo2.jpg
pnpm --filter @retro-recall/avatar compose
open packages/avatar/gen-out/index.html        # animated buddies + gallery
```

**Look for:** a clean head silhouette on a transparent background (no opaque
square, no colored halo ring), face recognizable, body/feet animating.

- ✅ Good → Step 2.
- ❌ Haloed / mis-keyed / square background → the chroma key didn't take. Start a
  session and say "prompt v2 is haloing" — a prompt/tolerance tweak. Don't deploy
  until it looks right.

---

## Step 2 — Provision the Avatar Worker (one-time)

Needs `wrangler` logged in (you are). Names must match
`workers/avatar/wrangler.jsonc`.

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars/workers/avatar

npx wrangler r2 bucket create retro-recall-avatars

npx wrangler kv namespace create AVATAR_RATE
#   → prints: id = "xxxxxxxxxxxxxxxx"
#   PASTE that id into workers/avatar/wrangler.jsonc, replacing
#   REPLACE_WITH_AVATAR_RATE_KV_ID  (~line 18)

npx wrangler secret put GEMINI_API_KEY --name retro-recall-avatar
#   → paste your key (never goes in the repo)
```

Confirm the placeholder is gone, then **commit the `wrangler.jsonc` KV-id edit**
on a branch + PR so the repo matches the deployed config:
```bash
grep REPLACE workers/avatar/wrangler.jsonc && echo "STILL A PLACEHOLDER — fix it" || echo "ok"
```
(Merging that PR will *not* deploy the avatar Worker — it isn't in CD yet. Step 3
does the deploy. See the optional CD step to change that.)

---

## Step 3 — Deploy the Avatar Worker (the one manual deploy)

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars/workers/avatar
npx wrangler deploy
```

Its production routes (`retro-recall.ruralrooted.com/api/avatar*`) only serve
once the DNS host exists (Step 4); until then it's reachable on its `workers.dev`
URL (`workers_dev: true`). Smoke-test it's alive (degrade path is fine — proves
it's up):
```bash
curl -s -X POST "https://retro-recall-avatar.<your-subdomain>.workers.dev/api/avatar?room=TEST" \
  -H "Content-Type: image/png" --data-binary @some.png | head
#   any JSON response (even {"source":"fallback",...}) = worker is live
```

---

## Step 4 — Production DNS (gates the real demo)

The client talks to the avatar Worker **same-origin on the canonical host**; on
`pages.dev` generation degrades to the gallery. The rooms Worker is now
`workers_dev:false` too (Free-tier guardrail), so the canonical host is the path
for the full multiplayer + avatar demo. This is also the Phase 2 leftover.

Needs a **scoped API token** (wrangler's OAuth can't write DNS):
dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit zone DNS",
scoped to `ruralrooted.com`.

```bash
cd /Users/kevinmoormann/Claude/Projects/rr-avatars
CLOUDFLARE_API_TOKEN=<scoped-token> bash workers/rooms/scripts/setup-dns.sh
```
Or in the dashboard: DNS → ruralrooted.com → Add record → CNAME `retro-recall`
→ `retro-recall.pages.dev` (proxied). Wait until
`https://retro-recall.ruralrooted.com` loads the game.

---

## Step 5 — Confirm the deployed client (now automatic)

**No manual build/deploy needed** — CD already shipped the site on the last
`main` merge, and the avatar picker is in it. Just confirm:

```
https://retro-recall.ruralrooted.com/play/bubble-buddies/?room=TEST
```
→ the join overlay shows the **avatar picker** (8 creatures + "use my photo").

Only if you need to rebuild by hand (the command changed — it's registry-driven
now, stitches all live games):
```bash
pnpm build:site          # → dist-deploy/   (was: per-game build + hand-stitch)
npx wrangler pages deploy dist-deploy --project-name retro-recall
```

---

## Step 6 — The demo (the actual close gate)

On your phone at `retro-recall.ruralrooted.com`:
1. Enter/start a Bubble Buddies room, tap **use my photo**, take a selfie.
2. Wait for "that's you! ✓", confirm the buddy is *you*, tap **JOIN GAME**.
3. Play; confirm you render as your avatar (a 2nd phone should see you too).

Photo fails but gallery works → worker/DNS/key not wired; re-check Steps 2–4.
The gallery always working is by design.

---

## Step 7 — Close it out

- Flip `CLAUDE.md` "Current phase" from "Phase 3 — built" to closed; note the
  demo in `docs/devlog.md`; mark Phase 3 done in `docs/ROADMAP.md`.
- Phase 4a Library and the Wave-B games already landed in parallel — check
  `docs/ROADMAP.md` for what's genuinely next.

---

## Optional — put the Avatar Worker in CD (do *after* Step 2)

Right now the avatar Worker is the only thing deployed by hand. To make future
avatar changes ship themselves, add a deploy step to
`.github/workflows/deploy.yml`'s `production` job, mirroring the rooms Worker
(guard it on `workers/avatar/**` + `packages/avatar/**` via the existing
`paths-filter`):

```yaml
- name: Deploy avatar Worker
  if: steps.changes.outputs.avatar == 'true'
  run: pnpm --filter @retro-recall/avatar-worker run deploy
```
**Only add this after Step 2** — until the R2 bucket, KV namespace, and secret
exist (and the KV id is in `wrangler.jsonc`), a CD `wrangler deploy` of the
avatar Worker would fail and break the pipeline. Happy to wire this for you once
provisioning is done.

---

## Rollback / safety
- Everything degrades to the gallery, so a broken/absent worker never blocks play.
- Pull a bad avatar: it's R2 object `heads/<id>.png` in `retro-recall-avatars`.
- Rate limits (10/room/day, 30/IP/day): `workers/avatar/src/config.ts`.
- Style prompt is versioned — changing it re-styles only *new* players.

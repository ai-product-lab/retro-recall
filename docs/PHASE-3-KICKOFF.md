# Phase 3 kickoff — "Get Sprited" (avatars) + real art

**Prerequisites, in order:**

1. **Finish Phase 2.5 first** (mobile-first pass — see
   `docs/PHASE-2.5-KICKOFF.md`). Not optional: the avatar upload flow is
   phone-camera-first and builds on the mobile shell.
2. Run `bash workers/rooms/scripts/setup-dns.sh` (production hostname).
3. Two-phone FaceTime playtest of Phase 2 → notes into `docs/devlog.md`.

**Kevin's ops for Phase 3 (~5 min):** create a Gemini API key at
aistudio.google.com → in the project folder run
`npx wrangler secret put GEMINI_API_KEY --name retro-recall-avatar`
(Claude Code will create that worker and prompt for the secret step).

## Prompt for Claude Code

---

Read CLAUDE.md, ADR-004, and BRAND.md. Execute Phase 3:

1. **Avatar worker** (`workers/avatar`): `POST /api/avatar` accepts a photo
   (client-side downscaled to ≤512px). Pipeline per ADR-004: Gemini
   image-to-image with the locked house-style prompt (versioned in
   `packages/avatar/style-prompt.ts`, steered away from any existing game
   character) → palette-quantize to `PALETTE_P1` → 24×24 head sprite →
   moderation check (Gemini vision pass on input and output; reject = use
   fallback) → store sprite sheet in R2 keyed by content hash → **delete the
   photo** (never persisted). Rate limits: 10 generations/room/day,
   30/IP/day (constants, easy to tune). Show me the style prompt + 3 test
   generations for approval before wiring the game.

2. **Body-rig compositor** (`packages/avatar`): composite the head onto
   original body rigs (idle ×2, walk ×4, jump ×2, blow ×2, rescue-bubble ×2
   frames; per-frame head offset tables). Output one sprite sheet per player.

3. **Fallback gallery:** 8 original pre-made creatures (house style) shown
   when AI is declined, fails, or is rate-limited. Picking one never blocks
   play (Principle: API outage degrades, never blocks).

4. **Game integration:** avatar pick/upload step on the invite page (camera
   or photo library via file input), `avatarId` already flows through the
   join protocol → renderer draws each player's sheet. Emote bubbles and
   rescue-bubble render over any avatar.

5. **Real art pass:** replace placeholder rectangles for tiles, enemies,
   bubbles, fruit per BRAND.md house style (original work only — ADR-005
   resemblance review against the classic inspirations as part of this step).

6. **Verify & demo:** all tests green (sim untouched — replay fixtures must
   not change); moderation rejection path tested; deploy. Demo: I upload my
   face on my phone and play as myself. Devlog entry when done.

Constraints: photos never written to storage or logs; sprites only enter a
room after the moderation pass; no AI calls from the client (key stays in
the worker); fallback path works with the API key removed.

---

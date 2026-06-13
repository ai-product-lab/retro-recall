# Splash Squad — ADR-005 IP review (v1)

Pre-release resemblance pass per ADR-005. Inspiration (internal only): a
side-scrolling run-and-gun. Status: **clear for the `coming-soon` → `live`
gate** on the IP axis; the only remaining gate is Kevin's two-phone playtest.

## Asset provenance audit

- **All v1 art is procedurally drawn rectangles/circles in code** (`src/render/index.ts`)
  using the original Retro Recall brand palette (`branding/BRAND.md`). No external,
  ripped, traced, or AI-generated assets exist in this game. No ROMs, no emulation.
- **No AI generation prompts were used** for v1 (placeholder art), so there is no
  prompt audit surface yet. When real sprites/avatars land (Phase 3 "Get Sprited"),
  prompts must steer away from existing characters and outputs get a fresh
  resemblance check — tracked there, not here.
- No fonts shipped beyond the system `monospace` used by the HUD text helper.

## Name / trademark pass

Every identifier is original and non-imitative:

| Ours | Note |
|---|---|
| Splash Squad | alliterative house pattern (cf. Bubble Buddies); generic words, original combination |
| Squaddie (player) | original |
| Trundle / Sentry / Hopper (robots) | descriptive, original creatures — wind-up toys |
| Boiler-Bot (boss) | original |
| Stream / Spread / Burst (nozzles) | generic descriptive nozzle names |
| spigot, water blaster, wind-up robot, soak | generic mechanic vocabulary |

Code scan for protected names (Contra/Konami/Nintendo/Taito/character names) over
`src/`, `index.html`, and `play/` returns **no matches**. The inspiration is named
only in `games/splash-squad/BRIEF.md` (internal doc, permitted by ADR-005).

## Resemblance review

- **Mechanics** (non-copyrightable, fair inspiration): horizontal-scrolling co-op
  shooter, camera-triggered enemy waves, pick-up weapon nozzles, a boss with a
  weak point. These are genre conventions, not protected expression.
- **Expression is original and deliberately divergent**: zero violence
  (robots "wind down" with comic sputters; "ammo" is a refillable water tank, not
  lives pressure), backyard playset setting, family-framed art and copy. No trade
  dress, color scheme, character, or level art traceable to any specific game.
- Marketing/teaser copy (site registry) says "inspired"/original framing — never
  names or implies affiliation with any existing title.

## Verdict

No IP blockers for v1. Re-run the asset-provenance + prompt audit when Phase 3
art/avatars replace the placeholder rectangles.

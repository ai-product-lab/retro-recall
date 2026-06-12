# ADR-004: Avatar pipeline — AI-generated head, template-animated body

**Status:** Accepted · 2026-06-12

## Context

The signature feature: upload a photo, become a cute pixel character (in the spirit of, not copying, Bubble Bobble's dinosaurs). The output must be an *animated game sprite* (idle, walk, jump, blow-bubble), consistent in style with every other player's sprite, generated in seconds, safe for kids, and original IP.

## Decision

Split the problem: **AI generates the identity, templates provide the animation.**

1. Browser downscales/crops the photo client-side and sends it to the Avatar Worker.
2. Worker calls an image-to-image model (**Gemini image editing** primary; GPT Image fallback) with a locked style prompt: "original chibi pixel-art creature head in [house style], 64×64, transparent background, palette P" — explicitly steered away from any existing game character.
3. Output is quantized to the game palette, downscaled to sprite resolution, and **composited onto pre-drawn body rigs** (shared, original, hand-made animation frames). Head bobs/tilts per frame via offset tables.
4. **Moderation gate** (vision-model check on input photo and output sprite) before the sprite is shown to anyone else.
5. Sprite sheet cached in **R2** keyed by a hash; the uploaded photo is **deleted immediately** after generation. Rate limit per room/IP.

## Why

Asking a model for a full consistent 4-pose sprite sheet fails often and unpredictably; asking for one stylized head succeeds reliably, and template bodies guarantee animation quality, style consistency, and gameplay-readable silhouettes. Per-player cost is one image call (~$0.01–0.04). Deleting source photos is the privacy-correct default for a kids' product (Principle 2).

## Alternatives considered

**Full AI sprite-sheet generation:** style/pose consistency too unreliable today; revisit later. **Client-side pixelation only:** free and private but loses the "wow"; retained as the planned fallback when the API fails or a parent opts out of AI. **Specialized sprite services (Sprite-AI, AutoSprite, etc.):** convenient but adds a vendor for what one image call + our compositor does.

## Consequences

We must hand-craft high-quality body rigs once per game (factory asset). A locked style prompt becomes versioned config — changing it re-styles new players only (acceptable). API outage degrades to fallback avatars (pick-a-creature gallery) — never blocks play.

/**
 * The avatar pipeline (ADR-004), end to end:
 *
 *   moderate(photo) → generate head → moderate(sprite) → quantize to PALETTE_P1
 *   → 24×24 head PNG → store in R2 by content hash.
 *
 * The uploaded photo lives only as a local variable here: it is forwarded to
 * Gemini and then goes out of scope. It is never written to R2/KV and never
 * logged (Principle 2, ADR-004 "photo deleted immediately").
 *
 * Every failure path returns a structured fallback reason instead of throwing —
 * the caller turns it into a status code and the client shows the pre-made
 * gallery. The pipeline never blocks play.
 */

import {
  INPUT_MODERATION_PROMPT,
  OUTPUT_MODERATION_PROMPT,
  STYLE_PROMPT,
  decodePng,
  encodePng,
  headToRgba,
  quantizeToHead,
  type AvatarResult,
  type FallbackReason,
} from '@retro-recall/avatar';
import { contentId } from './bytes.js';
import { SPRITE_CACHE_CONTROL } from './config.js';
import { editImage, moderate } from './gemini.js';

export interface Env {
  AVATARS: R2Bucket;
  RATE: KVNamespace;
  GEMINI_API_KEY?: string;
}

export type PipelineOutcome =
  | { ok: true; result: AvatarResult }
  | { ok: false; reason: FallbackReason; detail?: string };

export async function generateAvatar(env: Env, photo: Uint8Array, photoMime: string): Promise<PipelineOutcome> {
  const key = env.GEMINI_API_KEY;
  // No key configured → degrade to the gallery (the with-key-removed path the
  // kickoff requires to keep working).
  if (!key) return { ok: false, reason: 'api_error', detail: 'no api key' };

  try {
    const inputVerdict = await moderate(key, INPUT_MODERATION_PROMPT, photo, photoMime);
    if (!inputVerdict.safe) return { ok: false, reason: 'moderation', detail: `input: ${inputVerdict.reason}` };

    const generated = await editImage(key, STYLE_PROMPT, photo, photoMime);
    if (generated.mime !== 'image/png') {
      return { ok: false, reason: 'api_error', detail: `unexpected output mime ${generated.mime}` };
    }

    // Moderate the full-resolution model output (the 24×24 is too small to
    // judge) before it is allowed anywhere near a room.
    const outVerdict = await moderate(key, OUTPUT_MODERATION_PROMPT, generated.bytes, generated.mime);
    if (!outVerdict.safe) return { ok: false, reason: 'moderation', detail: `output: ${outVerdict.reason}` };

    const decoded = await decodePng(generated.bytes);
    const headPng = await encodePng(headToRgba(quantizeToHead(decoded)));

    const avatarId = await contentId(headPng);
    await env.AVATARS.put(`heads/${avatarId}.png`, headPng as unknown as ArrayBuffer, {
      httpMetadata: { contentType: 'image/png', cacheControl: SPRITE_CACHE_CONTROL },
    });

    return { ok: true, result: { avatarId, source: 'generated' } };
  } catch (err) {
    // Includes GeminiError (HTTP/parse failures) and codec errors. Degrade.
    return { ok: false, reason: 'api_error', detail: err instanceof Error ? err.message : String(err) };
  }
}

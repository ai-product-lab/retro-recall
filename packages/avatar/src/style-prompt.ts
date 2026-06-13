/**
 * The locked, versioned house-style prompt for avatar generation (ADR-004).
 *
 * This is configuration, not code: changing it re-styles only *new* players, so
 * it is versioned and the version is recorded with each generation. The prompt
 * is deliberately verbose — image models reward specificity, and every clause
 * here is load-bearing for one of: house style, kid-safety, originality
 * (ADR-005), or making the downstream palette-quantize step clean.
 *
 * ADR-005 is non-negotiable: the prompt must steer *away* from any existing
 * video-game character or mascot, and this text ships in the public Field Guide
 * — so it names no protected character, ever. It describes the look we want from
 * first principles instead of by reference.
 */

export const STYLE_PROMPT_VERSION = 'v1';

/** The 15 opaque house colors, as hints to bias the model toward our palette so
 *  quantization is near-lossless. Mirrors PALETTE_P1 (keep in sync). */
const PALETTE_HINT = [
  '#0F1222 near-black',
  '#3DF5A6 mint-green',
  '#4CC9F0 sky-cyan',
  '#FF6B6B coral',
  '#FFD166 arcade-yellow',
  '#F2EFE9 warm-white',
].join(', ');

/**
 * Image-to-image instruction. The input is the player's downscaled photo; the
 * output we want is a single original creature head sprite.
 */
export const STYLE_PROMPT = [
  'Transform the person in this photo into an ORIGINAL cute chibi pixel-art creature — a little cartoon mascot for a retro arcade game.',
  'Keep only a friendly *impression* of the person: their hair color and rough hairstyle, skin warmth, glasses if present, and a happy expression. Do NOT make a realistic portrait and do NOT make it recognizable as the specific real person — stylize heavily into a rounded, big-eyed creature.',
  '',
  'Composition: just the HEAD and face, centered, facing the camera, friendly smile, looking slightly up. Big expressive eyes. Chunky, readable shapes — this will be shrunk to a tiny game sprite, so no fine detail.',
  'Art style: 8-bit / 16-bit console pixel art. Bold 1px dark outline around the whole head. Flat cel shading with at most a few tones per color. Limited palette, biased toward these colors: ' +
    PALETTE_HINT +
    '. Soft "CRT glow in a modern room" vibe — bright, warm, inviting.',
  'Canvas: 64x64 pixels, the creature head filling most of the frame, on a FULLY TRANSPARENT background (alpha). No background scene, no ground, no text, no frame, no drop shadow on the floor.',
  '',
  'HARD CONSTRAINTS (must all hold):',
  '- Must be an ORIGINAL creature design. Do NOT resemble, imitate, or reference any existing video-game character, cartoon mascot, brand, or franchise. No logos, no trademarks, no copyrighted characters.',
  '- Family-friendly and kid-safe: no gore, no weapons, no scary or sexual content, no text or words.',
  '- One single creature head only. Transparent background. Output as a PNG image.',
].join('\n');

/**
 * Moderation prompt for the *input photo*. Run before we spend a generation, on
 * a vision model; expects a strict JSON verdict. Conservative by design — when
 * unsure, reject and fall back (Principle 2: family-first).
 */
export const INPUT_MODERATION_PROMPT = [
  'You are a safety gate for a kids’ game that turns an uploaded photo into a cartoon avatar.',
  'Look at this image. Decide if it is acceptable to process.',
  'REJECT if it contains: nudity or sexual content, graphic violence or gore, hate symbols, illegal content, or anything clearly not suitable for children.',
  'It is FINE if it simply does not contain a face (we can still fall back gracefully) — only reject for unsafe content, not for absence of a person.',
  'Respond with ONLY a JSON object, no prose: {"safe": boolean, "reason": string}.',
].join('\n');

/**
 * Moderation prompt for the *generated sprite*, before it is ever shown to other
 * players in a room. Also catches accidental resemblance to a real franchise
 * (ADR-005 resemblance check, automated first pass).
 */
export const OUTPUT_MODERATION_PROMPT = [
  'You are reviewing an AI-generated cartoon creature head that will be shown to children in a multiplayer game.',
  'REJECT if it contains any of: unsafe-for-kids content (sexual, violent, hateful, disturbing); readable text or words; OR a clear resemblance to a known, trademarked video-game character, cartoon mascot, brand, or logo.',
  'APPROVE an original, friendly, kid-safe creature.',
  'Respond with ONLY a JSON object, no prose: {"safe": boolean, "reason": string}.',
].join('\n');

/** Parse a moderation model reply (which may be fenced or chatty) into a verdict.
 *  Fails closed: anything we cannot parse as an explicit `safe:true` is unsafe. */
export function parseModerationVerdict(text: string): { safe: boolean; reason: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { safe: false, reason: 'unparseable moderation response' };
  try {
    const obj = JSON.parse(match[0]) as { safe?: unknown; reason?: unknown };
    const safe = obj.safe === true;
    const reason = typeof obj.reason === 'string' ? obj.reason : '';
    return { safe, reason };
  } catch {
    return { safe: false, reason: 'invalid moderation JSON' };
  }
}

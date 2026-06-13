/**
 * Thin Gemini client: one image-edit call and one vision-moderation call, over
 * the Generative Language REST API. No SDK — a couple of fetches keep the worker
 * tiny and the dependency surface zero.
 *
 * The API key lives only in the worker (a secret); it is never sent to or
 * exposed in the client (ADR-004 constraint). Photo bytes pass through here to
 * the model and are never logged.
 */

import { parseModerationVerdict } from '@retro-recall/avatar';
import { fromBase64, toBase64 } from './bytes.js';
import { GEMINI_IMAGE_MODEL, GEMINI_VISION_MODEL } from './config.js';

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

interface InlinePart {
  inlineData?: { mimeType: string; data: string };
  text?: string;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
  promptFeedback?: { blockReason?: string };
}

export class GeminiError extends Error {}

async function call(model: string, apiKey: string, body: unknown): Promise<GeminiResponse> {
  const res = await fetch(ENDPOINT(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Surface status only — never the request body (it carries the photo).
    throw new GeminiError(`gemini ${model} HTTP ${res.status}`);
  }
  return (await res.json()) as GeminiResponse;
}

/** Image-to-image: returns the first image part as raw bytes + mime. */
export async function editImage(
  apiKey: string,
  prompt: string,
  photo: Uint8Array,
  photoMime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const body = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: photoMime, data: toBase64(photo) } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.4 },
  };
  const json = await call(GEMINI_IMAGE_MODEL, apiKey, body);
  if (json.promptFeedback?.blockReason) {
    throw new GeminiError(`image blocked: ${json.promptFeedback.blockReason}`);
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image?.inlineData) throw new GeminiError('image response had no inline image');
  return { bytes: fromBase64(image.inlineData.data), mime: image.inlineData.mimeType || 'image/png' };
}

/** Vision moderation: returns a fail-closed safe/reason verdict. */
export async function moderate(
  apiKey: string,
  prompt: string,
  image: Uint8Array,
  mime: string,
): Promise<{ safe: boolean; reason: string }> {
  const body = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: toBase64(image) } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const json = await call(GEMINI_VISION_MODEL, apiKey, body);
  if (json.promptFeedback?.blockReason) {
    return { safe: false, reason: `vision blocked: ${json.promptFeedback.blockReason}` };
  }
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return parseModerationVerdict(text);
}

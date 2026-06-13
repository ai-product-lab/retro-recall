/**
 * Local generation harness — runs the REAL avatar pipeline (the same locked
 * style prompt and palette quantization the worker uses) against Gemini, so we
 * can eyeball generations before wiring anything into the game (ADR-004 gate).
 *
 * This is a dev tool, not shipped code: it uses `sharp` for image I/O (robust
 * for whatever the model returns) instead of the worker's minimal PNG codec.
 * The quantize step is the exact same module the worker runs.
 *
 *   GEMINI_API_KEY=... pnpm --filter @retro-recall/avatar gen photo1.jpg photo2.png ...
 *
 * For each input it writes, into gen-out/ (git-ignored — input photos must never
 * be committed):
 *   <name>.raw.png      the model's head, as returned (pre-quantize)
 *   <name>.head.png     the final 24×24 PALETTE_P1 head the worker would store
 *   <name>.preview.png  that head at 16× (nearest-neighbor) for easy viewing
 *
 * Photos are read from disk and sent to the model; nothing about them is written
 * back out — mirroring the worker's "never persist the photo" rule.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import {
  INPUT_MODERATION_PROMPT,
  OUTPUT_MODERATION_PROMPT,
  STYLE_PROMPT,
  STYLE_PROMPT_VERSION,
  headToRgba,
  matteByBorderFill,
  parseModerationVerdict,
  quantizeToHead,
  upscale,
  type RgbaImage,
} from '../src/index.js';

const IMAGE_MODEL = 'gemini-2.5-flash-image';
const VISION_MODEL = 'gemini-2.5-flash';
const OUT_DIR = 'gen-out';
const PREVIEW_SCALE = 16;

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] } }[];
  promptFeedback?: { blockReason?: string };
}

async function callGemini(model: string, apiKey: string, body: unknown): Promise<GeminiResponse> {
  const res = await fetch(endpoint(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gemini ${model} HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as GeminiResponse;
}

async function moderate(apiKey: string, prompt: string, png: Buffer): Promise<{ safe: boolean; reason: string }> {
  const json = await callGemini(VISION_MODEL, apiKey, {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return parseModerationVerdict(text);
}

async function editImage(apiKey: string, png: Buffer): Promise<Buffer> {
  const json = await callGemini(IMAGE_MODEL, apiKey, {
    contents: [{ parts: [{ text: STYLE_PROMPT }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.4 },
  });
  if (json.promptFeedback?.blockReason) throw new Error(`blocked: ${json.promptFeedback.blockReason}`);
  const part = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part?.inlineData) throw new Error('no image part in response');
  return Buffer.from(part.inlineData.data, 'base64');
}

async function toRgbaImage(png: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

const rgbaToPng = (img: RgbaImage): Promise<Buffer> =>
  sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();

async function processPhoto(apiKey: string, path: string): Promise<void> {
  const name = basename(path, extname(path));
  process.stdout.write(`\n● ${name}\n`);

  // Client-side downscale to ≤512px, exactly what the browser sends (ADR-004).
  const photo = await sharp(path).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();

  const inV = await moderate(apiKey, INPUT_MODERATION_PROMPT, photo);
  process.stdout.write(`  input moderation:  ${inV.safe ? 'OK' : 'REJECT'} — ${inV.reason || 'ok'}\n`);
  if (!inV.safe) {
    process.stdout.write('  → would fall back to gallery; skipping.\n');
    return;
  }

  const raw = await editImage(apiKey, photo);
  const outV = await moderate(apiKey, OUTPUT_MODERATION_PROMPT, raw);
  process.stdout.write(`  output moderation: ${outV.safe ? 'OK' : 'REJECT'} — ${outV.reason || 'ok'}\n`);

  const head = quantizeToHead(matteByBorderFill(await toRgbaImage(raw)));
  const headRgba = headToRgba(head);

  await writeFile(join(OUT_DIR, `${name}.raw.png`), raw);
  await writeFile(join(OUT_DIR, `${name}.head.png`), await rgbaToPng(headRgba));
  await writeFile(join(OUT_DIR, `${name}.preview.png`), await rgbaToPng(upscale(headRgba, PREVIEW_SCALE)));
  process.stdout.write(`  wrote ${OUT_DIR}/${name}.{raw,head,preview}.png\n`);
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    process.stderr.write('Set GEMINI_API_KEY in the environment.\n');
    process.exit(1);
  }
  const photos = process.argv.slice(2);
  if (photos.length === 0) {
    process.stderr.write('Usage: pnpm --filter @retro-recall/avatar gen <photo> [photo...]\n');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  process.stdout.write(`Style prompt ${STYLE_PROMPT_VERSION} · ${photos.length} photo(s)\n`);
  for (const p of photos) {
    try {
      await processPhoto(apiKey, p);
    } catch (err) {
      process.stdout.write(`  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  process.stdout.write('\nDone.\n');
}

void main();

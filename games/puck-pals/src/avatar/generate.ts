/**
 * Client side of avatar generation (ADR-004): downscale the photo in the
 * browser, POST it to the Avatar Worker, hand back the resulting avatarId.
 *
 * Privacy: the photo is downscaled and sent straight to the worker (which
 * forwards it to the model and drops it). No AI runs on the client. Every
 * failure resolves to a `{ ok: false }` result, never throws: the UI shows the
 * gallery and play continues (Principle 2). Until the Avatar Worker is deployed
 * (Phase 3 close), this always degrades to the gallery — by design.
 */
import type { FallbackReason } from '@retro-recall/avatar';
import { AVATARS_ORIGIN } from '../shell/invite';

/** Longest edge we send to the worker (ADR-004: client-downscale to ≤512px). */
const MAX_EDGE = 512;

export type GenerateResult = { ok: true; avatarId: string } | { ok: false; reason: FallbackReason };

async function downscaleToPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('encode failed');
  return blob;
}

/** Turn a chosen photo into a generated avatar. `room` scopes the rate limit. */
export async function generateAvatar(file: File, room: string): Promise<GenerateResult> {
  let png: Blob;
  try {
    png = await downscaleToPng(file);
  } catch {
    return { ok: false, reason: 'bad_input' };
  }
  try {
    const res = await fetch(`${AVATARS_ORIGIN}/api/avatar?room=${encodeURIComponent(room)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    const data = (await res.json().catch(() => null)) as
      | { avatarId?: string; reason?: FallbackReason }
      | null;
    if (res.ok && data?.avatarId) return { ok: true, avatarId: data.avatarId };
    return { ok: false, reason: data?.reason ?? 'api_error' };
  } catch {
    return { ok: false, reason: 'api_error' };
  }
}

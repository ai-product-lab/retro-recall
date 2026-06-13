/**
 * AvatarStore: avatarId → a ready-to-blit sprite sheet, resolved once and
 * cached. The renderer reads synchronously (`get`); the shell warms the cache
 * (`ensure`) whenever the roster changes. A miss just means "not ready yet" —
 * the renderer falls back to the slot-colored placeholder, so a slow or failed
 * load never blocks the frame (Principle 2).
 *
 * Two kinds of id:
 *  - `gallery:N` — resolved locally from the built-in creatures (instant).
 *  - content-hash — the head PNG is fetched from the Avatar Worker's R2, then
 *    composited client-side (the worker only ever stores a head, per ADR-004).
 *
 * Compositing is identical for both, so a fallback player animates exactly like
 * a generated one.
 */

import {
  composeSheet,
  galleryHead,
  isGalleryId,
  quantizeToHead,
  sheetToRgba,
  type AvatarHead,
  type PoseName,
  type Pose,
} from '@retro-recall/avatar';
import { AVATARS_ORIGIN } from '../shell/invite';

export interface AvatarSprite {
  readonly bitmap: ImageBitmap;
  readonly frameSize: number;
  readonly frameCount: number;
  readonly poses: Readonly<Record<PoseName, Pose>>;
}

/** Compose a head into a sprite sheet and rasterize it to an ImageBitmap. */
async function buildSprite(head: AvatarHead): Promise<AvatarSprite> {
  const sheet = composeSheet(head);
  const rgba = sheetToRgba(sheet);
  const imageData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height);
  const bitmap = await createImageBitmap(imageData);
  return { bitmap, frameSize: sheet.frameSize, frameCount: sheet.frameCount, poses: sheet.poses };
}

/** Fetch a generated head PNG from the worker and decode it to an AvatarHead. */
async function fetchHead(avatarId: string): Promise<AvatarHead> {
  const res = await fetch(`${AVATARS_ORIGIN}/api/avatar/${avatarId}.png`);
  if (!res.ok) throw new Error(`head ${avatarId} HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return quantizeToHead({ width, height, data: new Uint8Array(data.buffer) });
}

export class AvatarStore {
  private readonly cache = new Map<string, AvatarSprite>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** Ids that failed to load — don't hammer the worker re-trying every frame. */
  private readonly failed = new Set<string>();

  /** Cached sprite for an id, or undefined if not loaded (yet / ever). */
  get(avatarId: string | undefined): AvatarSprite | undefined {
    return avatarId ? this.cache.get(avatarId) : undefined;
  }

  /** Kick off loading an id if it isn't cached, in flight, or known-bad. */
  ensure(avatarId: string | undefined): void {
    if (!avatarId || this.cache.has(avatarId) || this.inflight.has(avatarId) || this.failed.has(avatarId)) {
      return;
    }
    const load = (async (): Promise<void> => {
      const head = isGalleryId(avatarId) ? galleryHead(avatarId) : await fetchHead(avatarId);
      if (!head) throw new Error(`bad avatarId ${avatarId}`);
      this.cache.set(avatarId, await buildSprite(head));
    })();
    this.inflight.set(
      avatarId,
      load
        .catch(() => {
          this.failed.add(avatarId);
        })
        .finally(() => this.inflight.delete(avatarId)),
    );
  }

  /** Resolve a single id, awaiting load (used by the picker preview). null on
   *  failure. */
  async load(avatarId: string): Promise<AvatarSprite | null> {
    this.ensure(avatarId);
    await this.inflight.get(avatarId);
    return this.cache.get(avatarId) ?? null;
  }
}

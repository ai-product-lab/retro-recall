/**
 * HeadStore: avatarId → a ready-to-blit 24×24 head ImageBitmap, resolved once
 * and cached. The renderer reads synchronously (`get`); the shell warms the
 * cache (`ensure`) when the roster changes. A miss just means "not ready yet" —
 * the renderer falls back to a plain box, so a slow/failed load never blocks a
 * frame (Principle 2). Puck Pals renders the *head* on a team-tinted skater body
 * (a bobblehead skater) rather than the Bubble Buddies body rig; the full
 * skater rig is a deferred shared-package follow-up (SPEC §12).
 *
 * Two id kinds:
 *  - `gallery:N` — resolved locally from the built-in creatures (instant, no
 *    server), so avatars work fully offline.
 *  - content-hash — the head PNG is fetched from the Avatar Worker's R2.
 */
import { galleryHead, headToRgba, isGalleryId } from '@retro-recall/avatar';
import { AVATARS_ORIGIN } from '../shell/invite';
import type { SkaterState } from '../sim/sim';
import { avatarIdForSkater } from './assign';

/** Rasterize a gallery head (palette indices) to an ImageBitmap. */
async function galleryBitmap(id: string): Promise<ImageBitmap | null> {
  const head = galleryHead(id);
  if (!head) return null;
  const rgba = headToRgba(head);
  const image = new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height);
  return createImageBitmap(image);
}

/** Fetch a generated head PNG from the worker as an ImageBitmap. */
async function fetchBitmap(id: string): Promise<ImageBitmap> {
  const res = await fetch(`${AVATARS_ORIGIN}/api/avatar/${id}.png`);
  if (!res.ok) throw new Error(`head ${id} HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

export class HeadStore {
  private readonly cache = new Map<string, ImageBitmap>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();

  /** Cached head for an id, or undefined if not loaded (yet / ever). */
  get(avatarId: string | undefined): ImageBitmap | undefined {
    return avatarId ? this.cache.get(avatarId) : undefined;
  }

  /** Kick off loading an id if it isn't cached, in flight, or known-bad. */
  ensure(avatarId: string | undefined): void {
    if (!avatarId || this.cache.has(avatarId) || this.inflight.has(avatarId) || this.failed.has(avatarId)) {
      return;
    }
    const load = (async (): Promise<void> => {
      const bmp = isGalleryId(avatarId) ? await galleryBitmap(avatarId) : await fetchBitmap(avatarId);
      if (!bmp) throw new Error(`bad avatarId ${avatarId}`);
      this.cache.set(avatarId, bmp);
    })();
    this.inflight.set(
      avatarId,
      load.catch(() => void this.failed.add(avatarId)).finally(() => this.inflight.delete(avatarId)),
    );
  }

  /** Resolve a single id, awaiting load (used by the picker preview). */
  async load(avatarId: string): Promise<ImageBitmap | null> {
    this.ensure(avatarId);
    await this.inflight.get(avatarId);
    return this.cache.get(avatarId) ?? null;
  }
}

/**
 * The avatar a skater wears: a human's picked id if bound to a known slot,
 * else a deterministic gallery creature (so CPUs always have a face and the
 * rink reads as full). Stable per skater, so heads don't flicker.
 */
/** Warm every skater's head, then return a sync resolver the renderer can use. */
export function headResolver(
  store: HeadStore,
  skaters: readonly SkaterState[],
  humanAvatars: ReadonlyMap<number, string>,
): (s: SkaterState) => ImageBitmap | undefined {
  for (const s of skaters) store.ensure(avatarIdForSkater(s, humanAvatars));
  return (s) => store.get(avatarIdForSkater(s, humanAvatars));
}

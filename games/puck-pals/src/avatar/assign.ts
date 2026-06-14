/**
 * Which avatar a skater wears — a pure, DOM-free mapping so it's unit-testable
 * (the head store + renderer are DOM-bound). A human's picked id wins for a
 * bound slot; everyone else gets a deterministic gallery creature, so CPUs
 * always have a face and a given skater's head never flickers between frames.
 */
import { GALLERY_SIZE, galleryId } from '@retro-recall/avatar';
import * as C from '../sim/constants';
import type { SkaterState } from '../sim/sim';

export function avatarIdForSkater(s: SkaterState, humanAvatars: ReadonlyMap<number, string>): string {
  if (s.slot >= 0) {
    const picked = humanAvatars.get(s.slot);
    if (picked) return picked;
  }
  return galleryId((s.team * C.SKATERS_PER_TEAM + s.index) % GALLERY_SIZE);
}

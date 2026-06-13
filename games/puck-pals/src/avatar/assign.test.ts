import { describe, expect, it } from 'vitest';
import { GALLERY_SIZE, isGalleryId } from '@retro-recall/avatar';
import { avatarIdForSkater } from './assign';
import type { SkaterState } from '../sim/sim';

const skater = (id: number, team: number, index: number, slot: number): SkaterState =>
  ({ id, team, index, slot } as SkaterState);

describe('avatarIdForSkater', () => {
  it('gives every CPU skater a stable, valid gallery creature', () => {
    const ids = [
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, 2],
      [10, 1, 0],
      [11, 1, 1],
      [12, 1, 2],
    ].map(([id, team, index]) => avatarIdForSkater(skater(id!, team!, index!, -1), new Map()));
    expect(ids.every(isGalleryId)).toBe(true);
    // Deterministic + distinct across the six skaters (team*3+index < GALLERY_SIZE=8).
    expect(new Set(ids).size).toBe(6);
    // Stable across calls.
    expect(avatarIdForSkater(skater(0, 0, 0, -1), new Map())).toBe(ids[0]);
  });

  it("uses a bound human's picked avatar for their slot", () => {
    const picked = new Map([[0, 'gallery:5']]);
    expect(avatarIdForSkater(skater(0, 0, 0, 0), picked)).toBe('gallery:5');
  });

  it('falls back to a gallery creature when the slot has no pick yet', () => {
    const id = avatarIdForSkater(skater(10, 1, 0, 1), new Map());
    expect(isGalleryId(id)).toBe(true);
  });

  it('stays within the gallery range for any team/index', () => {
    for (let team = 0; team < 2; team++) {
      for (let index = 0; index < 3; index++) {
        const id = avatarIdForSkater(skater(team * 10 + index, team, index, -1), new Map());
        const n = Number(id.split(':')[1]);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(GALLERY_SIZE);
      }
    }
  });
});

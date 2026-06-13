import { describe, expect, it } from 'vitest';
import { PALETTE_P1 } from './palette.js';
import { HEAD_SIZE } from './types.js';
import { GALLERY, GALLERY_SIZE, galleryHead, galleryId, galleryIndex, isGalleryId } from './gallery.js';
import { composeSheet } from './sprite.js';

describe('gallery', () => {
  it('has GALLERY_SIZE heads, all HEAD_SIZE, palette-valid', () => {
    expect(GALLERY).toHaveLength(GALLERY_SIZE);
    for (const head of GALLERY) {
      expect(head.size).toBe(HEAD_SIZE);
      expect(head.indices.length).toBe(HEAD_SIZE * HEAD_SIZE);
      for (const i of head.indices) expect(PALETTE_P1[i]).toBeDefined();
    }
  });

  it('every creature has a transparent border and an opaque, outlined body', () => {
    for (const head of GALLERY) {
      expect(head.indices[0]).toBe(0); // top-left corner transparent
      const opaque = head.indices.filter((i) => i !== 0).length;
      expect(opaque).toBeGreaterThan(HEAD_SIZE * HEAD_SIZE * 0.3); // a real head, not a speck
      expect([...head.indices]).toContain(1); // has outline pixels
    }
  });

  it('creatures are visually distinct (no two identical)', () => {
    const seen = new Set(GALLERY.map((h) => h.indices.join(',')));
    expect(seen.size).toBe(GALLERY_SIZE);
  });

  it('round-trips ids', () => {
    for (let i = 0; i < GALLERY_SIZE; i++) {
      const id = galleryId(i);
      expect(isGalleryId(id)).toBe(true);
      expect(galleryIndex(id)).toBe(i);
      expect(galleryHead(id)).toBe(GALLERY[i]);
    }
  });

  it('rejects non-gallery ids', () => {
    expect(isGalleryId('abc123')).toBe(false);
    expect(isGalleryId('gallery:')).toBe(false);
    expect(isGalleryId('gallery:x')).toBe(false);
    expect(galleryHead('gallery:99')).toBeNull();
    expect(galleryHead('deadbeef')).toBeNull();
  });

  it('composes into a full animated sheet like a generated head', () => {
    const sheet = composeSheet(GALLERY[0]!);
    expect(sheet.frameCount).toBeGreaterThan(0);
    expect(sheet.indices.some((i) => i !== 0)).toBe(true);
  });
});

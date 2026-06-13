import { describe, expect, it } from 'vitest';
import { PALETTE_P1 } from './palette.js';
import { decodePng, encodePng } from './png.js';
import { downscaleSquare, headToRgba, matteByBorderFill, nearestIndex, quantizeToHead } from './quantize.js';
import type { RgbaImage } from './types.js';

/** Read the alpha of pixel (x, y). */
const alphaAt = (img: RgbaImage, x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3]!;

/** Paint a filled rect of one RGB into an existing image. */
function paint(img: RgbaImage, x0: number, y0: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const s = (y * img.width + x) * 4;
      img.data[s] = r;
      img.data[s + 1] = g;
      img.data[s + 2] = b;
      img.data[s + 3] = 255;
    }
  }
}

/** Fill a W×H image with one solid RGBA. */
function solid(width: number, height: number, r: number, g: number, b: number, a = 255): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

describe('nearestIndex', () => {
  it('maps each palette color exactly to itself', () => {
    PALETTE_P1.forEach((c, i) => {
      if (c.a === 0) return;
      expect(nearestIndex(c.r, c.g, c.b)).toBe(i);
    });
  });

  it('never returns the transparent index', () => {
    expect(nearestIndex(0, 0, 0)).not.toBe(0);
    expect(nearestIndex(255, 255, 255)).not.toBe(0);
  });
});

describe('quantizeToHead', () => {
  it('produces a HEAD_SIZE indexed head and snaps a solid Phosphor image to index 4', () => {
    const p = PALETTE_P1[4]!; // Phosphor mint
    const head = quantizeToHead(solid(64, 64, p.r, p.g, p.b));
    expect(head.size).toBe(24);
    expect(head.indices.length).toBe(24 * 24);
    expect([...head.indices].every((i) => i === 4)).toBe(true);
  });

  it('treats low-alpha pixels as transparent (index 0)', () => {
    const head = quantizeToHead(solid(48, 48, 255, 107, 107, 10));
    expect([...head.indices].every((i) => i === 0)).toBe(true);
  });

  it('is deterministic — same input, identical indices', () => {
    const img = solid(40, 40, 76, 201, 240); // Bubble cyan
    expect(quantizeToHead(img).indices).toEqual(quantizeToHead(img).indices);
  });
});

describe('downscaleSquare', () => {
  it('keeps a solid color and full alpha', () => {
    const out = downscaleSquare(solid(100, 100, 255, 209, 102), 24);
    expect(out.width).toBe(24);
    expect(out.data[3]).toBe(255);
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([255, 209, 102]);
  });
});

describe('matteByBorderFill', () => {
  it('knocks out a solid background, keeping the foreground opaque', () => {
    // Magenta key with a coral block in the middle (the "head").
    const img = solid(16, 16, 255, 0, 255);
    paint(img, 4, 4, 8, 8, 255, 107, 107);
    const out = matteByBorderFill(img);
    expect(alphaAt(out, 0, 0)).toBe(0); // corner background → transparent
    expect(alphaAt(out, 8, 8)).toBe(255); // foreground center → kept
  });

  it('only removes the border-connected region (interior key pixels survive)', () => {
    // A foreground that fully encloses a single background-colored pixel.
    const img = solid(16, 16, 255, 0, 255);
    paint(img, 3, 3, 10, 10, 255, 107, 107); // coral block
    paint(img, 8, 8, 1, 1, 255, 0, 255); // a magenta pixel trapped inside
    const out = matteByBorderFill(img);
    expect(alphaAt(out, 0, 0)).toBe(0); // outside background → gone
    expect(alphaAt(out, 8, 8)).toBe(255); // enclosed key pixel → protected
  });

  it('is a no-op when the border is already transparent', () => {
    const img = solid(8, 8, 61, 245, 166, 0);
    const out = matteByBorderFill(img);
    expect(out.data).toEqual(img.data);
  });

  it('leaves the foreground fully opaque after quantizing a matted head', () => {
    const img = solid(48, 48, 255, 0, 255);
    paint(img, 12, 12, 24, 24, 255, 209, 102); // arcade-yellow head
    const head = quantizeToHead(matteByBorderFill(img));
    const rgba = headToRgba(head);
    let transparent = 0;
    let opaque = 0;
    for (let i = 3; i < rgba.data.length; i += 4) {
      if (rgba.data[i] === 0) transparent++;
      else opaque++;
    }
    expect(transparent).toBeGreaterThan(0); // background was keyed out
    expect(opaque).toBeGreaterThan(0); // head survived
  });
});

describe('png codec round-trip', () => {
  it('encodes then decodes RGBA exactly', async () => {
    const head = quantizeToHead(solid(64, 64, 255, 107, 107));
    const img = headToRgba(head);
    const png = await encodePng(img);
    const back = await decodePng(png);
    expect(back.width).toBe(24);
    expect(back.height).toBe(24);
    expect(back.data).toEqual(img.data);
  });

  it('preserves transparency through a round-trip', async () => {
    const img = solid(8, 8, 61, 245, 166, 0);
    const back = await decodePng(await encodePng(img));
    for (let i = 0; i < back.data.length; i += 4) expect(back.data[i + 3]).toBe(0);
  });
});

/**
 * Palette quantization + downscale. Pure functions over RgbaImage/AvatarHead —
 * no DOM, no canvas, no sharp — so the worker and the harness share one
 * implementation and the result is byte-for-byte deterministic (the content
 * hash that becomes `avatarId` depends on it).
 */

import { ALPHA_CUTOFF, PALETTE_P1, type Rgba } from './palette.js';
import { HEAD_SIZE, type AvatarHead, type RgbaImage } from './types.js';

/** Opaque palette entries paired with their PALETTE_P1 index (skips index 0). */
const OPAQUE: ReadonlyArray<{ index: number; c: Rgba }> = PALETTE_P1.map((c, index) => ({ index, c })).filter(
  (e) => e.c.a !== 0,
);

/** Nearest opaque palette index for an (r,g,b) by squared distance. Weighted
 *  toward perceived luminance (a cheap, fixed approximation of how the eye
 *  weights the channels) so skin/coral tones don't snap to a garish neighbor. */
export function nearestIndex(r: number, g: number, b: number): number {
  let best = OPAQUE[0]!.index;
  let bestD = Infinity;
  for (const { index, c } of OPAQUE) {
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
    if (d < bestD) {
      bestD = d;
      best = index;
    }
  }
  return best;
}

/** Area-average downscale to `out`×`out`. Color is averaged premultiplied by
 *  alpha so transparent edges don't bleed dark halos into the sprite. */
export function downscaleSquare(img: RgbaImage, out: number): RgbaImage {
  const { width: W, height: H, data } = img;
  const dst = new Uint8Array(out * out * 4);
  for (let oy = 0; oy < out; oy++) {
    const sy0 = Math.floor((oy * H) / out);
    const sy1 = Math.max(sy0 + 1, Math.floor(((oy + 1) * H) / out));
    for (let ox = 0; ox < out; ox++) {
      const sx0 = Math.floor((ox * W) / out);
      const sx1 = Math.max(sx0 + 1, Math.floor(((ox + 1) * W) / out));
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const s = (sy * W + sx) * 4;
          const a = data[s + 3]!;
          pr += data[s]! * a;
          pg += data[s + 1]! * a;
          pb += data[s + 2]! * a;
          pa += a;
          n++;
        }
      }
      const d = (oy * out + ox) * 4;
      const avgA = pa / n;
      if (pa > 0) {
        dst[d] = Math.round(pr / pa);
        dst[d + 1] = Math.round(pg / pa);
        dst[d + 2] = Math.round(pb / pa);
      }
      dst[d + 3] = Math.round(avgA);
    }
  }
  return { width: out, height: out, data: dst };
}

/**
 * Knock out the background by a border flood-fill, returning a copy with the
 * connected edge region made transparent.
 *
 * Why this exists: image models reliably *ignore* "transparent background" and
 * hand back an opaque fill (a flat color, or the keyed background the style
 * prompt asks for). So we don't trust alpha — we matte. Starting from the cell
 * edges, any pixel whose color is within `tolerance` of the sampled background
 * (or already transparent) joins the matte and spreads to its neighbors; the
 * head's dark outline is far from the background color, so the fill stops there.
 *
 * Border-connected only: a background-colored pixel *inside* the face (a glint,
 * a tooth) is never reached, so the face stays intact. Pure and deterministic —
 * the matte is part of what the content hash commits to.
 */
export function matteByBorderFill(img: RgbaImage, tolerance = 64): RgbaImage {
  const { width: W, height: H, data } = img;
  const out = new Uint8Array(data);

  // Background color := average of the opaque corners. If the border is already
  // transparent there is nothing to key — return the copy unchanged.
  let br = 0;
  let bg = 0;
  let bb = 0;
  let n = 0;
  for (const [cx, cy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]] as const) {
    const s = (cy * W + cx) * 4;
    if (data[s + 3]! >= ALPHA_CUTOFF) {
      br += data[s]!;
      bg += data[s + 1]!;
      bb += data[s + 2]!;
      n++;
    }
  }
  if (n === 0) return { width: W, height: H, data: out };
  br /= n;
  bg /= n;
  bb /= n;
  const tol2 = tolerance * tolerance;

  const isBg = (p: number): boolean => {
    const s = p * 4;
    if (data[s + 3]! < ALPHA_CUTOFF) return true;
    const dr = data[s]! - br;
    const dg = data[s + 1]! - bg;
    const db = data[s + 2]! - bb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (x: number, y: number): void => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const p = y * W + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (isBg(p)) stack.push(p);
  };
  for (let x = 0; x < W; x++) {
    visit(x, 0);
    visit(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    visit(0, y);
    visit(W - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    out[p * 4 + 3] = 0;
    const x = p % W;
    const y = (p / W) | 0;
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  return { width: W, height: H, data: out };
}

/** Downscale to HEAD_SIZE and snap every pixel to PALETTE_P1. Pixels below the
 *  alpha cutoff become index 0 (transparent). */
export function quantizeToHead(img: RgbaImage, size = HEAD_SIZE): AvatarHead {
  const small = img.width === size && img.height === size ? img : downscaleSquare(img, size);
  const indices = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const s = i * 4;
    indices[i] = small.data[s + 3]! < ALPHA_CUTOFF ? 0 : nearestIndex(small.data[s]!, small.data[s + 1]!, small.data[s + 2]!);
  }
  return { size, indices };
}

/** Expand an indexed head back to RGBA for PNG encoding / preview. */
export function headToRgba(head: AvatarHead): RgbaImage {
  const { size, indices } = head;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < indices.length; i++) {
    const c = PALETTE_P1[indices[i]!]!;
    const d = i * 4;
    data[d] = c.r;
    data[d + 1] = c.g;
    data[d + 2] = c.b;
    data[d + 3] = c.a;
  }
  return { width: size, height: size, data };
}

/** Integer nearest-neighbor upscale, for crisp previews of tiny sprites. */
export function upscale(img: RgbaImage, factor: number): RgbaImage {
  const { width: W, height: H, data } = img;
  const w = W * factor;
  const h = H * factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / factor);
      const s = (sy * W + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = data[s]!;
      out[d + 1] = data[s + 1]!;
      out[d + 2] = data[s + 2]!;
      out[d + 3] = data[s + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Minimal PNG codec — 8-bit truecolor (RGB / RGBA) only, no interlace.
 *
 * Why hand-rolled: the Avatar Worker runs on the Cloudflare Workers runtime,
 * which has no canvas and no `sharp`. The only image we decode/encode in the
 * worker is the model's output (a head we then quantize) — small, and a format
 * we control — so a tiny codec beats pulling in a binary dependency. It relies
 * only on `CompressionStream`/`DecompressionStream`, present in both Workers and
 * Node 18+, so the same code runs in the worker and the local gen harness.
 *
 * The uploaded *photo* is never decoded here — it is forwarded to the model as
 * opaque bytes (and then dropped), so JPEG support is intentionally absent.
 */

import type { RgbaImage } from './types.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipeThrough(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const src = new Response(bytes as BodyInit).body;
  if (!src) throw new Error('png: no readable body for (de)compression');
  const out = src.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>);
  const buf = await new Response(out).arrayBuffer();
  return new Uint8Array(buf);
}

const inflate = (b: Uint8Array): Promise<Uint8Array> => pipeThrough(b, new DecompressionStream('deflate'));
const deflate = (b: Uint8Array): Promise<Uint8Array> => pipeThrough(b, new CompressionStream('deflate'));

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('png: bad signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];

  let off = 8;
  while (off < bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      const bitDepth = bytes[off + 16]!;
      colorType = bytes[off + 17]!;
      const interlace = bytes[off + 20]!;
      if (bitDepth !== 8) throw new Error(`png: unsupported bit depth ${bitDepth}`);
      if (colorType !== 2 && colorType !== 6) throw new Error(`png: unsupported color type ${colorType}`);
      if (interlace !== 0) throw new Error('png: interlace unsupported');
    } else if (type === 'IDAT') {
      idat.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  const merged = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let m = 0;
  for (const c of idat) {
    merged.set(c, m);
    m += c.length;
  }
  const raw = await inflate(merged);

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);

  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[p++]!;
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let val: number;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`png: bad filter ${filter}`);
      }
      cur[x] = val & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = cur[s]!;
      out[d + 1] = cur[s + 1]!;
      out[d + 2] = cur[s + 2]!;
      out[d + 3] = channels === 4 ? cur[s + 3]! : 255;
    }
    prev.set(cur);
  }

  return { width, height, data: out };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePng(img: RgbaImage): Promise<Uint8Array> {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const compressed = await deflate(raw);

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // ihdr[10..12] = 0 (deflate / adaptive filter / no interlace)

  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

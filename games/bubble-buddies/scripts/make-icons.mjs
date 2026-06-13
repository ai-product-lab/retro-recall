/**
 * Generates the PWA icon PNGs from the brand pixel bubble (branding/logo.svg,
 * 12×11 cell grid) — zero image dependencies, just a minimal PNG encoder on
 * node:zlib. Deterministic: same script, same bytes.
 *
 *   node scripts/make-icons.mjs   (writes into public/icons/)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Palette (branding/BRAND.md) ---
const MIDNIGHT = [15, 18, 34];
const BUBBLE = [76, 201, 240];
const PHOSPHOR = [61, 245, 166];

// --- Art: the logo's pixel bubble on a 16×16 frame (bubble is 12×11) ---
const FRAME = 16;
const OFF_X = 2;
const OFF_Y = 2;

/** Bubble outline cells per row (from branding/logo.svg, coords ÷ 8). */
const OUTLINE = [
  [4, 5, 6, 7],
  [2, 3, 8, 9],
  [1, 10],
  [1, 10],
  [0, 11],
  [0, 11],
  [0, 11],
  [0, 11],
  [1, 10],
  [2, 3, 8, 9],
  [4, 5, 6, 7],
];
const SHINE = [
  [3, 2],
  [4, 2],
  [2, 3],
  [2, 4],
];
/** Faint inner glow: cells x 2..9, y 2..8 at 18% cyan over whatever's there. */
const GLOW = { x0: 2, x1: 9, y0: 2, y1: 8, alpha: 0.18 };

const blend = (under, over, a) => under.map((u, i) => Math.round(u * (1 - a) + over[i] * a));

function buildFrame() {
  const grid = Array.from({ length: FRAME }, () => Array.from({ length: FRAME }, () => MIDNIGHT));
  OUTLINE.forEach((cols, row) => {
    for (const col of cols) grid[OFF_Y + row][OFF_X + col] = BUBBLE;
  });
  for (const [col, row] of SHINE) grid[OFF_Y + row][OFF_X + col] = PHOSPHOR;
  for (let y = GLOW.y0; y <= GLOW.y1; y++) {
    for (let x = GLOW.x0; x <= GLOW.x1; x++) {
      grid[OFF_Y + y][OFF_X + x] = blend(grid[OFF_Y + y][OFF_X + x], BUBBLE, GLOW.alpha);
    }
  }
  return grid;
}

// --- Minimal PNG encoder (8-bit RGBA, no filtering) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function encodePng(size, pixelAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const grid = buildFrame();
const nearest = (size) => (x, y) =>
  grid[Math.floor((y * FRAME) / size)][Math.floor((x * FRAME) / size)];

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512], // same art: bubble sits inside the 80% safe zone
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(outDir, name), encodePng(size, nearest(size)));
  console.log(`wrote public/icons/${name}`);
}

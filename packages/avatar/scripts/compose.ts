/**
 * Local compositor harness (ADR-004 step 2 eyeball gate) — the sibling of
 * scripts/gen.ts. Takes the heads gen.ts produced and runs the REAL compositor
 * (`composeSheet`, the same code the browser runs at join time) to show the full
 * animated sprite sheet before we wire it into the game.
 *
 *   pnpm --filter @retro-recall/avatar compose [head.png ...]
 *
 * With no args it composes every gen-out/<name>.head.png. For each head it
 * writes, into gen-out/:
 *   <name>.sheet.png    the composed strip (16×16 × 12 frames), at 1×
 *   <name>.sheet8x.png  the same strip at 8× (nearest-neighbor) for viewing
 *
 * Open gen-out/index.html to see the strips animate (idle + walk cycles).
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  composeSheet,
  decodePng,
  encodePng,
  quantizeToHead,
  sheetToRgba,
  upscale,
} from '../src/index.js';

const OUT_DIR = 'gen-out';
const SCALE = 8;

async function composeOne(path: string): Promise<void> {
  const name = basename(path).replace(/\.head\.png$/, '').replace(/\.png$/, '');
  const head = quantizeToHead(await decodePng(new Uint8Array(await readFile(path))));
  const sheet = composeSheet(head);
  const rgba = sheetToRgba(sheet);

  await writeFile(join(OUT_DIR, `${name}.sheet.png`), await encodePng(rgba));
  await writeFile(join(OUT_DIR, `${name}.sheet8x.png`), await encodePng(upscale(rgba, SCALE)));
  process.stdout.write(`● ${name}: ${sheet.frameCount} frames → ${OUT_DIR}/${name}.sheet{,8x}.png\n`);
}

async function main(): Promise<void> {
  let heads = process.argv.slice(2);
  if (heads.length === 0) {
    const files = await readdir(OUT_DIR).catch(() => [] as string[]);
    heads = files.filter((f) => f.endsWith('.head.png')).map((f) => join(OUT_DIR, f));
  }
  if (heads.length === 0) {
    process.stderr.write('No heads. Run `gen` first, or pass head PNG paths.\n');
    process.exit(1);
  }
  for (const h of heads) {
    try {
      await composeOne(h);
    } catch (err) {
      process.stdout.write(`  ✗ ${h}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  process.stdout.write('\nDone. Open gen-out/index.html to watch them animate.\n');
}

void main();

#!/usr/bin/env node
/**
 * `pnpm new-game <id>` — the game factory (ADR-006 / ADR-009 Stage 1).
 *
 * Generates a complete, building, testing game from tools/scaffold/template/:
 * a deterministic sim implementing the NetSim contract, a SPEC.md template,
 * renderer + dual-orientation touch shell (ADR-007), a replay-fixture test, and
 * the play route. Then wires the shared seams additively — the site registry,
 * the rooms-worker game registry, and the TS project graph — at stable anchors,
 * so `--remove <id>` reverses every change cleanly.
 *
 *   pnpm new-game puck-pals
 *   pnpm new-game --remove puck-pals
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = join(ROOT, 'tools/scaffold/template');

// --- args ---------------------------------------------------------------

const argv = process.argv.slice(2);
const remove = argv.includes('--remove') || argv.includes('-r');
const id = argv.find((a) => !a.startsWith('-'));

const die = (msg) => {
  console.error('✗ ' + msg);
  process.exit(1);
};

if (!id) die('usage: pnpm new-game <id>   (or: pnpm new-game --remove <id>)');
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
  die(`game id must be kebab-case (got '${id}'), e.g. puck-pals`);
}

const titleCase = id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
const pascal = id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
const names = {
  __ID__: id,
  __NAME__: titleCase,
  __CLASS__: pascal,
  __PKG__: '@retro-recall/' + id,
};

const subst = (text) =>
  text
    .replaceAll('__PKG__', names.__PKG__)
    .replaceAll('__NAME__', names.__NAME__)
    .replaceAll('__CLASS__', names.__CLASS__)
    .replaceAll('__ID__', names.__ID__);

const gameDir = join(ROOT, 'games', id);
const read = (f) => readFileSync(f, 'utf8');
const write = (f, s) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, s);
};

// --- shared-file edits (the exact insert strings double as remove keys) ---

const registryEntry =
  `  {\n` +
  `    id: '${id}',\n` +
  `    name: '${titleCase}',\n` +
  `    tagline: 'A new arcade original.',\n` +
  `    players: '1–4',\n` +
  `    mode: 'co-op',\n` +
  `    status: 'coming-soon',\n` +
  `    accent: '#3df5a6',\n` +
  `    art: 'bubbles',\n` +
  `    teaser: {\n` +
  `      twist: 'Scaffolded with pnpm new-game — write games/${id}/SPEC.md, then build it.',\n` +
  `      notes: ['Engine stub renders; replay fixture wired.'],\n` +
  `    },\n` +
  `  },\n`;

/** Each edit: insert `ins` adjacent to `anchor` in `file`. */
const EDITS = [
  {
    file: join(ROOT, 'tsconfig.json'),
    anchor: '    { "path": "games/bubble-buddies" },\n',
    ins: `    { "path": "games/${id}" },\n`,
    where: 'after',
  },
  {
    file: join(ROOT, 'workers/rooms/tsconfig.json'),
    anchor: '    { "path": "../../games/bubble-buddies" }',
    ins: `    { "path": "../../games/${id}" },\n`,
    where: 'before',
  },
  {
    file: join(ROOT, 'workers/rooms/package.json'),
    anchor: '    "@retro-recall/bubble-buddies": "workspace:*",',
    ins: `    "@retro-recall/${id}": "workspace:*",\n`,
    where: 'before',
  },
  {
    file: join(ROOT, 'workers/rooms/src/games.ts'),
    anchor: "import { BubbleBuddiesSim } from '@retro-recall/bubble-buddies';\n",
    ins: `import { ${pascal}Sim } from '@retro-recall/${id}';\n`,
    where: 'after',
  },
  {
    file: join(ROOT, 'workers/rooms/src/games.ts'),
    anchor: '  // <scaffold:games>',
    ins: `  '${id}': (seed) => new ${pascal}Sim(seed),\n`,
    where: 'before',
  },
  {
    file: join(ROOT, 'site/registry.ts'),
    anchor: '  // <scaffold:registry>',
    ins: registryEntry,
    where: 'before',
  },
];

const applyEdits = () => {
  for (const e of EDITS) {
    const s = read(e.file);
    if (s.includes(e.ins)) continue; // idempotent
    if (!s.includes(e.anchor)) die(`anchor not found in ${relative(ROOT, e.file)} — template drift?`);
    const replacement = e.where === 'after' ? e.anchor + e.ins : e.ins + e.anchor;
    write(e.file, s.replace(e.anchor, replacement));
  }
};

const revertEdits = () => {
  for (const e of EDITS) {
    const s = read(e.file);
    if (s.includes(e.ins)) write(e.file, s.replace(e.ins, ''));
  }
};

// --- generate / remove --------------------------------------------------

/** Recursively copy the template tree, substituting tokens in paths + contents. */
const walk = (srcDir, dstDir) => {
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const outName = subst(entry.replace('__id__', id)).replace(/\.tmpl$/, '');
    const dst = join(dstDir, outName);
    if (statSync(src).isDirectory()) walk(src, dst);
    else write(dst, subst(read(src)));
  }
};

const install = () => {
  console.log('• pnpm install (linking the workspace)…');
  execSync('corepack pnpm install', { cwd: ROOT, stdio: 'inherit' });
};

if (remove) {
  if (existsSync(gameDir)) rmSync(gameDir, { recursive: true, force: true });
  revertEdits();
  install();
  console.log(`\n✓ removed game '${id}' and reverted its registry / worker / tsconfig entries.`);
  process.exit(0);
}

if (existsSync(gameDir)) die(`games/${id} already exists`);

console.log(`• scaffolding games/${id} (${titleCase})…`);
walk(TEMPLATE, gameDir);
applyEdits();
install();

console.log(`
✓ created '${id}'. Next:
  1. Write games/${id}/SPEC.md from games/${id}/BRIEF.md, then get it approved.
  2. pnpm --filter ${names.__PKG__} dev        # solo-practice the stub
  3. pnpm test                                 # writes test/fixtures/replay-001.json — commit it
  4. Build the sim, renderer, and netcode per the SPEC.
`);

#!/usr/bin/env node
/**
 * Build + stitch the deployable site tree (`dist-deploy/`).
 *
 * Pages serves one tree: the library home at `/`, each live game's client under
 * `/play/<game>/`, all sharing a single content-hashed `/assets/`. This script
 * is the committed, registry-driven version of the manual stitch in
 * docs/PHASE-*-CLOSE deploy guides — so adding a game is a one-line edit to
 * `site/registry.ts`, never a doc/CI change.
 *
 * The set of games to build + stitch is derived from the registry's
 * `status: 'live'` entries — the single source of truth (same list the home
 * uses to render live tiles). A coming-soon game is intentionally NOT stitched
 * (its tile is a teaser with no `/play/<id>/`).
 *
 * Usage:
 *   node tools/build-site.mjs            # build live games + site, then stitch
 *   node tools/build-site.mjs --stitch-only   # skip builds, just stitch existing dist-web/
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STITCH_ONLY = process.argv.includes('--stitch-only');

/**
 * Live game ids, parsed from site/registry.ts. Each entry lists `id` before
 * `status` with no intervening `}` (status precedes the nested `teaser {...}`),
 * so a non-greedy id→status pair is unambiguous per entry.
 */
function liveGameIds() {
  const src = readFileSync(join(ROOT, 'site/registry.ts'), 'utf8');
  const ids = [];
  const re = /id:\s*'([^']+)'[\s\S]*?status:\s*'(live|coming-soon)'/g;
  for (const m of src.matchAll(re)) {
    if (m[2] === 'live') ids.push(m[1]);
  }
  if (ids.length === 0) throw new Error('No live games found in site/registry.ts — refusing to build an empty site.');
  return ids;
}

/** Run a package's build via the same package manager that invoked us. */
function pnpmBuild(pkg) {
  // npm_execpath is the pnpm cli when run as `pnpm build:site` (corepack or CI);
  // fall back to a bare `pnpm` on PATH when run directly via node.
  const pm = process.env.npm_execpath;
  const [cmd, baseArgs] = pm ? [process.execPath, [pm]] : ['pnpm', []];
  console.log(`  building ${pkg}…`);
  execFileSync(cmd, [...baseArgs, '--filter', pkg, 'build'], { cwd: ROOT, stdio: 'inherit' });
}

function stitch(games) {
  const out = join(ROOT, 'dist-deploy');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  mkdirSync(join(out, 'play'), { recursive: true });

  // Home + its assets (the site's index.html is the library home).
  cpSync(join(ROOT, 'site/dist-web'), out, { recursive: true });

  // Merge each live game's hashed assets + its play/<id>/ client. A game's own
  // dist-web/index.html (solo-practice page) is intentionally NOT copied.
  for (const id of games) {
    const dist = join(ROOT, 'games', id, 'dist-web');
    cpSync(join(dist, 'assets'), join(out, 'assets'), { recursive: true });
    cpSync(join(dist, 'play'), join(out, 'play'), { recursive: true });
  }

  // Sanity: home + every live play page must exist.
  const required = [join(out, 'index.html'), ...games.map((id) => join(out, 'play', id, 'index.html'))];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`Stitch incomplete — missing:\n  ${missing.join('\n  ')}`);
  return out;
}

const games = liveGameIds();
console.log(`Live games: ${games.join(', ')}`);

if (!STITCH_ONLY) {
  pnpmBuild('@retro-recall/site');
  for (const id of games) pnpmBuild(`@retro-recall/${id}`);
}

const out = stitch(games);
console.log(`Stitched dist-deploy/ → ${out}`);
console.log(`  home: index.html + ${games.length} play page(s): ${games.map((g) => `play/${g}/`).join(', ')}`);

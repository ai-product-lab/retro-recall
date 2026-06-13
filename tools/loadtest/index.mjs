#!/usr/bin/env node
/**
 * Capacity load test for the rooms Worker — the "will we stay on the Free tier?"
 * gate, runnable locally (`pnpm loadtest`).
 *
 * It drives a handful of realistic game sessions against the Worker and counts
 * the only thing that costs against the Cloudflare Free caps:
 *   - Worker INVOCATIONS — one per top-level request (create, room-info lookup,
 *     and each WebSocket upgrade). WS *messages* ride the Durable Object and do
 *     NOT re-invoke the Worker, so playing longer is free in invocation terms.
 *   - KV WRITES — one per room created (lookups are throttled to ~0, see
 *     workers/rooms/src/index.ts). Free KV = 1,000 writes/day.
 * It then projects the measured per-session cost to a range of sessions/day and
 * compares against the Free ceilings (100k invocations/day, 1k KV writes/day).
 *
 * Because per-session cost is deterministic, a small sample (default 10) is
 * enough to project — and staying under the CREATE_RATE limit keeps the sample
 * from tripping the Worker's own rate limiter.
 *
 * Usage:
 *   pnpm loadtest                         # auto-spawns `wrangler dev`, 10×2p
 *   pnpm loadtest -- --sessions 8 --players 4
 *   pnpm loadtest -- --url https://retro-recall.ruralrooted.com   # hit a deploy
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOMS_DIR = join(ROOT, 'workers', 'rooms');

// Free-plan ceilings we must not blow (per Cloudflare docs, 2026-06).
const FREE = { invocationsPerDay: 100_000, kvWritesPerDay: 1_000 };
const SESSIONS_PER_DAY = [100, 500, 1_000, 5_000, 25_000];

function parseArgs(argv) {
  const a = { sessions: 10, players: 2, url: null, port: 8787 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--sessions') a.sessions = Number(v);
    else if (argv[i] === '--players') a.players = Number(v);
    else if (argv[i] === '--url') a.url = v;
    else if (argv[i] === '--port') a.port = Number(v);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until the Worker answers (any HTTP status) or we give up. */
async function waitForReady(base, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`${base}/api/rooms/AAAA`); // 404 is fine — means it's up
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

/** Spawn `wrangler dev` for the rooms worker; resolve once it answers. */
async function startWorker(port) {
  console.log(`Starting \`wrangler dev\` for the rooms Worker on :${port}…`);
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(port), '--local', '--log-level', 'warn'],
    { cwd: ROOMS_DIR, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const base = `http://localhost:${port}`;
  if (!(await waitForReady(base))) {
    child.kill('SIGTERM');
    throw new Error('wrangler dev did not become ready in time');
  }
  return { base, stop: () => child.kill('SIGTERM') };
}

/**
 * Run one session: create a room, load the invite (roomInfo), connect P players
 * over WebSocket, then leave. Returns the Worker invocations it issued.
 */
async function runSession(base, players, game = 'ramp-riders') {
  let invocations = 0;

  // 1 invocation: create the room.
  invocations++;
  const createRes = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game }),
  });
  if (!createRes.ok) throw new Error(`create failed: ${createRes.status} (rate limited? lower --sessions)`);
  const { code } = await createRes.json();

  // 1 invocation: the invite page's roomInfo lookup.
  invocations++;
  await fetch(`${base}/api/rooms/${code}`);

  // 1 invocation per player: the WebSocket upgrade. Messages after this ride the
  // Durable Object and cost no further invocations, so we just open + close.
  const wsBase = base.replace(/^http/, 'ws');
  const sockets = [];
  for (let p = 0; p < players; p++) {
    invocations++;
    const ws = new WebSocket(`${wsBase}/room/${code}`);
    await new Promise((res, rej) => {
      ws.addEventListener('open', () => res());
      ws.addEventListener('error', () => rej(new Error('ws upgrade failed')));
      setTimeout(() => rej(new Error('ws open timed out')), 5_000);
    });
    sockets.push(ws);
  }
  for (const ws of sockets) ws.close();

  // Modeled (not separately billable as invocations): 1 KV write at create
  // (lookups are throttled to 0), and a handful of DO requests.
  return { invocations, kvWrites: 1 };
}

function pct(n, cap) {
  return `${((n / cap) * 100).toFixed(n / cap < 0.1 ? 1 : 0)}%`;
}

function report({ players, sessions, invPerSession, kvPerSession }) {
  console.log(`\n— Capacity report (${sessions} sessions × ${players} players) —\n`);
  console.log(`Per session (measured): ${invPerSession} Worker invocations`);
  console.log(`  = 1 create + 1 room-info + ${players} WS upgrade(s)`);
  console.log(`Per session (modeled):  ${kvPerSession} KV write (room creation; lookups throttled to 0)\n`);
  console.log(`Free caps: ${FREE.invocationsPerDay.toLocaleString()} invocations/day, ${FREE.kvWritesPerDay.toLocaleString()} KV writes/day\n`);

  const head = ['sessions/day', 'invocations/day', '% Free inv', 'KV writes/day', '% Free KV'];
  console.log(head.map((h) => h.padEnd(16)).join(''));
  let invCeiling = Infinity;
  let kvCeiling = Infinity;
  for (const s of SESSIONS_PER_DAY) {
    const inv = s * invPerSession;
    const kv = s * kvPerSession;
    const flagInv = inv > FREE.invocationsPerDay ? ' ⚠' : '';
    const flagKv = kv > FREE.kvWritesPerDay ? ' ⚠' : '';
    console.log(
      [String(s), String(inv), pct(inv, FREE.invocationsPerDay) + flagInv, String(kv), pct(kv, FREE.kvWritesPerDay) + flagKv]
        .map((c) => c.padEnd(16))
        .join(''),
    );
  }
  invCeiling = Math.floor(FREE.invocationsPerDay / invPerSession);
  kvCeiling = Math.floor(FREE.kvWritesPerDay / kvPerSession);
  const binding = kvCeiling < invCeiling ? 'KV writes (room creation)' : 'Worker invocations';
  console.log(`\nFree-tier headroom: ~${invCeiling.toLocaleString()} sessions/day before the invocation cap,`);
  console.log(`                    ~${kvCeiling.toLocaleString()} sessions/day before the KV-write cap.`);
  console.log(`Binding constraint: ${binding} → that is the number to watch.\n`);
  console.log(`⚠ CAVEAT: this counts only fetch invocations and IGNORES inbound WebSocket`);
  console.log(`  messages, which the client streams at 60 Hz/player — each is a billed DO`);
  console.log(`  request and DOMINATES the real cost (~3,000 req for a 25 s 2p race, not`);
  console.log(`  ${invPerSession}). The 2026-06-13 burn was that streaming, not probing. The numbers`);
  console.log(`  above are an UNDER-count until this tool measures messages. See`);
  console.log(`  docs/HANDOFF-ws-input-burn.md.\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let worker = null;
  let base = args.url;
  try {
    if (!base) {
      worker = await startWorker(args.port);
      base = worker.base;
    } else {
      console.log(`Targeting ${base}`);
      if (!(await waitForReady(base, 5_000))) throw new Error(`cannot reach ${base}`);
    }

    let totalInv = 0;
    let totalKv = 0;
    for (let i = 0; i < args.sessions; i++) {
      const { invocations, kvWrites } = await runSession(base, args.players);
      totalInv += invocations;
      totalKv += kvWrites;
      process.stdout.write(`\r  ran ${i + 1}/${args.sessions} sessions…`);
    }
    process.stdout.write('\n');

    report({
      players: args.players,
      sessions: args.sessions,
      invPerSession: totalInv / args.sessions,
      kvPerSession: totalKv / args.sessions,
    });
  } finally {
    worker?.stop();
  }
}

main().catch((err) => {
  console.error(`\nload test failed: ${err.message}`);
  process.exitCode = 1;
});

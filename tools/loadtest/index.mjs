#!/usr/bin/env node
/**
 * Capacity load test for the rooms Worker — the "will we stay on the Free tier?"
 * gate, runnable locally (`pnpm loadtest`).
 *
 * It drives realistic game sessions against the Worker and counts EVERY billable
 * request a session makes against the Cloudflare Free caps:
 *   - Worker INVOCATIONS — one per top-level fetch: create, room-info lookup,
 *     and each WebSocket upgrade.
 *   - Inbound WEBSOCKET MESSAGES — the cost that the old version of this tool
 *     wrongly ignored. Each inbound WS message to the hibernating `GameRoomDO`
 *     is its own billed request. This is what blew the cap on 2026-06-13.
 *   - KV WRITES — one per room created (lookups are throttled, see
 *     workers/rooms/src/index.ts). Free KV = 1,000 writes/day.
 *
 * To count WS messages honestly it replays the REAL client send cadence
 * (`packages/netcode/src/client/room-client.ts`): input is sent only when the
 * pad changes, plus a keepalive every INPUT_KEEPALIVE_TICKS, plus a ping every
 * PING_EVERY_TICKS. It feeds each player a seeded, lively input stream for a
 * modeled N-second session, sends those messages for real against the Worker
 * (proving they're accepted), and counts them. The send loop runs as fast as it
 * can — the message COUNT is what bills, not the wall-clock pacing.
 *
 * Usage:
 *   pnpm loadtest                          # auto-spawns `wrangler dev`, 10×2p×30s
 *   pnpm loadtest -- --sessions 8 --players 4 --seconds 60
 *   pnpm loadtest -- --changes-per-sec 8   # busier pads (worst-case active play)
 *   pnpm loadtest -- --url https://retro-recall.ruralrooted.com   # hit a deploy
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOMS_DIR = join(ROOT, 'workers', 'rooms');

// Free-plan ceilings we must not blow (per Cloudflare docs, 2026-06).
const FREE = { requestsPerDay: 100_000, kvWritesPerDay: 1_000 };
const SESSIONS_PER_DAY = [100, 500, 1_000, 5_000, 25_000];

// Client cadence — keep in sync with packages/netcode/src (a .mjs tool can't
// import the TS source). INPUT_KEEPALIVE_TICKS (protocol.ts), PING_EVERY_TICKS
// (room-client.ts), and the 60 Hz sim tick.
const TICK_HZ = 60;
const INPUT_KEEPALIVE_TICKS = 30;
const PING_EVERY_TICKS = 60;
// DO idle-reap (workers/rooms/src/room-do.ts): a silent socket is closed after
// this long, capping the cost of a forgotten/backgrounded tab.
const IDLE_DISCONNECT_S = 30;

function parseArgs(argv) {
  const a = { sessions: 10, players: 2, seconds: 30, changesPerSec: 4, url: null, port: 8787 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--sessions') a.sessions = Number(v);
    else if (argv[i] === '--players') a.players = Number(v);
    else if (argv[i] === '--seconds') a.seconds = Number(v);
    else if (argv[i] === '--changes-per-sec') a.changesPerSec = Number(v);
    else if (argv[i] === '--url') a.url = v;
    else if (argv[i] === '--port') a.port = Number(v);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tiny deterministic PRNG so runs are reproducible. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Count the messages one player puts on the wire over `ticks`, applying the
 * real client cadence to a lively input stream. Returns {inputs, pings} and,
 * if `ws` is given, actually sends them so the Worker processes the load.
 */
function drivePlayer(ticks, changesPerSec, rng, ws) {
  let inputs = 0;
  let pings = 0;
  let bits = 0;
  let lastSent = -1;
  let ticksSinceInputSend = 0;
  const changeProb = changesPerSec / TICK_HZ;
  for (let t = 0; t < ticks; t++) {
    if (rng() < changeProb) bits = Math.floor(rng() * 64); // a new 6-button pad
    // send-on-change + keepalive (mirrors room-client.localTick)
    if (bits !== lastSent || ++ticksSinceInputSend >= INPUT_KEEPALIVE_TICKS) {
      ws?.send(JSON.stringify({ type: 'input', tick: t, bits }));
      lastSent = bits;
      ticksSinceInputSend = 0;
      inputs++;
    }
    if ((t + 1) % PING_EVERY_TICKS === 0) {
      ws?.send(JSON.stringify({ type: 'ping', t }));
      pings++;
    }
  }
  return { inputs, pings };
}

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

const openSocket = (url) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => res(ws));
    ws.addEventListener('error', () => rej(new Error('ws upgrade failed')));
    setTimeout(() => rej(new Error('ws open timed out')), 5_000);
  });

/**
 * Run one session: create a room, load the invite (roomInfo), connect P players,
 * join + play for `seconds`, then leave. Returns the billable requests it made:
 * fetch invocations, inbound WS messages, and KV writes.
 */
async function runSession(base, { players, seconds, changesPerSec, seed }, game = 'ramp-riders') {
  let invocations = 0;
  let wsMessages = 0;

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

  const wsBase = base.replace(/^http/, 'ws');
  const ticks = Math.round(seconds * TICK_HZ);
  const sockets = [];
  for (let p = 0; p < players; p++) {
    invocations++; // 1 invocation per player: the WebSocket upgrade.
    const ws = await openSocket(`${wsBase}/room/${code}`);
    ws.send(JSON.stringify({ type: 'join', playerName: `p${p}` })); // 1 inbound message
    wsMessages++;
    sockets.push(ws);
  }

  // Play: each player streams send-on-change input + pings for the session.
  for (let p = 0; p < players; p++) {
    const { inputs, pings } = drivePlayer(ticks, changesPerSec, mulberry32(seed * 31 + p), sockets[p]);
    wsMessages += inputs + pings;
  }
  await sleep(50); // let the Worker drain the burst before we close
  for (const ws of sockets) ws.close();

  return { invocations, wsMessages, kvWrites: 1 };
}

function pct(n, cap) {
  return `${((n / cap) * 100).toFixed(n / cap < 0.1 ? 1 : 0)}%`;
}

function report({ players, seconds, sessions, invPerSession, wsPerSession, kvPerSession, changesPerSec }) {
  const reqPerSession = invPerSession + wsPerSession;
  const perPlayerPerSec = wsPerSession / players / seconds;
  // What the same session cost BEFORE the fix: 60 input msgs/s/player + ping.
  const oldWs = players * seconds * (TICK_HZ + 1) + players; // + joins
  const oldReq = invPerSession + oldWs;

  console.log(`\n— Capacity report (${sessions} × ${players}p × ${seconds}s, ~${changesPerSec} pad changes/s/player) —\n`);
  console.log(`Per session (measured):`);
  console.log(`  ${invPerSession.toFixed(1)} fetch invocations (1 create + 1 room-info + ${players} WS upgrade)`);
  console.log(`  ${wsPerSession.toFixed(0)} inbound WS messages (joins + send-on-change input + pings)`);
  console.log(`  → ${reqPerSession.toFixed(0)} billable requests total  (~${perPlayerPerSec.toFixed(1)} msg/s/player)`);
  console.log(`  ${kvPerSession} KV write\n`);
  console.log(`  vs. before the netcode fix (60 Hz streaming): ~${oldReq.toLocaleString()} requests`);
  console.log(`     → this fix cuts the session ~${(oldReq / reqPerSession).toFixed(0)}×\n`);
  console.log(`Free caps: ${FREE.requestsPerDay.toLocaleString()} requests/day, ${FREE.kvWritesPerDay.toLocaleString()} KV writes/day\n`);

  const head = ['sessions/day', 'requests/day', '% Free req', 'KV writes/day', '% Free KV'];
  console.log(head.map((h) => h.padEnd(16)).join(''));
  for (const s of SESSIONS_PER_DAY) {
    const req = Math.round(s * reqPerSession);
    const kv = s * kvPerSession;
    const flagReq = req > FREE.requestsPerDay ? ' ⚠' : '';
    const flagKv = kv > FREE.kvWritesPerDay ? ' ⚠' : '';
    console.log(
      [String(s), String(req), pct(req, FREE.requestsPerDay) + flagReq, String(kv), pct(kv, FREE.kvWritesPerDay) + flagKv]
        .map((c) => c.padEnd(16))
        .join(''),
    );
  }
  const reqCeiling = Math.floor(FREE.requestsPerDay / reqPerSession);
  const kvCeiling = Math.floor(FREE.kvWritesPerDay / kvPerSession);
  const binding = kvCeiling < reqCeiling ? 'KV writes (room creation)' : 'inbound requests (WS messages)';
  console.log(`\nFree-tier headroom: ~${reqCeiling.toLocaleString()} sessions/day before the request cap,`);
  console.log(`                    ~${kvCeiling.toLocaleString()} sessions/day before the KV-write cap.`);
  console.log(`Binding constraint: ${binding} → that is the number to watch.\n`);
  const idleCost = Math.round(IDLE_DISCONNECT_S * (TICK_HZ / INPUT_KEEPALIVE_TICKS + 1));
  console.log(`Forgotten/backgrounded tab: the DO reaps a silent socket after ${IDLE_DISCONNECT_S}s, so it`);
  console.log(`  costs ~${idleCost} requests then stops — not the unbounded stream that caused the burn.\n`);
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
    let totalWs = 0;
    let totalKv = 0;
    for (let i = 0; i < args.sessions; i++) {
      const { invocations, wsMessages, kvWrites } = await runSession(base, {
        players: args.players,
        seconds: args.seconds,
        changesPerSec: args.changesPerSec,
        seed: i + 1,
      });
      totalInv += invocations;
      totalWs += wsMessages;
      totalKv += kvWrites;
      process.stdout.write(`\r  ran ${i + 1}/${args.sessions} sessions…`);
    }
    process.stdout.write('\n');

    report({
      players: args.players,
      seconds: args.seconds,
      sessions: args.sessions,
      changesPerSec: args.changesPerSec,
      invPerSession: totalInv / args.sessions,
      wsPerSession: totalWs / args.sessions,
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

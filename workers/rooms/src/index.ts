/**
 * Rooms routing worker (see packages/netcode/SPEC.md):
 *
 *   POST /api/rooms        → create a room: code → DO id in KV, returns link
 *   GET  /api/rooms/:code  → who's in the room (invite page), refreshes TTL
 *   GET  /room/:code       → WebSocket upgrade, forwarded to the room DO
 *
 * Deployed on routes retro-recall.ruralrooted.com/api/* and /room/* so the
 * game client talks same-origin; permissive CORS keeps local dev easy.
 */
import { ROOM_TTL_S, isRoomCode, makeRoomCode } from '@retro-recall/netcode';
import { DEFAULT_GAME, isKnownGame } from './games';
import { GameRoomDO } from './room-do';

export { GameRoomDO };

/** Workers Rate Limiting binding (GA); see wrangler.jsonc `ratelimits`. */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoomDO>;
  ROOMS: KVNamespace;
  PUBLIC_ORIGIN: string;
  DISABLE_AUTO_TICK?: string;
  // Optional so local tests/dev (where the binding may be absent) skip limiting.
  // CREATE_RATE guards room allocation; JOIN_RATE guards lookups + WS upgrades —
  // the surfaces an external prober would hammer to burn the Free invocation cap.
  CREATE_RATE?: RateLimit;
  JOIN_RATE?: RateLimit;
}

/** Per-IP key for rate limiting; one shared bucket locally (no client IP). */
const clientKey = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ?? 'local';

/** True if allowed (or no limiter bound). False once the per-IP limit trips. */
async function withinRate(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

const tooMany = (): Response => json({ error: 'rate limited' }, 429);

// Refresh a room code's 24 h TTL at most ~4× across its lifetime rather than on
// every lookup — one KV write per request would blow the Free plan's 1,000
// writes/day cap under even modest traffic.
const REFRESH_AFTER_S = ROOM_TTL_S / 4;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function createRoom(env: Env, request: Request): Promise<Response> {
  // Optional { game } selects which game the room hosts; defaults to keep the
  // single-game behavior (and URL) byte-identical.
  let game = DEFAULT_GAME;
  if (request.headers.get('Content-Type')?.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { game?: unknown };
    if (typeof body.game === 'string') game = body.game;
  }
  if (!isKnownGame(game)) return json({ error: `unknown game '${game}'` }, 400);

  const random = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
  let code = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    code = makeRoomCode(random);
    if ((await env.ROOMS.get(code)) === null) break;
    code = '';
  }
  if (!code) return json({ error: 'could not allocate a room code' }, 503);

  const id = env.GAME_ROOM.newUniqueId();
  await env.ROOMS.put(code, id.toString(), {
    expirationTtl: ROOM_TTL_S,
    metadata: { t: Date.now() }, // seeds the TTL-refresh throttle in lookupRoom
  });
  await env.GAME_ROOM.get(id).init(code, game);
  return json({
    code,
    url: `${env.PUBLIC_ORIGIN}/play/${game}?room=${code}`,
  });
}

async function lookupRoom(env: Env, code: string): Promise<DurableObjectStub<GameRoomDO> | null> {
  if (!isRoomCode(code)) return null;
  const { value: idStr, metadata } = await env.ROOMS.getWithMetadata<{ t: number }>(code);
  if (idStr === null) return null;
  // Activity refresh (codes expire 24 h after last activity), throttled: only
  // re-write when the last refresh is older than REFRESH_AFTER_S, so a burst of
  // lookups for one room costs at most one KV write per window, not one each.
  const lastRefreshMs = metadata?.t ?? 0;
  if ((Date.now() - lastRefreshMs) / 1000 > REFRESH_AFTER_S) {
    await env.ROOMS.put(code, idStr, { expirationTtl: ROOM_TTL_S, metadata: { t: Date.now() } });
  }
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromString(idStr));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const key = clientKey(request);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      if (!(await withinRate(env.CREATE_RATE, key))) return tooMany();
      return createRoom(env, request);
    }

    const info = /^\/api\/rooms\/([A-Z]{4})$/.exec(url.pathname);
    if (info && request.method === 'GET') {
      if (!(await withinRate(env.JOIN_RATE, key))) return tooMany();
      const stub = await lookupRoom(env, info[1]!);
      if (!stub) return json({ error: 'no such room' }, 404);
      return json(await stub.roomInfo());
    }

    const room = /^\/room\/([A-Z]{4})$/.exec(url.pathname);
    if (room) {
      if (!(await withinRate(env.JOIN_RATE, key))) return tooMany();
      const stub = await lookupRoom(env, room[1]!);
      if (!stub) return json({ error: 'no such room' }, 404);
      return stub.fetch(request);
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

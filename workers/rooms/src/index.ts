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

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoomDO>;
  ROOMS: KVNamespace;
  PUBLIC_ORIGIN: string;
  DISABLE_AUTO_TICK?: string;
}

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
  await env.ROOMS.put(code, id.toString(), { expirationTtl: ROOM_TTL_S });
  await env.GAME_ROOM.get(id).init(code, game);
  return json({
    code,
    url: `${env.PUBLIC_ORIGIN}/play/${game}?room=${code}`,
  });
}

async function lookupRoom(env: Env, code: string): Promise<DurableObjectStub<GameRoomDO> | null> {
  if (!isRoomCode(code)) return null;
  const idStr = await env.ROOMS.get(code);
  if (idStr === null) return null;
  // Activity refresh: codes expire 24 h after last activity.
  await env.ROOMS.put(code, idStr, { expirationTtl: ROOM_TTL_S });
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromString(idStr));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      return createRoom(env, request);
    }

    const info = /^\/api\/rooms\/([A-Z]{4})$/.exec(url.pathname);
    if (info && request.method === 'GET') {
      const stub = await lookupRoom(env, info[1]!);
      if (!stub) return json({ error: 'no such room' }, 404);
      return json(await stub.roomInfo());
    }

    const room = /^\/room\/([A-Z]{4})$/.exec(url.pathname);
    if (room) {
      const stub = await lookupRoom(env, room[1]!);
      if (!stub) return json({ error: 'no such room' }, 404);
      return stub.fetch(request);
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

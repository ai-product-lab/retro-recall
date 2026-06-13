/**
 * Avatar Worker (ADR-004). Two routes, same origin as the game:
 *
 *   POST /api/avatar?room=CODE   body = image bytes (image/png|jpeg|webp),
 *                                client-downscaled to ≤512px.
 *                                → { avatarId, source, url } | fallback JSON
 *   GET  /api/avatar/:id.png     → the cached 24×24 head sprite from R2.
 *
 * The key never leaves the worker; photos are never stored or logged; a sprite
 * only gets an id after passing both moderation gates. Any failure degrades to
 * the client gallery (a non-200 with a `reason`) — it never blocks play.
 */

import { isRoomCode } from '@retro-recall/netcode';
import { MAX_PHOTO_BYTES, SPRITE_CACHE_CONTROL } from './config.js';
import { generateAvatar, type Env as PipelineEnv } from './pipeline.js';
import { checkAndIncrement } from './ratelimit.js';

export interface Env extends PipelineEnv {
  PUBLIC_ORIGIN: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function handlePost(request: Request, env: Env, url: URL): Promise<Response> {
  const room = (url.searchParams.get('room') ?? '').toUpperCase();
  if (!isRoomCode(room)) return json({ source: 'fallback', reason: 'bad_input', detail: 'missing/invalid room' }, 400);

  const mime = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim();
  if (!ACCEPTED_MIME.has(mime)) return json({ source: 'fallback', reason: 'bad_input', detail: 'unsupported type' }, 400);

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length === 0) return json({ source: 'fallback', reason: 'bad_input', detail: 'empty body' }, 400);
  if (body.length > MAX_PHOTO_BYTES) return json({ source: 'fallback', reason: 'bad_input', detail: 'too large' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rate = await checkAndIncrement(env.RATE, room, ip);
  if (!rate.allowed) return json({ source: 'fallback', reason: 'rate_limited', detail: rate.scope }, 429);

  const outcome = await generateAvatar(env, body, mime);
  if (!outcome.ok) {
    const status = outcome.reason === 'moderation' ? 422 : 502;
    return json({ source: 'fallback', reason: outcome.reason }, status);
  }
  return json({
    avatarId: outcome.result.avatarId,
    source: outcome.result.source,
    url: `${env.PUBLIC_ORIGIN}/api/avatar/${outcome.result.avatarId}.png`,
  });
}

async function handleGet(env: Env, id: string): Promise<Response> {
  const obj = await env.AVATARS.get(`heads/${id}.png`);
  if (!obj) return json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': SPRITE_CACHE_CONTROL,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/avatar' && request.method === 'POST') {
      return handlePost(request, env, url);
    }
    const get = /^\/api\/avatar\/([a-f0-9]{16})\.png$/.exec(url.pathname);
    if (get && request.method === 'GET') {
      return handleGet(env, get[1]!);
    }
    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

/**
 * Avatar worker tests (miniflare). No GEMINI_API_KEY is bound, so generation
 * always degrades — which is exactly the "works with the key removed" path the
 * kickoff requires. We assert request validation, the rate-limit cap, the
 * fallback contract, and R2 serving.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../src/config';

const ROOM = 'ABCD';
const photo = (): BodyInit => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

const post = (room = ROOM, mime = 'image/png', body: BodyInit = photo()): Promise<Response> =>
  SELF.fetch(`https://avatar.test/api/avatar?room=${room}`, {
    method: 'POST',
    headers: { 'Content-Type': mime, 'CF-Connecting-IP': '203.0.113.7' },
    body,
  });

describe('request validation', () => {
  it('rejects a missing/invalid room code', async () => {
    const res = await post('zz');
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe('bad_input');
  });

  it('rejects an unsupported content type', async () => {
    const res = await post(ROOM, 'application/json');
    expect(res.status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const res = await post(ROOM, 'image/png', new Uint8Array(0));
    expect(res.status).toBe(400);
  });
});

describe('fallback contract (no API key bound)', () => {
  it('degrades to a fallback with reason api_error', async () => {
    const res = await post('WXYZ');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.source).toBe('fallback');
    expect(body.reason).toBe('api_error');
  });
});

describe('rate limiting', () => {
  it('caps generations per room per day', async () => {
    const room = 'RATE';
    for (let i = 0; i < RATE_LIMITS.perRoomPerDay; i++) {
      const res = await post(room);
      expect(res.status).toBe(502); // allowed by rate, then degrades (no key)
    }
    const blocked = await post(room);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).reason).toBe('rate_limited');
  });
});

describe('serving', () => {
  it('404s an unknown avatar id', async () => {
    const res = await SELF.fetch('https://avatar.test/api/avatar/0123456789abcdef.png');
    expect(res.status).toBe(404);
  });

  it('serves a stored head from R2 with immutable caching', async () => {
    await env.AVATARS.put('heads/abcdef0123456789.png', new Uint8Array([137, 80, 78, 71]), {
      httpMetadata: { contentType: 'image/png' },
    });
    const res = await SELF.fetch('https://avatar.test/api/avatar/abcdef0123456789.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });
});

/**
 * Per-room and per-IP daily generation caps (ADR-004). Backed by KV with
 * day-stamped keys and a 2-day TTL so counters self-expire — no cleanup job.
 *
 * KV is eventually-consistent and these increments are not transactional; at
 * friends-and-family scale a rare over-count by one or two is fine and far
 * cheaper than a Durable Object per limiter. Revisit if abuse shows up.
 */

import { RATE_LIMITS } from './config.js';

const TWO_DAYS_S = 2 * 24 * 60 * 60;

/** UTC day stamp, e.g. "2026-06-12". Worker wall-clock — not the game sim, so
 *  `Date` is allowed here. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function count(kv: KVNamespace, key: string): Promise<number> {
  const v = await kv.get(key);
  return v ? Number(v) || 0 : 0;
}

async function bump(kv: KVNamespace, key: string, n: number): Promise<void> {
  await kv.put(key, String(n + 1), { expirationTtl: TWO_DAYS_S });
}

export interface RateDecision {
  allowed: boolean;
  /** Which cap was hit, for logging/telemetry. */
  scope?: 'room' | 'ip';
}

/** Check both caps; on success, increment both. Returns the first cap hit. */
export async function checkAndIncrement(
  kv: KVNamespace,
  roomCode: string,
  ip: string,
): Promise<RateDecision> {
  const day = today();
  const roomKey = `rl:room:${roomCode}:${day}`;
  const ipKey = `rl:ip:${ip}:${day}`;

  const [roomN, ipN] = await Promise.all([count(kv, roomKey), count(kv, ipKey)]);
  if (roomN >= RATE_LIMITS.perRoomPerDay) return { allowed: false, scope: 'room' };
  if (ipN >= RATE_LIMITS.perIpPerDay) return { allowed: false, scope: 'ip' };

  await Promise.all([bump(kv, roomKey, roomN), bump(kv, ipKey, ipN)]);
  return { allowed: true };
}

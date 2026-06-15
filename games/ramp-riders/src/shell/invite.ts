/**
 * Invite / rooms-API helpers for online play. Same rooms Worker the whole
 * arcade shares (workers/rooms): /api/rooms to create, /room/<code> to join
 * over WebSocket. Mirrors Bubble Buddies' invite shell (kept per-game so the
 * worktree stays additive — no cross-game imports).
 */
export { isRoomCode as isRoomCodeLike } from '@retro-recall/netcode';

const CANONICAL_HOST = 'retro-recall.ruralrooted.com';

export const ROOMS_ORIGIN: string =
  location.hostname === CANONICAL_HOST
    ? location.origin
    : ((import.meta.env['VITE_ROOMS_ORIGIN'] as string | undefined) ??
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://localhost:8787'
        : location.origin));

export const wsUrl = (code: string): string =>
  `${ROOMS_ORIGIN.replace(/^http/, 'ws')}/room/${code}`;

export interface RoomInfo {
  code: string;
  players: { slot: number; name: string; connected: boolean }[];
  spectators: number;
}

export async function createRoom(): Promise<{ code: string; url: string }> {
  // { game } routes the new room to this game's sim (workers/rooms registry).
  const res = await fetch(`${ROOMS_ORIGIN}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game: 'ramp-riders' }),
  });
  if (!res.ok) throw new Error(`room creation failed (${res.status})`);
  return res.json() as Promise<{ code: string; url: string }>;
}

export async function fetchRoomInfo(code: string): Promise<RoomInfo | null> {
  const res = await fetch(`${ROOMS_ORIGIN}/api/rooms/${code}`);
  return res.ok ? ((await res.json()) as RoomInfo) : null;
}

export async function shareInvite(url: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Ramp Riders',
        text: 'Start a call, then tap this to race Ramp Riders with me!',
        url,
      });
      return 'shared';
    } catch {
      /* fall through to clipboard */
    }
  }
  // clipboard is undefined on insecure origins and rejects when the doc isn't
  // focused (common right after a dismissed share sheet) — never let it throw.
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

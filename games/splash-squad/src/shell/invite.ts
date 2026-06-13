/**
 * Room helpers for the online play route. The rooms Worker is the same one
 * Bubble Buddies uses (ADR-001/003); only the share copy differs per game.
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

/** Avatar Worker origin (ADR-004). Same-origin in prod; a build-time override
 *  or the local avatar worker (:8788) otherwise. A missing/unreachable origin
 *  just degrades to the fallback gallery — generation is never required. */
export const AVATARS_ORIGIN: string =
  location.hostname === CANONICAL_HOST
    ? location.origin
    : ((import.meta.env['VITE_AVATARS_ORIGIN'] as string | undefined) ??
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://localhost:8788'
        : location.origin));

export interface RoomInfo {
  code: string;
  players: { slot: number; name: string; connected: boolean }[];
  spectators: number;
}

export async function createRoom(): Promise<{ code: string; url: string }> {
  const res = await fetch(`${ROOMS_ORIGIN}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game: 'splash-squad' }),
  });
  if (!res.ok) throw new Error(`room creation failed (${res.status})`);
  return res.json() as Promise<{ code: string; url: string }>;
}

export async function fetchRoomInfo(code: string): Promise<RoomInfo | null> {
  const res = await fetch(`${ROOMS_ORIGIN}/api/rooms/${code}`);
  return res.ok ? ((await res.json()) as RoomInfo) : null;
}

export async function shareInvite(url: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Splash Squad',
        text: 'Start a call, then tap this to soak some robots with me!',
        url,
      });
      return 'shared';
    } catch {
      // fall through to clipboard (cancelled or unsupported)
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

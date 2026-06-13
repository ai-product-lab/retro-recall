/**
 * Invite-page helpers (ADR-008 Tier 0): create/join a Puck Pals room and the
 * in-app-browser escape hatch. The rooms worker is shared across games — a room
 * is created with `{ game: 'puck-pals' }` so the Durable Object hosts this sim
 * (workers/rooms/src/games.ts). Links tapped inside Messenger/Instagram/WhatsApp
 * open in embedded WebViews, which are unreliable for games — detect and offer
 * "Open in Safari".
 */

export { isRoomCode as isRoomCodeLike } from '@retro-recall/netcode';

/** On the production hostname, /api and /room are same-origin Worker routes;
 *  pages.dev previews fall back to the workers.dev URL baked in at build. */
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

/** Create a room that hosts Puck Pals (the shared worker selects the sim). */
export async function createRoom(): Promise<{ code: string; url: string }> {
  const res = await fetch(`${ROOMS_ORIGIN}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game: 'puck-pals' }),
  });
  if (!res.ok) throw new Error(`room creation failed (${res.status})`);
  return res.json() as Promise<{ code: string; url: string }>;
}

export async function fetchRoomInfo(code: string): Promise<RoomInfo | null> {
  const res = await fetch(`${ROOMS_ORIGIN}/api/rooms/${code}`);
  return res.ok ? ((await res.json()) as RoomInfo) : null;
}

const IN_APP_UA = /FBAN|FBAV|FB_IAB|Messenger|Instagram|WhatsApp|Line\/|MicroMessenger/i;
export const isInAppBrowser = (): boolean => IN_APP_UA.test(navigator.userAgent);

const isIOS = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Best-effort jailbreak from an in-app WebView into the real browser. */
export function escapeToBrowser(): void {
  const url = location.href;
  if (isIOS()) {
    location.href = `x-safari-${url}`;
  } else {
    const u = new URL(url);
    location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};end`;
  }
}

export async function shareInvite(url: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Puck Pals',
        text: 'Start a call, then tap this to play Puck Pals with me!',
        url,
      });
      return 'shared';
    } catch {
      // fall through to clipboard (user cancelled or share unsupported)
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

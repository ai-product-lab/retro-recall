/**
 * Rooms-API origin for the library home. Same-origin as the worker on the
 * canonical host (routing sends /api there); a build-time override or the local
 * worker otherwise. Used to resolve a typed room code to its game before
 * redirecting to the right play page.
 */
const CANONICAL_HOST = 'retro-recall.ruralrooted.com';

export const ROOMS_ORIGIN: string =
  location.hostname === CANONICAL_HOST
    ? location.origin
    : ((import.meta.env['VITE_ROOMS_ORIGIN'] as string | undefined) ??
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://localhost:8787'
        : location.origin));

/** The game a room hosts, via `/api/rooms/<code>`; null if unknown/unreachable. */
export async function gameForRoom(code: string): Promise<string | null> {
  try {
    const res = await fetch(`${ROOMS_ORIGIN}/api/rooms/${code}`);
    if (!res.ok) return null;
    const info = (await res.json()) as { game?: unknown };
    return typeof info.game === 'string' ? info.game : null;
  } catch {
    return null;
  }
}

/**
 * Landscape enforcement (ADR-012). The arcade is landscape-only — the phone is
 * held sideways like a handheld console. The web can't *force* orientation in a
 * mobile Safari tab (the Screen Orientation lock API only works in an installed
 * PWA / fullscreen), so enforcement is two-pronged:
 *
 *  - `requireLandscape()` shows a "rotate your phone" gate whenever the viewport
 *    is portrait, and hides it in landscape. This is the universal fallback.
 *  - `lockLandscapeOnGesture()` best-effort requests fullscreen + an orientation
 *    lock from inside a user gesture (start/join tap), which actually pins
 *    landscape on Android Chrome and installed PWAs. No-ops elsewhere.
 */
import { onViewportChange } from './layout';

export const isPortrait = (): boolean =>
  window.matchMedia('(orientation: portrait)').matches ||
  window.innerHeight > window.innerWidth;

export interface LandscapeGate {
  isLandscape(): boolean;
  destroy(): void;
}

/** Mount a full-screen "rotate to play" overlay shown while portrait. */
export function requireLandscape(message = 'Rotate your phone to play'): LandscapeGate {
  const gate = document.createElement('div');
  gate.className = 'rotate-gate';
  // Inline the critical styles so the gate works before any CSS loads.
  Object.assign(gate.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    background: '#0f1222',
    color: '#f2efe9',
    font: '600 16px ui-monospace, Menlo, Consolas, monospace',
    textAlign: 'center',
    padding: '24px',
  } satisfies Partial<CSSStyleDeclaration>);
  gate.innerHTML = `<div style="font-size:44px;line-height:1">⟳</div><div>${message}</div>`;
  document.body.append(gate);

  const apply = (): void => {
    gate.style.display = isPortrait() ? 'flex' : 'none';
  };
  apply();
  const stop = onViewportChange(apply);

  return {
    isLandscape: () => !isPortrait(),
    destroy: () => {
      stop();
      gate.remove();
    },
  };
}

/**
 * Best-effort pin to landscape, from inside a user gesture. Fullscreen first
 * (some browsers only allow the orientation lock in fullscreen), then lock.
 * Every call is guarded — unsupported platforms (Safari tabs) silently no-op
 * and fall back to the rotate gate.
 */
export async function lockLandscapeOnGesture(): Promise<void> {
  try {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (!document.fullscreenElement) {
      await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.() ?? Promise.resolve());
    }
  } catch {
    /* fullscreen denied — the lock below may still work, or the gate covers us */
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    /* lock unsupported (iOS Safari) — rotate gate handles enforcement */
  }
}

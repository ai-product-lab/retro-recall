/**
 * Shared touch primitives (ADR-007, ADR-009). The pointer-tracking plumbing
 * every game's touch surface needs — multi-touch by pointerId, best-effort
 * pointer capture, and held-state release on the events iOS actually delivers
 * (blur is unreliable on App Switcher / notification shade; visibilitychange
 * and pagehide are not). Games compose their *surface* (8-way pad, analog stick,
 * action buttons) from these instead of re-implementing the plumbing — that
 * re-implementation is exactly what drifted across games and shipped bugs.
 *
 * Pure math (octantBits) lives here too so it can be unit-tested without a DOM.
 */
import { suppressGestures } from './gestures';

/** Direction → bit, so any game maps an 8-way input to its own scheme. */
export interface OctantBitset {
  up: number;
  down: number;
  left: number;
  right: number;
}

/**
 * Pure: vector (dx, dy) from a pad's center → 8-way direction bits, 0 inside the
 * deadzone. East is 0°, clockwise (screen y grows downward). Exported for tests.
 */
export function octantBits(dx: number, dy: number, deadzone: number, bits: OctantBitset): number {
  if (Math.hypot(dx, dy) < deadzone) return 0;
  const table = [
    bits.right,
    bits.right | bits.down,
    bits.down,
    bits.down | bits.left,
    bits.left,
    bits.left | bits.up,
    bits.up,
    bits.up | bits.right,
  ];
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return table[octant]!;
}

/** Subscribe to the three "the OS took focus, drop everything held" signals.
 *  Returns a teardown. */
export function onRelease(handler: () => void): () => void {
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') handler();
  };
  window.addEventListener('blur', handler);
  window.addEventListener('pagehide', handler);
  document.addEventListener('visibilitychange', onHidden);
  return () => {
    window.removeEventListener('blur', handler);
    window.removeEventListener('pagehide', handler);
    document.removeEventListener('visibilitychange', onHidden);
  };
}

export interface OctantPad {
  sample(): number;
  destroy(): void;
}

export interface OctantPadOptions {
  bits: OctantBitset;
  /** Deadzone as a fraction of pad width (default 0.12). */
  deadzoneRatio?: number;
  /** Floor for the deadzone in px (default 10). */
  minDeadzone?: number;
  /** Called whenever the held direction changes (for visual feedback). */
  onChange?: (bits: number) => void;
}

/**
 * An 8-way pad/stick over `zone`: the whole zone is the touch surface, direction
 * comes from the vector to `padEl`'s center, recomputed every move so you can
 * slide between directions. Multi-touch safe; releases on focus loss.
 */
export function createOctantPad(
  zone: HTMLElement,
  padEl: HTMLElement,
  opts: OctantPadOptions,
): OctantPad {
  const { bits, deadzoneRatio = 0.12, minDeadzone = 10, onChange } = opts;
  const pointers = new Map<number, number>();
  let held = 0;

  const refresh = (): void => {
    let next = 0;
    for (const b of pointers.values()) next |= b;
    if (next !== held) {
      held = next;
      onChange?.(held);
    }
  };
  const vector = (e: PointerEvent): number => {
    const r = padEl.getBoundingClientRect();
    const dead = Math.max(minDeadzone, r.width * deadzoneRatio);
    return octantBits(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), dead, bits);
  };
  const onDown = (e: PointerEvent): void => {
    e.preventDefault();
    // Record before capture: setPointerCapture can throw on fast Android
    // multi-touch, which would otherwise drop the press entirely.
    pointers.set(e.pointerId, vector(e));
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort; pointerId tracking is what matters */
    }
    refresh();
  };
  const onMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, vector(e));
    refresh();
  };
  const onUp = (e: PointerEvent): void => {
    if (pointers.delete(e.pointerId)) refresh();
  };
  const releaseAll = (): void => {
    if (pointers.size === 0) return;
    pointers.clear();
    refresh();
  };

  zone.addEventListener('pointerdown', onDown);
  zone.addEventListener('pointermove', onMove);
  zone.addEventListener('pointerup', onUp);
  zone.addEventListener('pointercancel', onUp);
  suppressGestures(zone);
  const stopRelease = onRelease(releaseAll);

  return {
    sample: () => held,
    destroy: () => {
      stopRelease();
      zone.removeEventListener('pointerdown', onDown);
      zone.removeEventListener('pointermove', onMove);
      zone.removeEventListener('pointerup', onUp);
      zone.removeEventListener('pointercancel', onUp);
    },
  };
}

export interface MomentaryButton {
  held(): boolean;
  release(): void;
  destroy(): void;
}

export interface MomentaryButtonOptions {
  heldClass?: string;
  onDown?: () => void;
  onUp?: () => void;
}

/**
 * A held-while-pressed button. Uses pointer capture so a thumb that drifts past
 * the visual edge keeps the button held (the bug that silently cut Ramp Riders'
 * throttle was a `pointerleave → release` with no capture). Releases on up,
 * cancel, and focus loss.
 */
export function bindMomentaryButton(
  el: HTMLElement,
  opts: MomentaryButtonOptions = {},
): MomentaryButton {
  const { heldClass = 'held', onDown, onUp } = opts;
  let isHeld = false;
  const set = (v: boolean): void => {
    if (v === isHeld) return;
    isHeld = v;
    el.classList.toggle(heldClass, v);
    (v ? onDown : onUp)?.();
  };
  const down = (e: PointerEvent): void => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    set(true);
  };
  const up = (): void => set(false);

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  const stopRelease = onRelease(up);

  return {
    held: () => isHeld,
    release: () => set(false),
    destroy: () => {
      stopRelease();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    },
  };
}

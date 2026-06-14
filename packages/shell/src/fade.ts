/**
 * Idle-fade for overlaid controls (ADR-012). The stick and buttons sit on top of
 * a full-bleed game; when the player isn't touching them they fade to near-
 * transparent so the whole map shows through, and snap back to full opacity the
 * instant a finger lands. Pure presentation — never gates input (the controls
 * stay live at any opacity; only `opacity` changes, and `pointer-events` is left
 * untouched so a faded control is still pressable).
 */

export interface IdleFadeOptions {
  /** Idle time before fading (ms). */
  idleMs?: number;
  /** Opacity while active. */
  activeOpacity?: number;
  /** Opacity once idle. */
  idleOpacity?: number;
}

/**
 * Fade `elements` to `idleOpacity` after `idleMs` without a pointerdown on any
 * of them; restore to `activeOpacity` on touch. Returns a teardown. Uses a
 * window pointerdown listener (capture) so a press anywhere on a control —
 * including its hit-slop padding — counts as activity.
 */
export function attachIdleFade(
  elements: HTMLElement[],
  opts: IdleFadeOptions = {},
): () => void {
  const { idleMs = 2500, activeOpacity = 1, idleOpacity = 0.15 } = opts;
  let timer = 0;

  for (const el of elements) {
    el.style.transition = 'opacity 280ms ease';
    el.style.opacity = String(activeOpacity);
  }
  const setOpacity = (v: number): void => {
    for (const el of elements) el.style.opacity = String(v);
  };
  const wake = (): void => {
    setOpacity(activeOpacity);
    clearTimeout(timer);
    timer = window.setTimeout(() => setOpacity(idleOpacity), idleMs);
  };
  // Any press within a control zone wakes the overlay.
  const onDown = (e: PointerEvent): void => {
    if (elements.some((el) => el.contains(e.target as Node))) wake();
  };
  window.addEventListener('pointerdown', onDown, { capture: true });
  wake(); // start visible, then settle to idle

  return () => {
    clearTimeout(timer);
    window.removeEventListener('pointerdown', onDown, { capture: true });
  };
}

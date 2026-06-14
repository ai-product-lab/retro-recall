/**
 * Gesture suppression (ADR-007). Mobile browsers fire a grab-bag of default
 * gestures that fight a fullscreen game: double-tap-to-zoom, pinch-zoom, the
 * long-press context menu. `touch-action` on the body stops single-finger pan,
 * but it does NOT reliably stop iOS Safari's double-tap-to-zoom on interactive
 * children, and `user-scalable=no` is ignored by modern iOS. The dependable
 * suppressants are `touch-action: manipulation` on the tappable element plus a
 * global `gesturestart`/`dblclick` preventDefault — applied here, once, so every
 * game (and its HUD/overlay chrome) gets it instead of each reinventing it.
 *
 * This is deliberately separate from input handling: it removes browser noise;
 * the controls modules read the (now clean) pointer stream.
 */

/** Mark an element non-zoomable (no double-tap zoom / 300ms delay) but still
 *  pannable/scrollable by its own rules. Use on buttons, chips, overlay CTAs. */
export const noZoom = (el: HTMLElement): void => {
  el.style.touchAction = 'manipulation';
};

/** Fully claim an element's touch surface — no pan, zoom, or context menu.
 *  Use on the playfield and control zones the game owns entirely. */
export const suppressGestures = (el: HTMLElement): void => {
  el.style.touchAction = 'none';
  el.addEventListener('contextmenu', (e) => e.preventDefault());
};

/**
 * Install document-wide guards that kill the zoom gestures `touch-action` can't
 * reach on iOS: the synthetic double-tap and the pinch `gesturestart`. Idempotent
 * per document; returns a teardown. Call once at app boot.
 */
export function installZoomGuard(doc: Document = document): () => void {
  const w = doc.defaultView ?? window;
  const guarded = doc as Document & { __zoomGuarded?: boolean };
  if (guarded.__zoomGuarded) return () => {};
  guarded.__zoomGuarded = true;

  const stop = (e: Event): void => e.preventDefault();
  // iOS-only pinch lifecycle; harmless no-ops elsewhere.
  w.addEventListener('gesturestart', stop, { passive: false });
  w.addEventListener('gesturechange', stop, { passive: false });
  doc.addEventListener('dblclick', stop, { passive: false });

  return () => {
    guarded.__zoomGuarded = false;
    w.removeEventListener('gesturestart', stop);
    w.removeEventListener('gesturechange', stop);
    doc.removeEventListener('dblclick', stop);
  };
}

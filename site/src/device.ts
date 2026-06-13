/**
 * Capability detection for the arcade shell (ADR-007). Mirrors the per-game
 * helper: the UI adapts to what the device *is*. Stamps <body data-input> so
 * CSS can switch copy and hit-areas declaratively.
 */

export const prefersTouchUI = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 0 ||
  'ontouchstart' in window;

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

/** Stamp <body data-input='touch'|'keyboard'>. */
export function applyInputMode(): 'touch' | 'keyboard' {
  const mode = prefersTouchUI() ? 'touch' : 'keyboard';
  document.body.dataset['input'] = mode;
  return mode;
}

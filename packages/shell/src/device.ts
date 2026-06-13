/**
 * Capability detection (ADR-007): the UI adapts to what the device *is*, not
 * what we guess from screen size. Touch-first devices get touch controls and
 * never see keyboard legends; keyboard devices keep them. Detection runs once
 * at boot and stamps <body data-input> so CSS can switch copy declaratively.
 */

/** True when the primary pointer is a finger (iPhone, iPad, Android). */
export const prefersTouchUI = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 0 ||
  'ontouchstart' in window;

export const isIOS = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  // iPadOS 13+ masquerades as macOS but exposes touch points.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Installed to the home screen (PWA standalone mode). */
export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

/** Stamp the body so CSS can show/hide .keys-only / .touch-only copy. */
export function applyInputMode(): 'touch' | 'keyboard' {
  const mode = prefersTouchUI() ? 'touch' : 'keyboard';
  document.body.dataset['input'] = mode;
  return mode;
}

/**
 * Audio lifecycle helper (ADR-007). Each game owns its own synth/AudioContext,
 * but they all share one iOS pitfall: WebAudio is suspended when the tab is
 * backgrounded (App Switcher, locking the phone, a call) and does NOT resume on
 * its own — so a game unlocked once on JOIN goes permanently silent after the
 * first background. This wires the dependable resume signals to a context the
 * game supplies, without dictating how that context is built.
 */

/**
 * Keep `getContext()`'s AudioContext running across backgrounding: resume it on
 * visibilitychange→visible and on the next pointerdown (the gesture iOS wants).
 * Safe before the context exists (getContext may return null). Returns teardown.
 */
export function resumeAudioOnVisible(getContext: () => AudioContext | null): () => void {
  const resume = (): void => {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  };
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') resume();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pointerdown', resume);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pointerdown', resume);
  };
}

/**
 * iOS audio unlock: Safari only allows sound after a user gesture. Every
 * "start" tap (tap-to-start gate, JOIN GAME button) routes through
 * unlockAudio() so the shared AudioContext is running before any game ever
 * wants to make noise. There is no audio engine yet — this reserves the
 * gesture so adding one later doesn't need a UX change.
 */

let ctx: AudioContext | null = null;

/** Call from inside a user-gesture handler. Safe to call repeatedly. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    // Play one silent sample — the canonical "warm up the output" trick.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // No audio available (old browser, autoplay policy) — the game is silent
    // today anyway; never let sound break play.
  }
}

/** The shared context for the future audio engine (null until unlocked). */
export const audioContext = (): AudioContext | null => ctx;

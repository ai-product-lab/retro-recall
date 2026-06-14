import { TICKS_PER_SECOND } from './sim/index';

export interface LoopOptions {
  /** Advance the sim exactly one tick. */
  tick: () => void;
  /** Draw the current state. Called once per animation frame. */
  render: () => void;
  ticksPerSecond?: number;
  /** Fired when the loop resumes after a background gap longer than the catch-up
   *  clamp (rAF pauses while hidden). The netcode/reconnect layer hooks this to
   *  resync instead of silently dropping the elapsed ticks. */
  onResume?: (gapMs: number) => void;
}

/**
 * Fixed-timestep loop: accumulates real elapsed time and runs whole sim ticks
 * at exactly ticksPerSecond, rendering once per animation frame. Clamps the
 * accumulator after long pauses (tab in background) instead of spiraling.
 * Returns a stop function.
 */
export function startLoop({ tick, render, ticksPerSecond = TICKS_PER_SECOND, onResume }: LoopOptions): () => void {
  const tickMs = 1000 / ticksPerSecond;
  const maxCatchUpTicks = 5;
  const maxCatchUpMs = tickMs * maxCatchUpTicks;
  let last = performance.now();
  let acc = 0;
  let rafId = 0;
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    const elapsed = now - last;
    acc += elapsed;
    last = now;
    if (acc > maxCatchUpMs) {
      acc = maxCatchUpMs;
      // Elapsed beyond the clamp means rAF was paused (tab backgrounded);
      // let the netcode layer resync rather than pretend no time passed.
      if (elapsed > maxCatchUpMs) onResume?.(elapsed);
    }
    while (acc >= tickMs) {
      tick();
      acc -= tickMs;
    }
    render();
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
  };
}

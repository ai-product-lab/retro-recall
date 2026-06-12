import { TICKS_PER_SECOND } from './sim/index';

export interface LoopOptions {
  /** Advance the sim exactly one tick. */
  tick: () => void;
  /** Draw the current state. Called once per animation frame. */
  render: () => void;
  ticksPerSecond?: number;
}

/**
 * Fixed-timestep loop: accumulates real elapsed time and runs whole sim ticks
 * at exactly ticksPerSecond, rendering once per animation frame. Clamps the
 * accumulator after long pauses (tab in background) instead of spiraling.
 * Returns a stop function.
 */
export function startLoop({ tick, render, ticksPerSecond = TICKS_PER_SECOND }: LoopOptions): () => void {
  const tickMs = 1000 / ticksPerSecond;
  const maxCatchUpTicks = 5;
  let last = performance.now();
  let acc = 0;
  let rafId = 0;
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    acc += now - last;
    last = now;
    if (acc > tickMs * maxCatchUpTicks) acc = tickMs * maxCatchUpTicks;
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

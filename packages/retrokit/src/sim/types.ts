/**
 * Core sim contracts. Inputs are a compact bitmask (NES-style pad) — this is
 * the unit of replays and, later, netcode messages.
 */
export const Button = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  A: 1 << 4,
  B: 1 << 5,
  Start: 1 << 6,
} as const;

/** Bitmask of `Button` values for one player on one tick. */
export type InputBits = number;

/**
 * Every game implements this. The contract that makes replays, netcode, and
 * regression tests work: same construction + same input sequence must yield
 * the same serialize()/hash() forever.
 */
export interface GameSim {
  /** Advance exactly one fixed tick. */
  tick(input: InputBits): void;
  /** Canonical string form of the full sim state. */
  serialize(): string;
  /** Stable 32-bit hash of the full sim state. */
  hash(): number;
}

/** Run-length-encoded input log entry: hold `bits` for `count` ticks. */
export type InputLogEntry = readonly [bits: InputBits, count: number];

/** Feed an RLE input log through a sim, tick by tick. */
export function replay(sim: GameSim, log: readonly InputLogEntry[]): void {
  for (const [bits, count] of log) {
    for (let i = 0; i < count; i++) sim.tick(bits);
  }
}

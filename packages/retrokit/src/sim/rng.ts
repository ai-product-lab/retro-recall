/**
 * Seeded xorshift32 RNG — the only source of randomness allowed in a sim.
 * Pure 32-bit integer math, identical in every JS runtime.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** Next raw 32-bit unsigned value. */
  next(): number {
    let x = this.s;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.s = x >>> 0;
    return this.s;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }

  /** True with probability num/den. */
  chance(num: number, den: number): boolean {
    return this.int(den) < num;
  }

  /** Internal state, for serialization. */
  state(): number {
    return this.s;
  }

  /** Restore from a serialized state. */
  static fromState(state: number): Rng {
    const r = new Rng(1);
    r.s = state >>> 0;
    return r;
  }
}

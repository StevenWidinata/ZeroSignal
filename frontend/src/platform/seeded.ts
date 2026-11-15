/**
 * Seeded random numbers (mulberry32). A line-for-line copy of
 * `backend/src/rng.rs`; only 32-bit integer math, so the browser and the
 * server get the same numbers from the same seed.
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** 0..n (n > 0). */
  below(n: number): number {
    return this.nextU32() % n;
  }
}

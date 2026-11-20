// A seedable random number generator: the same seed gives the same run, so any failing seed can be replayed.
// xoshiro128** seeded through splitmix32. Pure TypeScript, no dependency.

export class Rng {
  private s = new Uint32Array(4)
  readonly seed: number

  constructor(seed: number) {
    this.seed = seed
    let x = seed >>> 0
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0
      let z = x
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
      this.s[i] = (z ^ (z >>> 16)) >>> 0
    }
    if (!this.s.some(Boolean)) this.s[0] = 1
  }

  /** A float in [0, 1). */
  next(): number {
    const s = this.s
    const r = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0
    const t = (s[1] << 9) >>> 0
    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]
    s[2] ^= t
    s[3] = rotl(s[3], 11)
    return r / 4294967296
  }
  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }
  /** A number in [lo, hi). */
  real(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo)
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]
  }
  /** A child generator: its own stream, so that adding a draw in one place does not shift every other. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296))
  }
}
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** A ULID from a time (ms) and the generator: 10 characters of time, 16 of randomness. */
export function ulid(ms: number, rng: Rng): string {
  let time = ''
  let t = Math.max(0, Math.floor(ms))
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  let rand = ''
  for (let i = 0; i < 16; i++) rand += CROCKFORD[Math.floor(rng.next() * 32)]
  return time + rand
}

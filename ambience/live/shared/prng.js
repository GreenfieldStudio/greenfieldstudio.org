// web-ambient PRNG: xoshiro128** (Blackman & Vigna, public domain algorithm; our own code), seeded by splitmix64.
// State is 128 bits, period 2^128 - 1. At 48,000 samples/s with 16 draws per sample the stream lasts about 1.4e26 years,
// so nothing wraps within any play time (BRIEF.md section 3: at least 64-bit state, never a 32-bit LCG or mulberry32).
// splitmix64 runs in BigInt and is used only to expand a seed into the four 32-bit state words.

const M64 = (1n << 64n) - 1n;

// One splitmix64 step. Takes and returns a BigInt state; returns [nextState, output].
export function splitmix64(state) {
  const s = (state + 0x9e3779b97f4a7c15n) & M64;
  let z = s;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return [s, z ^ (z >> 31n)];
}

// Seed: a number, a BigInt or a string (strings are hashed with FNV-1a 64).
function seedBig(seed) {
  if (typeof seed === 'bigint') return seed & M64;
  if (typeof seed === 'number') return BigInt(Math.floor(Math.abs(seed))) & M64;
  let h = 0xcbf29ce484222325n;
  for (const ch of String(seed)) h = ((h ^ BigInt(ch.codePointAt(0))) * 0x100000001b3n) & M64;
  return h;
}

const rotl = (x, k) => (x << k) | (x >>> (32 - k));

export class Xoshiro128ss {
  // new Xoshiro128ss(seed) or Xoshiro128ss.fromState([a, b, c, d]) (raw 32-bit words, for test vectors)
  constructor(seed = 1) {
    let st = seedBig(seed);
    const w = [];
    for (let i = 0; i < 2; i++) {
      let out;
      [st, out] = splitmix64(st);
      w.push(Number(out & 0xffffffffn), Number(out >> 32n));
    }
    this.s = Uint32Array.from(w);
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1; // all-zero state is the one bad state
  }
  static fromState(words) {
    const r = Object.create(Xoshiro128ss.prototype);
    r.s = Uint32Array.from(words);
    return r;
  }
  // Next 32-bit unsigned integer.
  nextU32() {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  // Uniform double in [0, 1) with 53 random bits.
  next() {
    const hi = this.nextU32() >>> 5, lo = this.nextU32() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  // Standard normal (Box-Muller, one value per call).
  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

export function rng(seed) { return new Xoshiro128ss(seed); }

// web-ambient DSP building blocks: pure JS, no DOM and no WebAudio, so the same code runs inside an AudioWorklet and in
// Node (tools/audio_render.mjs --engine node, unit checks). All state is in doubles; time is a sample counter in a double
// (exact up to 2^53 samples = 5,900 years at 48 kHz), so nothing drifts or wraps within any play time (BRIEF.md section 3).
// Randomness comes from prng.js (xoshiro128**, 128-bit state).

// Pink noise from white: Paul Kellet's refined filter (-3 dB/octave within 0.05 dB above 9 Hz at 44.1/48 kHz).
// Output RMS is about 0.18 for white input in [-1, 1).
export class Pink {
  constructor(rng) { this.r = rng; this.b = new Float64Array(7); }
  next() {
    const w = this.r.next() * 2 - 1, b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.96900 * b[2] + w * 0.1538520;
    b[3] = 0.86650 * b[3] + w * 0.3104856;
    b[4] = 0.55000 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.0168980;
    const out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return out * 0.11;
  }
}

// One-pole low-pass (cutoff in Hz) and the matching high-pass (input minus low-pass).
export class OnePole {
  constructor(sampleRate, hz) { this.sr = sampleRate; this.z = 0; this.set(hz); }
  set(hz) { this.a = 1 - Math.exp(-2 * Math.PI * hz / this.sr); }
  lp(x) { return (this.z += this.a * (x - this.z)); }
  hp(x) { return x - this.lp(x); }
}

// Slow random level: smoothed random targets, a new target every `every` seconds on average (exponential spacing),
// glide time `glide` seconds. Gives gentle, never-repeating drift between lo and hi.
export class Drift {
  constructor(rng, sampleRate, { lo = 0.8, hi = 1.2, every = 6, glide = 4 } = {}) {
    this.r = rng; this.sr = sampleRate; this.lo = lo; this.hi = hi; this.every = every;
    this.v = this.target = rng.range(lo, hi);
    this.k = 1 - Math.exp(-1 / (glide * sampleRate));
    this.left = this.gap();
  }
  gap() { return Math.max(1, Math.round(-Math.log(1 - this.r.next()) * this.every * this.sr)); }
  next() {
    if (--this.left <= 0) { this.target = this.r.range(this.lo, this.hi); this.left = this.gap(); }
    return (this.v += this.k * (this.target - this.v));
  }
}

// Two-pole band-pass (RBJ cookbook, constant 0 dB peak gain), direct form I, state in doubles.
export class BandPass {
  constructor(sampleRate, hz, q) { this.sr = sampleRate; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(hz, q); }
  set(hz, q) {
    const w = 2 * Math.PI * Math.min(hz, this.sr * 0.45) / this.sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
  }
  next(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Random noise bursts through a resonant band-pass (drops hitting glass: a short hiss with a pitch, not a sine ping;
// ANIMATION.md section 8). Poisson spacing with mean `rate` per second times the `rateMul` passed to add(), so a scene
// can couple the event rate to its intensity drift. Each event draws centre, Q, decay, level and pan. At most `voices`
// overlap; extra events are dropped (counted in `dropped`), and every parameter is drawn either way. The burst noise has
// its own generator (`noiseRng`), so the event stream does not depend on how many voices are sounding.
export class NoiseTicks {
  constructor(rng, noiseRng, sampleRate, { rate = 10, hzLo = 2200, hzHi = 7000, qLo = 1.5, qHi = 5, decayLo = 0.0008,
    decayHi = 0.004, gainLo = 0.05, gainHi = 0.3, voices = 12 } = {}) {
    Object.assign(this, { r: rng, n: noiseRng, sr: sampleRate, rate, hzLo, hzHi, qLo, qHi, decayLo, decayHi, gainLo, gainHi });
    this.v = Array.from({ length: voices }, () => ({ on: false, env: 0, mul: 0, bp: new BandPass(sampleRate, 1000, 1), l: 0, r: 0 }));
    this.left = this.gap(1);
    this.count = 0; this.dropped = 0;
  }
  gap(rateMul) { return Math.max(1, Math.round(-Math.log(1 - this.r.next()) / (this.rate * rateMul) * this.sr)); }
  spawn() {
    const v = this.v.find((x) => !x.on), r = this.r;
    const hz = this.hzLo * Math.pow(this.hzHi / this.hzLo, r.next()), q = r.range(this.qLo, this.qHi);
    const decay = r.range(this.decayLo, this.decayHi), amp = this.gainLo * Math.pow(this.gainHi / this.gainLo, r.next());
    const pan = r.range(0.1, 0.9);
    this.count++;
    if (!v) { this.dropped++; return; }
    v.on = true; v.env = amp; v.mul = Math.exp(-1 / (decay * this.sr));
    v.bp.x1 = v.bp.x2 = v.bp.y1 = v.bp.y2 = 0; v.bp.set(hz, q);
    v.l = Math.cos(pan * Math.PI / 2); v.r = Math.sin(pan * Math.PI / 2);
  }
  // Adds one sample into out[0] (left) and out[1] (right). `rateMul` > 0 scales the event rate.
  add(out, rateMul = 1) {
    if (--this.left <= 0) { this.spawn(); this.left = this.gap(rateMul); }
    for (const v of this.v) {
      if (!v.on) continue;
      const s = v.bp.next((this.n.next() * 2 - 1) * v.env);
      out[0] += s * v.l; out[1] += s * v.r;
      v.env *= v.mul;
      // Off once the burst and the filter ring have both died away.
      if (v.env < 1e-5 && Math.abs(v.bp.y1) < 1e-6) v.on = false;
    }
  }
}

// Random short events (ticks): Poisson spacing with mean `rate` per second, each a decaying sine burst with random pitch,
// decay, level and stereo position. At most `voices` overlap; extra events are dropped (counted in `dropped`).
export class Ticks {
  constructor(rng, sampleRate, { rate = 3, hzLo = 1800, hzHi = 5200, decayLo = 0.002, decayHi = 0.009,
    gainLo = 0.02, gainHi = 0.09, voices = 8 } = {}) {
    Object.assign(this, { r: rng, sr: sampleRate, rate, hzLo, hzHi, decayLo, decayHi, gainLo, gainHi });
    this.v = Array.from({ length: voices }, () => ({ on: false, ph: 0, inc: 0, amp: 0, mul: 0, l: 0, r: 0 }));
    this.left = this.gap();
    this.count = 0; this.dropped = 0;
  }
  gap() { return Math.max(1, Math.round(-Math.log(1 - this.r.next()) / this.rate * this.sr)); }
  spawn() {
    const v = this.v.find((x) => !x.on);
    const r = this.r;
    // Draw every parameter even when no voice is free, so the stream does not depend on voice timing.
    const hz = this.hzLo * Math.pow(this.hzHi / this.hzLo, r.next());
    const decay = r.range(this.decayLo, this.decayHi), amp = r.range(this.gainLo, this.gainHi), pan = r.range(0.15, 0.85);
    this.count++;
    if (!v) { this.dropped++; return; }
    v.on = true; v.ph = r.next() * 2 * Math.PI; v.inc = 2 * Math.PI * hz / this.sr; v.amp = amp;
    v.mul = Math.exp(-1 / (decay * this.sr));
    v.l = Math.cos(pan * Math.PI / 2); v.r = Math.sin(pan * Math.PI / 2);
  }
  // Adds one sample into out[0] (left) and out[1] (right).
  add(out) {
    if (--this.left <= 0) { this.spawn(); this.left = this.gap(); }
    for (const v of this.v) {
      if (!v.on) continue;
      const s = Math.sin(v.ph) * v.amp;
      out[0] += s * v.l; out[1] += s * v.r;
      v.ph += v.inc; if (v.ph > 2 * Math.PI) v.ph -= 2 * Math.PI;
      v.amp *= v.mul;
      if (v.amp < 1e-5) v.on = false;
    }
  }
}

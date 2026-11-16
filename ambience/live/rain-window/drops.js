// Rain-on-glass drop simulation for the rain-window scene (no DOM, no GL; tools/drops_test.mjs runs it in Node).
// KNOWLEDGE\PHYSICS-AND-EFFECTS.md section 6: drops land and bead, grow by merging, release past a critical size and
// slide stick-slip, leaving a thinning trail that dries and breaks into small beads; sliders sweep up the beads below.
// Units: the pane is 1 tall (y = 0 top, 1 bottom) and `aspect` wide; PX = one pixel of a 1080p view.
// Every pool is a fixed typed array (no growth over hours); time is a double; randomness is xoshiro128** (128-bit).

import { rng } from '../shared/prng.js';

export const PX = 1 / 1080;
const PX1080 = PX;
export const LIMITS = { beads: 2400, sliders: 48, segments: 2600 };
// One instance per primitive (the GPU builds the quad, W12 attempt 2: 48 B per primitive instead of 6 x 32 B):
// x0, y0, x1, y1 (axis ends), halfWidth, capExt (along the axis), localY0, localY1, kind, amp, ageFrac, seed.
export const FLOATS_PER_INSTANCE = 12;
export const KIND = { bead: 0, slider: 1, trail: 2 };

const LOSS_PER_PX = 0.0035;     // volume left on the glass per pixel of slide

export function createRain(opts = {}) {
  // opts.px: one view pixel in pane units when the pane is not the full view height (a window in a room, W32), so the
  // drops keep their on-screen size; the default is the full-height rain-window pane.
  const PX = opts.px ?? PX1080;
  const SEG_STEP = 6 * PX;      // trail segment length
  const REPIN_R = 2.8 * PX;     // a slider smaller than this pins again
  const R = rng(opts.seed ?? 'rain-window');
  const L = Object.assign({}, LIMITS, opts.limits);
  const rate = opts.rate ?? 150; // landing drops per second per unit of pane area
  const [rMin, rSpread] = opts.dropR ?? [1.1, 4.4]; // landing radius (view px): rMin + rSpread * u^2
  let aspect = opts.aspect ?? 16 / 9;
  let t = opts.t0 ?? 0;
  let uid = 1;

  // Static beads.
  const bx = new Float64Array(L.beads), by = new Float64Array(L.beads), br = new Float64Array(L.beads);
  const bBorn = new Float64Array(L.beads), bLife = new Float64Array(L.beads), bCrit = new Float64Array(L.beads);
  let nb = 0;
  // Sliding drops.
  const sx = new Float64Array(L.sliders), sy = new Float64Array(L.sliders), sr = new Float64Array(L.sliders);
  const sSlip = new Uint8Array(L.sliders), sTimer = new Float64Array(L.sliders), sV = new Float64Array(L.sliders);
  const sDx = new Float64Array(L.sliders), sPath = new Float64Array(L.sliders), sSegPath = new Float64Array(L.sliders);
  const sBeadPath = new Float64Array(L.sliders), sLx = new Float64Array(L.sliders), sLy = new Float64Array(L.sliders);
  const sId = new Float64Array(L.sliders), sSeed = new Float64Array(L.sliders);
  let ns = 0;
  // Trail segments: a ring buffer; the oldest entry is overwritten (segments live 3-9 s, the ring holds far more).
  const gx0 = new Float64Array(L.segments), gy0 = new Float64Array(L.segments), gx1 = new Float64Array(L.segments);
  const gy1 = new Float64Array(L.segments), gw = new Float64Array(L.segments), gBorn = new Float64Array(L.segments);
  const gLife = new Float64Array(L.segments), gS0 = new Float64Array(L.segments), gSeed = new Float64Array(L.segments);
  const gOwner = new Float64Array(L.segments);
  let gHead = 0, gCount = 0;
  const counters = { landed: 0, merged: 0, released: 0, repinned: 0, offBottom: 0, absorbed: 0, skipped: 0,
    runs: 0, runTime: 0, pauses: 0, pauseTime: 0 };

  const rnd = () => R.next();
  const cbrt3 = (a, b) => Math.cbrt(a * a * a + b * b * b);

  function removeBead(i) {
    nb--;
    bx[i] = bx[nb]; by[i] = by[nb]; br[i] = br[nb]; bBorn[i] = bBorn[nb]; bLife[i] = bLife[nb]; bCrit[i] = bCrit[nb];
  }
  function addBead(x, y, r, crit) {
    // Pool full: the new drop replaces a random old bead, so density follows new landings (e.g. after the pane
    // widens on resize) instead of freezing the old layout.
    let i = nb;
    if (nb >= L.beads) { counters.skipped++; i = Math.min(nb - 1, Math.floor(rnd() * nb)); } else nb++;
    bx[i] = x; by[i] = y; br[i] = r; bBorn[i] = t; bLife[i] = 25 + 50 * rnd();
    bCrit[i] = crit ?? (4.6 + 2.4 * rnd()) * PX; // pinning varies over the pane (dirt, wetting)
    return i;
  }
  function copySlider(d, s) {
    sx[d] = sx[s]; sy[d] = sy[s]; sr[d] = sr[s]; sSlip[d] = sSlip[s]; sTimer[d] = sTimer[s]; sV[d] = sV[s];
    sDx[d] = sDx[s]; sPath[d] = sPath[s]; sSegPath[d] = sSegPath[s]; sBeadPath[d] = sBeadPath[s];
    sLx[d] = sLx[s]; sLy[d] = sLy[s]; sId[d] = sId[s]; sSeed[d] = sSeed[s];
  }
  function removeSlider(i) { ns--; if (i !== ns) copySlider(i, ns); }
  function pause(i) { sSlip[i] = 0; sTimer[i] = Math.min(2.5, Math.max(0.15, (0.2 + 1.8 * rnd()) * (5.5 * PX / sr[i]))); }
  function addSlider(x, y, r) {
    if (ns >= L.sliders) return -1;
    const i = ns++;
    sx[i] = x; sy[i] = y; sr[i] = r; sPath[i] = 0; sSegPath[i] = 0; sBeadPath[i] = 8 + 20 * rnd();
    sLx[i] = x; sLy[i] = y; sId[i] = uid++; sSeed[i] = rnd() * 100; sDx[i] = 0; sV[i] = 0;
    pause(i); sTimer[i] *= 0.3; // a fresh release starts moving soon
    counters.released++;
    return i;
  }
  function pushSegment(i) {
    const dx = sx[i] - sLx[i], dy = sy[i] - sLy[i], len = Math.hypot(dx, dy);
    if (len < 0.5 * PX) return;
    const k = gHead;
    gx0[k] = sLx[i]; gy0[k] = sLy[i]; gx1[k] = sx[i]; gy1[k] = sy[i];
    gw[k] = 0.34 * sr[i]; gBorn[k] = t; gLife[k] = 3 + 6 * rnd(); gS0[k] = sSegPath[i] / PX; gSeed[k] = sSeed[i];
    gOwner[k] = sId[i];
    gHead = (gHead + 1) % L.segments; if (gCount < L.segments) gCount++;
    sLx[i] = sx[i]; sLy[i] = sy[i]; sSegPath[i] = sPath[i];
  }

  // A drop lands at (x, y) with radius r: it merges into whatever it touches, else beads.
  function land(x, y, r) {
    counters.landed++;
    for (let j = 0; j < ns; j++) {
      if (Math.hypot(x - sx[j], y - sy[j]) < sr[j] + r) { sr[j] = cbrt3(sr[j], r); counters.merged++; return; }
    }
    for (let j = 0; j < nb; j++) {
      const rb = br[j];
      if (Math.hypot(x - bx[j], y - by[j]) < (r + rb) * 0.9) {
        const va = r * r * r, vb = rb * rb * rb, nr = cbrt3(r, rb);
        const nx = (x * va + bx[j] * vb) / (va + vb), ny = (y * va + by[j] * vb) / (va + vb);
        counters.merged++;
        if (nr > bCrit[j] && ns < L.sliders) { removeBead(j); addSlider(nx, ny, nr); }
        else { bx[j] = nx; by[j] = ny; br[j] = Math.min(nr, bCrit[j] * 0.98); bBorn[j] = t; }
        return;
      }
    }
    addBead(x, y, r);
  }

  function stepSliders(dt) {
    for (let i = ns - 1; i >= 0; i--) {
      sTimer[i] -= dt;
      if (sSlip[i]) {
        const dy = sV[i] * dt, d = dy * Math.hypot(1, sDx[i]);
        sy[i] += dy; sx[i] += sDx[i] * dy; sPath[i] += d;
        counters.runTime += dt;
        sr[i] *= Math.cbrt(Math.max(0, 1 - LOSS_PER_PX * d / PX));
        if (sPath[i] - sSegPath[i] >= SEG_STEP) pushSegment(i);
        if (sPath[i] / PX >= sBeadPath[i]) { // a small bead stays behind on the trail
          const rb = sr[i] * (0.22 + 0.18 * rnd());
          if (addBead(sx[i] + (rnd() - 0.5) * sr[i] * 0.6, sy[i] - (sr[i] + rb) * 1.15, rb, 99) >= 0) sr[i] = Math.cbrt(Math.max(0, sr[i] ** 3 - rb ** 3));
          sBeadPath[i] = sPath[i] / PX + 10 + 30 * rnd();
        }
        if (sTimer[i] <= 0) { pushSegment(i); pause(i); counters.pauses++; }
      } else {
        counters.pauseTime += dt;
        if (sTimer[i] <= 0) {
          sSlip[i] = 1; counters.runs++;
          sV[i] = Math.min(0.45, Math.max(0.06, (0.10 + 0.25 * rnd()) * Math.pow(sr[i] / (6 * PX), 1.2)));
          sTimer[i] = 0.1 + 0.4 * rnd();
          sDx[i] = (rnd() - 0.5) * 0.25;
        }
      }
      // Sweep up beads in the path.
      for (let j = nb - 1; j >= 0; j--) {
        if (Math.hypot(bx[j] - sx[i], by[j] - sy[i]) < sr[i] + br[j] * 0.8) {
          sr[i] = cbrt3(sr[i], br[j]); removeBead(j); counters.absorbed++;
        }
      }
      if (sy[i] - sr[i] > 1.02) { pushSegment(i); removeSlider(i); counters.offBottom++; continue; }
      if (sr[i] < REPIN_R) {
        pushSegment(i);
        addBead(sx[i], sy[i], sr[i], sr[i] * (1.5 + 0.5 * rnd()));
        removeSlider(i); counters.repinned++;
      }
    }
    // Sliders that touch merge into the larger one.
    for (let i = ns - 1; i > 0; i--) {
      for (let j = i - 1; j >= 0; j--) {
        if (Math.hypot(sx[i] - sx[j], sy[i] - sy[j]) < (sr[i] + sr[j]) * 0.8) {
          const r = cbrt3(sr[i], sr[j]);
          pushSegment(i); pushSegment(j);
          if (sr[i] > sr[j]) copySlider(j, i); // the larger drop carries on (in slot j)
          sr[j] = r;
          removeSlider(i); counters.merged++; break;
        }
      }
    }
  }

  function step(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    t += dt;
    // Poisson landings: expected rate * area * dt; drawn as a count with exponential gaps.
    const lambda = rate * aspect * dt;
    let acc = -Math.log(1 - rnd());
    while (acc < lambda) {
      const u = rnd();
      land(rnd() * aspect, rnd() * 1.04 - 0.02, (rMin + rSpread * u * u) * PX); // most drops small, a few large (sub-pixel specks read as stars)
      acc += -Math.log(1 - rnd());
    }
    // Beads evaporate at the end of their life (they shrink in fill(), then go).
    for (let j = nb - 1; j >= 0; j--) if (t - bBorn[j] > bLife[j]) removeBead(j);
    stepSliders(dt);
  }

  // Write the drawable primitives into a Float32Array, FLOATS_PER_INSTANCE floats each (layout above). The quad spans
  // the axis x0,y0 -> x1,y1 extended by capExt at both ends and halfWidth to each side; local x runs -1..1 across it and
  // local y localY0..localY1 along it (a point has x0 = x1 and its axis points down). Returns the primitives written.
  function fill(buf) {
    const maxPrims = Math.floor(buf.length / FLOATS_PER_INSTANCE);
    let p = 0, o = 0;
    const inst = (x0, y0, x1, y1, w, e, ly0, ly1, kind, amp, a, s) => {
      buf[o++] = x0; buf[o++] = y0; buf[o++] = x1; buf[o++] = y1; buf[o++] = w; buf[o++] = e;
      buf[o++] = ly0; buf[o++] = ly1; buf[o++] = kind; buf[o++] = amp; buf[o++] = a; buf[o++] = s;
      p++;
    };
    const ampOf = (r) => Math.min(1, Math.max(0.2, r / (8 * PX)));
    // Trails first (MAX blending makes order irrelevant for the height, but keeps the count honest).
    for (let n = 0; n < gCount && p < maxPrims; n++) {
      const k = (gHead - 1 - n + L.segments) % L.segments;
      const age = (t - gBorn[k]) / gLife[k];
      if (age >= 1) continue;
      const w = gw[k] * Math.pow(1 - age, 0.6);
      if (w < 0.25 * PX) continue;
      const len = Math.hypot(gx1[k] - gx0[k], gy1[k] - gy0[k]);
      // round caps: extend by the half-width
      const s0 = gS0[k] - w / PX, s1 = gS0[k] + (len + w) / PX;
      const amp = Math.min(0.6, 0.35 * (w / (2.2 * PX)));
      inst(gx0[k], gy0[k], gx1[k], gy1[k], w, w, s0, s1, KIND.trail, amp, age, gSeed[k]);
    }
    for (let j = 0; j < nb && p < maxPrims; j++) {
      const left = bLife[j] - (t - bBorn[j]);
      const r = br[j] * (left < 4 ? Math.max(0, left / 4) : 1);
      if (r < 0.3 * PX) continue;
      inst(bx[j], by[j], bx[j], by[j], r, r, -1, 1, KIND.bead, ampOf(r), 0, 0);
    }
    for (let i = 0; i < ns && p < maxPrims; i++) {
      const r = sr[i], ry = r * 1.25; // sliding heads are a little taller than wide
      inst(sx[i], sy[i], sx[i], sy[i], r, ry, -1.25, 1.25, KIND.slider, ampOf(r), 0, 0);
    }
    return p;
  }

  // Numbers for the tests and window.WA_RAIN: counts, and per slider the length of its fresh trail (live segments
  // younger than half their life, i.e. not yet breaking up) in 1080p pixels.
  function stats() {
    const trail = new Map();
    for (let n = 0; n < gCount; n++) {
      const k = (gHead - 1 - n + L.segments) % L.segments;
      if ((t - gBorn[k]) / gLife[k] >= 0.5) continue;
      trail.set(gOwner[k], (trail.get(gOwner[k]) || 0) + Math.hypot(gx1[k] - gx0[k], gy1[k] - gy0[k]) / PX);
    }
    const sliders = [];
    let live = 0;
    for (let n = 0; n < gCount; n++) { const k = (gHead - 1 - n + L.segments) % L.segments; if (t - gBorn[k] < gLife[k]) live++; }
    for (let i = 0; i < ns; i++) {
      sliders.push({ x: sx[i], y: sy[i], rPx: sr[i] / PX, slipping: !!sSlip[i], trailPx: trail.get(sId[i]) || 0,
        onScreen: sx[i] >= 0 && sx[i] <= aspect && sy[i] >= 0 && sy[i] <= 1 });
    }
    // On-screen beads per third of the pane width, left to right (W51: drop density across the pane per engine).
    const thirds = [0, 0, 0];
    for (let j = 0; j < nb; j++) {
      if (bx[j] < 0 || bx[j] > aspect || by[j] < 0 || by[j] > 1) continue;
      thirds[Math.min(2, Math.floor(3 * bx[j] / aspect))]++;
    }
    let finite = Number.isFinite(t);
    for (let i = 0; i < ns && finite; i++) finite = Number.isFinite(sx[i] + sy[i] + sr[i]);
    for (let j = 0; j < nb && finite; j++) finite = Number.isFinite(bx[j] + by[j] + br[j]);
    return { t, aspect, beads: nb, thirds, sliders, segmentsLive: live, finite, counters: Object.assign({}, counters) };
  }

  // Run the simulation for `seconds` before the first frame so the pane starts wet (coarse steps, 20 per second).
  function warm(seconds) { for (let s = 0; s < seconds * 20; s++) step(0.05); }

  return {
    step, fill, stats, warm,
    setAspect(a) { if (a > 0 && Number.isFinite(a)) aspect = a; },
    get aspect() { return aspect; },
    get t() { return t; },
    maxPrims: L.beads + L.sliders + L.segments,
  };
}

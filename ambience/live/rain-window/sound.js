// Rain on the Cabin Window: sound. Pure DSP (no WebAudio), run by sound.worklet.js in the page and by
// tools/audio_render.mjs --engine node. Nothing recorded, nothing looped; every layer is noise shaped live.
//   patter: a steady stereo rain hiss above 1.4 kHz (ANIMATION.md section 8) with a little low body
//   ticks:  drops hitting the glass, short resonant noise bursts at random spacing, pitch and level, plus rarer fat drops
//   wind:   soft low gusts behind the glass, with a gust-coupled cutoff so a gust sounds brighter, not only louder
// One slow "rain" intensity drift drives the patter level and the tick rates together, so they rise and fall as one.
// Time is a sample count (doubles); randomness from prng.js (xoshiro128**, 128-bit state), one named sub-seed per layer.
import { rng } from '../shared/prng.js';
import { Pink, OnePole, Drift, NoiseTicks } from '../shared/dsp.js';

// Overall trim: puts the 600 s render at about -22 LUFS at the default volume (audio.js DEFAULT_VOLUME 0.8).
const MASTER = 1.35;

// Mixer (W55): one gain per layer group, 0..1. 1 is today's mix, so the top of a slider is never louder than the default.
//   glass: patter, body, glass ticks and fat drops; wind: the gusts. Gains glide over ~50 ms (no zipper noise).
export const MIX_LAYERS = ['glass', 'wind'];
export function clampMix(m) {
  const out = {};
  for (const k of MIX_LAYERS) { const v = Number(m && m[k]); out[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; }
  return out;
}

export function createVoice(sampleRate, seed = 'rain-window', opts = {}) {
  const sr = sampleRate, R = (name) => rng(seed + ':' + name);
  let target = clampMix(opts.mix);
  let gGlass = target.glass, gWind = target.wind;
  const glide = 1 - Math.exp(-1 / (0.05 * sr));
  const rain = new Drift(R('rain'), sr, { lo: 0.72, hi: 1.12, every: 25, glide: 9 });

  // Patter: two independent pink sources (wide stereo), band 1.4-9 kHz, plus a low-passed body under 700 Hz.
  const pinkL = new Pink(R('pinkL')), pinkR = new Pink(R('pinkR')), pinkB = new Pink(R('pinkB'));
  const hiL = [new OnePole(sr, 1400), new OnePole(sr, 1400)], hiR = [new OnePole(sr, 1400), new OnePole(sr, 1400)];
  const loL = new OnePole(sr, 9000), loR = new OnePole(sr, 9000);
  const bodyLp = [new OnePole(sr, 700), new OnePole(sr, 700)], bodyHp = new OnePole(sr, 70);
  const shimmerL = new Drift(R('shimmerL'), sr, { lo: 0.85, hi: 1.15, every: 1.6, glide: 0.6 });
  const shimmerR = new Drift(R('shimmerR'), sr, { lo: 0.85, hi: 1.15, every: 1.6, glide: 0.6 });

  // Glass ticks (many, small, bright) and fat drops (rarer, lower, longer).
  const ticks = new NoiseTicks(R('ticks'), R('ticksNoise'), sr,
    { rate: 11, hzLo: 2400, hzHi: 7500, qLo: 2, qHi: 6, decayLo: 0.0006, decayHi: 0.0028, gainLo: 0.06, gainHi: 0.5, voices: 12 });
  const fat = new NoiseTicks(R('fat'), R('fatNoise'), sr,
    { rate: 1.6, hzLo: 900, hzHi: 2400, qLo: 3, qHi: 8, decayLo: 0.003, decayHi: 0.009, gainLo: 0.08, gainHi: 0.45, voices: 4 });

  // Wind: one pink source, gust level and cutoff from one drift; slow pan drift so it moves across the window.
  const pinkW = new Pink(R('wind'));
  const gust = new Drift(R('gust'), sr, { lo: 0, hi: 1, every: 7, glide: 2.8 });
  const windPan = new Drift(R('windPan'), sr, { lo: 0.3, hi: 0.7, every: 15, glide: 8 });
  const windLp = [new OnePole(sr, 300), new OnePole(sr, 300)], windHp = new OnePole(sr, 45);

  const out = [0, 0];
  let n = 0;
  return {
    // Fills L and R (Float32Array or arrays) with n samples.
    render(L, R, count) {
      for (let i = 0; i < count; i++, n++) {
        const k = rain.next();

        // Patter: high band (two cascaded high-passes for a steeper edge), shimmer per side.
        let l = loL.lp(hiL[1].hp(hiL[0].hp(pinkL.next()))) * shimmerL.next();
        let r = loR.lp(hiR[1].hp(hiR[0].hp(pinkR.next()))) * shimmerR.next();
        const body = bodyHp.hp(bodyLp[1].lp(bodyLp[0].lp(pinkB.next())));
        const pat = 0.62 * k * k;
        out[0] = l * pat + body * 0.16 * k;
        out[1] = r * pat + body * 0.16 * k;

        ticks.add(out, k * k);
        fat.add(out, k);
        if (gGlass !== target.glass) gGlass = Math.abs(target.glass - gGlass) < 1e-6 ? target.glass : gGlass + (target.glass - gGlass) * glide;
        if (gWind !== target.wind) gWind = Math.abs(target.wind - gWind) < 1e-6 ? target.wind : gWind + (target.wind - gWind) * glide;
        if (gGlass !== 1) { out[0] *= gGlass; out[1] *= gGlass; }

        // Wind: gust^2 for soft lulls and short swells; the cutoff opens with the gust (one-pole set every 32 samples).
        const g = gust.next(), gg = g * g;
        if ((n & 31) === 0) { const hz = 160 + 420 * gg; windLp[0].set(hz); windLp[1].set(hz); }
        const w = windHp.hp(windLp[1].lp(windLp[0].lp(pinkW.next()))) * (0.05 + 0.5 * gg) * gWind;
        const p = windPan.next();
        out[0] += w * Math.cos(p * Math.PI / 2) * 1.41;
        out[1] += w * Math.sin(p * Math.PI / 2) * 1.41;

        L[i] = out[0] * MASTER; R[i] = out[1] * MASTER;
      }
    },
    setMix(m) { target = clampMix(Object.assign({}, target, m)); },
    mix: () => ({ ...target }),
    stats() {
      return { ticks: ticks.count, ticksDropped: ticks.dropped, fat: fat.count, fatDropped: fat.dropped };
    },
  };
}

// Rain on the Cabin Window: drops on a night window, refracting a soft view of the forest outside.
// Three passes per frame: (1) the exterior (sky, two conifer rows, ground mist, distant rain) into a half-res target,
// (2) the drop height field (beads, sliding heads, trails from drops.js) into a full-res target with MAX blending,
// (3) composite: blurred exterior through clean glass, an inverted, brighter, sharper exterior inside each drop
// (sample point pushed past the drop centre along the height gradient), a dark edge (internal reflection, no bright
// ring), a specular head highlight, clearer glass along fresh trails, and a warm out-of-focus room reflection.
import { run } from '../shared/core.js';
import { program, fullscreenTriangle, FULLSCREEN_VS, renderTarget, glCount } from '../shared/gl.js';
import { rng } from '../shared/prng.js';
import { startOffset } from '../shared/clock.js';
import { createRain, FLOATS_PER_INSTANCE } from './drops.js';
import { mountSound } from '../shared/audio.js';
import { mountControls } from '../shared/controls.js';
import { mountMixer } from '../shared/mixer.js';

const sound = mountSound({ el: document.getElementById('sound'), worklet: 'sound.worklet.js', processor: 'wa-rain-window', seed: 'rain-window' });
mountControls({ stage: document.getElementById('stage'), sound });
mountMixer({ el: document.getElementById('sound'), sound, key: 'wa-mix-rain-window',
  layers: [{ id: 'glass', label: 'Rain on glass' }, { id: 'wind', label: 'Wind' }] });
window.WAFunnel.mount(document.getElementById('card'), 'rain-window', { base: '../../', linksUrl: '../links.json' });

const HIGHP = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

// (1) Exterior. vUv y is up. Phases: uSky [0, 2400) s, uFall [0, 60) s, uSway [0, 47) s, used only periodically.
const BG_FS = HIGHP + `varying vec2 vUv;
uniform float uAspect, uSky, uFall, uSway;
const float TAU = 6.2831853;
float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
// One row of conifers: coverage in [0, 1]. base = ground line, tree heights in [hmin, hmax], one tree per cell.
float conifers(vec2 p, float cell, float base, float hmin, float hmax, float seed, float sway, float soft) {
  float id = floor(p.x / cell), cov = 0.0;
  for (int k = -2; k <= 2; k++) {
    float j = id + float(k);
    float r1 = hash2(vec2(j, seed)), r2 = hash2(vec2(seed + 3.1, j));
    float top = base + mix(hmin, hmax, r2);
    float dy = top - p.y;
    if (dy < 0.0) continue;
    float c = (j + 0.2 + 0.6 * r1) * cell + sway * dy * dy * (0.6 + 0.8 * r1);
    float tiers = 0.78 + 0.22 * fract(dy * (9.0 + 5.0 * r1) / (hmax - hmin + 0.1));   // branch tiers
    float rag = 0.85 + 0.3 * noise(vec2(p.y * 70.0, j * 7.3));                         // ragged needles
    float hw = dy * (0.20 + 0.06 * r2) * tiers * rag + 0.002;
    cov = max(cov, 1.0 - smoothstep(hw - soft, hw + soft, abs(p.x - c)));
  }
  return cov;
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float a = TAU * uSky / 2400.0, sw = TAU * uSway / 47.0;
  // Overcast night sky, brighter low down; clouds drift on a slow circle through noise space.
  vec3 col = mix(vec3(0.25, 0.28, 0.33), vec3(0.13, 0.16, 0.22), smoothstep(0.35, 1.0, p.y));
  float cl = fbm(vec2(p.x * 1.6 + 0.8 * cos(a), p.y * 3.2 + 0.8 * sin(a)));
  col += (cl - 0.5) * vec3(0.07, 0.075, 0.085) * smoothstep(0.3, 0.7, p.y);
  float sway = 0.004 * sin(sw + p.x * 0.7) + 0.002 * sin(2.0 * sw + p.x * 2.3);   // whole harmonic: seamless at the 47 s wrap
  // Far ridge, mid row, near trees (sparser), each lighter with distance through the rain.
  float farRow = conifers(p, 0.035, 0.30 + 0.04 * fbm(vec2(p.x * 2.0, 1.0)), 0.06, 0.16, 11.0, sway * 0.3, 0.004);
  col = mix(col, vec3(0.165, 0.19, 0.215), farRow);
  float midRow = conifers(p, 0.065, 0.16 + 0.03 * fbm(vec2(p.x * 1.3, 4.0)), 0.16, 0.36, 23.0, sway * 0.6, 0.005);
  col = mix(col, vec3(0.125, 0.15, 0.165), midRow);
  float nearT = conifers(p + vec2(0.37, 0.0), 0.19, -0.05, 0.55, 0.85, 37.0, sway, 0.007);
  col = mix(col, vec3(0.10, 0.12, 0.13), nearT);
  // Ground mist and haze in front of everything.
  col = mix(col, vec3(0.23, 0.26, 0.30), 0.38 * exp(-p.y * 5.0) * (0.8 + 0.4 * fbm(vec2(p.x * 3.0 + 0.4 * sin(a), p.y * 8.0))));
  // Distant rain: faint streaks falling past the trees (pattern repeats exactly at the 60 s phase wrap).
  float cellX = floor(p.x * 260.0);
  float rnd = hash2(vec2(cellX, 5.0));
  float speed = 4.0 + floor(rnd * 4.0);                       // whole cycles per 60 s, so the wrap is seamless
  float yy = fract(p.y * 3.0 + uFall / 60.0 * speed * 3.0 + rnd);
  float streak = smoothstep(0.0, 0.02, yy) * (1.0 - smoothstep(0.03, 0.09, yy)) * (1.0 - smoothstep(0.1, 0.35, abs(fract(p.x * 260.0) - 0.5)));
  col += vec3(0.035, 0.038, 0.042) * streak * step(0.55, rnd);
  gl_FragColor = vec4(col, 1.0);
}`;

// (2) Drop heights, one instance per primitive (drops.js fill() layout). aPos is the quad corner: x -1/1 across the
// axis, y 0/1 along it. Positions in pane units (x in [0, aspect], y down in [0, 1]).
const DROP_VS = `attribute vec2 aPos; attribute vec4 aAxis; attribute vec4 aShape; attribute vec4 aParam;
uniform float uAspect; varying vec2 vLocal; varying vec4 vParam;
void main() {
  vec2 d = aAxis.zw - aAxis.xy; float len = length(d);
  vec2 u = len > 1e-7 ? d / len : vec2(0.0, 1.0), n = vec2(-u.y, u.x);
  vec2 p = mix(aAxis.xy - u * aShape.y, aAxis.zw + u * aShape.y, aPos.y) + n * (aShape.x * aPos.x);
  vLocal = vec2(aPos.x, mix(aShape.z, aShape.w, aPos.y)); vParam = aParam;
  gl_Position = vec4(p.x / uAspect * 2.0 - 1.0, 1.0 - 2.0 * p.y, 0.0, 1.0);
}`;
const DROP_FS = HIGHP + `varying vec2 vLocal; varying vec4 vParam;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
void main() {
  float kind = vParam.x, amp = vParam.y, h = 0.0, wet = 0.0, head = 0.0;
  if (kind < 1.5) {
    vec2 q = vLocal;
    if (kind > 0.5) { q.y /= 1.25; q.x /= 1.0 - 0.28 * clamp(-q.y, 0.0, 1.0); } // sliding head: heavier at the bottom
    float r2 = dot(q, q);
    if (r2 >= 1.0) discard;
    h = amp * sqrt(1.0 - r2);
    if (kind > 0.5) head = 1.0;
  } else {
    // Trail: a thin ridge whose width wobbles along its length and which dries into beads as it ages.
    float s = vLocal.y, age = vParam.z, seed = vParam.w;
    float n = 0.6 * vnoise(s * 0.11 + seed) + 0.4 * vnoise(s * 0.37 + seed * 1.7);
    float keep = smoothstep(age * 1.1 - 0.05, age * 1.1 + 0.12, n);
    float w = 0.75 + 0.25 * sin(s * 0.5 + seed);
    float c = 1.0 - vLocal.x * vLocal.x / (w * w);
    if (c <= 0.0 || keep <= 0.0) discard;
    h = amp * sqrt(c) * keep; wet = keep;
  }
  gl_FragColor = vec4(h, wet, head, 1.0);
}`;

// (3) Composite.
const COMP_FS = HIGHP + `varying vec2 vUv;
uniform sampler2D uBg, uH;
uniform vec2 uTexel;      // one texel of the height target in uv
uniform float uAspect, uGrain;
float H(vec2 uv) { return texture2D(uH, uv).r; }
float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 blurBg(vec2 uv, float r) {
  vec2 d = vec2(r / uAspect, r);
  vec3 s = texture2D(uBg, uv).rgb * 0.2;
  s += texture2D(uBg, uv + d * vec2(1.0, 0.3)).rgb * 0.16 + texture2D(uBg, uv - d * vec2(1.0, 0.3)).rgb * 0.16;
  s += texture2D(uBg, uv + d * vec2(-0.3, 1.0)).rgb * 0.16 + texture2D(uBg, uv - d * vec2(-0.3, 1.0)).rgb * 0.16;
  s += texture2D(uBg, uv + d * vec2(0.7, -0.7)).rgb * 0.08 + texture2D(uBg, uv - d * vec2(0.7, -0.7)).rgb * 0.08;
  return s;
}
vec3 room(vec2 uv) {   // warm lamp-lit room reflected faintly in the glass, out of focus
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec3 c = vec3(0.0);
  c += vec3(0.30, 0.16, 0.06) * exp(-dot(p - vec2(uAspect * 0.80, 0.24), p - vec2(uAspect * 0.80, 0.24)) / 0.010);
  c += vec3(0.20, 0.11, 0.05) * exp(-dot(p - vec2(uAspect * 0.88, 0.33), p - vec2(uAspect * 0.88, 0.33)) / 0.004);
  c += vec3(0.12, 0.07, 0.035) * exp(-dot(p - vec2(uAspect * 0.70, 0.12), p - vec2(uAspect * 0.70, 0.12)) / 0.030);
  c += vec3(0.035, 0.022, 0.012) * (1.0 - smoothstep(0.0, 0.6, uv.y)) * smoothstep(0.2, 1.0, uv.x);
  return c * 0.55;
}
void main() {
  vec4 hs = texture2D(uH, vUv);
  float h = hs.r, wet = hs.g;
  float cover = smoothstep(0.0, 0.05, h);
  vec3 col = blurBg(vUv, 0.009);                                     // through clean glass: soft, unfocused
  // The trail and drop terms below are skipped where their weight is 0 (most of the pane): mix(a, b, 0) is a, so the
  // picture is the same and clean glass costs 8 texture reads instead of 20 (W45: GPU p95).
  float clearW = wet * (1.0 - cover) * 0.7;
  if (clearW > 0.0) col = mix(col, blurBg(vUv, 0.003) * 0.93, clearW); // along a fresh trail the glass is clearer
  if (cover > 0.0) {
    float hx = H(vUv + vec2(uTexel.x, 0.0)) - H(vUv - vec2(uTexel.x, 0.0));
    float hy = H(vUv + vec2(0.0, uTexel.y)) - H(vUv - vec2(0.0, uTexel.y));
    // Gradient per unit of pane height (a texel is uTexel.y of the pane), scaled so a drop's edge is about 1.
    vec2 g = vec2(hx, hy) / (2.0 * uTexel.y) / 135.0;
    // Inside a drop: the exterior inverted and shrunk (sample past the centre), gathered brighter.
    vec2 off = g * vec2(1.0 / uAspect, 1.0) * 0.024;
    vec3 through = texture2D(uBg, clamp(vUv + off, 0.0, 1.0)).rgb * 1.6 + 0.03;
    vec3 n = normalize(vec3(-g * 0.9, 1.0));
    float edge = 1.0 - n.z;
    through *= mix(1.0, 0.55, smoothstep(0.3, 0.8, edge));           // dark edge from internal reflection
    float spec = pow(max(dot(n, normalize(vec3(-0.35, 0.45, 1.0) + vec3(0.0, 0.0, 1.0))), 0.0), 36.0);
    float spec2 = pow(max(dot(n, normalize(vec3(0.5, -0.3, 1.0) + vec3(0.0, 0.0, 1.0))), 0.0), 24.0);
    through += vec3(0.95, 0.9, 0.82) * spec * 1.2 + vec3(0.40, 0.25, 0.13) * spec2 * 0.45;
    // Sliding heads gather more light (bigger lens, wet glass behind them): a soft bright core.
    through += vec3(0.16, 0.16, 0.17) * hs.b * (1.0 - smoothstep(0.2, 0.7, edge));
    col = mix(col, through, cover);
  }
  col += vec3(0.05, 0.052, 0.056) * wet * (1.0 - cover) * smoothstep(0.0, 0.02, h); // wet trail sheen
  col += room(vUv) * (1.0 - 0.5 * cover);
  vec2 v = vUv - 0.5;
  col *= 1.0 - 0.18 * dot(v, v);                                     // gentle lens falloff
  col += (hash2(gl_FragCoord.xy + uGrain * 917.0) - 0.5) * (2.0 / 255.0); // grain against banding
  gl_FragColor = vec4(col, 1.0);
}`;

const sim = createRain({ seed: 'rain-window', t0: startOffset(location.search) }); // ?t0= starts the drops hours in too
// The pane is already wet at the first frame. 15 s fills the bead pool (full at ~10 s) and sends the first sliders down;
// 45 s cost ~1.1 s of main thread here (~4.5 s on a 4x slower phone) (W12). It runs in init(), after the load event, so
// the text and the poster paint first (W45: phone FCP); the poster stays up until the first live frame.
let warmed = false, warming = false;
const grain = rng('rain-window-grain');
const insts = new Float32Array(sim.maxPrims * FLOATS_PER_INSTANCE);
window.WA_RAIN = { stats: () => sim.stats(), instanced: null };

run({
  canvas: document.getElementById('scene'),
  poster: 'poster.webp', // from the scene's own 1920x1080 still (tools/poster.py)
  layers: { sky: 2400, fall: 60, sway: 47 },
  init(ctx) {
    const gl = ctx.gl;
    if (!warmed) { // once: a context restore keeps the drops where they are
      // Warm at the stage's own aspect (resize() only follows init()); at the 16/9 default a wide stage (2.52 at
      // 1920x1080) started with its right third half as wet in every engine (W51).
      const r = gl.canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) sim.setAspect(r.width / r.height);
      // Production: warm in slices from frame() so the main thread is never blocked for seconds (WR-1272, PR 31 review).
      // Test tools (?t0=, ?holdscale=1) need the finished picture on the first frame: they keep the one-shot warm-up.
      const q = new URLSearchParams(location.search);
      if (q.has('t0') || q.get('holdscale') === '1') { sim.warm(15); warming = false; } else { sim.warmBegin(15); warming = true; }
      warmed = true;
    }
    const pBg = program(gl, FULLSCREEN_VS, BG_FS);
    const pDrop = program(gl, DROP_VS, DROP_FS);
    const pComp = program(gl, FULLSCREEN_VS, COMP_FS);
    const tri = fullscreenTriangle(gl);
    // The exterior is out of focus and blurred again in the composite; 1/3 res keeps GPU p95 under 4 ms at 1080p (W12).
    const bgScale = 1 / 3;
    const bg = renderTarget(gl, 1, 1), hRT = renderTarget(gl, 1, 1);
    // Instancing (WebGL2 core, WebGL1 ANGLE_instanced_arrays): the CPU uploads 48 B per drop instead of a 192 B quad.
    // The ~690 KB per-frame upload of the old layout capped the free-running frame rate at ~51 fps (W12).
    const inst = ctx.version === 2
      ? { draw: (m, f, c, n) => gl.drawArraysInstanced(m, f, c, n), div: (l, d) => gl.vertexAttribDivisor(l, d) }
      : (() => {
        const e = gl.getExtension('ANGLE_instanced_arrays');
        return e && { draw: (m, f, c, n) => e.drawArraysInstancedANGLE(m, f, c, n), div: (l, d) => e.vertexAttribDivisorANGLE(l, d) };
      })();
    window.WA_RAIN.instanced = !!inst; // without it (very rare WebGL1) the glass shows no drops, the rest still runs
    const corners = gl.createBuffer(), ibo = gl.createBuffer(); glCount.buffers += 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ARRAY_BUFFER, insts.byteLength, gl.DYNAMIC_DRAW);
    const locs = ['aAxis', 'aShape', 'aParam'].map((a) => gl.getAttribLocation(pDrop.prog, a));
    const ext = ctx.version === 2 ? null : gl.getExtension('EXT_blend_minmax');
    const MAX = ctx.version === 2 ? gl.MAX : ext ? ext.MAX_EXT : 0;
    let W = 1, Hh = 1;
    return {
      resize(w, h) {
        W = w; Hh = h;
        sim.setAspect(w / h);
        bg.resize(Math.ceil(w * bgScale), Math.ceil(h * bgScale));
        hRT.resize(w, h);
      },
      frame(f) {
        if (warming) { // spread warm-up: no picture (the poster stays up) until the pane is wet; frame() returns false
          if (!sim.warmSome(8)) return false;
          warming = false;
        } else sim.step(f.dt);
        const aspect = W / Hh;
        // (1) exterior
        bg.bind();
        gl.useProgram(pBg.prog);
        gl.uniform1f(pBg.loc('uAspect'), aspect);
        gl.uniform1f(pBg.loc('uSky'), f.phase('sky'));
        gl.uniform1f(pBg.loc('uFall'), f.phase('fall'));
        gl.uniform1f(pBg.loc('uSway'), f.phase('sway'));
        tri.draw();
        // (2) drop heights
        hRT.bind();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const n = inst ? sim.fill(insts) : 0;
        if (n > 0) {
          gl.enable(gl.BLEND);
          if (MAX) gl.blendEquation(MAX); else gl.blendEquation(gl.FUNC_ADD); // no MAX: overlaps add (slightly taller)
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(pDrop.prog);
          gl.uniform1f(pDrop.loc('uAspect'), aspect);
          gl.bindBuffer(gl.ARRAY_BUFFER, corners);
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, insts.subarray(0, n * FLOATS_PER_INSTANCE));
          const stride = FLOATS_PER_INSTANCE * 4;
          locs.forEach((l, i) => {
            gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, stride, 16 * i); inst.div(l, 1);
          });
          inst.draw(gl.TRIANGLE_STRIP, 0, 4, n);
          locs.forEach((l) => { inst.div(l, 0); gl.disableVertexAttribArray(l); });
          gl.blendEquation(gl.FUNC_ADD);
          gl.disable(gl.BLEND);
        }
        // (3) composite to the canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, Hh);
        gl.useProgram(pComp.prog);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bg.tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, hRT.tex);
        gl.uniform1i(pComp.loc('uBg'), 0);
        gl.uniform1i(pComp.loc('uH'), 1);
        gl.uniform2f(pComp.loc('uTexel'), 1 / W, 1 / Hh);
        gl.uniform1f(pComp.loc('uAspect'), aspect);
        gl.uniform1f(pComp.loc('uGrain'), grain.next());
        tri.draw();
        gl.activeTexture(gl.TEXTURE0);
      },
      dispose() {
        tri.dispose(); bg.dispose(); hRT.dispose();
        gl.deleteBuffer(corners); gl.deleteBuffer(ibo); glCount.buffers -= 2;
        gl.deleteProgram(pBg.prog); gl.deleteProgram(pDrop.prog); gl.deleteProgram(pComp.prog);
        glCount.programs -= 3;
      },
    };
  },
});

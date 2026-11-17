// web-ambient runtime: loop, double-precision clock with bounded per-layer phases, quality tiers, fps and DPR caps,
// dynamic resolution, pause when hidden or off-screen, reduced-motion / Save-Data poster with "Start the scene",
// WebGL2 -> WebGL1 -> poster fallback, context loss and restore, and window.WA.health() for the test tools.
//
// Usage (in a scene's index.html, type="module"):
//   import { run } from '../shared/core.js';
//   run({ canvas, poster: 'poster.webp', layers: { rain: 600, wind: 1800 },
//         init(ctx) { ...build GL objects...; return { resize(w, h) {}, frame(f) {}, dispose() {} }; } });
// f = { t, dt, phase(name), tier, width, height, gl, version }. ctx = { gl, version, tier, rng(seed) }.
// Optional opts.health() returns scene-specific checks; health() reports them under `scene`.
// The scene's GL objects must be made with gl.js (they are counted) and must be rebuilt in init() after a restore.

import { wrapPhase, startOffset } from './clock.js';
import { getContext, glObjects, resetCounts } from './gl.js';
import { rng } from './prng.js';

export const TIERS = {
  low: { fps: 30, dpr: 1, scale: 0.6 },
  medium: { fps: 60, dpr: 1.5, scale: 0.85 },
  high: { fps: 60, dpr: 2, scale: 1 },
};
const PHONE_FPS = 30, PHONE_DPR = 1.5;
const MIN_SCALE = 0.45;

// Tier from device hints; ?tier=low|medium|high overrides. Phones: 30 fps and DPR <= 1.5 whatever the tier.
export function pickTier(env) {
  const q = new URLSearchParams(env.search || '').get('tier');
  const phone = !!env.coarse && Math.min(env.screenW || 0, env.screenH || 0) < 820;
  let name;
  if (q && TIERS[q]) name = q;
  else if ((env.mem && env.mem <= 2) || (env.cores && env.cores <= 2) || env.saveData) name = 'low';
  else if (phone || (env.mem && env.mem <= 4) || (env.cores && env.cores <= 4)) name = 'medium';
  else name = 'high';
  const t = Object.assign({ name, phone }, TIERS[name]);
  if (phone) { t.fps = Math.min(t.fps, PHONE_FPS); t.dpr = Math.min(t.dpr, PHONE_DPR); }
  return t;
}

function envHints() {
  const n = navigator, c = n.connection || {};
  return {
    search: location.search,
    coarse: matchMedia('(pointer: coarse)').matches,
    screenW: screen.width, screenH: screen.height,
    mem: n.deviceMemory, cores: n.hardwareConcurrency,
    saveData: !!c.saveData,
  };
}

export function run(opts) {
  const canvas = opts.canvas;
  const stage = opts.stage || canvas.parentElement;
  const layers = opts.layers || {};
  const env = envHints();
  const tier = pickTier(env);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gated = reduced || env.saveData; // never start by itself

  const st = {
    t: startOffset(location.search), frames: 0, hiddenFrames: 0, offscreenFrames: 0, errors: [],
    running: false, visible: !document.hidden, onScreen: true, started: false, lost: false,
    scale: tier.scale, slow: 0, fast: 0, last: 0, drawn: 0, acc: 0, gapAvg: 0, pausedAt: 0, raf: 0, gl: null, version: 0, scene: null, finite: true,
  };
  const budget = 1000 / tier.fps;
  // ?holdscale=1 (test tools only, like ?t0= and ?tier=): keep the tier scale, so hero stills are drawn at native size.
  const holdScale = new URLSearchParams(location.search).get('holdscale') === '1';

  // Poster overlay and Start button. The poster is visible until the first live frame and on any fallback.
  const poster = document.createElement('div');
  poster.className = 'wa-poster';
  if (opts.poster) poster.style.backgroundImage = 'url("' + opts.poster + '")';
  const msg = document.createElement('p');
  msg.className = 'wa-poster-msg';
  msg.setAttribute('aria-live', 'polite');
  poster.appendChild(msg);
  stage.appendChild(poster);
  const showPoster = (text) => { poster.hidden = false; msg.textContent = text || ''; };
  const hidePoster = () => { poster.hidden = true; };

  // The "still" sentence only where a poster exists (the reef has none until W18 makes it).
  function fail(text, e) {
    if (e) st.errors.push(String(e && e.message || e));
    st.failed = true; // a failed scene stays stopped: returning to the tab must not restart it in a loop (WR-1272)
    stop();
    showPoster(text + (opts.poster ? ' This picture is a still from it.' : ''));
  }

  function initGL() {
    const c = getContext(canvas, opts.contextAttributes);
    if (!c) return fail('This browser cannot draw the live scene.'), false;
    st.gl = c.gl; st.version = c.version; st.failed = false;
    resetCounts();
    try {
      st.scene = opts.init({ gl: st.gl, version: st.version, tier, rng });
    } catch (e) { return fail('The live scene could not start.', e), false; }
    st.failed = false;
    resize(true);
    return true;
  }

  function resize(force) {
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dpr);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr * st.scale)), h = Math.max(1, Math.round(r.height * dpr * st.scale));
    if (force || w !== canvas.width || h !== canvas.height) {
      canvas.width = w; canvas.height = h;
      if (st.scene && st.scene.resize) st.scene.resize(w, h);
    }
  }

  function phase(name) {
    const p = layers[name];
    if (!p) throw new Error('unknown layer ' + name);
    return wrapPhase(st.t, p);
  }

  function draw(dt) {
    if (document.hidden) st.hiddenFrames++;
    if (!st.onScreen) st.offscreenFrames++;
    st.frames++;
    try {
      const drew = st.scene.frame({ t: st.t, dt, phase, tier: tier.name, width: canvas.width, height: canvas.height,
        gl: st.gl, version: st.version });
      // Only a frame that drew hides the poster (BH2-3: a throw on frame 1 must leave the still and its message).
      // A scene that returns false is still warming up (rain-window spreads its warm-up over frames, WR-1272): no picture yet.
      if (!st.shown && drew !== false) { st.shown = true; hidePoster(); st.firstFrameMs = performance.now(); }
    } catch (e) { fail('The live scene stopped.', e); }
    if (!Number.isFinite(st.t)) st.finite = false;
  }

  // Dynamic resolution: 30 long frames in a row -> scale down 15%; 240 quick frames -> back up 5% (to the tier scale).
  // Judged by the smoothed gap between drawn frames (the achieved rate), not by single gaps: on a 75 or 144 Hz display
  // the cap alternates short and long gaps that average out to the budget.
  function adapt(gap) {
    if (holdScale) return;
    st.gapAvg += (gap - st.gapAvg) * 0.1;
    const g = st.gapAvg;
    if (g > budget * 1.35) { st.slow++; st.fast = 0; } else if (g < budget * 1.1) { st.fast++; st.slow = 0; }
    if (st.slow >= 30 && st.scale > MIN_SCALE) { st.scale = Math.max(MIN_SCALE, st.scale * 0.85); st.slow = 0; resize(); }
    if (st.fast >= 240 && st.scale < tier.scale) { st.scale = Math.min(tier.scale, st.scale * 1.05); st.fast = 0; resize(); }
  }

  function tick(now) {
    st.raf = 0;
    if (!st.running) return;
    st.raf = requestAnimationFrame(tick);
    if (!st.last) { st.last = st.drawn = now; st.acc = 0; st.gapAvg = budget; return; }
    // fps cap with an accumulator: skipped callbacks carry their time over, so a 75 or 144 Hz display still draws
    // at the cap on average (2 ms slack for vsync jitter; the carry is clamped so a stall never bursts frames).
    st.acc += now - st.last;
    st.last = now;
    if (st.acc < budget - 2) return;
    st.acc = Math.min(st.acc - budget, budget);
    const gap = now - st.drawn;
    st.drawn = now;
    const dt = Math.min(gap / 1000, 0.1); // a long stall never jumps the scene
    st.t += dt;
    // One long gap is a pause (GC, OS hiccup, debugger), not slowness: it must not shrink the canvas (BH2-4).
    if (gap > budget * 4) { st.gapAvg = budget; st.slow = 0; } else adapt(gap);
    resize();
    draw(dt);
  }

  // Scene time keeps going in wall time while the picture is paused for a hidden tab or an off-screen canvas, so the
  // picture catches up on return and a sound that played on follows it forward (BH2-2: before, the sync rewound the
  // fireplace voice by the whole hidden time and replayed its pops). A visitor's pause() freezes the clock.
  const liveT = () => st.t + (st.pausedAt ? (performance.now() - st.pausedAt) / 1000 : 0);
  function shouldRun() { return st.started && st.visible && st.onScreen && !st.lost && !st.failed && !!st.scene; }
  function start() {
    if (st.running || !shouldRun()) return;
    st.t = liveT(); st.pausedAt = 0;
    st.running = true; st.last = 0; st.raf = requestAnimationFrame(tick);
  }
  function stop() { st.running = false; if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }
  function update() {
    if (shouldRun()) return start();
    if (st.running && (!st.visible || !st.onScreen)) st.pausedAt = performance.now();
    stop();
  }

  document.addEventListener('visibilitychange', () => { st.visible = !document.hidden; update(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { st.onScreen = es[es.length - 1].isIntersecting; update(); }).observe(canvas);
  }
  window.addEventListener('resize', () => resize());

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    st.lost = true; st.scene = null; stop();
    showPoster('The graphics card paused the scene. It comes back by itself.');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    st.lost = false;
    if (initGL()) { hidePoster(); update(); }
  });

  function begin() {
    if (st.started) return;
    st.started = true;
    if (!st.scene && !initGL()) return;
    update();
  }

  // Start only after load; under reduced motion or Save-Data wait for the visitor.
  function afterLoad() {
    showPoster('');
    if (gated) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wa-btn wa-btn-brass wa-start'; b.textContent = 'Start the scene';
      b.addEventListener('click', () => { b.remove(); begin(); });
      poster.appendChild(b);
    } else begin();
  }
  if (document.readyState === 'complete') afterLoad(); else window.addEventListener('load', afterLoad, { once: true });

  const api = {
    health() {
      const m = performance.memory;
      return { frames: st.frames, hiddenFrames: st.hiddenFrames, offscreenFrames: st.offscreenFrames, tier: tier.name,
        dpr: Math.min(window.devicePixelRatio || 1, tier.dpr), scale: st.scale, t: liveT(), glVersion: st.version,
        glObjects: glObjects(), heapMB: m ? m.usedJSHeapSize / 1048576 : null, errors: st.errors.slice(),
        finite: st.finite && Number.isFinite(st.t), running: st.running, gated: gated && !st.started,
        firstFrameMs: st.firstFrameMs ?? null, scene: opts.health ? opts.health() : null };
    },
    // Accelerated long-play for tests: advance n frames of dt seconds each, drawing every frame, without rAF.
    step(n, dt) {
      if (!st.scene) return api.health();
      for (let i = 0; i < n; i++) { st.t += dt; draw(dt); }
      return api.health();
    },
    // The live context for test tools (gputime.js); null on a fallback or while the context is lost.
    gl() { return st.gl && st.scene && !st.lost ? { gl: st.gl, version: st.version } : null; },
    start: begin,
    pause() { st.t = liveT(); st.pausedAt = 0; st.started = false; stop(); },
  };
  window.WA = api;
  return api;
}

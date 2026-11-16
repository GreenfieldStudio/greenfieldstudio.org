// web-ambient sound engine (BRIEF.md section 4): sound never starts by itself. A tap on "Sound on" creates the
// AudioContext, loads the scene's AudioWorklet module, and fades in over 2 s. Mute, volume, a gentle master limiter, and
// a "sound not supported" message when AudioWorklet is missing (no ScriptProcessor fallback in round 1).
// Graph: AudioWorkletNode (scene voice) -> fade gain -> volume gain -> limiter (DynamicsCompressor) -> destination.
//
//   import { mountSound } from '../shared/audio.js';
//   mountSound({ el: document.getElementById('sound'), worklet: 'sound.worklet.js', processor: 'wa-selftest' });
//
// renderOffline() runs the same graph in an OfflineAudioContext (tools/audio_render.mjs); window.WA_AUDIO exposes it.

export const FADE_S = 2;
export const DEFAULT_VOLUME = 0.8;

export function supported(w = globalThis) {
  return !!(w.AudioContext && w.AudioWorkletNode && w.AudioContext.prototype && 'audioWorklet' in w.AudioContext.prototype);
}

// Builds the graph on any BaseAudioContext; returns the nodes. `volume` is the starting volume (0..1).
// `clock` (optional) returns the scene time in seconds; the voice starts there (processorOptions.t0).
async function build(ctx, { worklet, processor, seed, volume, fadeFrom = 0, clock, mix }) {
  await ctx.audioWorklet.addModule(worklet);
  const t0 = clock ? clock() : 0;
  const voice = new AudioWorkletNode(ctx, processor, { numberOfInputs: 0, outputChannelCount: [2],
    processorOptions: { seed, t0: Number.isFinite(t0) && t0 >= 0 ? t0 : 0, mix: mix || null } });
  const fade = new GainNode(ctx, { gain: 0 });
  const vol = new GainNode(ctx, { gain: volume });
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });
  voice.connect(fade).connect(vol).connect(limiter).connect(ctx.destination);
  const t = ctx.currentTime + fadeFrom;
  fade.gain.setValueAtTime(0, t);
  fade.gain.linearRampToValueAtTime(1, t + FADE_S);
  return { voice, fade, vol, limiter };
}

// Renders `seconds` of the scene's sound offline at `sampleRate`, default volume, with the 2 s fade-in.
// Returns [Float32Array left, Float32Array right].
export async function renderOffline({ worklet, processor, seed, seconds = 600, sampleRate = 48000,
  volume = DEFAULT_VOLUME, mix = null }) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(seconds * sampleRate), sampleRate });
  await build(ctx, { worklet, processor, seed, volume, mix });
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

// Mounts the Sound on / mute / volume controls into `el`. Returns the controller (also used by tests).
// `clock` (optional): () => scene seconds, for a voice that follows the picture (fireplace pops land with the sparks).
// The voice starts at that time and gets { sync } every SYNC_S seconds and when the tab is shown again, because the
// picture stops in a hidden tab while the sound keeps playing.
const SYNC_S = 15;
// `mix` (optional): starting layer gains for a voice with setMix (rain-window mixer, W55); api.setMix() changes them live.
export function mountSound({ el, worklet, processor, seed, volume = DEFAULT_VOLUME, clock, mix = null }) {
  const absWorklet = new URL(worklet, document.baseURI).href;
  const st = { ctx: null, nodes: null, on: false, muted: false, volume, starting: null, mix };
  el.classList.add('wa-sound');
  const status = document.createElement('p');
  status.className = 'wa-sound-status';
  status.setAttribute('aria-live', 'polite');

  if (!supported()) {
    status.textContent = 'Sound not supported in this browser.';
    el.appendChild(status);
    return { supported: false, state: () => ({ supported: false }) };
  }

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'wa-btn wa-btn-brass'; btn.textContent = 'Sound on';
  btn.setAttribute('aria-pressed', 'false');
  const label = document.createElement('label');
  label.className = 'wa-sound-vol';
  label.textContent = 'Volume ';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = String(Math.round(volume * 100));
  label.appendChild(slider);
  el.append(btn, label, status);

  const say = (t) => { status.textContent = t; };
  const gainNow = () => (st.muted ? 0 : st.volume);
  const ramp = (v) => { const g = st.nodes.vol.gain, t = st.ctx.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(v, t, 0.05); };

  async function start() {
    if (st.ctx) { await st.ctx.resume(); return; }
    // The AudioContext is created inside the tap handler (autoplay rules).
    st.ctx = new AudioContext({ latencyHint: 'playback' });
    try {
      st.nodes = await build(st.ctx, { worklet: absWorklet, processor, seed, volume: gainNow(), clock, mix: st.mix });
    } catch (e) {
      // A failed build (worklet fetch blip) must not leave a half-made context behind: the next tap starts afresh.
      const ctx = st.ctx;
      st.ctx = st.nodes = null;
      await ctx.close().catch(() => {});
      throw e;
    }
    if (clock) {
      const sync = () => { if (st.nodes && !document.hidden) st.nodes.voice.port.postMessage({ sync: clock() }); };
      setInterval(sync, SYNC_S * 1000);
      document.addEventListener('visibilitychange', () => setTimeout(sync, 100));
    }
  }

  // The tap handler; also the space key (controls.js) through api.toggle(), so it runs inside a user gesture.
  async function toggle() {
    if (st.starting) return;
    try {
      if (!st.on) {
        st.starting = start(); await st.starting;
        st.on = true; st.muted = false; ramp(gainNow());
        btn.textContent = 'Sound off'; btn.setAttribute('aria-pressed', 'true'); say('Sound is on.');
      } else {
        st.muted = true; ramp(0); st.on = false;
        btn.textContent = 'Sound on'; btn.setAttribute('aria-pressed', 'false'); say('Sound is off.');
      }
    } catch (e) {
      st.on = false;
      say('Sound could not start in this browser.');
      st.error = String(e && e.message || e);
    } finally { st.starting = null; }
  }
  btn.addEventListener('click', toggle);
  slider.addEventListener('input', () => {
    st.volume = Number(slider.value) / 100;
    if (st.nodes) ramp(gainNow());
  });

  const api = {
    supported: true,
    toggle,
    // "Pause all" stops sound too (the hidden-tab rule keeps it playing otherwise).
    async suspend() { if (st.ctx) await st.ctx.suspend(); },
    async resume() { if (st.ctx && st.on) await st.ctx.resume(); },
    // Mixer: kept for the next start and sent to a running voice.
    setMix(m) { st.mix = Object.assign({}, st.mix, m); if (st.nodes) st.nodes.voice.port.postMessage({ mix: st.mix }); },
    state: () => ({ supported: true, on: st.on, muted: st.muted, volume: st.volume, mix: st.mix,
      ctxState: st.ctx ? st.ctx.state : 'none', error: st.error || null }),
  };
  window.WA_AUDIO = Object.assign(window.WA_AUDIO || {}, api, {
    render: (seconds, sampleRate, mix = st.mix) => renderOffline({ worklet: absWorklet, processor, seed, seconds, sampleRate, volume, mix }),
  });
  return api;
}

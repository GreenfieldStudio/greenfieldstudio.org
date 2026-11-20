// AudioWorklet side of audio.js: registers a processor that runs a scene's pure-DSP voice (createVoice from its sound.js).
// Import only from a worklet module (AudioWorkletProcessor and registerProcessor exist only in that scope):
//   import { createVoice } from './sound.js';
//   import { registerVoice } from '../shared/voice-processor.js';
//   registerVoice('wa-selftest', createVoice);
export function registerVoice(name, createVoice) {
  registerProcessor(name, class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.voice = createVoice(sampleRate, o.seed, o);
      this.alive = true;
      this.port.onmessage = (e) => {
        if (e.data === 'stop') this.alive = false;
        // { sync: sceneSeconds } re-aligns a voice that follows the picture's clock (fireplace); others ignore it.
        else if (e.data && Number.isFinite(e.data.sync) && this.voice.sync) this.voice.sync(e.data.sync);
        // { mix: { layer: 0..1 } } sets a voice's mixer gains (rain-window, W55); voices without setMix ignore it.
        else if (e.data && e.data.mix && this.voice.setMix) this.voice.setMix(e.data.mix);
      };
    }
    process(inputs, outputs) {
      const out = outputs[0];
      const L = out[0];
      if (out[1]) this.voice.render(L, out[1], L.length);
      else { // mono output: render both channels into scratch and fold them (WR-1272: R must not overwrite L)
        if (!this.scratch || this.scratch.length < L.length) this.scratch = new Float32Array(L.length);
        const R = this.scratch.subarray(0, L.length);
        this.voice.render(L, R, L.length);
        for (let i = 0; i < L.length; i++) L[i] = 0.5 * (L[i] + R[i]);
      }
      return this.alive;
    }
  });
}

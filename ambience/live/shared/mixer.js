// web-ambient sound mixer (W55, BRIEF.md section 9): one range slider per sound layer, under the volume control.
// 100 % is today's mix and the top of every slider, so the mixer only ever makes a layer quieter (never louder than the
// default render). Levels are kept per visitor in localStorage (every access in try/catch; the page works without it).
//
//   import { mountMixer } from '../shared/mixer.js';
//   mountMixer({ el: document.getElementById('sound'), sound, key: 'wa-mix-rain-window',
//     layers: [{ id: 'glass', label: 'Rain on glass' }, { id: 'wind', label: 'Wind' }] });
//
// `sound` is the controller mountSound() returns (setMix); `doc`/`storage` are injectable for tests.

export function loadMix(storage, key, layers) {
  const mix = {};
  for (const l of layers) mix[l.id] = 1;
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (saved && typeof saved === 'object') {
      for (const l of layers) {
        const v = Number(saved[l.id]);
        if (Number.isFinite(v)) mix[l.id] = Math.min(1, Math.max(0, v));
      }
    }
  } catch { /* blocked or corrupt storage: today's mix */ }
  return mix;
}

export function saveMix(storage, key, mix) {
  try { storage.setItem(key, JSON.stringify(mix)); return true; } catch { return false; }
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function mountMixer({ el, sound, key, layers, doc = document, storage = defaultStorage() }) {
  const store = storage || { getItem: () => null, setItem: () => { throw new Error('no storage'); } };
  const mix = loadMix(store, key, layers);
  if (!sound || !sound.setMix) return { mix: () => ({ ...mix }), inputs: [] };
  sound.setMix(mix);

  const box = doc.createElement('fieldset');
  box.className = 'wa-mixer';
  const legend = doc.createElement('legend');
  legend.textContent = 'Sound mix';
  box.appendChild(legend);

  const inputs = [];
  for (const l of layers) {
    const label = doc.createElement('label');
    label.className = 'wa-sound-vol wa-mixer-layer';
    label.textContent = l.label + ' ';
    const slider = doc.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = String(Math.round(mix[l.id] * 100));
    slider.setAttribute('aria-valuetext', `${slider.value} %`);
    slider.addEventListener('input', () => {
      const v = Math.min(100, Math.max(0, Number(slider.value) || 0));
      mix[l.id] = v / 100;
      slider.setAttribute('aria-valuetext', `${v} %`);
      sound.setMix({ [l.id]: mix[l.id] });
      saveMix(store, key, mix);
    });
    label.appendChild(slider);
    box.appendChild(label);
    inputs.push(slider);
  }
  el.appendChild(box);
  return { mix: () => ({ ...mix }), inputs };
}

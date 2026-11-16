// web-ambient "Follows your clock" (W56, BRIEF.md section 9, MARKETING.md section 7 idea 3): an opt-in checkbox that lets
// the visitor's local time pick day or night in the scene. Off by default (the scene keeps its default look). Night is
// 19:00-06:00 local wall-clock time; the light comes up over 06:00-07:00 and goes down over 18:00-19:00. The wall clock
// comes from Date's local fields, so DST days and midnight need no special case. The choice is kept per visitor in
// localStorage (every access in try/catch). ?clock=HH:MM is a test clock: it turns the mode on at that local time.
//
//   import { mountDayClock } from '../shared/dayclock.js';
//   const day = mountDayClock({ el: document.getElementById('clock'), key: 'wa-clock-fireplace' });
//   day.amount() // 0 = night .. 1 = day, already 0 when the mode is off
//
// `doc`/`storage`/`now`/`search` are injectable for tests.

export const NIGHT_FROM = 19 * 60, DAY_FROM = 6 * 60, RAMP = 60; // minutes after local midnight
const DAY_MIN = 24 * 60;

// Minutes after local midnight, [0, 1440), from a Date's local fields.
export function localMinutes(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
}

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// 0 = night .. 1 = day for a local time in minutes (any number; wrapped into one day).
export function dayAmount(min) {
  if (!Number.isFinite(min)) return 0;
  const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  if (m < DAY_FROM || m >= NIGHT_FROM) return 0;
  if (m < DAY_FROM + RAMP) return smooth((m - DAY_FROM) / RAMP);
  if (m >= NIGHT_FROM - RAMP) return smooth((NIGHT_FROM - m) / RAMP);
  return 1;
}

// ?clock=HH:MM (00:00-23:59) -> minutes, else null.
export function testClock(search) {
  const v = new URLSearchParams(search || '').get('clock');
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export function loadFollow(storage, key) {
  try { return storage.getItem(key) === '1'; } catch { return false; }
}
export function saveFollow(storage, key, on) {
  try { storage.setItem(key, on ? '1' : '0'); return true; } catch { return false; }
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function mountDayClock({ el, key, doc = document, storage = defaultStorage(), now = () => new Date(),
  search = (globalThis.location && globalThis.location.search) || '', onChange = null }) {
  const store = storage || { getItem: () => null, setItem: () => { throw new Error('no storage'); } };
  const fixed = testClock(search);
  let on = fixed !== null || loadFollow(store, key);

  const wrap = doc.createElement('div');
  wrap.className = 'wa-dayclock';
  const label = doc.createElement('label');
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  const hint = 'Daylight in the room 07:00-18:00 your time, night 19:00-06:00';
  box.setAttribute('aria-describedby', `${key}-hint`);
  label.appendChild(box);
  label.appendChild(doc.createTextNode(' Follows your clock'));
  const note = doc.createElement('span');
  note.className = 'wa-dayclock-hint';
  note.id = `${key}-hint`;
  note.textContent = hint;
  wrap.appendChild(label);
  wrap.appendChild(note);
  box.addEventListener('change', () => {
    on = !!box.checked;
    if (fixed === null) saveFollow(store, key, on);
    if (onChange) onChange(on);
  });
  el.appendChild(wrap);

  return {
    on: () => on,
    amount: () => (on ? dayAmount(fixed !== null ? fixed : localMinutes(now())) : 0),
    input: box,
  };
}

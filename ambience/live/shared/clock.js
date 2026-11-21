// web-ambient clock helpers. Time is a JS double in seconds; shaders only ever see bounded phases.
// A layer's phase is its time wrapped at its own period, computed in double, so float32 uniforms stay small
// (< period) however long the page plays. A shader must use a phase only through functions that repeat with that
// period (e.g. sin(2*pi*phase/period)) so the wrap is invisible.

// Wrap t into [0, period). Safe for negative t and for rounding at the top edge.
export function wrapPhase(t, period) {
  if (!(period > 0) || !Number.isFinite(t)) return 0;
  let p = t - Math.floor(t / period) * period;
  if (p >= period || p < 0) p = 0;
  return p;
}

// Read ?t0= (seconds, default 0). Lets tests start a scene hours in.
export function startOffset(search) {
  const v = Number(new URLSearchParams(search || '').get('t0'));
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

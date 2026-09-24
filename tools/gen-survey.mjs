#!/usr/bin/env node
/**
 * gen-survey.mjs — prints the inline SVG for the hero's "surveyed" shot: a dotted
 * trajectory from ball to cup, with dots spaced EVENLY BY ARC LENGTH (not by the
 * Bezier parameter, which bunches dots at the ends and reads as machine-made).
 *
 *   node tools/gen-survey.mjs wide   > (paste into index.html .survey--wide)
 *   node tools/gen-survey.mjs tall   > (paste into index.html .survey--tall)
 *   node tools/gen-survey.mjs miss   > (paste into 404.html)
 *
 * The output is pasted rather than generated at runtime so the page needs no JS to
 * draw it, and so the numbers in the file are the numbers you see.
 */
const variant = process.argv[2] || 'wide';

const V = {
  // viewBox, ball, cup, control polygon, dot spacing/radius, annotations
  wide: { w: 1600, h: 640, ball: [170, 500], cup: [1430, 500], p: [[190, 482], [470, 50], [1150, -40], [1418, 476]], gap: 33, r: 3.1, font: 15 },
  // phone: no annotations — at ~330 px wide they would render at ~8 px, i.e. noise
  tall: { w: 400, h: 250, ball: [34, 214], cup: [366, 214], p: [[42, 204], [110, 20], [300, -10], [362, 198]], gap: 11.5, r: 1.55, font: 9.5, annos: false },
  // 404: the shot runs long — straight past the cup and off the green
  miss: { w: 1600, h: 560, ball: [150, 430], cup: [1210, 430], p: [[170, 414], [430, -10], [1120, -60], [1545, 470]], gap: 33, r: 3.1, font: 15, miss: true },
}[variant];
if (!V) { console.error('variant: wide | tall | miss'); process.exit(1); }

const bez = ([p0, p1, p2, p3], t) => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

// dense polyline → cumulative arc length → resample at equal spacing
const N = 4000;
const pts = [], cum = [0];
for (let i = 0; i <= N; i++) pts.push(bez(V.p, i / N));
for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
const total = cum[N];
const count = Math.round(total / V.gap);
const step = total / count;
const dots = [];
for (let k = 1; k < count; k++) {
  const target = k * step;
  let lo = 0, hi = N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid; else hi = mid; }
  const f = (target - cum[lo]) / (cum[hi] - cum[lo] || 1);
  dots.push([pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f]);
}
let apex = dots[0];
for (const d of dots) if (d[1] < apex[1]) apex = d;

const f1 = (n) => (Math.round(n * 10) / 10).toString();
const [bx, by] = V.ball, [cx, cy] = V.cup;
const s = V.w / 1600; // ring/label scale relative to the wide design
const lines = [];
lines.push(`<svg viewBox="0 0 ${V.w} ${V.h}" aria-hidden="true" focusable="false">`);
// reference line over the apex — the surveyor's datum
lines.push(`  <line class="refline" x1="${f1(apex[0] - 240 * s)}" y1="${f1(apex[1] - 28 * s)}" x2="${f1(apex[0] + 240 * s)}" y2="${f1(apex[1] - 28 * s)}"/>`);
// cup: two dotted survey rings, the lip, the hole
lines.push(`  <circle class="ring" cx="${cx}" cy="${cy}" r="${f1(78 * s)}"/>`);
lines.push(`  <circle class="ring" cx="${cx}" cy="${cy}" r="${f1(48 * s)}"/>`);
lines.push(`  <circle class="cup-lip" cx="${cx}" cy="${cy}" r="${f1(22 * s)}" style="stroke-width:${f1(3 * s)}"/>`);
lines.push(`  <circle class="cup-hole" cx="${cx}" cy="${cy}" r="${f1(13 * s)}"/>`);
// the shot
lines.push(`  <g class="trail">`);
dots.forEach(([x, y], i) => lines.push(`    <circle class="dot" style="--i:${i}" cx="${f1(x)}" cy="${f1(y)}" r="${V.r}"/>`));
lines.push(`  </g>`);
// ball
lines.push(`  <circle class="ball-halo" cx="${bx}" cy="${by}" r="${f1(27 * s)}"/>`);
lines.push(`  <circle class="ball" cx="${bx}" cy="${by}" r="${f1(16 * s)}"/>`);
// annotations — certify, never explain
const fs = `style="font-size:${V.font}px"`;
if (V.annos !== false) {
  lines.push(`  <text class="svg-anno" ${fs} x="${bx}" y="${f1(by + 56 * s)}" text-anchor="middle">v = 16.7</text>`);
  lines.push(`  <text class="svg-anno svg-anno--brass" ${fs} x="${f1(apex[0] + 70 * s)}" y="${f1(apex[1] + 34 * s)}">△ 119.5°</text>`);
}
if (V.miss) lines.push(`  <text class="svg-anno" ${fs} x="${f1(dots[dots.length - 1][0] - 10)}" y="${f1(dots[dots.length - 1][1] + 50 * s)}" text-anchor="end">lie = rough</text>`);
lines.push(`</svg>`);
process.stdout.write(lines.join('\n') + '\n');
console.error(`${variant}: ${dots.length} dots, arc ${total.toFixed(0)}, apex (${f1(apex[0])}, ${f1(apex[1])})`);

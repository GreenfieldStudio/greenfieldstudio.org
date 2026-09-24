#!/usr/bin/env node
/**
 * audit.mjs — the site's release check. Drives real Chromium (Playwright) over every page at
 * a desktop and a phone viewport and fails on anything a visitor would hit.
 *
 *   node tools/audit.mjs                          # spawns tools/serve.mjs on a spare port
 *   node tools/audit.mjs --url https://greenfieldstudio.org/     # audit the live site
 *   node tools/audit.mjs --shots                  # also save full-page screenshots to .audit/
 *   node tools/audit.mjs --game                   # also boot /play/?debug=1 and fire one real shot
 *   node tools/audit.mjs --base greenfieldstudio.org   # serve under /greenfieldstudio.org/, like the github.io URL
 *
 * Checks: HTTP status · console + page errors · third-party requests · bytes transferred
 * (at `load`, i.e. before anyone presses Play) · horizontal overflow at 360 px · images
 * without alt · heading order · every internal link/asset resolves · contrast of the
 * palette's text pairs (WCAG AA).
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/playwright.mjs';
import { CLOUDFLARE_BEACON_TOKEN, BEACON_SRC, BEACON_HOSTS } from './analytics.mjs';
import { strictOptions } from './lib/args.mjs';

strictOptions(['url', 'shots', 'game', 'base']);

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);
const SHOTS = flag('shots');
const GAME = flag('game');
const OUT = join(SITE, '.audit');

const PAGES = [
  { path: '', name: 'home' },
  { path: 'minigolf-pro/', name: 'game' },
  { path: 'press/', name: 'press' },
  { path: 'privacy/', name: 'privacy' },
  { path: 'journal/', name: 'journal' },
  { path: 'journal/level-critic/', name: 'post-level-critic' },
  { path: 'this-page-does-not-exist/', name: '404', status: 404 },
];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 360, height: 780, isMobile: true, hasTouch: true },
];
const BUDGET_KB = 300; // transferred at `load`, before Play

let server = null;
let BASE = arg('url', null);
if (!BASE) {
  const port = 5600 + Math.floor(Math.random() * 300);
  // --base /repo/ serves the site under a subpath, exactly like a github.io project URL
  const sub = ('/' + arg('base', '/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
  server = spawn(process.execPath, [join(SITE, 'tools', 'serve.mjs'), '--port', String(port), '--base', sub], { stdio: 'ignore' });
  BASE = `http://localhost:${port}${sub}`;
  await new Promise((r) => setTimeout(r, 600));
}
if (!BASE.endsWith('/')) BASE += '/';
const origin = new URL(BASE).origin;
/* The visitor counter exists only in the DEPLOYED copy (tools/deploy.mjs adds it). So: on the
   live site with a token set, every page must carry it and its two hosts are the only allowed
   third parties; locally, no page may carry it. */
const LIVE = !/^(localhost|127\.0\.0\.1)$/.test(new URL(BASE).hostname);
const COUNTER = LIVE && !!CLOUDFLARE_BEACON_TOKEN;
// 404.html uses root-absolute paths (Pages serves it at any depth), so it is only meaningful
// at a domain root — not on a github.io/<repo>/ staging URL.
if (new URL(BASE).pathname !== '/') {
  const i = PAGES.findIndex((p) => p.status === 404);
  if (i > -1) { PAGES.splice(i, 1); console.log('note: not at a domain root — skipping the 404 page check'); }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const rows = [];
const checked = new Map(); // url -> status

async function statusOf(page, url) {
  if (checked.has(url)) return checked.get(url);
  let st = 0;
  try {
    const r = await page.request.get(url, { maxRedirects: 3 });
    st = r.status();
  } catch (_) { st = -1; }
  checked.set(url, st);
  return st;
}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch,
    reducedMotion: 'reduce', // rest state: what a screenshot should show
  });
  for (const pg of PAGES) {
    const where = `${pg.name}@${vp.name}`;
    const page = await ctx.newPage();
    const errors = [];
    const thirdParty = new Set();
    let bytes = 0;
    let loaded = false;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // the 404 page's own (intended) status is logged by Chrome as a failed resource
      const at = (m.location() && m.location().url) || '';
      if (pg.status === 404 && /status of 404/.test(m.text()) && at.split('#')[0] === BASE + pg.path) return;
      errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', async (res) => {
      const u = new URL(res.url());
      if (u.origin !== origin && !u.protocol.startsWith('data') && !(COUNTER && BEACON_HOSTS.includes(u.hostname))) thirdParty.add(u.host);
      if (loaded) return;
      const len = Number(res.headers()['content-length'] || 0);
      bytes += len || (await res.body().catch(() => Buffer.alloc(0))).length;
    });
    const resp = await page.goto(BASE + pg.path, { waitUntil: 'load' });
    loaded = true;
    const want = pg.status || 200;
    if (!resp || resp.status() !== want) fail(where, `HTTP ${resp && resp.status()} (want ${want})`);

    const dom = await page.evaluate((beaconSrc) => {
      const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
      let skip = null;
      for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) { skip = `h${hs[i - 1]}→h${hs[i]}`; break; }
      const urls = new Set();
      const add = (v) => { if (v && !v.startsWith('mailto:') && !v.startsWith('#') && !v.startsWith('javascript:')) urls.add(new URL(v, location.href).href.split('#')[0]); };
      document.querySelectorAll('a[href]').forEach((a) => add(a.getAttribute('href')));
      document.querySelectorAll('img[src], source[src], script[src]').forEach((e) => add(e.getAttribute('src')));
      document.querySelectorAll('source[data-src]').forEach((e) => add(e.getAttribute('data-src')));
      document.querySelectorAll('video[poster]').forEach((e) => add(e.getAttribute('poster')));
      document.querySelectorAll('link[href]').forEach((e) => { if (e.rel !== 'canonical') add(e.getAttribute('href')); });
      document.querySelectorAll('img[srcset], source[srcset]').forEach((e) => e.getAttribute('srcset').split(',').forEach((s) => add(s.trim().split(/\s+/)[0])));
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        noAlt: [...document.querySelectorAll('img:not([alt])')].map((i) => i.getAttribute('src')),
        h1: hs.filter((n) => n === 1).length,
        skip,
        urls: [...urls],
        title: document.title,
        desc: document.querySelector('meta[name="description"]')?.content || '',
        counter: !!document.querySelector(`script[src="${beaconSrc}"]`),
      };
    }, BEACON_SRC);
    if (dom.overflow > 0) fail(where, `horizontal overflow ${dom.overflow}px`);
    if (dom.noAlt.length) fail(where, `img without alt: ${dom.noAlt.join(', ')}`);
    if (dom.h1 !== 1) fail(where, `${dom.h1} <h1> elements`);
    if (dom.skip) fail(where, `heading level skipped ${dom.skip}`);
    if (!dom.desc && pg.name !== '404') fail(where, 'no meta description');
    if (COUNTER && !dom.counter) fail(where, 'visitor counter missing (deploy adds it when a token is set)');
    if (!LIVE && dom.counter) fail(where, 'visitor counter in the source page; only tools/deploy.mjs may add it');

    if (vp.name === 'desktop') {
      for (const u of dom.urls) {
        if (new URL(u).origin !== origin) continue; // external links are not ours to fix
        const st = await statusOf(page, u);
        if (st < 200 || st >= 400) fail(where, `broken ${st}: ${u.replace(origin, '')}`);
      }
    }
    await page.waitForTimeout(250);
    for (const e of errors) fail(where, `console: ${e.slice(0, 160)}`);
    if (thirdParty.size) fail(where, `third-party requests: ${[...thirdParty].join(', ')}`);
    if (pg.name !== '404' && bytes / 1024 > BUDGET_KB) fail(where, `${(bytes / 1024).toFixed(0)} KB at load > ${BUDGET_KB} KB budget`);
    rows.push({ page: pg.name, viewport: vp.name, kb: (bytes / 1024).toFixed(0), links: vp.name === 'desktop' ? dom.urls.length : '', errors: errors.length });

    if (SHOTS) {
      mkdirSync(OUT, { recursive: true });
      // walk the page first: loading="lazy" images only load once scrolled near
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.7)) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: join(OUT, `${pg.name}-${vp.name}.png`), fullPage: true });
    }
    await page.close();
  }
  await ctx.close();
}

// ── contrast of the palette's text pairs, read from the live CSS ─────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  const pairs = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const hex = (h) => { const m = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255); };
    const lum = (rgb) => { const l = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
    const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    // the lit centre is the LIGHTEST ground any text sits on, so it is the worst case
    const grounds = ['--field-lit', '--field', '--field-deep'];
    const out = [];
    for (const fg of ['--cream', '--cream-2', '--cream-3', '--brass']) for (const bg of grounds) out.push([fg, bg, ratio(v(fg), v(bg))]);
    out.push(['--ink', '--brass', ratio(v('--ink'), v('--brass'))]);
    return out;
  });
  for (const [fg, bg, r] of pairs) if (r < 4.5) fail('contrast', `${fg} on ${bg} = ${r.toFixed(2)}:1 (< 4.5)`);
  const worst = pairs.reduce((a, b) => (b[2] < a[2] ? b : a));
  rows.push({ page: 'contrast', viewport: 'worst pair', kb: `${worst[0]} on ${worst[1]} ${worst[2].toFixed(2)}:1`, links: '', errors: '' });

  // the game's entry page is counted too (one count = one load of the game); read, not booted
  const playHtml = await (await page.request.get(BASE + 'play/')).text();
  const playCounted = playHtml.includes(BEACON_SRC);
  if (COUNTER && !playCounted) fail('play', 'visitor counter missing on play/');
  if (!LIVE && playCounted) fail('play', 'visitor counter in the local play/ build; only tools/deploy.mjs may add it');
  rows.push({ page: 'visitor counter', viewport: LIVE ? 'live' : 'local', kb: COUNTER ? 'on' : 'off', links: '', errors: `play/ counted: ${playCounted}` });
  await ctx.close();
}

// ── the game itself, from this origin: boot, jump to hole 1, fire one real shot ──
if (GAME) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(BASE + 'play/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__mg && window.__mg.getState), null, { timeout: 60000 });
  const bootMs = Date.now() - t0;
  const result = await page.evaluate(async () => {
    const mg = window.__mg;
    if (typeof mg.jumpToHole === 'function') mg.jumpToHole(0);
    await new Promise((r) => setTimeout(r, 1500));
    const before = { strokes: mg.getState().strokes }; // getState() is the LIVE object — copy the number now
    if (typeof mg.fireShot !== 'function') return { error: 'no fireShot on __mg', keys: Object.keys(mg).slice(0, 40) };
    let power;
    // fireShot({dragPx, dirRad}) synthesizes a real slingshot drag on the canvas → resolves the shot's power
    try { power = await mg.fireShot({ dragPx: 90, dirRad: 0 }); } catch (e) { return { error: String(e) }; }
    await new Promise((r) => setTimeout(r, 2500));
    const after = mg.getState();
    return { hole: after.currentHole, power: Math.round(power), strokesBefore: before.strokes, strokesAfter: after.strokes, gameState: after.gameState, fbUser: !!after.fbUser };
  });
  if (result.error) fail('game', result.error + (result.keys ? ` (keys: ${result.keys.join(',')})` : ''));
  else if (!(result.strokesAfter > result.strokesBefore)) fail('game', `shot did not register: ${JSON.stringify(result)}`);
  for (const e of errors) fail('game', `pageerror: ${e.slice(0, 160)}`);
  rows.push({ page: 'play/', viewport: 'debug boot', kb: `boot ${bootMs} ms`, links: '', errors: JSON.stringify(result) });
  await ctx.close();

  // ?play=1 must land a NEWCOMER in hole 1, not on the menu (the game's R4669 fast path).
  {
    const c = await browser.newContext({ viewport: { width: 1280, height: 720 } }); // fresh profile
    const p = await c.newPage();
    await p.goto(BASE + 'play/?play=1&debug=1', { waitUntil: 'load' });
    await p.waitForFunction(() => window.__mg && window.__mg.getState && window.__mg.getState().loaded, null, { timeout: 60000 });
    const landed = await p.waitForFunction(() => window.__mg.getState().gameState === 'playing', null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    const st = await p.evaluate(() => { const s = window.__mg.getState(); return { gameState: s.gameState, hole: s.currentHole, welcome: !!s.showWelcome }; });
    if (!landed || st.hole !== 0) fail('play', `?play=1 did not land in hole 1: ${JSON.stringify(st)}`);
    rows.push({ page: 'play/?play=1', viewport: 'newcomer', kb: '', links: '', errors: JSON.stringify(st) });
    await c.close();
  }

  // The inline stage (desktop): hero Play → game boots inside the stage → Close restores the page.
  {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE, { waitUntil: 'load' });
    const t = Date.now();
    await p.click('[data-play-jump]');
    const el = await p.waitForSelector('[data-stage] iframe', { timeout: 5000 });
    const fr = await el.contentFrame();
    await fr.waitForSelector('canvas', { timeout: 60000 });
    const canvasMs = Date.now() - t;
    const ui = await p.evaluate(() => ({
      playing: document.querySelector('[data-stage]').classList.contains('is-playing'),
      controls: getComputedStyle(document.querySelector('.stage-controls')).display,
      inView: (() => { const r = document.querySelector('[data-stage]').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })(),
    }));
    if (!ui.playing || ui.controls === 'none') fail('stage', `inline play UI not shown: ${JSON.stringify(ui)}`);
    if (!ui.inView) fail('stage', 'stage was not scrolled into view');
    await p.click('[data-close]');
    const closed = await p.evaluate(() => !document.querySelector('[data-stage] iframe') && !document.querySelector('[data-stage]').classList.contains('is-playing'));
    if (!closed) fail('stage', 'Close did not remove the game');
    for (const e of errs) fail('stage', `pageerror: ${e.slice(0, 160)}`);
    rows.push({ page: 'home stage', viewport: 'desktop click', kb: `canvas ${canvasMs} ms`, links: '', errors: JSON.stringify({ ...ui, closed }) });
    await c.close();
  }
  // Phones: Play is a plain navigation to the full-page game.
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    // Play opens /play/?play=1: the game's own fast path (R4669) then lands straight in a hole.
    const PLAY_RE = /\/play\/(\?play=1)?$/;
    await Promise.all([p.waitForURL(PLAY_RE, { timeout: 10000 }).catch(() => {}), p.tap('[data-play-jump]')]);
    const url = p.url();
    if (!PLAY_RE.test(url)) fail('stage', `phone Play did not open the full page (at ${url})`);
    const iframes = await p.evaluate(() => document.querySelectorAll('iframe').length);
    rows.push({ page: 'home stage', viewport: 'phone tap', kb: url.replace(origin, ''), links: '', errors: `iframes on page: ${iframes}` });
    await c.close();
  }
}

await browser.close();
if (server) server.kill();

console.log(`\naudit of ${BASE}`);
console.table(rows);
if (SHOTS) console.log(`screenshots → ${OUT}`);
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\n✓ no problems');

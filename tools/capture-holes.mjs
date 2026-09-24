#!/usr/bin/env node
/**
 * capture-holes.mjs — clean, hole-tight screenshots of campaign holes, for journal posts.
 *
 *   node tools/capture-holes.mjs 14:switch-room 36:asteroid-field
 *   node tools/capture-holes.mjs --dist D:/src/minigolf-pro/dist 5:the-bounce
 *   node tools/capture-holes.mjs --out assets/media/worlds --no-og 5:meadow   (no share card)
 *
 * Serves a Minigolf Pro web build (default: ../minigolf-pro/dist, or play/ if that is
 * missing), drives it through the ?debug=1 `window.__mg` API, and writes
 * assets/media/journal/<name>-{640,1200}.webp plus <name>-og.jpg (the share card).
 * Index = 0-based campaign hole index.
 *
 * The clip and the toast/HUD suppression are the ones minigolf-pro's
 * branding/build-screenshots.mjs settled on (R3949): clip to the HOLE, not the canvas
 * (undersized holes are drawn centred, camera holes are zoomed), and clear the real
 * hint fields plus `_cleanCapture` so no toast or sliced HUD lands in the image.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { loadPlaywright } from './lib/playwright.mjs';
import { strictOptions } from './lib/args.mjs';

strictOptions(['dist', 'out', 'no-og']);
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args.splice(i, 2)[1] : null; };
const NO_OG = args.includes('--no-og');
if (NO_OG) args.splice(args.indexOf('--no-og'), 1);
const distArg = take('dist');
let DIST = distArg ? resolve(distArg) : resolve(SITE, '..', 'minigolf-pro', 'dist');
if (!existsSync(join(DIST, 'index.html'))) DIST = join(SITE, 'play');
const OUT = resolve(SITE, take('out') || join('assets', 'media', 'journal'));
const shots = args.map((a) => { const [i, name] = a.split(':'); return { idx: Number(i), name }; })
  .filter((s) => Number.isInteger(s.idx) && s.name);
if (!shots.length) { console.error('usage: node tools/capture-holes.mjs <idx>:<name> [...] [--dist <dir>] [--out <dir>] [--no-og]'); process.exit(1); }

mkdirSync(OUT, { recursive: true });

function holeClip(cb) {
  if (!cb || !cb.visible || !cb.canvasRect || cb.canvasRect.w <= 0) return null;
  const { canvasRect: r, logicalSize: L, scale: s, hole, camera } = cb;
  if (!hole || !L || !s || !s.x) return null;
  const cam = camera && camera.needsCam;
  const zoom = cam ? (camera.zoom || 1) : 1;
  const hw = hole.w * zoom, hh = hole.h * zoom;
  const ox = cam ? -(camera.x || 0) : Math.floor(Math.max(0, L.w - hw) / 2);
  const oy = cam ? -(camera.y || 0) : Math.floor(Math.max(0, L.h - hh) / 2);
  const x0 = Math.max(0, Math.min(L.w, ox)), y0 = Math.max(0, Math.min(L.h, oy));
  const x1 = Math.max(0, Math.min(L.w, ox + hw)), y1 = Math.max(0, Math.min(L.h, oy + hh));
  const w = (x1 - x0) * s.x, h = (y1 - y0) * s.y;
  if (w < 40 || h < 40) return null;
  return { x: r.x + x0 * s.x, y: r.y + y0 * s.y, width: w, height: h };
}

const port = 5930 + Math.floor(Math.random() * 60);
const srv = spawn(process.execPath, [join(SITE, 'tools', 'serve.mjs'), '--port', String(port), '--root', DIST], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 680 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/?debug=1&nopause=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mg && typeof window.__mg.jumpToHole === 'function', null, { timeout: 60000 });
  await page.evaluate(() => {
    try { window.__mg.suppressHints(true); window.__mg.forceUnlockAll(); } catch (e) {}
    const s = window.__mg.getState(); if (!s) return;
    if (s.worldsUnlocked) for (let i = 0; i < s.worldsUnlocked.length; i++) s.worldsUnlocked[i] = true;
    s._suppressHints = true; s._stuckOfferSuppressed = true; s.showWelcome = false;
  });
  for (const sh of shots) {
    await page.evaluate((idx) => window.__mg.jumpToHole(idx), sh.idx);
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const s = window.__mg.getState(); if (!s) return;
      s._mechanicHint = null; s._mechanicHintTimer = 0; s._mechanicHintQueue = []; s._mechanicHintQueueNext = null; s._mechanicHintQueueDelay = 0;
      s._tipCardActive = null; s.previewTimer = 0; s._mCardFiredThisHole = true; s._suppressHints = true;
      s.achToast = null; s.achToastTimer = 0; s.skinToast = null; s.skinToastTimer = 0;
      s.hintMsg = ''; s.hintMsgTimer = 0; s.parMsg = null; s.parMsgTimer = 0; s.waterMsgTimer = 0; s.lavaMsgTimer = 0;
      s._cleanCapture = true;
    });
    await page.waitForTimeout(600);
    const cb = await page.evaluate(() => { try { return window.__mg.captureCanvasBounds(); } catch { return null; } });
    const clip = holeClip(cb);
    const png = join(tmpdir(), `gs-hole-${process.pid}-${sh.idx}.png`);
    if (clip) await page.screenshot({ path: png, clip });
    else await page.locator('canvas').first().screenshot({ path: png });
    for (const w of [640, 1200]) {
      const out = join(OUT, `${sh.name}-${w}.webp`);
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale='min(${w},iw)':-2:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '84', out]);
      if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}`);
    }
    // A JPEG twin for og:image: link-preview scrapers (LinkedIn's among them) don't reliably take WebP.
    if (!NO_OG) {
      const og = join(OUT, `${sh.name}-og.jpg`);
      const rj = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale='min(1200,iw)':-2:flags=lanczos,format=yuvj420p`, '-frames:v', '1', '-q:v', '3', og]);
      if (rj.status !== 0) throw new Error(`ffmpeg failed for ${og}`);
    }
    rmSync(png, { force: true });
    console.log(`hole ${sh.idx} → ${OUT.replace(SITE, '').replace(/\\/g, '/')}/${sh.name}-{640,1200}.webp${NO_OG ? '' : ' + -og.jpg'}  (${clip ? `hole ${cb.hole.w}x${cb.hole.h}` : 'full canvas'})`);
  }
} finally {
  await browser.close();
  srv.kill();
}

#!/usr/bin/env node
/**
 * make-banner.mjs — the Greenfield Studio YouTube banner (2560×1440), in the site's own look.
 *
 *   node tools/make-banner.mjs --worlds <dir with meadow-1200.webp … arctic-1200.webp>
 *
 * The page is rendered by the browser from the site's real stylesheet and fonts, and the dotted
 * shot is lifted from index.html, so the banner cannot drift from the site. Everything that must
 * be read sits inside YouTube's always-visible strip (1546×423, centred); the world slices at the
 * edges are decoration that TVs and desktops show and phones crop away.
 * Writes .audit/banner/: youtube-banner-2560x1440.jpg plus safe-area.png (what a phone shows).
 * World images: `node tools/capture-holes.mjs --out <dir> --no-og 5:meadow 15:tropical 25:mountain
 * 29:ruins 36:space 50:neon 61:candy 66:arctic`.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright } from './lib/playwright.mjs';
import { strictOptions } from './lib/args.mjs';

strictOptions(['worlds']);
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--worlds');
const WORLDS = i > -1 ? resolve(process.argv[i + 1]) : null;
const LEFT = ['meadow', 'tropical', 'mountain', 'ruins'];
const RIGHT = ['space', 'neon', 'candy', 'arctic'];
if (!WORLDS || ![...LEFT, ...RIGHT].every((w) => existsSync(join(WORLDS, `${w}-1200.webp`)))) {
  console.error('usage: node tools/make-banner.mjs --worlds <dir>  (needs <world>-1200.webp for all eight)');
  process.exit(2);
}
const OUT = join(SITE, '.audit', 'banner');
mkdirSync(OUT, { recursive: true });

const svg = (/<div class="survey--wide">(<svg[\s\S]*?<\/svg>)<\/div>/.exec(readFileSync(join(SITE, 'index.html'), 'utf8')) || [])[1];
if (!svg) throw new Error('index.html: the survey artwork was not found');
const img = (w) => pathToFileURL(join(WORLDS, `${w}-1200.webp`)).href;
const slices = (names) => names.map((w) => `<i style="background-image:url('${img(w)}')"></i>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(join(SITE, 'assets', 'css', 'site.css')).href}">
<style>
  html, body { margin: 0; width: 2560px; height: 1440px; overflow: hidden; }
  body { background: var(--field-deep); }
  /* the field, lit from the middle of the banner rather than the top of a page */
  body::before { background: radial-gradient(52% 58% at 50% 50%, var(--field-lit) 0%, var(--field) 42%, var(--field-deep) 74%, var(--field-edge) 100%); }
  body::after { background: repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0 128px, rgba(0,0,0,0.026) 128px 256px); }
  .band { position: absolute; top: 470px; height: 500px; display: flex;
    -webkit-mask-image: linear-gradient(180deg, transparent, #000 60px, #000 440px, transparent); }
  .band i { flex: none; width: 262px; height: 500px; margin-right: -76px; background-size: auto 100%; background-position: 50% 50%;
    clip-path: polygon(90px 0, 262px 0, 172px 100%, 0 100%); filter: saturate(0.9) brightness(0.86); }
  .band--l { left: -250px; -webkit-mask-image: linear-gradient(90deg, #000 62%, transparent 100%), linear-gradient(180deg, transparent, #000 60px, #000 440px, transparent); -webkit-mask-composite: source-in; }
  .band--r { left: 2010px; -webkit-mask-image: linear-gradient(270deg, #000 70%, transparent 100%), linear-gradient(180deg, transparent, #000 60px, #000 440px, transparent); -webkit-mask-composite: source-in; }
  .shot { position: absolute; left: 480px; top: 296px; width: 1600px; }
  .shot svg { width: 100%; height: auto; overflow: visible; }
  .title { position: absolute; left: 0; right: 0; top: 606px; text-align: center; }
  .title .wordmark { font-size: 88px; }
  .title .wordmark-sub { font-size: 30px; }
  .title .wordmark-rule { width: 360px; }
  .tag { position: absolute; left: 0; right: 0; top: 798px; text-align: center; font-family: var(--font-mono); font-size: 25px; letter-spacing: 0.08em; color: var(--cream-2); }
  .cta { position: absolute; left: 50%; top: 848px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 16px;
    padding: 14px 32px; background: var(--brass); color: var(--ink); font-family: var(--font-sans); font-weight: 500; font-size: 29px; letter-spacing: 0.04em; white-space: nowrap; border-radius: 2px; }
  .cta svg { width: 22px; height: 22px; }
</style></head><body>
  <div class="band band--l">${slices(LEFT)}</div>
  <div class="band band--r">${slices(RIGHT)}</div>
  <div class="shot">${svg}</div>
  <div class="title"><span class="wordmark">Greenfield</span><span class="wordmark-rule"></span><span class="wordmark-sub">Studio</span></div>
  <div class="tag">indie games · calm 3D worlds · greenfieldstudio.org</div>
  <div class="cta"><svg viewBox="0 0 16 16"><path d="M4.5 2.6v10.8l8.8-5.4z" fill="currentColor"/></svg>Play Minigolf Pro, free in your browser</div>
</body></html>`;
const page = join(OUT, 'banner.html');
writeFileSync(page, html);

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  const p = await (await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  await p.goto(pathToFileURL(page).href, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const png = join(OUT, 'banner.png');
  await p.screenshot({ path: png });
  const jpg = join(OUT, 'youtube-banner-2560x1440.jpg');
  if (spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-q:v', '2', jpg]).status) throw new Error('ffmpeg jpg');
  // what every device shows: the 1546×423 centre strip
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'crop=1546:423:507:508', join(OUT, 'safe-area.png')]);
  console.log(`banner → ${jpg}`);
} finally { await browser.close(); }

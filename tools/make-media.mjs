#!/usr/bin/env node
/**
 * make-media.mjs — derive every web asset under assets/media/ (and the press-kit
 * originals under press/files/) from the Minigolf Pro repo's branding/ folder.
 *
 * Why a script and not hand-exports: the sources keep changing (new trailer, new
 * screenshots), and a web derivative that nobody can regenerate slowly drifts from
 * the game. Every output is a pure function of a named source + the ffmpeg args here.
 *
 *   node tools/make-media.mjs                 # incremental: skips outputs newer than their source
 *   node tools/make-media.mjs --force         # rebuild everything
 *   MINIGOLF_REPO=D:/src/minigolf-pro node tools/make-media.mjs
 *
 * Needs ffmpeg on PATH (libx264, libvpx-vp9, libwebp). The source repo defaults to
 * the sibling checkout ../minigolf-pro. The media-kit video is gitignored in that repo,
 * so it only exists in a checkout where it was rendered (branding/mediakit/README.md).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, copyFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(process.env.MINIGOLF_REPO || join(SITE, '..', 'minigolf-pro'));
const B = (p) => join(REPO, 'branding', p);
const OUT = (p) => join(SITE, 'assets', 'media', p);
const PRESS = (p) => join(SITE, 'press', 'files', p);
const FORCE = process.argv.includes('--force');

if (!existsSync(join(REPO, 'branding'))) {
  console.error(`No branding/ folder under ${REPO}. Set MINIGOLF_REPO to your minigolf-pro checkout.`);
  process.exit(1);
}
mkdirSync(OUT(''), { recursive: true });
mkdirSync(PRESS(''), { recursive: true });

let built = 0, skipped = 0, missing = 0;

function stale(src, out) {
  if (FORCE || !existsSync(out)) return true;
  return statSync(src).mtimeMs > statSync(out).mtimeMs;
}

function ff(src, out, args, { inputArgs = [] } = {}) {
  if (!existsSync(src)) { console.warn(`  ! missing source ${src}`); missing++; return; }
  if (!stale(src, out)) { skipped++; return; }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputArgs, '-i', src, ...args, out], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`ffmpeg failed for ${out}`); process.exit(1); }
  built++;
  console.log(`  + ${out.slice(SITE.length + 1)}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

function copy(src, out) {
  if (!existsSync(src)) { console.warn(`  ! missing source ${src}`); missing++; return; }
  if (!stale(src, out)) { skipped++; return; }
  copyFileSync(src, out);
  built++;
  console.log(`  + ${out.slice(SITE.length + 1)}  ${(statSync(out).size / 1024).toFixed(0)} KB (copy)`);
}

// ── shared encoder settings ─────────────────────────────────────────────────────
// H.264 is the universal fallback; VP9 is listed first in <video> so browsers that
// can play it take the smaller file. No audio track: every loop is muted by design.
const H264 = (crf) => ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-movflags', '+faststart'];
const VP9 = (crf) => ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1',
  '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p'];
const WEBP = (q) => ['-frames:v', '1', '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6'];
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

// ── 1. hero loop: the media-kit gameplay reel, cropped to the game's 2:1 stage ───
console.log('hero loop');
{
  const src = B('mediakit/poki-landscape-1920x1080.mp4');
  // 4.9s onward: opens on the Tropical approach to cup 11 (the poster), then Candy,
  // Meadow and Tropical sinks. Center crop 1920x960 = the game canvas's 2:1.
  const vf = 'crop=1920:960:0:60,scale=960:480:flags=lanczos,fps=30';
  ff(src, OUT('hero-loop.webm'), ['-vf', vf, ...VP9(38)], { inputArgs: ['-ss', '4.9'] });
  ff(src, OUT('hero-loop.mp4'), ['-vf', vf, ...H264(27)], { inputArgs: ['-ss', '4.9'] });
  ff(src, OUT('hero-poster.webp'), ['-vf', 'crop=1920:960:0:60,scale=1280:640:flags=lanczos', ...WEBP(78)], { inputArgs: ['-ss', '4.9'] });
}

// ── 2. gameplay clips (the itch GIFs → video; ~10x smaller, full colour) ─────────
console.log('clips');
const CLIPS = {
  'clip-windmill': 'gifs/windmill-spinner.gif',
  'clip-wormhole': 'gifs/wormhole-ace.gif',
  'clip-sugar-rush': 'gifs/sugar-rush-ace.gif',
  'clip-lava-shore': 'gifs/lava-shore-ace.gif',
  'clip-neon-strip': 'gifs/neon-strip-ace.gif',
  'clip-ball-faces': 'gifs/ball-faces.gif',
  'clip-shop-trails': 'gifs/shop-trails.gif',
};
for (const [name, rel] of Object.entries(CLIPS)) {
  const src = B(rel);
  const vf = `fps=30,${EVEN}`;
  ff(src, OUT(`${name}.webm`), ['-vf', vf, ...VP9(36)]);
  ff(src, OUT(`${name}.mp4`), ['-vf', vf, ...H264(26)]);
  ff(src, OUT(`${name}.webp`), ['-vf', EVEN, ...WEBP(80)]);
}

// ── 3. trailer: 720p30 for the page (the 1080p60 original goes in the press kit) ─
console.log('trailer');
{
  const src = B('trailer-youtube-1080p.mp4');
  ff(src, OUT('trailer-720.mp4'), ['-vf', 'scale=1280:720:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'slow',
    '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k']);
  ff(B('trailer-thumbnail-1280x720.png'), OUT('trailer-poster.webp'), WEBP(80));
}

// ── 4. screenshots → WebP at two display widths ─────────────────────────────────
console.log('screenshots');
const SHOTS = {
  'shot-arctic': ['screenshots-new/gameplay-arctic-ice.png', 82],
  'shot-ruins': ['screenshots-new/gameplay-ruins-cannon.png', 82],
  'shot-tropical': ['screenshots-new/gameplay-tropical.png', 82],
  'shot-worlds': ['screenshots-new/eight-worlds.png', 82],
  'shot-editor': ['screenshots/level-editor-tablet.png', 88],   // UI text: keep it crisp
  'shot-multiplayer': ['screenshots/multiplayer-match.png', 86],
  'shot-modes': ['screenshots-new/game-modes.png', 88],
};
for (const [name, [rel, q]] of Object.entries(SHOTS)) {
  for (const w of [640, 1200]) {
    ff(B(rel), OUT(`${name}-${w}.webp`), ['-vf', `scale='min(${w},iw)':-2:flags=lanczos`, ...WEBP(q)]);
  }
}

// ── 5. logos, mascot, key art (alpha preserved where the source has it) ─────────
console.log('art');
const ALPHA = ['-pix_fmt', 'yuva420p'];
for (const w of [480, 960]) {
  ff(B('poki-logo-lockup-2048.png'), OUT(`minigolf-pro-lockup-${w}.webp`), ['-vf', `scale=${w}:-2:flags=lanczos`, ...ALPHA, ...WEBP(86)]);
}
ff(B('poki-logo-icon-2048.png'), OUT('minigolf-pro-icon-256.webp'), ['-vf', 'scale=256:-2:flags=lanczos', ...ALPHA, ...WEBP(86)]);
ff(B('poki-character-hero-2048.png'), OUT('ball-hero-400.webp'), ['-vf', 'scale=400:-2:flags=lanczos', ...ALPHA, ...WEBP(86)]);
ff(B('poki-character-victory-2048.png'), OUT('ball-victory-400.webp'), ['-vf', 'scale=400:-2:flags=lanczos', ...ALPHA, ...WEBP(86)]);
for (const w of [960, 1600]) {
  ff(B('cg-cover-1920x1080.png'), OUT(`keyart-${w}.webp`), ['-vf', `scale=${w}:-2:flags=lanczos`, ...WEBP(80)]);
}

// ── 6. social cards + touch icon ────────────────────────────────────────────────
console.log('social');
// Studio card: the Surveyed Green banner, 16:9 → 1.91:1 center crop.
ff(B('studio/youtube-banner-greenfield.png'), join(SITE, 'assets', 'img', 'og-studio.jpg'),
  ['-vf', 'scale=1200:-2:flags=lanczos,crop=1200:630', '-frames:v', '1', '-q:v', '3']);
copy(join(REPO, 'public', 'og-image.png'), join(SITE, 'assets', 'img', 'og-minigolf-pro.png'));
ff(B('youtube-avatar-greenfield.png'), join(SITE, 'apple-touch-icon.png'), ['-vf', 'scale=180:180:flags=lanczos', '-frames:v', '1']);

// ── 7. press-kit originals (full resolution, unmodified) ────────────────────────
console.log('press originals');
const PRESS_FILES = {
  'minigolf-pro-logo-lockup.png': 'poki-logo-lockup-2048.png',
  'minigolf-pro-logo-lockup-flat.png': 'poki-logo-lockup-flat-2048.png',
  'minigolf-pro-logo-icon.png': 'poki-logo-icon-2048.png',
  'minigolf-pro-logo-icon-flat.png': 'poki-logo-icon-flat-2048.png',
  'minigolf-pro-mascot.png': 'poki-character-hero-2048.png',
  'minigolf-pro-keyart-1920x1080.png': 'cg-cover-1920x1080.png',
  'minigolf-pro-screenshot-arctic.png': 'screenshots-new/gameplay-arctic-ice.png',
  'minigolf-pro-screenshot-ruins.png': 'screenshots-new/gameplay-ruins-cannon.png',
  'minigolf-pro-screenshot-tropical.png': 'screenshots-new/gameplay-tropical.png',
  'minigolf-pro-screenshot-eight-worlds.png': 'screenshots-new/eight-worlds.png',
  'minigolf-pro-screenshot-level-editor.png': 'screenshots/level-editor-tablet.png',
  'minigolf-pro-screenshot-multiplayer.png': 'screenshots/multiplayer-match.png',
  'greenfield-studio-avatar.png': 'youtube-avatar-greenfield.png',
  'greenfield-studio-banner.png': 'studio/youtube-banner-greenfield.png',
  'minigolf-pro-trailer-1080p.mp4': 'trailer-youtube-1080p.mp4',
};
for (const [out, rel] of Object.entries(PRESS_FILES)) copy(B(rel), PRESS(out));

// ── 8. the press-kit zip: everything except the trailer (linked on its own) ──────
console.log('press zip');
{
  const about = `MINIGOLF PRO — press kit
Greenfield Studio · https://greenfieldstudio.org/press/

SHORT
Free physics minigolf — 80 holes across 8 worlds, a full level editor, and online
multiplayer. Plays right in your browser.

FACTS
Developer   Greenfield Studio (independent, one person)
Platform    Web browser — desktop and mobile
Price       Free
Players     1–4 (online rooms of 2–4, local play, CPU opponents)
Languages   English, German, Chinese, Portuguese (Brazil), French, Spanish
Play        https://greenfieldstudio.org/play/
Also on     https://greenfieldstudio.itch.io/minigolf-pro
Trailer     https://greenfieldstudio.org/press/files/minigolf-pro-trailer-1080p.mp4
Contact     hello@greenfieldstudio.org

All assets in this archive are free to use in coverage, reviews, videos and streams
of Minigolf Pro.
`;
  const aboutPath = PRESS('ABOUT.txt');
  writeFileSync(aboutPath, about.replace(/\n/g, '\r\n')); // CRLF: it will mostly be opened in Notepad
  const zip = join(SITE, 'press', 'greenfield-studio-presskit.zip');
  const members = ['ABOUT.txt', ...Object.keys(PRESS_FILES).filter((f) => !f.endsWith('.mp4'))];
  const newest = Math.max(...members.filter((f) => f !== 'ABOUT.txt').map((f) => statSync(PRESS(f)).mtimeMs));
  if (FORCE || !existsSync(zip) || statSync(zip).mtimeMs < newest) {
    rmSync(zip, { force: true });
    // Windows 10+ ships bsdtar, which writes zip when the name ends in .zip; elsewhere use zip(1).
    const bsdtar = 'C:/Windows/System32/tar.exe';
    const r = existsSync(bsdtar)
      ? spawnSync(bsdtar, ['-a', '-c', '-f', zip, '-C', PRESS(''), ...members], { stdio: 'inherit' })
      : spawnSync('zip', ['-q', '-j', zip, ...members.map((m) => PRESS(m))], { stdio: 'inherit' });
    if (r.status !== 0 || !existsSync(zip)) { console.error('could not write the press zip (needs Windows tar.exe or zip)'); process.exit(1); }
    built++;
    console.log(`  + press/greenfield-studio-presskit.zip  ${(statSync(zip).size / 1048576).toFixed(1)} MB`);
  } else {
    skipped++;
  }
}

console.log(`\ndone — built ${built}, up to date ${skipped}, missing sources ${missing}`);
const total = readdirSync(OUT('')).reduce((n, f) => n + statSync(OUT(f)).size, 0);
console.log(`assets/media total: ${(total / 1024 / 1024).toFixed(2)} MB`);
if (missing) process.exit(2);

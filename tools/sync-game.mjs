#!/usr/bin/env node
/**
 * sync-game.mjs — copy a Minigolf Pro web build into play/.
 *
 *   # in the minigolf-pro checkout:   npm run build            (the default target = the itch build)
 *   node tools/sync-game.mjs                                    # takes ../minigolf-pro/dist
 *   node tools/sync-game.mjs --from D:/src/minigolf-pro/dist
 *
 * It builds nothing. It refuses anything that is not a default-target build (a Poki or
 * CrazyGames build would load a portal SDK on this domain), reads the commit the bundle
 * was built from out of the bundle itself (vite stamps `gitHead`), and writes that to
 * play/BUILD.txt — the answer to "which game is live on the site?" should never be a guess.
 *
 * The copy's social tags are re-pointed at greenfieldstudio.org, so a shared /play/ link
 * previews as this site rather than the itch page.
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { strictOptions } from './lib/args.mjs';

strictOptions(['from']);
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const FROM = resolve(arg('from', join(process.env.MINIGOLF_REPO || join(SITE, '..', 'minigolf-pro'), 'dist')));
const DEST = join(SITE, 'play');
const ORIGIN = 'https://greenfieldstudio.org';
const DESCRIPTION = 'Free physics minigolf — 80 holes across 8 worlds, a full level editor, and online multiplayer. Plays right in your browser.';

const die = (msg) => { console.error(`sync-game: ${msg}`); process.exit(1); };

if (!existsSync(join(FROM, 'index.html')) || !existsSync(join(FROM, 'assets'))) {
  die(`${FROM} is not a vite build (no index.html + assets/). Build the game first: npm run build`);
}

// ── what is this build? ─────────────────────────────────────────────────────────
const assets = readdirSync(join(FROM, 'assets')).filter((f) => f.endsWith('.js'));
let stamp = null;
let portal = null;
for (const f of assets) {
  const src = readFileSync(join(FROM, 'assets', f), 'utf8');
  stamp = stamp || (/gitHead:"([0-9a-f]{40})"/.exec(src) || [])[1] || null;
  if (/__pokiFirebaseStub/.test(src)) portal = 'poki';
}
const indexHtml = readFileSync(join(FROM, 'index.html'), 'utf8');
if (/poki-sdk|sdk\.poki|PokiSDK/i.test(indexHtml)) portal = portal || 'poki';
if (/crazygames/i.test(indexHtml) && /sdk/i.test(indexHtml)) portal = portal || 'crazygames';
if (portal) die(`${FROM} looks like a ${portal} build. The site needs the default target: npm run build (no --mode).`);
if (!stamp) console.warn('sync-game: warning — no gitHead stamp found in the bundle; provenance unknown.');

let head = null;
try { head = execFileSync('git', ['-C', dirname(FROM), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) {}
if (stamp && head && stamp !== head) {
  console.warn(`sync-game: note — bundle was built from ${stamp.slice(0, 9)}, but that checkout's HEAD is now ${head.slice(0, 9)}.`);
  console.warn('           The bundle stamp is what gets recorded. Rebuild if you meant to ship HEAD.');
}

// ── copy ────────────────────────────────────────────────────────────────────────
rmSync(DEST, { recursive: true, force: true });
cpSync(FROM, DEST, { recursive: true });

// ── re-point the social tags at this site ───────────────────────────────────────
const idx = join(DEST, 'index.html');
let html = readFileSync(idx, 'utf8');
const setMeta = (attr, key, value) => {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`);
  if (re.test(html)) html = html.replace(re, `$1${value}$2`);
};
setMeta('property', 'og:url', `${ORIGIN}/play/`);
setMeta('property', 'og:image', `${ORIGIN}/play/og-image.png`);
setMeta('name', 'twitter:image', `${ORIGIN}/play/og-image.png`);
setMeta('property', 'og:description', DESCRIPTION);
setMeta('name', 'twitter:description', DESCRIPTION);
setMeta('name', 'description', DESCRIPTION);
if (!/rel="canonical"/.test(html)) html = html.replace('</head>', `  <link rel="canonical" href="${ORIGIN}/play/" />\n  </head>`);
writeFileSync(idx, html);

// ── provenance ──────────────────────────────────────────────────────────────────
const built = statSync(join(FROM, 'index.html')).mtime.toISOString();
writeFileSync(join(DEST, 'BUILD.txt'),
  `Minigolf Pro — web build (default target)\ncommit  ${stamp || 'unknown'}\nbuilt   ${built}\nsynced  ${new Date().toISOString()}\n`);

let files = 0, bytes = 0;
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = join(d, e.name);
  if (e.isDirectory()) walk(p); else { files++; bytes += statSync(p).size; }
});
walk(DEST);
console.log(`sync-game: play/ ← ${FROM}\n  commit ${stamp ? stamp.slice(0, 9) : 'unknown'} · ${files} files · ${(bytes / 1048576).toFixed(1)} MB`);

#!/usr/bin/env node
/**
 * deploy.mjs — publish the site to GitHub Pages.
 *
 *   node tools/deploy.mjs            # dry run: assemble .deploy/ and report what would ship
 *   node tools/deploy.mjs --push     # publish: one orphan commit, force-pushed to origin/gh-pages
 *
 * `main` holds the SOURCE. The game build (play/) and the press downloads (press/files/,
 * the zip) are generated and never committed there. gh-pages receives exactly one commit
 * per deploy, so the public repo never accumulates a history of 35 MB game builds.
 * Pages must be set to "Deploy from a branch: gh-pages / (root)".
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUDFLARE_BEACON_TOKEN as TOKEN, BEACON_SRC, PRIVACY_MARKER, beaconTag, countsPage, tokenLooksValid } from './analytics.mjs';
import { strictOptions } from './lib/args.mjs';

strictOptions(['push', 'staging']);

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SITE, '.deploy');
const PUSH = process.argv.includes('--push');
/* --staging ships WITHOUT the CNAME file. Once Pages knows a custom domain, the github.io URL
   redirects to it — so while DNS still points elsewhere, a staging deploy is the only way to
   check the site on greenfieldstudio.github.io/<repo>/ first. */
const STAGING = process.argv.includes('--staging');
const EXCLUDE = new Set(['.git', '.deploy', '.audit', 'tools', 'node_modules', 'README.md', '.gitignore', 'package.json']);
const git = (args, cwd = SITE) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const die = (m) => { console.error(`deploy: ${m}`); process.exit(1); };

// ── preconditions ───────────────────────────────────────────────────────────────
for (const need of ['index.html', '404.html', 'CNAME', '.nojekyll', 'play/index.html', 'play/BUILD.txt', 'press/greenfield-studio-presskit.zip']) {
  if (!existsSync(join(SITE, need))) {
    die(`missing ${need}. ${need.startsWith('play/') ? 'Run: node tools/sync-game.mjs' : need.startsWith('press/') ? 'Run: node tools/make-media.mjs' : ''}`);
  }
}
const game = (/commit\s+([0-9a-f]{7,40}|unknown)/.exec(readFileSync(join(SITE, 'play', 'BUILD.txt'), 'utf8')) || [])[1] || 'unknown';
let src = 'uncommitted';
try { src = git(['rev-parse', '--short', 'HEAD']); } catch (_) {}
let dirty = '';
try { dirty = git(['status', '--porcelain']); } catch (_) {}

// ── assemble ────────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const entry of readdirSync(SITE)) {
  if (EXCLUDE.has(entry)) continue;
  cpSync(join(SITE, entry), join(OUT, entry), { recursive: true });
}
if (STAGING) {
  rmSync(join(OUT, 'CNAME'), { force: true });
  console.log('deploy: --staging → no CNAME; the site will live at the github.io URL only.');
}
const paths = (d, out = []) => {
  readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = join(d, e.name); if (e.isDirectory()) paths(p, out); else out.push(p); });
  return out;
};
const rel = (p) => relative(OUT, p).replace(/\\/g, '/');

// ── the visitor counter: added to the deployed copy only (see tools/analytics.mjs) ─────
const privacyNamesIt = readFileSync(join(OUT, 'privacy', 'index.html'), 'utf8').includes(PRIVACY_MARKER);
if (!!TOKEN !== privacyNamesIt) {
  die(TOKEN
    ? `the counter is switched on but privacy/index.html doesn't mention ${PRIVACY_MARKER}. Update the privacy page in the same change.`
    : `privacy/index.html mentions ${PRIVACY_MARKER} but the counter is off (no token in tools/analytics.mjs).`);
}
let counted = 0;
if (TOKEN) {
  if (!tokenLooksValid(TOKEN)) die('the token in tools/analytics.mjs looks malformed. Copy it from Cloudflare → Web Analytics → Manage site.');
  for (const p of paths(OUT)) {
    if (!countsPage(rel(p))) continue;
    const html = readFileSync(p, 'utf8');
    if (html.includes(BEACON_SRC)) die(`${rel(p)} already carries the beacon in its source; it would count every visit twice.`);
    const at = html.lastIndexOf('</body>');
    if (at < 0) die(`${rel(p)} has no </body>, so the counter can't be added and the page would go uncounted.`);
    writeFileSync(p, html.slice(0, at) + beaconTag(TOKEN) + '\n' + html.slice(at));
    counted++;
  }
}

const files = paths(OUT).map((p) => ({ path: rel(p), size: statSync(p).size }));
const total = files.reduce((n, f) => n + f.size, 0);
const big = files.filter((f) => f.size > 50 * 1024 * 1024);
if (files.some((f) => f.size >= 100 * 1024 * 1024)) die('a file is >= 100 MB; GitHub will reject the push.');

console.log(`deploy: assembled ${files.length} files, ${(total / 1048576).toFixed(1)} MB → .deploy/`);
console.log(`        site ${src}${dirty ? ' (+ uncommitted changes)' : ''} · game ${game.slice(0, 9)}`);
console.log(TOKEN ? `        visitor counter on ${counted} pages (Cloudflare Web Analytics)` : '        visitor counter off (no token in tools/analytics.mjs)');
for (const f of files.sort((a, b) => b.size - a.size).slice(0, 5)) console.log(`        ${(f.size / 1048576).toFixed(1).padStart(5)} MB  ${f.path}`);
if (big.length) console.warn(`deploy: warning — ${big.length} file(s) over 50 MB`);

if (!PUSH) {
  console.log('\ndry run. Publish with: node tools/deploy.mjs --push');
  process.exit(0);
}

// ── publish ─────────────────────────────────────────────────────────────────────
let remote;
try { remote = git(['remote', 'get-url', 'origin']); } catch (_) { die('no `origin` remote on the site repo. Add one: git remote add origin <url>'); }
if (dirty) console.warn('deploy: note — publishing with uncommitted changes in the source tree.');
git(['init', '-q', '-b', 'gh-pages'], OUT);
git(['add', '-A'], OUT);
git(['commit', '-q', '-m', `Deploy site ${src} · game ${game.slice(0, 9)}\n\nPublished by tools/deploy.mjs. Source: main@${src}. Game build: ${game}.`], OUT);
console.log(`deploy: pushing to ${remote} (gh-pages, forced)…`);
execFileSync('git', ['push', '--force', remote, 'gh-pages'], { cwd: OUT, stdio: 'inherit' });
rmSync(join(OUT, '.git'), { recursive: true, force: true });
console.log('deploy: done. GitHub Pages will publish in a minute or two.');

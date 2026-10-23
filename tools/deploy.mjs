#!/usr/bin/env node
/**
 * deploy.mjs — publish the site to GitHub Pages.
 *
 *   node tools/deploy.mjs            # dry run: assemble .deploy/ and report what would ship
 *   node tools/deploy.mjs --push     # publish: one normal commit on top of origin/gh-pages, fast-forward push
 *                                    # (nothing is committed when the site is unchanged; never --force)
 *   node tools/deploy.mjs --push --base <dir>   # same, in CI: borrow the game build and press downloads from <dir>,
 *                                    # a checkout of the branch that is already live (see below)
 *
 * `main` holds the SOURCE. The game build (play/) and the press downloads (press/files/,
 * the zip) are generated and never committed there. gh-pages receives at most one commit per
 * deploy, on top of its current tip (the repo's ruleset now forbids force-pushes and deletion;
 * before that every deploy was one force-pushed orphan commit). Git stores an unchanged file once,
 * so only a changed game build adds its 35 MB to the history.
 * Pages must be set to "Deploy from a branch: gh-pages / (root)".
 *
 * CI (.github/workflows/videos.yml) has only `main`, so it has neither generated input. `--base <dir>`
 * takes them from a checkout of the live gh-pages branch instead, and DEPLOY_REMOTE (a push URL that
 * carries the workflow's token) replaces the `origin` URL, which a fresh .deploy repo can't use.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUDFLARE_BEACON_TOKEN as TOKEN, BEACON_SRC, PRIVACY_MARKER, beaconTag, countsPage, tokenLooksValid } from './analytics.mjs';
import { SIGNUP, PRIVACY_SIGNUP_MARKER, signupProblems } from './signup.mjs';
import { strictOptions } from './lib/args.mjs';

strictOptions(['push', 'staging', 'base']);

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SITE, '.deploy');
const PUSH = process.argv.includes('--push');
/* --staging ships WITHOUT the CNAME file. Once Pages knows a custom domain, the github.io URL
   redirects to it — so while DNS still points elsewhere, a staging deploy is the only way to
   check the site on greenfieldstudio.github.io/<repo>/ first. */
const STAGING = process.argv.includes('--staging');
const baseAt = process.argv.indexOf('--base');
const BASE = baseAt > -1 ? resolve(process.argv[baseAt + 1] || '') : null;
if (baseAt > -1 && !process.argv[baseAt + 1]) { console.error('deploy: --base needs a directory.'); process.exit(2); }
const EXCLUDE = new Set(['.git', '.github', '.deploy', '.live', '.audit', 'tools', 'node_modules', 'README.md', '.gitignore', 'package.json', 'CLAUDE.md', '.claude', 'drafts', 'PLAN-CONVERSION.md']);
const git = (args, cwd = SITE) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const die = (m) => { console.error(`deploy: ${m}`); process.exit(1); };

// ── --base: borrow the generated inputs from what is already live ───────────────
if (BASE) {
  if (!existsSync(join(BASE, 'index.html'))) die(`--base ${BASE} is not a checkout of the published site.`);
  for (const p of ['play', 'press/files', 'press/greenfield-studio-presskit.zip']) {
    if (existsSync(join(SITE, p))) continue; // a local build wins
    if (!existsSync(join(BASE, p))) die(`--base has no ${p}.`);
    mkdirSync(dirname(join(SITE, p)), { recursive: true });
    cpSync(join(BASE, p), join(SITE, p), { recursive: true });
    console.log(`deploy: took ${p} from ${BASE}`);
  }
  // The published play/index.html already carries the visitor counter. It is added again below, so
  // take exactly what this script added out of the copy (and refuse to go on if anything is left).
  const game = join(SITE, 'play', 'index.html');
  if (TOKEN && existsSync(game)) {
    const html = readFileSync(game, 'utf8');
    const stripped = html.replace(beaconTag(TOKEN) + '\n', '');
    if (stripped.includes(BEACON_SRC)) die('the published play/index.html carries a counter this script did not add; refusing to count it twice.');
    if (stripped !== html) writeFileSync(game, stripped);
  }
}

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
// ── the optional email box (tools/signup.mjs): the box and the privacy paragraph go live together ──
const signupOn = !!SIGNUP;
const privacyHtml = readFileSync(join(OUT, 'privacy', 'index.html'), 'utf8');
if (signupOn !== privacyHtml.includes(PRIVACY_SIGNUP_MARKER)) {
  die(signupOn
    ? 'the email box is switched on but privacy/index.html has no "Email list" paragraph. Run: node tools/sync-ambience.mjs --offline'
    : 'privacy/index.html has an "Email list" paragraph but the email box is off (tools/signup.mjs). Run: node tools/sync-ambience.mjs --offline');
}
if (signupOn && signupProblems().length) die(`tools/signup.mjs: the email box is on but these are missing or still placeholders: ${signupProblems().join(', ')}.`);
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
// A normal commit on top of the current gh-pages tip, pushed as a plain fast-forward. The repo's
// ruleset on gh-pages refuses force-pushes and deletion, so history is never rewritten: the new
// commit's tree is exactly the assembled site (files that left the site leave the branch), and
// nothing is committed when that tree is already what gh-pages holds.
let remote = process.env.DEPLOY_REMOTE || '';
if (!remote) { try { remote = git(['remote', 'get-url', 'origin']); } catch (_) { die('no `origin` remote on the site repo. Add one: git remote add origin <url>'); } }
const shown = remote.replace(/\/\/[^@/]*@/, '//***@');
// Run git and, on failure, stop with its message, with any token in the URL hidden.
const gitOrDie = (args, what, cwd = OUT) => {
  try { return git(args, cwd); } catch (e) {
    const out = `${e.stderr || ''}${e.stdout || ''}`.trim() || e.message;
    die(`${what} failed (${shown}):\n${out.split(remote).join(shown).replace(/\/\/[^@/\s]*@/g, '//***@')}`);
  }
};
if (dirty) console.warn('deploy: note — publishing with uncommitted changes in the source tree.');
const ref = 'refs/heads/gh-pages';
const tip = gitOrDie(['ls-remote', '--heads', remote, ref], 'reading gh-pages', SITE).split(/\s+/)[0] || '';
gitOrDie(['init', '-q', '-b', 'gh-pages']);
// Whatever happens next (also die()), the scratch repo does not stay behind: it holds the site and FETCH_HEAD names the remote.
process.on('exit', () => rmSync(join(OUT, '.git'), { recursive: true, force: true }));
if (tip) {
  // Fetch the tip, move the branch there without touching the files (reset --mixed leaves the working
  // tree = the assembled site), so `add -A` below records the difference to what is live.
  gitOrDie(['fetch', '-q', '--no-tags', '--depth=1', remote, ref]);
  gitOrDie(['reset', '-q', '--mixed', 'FETCH_HEAD']);
  if (gitOrDie(['rev-parse', 'HEAD']) !== tip) die(`fetched gh-pages is not the tip ${tip} that the remote announced; try again.`);
}
gitOrDie(['add', '-A']);
let changed = true;
if (tip) { try { git(['diff', '--cached', '--quiet'], OUT); changed = false; } catch (_) { /* exit 1 = there are changes */ } }
if (!changed) {
  console.log(`deploy: nothing to publish — gh-pages (${tip.slice(0, 9)}) already holds exactly this site.`);
} else {
  gitOrDie(['commit', '-q', '-m', `Deploy site ${src} · game ${game.slice(0, 9)}\n\nPublished by tools/deploy.mjs. Source: main@${src}. Game build: ${game}.`]);
  console.log(`deploy: pushing to ${shown} (gh-pages, ${tip ? `fast-forward from ${tip.slice(0, 9)}` : 'new branch'})…`);
  // No --force: if gh-pages moved since the fetch, or the remote refuses, this fails and nothing is lost.
  gitOrDie(['push', remote, `HEAD:${ref}`], 'push');
  const head = gitOrDie(['rev-parse', 'HEAD']);
  const now = gitOrDie(['ls-remote', '--heads', remote, ref], 'checking gh-pages after the push', SITE).split(/\s+/)[0] || '';
  if (now !== head) die(`the push reported success but gh-pages is ${now || 'missing'}, not ${head}.`);
}
console.log('deploy: done. GitHub Pages will publish in a minute or two.');

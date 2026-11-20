#!/usr/bin/env node
/**
 * check-atomic.mjs — regression tests for WR-654 (WS W-2 "CI refresh coupling", W-3 "atomic media writes").
 *
 *   node tools/check-atomic.mjs
 *
 * W-3 rule: a final-name file is the old complete one or the new complete one. A failed, empty or killed
 * write keeps the old file byte-identical and leaves no `.new` temp file. ffmpeg, bsdtar and zip are stubs
 * (`run`), so nothing here needs them, a network or the real site.
 * W-2 rule: the daily workflow's stray-file check allows every page sync-chrome owns, and its push to main
 * rebases once when main moved. Both run the REAL step scripts of .github/workflows/videos.yml in a temp git repo
 * (skipped, loudly, where no real bash exists).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic, publishAtomic, tmpPath } from './lib/atomic.mjs';
import { ffmpegTo, copyTo, zipTo } from './lib/media.mjs';
import { ffmpegWebp, pruneThumbs } from './lib/youtube.mjs';
import { ensureSlugs, removeFilm } from './lib/film-pages.mjs';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(TOOLS, '..');
const tests = [];
const test = (name, a, b) => tests.push(b ? [name, b, a.skip] : [name, a, false]);
const tmp = () => mkdtempSync(join(tmpdir(), 'wr654-'));
const names = (dir) => readdirSync(dir).sort();
const OLD = Buffer.from('OLD-COMPLETE-FILE');
const withDir = async (fn) => { const d = tmp(); try { await fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

// a stand-in for spawnSync: writes `bytes` to the output the tool was given (the `.new` temp name, else the last
// argument, which is where the OLD code put the final name) and exits with `status`
const stub = (status, bytes) => (cmd, args) => {
  if (bytes !== null) writeFileSync(args.find((a) => /\.new\./.test(a)) || args[args.length - 1], bytes);
  return { status };
};

// ── W-3 ────────────────────────────────────────────────────────────────────────
test('tmpPath: same folder, keeps the extension (ffmpeg picks its muxer from it)', () => {
  assert.equal(tmpPath(join('a', 'hero-loop.webm')), join('a', 'hero-loop.new.webm'));
  assert.equal(tmpPath('x.zip'), 'x.new.zip');
});

test('writeFileAtomic: replaces; when the rename fails the old target stays and no temp is left', async () => withDir((d) => {
  const f = join(d, 'films.json');
  writeFileSync(f, OLD);
  writeFileAtomic(f, 'NEW');
  assert.equal(readFileSync(f, 'utf8'), 'NEW');
  assert.deepEqual(names(d), ['films.json']);
  const dirTarget = join(d, 'adir');
  mkdirSync(dirTarget);
  assert.throws(() => writeFileAtomic(dirTarget, 'x')); // cannot be replaced by a file
  assert.deepEqual(names(d), ['adir', 'films.json']);
}));

test('publishAtomic: false, empty, partial-then-throw and missing temp all keep the old bytes and leave no temp', async () => withDir((d) => {
  const f = join(d, 'out.webp');
  writeFileSync(f, OLD);
  assert.equal(publishAtomic(f, (t) => { writeFileSync(t, 'PART'); return false; }), false);
  assert.equal(publishAtomic(f, (t) => { writeFileSync(t, ''); return true; }), false, 'a 0-byte result is not a build');
  assert.throws(() => publishAtomic(f, (t) => { writeFileSync(t, 'PART'); throw new Error('killed'); }), /killed/);
  assert.equal(publishAtomic(f, () => true), false, 'success claimed but no file');
  assert.deepEqual(readFileSync(f), OLD);
  assert.deepEqual(names(d), ['out.webp']);
  assert.equal(publishAtomic(f, (t) => { writeFileSync(t, 'NEW'); return true; }), true);
  assert.equal(readFileSync(f, 'utf8'), 'NEW');
  assert.deepEqual(names(d), ['out.webp']);
}));

test('make-media ff(): a failing or empty ffmpeg leaves the old output byte-identical (WS-05 repro: 0-byte out1.webp)', async () => withDir((d) => {
  const out = join(d, 'hero-loop.webm');
  writeFileSync(out, OLD);
  assert.equal(ffmpegTo('src.mp4', out, ['-an'], { run: stub(1, 'PARTIAL') }), false);
  assert.equal(ffmpegTo('src.mp4', out, ['-an'], { run: stub(0, '') }), false);
  assert.deepEqual(readFileSync(out), OLD);
  assert.deepEqual(names(d), ['hero-loop.webm']);
  let seenOut;
  assert.equal(ffmpegTo('src.mp4', out, ['-an'], { inputArgs: ['-ss', '4.9'], run: (c, a) => { seenOut = a[a.length - 1]; return stub(0, 'GOOD')(c, a); } }), true);
  assert.notEqual(seenOut, out, 'ffmpeg must write the temp name, never the final one');
  assert.equal(readFileSync(out, 'utf8'), 'GOOD');
  assert.deepEqual(names(d), ['hero-loop.webm']);
}));

test('make-media copy(): a copy that dies half way keeps the old file', async () => withDir((d) => {
  const out = join(d, 'a.mp4');
  writeFileSync(out, OLD);
  assert.throws(() => copyTo('src', out, { copy: (s, t) => { writeFileSync(t, 'HALF'); throw new Error('disk full'); } }), /disk full/);
  assert.deepEqual(readFileSync(out), OLD);
  assert.deepEqual(names(d), ['a.mp4']);
}));

test('press zip: failed bsdtar and failed zip(1) keep the old zip; both tool branches write the temp, then rename', async () => withDir((d) => {
  const zip = join(d, 'presskit.zip');
  writeFileSync(zip, OLD);
  for (const exists of [() => true, () => false]) { // Windows (bsdtar) and elsewhere (zip)
    assert.equal(zipTo(zip, d, ['ABOUT.txt'], { run: stub(1, 'PK-partial'), exists }), false);
    assert.deepEqual(readFileSync(zip), OLD);
    assert.deepEqual(names(d), ['presskit.zip']);
  }
  const used = [];
  for (const exists of [() => true, () => false]) {
    assert.equal(zipTo(zip, d, ['ABOUT.txt'], { run: (c, a) => { used.push(c); return stub(0, 'PK-new')(c, a); }, exists }), true);
  }
  assert.equal(used[0].includes('tar'), true);
  assert.equal(used[1], 'zip');
  assert.equal(readFileSync(zip, 'utf8'), 'PK-new');
  assert.deepEqual(names(d), ['presskit.zip']);
}));

test('thumbnails (ffmpegWebp, the sync-shorts / sync-ambience entry): a failed conversion keeps the old webp and leaves no temp', async () => withDir((d) => {
  const out = join(d, 'abcdefghijk.webp');
  writeFileSync(out, OLD);
  const err = console.error; console.error = () => {};
  try { assert.equal(ffmpegWebp(Buffer.from('jpg'), out, 'crop=1:1', stub(1, 'PARTIAL')), false); } finally { console.error = err; }
  assert.deepEqual(readFileSync(out), OLD);
  assert.deepEqual(names(d), ['abcdefghijk.webp']);
  assert.equal(ffmpegWebp(Buffer.from('jpg'), out, 'crop=1:1', stub(0, 'WEBP')), true);
  assert.equal(readFileSync(out, 'utf8'), 'WEBP');
  assert.deepEqual(names(d), ['abcdefghijk.webp']);
}));

test('pruneThumbs removes `.new` leftovers of a killed write, even for a listed film (WS-08), and keeps real files', async () => withDir((d) => {
  const id = 'abcdefghijk', gone = 'zzzzzzzzzzz';
  for (const f of [`${id}-1280.webp`, `${id}-640.webp`, `${id}-og.jpg`, `${id}-1280.webp.new`, `${id}.new.webp`, `${id}-og.new.jpg`, `${gone}-640.webp`, 'films.json', 'coming-reef-640.webp']) writeFileSync(join(d, f), 'x');
  pruneThumbs(d, [id, 'coming-reef']);
  assert.deepEqual(names(d), ['coming-reef-640.webp', 'films.json', `${id}-1280.webp`, `${id}-640.webp`, `${id}-og.jpg`].sort());
}));

test('a removed film keeps its slug reserved: a new film with the same title gets another one (WS-07)', () => {
  const db = { films: [{ id: 'aaaaaaaaaaa', title: 'Old Cabin Film', slug: 'old-cabin-film' }] };
  removeFilm(db, 'aaaaaaaaaaa');
  assert.deepEqual(db.films, []);
  assert.deepEqual(db.removedSlugs, ['old-cabin-film']);
  db.films.push({ id: 'bbbbbbbbbbb', title: 'Old Cabin Film' });
  ensureSlugs(db);
  assert.equal(db.films[0].slug, 'old-cabin-film-2');
  assert.deepEqual(db.removedSlugs, ['old-cabin-film'], 'the tombstone stays');
});

// ── W-2 ────────────────────────────────────────────────────────────────────────
const node = (...a) => spawnSync(process.execPath, a, { encoding: 'utf8' });
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const g = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim(); // Git for Windows: <root>/mingw64/libexec/git-core
  const b = g && resolve(g, '..', '..', '..', 'usr', 'bin', 'bash.exe');
  return b && existsSync(b) ? b : null; // never the WSL stub in WindowsApps
}
const BASH = findBash();
const posix = (p) => p.replace(/\\/g, '/');
const yml = readFileSync(join(SITE, '.github', 'workflows', 'videos.yml'), 'utf8').replace(/\r/g, '');
function stepScript(name) {
  const lines = yml.split('\n');
  const at = lines.findIndex((l) => l.includes(`- name: ${name}`));
  assert.ok(at >= 0, `no step "${name}"`);
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  const indent = lines[run].match(/^\s*/)[0].length;
  const body = [];
  for (let i = run + 1; i < lines.length && (lines[i].trim() === '' || lines[i].match(/^\s*/)[0].length > indent); i++) body.push(lines[i].slice(indent + 2));
  return body.join('\n');
}
const sh = (cwd, script, env = {}) => spawnSync(BASH, ['-e', '-c', script], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };

test('sync-chrome --list names every page it may rewrite (and still refuses unknown options)', () => {
  const r = node(join(TOOLS, 'sync-chrome.mjs'), '--list');
  assert.equal(r.status, 0, r.stderr);
  const pages = r.stdout.trim().split('\n');
  for (const p of ['index.html', 'wallpapers/index.html', 'privacy/index.html', '404.html', 'minigolf-pro/index.html']) assert.ok(pages.includes(p), p);
  assert.equal(node(join(TOOLS, 'sync-chrome.mjs'), '--lst').status, 2);
});

/** A temp repo with the site's tools/ and one stub file per chrome page, committed. */
function fixtureRepo(d) {
  const repo = join(d, 'repo');
  mkdirSync(repo);
  cpSync(TOOLS, join(repo, 'tools'), { recursive: true });
  const pages = node(join(TOOLS, 'sync-chrome.mjs'), '--list').stdout.trim().split('\n');
  for (const f of [...pages, 'sitemap.xml', 'assets/media/ambience/films/films.json', 'assets/media/shorts/shorts.json']) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), 'v1\n');
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

test('daily workflow: a committed footer drift in a page sync-chrome owns is a generated change, not a stray file (WS-04)', { skip: !BASH && 'no real bash' }, async () => withDir((d) => {
  const repo = fixtureRepo(d);
  const out = join(d, 'gh-output.txt');
  const step = stepScript('Check that only generated files changed');
  // the refresh rewrote wallpapers/index.html (outside the old whitelist) and a film's thumbnail
  writeFileSync(join(repo, 'wallpapers/index.html'), 'footer drift fixed by sync-chrome\n');
  writeFileSync(join(repo, 'assets/media/shorts/abcdefghijk.webp'), 'w');
  let r = sh(repo, step, { GITHUB_OUTPUT: posix(out) });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(readFileSync(out, 'utf8'), /changed=true/);
  // a file nobody owns is still a stray and still stops the run, naming it
  writeFileSync(join(repo, 'run.log'), 'x');
  r = sh(repo, step, { GITHUB_OUTPUT: posix(out) });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Unexpected files changed[\s\S]*run\.log/);
  assert.doesNotMatch(r.stdout.split('Unexpected files changed')[1], /wallpapers/);
}));

test('daily workflow: the commit step stages the chrome pages and pushes again after a rebase when main moved (WS-06)', { skip: !BASH && 'no real bash' }, async () => withDir((d) => {
  const repo = fixtureRepo(d);
  const remote = join(d, 'remote.git');
  git(d, 'init', '-q', '--bare', '-b', 'main', remote);
  git(repo, 'remote', 'add', 'origin', posix(remote));
  git(repo, 'push', '-q', 'origin', 'main');
  const other = join(d, 'other');
  git(d, 'clone', '-q', posix(remote), other);
  writeFileSync(join(other, 'README.md'), 'a PR merged while the refresh ran\n'); // not a generated file
  git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'PR merged'); git(other, 'push', '-q', 'origin', 'main');
  writeFileSync(join(repo, 'index.html'), 'v2\n');
  writeFileSync(join(repo, 'wallpapers/index.html'), 'v2\n');
  const r = sh(repo, stepScript('Commit the refreshed lists to main'));
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const log = git(remote, 'log', '--format=%s', 'main').trim().split('\n');
  assert.deepEqual(log, ['Refresh films and Shorts from YouTube', 'PR merged', 'base']);
  assert.match(git(remote, 'show', 'main:wallpapers/index.html'), /v2/, 'the allowed chrome page was committed');
  assert.match(git(remote, 'show', 'main:README.md'), /PR merged/, 'main kept the other commit');
}));

let failed = 0;
for (const [name, fn, skip] of tests) {
  if (skip) { console.log(`skip ${name} (${skip})`); continue; }
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\ncheck-atomic: ${tests.length} tests ok`);
process.exit(failed ? 1 : 0);

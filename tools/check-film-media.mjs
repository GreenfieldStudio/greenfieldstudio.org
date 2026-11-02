#!/usr/bin/env node
/**
 * check-film-media.mjs — tests for two film-page fixes: a "Chapters:" heading in the same block as the
 * times (parseDescription), and thumbnail / share-image refresh (refreshThumb in tools/lib/youtube.mjs).
 *
 *   node tools/check-film-media.mjs
 *
 * Stub fetch and stub converter, temp folders only: no network, no ffmpeg, nothing in the site is written.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDescription } from './lib/film-pages.mjs';
import { spawnSync } from 'node:child_process';
import { refreshThumb, webpArgs, readFeed, dropDuplicateEntries } from './lib/youtube.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const film = (description) => ({ id: 'abcdefghijk', title: 'A film', description });
const TIMES = '0:00 Arrival\n12:30 Rain\n1:05:00 Late storm';

test('chapters under a "Chapters:" heading in the same block are kept', () => {
  const d = parseDescription(film(`Rain all night.\n\nChapters:\n${TIMES}\n\nNo music.`));
  assert.deepEqual(d.chapters, [{ s: 0, label: 'Arrival' }, { s: 750, label: 'Rain' }, { s: 3900, label: 'Late storm' }]);
  assert.ok(!JSON.stringify(d.body).includes('Arrival'), 'chapter lines must not also appear as body text');
  assert.ok(!JSON.stringify(d.body).includes('Chapters:'), 'the heading line must not be left over');
});

test('other heading words work, and a block without a heading still works', () => {
  for (const h of ['Timestamps', 'Timestamps:', 'Jump to:', 'CHAPTERS']) {
    assert.equal(parseDescription(film(`Intro.\n\n${h}\n${TIMES}`)).chapters.length, 3, h);
  }
  assert.equal(parseDescription(film(`Intro.\n\n${TIMES}`)).chapters.length, 3);
});

test('a normal paragraph above a list of times is not taken as a heading', () => {
  const d = parseDescription(film(`Intro.\n\nWe recorded this over three nights in a quiet valley:\n${TIMES}`));
  assert.deepEqual(d.chapters, []);
  assert.ok(JSON.stringify(d.body).includes('quiet valley'));
});

test('fewer than three chapters, or none at 0:00, are still dropped', () => {
  assert.deepEqual(parseDescription(film('Intro.\n\nChapters:\n0:00 A\n5:00 B')).chapters, []);
  assert.deepEqual(parseDescription(film('Intro.\n\nChapters:\n1:00 A\n5:00 B\n9:00 C')).chapters, []);
});

// ---- thumbnails
const jpg = (text) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(text) });
const bad = (status) => ({ ok: false, status, arrayBuffer: async () => Buffer.alloc(0) });
const convert = (buf, out) => { writeFileSync(out, buf); return true; };
const dir = () => mkdtempSync(join(tmpdir(), 'gs-media-'));
const ID = 'abcdefghijk';
const read = (d, n) => readFileSync(join(d, `${ID}-${n}`), 'utf8');

test('a new film gets both sizes and a sha', async () => {
  const d = dir();
  const r = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('one'), convert });
  assert.equal(r.changed, true);
  assert.match(r.sha, /^maxresdefault:[0-9a-f]{40}$/);
  assert.equal(read(d, '1280.webp'), 'one');
  assert.equal(read(d, '640.webp'), 'one');
  rmSync(d, { recursive: true });
});

test('the same source again changes nothing and keeps the share image', async () => {
  const d = dir();
  const a = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('one'), convert });
  writeFileSync(join(d, `${ID}-og.jpg`), 'og');
  const b = await refreshThumb(d, ID, a.sha, { fetch: async () => jpg('one'), convert: () => assert.fail('must not convert') });
  assert.equal(b.changed, false);
  assert.equal(read(d, 'og.jpg'), 'og');
  rmSync(d, { recursive: true });
});

test('a changed YouTube thumbnail rewrites both sizes and deletes the stale share image', async () => {
  const d = dir();
  const a = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('one'), convert });
  writeFileSync(join(d, `${ID}-og.jpg`), 'og');
  const b = await refreshThumb(d, ID, a.sha, { fetch: async () => jpg('two'), convert });
  assert.equal(b.changed, true);
  assert.notEqual(b.sha, a.sha);
  assert.equal(read(d, '1280.webp'), 'two');
  assert.equal(read(d, '640.webp'), 'two');
  assert.ok(!existsSync(join(d, `${ID}-og.jpg`)), 'the old share image must go so syncFilmPages makes a new one');
  rmSync(d, { recursive: true });
});

test('a film from before the sha existed is refreshed once', async () => {
  const d = dir();
  writeFileSync(join(d, `${ID}-1280.webp`), 'old'); writeFileSync(join(d, `${ID}-640.webp`), 'old'); writeFileSync(join(d, `${ID}-og.jpg`), 'og');
  const r = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('new'), convert });
  assert.equal(r.changed, true);
  assert.equal(read(d, '1280.webp'), 'new');
  assert.ok(!existsSync(join(d, `${ID}-og.jpg`)));
  rmSync(d, { recursive: true });
});

test('a YouTube outage or a failed conversion keeps the files on disk', async () => {
  const d = dir();
  const a = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('one'), convert });
  for (const f of [async () => bad(503), async () => { throw new Error('offline'); }]) {
    const r = await refreshThumb(d, ID, a.sha, { fetch: f, convert });
    assert.deepEqual(r, { sha: a.sha, changed: false });
  }
  const r = await refreshThumb(d, ID, a.sha, { fetch: async () => jpg('two'), convert: () => false });
  assert.deepEqual(r, { sha: a.sha, changed: false });
  assert.equal(read(d, '1280.webp'), 'one');
  assert.equal(read(d, '640.webp'), 'one');
  rmSync(d, { recursive: true });
});

test('a 404 on maxresdefault never swaps a smaller size in over a maxres pair', async () => {
  const d = dir();
  const a = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('one'), convert });
  const r = await refreshThumb(d, ID, a.sha, { fetch: async (u) => (u.includes('maxres') ? bad(404) : jpg('sd')), convert });
  assert.deepEqual(r, { sha: a.sha, changed: false });
  assert.equal(read(d, '1280.webp'), 'one');
  rmSync(d, { recursive: true });
});

test('a film that only ever had sddefault stays on it, and upgrades when maxresdefault appears', async () => {
  const d = dir();
  const sdOnly = async (u) => (u.includes('maxres') ? bad(404) : jpg('sd'));
  const a = await refreshThumb(d, ID, undefined, { fetch: sdOnly, convert });
  assert.match(a.sha, /^sddefault:/);
  assert.equal((await refreshThumb(d, ID, a.sha, { fetch: sdOnly, convert: () => assert.fail('no change') })).changed, false);
  const b = await refreshThumb(d, ID, a.sha, { fetch: async () => jpg('big'), convert });
  assert.equal(b.changed, true);
  assert.equal(read(d, '1280.webp'), 'big');
  rmSync(d, { recursive: true });
});

test('the first conversion works but the second fails: old pair untouched, no .new files left, share image kept', async () => {
  const d = dir();
  const a = await refreshThumb(d, ID, undefined, { fetch: async () => jpg('one'), convert });
  writeFileSync(join(d, `${ID}-og.jpg`), 'og');
  let n = 0;
  const flaky = (buf, out) => (++n === 2 ? false : convert(buf, out));
  const r = await refreshThumb(d, ID, a.sha, { fetch: async () => jpg('two'), convert: flaky });
  assert.equal(r.changed, false);
  assert.equal(read(d, '1280.webp'), 'one');
  assert.equal(read(d, '640.webp'), 'one');
  assert.equal(read(d, 'og.jpg'), 'og');
  assert.ok(!existsSync(join(d, `${ID}-1280.webp.new`)) && !existsSync(join(d, `${ID}-640.webp.new`)));
  rmSync(d, { recursive: true });
});

test('the 1280 file is taken from maxresdefault, falling back to the next size on 404', async () => {
  const d = dir();
  const urls = [];
  const fetch = async (u) => { urls.push(u.split('/').pop()); return u.includes('maxres') ? bad(404) : jpg('sd'); };
  const r = await refreshThumb(d, ID, undefined, { fetch, convert });
  assert.deepEqual(urls, ['maxresdefault.jpg', 'sddefault.jpg']);
  assert.equal(r.changed, true);
  rmSync(d, { recursive: true });
});

test('a film with no thumbnail anywhere throws', async () => {
  const d = dir();
  await assert.rejects(refreshThumb(d, ID, undefined, { fetch: async () => bad(404), convert }), /no thumbnail/);
  rmSync(d, { recursive: true });
});

// WR-121: refreshThumb writes `<id>-1280.webp.new` first; ffmpeg cannot pick a muxer from ".new", so every
// first-time thumbnail failed on the runner. The stub converter above hid it.
test('the ffmpeg arguments name the webp format explicitly (output ends in .new)', () => {
  const a = webpArgs('in.jpg', 'abc-1280.webp.new', 'scale=1280:-2');
  assert.equal(a[a.indexOf('-f') + 1], 'webp');
  assert.equal(a.at(-1), 'abc-1280.webp.new', 'the output file stays last');
  assert.ok(a.indexOf('-f') < a.length - 1);
});

test('a new film through refreshThumb with the REAL ffmpeg gets two WebP files (skipped without ffmpeg + libwebp)', async () => {
  const enc = spawnSync('ffmpeg', ['-hide_banner', '-encoders']);
  if (enc.error || !String(enc.stdout).includes('libwebp')) { console.log('     (ffmpeg with libwebp not available: skipped)'); return; }
  const d = dir();
  try {
    const src = join(d, 'src.jpg');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=1', '-frames:v', '1', src]).status, 0);
    const bytes = readFileSync(src);
    // no `convert` given: the production converter runs, writing `<id>-1280.webp.new` first
    const r = await refreshThumb(d, ID, undefined, { fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }) });
    assert.equal(r.changed, true);
    for (const n of ['1280', '640']) assert.equal(readFileSync(join(d, `${ID}-${n}.webp`)).subarray(8, 12).toString(), 'WEBP');
    assert.ok(!existsSync(join(d, `${ID}-1280.webp.new`)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---- WR-121 (CEO): repeated live-stream placeholders never become pages
const entry = (id, title, views) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>2026-10-30T10:00:00+00:00</published><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><media:group><media:description>d</media:description>${views === undefined ? '' : `<media:community><media:statistics views="${views}"/></media:community>`}</media:group></entry>`;
const LIVE = 'Live: Cozy Halloween Cabin for Sleep | Storm, Fire &amp; Ghosts, 8 Hours (No Music)';
const SIX = ['eBGd6AM06wk', 'HQIthFuGVOU', '3vF86qfLk6U', 'TaRwFvEI6RM', 'oeph93s7M7g', 'hrUOqKDu9rI'];
const feedXml = [
  ...SIX.map((id) => entry(id, LIVE, 0)),
  entry('xZO79L1fbLc', 'Castle at Night for Sleep | 10 Hours of Owls &amp; a Passing Dragon', 120),
  entry('aaaaaaaaaaa', 'Live: Real Stream Title', 40),
  entry('bbbbbbbbbbb', 'Live: No Stats Yet'),
].join('\n');
const readTestFeed = () => readFeed('UCx', { fetch: async () => ({ ok: true, status: 200, text: async () => `<feed>${feedXml}</feed>` }), pauses: [] });

test('readFeed carries the views of an entry, null when the feed has none', async () => {
  const f = await readTestFeed();
  assert.equal(f.find((x) => x.id === 'xZO79L1fbLc').views, 120);
  assert.equal(f.find((x) => x.id === SIX[0]).views, 0);
  assert.equal(f.find((x) => x.id === 'bbbbbbbbbbb').views, null);
});

test('the six identical Live: entries yield zero pages; the unique title and a Live: entry with views stay', async () => {
  const logs = [];
  const kept = dropDuplicateEntries(await readTestFeed(), (l) => logs.push(l));
  assert.deepEqual(kept.map((f) => f.id), ['xZO79L1fbLc', 'aaaaaaaaaaa']);
  assert.equal(logs.length, 7); // 6 duplicates + the Live: entry without views
  assert.ok(SIX.every((id) => logs.some((l) => l.includes(`skipped duplicate ${id}`))));
});

test('identical titles are skipped even without "Live:" and even with views; a lone title is kept', () => {
  const e = (id, title, views) => ({ id, title, views });
  const kept = dropDuplicateEntries([e('a', 'Rain Night', 50), e('b', ' rain  night ', 60), e('c', 'Other', 1)], () => {});
  assert.deepEqual(kept.map((f) => f.id), ['c']);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

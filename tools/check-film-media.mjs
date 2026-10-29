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
import { refreshThumb } from './lib/youtube.mjs';

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

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

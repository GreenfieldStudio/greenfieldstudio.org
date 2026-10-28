#!/usr/bin/env node
/**
 * check-refresh.mjs — tests for the daily refresh's "fail soft" rule (tools/refresh-videos.mjs,
 * tools/lib/refresh.mjs, readFeed's FeedUnavailableError, the exit 75 of sync-ambience / sync-shorts).
 *
 *   node tools/check-refresh.mjs
 *
 * A stub fetch and a stub clock for the decision; a local http server on 127.0.0.1 for the two sync tools.
 * No YouTube, no waiting, nothing written to the site (the sync tools stop before they write).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFeed, FeedUnavailableError, FEED_OUTAGE_EXIT } from './lib/youtube.mjs';
import { runRefresh, parseStamps, stampsText, STALE_AFTER_DAYS } from './lib/refresh.mjs';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(TOOLS, '..');
const ATOM = '<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>A film</title><published>2026-10-01T00:00:00+00:00</published>'
  + '<link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><media:description>d</media:description></entry></feed>';
const reply = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const script = (...steps) => {
  let n = 0;
  return { fetch: async () => { const s = steps[Math.min(n++, steps.length - 1)]; if (s instanceof Error) throw s; return s; }, calls: () => n };
};
const sleep = async () => {};
const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-10-28T05:23:00Z');

// A sync step that reads a (stubbed) feed the way the sync tools do: an outage is exit 75, anything else 1.
const feedStep = (name, fetch) => ({
  key: name,
  name,
  run: async () => {
    try { await readFeed('UC1', { fetch, sleep }); return 0; }
    catch (e) { return e instanceof FeedUnavailableError ? FEED_OUTAGE_EXIT : 1; }
  },
});
// Runs runRefresh with an in-memory stamp file, log and summary, and reports what happened. `lastOk` is the
// last successful read of both feeds ('A' and 'S') in ms, or an object { A, S }; `rawStamp` is the file text itself.
async function refresh(steps, lastOk, rawStamp = null) {
  const stamps = typeof lastOk === 'number' ? { A: lastOk, S: lastOk } : lastOk;
  const r = { stamp: stamps === undefined ? rawStamp : stampsText(stamps), writes: 0, log: [], summary: [] };
  const quiet = console.warn; console.warn = () => {};
  try {
    r.code = await runRefresh({
      steps, now: NOW,
      readStamp: () => r.stamp, writeStamp: (t) => { r.stamp = t; r.writes++; },
      log: (l) => r.log.push(l), summary: (m) => r.summary.push(m),
    });
  } finally { console.warn = quiet; }
  return r;
}
const ok = (name) => feedStep(name, script(reply(200, ATOM)).fetch);
const down = (name, ...seq) => feedStep(name, script(...(seq.length ? seq : [reply(500)])).fetch);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('feed ok: exit 0, last-success stamp moves to now', async () => {
  const r = await refresh([ok('A'), ok('S')], NOW - 3 * DAY);
  assert.equal(r.code, 0);
  assert.equal(r.writes, 1);
  assert.deepEqual(parseStamps(r.stamp), { A: NOW, S: NOW });
  assert.deepEqual(r.log, []);
});

test('feed ok twice on the same day: the stamp is not rewritten (no commit churn)', async () => {
  const r = await refresh([ok('A'), ok('S')], NOW - 3600 * 1000);
  assert.equal(r.code, 0);
  assert.equal(r.writes, 0);
});

test('500, 500, 404, then ok: the retry succeeds, exit 0, stamp moves', async () => {
  const r = await refresh([feedStep('A', script(reply(500), reply(500), reply(404), reply(200, ATOM)).fetch), ok('S')], NOW - 2 * DAY);
  assert.equal(r.code, 0);
  assert.deepEqual(parseStamps(r.stamp), { A: NOW, S: NOW });
  assert.deepEqual(r.log, []);
});

test('all 500/404, lists 4 days old: exit 0, one warning line, age in the summary, stamp untouched', async () => {
  const last = NOW - 4 * DAY;
  const r = await refresh([down('Ambience', reply(500), reply(404), reply(404), reply(404), reply(500)), down('Studio')], { Ambience: last, Studio: last });
  assert.equal(r.code, 0);
  assert.equal(r.log.length, 1);
  assert.match(r.log[0], /^::warning::Refresh videos: the YouTube feed for Ambience \(last successful refresh: 2026-10-24 05:23 UTC, 4 day\(s\) ago\) and Studio \(.*4 day\(s\) ago\) could not be used/);
  assert.match(r.log[0], /left as it is/);
  assert.match(r.summary.join('\n'), /last successful refresh \*\*2026-10-24 05:23 UTC\*\* \(4 day\(s\) ago\)/);
  assert.match(r.summary.join('\n'), /green/);
  assert.equal(r.writes, 0);
  assert.deepEqual(parseStamps(r.stamp), { Ambience: last, Studio: last });
});

test('all failing, lists 8 days old: exit 1 (red), error line, summary says STALE', async () => {
  const r = await refresh([down('A'), down('S')], NOW - 8 * DAY);
  assert.equal(r.code, 1);
  assert.match(r.log[0], /^::error::.*more than 7 days/);
  assert.match(r.summary.join('\n'), /STALE/);
  assert.equal(r.writes, 0);
});

test('the border: exactly 7 days is still green, one minute more is red', async () => {
  assert.equal(STALE_AFTER_DAYS, 7);
  assert.equal((await refresh([down('A'), down('S')], NOW - 7 * DAY)).code, 0);
  assert.equal((await refresh([down('A'), down('S')], NOW - 7 * DAY - 60000)).code, 1);
});

test('no stamp on record or an unreadable one: an outage is red (an alert must not depend on a missing file)', async () => {
  assert.equal((await refresh([down('A'), down('S')])).code, 1);
  assert.equal((await refresh([down('A'), down('S')], undefined, '{not json')).code, 1);
  assert.deepEqual(parseStamps('{not json'), {});
  assert.deepEqual(parseStamps('{"A":"yesterday","S":"2026-10-20T00:00:00Z"}'), { S: Date.parse('2026-10-20T00:00:00Z') });
  // only one feed has no record: that one is red even though the other is fresh
  assert.equal((await refresh([down('A'), down('S')], { S: NOW - DAY })).code, 1);
});

test('malformed answers are an outage, not a crash: an HTML page, 403, a network error', async () => {
  for (const seq of [[reply(200, '<html>consent</html>')], [reply(403)], [new Error('getaddrinfo ENOTFOUND'), new Error('x'), new Error('x'), new Error('x'), new Error('x')]]) {
    const r = await refresh([down('A', ...seq), ok('S')], NOW - DAY);
    assert.equal(r.code, 0, JSON.stringify(seq));
    assert.match(r.log[0], /^::warning::.*feed for A \(.*\) could not be used/);
  }
});

test('malformed XML: an Atom feed that holds no usable entry reads as an empty list, never as videos', async () => {
  const entries = await readFeed('UC1', { fetch: script(reply(200, '<feed><entry><yt:videoId>nope</yt:videoId><title>x</entry></feed>')).fetch, sleep });
  assert.deepEqual(entries, []);
  const truncated = await readFeed('UC1', { fetch: script(reply(200, ATOM.slice(0, ATOM.indexOf('</entry>')))).fetch, sleep });
  assert.deepEqual(truncated, []);
});

test('one feed down, the other fine: the fine one still ran and moves its own stamp only', async () => {
  const r = await refresh([down('A'), ok('S')], NOW - 2 * DAY);
  assert.equal(r.code, 0);
  assert.deepEqual(parseStamps(r.stamp), { A: NOW - 2 * DAY, S: NOW });
  assert.match(r.log[0], /feed for A \(.*2 day\(s\) ago\) could not be used/);
});

test('a feed that stays broken goes red after 7 days even though the other list is fresh every day', async () => {
  const r = await refresh([down('A'), ok('S')], { A: NOW - 8 * DAY, S: NOW - DAY });
  assert.equal(r.code, 1);
  assert.match(r.log[0], /^::error::.*feed for A/);
  assert.deepEqual(parseStamps(r.stamp), { A: NOW - 8 * DAY, S: NOW });
});

test('a real fault (exit 1) is red at once, even with fresh lists; a feed that was read still moves its stamp', async () => {
  const r = await refresh([{ key: 'A', name: 'A', run: async () => 1 }, ok('S')], NOW - DAY);
  assert.equal(r.code, 1);
  assert.match(r.log[0], /^::error::Refresh videos: A failed \(exit 1\)/);
  assert.deepEqual(parseStamps(r.stamp), { A: NOW - DAY, S: NOW });
});

test('GS_FEED_BASE is honoured only for a plain http://127.0.0.1 URL', async () => {
  const { feedBase } = await import('./lib/youtube.mjs');
  const yt = 'https://www.youtube.com/feeds/videos.xml';
  assert.equal(feedBase({}), yt);
  assert.equal(feedBase({ GS_FEED_BASE: 'http://127.0.0.1:8080/f' }), 'http://127.0.0.1:8080/f');
  for (const bad of ['http://127.0.0.1:80@evil.example/x', 'http://evil.example/', 'https://127.0.0.1/f', 'http://127.0.0.1.evil.example/f', 'http://localhost:1/f', 'junk']) {
    assert.equal(feedBase({ GS_FEED_BASE: bad }), yt, bad);
  }
});

test('the stamp file seeded in the repo is readable and holds both feeds', async () => {
  const { readFileSync } = await import('node:fs');
  const s = parseStamps(readFileSync(join(TOOLS, 'videos-last-ok.json'), 'utf8'));
  assert.deepEqual(Object.keys(s).sort(), ['ambience', 'shorts']);
  assert.ok(s.ambience > Date.parse('2026-10-01') && s.shorts > Date.parse('2026-10-01'));
});

// --- the real sync tools against a local server: exit 75 and not one byte written ---------------------------
const gitState = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: SITE, encoding: 'utf8' });
const serve = (status, body) => new Promise((res) => {
  const srv = http.createServer((q, s) => { s.writeHead(status, { 'content-type': 'text/xml' }); s.end(body); });
  srv.listen(0, '127.0.0.1', () => res(srv));
});
const run = (script, base) => new Promise((res) => {
  const p = spawn(process.execPath, [join(TOOLS, script)], { env: { ...process.env, GS_FEED_BASE: base, GS_FEED_PAUSES_MS: '0,0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => res({ code, err }));
});
for (const [label, status, body] of [['HTTP 500', 500, ''], ['HTTP 404', 404, 'not found'], ['a 200 that is an HTML page', 200, '<html>consent</html>'], ['a valid feed with no entries (would empty the page)', 200, '<feed></feed>']]) {
  test(`sync tools on ${label}: both exit 75 and the site files are untouched`, async () => {
    const before = gitState();
    const srv = await serve(status, body);
    try {
      const base = `http://127.0.0.1:${srv.address().port}/feed`;
      for (const s of ['sync-ambience.mjs', 'sync-shorts.mjs']) {
        const r = await run(s, base);
        assert.equal(r.code, FEED_OUTAGE_EXIT, `${s}: ${r.err}`);
        assert.match(r.err, /feed unavailable/);
      }
    } finally { srv.close(); }
    assert.equal(gitState(), before);
  });
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

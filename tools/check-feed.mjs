#!/usr/bin/env node
/**
 * check-feed.mjs — tests for readFeed's retry of YouTube's transient 404/429/5xx (tools/lib/youtube.mjs).
 *
 *   node tools/check-feed.mjs
 *
 * Uses a stub fetch and a stub sleep: no network, no waiting.
 */
import assert from 'node:assert/strict';
import { readFeed, FEED_PAUSES_MS } from './lib/youtube.mjs';

const ATOM = '<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>A film</title><published>2026-10-01T00:00:00+00:00</published>'
  + '<link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><media:description>d</media:description></entry></feed>';
const reply = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });
// A fetch that answers with the given replies in order (an Error instance is thrown).
const script = (...steps) => {
  const calls = [];
  const fetch = async () => { calls.push(1); const s = steps[Math.min(calls.length - 1, steps.length - 1)]; if (s instanceof Error) throw s; return s; };
  return { fetch, calls };
};
const slept = [];
const sleep = async (ms) => { slept.push(ms); };
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a clean 200 is read at once, no pause', async () => {
  slept.length = 0;
  const s = script(reply(200, ATOM));
  const feed = await readFeed('UC1', { fetch: s.fetch, sleep });
  assert.equal(feed.length, 1);
  assert.equal(feed[0].id, 'abcdefghijk');
  assert.equal(s.calls.length, 1);
  assert.deepEqual(slept, []);
});

test('404 three times, then 200: succeeds after waiting 5+15+30 s', async () => {
  slept.length = 0;
  const s = script(reply(404), reply(404), reply(404), reply(200, ATOM));
  const feed = await quiet(() => readFeed('UC1', { fetch: s.fetch, sleep }));
  assert.equal(feed.length, 1);
  assert.equal(s.calls.length, 4);
  assert.deepEqual(slept, [5000, 15000, 30000]);
});

test('503, 429 and a network error are retried too', async () => {
  slept.length = 0;
  const s = script(reply(503), reply(429), new Error('socket hang up'), reply(200, ATOM));
  assert.equal((await quiet(() => readFeed('UC1', { fetch: s.fetch, sleep }))).length, 1);
  assert.equal(s.calls.length, 4);
});

test('404 every time: gives up after all tries with a message naming each status', async () => {
  slept.length = 0;
  const s = script(reply(404));
  await assert.rejects(quiet(() => readFeed('UC1', { fetch: s.fetch, sleep })), (e) => {
    assert.match(e.message, /feed UC1: HTTP 404 after 5 tries \(HTTP 404, HTTP 404, HTTP 404, HTTP 404, HTTP 404\)/);
    return true;
  });
  assert.equal(s.calls.length, FEED_PAUSES_MS.length + 1);
  assert.deepEqual(slept, FEED_PAUSES_MS);
});

test('a status that is not transient (403) fails at once', async () => {
  slept.length = 0;
  const s = script(reply(403));
  await assert.rejects(readFeed('UC1', { fetch: s.fetch, sleep }), /feed UC1: HTTP 403$/);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(slept, []);
});

test('a 200 that is not an Atom feed still throws (not retried, not accepted)', async () => {
  const s = script(reply(200, '<html>consent</html>'));
  await assert.rejects(readFeed('UC1', { fetch: s.fetch, sleep }), /not an Atom feed/);
  assert.equal(s.calls.length, 1);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

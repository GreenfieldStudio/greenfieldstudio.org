#!/usr/bin/env node
/**
 * check-feed-soft.mjs — tests for the fail-soft path: a dead YouTube feed is a FeedUnavailableError (which
 * feedDown turns into exit 75), the streak counter, and that both sync tools exit 75 without touching files.
 *
 *   node tools/check-feed-soft.mjs      (no network: the sync tools get a stub fetch through a preload)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFeed, FeedUnavailableError, FEED_DOWN_EXIT } from './lib/youtube.mjs';
import { streak, classify, DOWN_STEP } from './feed-streak.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const reply = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const noSleep = async () => {};

test('a feed that stays 404 throws FeedUnavailableError', async () => {
  const w = console.warn; console.warn = () => {};
  try {
    await assert.rejects(readFeed('UC1', { fetch: async () => reply(404), sleep: noSleep }), (e) => e instanceof FeedUnavailableError);
  } finally { console.warn = w; }
});

test('permanent errors (403, a 200 that is not Atom) stay hard failures, not FeedUnavailableError', async () => {
  await assert.rejects(readFeed('UC1', { fetch: async () => reply(403), sleep: noSleep }), (e) => !(e instanceof FeedUnavailableError));
  await assert.rejects(readFeed('UC1', { fetch: async () => reply(200, '<html/>'), sleep: noSleep }), (e) => !(e instanceof FeedUnavailableError));
});

test('streak: first outage day is 1; counts earlier down runs; stops at ok; skips cancelled', () => {
  assert.equal(streak([]), 1);
  assert.equal(streak(['ok', 'down']), 1);
  assert.equal(streak(['down', 'ok', 'down']), 2);
  assert.equal(streak(['down', 'skip', 'down', 'ok']), 3);
  assert.equal(streak(['skip', 'skip']), 1);
});

test('classify: down only when the outage step ran; old runs and cancelled runs do not count as down', () => {
  const done = { status: 'completed', conclusion: 'success' };
  const jobs = (c) => [{ steps: [{ name: 'Checkout', conclusion: 'success' }, { name: DOWN_STEP, conclusion: c }] }];
  assert.equal(classify(done, jobs('success')), 'down');
  assert.equal(classify(done, jobs('failure')), 'down');
  assert.equal(classify(done, jobs('skipped')), 'ok');
  assert.equal(classify({ status: 'completed', conclusion: 'failure' }, [{ steps: [{ name: 'Checkout', conclusion: 'success' }] }]), 'ok');
  assert.equal(classify({ status: 'completed', conclusion: 'cancelled' }, jobs('success')), 'skip');
  assert.equal(classify({ status: 'in_progress', conclusion: null }, []), 'skip');
});

for (const tool of ['sync-ambience.mjs', 'sync-shorts.mjs']) {
  test(`${tool}: dead feed -> exit ${FEED_DOWN_EXIT}, a warning annotation, no file changed`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gs-feed-'));
    try {
      const pre = join(dir, 'down.mjs');
      writeFileSync(pre, 'globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => "" }); const t = globalThis.setTimeout; globalThis.setTimeout = (f) => t(f, 0);\n');
      const before = spawnSync('git', ['status', '--porcelain'], { cwd: here, encoding: 'utf8' }).stdout;
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, join(here, tool)], { encoding: 'utf8' });
      assert.equal(r.status, FEED_DOWN_EXIT, r.stderr);
      assert.match(r.stderr, /::warning title=YouTube feed unavailable::/);
      assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: here, encoding: 'utf8' }).stdout, before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

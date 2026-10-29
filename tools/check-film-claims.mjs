#!/usr/bin/env node
/**
 * check-film-claims.mjs — a film page may claim "No Loops" only for a film with a film_gate PASS row.
 *
 *   node tools/check-film-claims.mjs
 *
 * Studio rule (FILM-CLAIMS-REGISTER.md, rung L2): "No Loops" needs film_gate.py exit 0 on the exact
 * master (audio AND visual evidence), not the audio repeat check alone. tools/film-gate-pass.json lists
 * the film ids that have such a PASS row in the register; every active entry of tools/film-pages.json
 * must be on that list. No network, nothing written.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderFilmPage, gateCfg, passIdsNear } from './lib/film-pages.mjs';

const read = (n) => JSON.parse(readFileSync(fileURLToPath(new URL(n, import.meta.url)), 'utf8'));
const cfg = read('./film-pages.json');
const pass = new Set(read('./film-gate-pass.json').pass);
const active = Object.keys(cfg).filter((k) => !k.startsWith('_'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('every active film-pages.json entry has a film_gate PASS id', () => {
  const bad = active.filter((id) => !pass.has(id));
  assert.deepEqual(bad, [], `film-pages.json gives "loops: none" to ${bad.join(', ')} without a PASS row in KNOWLEDGE/FILM-CLAIMS-REGISTER.md (add the row and the id to tools/film-gate-pass.json first)`);
});

test('every PASS id is a real 11-character YouTube id', () => {
  for (const id of pass) assert.match(id, /^[A-Za-z0-9_-]{11}$/);
});

const film = { id: 'abcdefghijk', slug: 'x', title: 'Rain Cabin 3 Hours (No Loops)', published: '2026-10-01', seconds: 10800,
  description: 'Rain on the roof. No loops, so nothing repeats.\n\nNo music, no loops.' };

test('a page without a repeatCheck entry shows no loop claim', () => {
  const html = renderFilmPage(film, [], undefined);
  assert.ok(!/<dt>loops<\/dt>/.test(html));
  assert.ok(!/repeat check passed/.test(html));
  assert.ok(!/no loops/i.test(html.replace(/<!--[\s\S]*?-->/g, '')));
});

test('gateCfg drops a repeatCheck entry that is not on the PASS list, so the page has no claim', () => {
  const cfg = gateCfg({ [film.id]: { repeatCheck: '2026-10-01' } }, new Set());
  assert.deepEqual(cfg, {});
  const html = renderFilmPage(film, [], cfg[film.id]);
  assert.ok(!/<dt>loops<\/dt>/.test(html) && !/repeat check passed/.test(html));
});

test('gateCfg keeps the entry of a PASS film, and the page shows loops: none', () => {
  const cfg = gateCfg({ [film.id]: { repeatCheck: '2026-10-01' } }, new Set([film.id]));
  assert.ok(/<dt>loops<\/dt>/.test(renderFilmPage(film, [], cfg[film.id])));
});

test('passIdsNear reads film-gate-pass.json next to the config', () => {
  assert.deepEqual([...passIdsNear(fileURLToPath(new URL('./film-pages.json', import.meta.url)))], [...pass]);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * check-film-links.mjs — every generated film page carries ONE onward link to its world's page
 * (Cabin films → /licensing/, reef films → /wallpapers/#reef, castle films → /wallpapers/#castle), and
 * only to a page and an anchor that exist. The licensing page lists every Cabin film.
 *
 *   node tools/check-film-links.mjs
 *
 * No network, nothing written.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFilmPage, worldLink, WORLD_LINKS } from './lib/film-pages.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const db = JSON.parse(readFileSync(join(ROOT, 'assets/media/ambience/films/films.json'), 'utf8'));
const films = db.films.filter((f) => f.slug);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const arrows = (html) => [...html.matchAll(/<a class="link-arrow" href="([^"]*)">([^<]*)<\/a>/g)].map((m) => ({ href: m[1], text: m[2] }));
// the film page lives at /ambience/<slug>/, so '../../x/' is /x/
const target = (href) => { const [p, hash] = href.split('#'); return { file: join(ROOT, p.replace(/^(\.\.\/)+/, ''), 'index.html'), hash }; };

test('there are film pages to check', () => assert.ok(films.length >= 9, `only ${films.length} films`));

test('every film in films.json gets exactly one world link, besides the two "all films" links', () => {
  for (const f of films) {
    const html = renderFilmPage(f, [], undefined);
    const extra = arrows(html).filter((a) => a.href !== '../');
    assert.equal(extra.length, worldLink(f) ? 1 : 0, `${f.slug}: ${JSON.stringify(extra)}`);
  }
});

test('the world of each live film is the expected one (fixture of the 11 films on main)', () => {
  const want = {
    'cozy-halloween-cabin-ambience': 'cabin', 'cozy-halloween-cabin-sleep': 'cabin', 'christmas-cabin-ambience': 'cabin',
    'coral-reef-aquarium': 'reef', 'sunlit-coral-reef': 'reef', 'moonlit-aquarium': 'reef', 'haunted-coral-reef': 'reef',
    'clownfish-hideaway-anemone-aquarium': 'reef', '8-hours-coral-reef-at-night-for-sleep': 'reef',
    'dragon-over-the-enchanted-castle': 'castle', 'castle-at-night-for-sleep': 'castle',
  };
  for (const f of films) if (want[f.slug]) assert.equal(worldLink(f)?.world, want[f.slug], f.slug);
});

test('a film of no known world gets no extra link', () => {
  const f = { id: 'abcdefghijk', slug: 'meadow-at-dawn', title: 'Meadow at Dawn 4K | 1 Hour (No Music)', published: '2026-11-01', seconds: 3600, description: 'A meadow.' };
  assert.equal(worldLink(f), null);
  assert.ok(!/wallpapers\/|licensing\//.test(renderFilmPage(f, [], undefined).split('<footer')[0]));
});

test('every link target is a page on this site and every anchor in it exists', () => {
  for (const w of WORLD_LINKS) {
    const { file, hash } = target(w.href);
    assert.ok(existsSync(file), `${w.world}: ${w.href} -> ${file} does not exist`);
    if (hash) assert.ok(new RegExp(`id="${hash}"`).test(readFileSync(file, 'utf8')), `${w.world}: no id="${hash}" in ${file}`);
  }
});

test('link text makes no loop claim, names no store that is not live, and says "coming" for a wallpaper that is not out', () => {
  for (const w of WORLD_LINKS) {
    assert.ok(!/loop|repeat|itch|gumroad/i.test(w.text), w.text);
    if (w.href.includes('wallpapers')) assert.match(w.text, /coming/);
  }
});

test('the committed film pages match the generator (a stale page fails here, not only in sync-ambience --check)', () => {
  for (const f of films) {
    const p = join(ROOT, 'ambience', f.slug, 'index.html');
    const w = worldLink(f);
    const html = readFileSync(p, 'utf8');
    if (w) assert.ok(html.includes(`<a class="link-arrow" href="${w.href}">`), `${f.slug}: page lacks ${w.href}`);
    else assert.ok(!/href="\.\.\/\.\.\/(?:wallpapers|licensing)\/"/.test(html.split('<footer')[0]), f.slug);
  }
});

test('the licensing page lists every Cabin film, with a link to its page', () => {
  const lic = readFileSync(join(ROOT, 'licensing/index.html'), 'utf8');
  const cabin = films.filter((f) => worldLink(f)?.world === 'cabin');
  assert.ok(cabin.length >= 3, `cabin films: ${cabin.map((f) => f.slug)}`);
  for (const f of cabin) assert.ok(lic.includes(`<a class="link-arrow" href="../ambience/${f.slug}/">`), `licensing page does not list ${f.slug}`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

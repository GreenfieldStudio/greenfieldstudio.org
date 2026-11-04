#!/usr/bin/env node
/**
 * check-seo.mjs — what a search crawler reads: the sitemap, the film descriptions and the structured data.
 *
 *   node tools/check-seo.mjs
 *
 * Offline, nothing written. Covers: sitemap dates are real (valid, not in the future, the pages that list
 * the films are at least as new as the newest film); no film meta description is cut off with "…";
 * every film page's VideoObject has what Google's video result needs (name, description, thumbnail that
 * exists, upload date, duration, embed URL, page URL = canonical); the Licensing page carries a WebPage
 * and a contact point that match its visible text and the public address; every JSON-LD block parses.
 * Google's own Rich Results test is the final word and needs the live URL: run it after the merge.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metaDescription, bumpLastmod } from './lib/film-pages.mjs';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(SITE, p), 'utf8');
const MAIL = 'greenfieldstudiodev@gmail.com';
const GENERATED_ELSEWHERE = new Set(['/play/']); // the game is copied in at deploy time (tools/sync-game.mjs), not kept in git

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const nodes = (html) => ldBlocks(html).flatMap((b) => (b['@graph'] ? b['@graph'] : [b]));
const meta = (html, name) => (new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html) || [])[1];
const canonical = (html) => (/<link rel="canonical" href="([^"]+)"/.exec(html) || [])[1];

const sitemap = read('sitemap.xml');
// one entry per <url>, so a URL with no <lastmod> shows up as an empty date and fails the date test
const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({ loc: (/<loc>([^<]+)<\/loc>/.exec(m[1]) || [])[1], lastmod: (/<lastmod>([^<]*)<\/lastmod>/.exec(m[1]) || [])[1] || '' }));
const films = JSON.parse(read('assets/media/ambience/films/films.json')).films.filter((f) => f.slug);

// ---- sitemap
test('every sitemap URL has a real lastmod (valid date, not in the future)', () => {
  assert.ok(entries.length >= 20, `only ${entries.length} URLs read`);
  // one day of slack: the studio stamps dates in GMT+7, which is ahead of UTC for 7 hours a day
  const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const e of entries) {
    assert.match(e.lastmod, /^\d{4}-\d{2}-\d{2}$/, `${e.loc}: lastmod "${e.lastmod}"`);
    assert.ok(!Number.isNaN(Date.parse(e.lastmod)) && new Date(e.lastmod).toISOString().slice(0, 10) === e.lastmod, `${e.loc}: ${e.lastmod} is not a calendar date`);
    assert.ok(e.lastmod <= today, `${e.loc}: lastmod ${e.lastmod} is in the future`);
  }
});

test('every sitemap URL is a page of this repo, once', () => {
  const seen = new Set();
  for (const e of entries) {
    assert.ok(!seen.has(e.loc), `${e.loc} is listed twice`);
    seen.add(e.loc);
    const path = e.loc.replace('https://greenfieldstudio.org', '');
    if (GENERATED_ELSEWHERE.has(path)) continue;
    assert.ok(existsSync(join(SITE, path, 'index.html')), `${e.loc} has no ${path}index.html`);
  }
});

test('the home page and the Ambience hub are at least as new as the newest film', () => {
  const newest = films.map((f) => f.published).sort().pop();
  for (const loc of ['https://greenfieldstudio.org/', 'https://greenfieldstudio.org/ambience/']) {
    const e = entries.find((x) => x.loc === loc);
    assert.ok(e && e.lastmod >= newest, `${loc} lastmod ${e && e.lastmod} is older than the newest film (${newest})`);
  }
});

test('bumpLastmod raises a date, never lowers it, ignores an unknown URL', () => {
  const xml = '<url><loc>https://x.org/a/</loc><lastmod>2026-10-17</lastmod></url>';
  assert.match(bumpLastmod(xml, 'https://x.org/a/', '2026-10-31'), /<lastmod>2026-10-31</);
  assert.equal(bumpLastmod(xml, 'https://x.org/a/', '2026-10-01'), xml);
  assert.equal(bumpLastmod(xml, 'https://x.org/b/', '2026-10-31'), xml);
});

// ---- descriptions
test('metaDescription: short text stays, long text ends on a whole sentence, never mid-sentence', () => {
  assert.equal(metaDescription('One hour of rain. No music.'), 'One hour of rain. No music.');
  const long = 'A cozy cabin on a stormy night. No music. Rain patters on the roof and runs down the windows, thunder rolls over the mountains, and the fire crackles and sends up sparks. A black cat sleeps on the sheepskin by the hearth, until the thunder wakes her, or something drifts past the window.';
  const out = metaDescription(long);
  assert.ok(out.length <= 250 && /[.!?]$/.test(out) && !out.includes('…'), out);
  assert.ok(out.endsWith('sends up sparks.'), out);
  // a short opening plus one long sentence is kept whole rather than shrunk to the stub (the clownfish page)
  const stub = 'A quiet hour with a family of clownfish and their two anemones. No music. Clownfish weave in and out of the purple-tipped anemones while a lionfish and other reef fish drift past, with kelp, rocks and sunlight rippling on the sand. One fixed view, a full hour, in 4K 60fps.';
  assert.ok(metaDescription(stub).endsWith('on the sand.'), metaDescription(stub));
});

test('metaDescription: an unfinished tail never replaces the last whole sentence', () => {
  const out = metaDescription(`A quiet cabin. ${'rain '.repeat(35)}`);
  assert.equal(out, 'A quiet cabin.');
});

test('metaDescription: a first sentence that is too long falls back to the word clip', () => {
  const one = `${'word '.repeat(60)}end.`;
  const out = metaDescription(one);
  assert.ok(out.endsWith('…') && out.length <= 158, out.slice(-20));
});

test('no film page has a meta or share description cut off with an ellipsis', () => {
  for (const f of films) {
    const html = read(`ambience/${f.slug}/index.html`);
    for (const d of [meta(html, 'description'), (/<meta property="og:description" content="([^"]*)"/.exec(html) || [])[1]]) {
      assert.ok(d && d.length >= 90, `${f.slug}: description missing or a stub (${d && d.length} characters)`);
      assert.ok(!/…$|\.\.\.$/.test(d), `${f.slug}: description is cut off: "${d.slice(-40)}"`);
    }
  }
});

// ---- structured data
test('every JSON-LD block on every page parses', () => {
  let n = 0;
  const walk = (dir) => {
    for (const e of readdirSync(join(SITE, dir), { withFileTypes: true })) {
      if (e.isDirectory()) { if (!['assets', 'node_modules', 'tools', '.git', 'drafts'].includes(e.name)) walk(join(dir, e.name)); continue; }
      if (e.name !== 'index.html') continue;
      const html = read(join(dir, e.name));
      try { n += ldBlocks(html).length; } catch (err) { assert.fail(`${join(dir, e.name)}: ${err.message}`); }
    }
  };
  walk('.');
  assert.ok(n > 0, 'no JSON-LD block found at all');
});

test('every film page has a complete VideoObject', () => {
  for (const f of films) {
    const html = read(`ambience/${f.slug}/index.html`);
    const v = nodes(html).find((x) => x['@type'] === 'VideoObject');
    assert.ok(v, `${f.slug}: no VideoObject`);
    assert.ok(v.name && v.name.length > 3, `${f.slug}: name`);
    assert.ok(v.description && v.description.length > 20, `${f.slug}: description`);
    assert.match(v.uploadDate, /^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/, `${f.slug}: uploadDate`);
    assert.match(v.duration || '', /^PT\d+H\d+M\d+S$/, `${f.slug}: duration`);
    assert.equal(v.embedUrl, `https://www.youtube-nocookie.com/embed/${f.id}`, `${f.slug}: embedUrl`);
    assert.equal(v.url, canonical(html), `${f.slug}: url differs from the canonical`);
    const thumb = v.thumbnailUrl.replace('https://greenfieldstudio.org/', '');
    assert.ok(thumb.startsWith('assets/media/ambience/films/') && existsSync(join(SITE, thumb)), `${f.slug}: thumbnail ${v.thumbnailUrl} is not a file of this site`);
  }
});

test('the Licensing page has a WebPage and a contact point that match its text', () => {
  const html = read('licensing/index.html');
  const g = nodes(html);
  const page = g.find((x) => x['@type'] === 'WebPage');
  assert.ok(page, 'no WebPage');
  assert.equal(page.url, canonical(html));
  assert.equal(page.description, meta(html, 'description').replace(/&amp;/g, '&'), 'description differs from the meta description');
  const org = g.find((x) => x['@type'] === 'Organization');
  assert.ok(org && org.contactPoint, 'no Organization contactPoint');
  assert.equal(org.contactPoint.email, MAIL);
  assert.ok(html.includes(`mailto:${MAIL}`), 'the address in the markup must also be on the page');
  // the page makes no price or licence-term promise, so its data must not either
  assert.ok(!g.some((x) => ['Offer', 'Product', 'Service'].includes(x['@type']) || x.offers || x.priceRange), 'structured data must not state prices or terms');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

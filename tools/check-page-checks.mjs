#!/usr/bin/env node
// Tests for tools/lib/page-checks.mjs (the share-tag and keyboard-scroll checks of audit.mjs):
// made-up heads for the share tags, small pages in headless Chromium (CPU only) for the scroll boxes.
import { loadPlaywright } from './lib/playwright.mjs';
import { shareProblems, onBase, findStuckScrollers, SITE_URL } from './lib/page-checks.mjs';

let bad = 0;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

// ── share tags ───────────────────────────────────────────────────────────────
const head = (path, over = {}) => ({ canonical: SITE_URL + path, ogUrl: SITE_URL + path, noShare: [], path, ...over });
expect('a complete head passes', shareProblems(head('journal/level-editor/')), []);
expect('the home page passes', shareProblems(head('')), []);
expect('no canonical', shareProblems(head('privacy/', { canonical: '', ogUrl: '' })), ['no canonical link']);
// a new post copied from another keeps the old page's canonical and og:url: they match each other but not the page
expect('copied head names another page',
  shareProblems(head('journal/new-post/', { canonical: SITE_URL + 'journal/level-editor/', ogUrl: SITE_URL + 'journal/level-editor/' })),
  [`canonical ${SITE_URL}journal/level-editor/ is not this page (${SITE_URL}journal/new-post/)`]);
// a missing tag must not hide a wrong og:url
expect('missing og:image and wrong og:url both reported',
  shareProblems(head('privacy/', { noShare: ['og:image'], ogUrl: SITE_URL + 'press/' })),
  ['share tags missing: og:image', `og:url ${SITE_URL}press/ differs from canonical ${SITE_URL}privacy/`]);
expect('og:image on the local base', onBase(SITE_URL + 'assets/img/og-studio.jpg', 'http://localhost:5600/sub/'), 'http://localhost:5600/sub/assets/img/og-studio.jpg');
expect('og:image elsewhere is left alone', onBase('https://cdn.example/x.jpg', 'http://localhost:5600/'), 'https://cdn.example/x.jpg');

// ── scroll boxes ─────────────────────────────────────────────────────────────
const wide = '<code style="white-space:pre">' + 'x'.repeat(400) + '</code>';
const tall = 'line<br>'.repeat(60);
const cases = [
  ['a <pre> that scrolls sideways', `<pre style="overflow-x:auto;width:200px">${wide}</pre>`, ['pre']],
  ['the same with tabindex="0"', `<pre tabindex="0" style="overflow-x:auto;width:200px">${wide}</pre>`, []],
  // scrollable by a CSS class, not a <pre>, not an inline style: the first version of the check missed it
  ['a div made scrollable by a CSS class', `<style>.term{overflow-x:auto;width:200px}</style><div class="term spec">${wide}</div>`, ['div.term']],
  ['a box that scrolls up and down', `<div class="log" style="max-height:80px;overflow-y:auto">${tall}</div>`, ['div.log']],
  ['a box holding a link', `<div style="overflow-x:auto;width:200px">${wide}<a href="#x">x</a></div>`, []],
  ['a box whose only focusable child has tabindex="-1"', `<div style="overflow-x:auto;width:200px">${wide}<span tabindex="-1">x</span></div>`, ['div']],
  ['clipped overflow is not a scroll box', `<div style="overflow:hidden;width:200px">${wide}</div>`, []],
  // an SVG element's className is not a string: labelling it once threw and stopped the whole audit
  ['an SVG that scrolls', `<svg class="chart" width="100" height="50" style="display:block;overflow:auto"><text x="0" y="20">${'x'.repeat(200)}</text></svg>`, null],
  ['a class list that starts with a space is labelled by its class', `<pre class=" terminal" style="overflow-x:auto;width:200px">${wide}</pre>`, ['pre.terminal']],
  ['a long page is not a scroll box', `<p>${tall}</p>`, []],
];
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--disable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
  for (const [name, html, want] of cases) {
    await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
    let got;
    try { got = await page.evaluate(findStuckScrollers); } catch (e) { got = `threw: ${e.message.split('\n')[0]}`; }
    if (want === null) { if (typeof got === 'string') expect(name, got, 'no exception'); } else expect(name, got, want);
  }
} finally {
  await browser.close();
}

if (bad) { console.error(`${bad} page-check test(s) failed`); process.exit(1); }
console.log('page checks OK');

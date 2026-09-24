#!/usr/bin/env node
/**
 * sync-chrome.mjs — writes the shared main menu and footer into every page from ONE template.
 *
 *   node tools/sync-chrome.mjs           # rewrite the pages
 *   node tools/sync-chrome.mjs --check   # exit 1 if any page is out of date (the audit runs this)
 *
 * The site has no build step, so the header menu and the footer are real HTML in each page.
 * This keeps them identical: each page's `<nav class="nav" …>…</nav>` and
 * `<footer class="site-footer">…</footer>` are replaced wholesale, with paths made relative to
 * the page (404.html uses root-absolute ones, because Pages serves it at any depth) and
 * aria-current on the page's own section. Add a new page to PAGES.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictOptions } from './lib/args.mjs';

strictOptions(['check']);
const CHECK = process.argv.includes('--check');
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// file → [prefix to the site root, section it belongs to]
const PAGES = [
  ['index.html', '', 'home'],
  ['minigolf-pro/index.html', '../', 'minigolf-pro'],
  ['ambience/index.html', '../', 'ambience'],
  ['journal/index.html', '../', 'journal'],
  ['journal/level-critic/index.html', '../../', 'journal'],
  ['press/index.html', '../', 'press'],
  ['privacy/index.html', '../', 'privacy'],
  ['404.html', '/', 'none'],
];

const YT_STUDIO = 'https://www.youtube.com/@Greenfield.Studio';
const YT_AMBIENCE = 'https://www.youtube.com/@Greenfield.Ambience';
const ITCH = 'https://greenfieldstudio.itch.io';

const ICON = {
  youtube: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.2" y="3.2" width="13.6" height="9.6" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.6 5.9v4.2L10.2 8z" fill="currentColor"/></svg>',
  itch: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 5.5 3.4 2.5h9.2L14 5.5v1.2a1.6 1.6 0 0 1-3 .8 1.6 1.6 0 0 1-3 0 1.6 1.6 0 0 1-3 0 1.6 1.6 0 0 1-3-.8z"/><path d="M3 7.8v5.7h10V7.8"/><path d="M6.6 13.5v-3h2.8v3"/></svg>',
};
const MARK = '<svg viewBox="0 0 38 22" aria-hidden="true" focusable="false"><circle cx="4.5" cy="17" r="3.6" fill="#efe8d6"/><circle cx="11" cy="9.2" r="1.1" fill="#a19b8a"/><circle cx="16.8" cy="5.4" r="1.1" fill="#a19b8a"/><circle cx="23" cy="5.2" r="1.1" fill="#a19b8a"/><circle cx="28.4" cy="9" r="1.1" fill="#a19b8a"/><circle cx="32.5" cy="17" r="4.3" fill="#050b07" stroke="#efe8d6" stroke-width="1.4"/></svg>';

function nav(p, section) {
  const home = section === 'home';
  const cur = (s) => (s === section ? ' aria-current="page"' : '');
  return `<nav class="nav" aria-label="Main">
        <a href="${p}minigolf-pro/"${cur('minigolf-pro')}>Minigolf Pro</a>
        <a href="${p}ambience/"${cur('ambience')}>Ambience</a>
        <a href="${p}journal/"${cur('journal')}>Journal</a>
        <a href="${p}press/"${cur('press')}>Press</a>
        <a class="nav-wide" href="${home ? '' : p}#studio">Studio</a>
        <a class="nav-wide" href="${home ? '' : p}#contact">Contact</a>
      </nav>`;
}

function footer(p) {
  const root = p === '' ? './' : p;
  const ext = (href, icon, label) => `<li><a href="${href}" rel="noopener me">${ICON[icon]}${label}</a></li>`;
  return `<footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="brand" href="${root}" aria-label="Greenfield Studio, home">
            ${MARK}
            <span class="brand-name">Greenfield Studio</span>
          </a>
          <p>Small physics games and calm 3D worlds, made patiently.</p>
          <p><a class="footer-mail" href="mailto:hello@greenfieldstudio.org">hello@greenfieldstudio.org</a></p>
        </div>
        <div class="footer-col">
          <p class="footer-h">work</p>
          <ul>
            <li><a href="${p}minigolf-pro/">Minigolf Pro</a></li>
            <li><a href="${p}ambience/">Greenfield Ambience</a></li>
            <li><a href="${p}journal/">Journal</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <p class="footer-h">studio</p>
          <ul>
            <li><a href="${root}#studio">About</a></li>
            <li><a href="${p}press/">Press kit</a></li>
            <li><a href="${root}#contact">Contact</a></li>
            <li><a href="${p}privacy/">Privacy</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <p class="footer-h">follow</p>
          <ul class="footer-social">
            ${ext(YT_STUDIO, 'youtube', 'Greenfield Studio')}
            ${ext(YT_AMBIENCE, 'youtube', 'Greenfield Ambience')}
            ${ext(ITCH, 'itch', 'itch.io')}
          </ul>
        </div>
      </div>
      <div class="ruler" aria-hidden="true">
        <span><em>meadow</em></span><span><em>tropical</em></span><span><em>mountain</em></span><span><em>ruins</em></span><span><em>space</em></span><span><em>neon</em></span><span><em>candy</em></span><span><em>arctic</em></span>
      </div>
      <p class="footer-note">© 2026 Greenfield Studio</p>
    </div>
  </footer>`;
}

let stale = 0;
for (const [file, prefix, section] of PAGES) {
  const path = join(SITE, file);
  const before = readFileSync(path, 'utf8');
  const navRe = /<nav class="nav" aria-label="Main">[\s\S]*?<\/nav>/;
  const footRe = /<footer class="site-footer">[\s\S]*?<\/footer>/;
  if (!navRe.test(before) || !footRe.test(before)) throw new Error(`${file}: no main nav or footer to replace`);
  // write in the file's own line endings (a Windows checkout is CRLF), and compare without them
  const eol = /\r\n/.test(before) ? '\r\n' : '\n';
  const fit = (s) => s.replace(/\r?\n/g, eol);
  const after = before.replace(navRe, fit(nav(prefix, section))).replace(footRe, fit(footer(prefix)));
  if (after.replace(/\r/g, '') === before.replace(/\r/g, '')) continue;
  stale++;
  if (CHECK) console.error(`out of date: ${file}`);
  else writeFileSync(path, after);
}
if (CHECK && stale) { console.error('run: node tools/sync-chrome.mjs'); process.exit(1); }
console.log(CHECK ? 'menus and footers are in sync' : `sync-chrome: ${stale} page(s) updated`);

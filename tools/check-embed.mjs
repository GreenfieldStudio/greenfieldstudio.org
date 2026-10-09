// check-embed.mjs: the film page's click-to-load player, tested WITHOUT a browser. Every film page is parsed
// with jsdom and assets/js/site.js is run against it. Run by `npm run audit`. No network, no GPU.
//   before a click: no iframe, nothing from YouTube in any src (only plain links), poster + fallback link present
//   after a click:  one privacy-enhanced iframe (youtube-nocookie.com/embed/<id>), started by the click, no extras
//   modified click: stays a plain link to YouTube (new tab); chapter link: same player, started at the chapter
// Needs jsdom: installed here, else borrowed from the Minigolf Pro checkout (override: JSDOM_PATH=<.../jsdom/lib/api.js>).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function loadJsdom() {
  try { return await import('jsdom'); } catch (_) {}
  for (const p of [process.env.JSDOM_PATH, join(SITE, '..', 'minigolf-pro', 'node_modules', 'jsdom', 'lib', 'api.js')].filter(Boolean)) {
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error('jsdom not found. Set JSDOM_PATH or `npm i -D jsdom`.');
}
const { JSDOM, VirtualConsole } = await loadJsdom();

const films = JSON.parse(readFileSync(join(SITE, 'assets/media/ambience/films/films.json'), 'utf8')).films.filter((f) => f.slug);
const js = readFileSync(join(SITE, 'assets/js/site.js'), 'utf8');
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
let pages = 0;
const open = (html, url) => {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  dom.window.Element.prototype.scrollIntoView = () => {};
  return dom;
};
const click = (w, opts) => new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...opts });

for (const f of films) {
  const where = `ambience/${f.slug}`;
  const url = `https://greenfieldstudio.org/ambience/${f.slug}/`;
  const html = readFileSync(join(SITE, 'ambience', f.slug, 'index.html'), 'utf8');
  const dom = open(html, url);
  const { window } = dom;
  const { document } = window;
  pages++;

  // static page, as a visitor without JavaScript (or before it runs) sees it
  if (document.querySelector('iframe')) fail(where, 'an iframe is in the page before any click');
  if (document.querySelector('video[autoplay], audio[autoplay]')) fail(where, 'autoplaying media in the page');
  for (const el of document.querySelectorAll('[src],[srcset],link[href]')) {
    const v = el.getAttribute('src') || el.getAttribute('srcset') || el.getAttribute('href') || '';
    if (/^https?:/i.test(v) && !/^https:\/\/greenfieldstudio\.org\//.test(v)) fail(where, `${el.tagName.toLowerCase()} loads ${v} by itself`);
  }
  const embed = document.querySelector('a[data-embed]');
  if (!embed) { fail(where, 'no a[data-embed] poster link'); continue; }
  if (embed.dataset.embed !== f.id) fail(where, `data-embed ${embed.dataset.embed} is not the film id ${f.id}`);
  if (!/^[A-Za-z0-9_-]{11}$/.test(embed.dataset.embed)) fail(where, 'embed id is not an 11-character YouTube id');
  if (embed.getAttribute('href') !== `https://www.youtube.com/watch?v=${f.id}`) fail(where, `fallback href is ${embed.getAttribute('href')}`);
  const poster = embed.querySelector('img');
  if (!poster || !/^\.\.\/\.\.\/assets\/media\//.test(poster.getAttribute('src'))) fail(where, 'poster image is not served from this site');
  else if (!existsSync(join(SITE, 'ambience', f.slug, poster.getAttribute('src')))) fail(where, `poster file missing: ${poster.getAttribute('src')}`);
  if (!/^Play the film: /.test(embed.getAttribute('aria-label') || '')) fail(where, 'poster link has no action name');
  if (!embed.querySelector('.film-play')) fail(where, 'no play disc on the poster');
  if (![...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Watch on YouTube' && a.href === `https://www.youtube.com/watch?v=${f.id}`)) fail(where, 'no separate "Watch on YouTube" fallback link');
  const chapters = [...document.querySelectorAll('.chapters a[data-start]')];
  for (const a of chapters) if (!/[?&]t=\d+s$/.test(a.getAttribute('href')) || !/^\d+$/.test(a.dataset.start)) fail(where, `chapter link ${a.getAttribute('href')} is not a plain timed YouTube link`);

  // run the page's script, then click
  window.eval(js);
  if (document.querySelector('iframe')) fail(where, 'the script created an iframe without a click');
  const ctrl = click(window, { ctrlKey: true });
  embed.dispatchEvent(ctrl);
  if (ctrl.defaultPrevented || document.querySelector('iframe')) fail(where, 'a ctrl-click (new tab) was hijacked');
  const mid = click(window, { button: 1 });
  embed.dispatchEvent(mid);
  if (mid.defaultPrevented || document.querySelector('iframe')) fail(where, 'a middle-click was hijacked');

  const plain = click(window);
  embed.dispatchEvent(plain);
  const frames = document.querySelectorAll('iframe');
  if (!plain.defaultPrevented) fail(where, 'the click was not taken over (the page would navigate away)');
  if (frames.length !== 1) { fail(where, `${frames.length} iframes after a click`); continue; }
  const fr = frames[0];
  const u = new URL(fr.src);
  if (u.origin !== 'https://www.youtube-nocookie.com' || u.pathname !== `/embed/${f.id}`) fail(where, `player src is ${fr.src}`);
  if (u.searchParams.get('autoplay') !== '1') fail(where, 'the click did not start playback (autoplay=1 is expected after a click only)');
  if (u.searchParams.get('rel') !== '0') fail(where, 'related videos not limited (rel=0)');
  if (u.searchParams.has('start')) fail(where, 'a poster click should start at 0');
  if ([...u.searchParams.keys()].some((k) => !['autoplay', 'rel', 'playsinline', 'start'].includes(k))) fail(where, `unexpected player parameter in ${u.search}`);
  if (!fr.title || !fr.hasAttribute('allowfullscreen') || fr.referrerPolicy !== 'strict-origin-when-cross-origin') fail(where, 'iframe title, fullscreen or referrer policy missing');
  if (embed.hasAttribute('href') || embed.hasAttribute('aria-label')) fail(where, 'the frame is still labelled as a link');
  if (document.activeElement !== fr) fail(where, 'keyboard focus did not move into the player');
  embed.dispatchEvent(click(window));
  if (document.querySelectorAll('iframe').length !== 1) fail(where, 'a second click added another player');

  // a chapter link, on a fresh copy of the page, starts the same player at that moment
  if (chapters.length) {
    const d2 = open(html, url);
    d2.window.eval(js);
    const a = d2.window.document.querySelectorAll('.chapters a[data-start]')[1] || d2.window.document.querySelector('.chapters a[data-start]');
    a.dispatchEvent(click(d2.window));
    const fr2 = d2.window.document.querySelector('iframe');
    const want = Number(a.dataset.start);
    if (!fr2) fail(where, 'chapter click did not open the player');
    else if (new URL(fr2.src).searchParams.get('start') !== (want ? String(want) : null)) fail(where, `chapter start is ${new URL(fr2.src).searchParams.get('start')}, wanted ${want}`);
  }
}

if (!pages) problems.push('no film pages found');
if (problems.length) { console.error(`check-embed: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`check-embed: ${pages} film pages OK (no iframe or YouTube request before a click; youtube-nocookie.com player after; modified clicks and chapters behave)`);

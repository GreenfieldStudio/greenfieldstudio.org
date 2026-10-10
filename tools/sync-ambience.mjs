#!/usr/bin/env node
/**
 * sync-ambience.mjs — list Greenfield Ambience's public films on /ambience/.
 *
 *   node tools/sync-ambience.mjs            # read the channel's public feed, then rewrite the page
 *   node tools/sync-ambience.mjs --offline  # rewrite the page from assets/media/ambience/films/films.json only
 *   node tools/sync-ambience.mjs --check    # offline; exit 1 if the page differs from films.json (the audit runs this)
 *
 * Reads the channel's public Atom feed (no API key; it lists public videos only, so an unlisted or
 * processing upload stays off the site by itself), self-hosts each film's thumbnail as WebP (so the
 * page requests nothing from YouTube until a film is played), reads its length from the watch page,
 * and records all of it in films.json. Then it rewrites the block between `<!-- films:start -->` /
 * `<!-- films:end -->` in ambience/index.html and the VideoObject data between
 * `<!-- films-ld:start -->` / `-end -->`. The daily GitHub Action (.github/workflows/videos.yml)
 * runs this, so a film shows up on the site by itself; run it by hand to see the result sooner.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictOptions } from './lib/args.mjs';
import { readFeed, webp, lengthSeconds, isGone, pruneThumbs, esc, clock, matchEol } from './lib/youtube.mjs';
import { displayTitle, ensureSlugs, secondsOf, syncFilmPages, softenTitle, firstLine, ownText } from './lib/film-pages.mjs';
import { spawnSync } from 'node:child_process';
import { signupSection, privacyBlock, privacyDate } from './signup.mjs';

strictOptions(['offline', 'check']);
const CHECK = process.argv.includes('--check');
const OFFLINE = CHECK || process.argv.includes('--offline');
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL_ID = 'UCelrQ1cVscJobF_mzsRv8_w';
const CHANNEL = 'https://www.youtube.com/@Greenfield.Ambience';
const DIR = join(SITE, 'assets', 'media', 'ambience', 'films');
const DB = join(DIR, 'films.json');
const PAGE = join(SITE, 'ambience', 'index.html');
const PRIVACY = join(SITE, 'privacy', 'index.html');
const CFG = join(SITE, 'tools', 'film-pages.json'); // hand-written: per-film facts a description can't prove (the repeat check)

mkdirSync(DIR, { recursive: true });
const db = existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf8')) : { films: [] };
const scale = (w) => `scale=${w}:-2:flags=lanczos`;
const slugsAdded = ensureSlugs(db); // a film's slug is set once and never changes: it is its page's address

if (!OFFLINE) {
  // A Short on this channel is not a film: this list is the long-form ones.
  const entries = (await readFeed(CHANNEL_ID)).filter((f) => !f.short);
  // An empty feed is far more likely a bad response than every film having been removed.
  if (!entries.length && db.films.length) throw new Error('the feed listed no films; refusing to empty the page');

  for (const f of entries) {
    const known = db.films.find((k) => k.id === f.id) || {};
    const film = { ...known, ...f };
    delete film.short;
    // thumbnails: the largest YouTube has, self-hosted in two sizes
    if (!existsSync(join(DIR, `${f.id}-1280.webp`))) {
      let ok = false;
      for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
        const src = `https://i.ytimg.com/vi/${f.id}/${name}.jpg`;
        if (await webp(src, join(DIR, `${f.id}-1280.webp`), scale(1280)) && await webp(src, join(DIR, `${f.id}-640.webp`), scale(640))) { ok = true; break; }
      }
      if (!ok) throw new Error(`no thumbnail for ${f.id}`);
    }
    // length: not in the feed. If the watch page can't be read, the card goes up without one and
    // the next run tries again.
    if (!film.seconds) {
      const s = await lengthSeconds(f.id);
      if (s) film.seconds = s;
    }
    db.films = db.films.filter((k) => k.id !== f.id).concat(film);
  }
  // The feed only reaches back ~15 videos, so a film missing from it is not necessarily gone. Ask
  // YouTube about each one before it leaves the site (made private or deleted); otherwise it stays.
  for (const k of db.films.filter((k) => !entries.some((f) => f.id === k.id))) {
    if (await isGone(k.id)) { console.log(`sync-ambience: ${k.id} is no longer public; removing it`); db.films = db.films.filter((x) => x.id !== k.id); }
  }
  pruneThumbs(DIR, [...db.films.map((f) => f.id), 'coming-reef']); // coming-reef-*.webp is the no-film placeholder
  ensureSlugs(db); // a film the feed just brought in has no slug yet: without this its card links to "undefined/"
  db.films.sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
  writeFileSync(DB, JSON.stringify(db, null, 2) + '\n');
} else if (!CHECK && slugsAdded) {
  writeFileSync(DB, JSON.stringify(db, null, 2) + '\n'); // --offline still records new slugs
}

// Only what the film's own description states: "4K" and the frame rate.
// (ownText: never from a line that links to another film)
const specOf = (f) => {
  const d = ownText(f);
  const out = [];
  if (/3840\s*[×x]\s*2160|\b4K\b/i.test(d)) out.push('4K');
  const fps = /(\d{2,3})\s*(?:fps|frames per second)/i.exec(d);
  if (fps) out.push(`${fps[1]} fps`);
  return out;
};
const length = (s) => (s < 5400 ? `${Math.round(s / 60)} min` : `${String(+(s / 3600).toFixed(1))} h`);
const iso = (s) => `PT${Math.floor(s / 3600)}H${Math.floor((s % 3600) / 60)}M${s % 60}S`;
const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 2.6v10.8l8.8-5.4z" fill="currentColor"/></svg>';

let block;
if (db.films.length) {
  block = `<div class="films${db.films.length === 1 ? ' films--featured' : ''}" style="margin-top:32px">\n${db.films.map((f) => `          <a class="film" href="${f.slug}/">
            <span class="film-media">
              <img src="../assets/media/ambience/films/${f.id}-640.webp" srcset="../assets/media/ambience/films/${f.id}-640.webp 640w, ../assets/media/ambience/films/${f.id}-1280.webp 1280w" sizes="(max-width: 520px) 100vw, (max-width: 860px) 50vw, 380px" width="1280" height="720" loading="lazy" decoding="async" alt="">
              <span class="film-play" aria-hidden="true"><span class="play-disc">${PLAY}</span></span>${secondsOf(f) ? `\n              <span class="film-len">${clock(secondsOf(f))}</span>` : ''}
            </span>
            <h3>${esc(displayTitle(f))}</h3>
            <span class="anno">${[secondsOf(f) ? length(secondsOf(f)) : '', ...specOf(f), 'watch'].filter(Boolean).join(' · ')}</span>
          </a>`).join('\n')}
        </div>`;
} else {
  // nothing public yet: the first film, as it will look on YouTube
  block = `<div class="feature" style="margin-top:32px">
          <div>
            <p class="anno">first film · coming soon</p>
            <h3>Coral Reef Aquarium · 1 hour</h3>
            <p>An hour of calm coral reef in 4K 60fps, with the reef's own soundscape and no music. It's being prepared on YouTube now.</p>
            <div class="btn-row" style="margin-top:20px"><a class="btn" href="${CHANNEL}?sub_confirmation=1" rel="noopener">Subscribe to see it first</a></div>
          </div>
          <figure class="spec">
            <img src="../assets/media/ambience/films/coming-reef-640.webp" srcset="../assets/media/ambience/films/coming-reef-640.webp 640w, ../assets/media/ambience/films/coming-reef-1280.webp 1280w" sizes="(max-width: 860px) 100vw, 620px" width="1280" height="720" loading="lazy" decoding="async" alt="Thumbnail of the first film: a blue tang close up on the reef, titled Coral Reef Ambience, 4K 60 fps, 1 hour, no music">
            <figcaption class="anno">fig. 01a — the first film's thumbnail</figcaption>
          </figure>
        </div>`;
}

const cfg = existsSync(CFG) ? JSON.parse(readFileSync(CFG, 'utf8')) : {};
const checked = (f) => !!cfg[f.id]?.repeatCheck;
const ld = db.films.length ? `<script type="application/ld+json">
  ${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: db.films.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'VideoObject',
        // no "no loops" in the structured data either, unless the film's repeat check is on record
        name: checked(f) ? f.title : softenTitle(f.title),
        description: firstLine(f, !checked(f)),
        thumbnailUrl: `https://greenfieldstudio.org/assets/media/ambience/films/${f.id}-1280.webp`,
        uploadDate: f.published,
        ...(secondsOf(f) ? { duration: iso(secondsOf(f)) } : {}),
        url: `https://greenfieldstudio.org/ambience/${f.slug}/`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${f.id}`,
      },
    })),
  }).replace(/</g, '\\u003c')}
  </script>` : '';

const before = readFileSync(PAGE, 'utf8');
let html = before;
const put = (name, body) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(\\s*<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`ambience/index.html has no ${name} markers`);
  html = html.replace(re, (_, a, b) => `${a}${body ? `\n        ${body}` : ''}${b}`);
};
put('films', block);
put('films-ld', ld);
// the optional email box (tools/signup.mjs; empty while switched off) and its paragraph on the privacy page
const putAt = (text, name, body, indent) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`no ${name} markers`);
  return text.replace(re, (_, a, b) => `${a}${body ? `\n${indent}${body}` : ''}\n${indent}${b}`);
};
html = putAt(html, 'signup', signupSection('../'), '    ');
const privacyBefore = readFileSync(PRIVACY, 'utf8');
let privacyAfter = putAt(privacyBefore.replace(/\r\n/g, '\n'), 'signup', privacyBlock(), '        ');
// while the box is on, the privacy page's date is the day its email paragraph was written (tools/signup.mjs)
if (privacyDate()) privacyAfter = privacyAfter.replace(/(<b>last updated )\d{4}-\d{2}-\d{2}(<\/b>)/, `$1${privacyDate()}$2`);
if (CHECK) {
  // compare with line endings ignored: a Windows checkout may hold CRLF
  const problems = html.replace(/\r/g, '') !== before.replace(/\r/g, '') ? ['ambience/index.html differs from films.json'] : [];
  if (privacyAfter.replace(/\r/g, '') !== privacyBefore.replace(/\r/g, '')) problems.push('privacy/index.html differs from tools/signup.mjs');
  problems.push(...syncFilmPages({ site: SITE, db, cfgFile: CFG, check: true }));
  if (problems.length) {
    console.error(`sync-ambience: ${problems.join('; ')}. Run: node tools/sync-ambience.mjs --offline`);
    process.exit(1);
  }
  process.exit(0);
}
writeFileSync(PAGE, matchEol(html, before));
writeFileSync(PRIVACY, matchEol(privacyAfter, privacyBefore));
syncFilmPages({ site: SITE, db, cfgFile: CFG, check: false });
// the film pages get the shared menu and footer from tools/sync-chrome.mjs
const chrome = spawnSync(process.execPath, [join(SITE, 'tools', 'sync-chrome.mjs')], { encoding: 'utf8' });
if (chrome.status) throw new Error(`sync-chrome failed: ${chrome.stderr || chrome.stdout}`);
console.log(`sync-ambience: ${db.films.length} public film(s)${db.films.length ? ': ' + db.films.map((f) => displayTitle(f)).join(' | ') : ' (showing the coming-soon card)'}`);

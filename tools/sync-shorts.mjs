#!/usr/bin/env node
/**
 * sync-shorts.mjs — the newest public Shorts from the Greenfield Studio channel, on the home page.
 *
 *   node tools/sync-shorts.mjs            # read the channel's public feed, then rewrite the home page
 *   node tools/sync-shorts.mjs --offline  # rewrite the page from assets/media/shorts/shorts.json only
 *   node tools/sync-shorts.mjs --check    # offline; exit 1 if the page differs from shorts.json (the audit runs this)
 *
 * Same contract as sync-ambience.mjs: the channel's public Atom feed (no API key), thumbnails
 * self-hosted so the page asks YouTube for nothing until a Short is played. The feed marks a Short
 * by linking it to /shorts/<id>; long videos on the channel are ignored. Rewrites the section
 * between `<!-- shorts:start -->` / `<!-- shorts:end -->` in index.html; with no Short public the
 * whole section leaves the page.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictOptions } from './lib/args.mjs';
import { readFeed, webp, pruneThumbs, esc, matchEol } from './lib/youtube.mjs';

strictOptions(['offline', 'check']);
const CHECK = process.argv.includes('--check');
const OFFLINE = CHECK || process.argv.includes('--offline');
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL_ID = 'UCkqIZhpDYDal44ScyojqaFQ';
const CHANNEL = 'https://www.youtube.com/@Greenfield.Studio';
const SHOWN = 6;
const DIR = join(SITE, 'assets', 'media', 'shorts');
const DB = join(DIR, 'shorts.json');
const PAGE = join(SITE, 'index.html');

mkdirSync(DIR, { recursive: true });

// A Short's thumbnail is a 16:9 (or 4:3) frame with the vertical picture in the middle; keep that
// middle, at the aspect the card shows. Largest first; the crops sit just inside the picture.
const CROPS = [
  ['maxresdefault', 'crop=392:696:444:12'], // 1280x720
  ['sddefault', 'crop=260:462:190:9'],      // 640x480
  ['hqdefault', 'crop=190:338:145:11'],     // 480x360
];
async function thumb(id, out) {
  for (const [i, [name, vf]] of CROPS.entries()) {
    if (await webp(`https://i.ytimg.com/vi/${id}/${name}.jpg`, out, vf)) return i ? 'low' : 'full';
  }
  return null;
}
const db = existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf8')) : { shorts: [] };

if (!OFFLINE) {
  const entries = (await readFeed(CHANNEL_ID)).filter((f) => f.short).slice(0, SHOWN);
  // A feed with no Shorts at all is far more likely a bad response than every one being removed.
  if (!entries.length && db.shorts.length) throw new Error('the feed listed no Shorts; refusing to empty the page');
  const next = [];
  for (const f of entries) {
    const known = db.shorts.find((k) => k.id === f.id);
    const out = join(DIR, `${f.id}.webp`);
    let low = !!known?.lowres;
    // A new Short often has no maxres picture yet. Use a smaller one for now (marked lowres) and
    // try maxres again on the next runs; a Short with no picture at all is left off until it has one,
    // so one bad thumbnail never stops the rest of the lists updating.
    if (!existsSync(out) || low) {
      const got = await thumb(f.id, out);
      if (got) low = got === 'low';
      else if (!existsSync(out)) { console.warn(`sync-shorts: no thumbnail for ${f.id} yet; leaving it off the page`); continue; }
    }
    next.push({ id: f.id, title: f.title, published: f.published, ...(low ? { lowres: true } : {}) });
  }
  db.shorts = next;
  pruneThumbs(DIR, next.map((s) => s.id));
  writeFileSync(DB, JSON.stringify(db, null, 2) + '\n');
}

const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 2.6v10.8l8.8-5.4z" fill="currentColor"/></svg>';
const section = db.shorts.length ? `<section class="section" id="shorts" aria-labelledby="shorts-title">
      <div class="wrap">
        <p class="fig"><span>fig. 07</span> <b>on the channel</b></p>
        <h2 class="h2" id="shorts-title">Short films from the studio.</h2>
        <ul class="shorts">
${db.shorts.map((s) => `          <li>
            <a class="film film--short" href="https://www.youtube.com/shorts/${s.id}" data-film="${s.id}" data-film-shape="short" data-film-title="${esc(s.title)}" rel="noopener">
              <span class="film-media">
                <img src="assets/media/shorts/${s.id}.webp" width="392" height="696" loading="lazy" decoding="async" alt="">
                <span class="film-play" aria-hidden="true"><span class="play-disc">${PLAY}</span></span>
              </span>
              <h3>${esc(s.title)}</h3>
              <span class="anno">${s.published}</span>
            </a>
          </li>`).join('\n')}
        </ul>
        <p style="margin-top:24px"><a class="link-arrow" href="${CHANNEL}/shorts" rel="noopener">All Shorts on YouTube</a></p>
      </div>
    </section>` : '';

const before = readFileSync(PAGE, 'utf8');
const re = /(<!-- shorts:start -->)[\s\S]*?(\s*<!-- shorts:end -->)/;
if (!re.test(before)) throw new Error('index.html has no shorts markers');
const html = before.replace(re, (_, a, b) => `${a}${section ? `\n    ${section}` : ''}${b}`);
if (CHECK) {
  if (html.replace(/\r/g, '') !== before.replace(/\r/g, '')) {
    console.error('sync-shorts: index.html differs from shorts.json. Run: node tools/sync-shorts.mjs --offline');
    process.exit(1);
  }
  process.exit(0);
}
writeFileSync(PAGE, matchEol(html, before));
console.log(`sync-shorts: ${db.shorts.length} Short(s)${db.shorts.length ? ': ' + db.shorts.map((s) => s.title).join(' | ') : ' (section removed)'}`);

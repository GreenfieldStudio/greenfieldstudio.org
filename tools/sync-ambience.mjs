#!/usr/bin/env node
/**
 * sync-ambience.mjs — list Greenfield Ambience's public films on /ambience/.
 *
 *   node tools/sync-ambience.mjs            # read the channel's public feed, then rewrite the page
 *   node tools/sync-ambience.mjs --offline  # rewrite the page from assets/media/ambience/films/films.json only
 *
 * Reads the channel's public Atom feed (https://www.youtube.com/feeds/videos.xml, no API key; it
 * lists public videos only, so an unlisted or processing upload stays off the site by itself),
 * self-hosts each film's thumbnail as WebP (so the page requests nothing from YouTube until a
 * film is played), reads its length from the watch page, and records all of it in films.json.
 * Then it rewrites the block between `<!-- films:start -->` / `<!-- films:end -->` in
 * ambience/index.html and the VideoObject data between `<!-- films-ld:start -->` / `-end -->`.
 * Run it after a film goes public, then deploy.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { strictOptions } from './lib/args.mjs';

strictOptions(['offline']);
const OFFLINE = process.argv.includes('--offline');
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL_ID = 'UCelrQ1cVscJobF_mzsRv8_w';
const CHANNEL = 'https://www.youtube.com/@Greenfield.Ambience';
const DIR = join(SITE, 'assets', 'media', 'ambience', 'films');
const DB = join(DIR, 'films.json');
const PAGE = join(SITE, 'ambience', 'index.html');
const UA = { 'user-agent': 'Mozilla/5.0 (greenfieldstudio.org film sync)', 'accept-language': 'en' };

mkdirSync(DIR, { recursive: true });
const db = existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf8')) : { films: [] };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function webp(url, out, width) {
  const tmp = join(tmpdir(), `gs-thumb-${process.pid}.jpg`);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return false;
  writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  const x = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out]);
  rmSync(tmp, { force: true });
  return x.status === 0;
}

if (!OFFLINE) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, { headers: UA });
  if (!res.ok) throw new Error(`feed: HTTP ${res.status}`);
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: (/<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e) || [])[1],
    title: unxml((/<title>([^<]*)<\/title>/.exec(e) || [])[1] || ''),
    published: ((/<published>([^<]+)<\/published>/.exec(e) || [])[1] || '').slice(0, 10),
    description: unxml((/<media:description>([\s\S]*?)<\/media:description>/.exec(e) || [])[1] || ''),
  })).filter((f) => /^[A-Za-z0-9_-]{11}$/.test(f.id || ''));

  for (const f of entries) {
    const known = db.films.find((k) => k.id === f.id) || {};
    const film = { ...known, ...f };
    // thumbnails: the largest YouTube has, self-hosted in two sizes
    if (!existsSync(join(DIR, `${f.id}-1280.webp`))) {
      let ok = false;
      for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
        const src = `https://i.ytimg.com/vi/${f.id}/${name}.jpg`;
        if (await webp(src, join(DIR, `${f.id}-1280.webp`), 1280) && await webp(src, join(DIR, `${f.id}-640.webp`), 640)) { ok = true; break; }
      }
      if (!ok) throw new Error(`no thumbnail for ${f.id}`);
    }
    // length: not in the feed; the watch page carries it
    if (!film.seconds) {
      const page = await (await fetch(`https://www.youtube.com/watch?v=${f.id}`, { headers: UA })).text();
      const m = /"lengthSeconds":"(\d+)"/.exec(page);
      if (m) film.seconds = Number(m[1]);
    }
    db.films = db.films.filter((k) => k.id !== f.id).concat(film);
  }
  // a film that left the public feed (made private, deleted) leaves the site too
  db.films = db.films.filter((k) => entries.some((f) => f.id === k.id));
  db.films.sort((a, b) => (a.published < b.published ? 1 : -1));
  writeFileSync(DB, JSON.stringify(db, null, 2) + '\n');
}

const clock = (s) => {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const iso = (s) => `PT${Math.floor(s / 3600)}H${Math.floor((s % 3600) / 60)}M${s % 60}S`;
const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 2.6v10.8l8.8-5.4z" fill="currentColor"/></svg>';

let block;
if (db.films.length) {
  block = `<div class="films${db.films.length === 1 ? ' films--featured' : ''}" style="margin-top:32px">\n${db.films.map((f) => `          <a class="film" href="https://www.youtube.com/watch?v=${f.id}" data-film="${f.id}" data-film-title="${esc(f.title)}" rel="noopener">
            <span class="film-media">
              <img src="../assets/media/ambience/films/${f.id}-640.webp" srcset="../assets/media/ambience/films/${f.id}-640.webp 640w, ../assets/media/ambience/films/${f.id}-1280.webp 1280w" sizes="(max-width: 520px) 100vw, (max-width: 860px) 50vw, 380px" width="1280" height="720" loading="lazy" decoding="async" alt="">
              <span class="film-play" aria-hidden="true"><span class="play-disc">${PLAY}</span></span>${f.seconds ? `\n              <span class="film-len">${clock(f.seconds)}</span>` : ''}
            </span>
            <h3>${esc(f.displayTitle || f.title)}</h3>
            <span class="anno">${f.seconds ? `${Math.round(f.seconds / 60)} min · ` : ''}4K · 60 fps · on YouTube</span>
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

const ld = db.films.length ? `<script type="application/ld+json">
  ${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: db.films.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'VideoObject',
        name: f.title,
        description: (f.description || f.title).split('\n')[0],
        thumbnailUrl: `https://greenfieldstudio.org/assets/media/ambience/films/${f.id}-1280.webp`,
        uploadDate: f.published,
        ...(f.seconds ? { duration: iso(f.seconds) } : {}),
        url: `https://www.youtube.com/watch?v=${f.id}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${f.id}`,
      },
    })),
  })}
  </script>` : '';

let html = readFileSync(PAGE, 'utf8');
const put = (name, body) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(\\s*<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`ambience/index.html has no ${name} markers`);
  html = html.replace(re, (_, a, b) => `${a}${body ? `\n        ${body}` : ''}${b}`);
};
put('films', block);
put('films-ld', ld);
writeFileSync(PAGE, html);
console.log(`sync-ambience: ${db.films.length} public film(s)${db.films.length ? ': ' + db.films.map((f) => f.title).join(' | ') : ' (showing the coming-soon card)'}`);

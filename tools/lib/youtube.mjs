// Shared by tools/sync-ambience.mjs and tools/sync-shorts.mjs: read a channel's public Atom feed
// (no API key; it lists public videos only, newest first), self-host thumbnails as WebP, and turn a
// feed's text into HTML-safe strings. Nothing here writes to the site.
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const UA = { 'user-agent': 'Mozilla/5.0 (greenfieldstudio.org video sync)', 'accept-language': 'en' };

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/* YouTube sometimes answers a valid, public feed URL with HTTP 404 (or 5xx / 429) for a while, mostly to
   requests from cloud runners: the daily workflow failed with "feed UCelrQ1c...: HTTP 404" on 2026-10-21, -22
   and -23 at 05:34 UTC, while the same URL answered 200 for runs a few hours later and from the PC. So these
   statuses and network errors are retried a few times, with growing pauses (5+15+30+60 s), before giving up. */
const RETRY_STATUS = (s) => s === 404 || s === 429 || s >= 500;
export const FEED_PAUSES_MS = [5000, 15000, 30000, 60000];

/* Since 2026-10-21 the feed has also answered 404/500 for days on end, for both channels and from a home PC
   too (the channel ids are right: the channel page names the same id). Retrying cannot help then, so the
   sync tools keep the last good lists and exit with FEED_DOWN_EXIT; the workflow turns that into a warning
   and fails only after several days in a row (tools/feed-streak.mjs). */
export const FEED_DOWN_EXIT = 75;
export class FeedUnavailableError extends Error {}

/** For `await readFeed(...).catch(feedDown)`: a feed that cannot be read ends the run with FEED_DOWN_EXIT
 *  (nothing has been written yet); any other error (a bug, a thumbnail) is rethrown and stays a hard failure. */
export function feedDown(e) {
  if (!(e instanceof FeedUnavailableError)) throw e;
  console.error(`::warning title=YouTube feed unavailable::${e.message}. Keeping the last good lists.`);
  process.exit(FEED_DOWN_EXIT);
}

/** The channel's public feed: [{ id, title, published: 'YYYY-MM-DD', description, short }] newest first.
 *  `io` is for tests: { fetch, sleep, pauses }. A failure after the last try throws, naming every status seen. */
export async function readFeed(channelId, io = {}) {
  const doFetch = io.fetch || fetch;
  const sleep = io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pauses = io.pauses || FEED_PAUSES_MS;
  const seen = [];
  let xml = null;
  for (let i = 0; ; i++) {
    let why;
    let fatal = null; // a status that is not worth retrying
    try {
      const res = await doFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: UA });
      if (res.ok) { xml = await res.text(); break; }
      why = `HTTP ${res.status}`;
      seen.push(why);
      if (!RETRY_STATUS(res.status)) fatal = why;
    } catch (e) {
      why = `network error (${e.message})`;
      seen.push(why);
    }
    if (fatal) throw new FeedUnavailableError(`feed ${channelId}: ${fatal}`);
    if (i >= pauses.length) throw new FeedUnavailableError(`feed ${channelId}: ${why} after ${seen.length} tries (${seen.join(', ')})`);
    console.warn(`feed ${channelId}: ${why}; trying again in ${pauses[i] / 1000} s (${i + 2}/${pauses.length + 1})`);
    await sleep(pauses[i]);
  }
  if (!xml.includes('<feed')) throw new FeedUnavailableError(`feed ${channelId}: not an Atom feed`);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: (/<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e) || [])[1],
    title: unxml((/<title>([^<]*)<\/title>/.exec(e) || [])[1] || ''),
    published: ((/<published>([^<]+)<\/published>/.exec(e) || [])[1] || '').slice(0, 10),
    description: unxml((/<media:description>([\s\S]*?)<\/media:description>/.exec(e) || [])[1] || ''),
    // the feed links a Short to /shorts/<id> and everything else to /watch?v=<id>
    short: /<link rel="alternate" href="https:\/\/www\.youtube\.com\/shorts\//.test(e),
  })).filter((f) => /^[A-Za-z0-9_-]{11}$/.test(f.id || ''));
}

/** Download a YouTube thumbnail and write it as WebP. `vf` is the ffmpeg filter chain. */
export async function webp(url, out, vf) {
  const tmp = join(tmpdir(), `gs-thumb-${process.pid}.jpg`);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return false;
  writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  const x = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vf', vf, '-c:v', 'libwebp', '-quality', '82', out]);
  rmSync(tmp, { force: true });
  return x.status === 0;
}

/**
 * Is this video really gone (deleted or made private)? The feed lists only a channel's newest ~15
 * videos, so "not in the feed" means nothing by itself. oEmbed answers 200 for a public video and
 * 401/403/404 for a private or deleted one. A network error or anything else counts as NOT gone:
 * a film stays on the page unless YouTube says it has left.
 */
export async function isGone(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, { headers: UA });
    return r.status === 401 || r.status === 403 || r.status === 404;
  } catch (_) { return false; }
}

/** Delete thumbnails in `dir` whose name starts with an id that is no longer listed (files that match no id are left alone). */
export function pruneThumbs(dir, keepIds) {
  for (const f of readdirSync(dir)) {
    const id = /^([A-Za-z0-9_-]{11})(?:-(?:\d+|og))?\.(?:webp|jpg)$/.exec(f)?.[1];
    if (id && !keepIds.includes(id)) rmSync(join(dir, f), { force: true });
  }
}

/** The length in seconds, from the watch page (the feed doesn't carry it). null if unavailable. */
export async function lengthSeconds(id) {
  try {
    const page = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: UA })).text();
    const m = /"lengthSeconds":"(\d+)"/.exec(page);
    return m ? Number(m[1]) : null;
  } catch (_) { return null; }
}

export const clock = (s) => {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** Give `html` the line endings of `ref`, so a regenerated page doesn't churn a CRLF or LF file. */
export const matchEol = (html, ref) => (ref.includes('\r\n') ? html.replace(/\r?\n/g, '\r\n') : html.replace(/\r\n/g, '\n'));

// Shared by tools/sync-ambience.mjs and tools/sync-shorts.mjs: read a channel's public Atom feed
// (no API key; it lists public videos only, newest first), self-host thumbnails as WebP, and turn a
// feed's text into HTML-safe strings. Nothing here writes to the site.
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const UA = { 'user-agent': 'Mozilla/5.0 (greenfieldstudio.org video sync)', 'accept-language': 'en' };

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The channel's public feed: [{ id, title, published: 'YYYY-MM-DD', description, short }] newest first. */
export async function readFeed(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: UA });
  if (!res.ok) throw new Error(`feed ${channelId}: HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml.includes('<feed')) throw new Error(`feed ${channelId}: not an Atom feed`);
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

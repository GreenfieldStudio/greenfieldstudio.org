// The decision behind tools/refresh-videos.mjs, kept free of files, processes and the clock so
// tools/check-refresh.mjs can test it. A step is a sync tool; its exit status says what happened:
// 0 = refreshed, FEED_OUTAGE_EXIT (75) = the feed could not be read and nothing was written,
// anything else = a real fault.
import { FEED_OUTAGE_EXIT } from './youtube.mjs';

/** A feed outage is tolerated (green run, warning) until the last successful refresh is older than this. */
export const STALE_AFTER_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

/** `{"lastOk":"2026-10-20T17:12:00.000Z"}` -> that instant in ms; null for anything unreadable. */
export function parseStamp(text) {
  try {
    const t = Date.parse(JSON.parse(text).lastOk);
    return Number.isFinite(t) ? t : null;
  } catch (_) { return null; }
}
export const stampText = (ms) => JSON.stringify({ lastOk: new Date(ms).toISOString() }, null, 2) + '\n';

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Run the steps (all of them, so one broken feed never blocks the other) and decide the job's exit code.
 *   steps       [{ name, run: async () => exit status }]
 *   readStamp   () => text of the stamp file or null     writeStamp (text) => void
 *   now         ms since the epoch (the clock, passed in)
 *   log         (line) => void (stdout, with ::warning:: / ::error:: annotations)
 *   summary     (markdown) => void (the job summary)
 * Returns the exit code: 0 refreshed or tolerated outage, 1 real fault or an outage past STALE_AFTER_DAYS.
 */
export async function runRefresh({ steps, readStamp, writeStamp, now, log, summary }) {
  const outcome = [];
  for (const s of steps) outcome.push({ name: s.name, status: await s.run() });
  const faults = outcome.filter((o) => o.status !== 0 && o.status !== FEED_OUTAGE_EXIT);
  const outages = outcome.filter((o) => o.status === FEED_OUTAGE_EXIT);

  if (faults.length) {
    log(`::error::Refresh videos: ${faults.map((o) => `${o.name} failed (exit ${o.status})`).join('; ')}`);
    return 1;
  }
  const lastOk = parseStamp(readStamp() || '');

  if (!outages.length) {
    if (lastOk === null || day(lastOk) !== day(now)) writeStamp(stampText(now));
    summary(`Refresh videos: feeds read at ${when(now)}; last successful refresh recorded.`);
    return 0;
  }

  // The feed could not be read: the lists were not touched. Say how old they are, and go red only when that is too old.
  const names = outages.map((o) => o.name).join(' and ');
  const ageDays = lastOk === null ? null : (now - lastOk) / DAY_MS;
  const age = lastOk === null ? 'no successful refresh is on record' : `last successful refresh: ${when(lastOk)}, ${Math.floor(ageDays)} day(s) ago`;
  const tooOld = lastOk === null || ageDays > STALE_AFTER_DAYS;
  const line = `Refresh videos: the YouTube feed for ${names} could not be read; the video lists were left as they are (${age}).`;
  log(tooOld ? `::error::${line} That is more than ${STALE_AFTER_DAYS} days: look at it.` : `::warning::${line} Trying again at the next run.`);
  summary([
    `### Refresh videos: ${tooOld ? 'STALE, needs a look' : 'feed unavailable, lists kept'}`,
    '',
    `- Feed not readable: ${names}`,
    `- ${lastOk === null ? 'Last successful refresh: not on record' : `Last successful refresh: **${when(lastOk)}** (${Math.floor(ageDays)} day(s) ago)`}`,
    `- This run is ${tooOld ? 'RED because the lists are more than ' + STALE_AFTER_DAYS + ' days old' : 'green: a short outage is retried at the next run (red after ' + STALE_AFTER_DAYS + ' days)'}.`,
  ].join('\n'));
  return tooOld ? 1 : 0;
}

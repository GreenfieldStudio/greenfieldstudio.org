// The decision behind tools/refresh-videos.mjs, kept free of files, processes and the clock so
// tools/check-refresh.mjs can test it. A step is a sync tool; its exit status says what happened:
// 0 = refreshed, FEED_OUTAGE_EXIT (75) = the feed could not be used and nothing was written,
// anything else = a real fault.
import { FEED_OUTAGE_EXIT } from './youtube.mjs';

/** A feed outage is tolerated (green run, warning) until that feed's last successful read is older than this. */
export const STALE_AFTER_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

/** `{"ambience":"2026-10-23T23:18:24.000Z","shorts":"..."}` -> { ambience: ms, shorts: ms }; unreadable parts are left out. */
export function parseStamps(text) {
  let o;
  try { o = JSON.parse(text); } catch (_) { return {}; }
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (Number.isFinite(Date.parse(v))) out[k] = Date.parse(v);
  return out;
}
export const stampsText = (stamps) => JSON.stringify(Object.fromEntries(Object.entries(stamps).map(([k, ms]) => [k, new Date(ms).toISOString()])), null, 2) + '\n';

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Run the steps (all of them, so one broken feed never blocks the other) and decide the job's exit code.
 *   steps       [{ key, name, run: async () => exit status }]   key names the feed's entry in the stamp file
 *   readStamp   () => text of the stamp file or null     writeStamp (text) => void
 *   now         ms since the epoch (the clock, passed in)
 *   log         (line) => void (stdout, with ::warning:: / ::error:: annotations)
 *   summary     (markdown) => void (the job summary)
 * Each feed has its own "last successful read", kept to the day (so the alert can come up to a day before the
 * 7th day is full). Returns the exit code: 0 refreshed or a tolerated outage, 1 for a real fault or a feed
 * that has been unusable for more than STALE_AFTER_DAYS.
 */
export async function runRefresh({ steps, readStamp, writeStamp, now, log, summary }) {
  const outcome = [];
  for (const s of steps) outcome.push({ ...s, status: await s.run() });
  const faults = outcome.filter((o) => o.status !== 0 && o.status !== FEED_OUTAGE_EXIT);
  const outages = outcome.filter((o) => o.status === FEED_OUTAGE_EXIT);
  const stamps = parseStamps(readStamp() || '');

  // a feed that was read today moves its own stamp (at most once a day: no commit for every manual re-run)
  const next = { ...stamps };
  for (const o of outcome) if (o.status === 0 && (stamps[o.key] === undefined || day(stamps[o.key]) !== day(now))) next[o.key] = now;
  if (JSON.stringify(next) !== JSON.stringify(stamps)) writeStamp(stampsText(next));

  if (faults.length) {
    log(`::error::Refresh videos: ${faults.map((o) => `${o.name} failed (exit ${o.status})`).join('; ')}`);
    return 1;
  }
  if (!outages.length) {
    summary(`Refresh videos: both feeds read at ${when(now)}.`);
    return 0;
  }

  // A feed could not be used: its list was not touched. Say how old it is, and go red only when that is too old.
  const rows = outages.map((o) => {
    const last = stamps[o.key];
    const ageDays = last === undefined ? null : (now - last) / DAY_MS;
    return { name: o.name, last, ageDays, tooOld: last === undefined || ageDays > STALE_AFTER_DAYS };
  });
  const tooOld = rows.some((r) => r.tooOld);
  const ageText = (r) => (r.last === undefined ? 'no successful refresh is on record' : `last successful refresh: ${when(r.last)}, ${Math.floor(r.ageDays)} day(s) ago`);
  const line = `Refresh videos: the YouTube feed for ${rows.map((r) => `${r.name} (${ageText(r)})`).join(' and ')} could not be used (unreadable or empty); its video list was left as it is.`;
  log(tooOld ? `::error::${line} That is more than ${STALE_AFTER_DAYS} days: look at it.` : `::warning::${line} Trying again at the next run.`);
  summary([
    `### Refresh videos: ${tooOld ? 'STALE, needs a look' : 'feed unavailable, lists kept'}`,
    '',
    ...rows.map((r) => `- ${r.name}: feed not usable; ${r.last === undefined ? 'last successful refresh: not on record' : `last successful refresh **${when(r.last)}** (${Math.floor(r.ageDays)} day(s) ago)`}`),
    `- This run is ${tooOld ? 'RED: a list is more than ' + STALE_AFTER_DAYS + ' days old' : 'green: a short outage is retried at the next run (red after ' + STALE_AFTER_DAYS + ' days)'}.`,
  ].join('\n'));
  return tooOld ? 1 : 0;
}

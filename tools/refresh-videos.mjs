#!/usr/bin/env node
/**
 * refresh-videos.mjs — what the daily "Refresh videos" workflow runs: sync-ambience, then sync-shorts.
 *
 *   node tools/refresh-videos.mjs
 *
 * YouTube's feeds often answer a cloud runner with 404/500 for hours or days. Then the sync tools stop
 * with exit 75 before writing anything, and this wrapper keeps the lists as they are, prints one warning
 * line, writes the age of the lists into the job summary and exits 0, so there is no red run and no
 * failure email. It exits 1 when a list is more than 7 days old (or a sync tool failed for any other
 * reason). "Last successful refresh" is kept per feed in tools/videos-last-ok.json, moved (at most once
 * a day) whenever that feed was read; it is not part of the site (tools/ is never published).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRefresh } from './lib/refresh.mjs';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const STAMP = join(resolve(TOOLS), 'videos-last-ok.json');
const sync = (script) => async () => spawnSync(process.execPath, [join(TOOLS, script)], { stdio: 'inherit' }).status ?? 1;

const code = await runRefresh({
  steps: [
    { key: 'ambience', name: 'Greenfield Ambience', run: sync('sync-ambience.mjs') },
    { key: 'shorts', name: 'Greenfield Studio', run: sync('sync-shorts.mjs') },
  ],
  readStamp: () => (existsSync(STAMP) ? readFileSync(STAMP, 'utf8') : null),
  writeStamp: (text) => writeFileSync(STAMP, text),
  now: Date.now(),
  log: (line) => console.log(line),
  summary: (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); else console.log(md); },
});
process.exit(code);

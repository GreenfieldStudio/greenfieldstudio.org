#!/usr/bin/env node
/**
 * feed-streak.mjs — how many runs in a row found the YouTube feed unavailable? Used by the "Refresh videos"
 * workflow after it kept the last good lists: a few days are a warning, N in a row (default 3) are a failure.
 *
 *   node tools/feed-streak.mjs [--threshold 3]      (in the workflow; needs GH_TOKEN and GITHUB_REPOSITORY)
 *
 * A run counts as "feed down" when its job ran the step named DOWN_STEP (the step is skipped when the feeds
 * were read). Runs from before that step existed, and cancelled or unfinished runs, are not counted either
 * way: an older run without the step ends the streak, a cancelled one is skipped.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DOWN_STEP = 'Feed unavailable (kept the last good lists)';

/** `previous`: earlier runs, newest first, each 'down' | 'ok' | 'skip'. The current run is down.
 *  Returns the streak length including the current run. */
export function streak(previous) {
  let n = 1;
  for (const p of previous) {
    if (p === 'skip') continue;
    if (p !== 'down') break;
    n++;
  }
  return n;
}

/** One earlier run, from the GitHub API's run and jobs objects. */
export function classify(run, jobs) {
  if (run.status !== 'completed' || run.conclusion === 'cancelled') return 'skip';
  const step = jobs.flatMap((j) => j.steps || []).find((s) => s.name === DOWN_STEP);
  // 'failure' is the step that itself ended an earlier streak: that run was down too
  return step && (step.conclusion === 'success' || step.conclusion === 'failure') ? 'down' : 'ok';
}

const gh = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));

async function main() {
  const i = process.argv.indexOf('--threshold');
  const threshold = i > 0 ? Number(process.argv[i + 1]) : 3;
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error('feed-streak: --threshold needs a whole number of 1 or more');
  const repo = process.env.GITHUB_REPOSITORY;
  const current = process.env.GITHUB_RUN_ID;
  const previous = [];
  try {
    const runs = gh(`repos/${repo}/actions/workflows/videos.yml/runs?per_page=10`).workflow_runs
      .filter((r) => String(r.id) !== current)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    for (const r of runs) {
      const c = classify(r, gh(`repos/${repo}/actions/runs/${r.id}/jobs`).jobs);
      previous.push(c);
      if (c === 'ok') break;
    }
  } catch (e) {
    // Cannot read the history: do not turn a feed outage into a red run on that account.
    console.log(`::warning::feed-streak: could not read earlier runs (${e.message.split('\n')[0]}); not failing.`);
    return;
  }
  const n = streak(previous);
  if (n >= threshold) {
    // Not an exit code: the run still has to commit and publish whatever the other feed brought in. The
    // workflow's last step fails the run when it sees hard=true.
    console.log(`::error title=YouTube feed down ${n} runs in a row::The lists on the site are not being refreshed. Check the feed URL and the channel ids in tools/sync-*.mjs, or add a second source.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'hard=true\n');
  } else {
    console.log(`::warning title=YouTube feed unavailable::Run ${n} of ${threshold} in a row; the last good lists stay on the site.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

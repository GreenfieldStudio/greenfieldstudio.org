# Refresh videos: reliability fix

## Runs looked at (scheduled, newest first)

| Run | Result | Cause |
|---|---|---|
| 2026-10-31 12:50 UTC | failure | `no thumbnail for xZO79L1fbLc` (new film) |
| 2026-10-30, 10-29, 10-28 12:51 | success | |
| 2026-10-28 05:28 UTC | failure | feed HTTP 404 (old 05:23 schedule) |

The 10-24/25/27 failures and the 10-26 cancelled run were also at 05:3x, the old schedule time.

## Root cause

Two different causes, one of them already fixed on `main` before this branch.

1. **YouTube feed 404 from the cloud runner** (10-28 05:28 and earlier). Log lines:
   `feed UCelrQ1cVscJobF_mzsRv8_w: HTTP 404; trying again in 60 s (5/5)` then
   `Error: feed ...: HTTP 404 after 5 tries (HTTP 404, HTTP 404, HTTP 404, HTTP 404, HTTP 404)`.
   `main` already answers this with retries and backoff (5/15/30/60 s), `tools/refresh-videos.mjs`
   (a feed outage is a warning, red only after 7 days), the move to 12:47 UTC, and `concurrency: videos`.
   Since the move, no run has hit it.
2. **Still unfixed, the 10-31 failure.** A film new in the feed had no thumbnail on `i.ytimg.com` yet
   (or the fetch failed). `refreshThumb` made one pass over the three sizes and threw:
   `Error: no thumbnail for xZO79L1fbLc at refreshThumb (tools/lib/youtube.mjs:147)`, then
   `##[error]Refresh videos: Greenfield Ambience failed (exit 1)`. One missing thumbnail failed the whole
   run, so no other film or Short was refreshed and no deploy happened. `sync-shorts` already skips a
   Short with no thumbnail; the film path did not.

Not the cause: an API quota or rate limit (the feeds need no key), or a commit race (the concurrency group
already serialises runs).

## Change

- `tools/lib/youtube.mjs`: `refreshThumb` retries a film that has no files on disk (5+15+30 s), then throws
  `ThumbnailUnavailableError`. A film that already has thumbnails never waits.
- `tools/sync-ambience.mjs`: that error skips just that film with a `::warning::` ("leaving the film off the
  page, trying again at the next run"). Any other error still fails the run.
- `.github/workflows/videos.yml`: `git push origin HEAD:main` retries 4 times, rebasing on `origin/main`
  between tries, if a merge moved `main` mid-run; the final failure message says what happened.
- `tools/check-film-media.mjs`: three tests (retries then throws, appears on a later try, no waiting when
  files exist). Stub `fetch` and `sleep`, no network.

No secrets, settings or workflow secrets were touched or printed.

## Verify

```
npm test                                 # all suites; check-film-media now has 16 passing
node tools/sync-ambience.mjs --check     # offline list check
```

After merging, run the workflow once with `workflow_dispatch` (leave "redeploy" off) and expect a green run.
If a new film's thumbnail is late, the log shows `no thumbnail for <id> yet; trying again in 5 s (2/4)`
and, at worst, one `::warning::` with the film appearing the next day.

Note: the failed-run logs could not be read with `gh run view --log-failed` (403 from the log host); they
were read through the GitHub MCP `get_job_logs` instead.

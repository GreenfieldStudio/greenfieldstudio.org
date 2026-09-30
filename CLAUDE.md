# greenfieldstudio.org

The studio website: plain static HTML/CSS with one script, no build step, plus Minigolf Pro playable at `/play/`. Owned by the Website session. Global rules apply; see [README.md](README.md) (design rules, publishing, DNS).

## Commands
- Preview: `npm run serve` (port 5501). Release check: `npm run audit` (Chromium; `-- --shots`, `-- --game`). Syntax: `node --check <file>`.
- Offline list checks: `node tools/sync-ambience.mjs --check`, `node tools/sync-shorts.mjs --check`. Refresh from YouTube: `npm run sync-videos` (the daily workflow does it).
- New game build: build in `../minigolf-pro`, then `npm run sync-game`. Publish: `npm run deploy` (dry run), `npm run deploy -- --push` (force-pushes `gh-pages`).

## Standing rules
- Remote is `origin` (not `github`), base `main`. Merging to `main` means approved to go live: the daily workflow publishes everything on `main`.
- Never hand-edit generated files: `play/`, `press/files/`, the film and Short lists in `ambience/index.html` and `index.html`, `assets/media/ambience/films/`, `assets/media/shorts/`.
- Keep the design rules in the README: every number on the site must be true, Play links are `play/?play=1`, pages stay under 300 KB at load, and the only third party is the Cloudflare counter (changing it needs the privacy page and audit allowlist updated).
- Public contact address: `greenfieldstudiodev@gmail.com`. No personal data anywhere.

## You may decide alone
HTML/CSS fixes, tooling, audit and docs changes, journal drafts and PRs (the CEO session merges this repo).

## Ask the user first
`deploy --push`, DNS or Cloudflare changes, `PLAY_OVERRIDE`, anything that spends money, prices, licence terms, deleting data.

## Procedures
Film launch copy and checks: skill `film-launch`. Nothing to do here for a new public film: it lists itself.

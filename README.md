# greenfieldstudio.org

The Greenfield Studio website, with **Minigolf Pro playable right on the site** at `/play/`.

A plain static site: hand-written HTML/CSS, one small script, no framework, no build step
and no runtime dependencies. The game at `/play/` is the Minigolf Pro **default web build**,
the same one itch.io serves, copied in by a script.

```
index.html            studio home: hero, our work (one card per project), the play stage, studio, journal, contact
minigolf-pro/         the game's page
ambience/             Greenfield Ambience: the films (list written by tools/sync-ambience.mjs), the worlds
journal/              devlog: index, one folder per post, feed.xml (Atom)
press/                press kit (press/files/ + the zip are generated)
privacy/              privacy note for the site; links the game's own policy
404.html              "Out of bounds." (root-absolute paths: Pages serves it at any depth)
play/                 GENERATED — the game build (never edit by hand, never committed on main)
assets/css/site.css   the whole design system; tokens on :root
assets/js/site.js     inline play stage, lazy video loops, trailer play button, film player, PLAY_OVERRIDE
assets/media/         web derivatives of minigolf-pro/branding (generated, committed)
assets/fonts/         Jost + IBM Plex Mono, latin subsets, SIL OFL (licences alongside)
tools/                everything below
```

## Everyday tasks

| task | command |
|---|---|
| preview locally | `npm run serve` → http://localhost:5501 |
| ship a new game build | in `../minigolf-pro`: `npm run build`, then here: `npm run sync-game` |
| check everything | `npm run audit` (add `-- --shots` for screenshots in `.audit/`, `-- --game` to boot the game and fire a real shot) |
| publish | `npm run deploy` (dry run), then `npm run deploy -- --push` |
| check the live site | `node tools/audit.mjs --url https://greenfieldstudio.org/ --game` |
| rebuild images/video | `npm run media` (reads `../minigolf-pro/branding`; set `MINIGOLF_REPO` if elsewhere) |
| hole screenshots for a post | `node tools/capture-holes.mjs 36:asteroid-field` (0-based campaign index; writes `-640/-1200.webp` + an `-og.jpg` share card; `--out <dir> --no-og` for other uses, e.g. the world cards in `assets/media/worlds/`) |
| a new Ambience film went public | `node tools/sync-ambience.mjs`, check `/ambience/`, then deploy |
| the YouTube studio banner | `node tools/make-banner.mjs --worlds <dir>` → `.audit/banner/` (rendered from the site's own CSS and dotted shot; world images via capture-holes `--out <dir> --no-og`) |
| change the menu or footer | edit the template in `tools/sync-chrome.mjs`, run it (the audit fails if a page drifts) |
| see visitor numbers | Cloudflare dashboard → Analytics → Web analytics → `greenfieldstudio.org` (`/play/` = game loads) |

**Every Play link is `play/?play=1`.** That query is the game's own fast path (minigolf-pro R4669): it
skips the menu and lands the visitor in a hole, hole 1 for a newcomer and their saved spot otherwise.
Plain `play/` opens the menu. Keep new Play links on `?play=1`; the audit checks that it still lands.

**Adding a journal post:** copy `journal/level-critic/` as the template (its `og:image` is a JPEG
on purpose, since link-preview scrapers don't all take WebP), then list the post in
`journal/index.html`, `journal/feed.xml` (new `<entry>`, bump the feed's `<updated>`), `sitemap.xml`,
the "from the journal" block on the home page, and the `PAGES` list in `tools/audit.mjs`.
Every number in a post should come from a real tool run or a measurement in the game repo.

**Greenfield Ambience films** come from the channel's public feed: `sync-ambience` self-hosts each
thumbnail, records the film in `assets/media/ambience/films/films.json` and rewrites the list on
`/ambience/`. Unlisted, private or still-processing uploads aren't in the feed, so they stay off the
site by themselves; with no public film the page shows a "coming soon" card. A film plays in
YouTube's privacy-enhanced player (youtube-nocookie.com) inside a dialog, created only on click.

**Updating the game** is always the same three steps: build it in the game repo, `npm run sync-game`,
then `npm run deploy -- --push`. `sync-game` refuses a Poki or CrazyGames build (their SDKs must not
load on this domain), reads the commit the bundle was built from out of the bundle itself, and
records it in `play/BUILD.txt`, so `https://greenfieldstudio.org/play/BUILD.txt` always says which
build is live.

## How publishing works

`main` holds the source. The game build and the press downloads are generated and git-ignored.
`tools/deploy.mjs` assembles everything into `.deploy/` and force-pushes it to the **`gh-pages`**
branch as a single orphan commit, so the public repo never accumulates a history of 35 MB game
builds. GitHub Pages serves `gh-pages` (Settings → Pages → Deploy from a branch → `gh-pages` / root).

**The visitor counter** (Cloudflare Web Analytics; no cookies or local storage) is added by deploy,
not written into the pages: every site page plus `play/index.html` gets the beacon in `.deploy/`
only, so local previews and audits never count as visits. The token lives in `tools/analytics.mjs`
(it's public; it ships in every page). Deploy refuses to publish when the counter and the privacy
page disagree, in either direction, so switching it off means setting the token to `null` **and**
removing the privacy page's paragraph. `"spa": false` keeps the game's own URL tidying
(`history.replaceState`) from counting as extra visits. The live audit checks the counter is on
every page and allows only Cloudflare's two hosts as third parties.

## Domain (Namecheap → GitHub Pages)

`greenfieldstudio.org` stays on Namecheap's DNS, so **email forwarding (the MX records) is untouched**.
Under *Domain List → Manage → Advanced DNS*, Host Records:

| type | host | value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `greenfieldstudio.github.io.` |
| TXT | `_github-pages-challenge-GreenfieldStudio` | *(the value GitHub shows under Settings → Pages → Verified domains)* |

Remove any other `A @` record (an old Vercel one pointed at `216.198.79.1`) and the old
`www` CNAME. Check the IPs against GitHub's current docs ("Managing a custom domain for your
GitHub Pages site") before changing anything. Once DNS resolves, tick **Enforce HTTPS**.

**Email:** `hello@greenfieldstudio.org` is a Namecheap email-forwarding alias (*Domain List → Manage →
Redirect Email*) to the studio inbox. It relies on Namecheap's `eforward` MX records and their SPF
`TXT`, so leave those alone when editing DNS.

## Playing somewhere else instead

If a publishing deal ever wants the browser version to live only on a portal, two steps:

1. Set `PLAY_OVERRIDE` at the top of `assets/js/site.js` to the portal URL. On every page that loads
   `site.js`, every link into `play/` (any query) then opens the portal in a new tab, and the inline
   stage stays off. No markup changes.
2. Replace `play/` with a one-file redirect to the portal instead of deleting it. The journal posts
   and `404.html` don't load `site.js`, no-JS visitors skip it, and bookmarks, search results and
   old share links all point at `greenfieldstudio.org/play/`. Deleting the folder would send all of
   them to the 404 page, whose own Play link points back at `/play/`.

## Design rules (so it stays coherent)

The look is **Surveyed Green**, the studio's identity from the YouTube banner (philosophy in
`minigolf-pro/branding/youtube-banner-philosophy.md`):

- One cream for every mark and letter; the deep green field; **brass only on the page's one main
  action** (Play, or Subscribe on the Ambience page).
- One studio identity: the dotted-shot mark and the thin spaced wordmark, here and on both YouTube
  channels. Products keep their own look inside it (Minigolf Pro's Fredoka lockup and game colours;
  Ambience's footage under the same thin "GREENFIELD · AMBIENCE" lockup).
- Monospaced micro-annotations **certify true facts**. If a number on the site stops being true
  (holes, worlds, languages), change it. Don't add numbers you can't back up.
- The only signature motion is the dotted shot drawing itself once, off under reduced motion.
  Its geometry is generated: `node tools/gen-survey.mjs wide|tall|miss` (evenly spaced by arc length).
- Loops start only when on screen, after page load, and never under reduced-motion or Save-Data.
- Budget: each page ≤ 300 KB at `load`, before anyone presses Play (`npm run audit` enforces it).
- One third party on page load: the Cloudflare visitor counter, added at deploy time (see *How
  publishing works*). YouTube only after someone presses play on a film. Fonts, media and film
  thumbnails are served from this domain.

# greenfieldstudio.org

The Greenfield Studio website, with **Minigolf Pro playable right on the site** at `/play/`.

A plain static site: hand-written HTML/CSS, one small script, no framework, no build step
and no runtime dependencies. The game at `/play/` is the Minigolf Pro **default web build**,
the same one itch.io serves, copied in by a script.

```
index.html            studio home: Watch / Wear / Play doors in the first screen, the play stage, the course, studio, journal, contact
minigolf-pro/         the game's page
ambience/             Greenfield Ambience: the films (list written by tools/sync-ambience.mjs), the worlds
wallpapers/           the worlds as live wallpapers for Windows: status only until a wallpaper is on sale (hand-written; update it when one ships)
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
| a new film or Short went public | nothing: the daily workflow does it. To see it sooner: `npm run sync-videos`, check `/ambience/` and the home page, then deploy |
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
site by themselves; a film that is no longer in the feed is removed only if YouTube (oEmbed) says it
is private or deleted, because the feed reaches back just ~15 videos; with no public film the page shows a "coming soon" card. A film plays in
YouTube's privacy-enhanced player (youtube-nocookie.com) inside a dialog, created only on click.
Each card's length, "4K" and frame rate are read from the film's own description, so a spec is never
shown that the video doesn't state.

**One page per film.** `sync-ambience` also writes `ambience/<slug>/index.html` for every film (the card on
`/ambience/` links to it), a 1200 × 630 `<id>-og.jpg` share image, and the film block in `sitemap.xml`.
A film's slug is chosen once from its title (stored in `films.json`) and never changes, because it is the
page's address. Each page is built only from the film's own YouTube text: the first paragraph is the lede
and meta description, paragraphs with a link, hashtag or @handle are left out, `0:00 Label` lines become
the chapter list, and the length, 4K and frame rate come from the title and description. The player is the
same click-to-load privacy-enhanced player as everywhere (nothing from YouTube before a click), in place.
The generated pages carry the shared menu and footer through `sync-chrome` (which `sync-ambience` runs).
`tools/film-pages.json` is hand-written: add `"<video id>": { "repeatCheck": "YYYY-MM-DD" }` once
`audio_repeat_check.py` (and the picture check) has passed on that film's full master, and only then does
the page's readout say `loops: none`. The page text itself mirrors the YouTube description, so a "No Loops"
sentence there is only as true as the description.

**Films not out yet.** A planned film has no YouTube id, so it gets no page. `tools/upcoming-films.json` (hand-written)
lists it instead: title, go-live time with its UTC offset, a short text and the planned specs. `sync-ambience` writes
them as text-only "coming soon" entries under the films (between `<!-- upcoming:start -->` / `-end -->`; the weekday is
computed from the date) and leaves out each one on the first run after its go-live time, when the feed brings in the
real film. It refuses loop or repeat wording and health claims there. Name only sounds and sights the film's launch
pack confirms. Since the entries depend on the clock, `--check` (and the audit) fails after a go-live time until
`sync-ambience` has run again; the daily workflow does that.

**The email box** (`tools/signup.mjs`) is OFF (`SIGNUP = null`): no box, no privacy paragraph. It is a plain
`<form method="post">` to a provider's embed address, with no script from the provider and nothing requested
until the button is pressed. The owner opens the account and sets `SIGNUP` (provider, form address, privacy
URL); then `node tools/sync-ambience.mjs --offline` writes the box on `/ambience/`, `/wallpapers/` and every film page and the
"Email list" paragraph on the privacy page. Deploy refuses to publish if the switch and the privacy page
disagree, like the visitor counter. The box adds no third party at load, so the audit's allowlist is unchanged.

**Shorts** on the home page ("on the channel") work the same way: `sync-shorts` reads the Greenfield
Studio feed, keeps the six newest videos the feed links as `/shorts/` (long videos on that channel are
ignored), self-hosts the picture from the middle third of each Short's thumbnail, and plays it in the
same dialog, in a portrait frame. If a new Short has no full-size thumbnail yet it uses a smaller one
(`lowres` in `shorts.json`) and tries again on the next runs; a Short with no thumbnail at all is left off
until it has one.

**Films and Shorts update themselves.** `.github/workflows/videos.yml` runs every day (05:23 UTC) and
on demand (Actions → Refresh videos → Run workflow; tick "redeploy" to publish with no change). When
the feeds differ from the committed lists it commits only the generated files (`ambience/index.html`,
`index.html`, `assets/media/ambience/films/`, `assets/media/shorts/`) straight to `main` as
`github-actions[bot]`, then publishes with `deploy.mjs --push --base .live`. CI has only `main`, so
`--base` borrows the game build and the press downloads from the live `gh-pages` branch; the game is
never rebuilt there. It publishes whenever the live lists differ from `main`'s, so a deploy that failed
after its commit is retried the next day; publishing sends everything on `main`, so merging to `main`
means "approved to go live". It refuses to run if any other file changed, and a feed that comes back empty is
treated as a bad response, not as "every video was removed". `npm run audit` fails if a page differs
from its list (`sync-ambience --check`, `sync-shorts --check`). GitHub pauses scheduled workflows
after 60 days without repository activity; any commit restarts them.

**When YouTube's feed can't be used** (it often answers cloud runners with 404/500; an empty feed counts
too, see above), the workflow runs `tools/refresh-videos.mjs`, which fails soft: the sync tool stops with
exit 75 before writing, that list stays as it is, the run prints one `::warning::` line, writes the age of
the list into the job summary and ends green, so there is no daily failure email. It ends red once a list
is more than 7 days old (the date is kept per day, so the alert can come up to a day early), or when a sync
tool fails for any other reason. Each feed's age comes from `tools/videos-last-ok.json`, which the bot
commits (at most once a day) when that feed was read; with no record for a feed, an outage of it is red.
`node tools/check-refresh.mjs` (part of `npm test`) tests all of this.

**Updating the game** is always the same three steps: build it in the game repo, `npm run sync-game`,
then `npm run deploy -- --push`. `sync-game` refuses a Poki or CrazyGames build (their SDKs must not
load on this domain), reads the commit the bundle was built from out of the bundle itself, and
records it in `play/BUILD.txt`, so `https://greenfieldstudio.org/play/BUILD.txt` always says which
build is live.

## How publishing works

`main` holds the source. The game build and the press downloads are generated and git-ignored.
`tools/deploy.mjs` assembles everything into `.deploy/`, fetches the current **`gh-pages`** tip, and
publishes the site as one normal commit on top of it (a plain fast-forward push; never `--force`,
history is never rewritten). The commit's tree is exactly the assembled site, so `CNAME` and
`.nojekyll` stay, and files that left the site leave the branch. When the site is identical to what
`gh-pages` holds, nothing is committed or pushed. A rejected push, a moved branch or an unreachable
remote ends the script with exit 1 and the git message (the token in `DEPLOY_REMOTE` is hidden).
The repo's ruleset forbids force-pushes and deletion on `gh-pages` (and `main`), which is why it
works this way. Git stores an unchanged file once, so the history only grows by what changed; a new
game build adds its ~35 MB. `npm test` (`tools/check-deploy.mjs`) tests all of this against local bare
repos; `tools/check-feed.mjs` tests the retry of YouTube's occasional feed 404 (see `readFeed`).
GitHub Pages serves `gh-pages` (Settings → Pages → Deploy from a branch → `gh-pages` / root).

**The visitor counter** (Cloudflare Web Analytics; no cookies or local storage) is added by deploy,
not written into the pages: every site page plus `play/index.html` gets the beacon in `.deploy/`
only, so local previews and audits never count as visits. The token lives in `tools/analytics.mjs`
(it's public; it ships in every page). Deploy refuses to publish when the counter and the privacy
page disagree, in either direction, so switching it off means setting the token to `null` **and**
removing the privacy page's paragraph. `"spa": false` keeps the game's own URL tidying
(`history.replaceState`) from counting as extra visits. The live audit checks the counter is on
every page and allows only Cloudflare's two hosts as third parties.
Cloudflare Web Analytics counts page loads, including `/play/`, but does not support custom
film-play or trailer-play events. Those interactions need a separately configured event collector;
do not add a new third-party tracker without updating the privacy note and audit allowlist.

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

**Email:** the public contact address is `greenfieldstudiodev@gmail.com` (decided 2026-09-29; it
forwards to the studio inbox). It is on every page footer (`tools/sync-chrome.mjs`), the home page,
the press kit (`tools/make-media.mjs` writes `ABOUT.txt`) and the privacy page. The older
`hello@greenfieldstudio.org` is still a Namecheap email-forwarding alias (*Domain List → Manage →
Redirect Email*) but is no longer published here; it relies on Namecheap's `eforward` MX records and
their SPF `TXT`, so leave those alone when editing DNS.

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

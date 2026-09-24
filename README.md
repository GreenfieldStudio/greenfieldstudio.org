# greenfieldstudio.org

The Greenfield Studio website, with **Minigolf Pro playable right on the site** at `/play/`.

A plain static site: hand-written HTML/CSS, one small script, no framework, no build step
and no runtime dependencies. The game at `/play/` is the Minigolf Pro **default web build**,
the same one itch.io serves, copied in by a script.

```
index.html            studio home: hero, the play stage, the studio, contact
minigolf-pro/         the game's page
press/                press kit (press/files/ + the zip are generated)
privacy/              privacy note for the site; links the game's own policy
404.html              "Out of bounds." (root-absolute paths: Pages serves it at any depth)
play/                 GENERATED — the game build (never edit by hand, never committed on main)
assets/css/site.css   the whole design system; tokens on :root
assets/js/site.js     inline play stage, lazy video loops, the PLAY_OVERRIDE switch
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

## Playing somewhere else instead

If a publishing deal ever wants the browser version to live only on a portal, set `PLAY_OVERRIDE`
at the top of `assets/js/site.js` to that URL. Every Play button on the site then links there,
with no markup changes. (For a no-JS visitor the links still point at `play/`, so also delete `play/`
before the next deploy.)

## Design rules (so it stays coherent)

The look is **Surveyed Green**, the studio's identity from the YouTube banner (philosophy in
`minigolf-pro/branding/youtube-banner-philosophy.md`):

- One cream for every mark and letter; the deep green field; **brass only on Play**.
- Monospaced micro-annotations **certify true facts**. If a number on the site stops being true
  (holes, worlds, languages), change it. Don't add numbers you can't back up.
- The only signature motion is the dotted shot drawing itself once, off under reduced motion.
  Its geometry is generated: `node tools/gen-survey.mjs wide|tall|miss` (evenly spaced by arc length).
- Loops start only when on screen, after page load, and never under reduced-motion or Save-Data.
- Budget: each page ≤ 300 KB at `load`, before anyone presses Play (`npm run audit` enforces it).
- No third-party requests from the site. Fonts and media are served from this domain.

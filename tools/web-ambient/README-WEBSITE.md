# web-ambient hand-over 2026-11-17-rain

Package `web-ambient-2026-11-17-rain`, built from web-ambient commit `6c7671a` (working tree had uncommitted changes).
Live ambient scenes drawn in the browser by our own code (plain HTML/CSS/JS, raw WebGL, AudioWorklet; no build step,
no libraries, no third-party requests). The CEO decides whether and when this is merged (merge = live).

## Where it can live

Suggested path: `/ambience/live/<scene>/` (CEO-approved proposal, Oct 13), with `site/shared/` at `/ambience/live/shared/`
and `site/links.json` at `/ambience/live/links.json`. All paths inside are relative. The film button points to
`../../<film slug>/`, the site's own film page, once installed there.

## Files

27 files to publish (260.5 KB); 84 test-only files (`publish: false` in MANIFEST.json: tools/, site/selftest/, site/shared/gputime.js) stay off the site.

- `site/rain-window/`: Rain on the Cabin Window
- Not in this package (later round): candlelit-study, fireplace, reef, snow-window; links.json and the hub list only the scenes above.
- `site/shared/`: loop, clock, WebGL and audio helpers, funnel card, ui.css (site tokens), fonts with their OFL licences
- `site/links.json`: every outbound URL in one place (`null` hides a button)
- `site/index.html`: hub page

## Budgets measured

### rain-window

- Static load estimate (raw bytes, loadsize.mjs): 147.5 KB (budget 300.0 KB)
- Measured 2026-10-19 in Chrome/155.0.8059.80 (headless, this PC):
  - Transferred at load (phone emulation): 88.0 KB; folder on disk 256.6 KB
  - Phone FCP 0.88 s, first live frame 1.68 s (390x844 DPR 3, touch, CPU 4x, 1.6 Mbps / 750 Kbps / 150 ms, cache off)
  - Desktop GPU frame time p50 0.597 ms, p95 3.964 ms at 1920x1080 (EXT_disjoint_timer_query_webgl2); gate: p50 <= 1.5 ms and p95 <= 5 ms: PASS
  - Desktop scene fps 28.9 (headless harness; an empty test page tops out at about 57 fps there, so this is not a device number)
  - Frames while hidden 0, off-screen 0
  - Reduced motion: 0 frames before Start, Start button shown

## Site rules

- Page weight at load ≤ 300 KB: see the numbers above (static estimate per page; transferred bytes where measured).
- No third party: no outbound URL in the published HTML/CSS/JS except the channel link; every other URL is in links.json. No cookies, no trackers. The only tracking parameter: the brass film button of rain-window carries the UTM query from links.json film.utm (CEO order Nov 10, WR-826).
- Stored in the visitor's browser (localStorage, never sent anywhere; every access in try/catch, the page works without it): `wa-mix-rain-window` (sound-mix slider levels). Worth one line on the site's privacy page.
- Reduced motion and Save-Data: the scene never starts by itself; the poster shows with a "Start the scene" button.
- Brass once: only "Watch the full film" carries `wa-btn-brass` (funnel.js); Subscribe and Wallpaper are plain buttons.
- Play-link rule not affected: the package adds no Play links to the film pages; film buttons go to the site's own film pages.
- Copy: every sight and sound named is listed in the scene's contents.json (claims_check.mjs); no "No Loops", no "4K"/"60 fps" about the samples.

## What the Website must add

- Menu and footer via `tools/sync-chrome.mjs`.
- Sitemap entries for each scene page and the hub.
- The pages in the `PAGES` list of `tools/audit.mjs`.
- A "Try it live" link per world on `/ambience/` (and on each matching film page, if wanted).
- Fill or keep the `wallpaper` URLs in links.json (CEO); `null` keeps the button hidden.

## Checking the package

- `node tools/package.mjs --verify .` from the web-ambient project, or compare MANIFEST.json sha256 values yourself.
- `node tools/check.mjs` (and `--browser` under the RENDER-LOCK rules) runs from inside this folder.

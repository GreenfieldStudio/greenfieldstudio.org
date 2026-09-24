/**
 * analytics.mjs — the site's one visitor counter: Cloudflare Web Analytics.
 *
 * Cloudflare documents it as using no cookies or localStorage and not fingerprinting visitors;
 * it reports page, referrer, country, browser, OS, device type and load timings.
 *
 * CLOUDFLARE_BEACON_TOKEN is the token from Cloudflare → Analytics → Web analytics →
 * greenfieldstudio.org → Manage site (set up 2026-09-24). It is public: it ships in every
 * page's source. null = no counter anywhere (then also drop the privacy page's paragraph).
 *
 * The beacon is added by tools/deploy.mjs to the DEPLOYED copy only, so local previews and
 * audits never count as visits. Deploy refuses to run while the privacy page and this switch
 * disagree, in either direction.
 */
export const CLOUDFLARE_BEACON_TOKEN = 'bc80bb6c81b24ed5aa45abbd6d09985b';

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
/** Where the beacon loads from and reports to (non-proxied sites) — the only third parties allowed. */
export const BEACON_HOSTS = ['static.cloudflareinsights.com', 'cloudflareinsights.com'];
/** The privacy page must name the service while the counter is on, and must not while it's off. */
export const PRIVACY_MARKER = 'Cloudflare Web Analytics';

/* Cloudflare's own snippet (type="module", as its dashboard issued it in 2026-09), plus
   "spa": false — the beacon's default SPA mode counts in-page URL changes as page views, and
   the game rewrites its own URL with history.replaceState (share links, stripped params). With
   it off, one count on play/index.html is one load of the game. */
export const beaconTag = (token) =>
  `<!-- Cloudflare Web Analytics --><script type="module" src="${BEACON_SRC}" data-cf-beacon='{"token": "${token}", "spa": false}'></script><!-- End Cloudflare Web Analytics -->`;

/** Deployed pages that carry the counter: every site page, and the game's own entry page. */
export const countsPage = (relPath) =>
  relPath.endsWith('.html') && (!relPath.startsWith('play/') || relPath === 'play/index.html');

export const tokenLooksValid = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

// Page checks that tools/audit.mjs runs on every page, kept here so tools/check-page-checks.mjs
// can test them on small made-up pages.

export const SITE_URL = 'https://greenfieldstudio.org/';
export const SHARE_TAGS = ['og:title', 'og:description', 'og:url', 'og:image'];

/* Share tags: a canonical, the four og tags, og:url equal to the canonical, and both naming THIS
   page (a post started from a copy of another keeps the old page's head otherwise). Every
   problem is reported in the same run; one missing tag does not hide a wrong URL. */
export function shareProblems({ canonical, ogUrl, noShare, path }) {
  const out = [];
  const self = SITE_URL + path;
  if (!canonical) out.push('no canonical link');
  else if (canonical !== self) out.push(`canonical ${canonical} is not this page (${self})`);
  if (noShare.length) out.push(`share tags missing: ${noShare.join(', ')}`);
  if (canonical && ogUrl && ogUrl !== canonical) out.push(`og:url ${ogUrl} differs from canonical ${canonical}`);
  return out;
}

// The og:image names the live site; locally the same file is served under the audit's base URL.
export function onBase(url, base) {
  return url && url.startsWith(SITE_URL) ? base + url.slice(SITE_URL.length) : url;
}

/* Runs inside the page (page.evaluate), so it may use only the page's globals.
   A box that scrolls (sideways or up/down, by a CSS rule or an inline style) must take keyboard
   focus itself or hold something focusable, or a keyboard user cannot read the rest (WCAG 2.1.1,
   axe scrollable-region-focusable). The page itself (html, body) scrolls with the keyboard anyway. */
export function findStuckScrollers() {
  const scrolls = (v) => !/^(visible|hidden|clip)$/.test(v);
  return [...document.querySelectorAll('body *')]
    .filter((e) => {
      const x = e.scrollWidth > e.clientWidth + 1;
      const y = e.scrollHeight > e.clientHeight + 1;
      if (!x && !y) return false;
      const cs = getComputedStyle(e);
      if (!((x && scrolls(cs.overflowX)) || (y && scrolls(cs.overflowY)))) return false;
      return e.tabIndex < 0 && !e.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex^="-"])');
    })
    .map((e) => e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : ''));
}

const CACHE_NAME = 'minigolf-v7';// R2734 — bumped v5->v6 so stale/error-poisoned cache entries purge on activate. R3811b — v6->v7: the hashed-asset matcher was fixed (it had never matched a real Vite hash), so existing caches hold none of the asset entries the corrected arm now expects; bump forces a clean rebuild rather than a half-populated cache.

// Install: precache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    // R2722 — itch.io fix: relative shell paths. On itch the SW lives at
    // html/<build-id>/sw.js, so absolute '/' + '/index.html' resolved to the CDN
    // ROOT and 403'd → addAll rejected → SW install failed. Relative './' +
    // './index.html' resolve against the SW's own scope — works under itch's
    // subpath AND at root in production.
    // R2729 — itch.io fix #2: addAll is ATOMIC — if EITHER url is non-2xx the whole
    // precache rejects ("Failed to execute 'addAll' on 'Cache': Request failed").
    // itch's html/<build-id>/ host 403s the bare './' (directory) request even
    // though './index.html' serves fine, so addAll always failed → no offline
    // support. allSettled makes precache best-effort: a 403 on './' no longer
    // aborts caching of './index.html'.
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled([cache.add('./index.html'), cache.add('./')])
    )
  );
  self.skipWaiting();
});

// Activate: purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategies
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests (Firebase POST, etc.) — Cache API only supports GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip localhost dev server entirely — never intercept Vite HMR or source files
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // R2729 — only intercept same-origin requests + the font CDNs. Cross-origin
  // requests (analytics, Firebase) must pass through UNTOUCHED: intercepting a
  // blocked/unreachable host (e.g. gtag → ERR_NAME_NOT_RESOLVED) means fetch()
  // rejects and, with no .catch, the rejection reaches respondWith as an uncaught
  // "Failed to fetch" SW error every load. Letting the browser handle them
  // natively keeps those failures out of the SW.
  const _isFontCdn = url.hostname.includes('googleapis') || url.hostname.includes('gstatic');
  if (url.origin !== self.location.origin && !_isFontCdn) return;

  // Navigation: network-first, fallback to cached shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // R2734 — only cache a genuinely OK response, and swallow put()
          // failures. itch's `index.html?v=…` revalidation can resolve with an
          // ERROR response object; cache.put() on it throws an uncaught
          // "Cache.put() encountered a network error" (NetworkError) — guard both.
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))/* R2722 — relative, subpath-safe; R2729 — never resolve to undefined */
    );
    return;
  }

  // Fonts: cache-first (immutable CDN URLs)
  if (_isFontCdn) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((res) => {
            if (res && res.status === 200) cache.put(event.request, res.clone()).catch(() => {})/* R2734 */;
            return res;
          }).catch(() => cached || Response.error())/* R2729 — never reject unhandled */;
        })
      )
    );
    return;
  }

  /* Hashed assets (Vite output): cache-first — immutable content.
     R3811b — the hash class was `[a-f0-9]{8,}`, i.e. LOWERCASE HEX, but Vite emits base64url
     hashes containing uppercase letters, `-` and `_` (index-vf6xVhkq.js, gameRenderer-BdSyFlpF.js,
     core-shared-TygvGZMe.js). So this arm has never matched a single real asset and the whole
     cache-first path was dead — every chunk fell through to the network on every load, and
     nothing was cached for offline. Harmless-looking while every chunk was ALSO modulepreloaded
     on boot; it stopped being harmless the moment R3811 made the gameplay renderer lazy, since
     an uncached lazy chunk means a PWA that opens offline can reach the menu and then never
     render a hole. Character class widened to base64url, length kept at 8+. */
  if (url.pathname.match(/\/assets\/.*-[A-Za-z0-9_-]{8,}\./)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {})/* R2734 */;
          }
          return res;
        }).catch(() => cached || Response.error())/* R2729 — never reject unhandled */;
      })
    );
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {})/* R2736 (M3) — guard put() like the other paths */;
        }
        return res;
      }).catch(() => cached || Response.error())/* R2729 — a dead network (blocked
        host / itch revalidation 404) must not reject unhandled into respondWith;
        fall back to cache or a clean error Response. */;
      return cached || fetched;
    })
  );
});

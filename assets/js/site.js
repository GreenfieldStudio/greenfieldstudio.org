/* Greenfield Studio — the only script on the site. Progressive enhancement only:
   without it every Play button is a plain link to the full-page game, every video
   shows its poster, and nothing is lost but the inline stage. */
(() => {
  'use strict';

  /* One-line switch. When set (e.g. to a portal page), every Play button on the site
     links there instead of embedding /play/ — for the day a publishing deal wants the
     browser version to live elsewhere. null = play here, on greenfieldstudio.org. */
  const PLAY_OVERRIDE = null;

  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  const reducedMotion = mq('(prefers-reduced-motion: reduce)');
  const saveData = !!(navigator.connection && navigator.connection.saveData);

  /* Touch-first or small screens get the full page: the game locks orientation,
     requests fullscreen on first touch and handles portrait itself, all of which
     work better top-level than inside an iframe in a scrolling page. */
  const wantsFullPage = () => mq('(pointer: coarse)') || window.innerWidth < 820 || window.innerHeight < 480;

  if (PLAY_OVERRIDE) {
    // Every link into the game (any Play button, any query string), not only the stage's own.
    document.querySelectorAll('a[href]').forEach((a) => {
      const u = new URL(a.getAttribute('href'), location.href);
      if (u.origin !== location.origin || !/\/play\/(index\.html)?$/.test(u.pathname)) return;
      a.href = PLAY_OVERRIDE;
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }

  // ── ambient video loops: start only when on screen, never under reduced motion ──
  const loops = [...document.querySelectorAll('video[data-autoplay]')];
  const armed = new WeakSet();
  const arm = (v) => {
    if (armed.has(v)) return;
    armed.add(v);
    v.querySelectorAll('source[data-src]').forEach((s) => { s.src = s.dataset.src; });
    v.load();
  };
  if (loops.length && !reducedMotion && !saveData && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target;
        if (e.isIntersecting) {
          arm(v);
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      }
    }, { threshold: 0.25 });
    // Wait for load so the loops never compete with the page's own first paint.
    const start = () => loops.forEach((v) => io.observe(v));
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }

  // ── the stage: one click swaps the loop for the live game ──────────────────────
  document.querySelectorAll('[data-stage-wrap]').forEach((wrap) => {
    const stage = wrap.querySelector('[data-stage]');
    const play = wrap.querySelector('[data-play]');
    const veil = wrap.querySelector('[data-veil]');
    if (!stage || !play) return;
    const src = stage.dataset.playSrc || play.getAttribute('href');
    let frame = null;

    const open = () => {
      if (frame) return;
      frame = document.createElement('iframe');
      frame.src = src;
      frame.title = 'Minigolf Pro — playable game';
      frame.allow = 'fullscreen; autoplay; gamepad; clipboard-write';
      frame.setAttribute('allowfullscreen', '');
      stage.appendChild(frame);
      stage.classList.add('is-playing');
      wrap.classList.add('is-playing');
      stage.querySelectorAll('video').forEach((v) => v.pause());
      // Keyboard players land in the game, not on the page behind it.
      frame.addEventListener('load', () => { try { frame.focus(); } catch (_) {} }, { once: true });
    };

    const close = () => {
      if (!frame) return;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      frame.remove();
      frame = null;
      stage.classList.remove('is-playing');
      wrap.classList.remove('is-playing');
      play.focus();
    };

    const onPlay = (e) => {
      if (PLAY_OVERRIDE || wantsFullPage()) return; // let the link navigate
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new-tab intents
      e.preventDefault();
      open();
    };
    play.addEventListener('click', onPlay);
    // The whole stage is a target, not just the button.
    if (veil) veil.addEventListener('click', (e) => { if (e.target === veil) { if (PLAY_OVERRIDE || wantsFullPage()) location.href = play.href; else open(); } });

    wrap.querySelector('[data-close]')?.addEventListener('click', close);
    wrap.querySelector('[data-fullscreen]')?.addEventListener('click', () => {
      const el = frame || stage;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const r = req.call(el);
        if (r && r.catch) r.catch(() => { window.open(src, '_blank', 'noopener'); });
      } else {
        window.open(src, '_blank', 'noopener');
      }
    });
    // Warm the game's entry files on hover/focus intent, so the click feels instant.
    let warmed = false;
    const warm = () => {
      if (warmed || PLAY_OVERRIDE || saveData || wantsFullPage()) return;
      warmed = true;
      const base = new URL(src, location.href);
      fetch(base, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => {
          if (!html) return;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('script[type="module"][src], link[rel="modulepreload"][href], link[rel="stylesheet"][href]').forEach((el) => {
            const href = new URL(el.getAttribute('src') || el.getAttribute('href'), base).href;
            const l = document.createElement('link');
            l.rel = 'prefetch';
            l.href = href;
            document.head.appendChild(l);
          });
        })
        .catch(() => {});
    };
    play.addEventListener('pointerenter', warm, { once: true });
    play.addEventListener('focus', warm, { once: true });
    wrap._gs = { open, warm };
  });

  // ── "Play" buttons outside a stage (e.g. the hero): bring the stage into view and start it ──
  const firstStage = document.querySelector('[data-stage-wrap]');
  document.querySelectorAll('[data-play-jump]').forEach((btn) => {
    btn.addEventListener('pointerenter', () => firstStage && firstStage._gs && firstStage._gs.warm(), { once: true });
    btn.addEventListener('click', (e) => {
      if (PLAY_OVERRIDE || wantsFullPage() || !firstStage || !firstStage._gs) return; // plain link to /play/
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      firstStage._gs.open(); // open first: the stage changes shape, and we centre the final box
      firstStage.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    });
  });
})();

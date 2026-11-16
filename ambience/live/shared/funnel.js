// web-ambient funnel card: title, one sentence, Watch the full film (brass; "Films on the channel" while the scene's
// film is null), Subscribe, Wallpaper only when set.
// No third-party requests. The only tracking parameter is the optional links.json film.utm query on the brass film button
// (CEO order Nov 10, owner go, WR-826); it stays on the site's own film page.
// Usage: WAFunnel.mount(el, sceneId, { base: '../../', linksUrl: '../links.json' })
(function (root) {
  'use strict';
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function link(href, cls, text) {
    var a = el('a', cls, text);
    a.href = href;
    a.rel = 'noopener';
    return a;
  }
  function render(data, sceneId, opts) {
    var s = data.scenes[sceneId];
    if (!s) throw new Error('unknown scene ' + sceneId);
    var base = (opts && opts.base) || '../../';
    var card = el('aside', 'wa-card');
    card.setAttribute('aria-label', s.title);
    card.appendChild(el('h2', 'wa-card-title', s.title));
    card.appendChild(el('p', 'wa-card-text', s.sentence));
    var row = el('div', 'wa-card-actions');
    // No film yet (film: null): the brass button goes to the channel instead.
    if (s.film) row.appendChild(link(base + s.film.slug + '/' + (s.film.utm ? '?' + s.film.utm : ''), 'wa-btn wa-btn-brass', 'Watch the full film'));
    else row.appendChild(link(CHANNEL, 'wa-btn wa-btn-brass', 'Films on the channel'));
    row.appendChild(link(data.subscribe, 'wa-btn', 'Subscribe'));
    if (s.wallpaper) row.appendChild(link(s.wallpaper, 'wa-btn', 'Wallpaper'));
    card.appendChild(row);
    if (s.alsoFilms && s.alsoFilms.length) {
      var also = el('p', 'wa-card-also', 'Also: ');
      s.alsoFilms.forEach(function (f, i) {
        if (i) also.appendChild(document.createTextNode(', '));
        also.appendChild(link(base + f.slug + '/', 'wa-link', f.label));
      });
      card.appendChild(also);
    }
    if (s.note) card.appendChild(el('p', 'wa-card-note', s.note));
    return card;
  }
  // Shown when links.json is missing, broken or lacks the scene: a plain link to the channel, never an empty space.
  var CHANNEL = 'https://www.youtube.com/@Greenfield.Ambience';
  function fallback() {
    var card = el('aside', 'wa-card wa-card-fallback');
    card.setAttribute('aria-label', 'Greenfield Ambience');
    var p = el('p', 'wa-card-text', 'More calm films on ');
    p.appendChild(link(CHANNEL, 'wa-link', 'the Greenfield Ambience channel'));
    p.appendChild(document.createTextNode('.'));
    card.appendChild(p);
    return card;
  }
  function mount(target, sceneId, opts) {
    var url = (opts && opts.linksUrl) || '../links.json';
    return Promise.resolve().then(function () { return fetch(url); }).then(function (r) {
      if (!r.ok) throw new Error('links.json HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      return render(data, sceneId, opts);
    }).catch(function (e) {
      if (typeof console !== 'undefined') console.warn('funnel: ' + e.message + ', showing the channel link');
      return fallback();
    }).then(function (card) {
      target.appendChild(card);
      return card;
    });
  }
  root.WAFunnel = { render: render, mount: mount, fallback: fallback, CHANNEL: CHANNEL };
})(typeof window !== 'undefined' ? window : globalThis);

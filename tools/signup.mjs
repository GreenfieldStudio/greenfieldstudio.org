/**
 * signup.mjs — the optional email box for new Ambience films. OFF until the owner has an account.
 *
 * SIGNUP = null: no box on any page and no email paragraph on the privacy page.
 * To switch it on, the owner opens an account with a plain-HTML-form provider (the box is a normal
 * <form method="post">, no script from the provider, nothing requested until the button is pressed)
 * and replaces null below with:
 *
 *   { provider: 'Buttondown',
 *     action: 'https://buttondown.com/api/emails/embed-subscribe/<the list's username>',
 *     policy: 'https://buttondown.com/legal/privacy',        // the provider's own privacy page
 *     extra: { embed: '1' } }                                  // the provider's hidden fields, if any
 *
 * Then: node tools/sync-ambience.mjs --offline   (writes the box and the privacy paragraph).
 * The field holding the address must be named `email`. The provider must send a confirmation email
 * first (double opt-in) and put an unsubscribe link in every email: check both in its settings
 * before the first public day. Deploy refuses to publish when this switch and the privacy page
 * disagree, in either direction (same rule as the visitor counter in tools/analytics.mjs).
 */
export const SIGNUP = null;

/** The privacy page must carry this heading while the box is on, and must not while it is off. */
export const PRIVACY_SIGNUP_MARKER = 'id="email-list"';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const MAIL = 'greenfieldstudiodev@gmail.com';

/** The box, as a page section ('' while switched off). `up` = path back to the site root, e.g. '../../'. */
export function signupSection(up) {
  if (!SIGNUP) return '';
  const hidden = Object.entries(SIGNUP.extra || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<section class="section" id="signup" aria-labelledby="signup-title">
      <div class="wrap">
        <p class="fig"><span>email</span> <b>new films</b></p>
        <h2 class="h2" id="signup-title">Know when a new world is out</h2>
        <p class="lede">A short email about once a month: new films, and what is coming next.</p>
        <form class="signup" action="${esc(SIGNUP.action)}" method="post" target="_blank">
          <label class="signup-label" for="signup-email">Email address</label>
          <div class="signup-row">
            <input id="signup-email" name="email" type="email" required autocomplete="email" inputmode="email" placeholder="you@example.com">${hidden}
            <button class="btn btn--lg" type="submit">Email me new films</button>
          </div>
          <p class="signup-note">Pressing the button sends your address to ${esc(SIGNUP.provider)}, which emails you a confirmation first; you are on the list only after you click it. Every email has an unsubscribe link. Details: <a href="${up}privacy/#email-list">privacy</a>.</p>
        </form>
      </div>
    </section>`;
}

/** The privacy page's paragraph ('' while switched off). */
export function privacyBlock() {
  if (!SIGNUP) return '';
  return `<h2 id="email-list">Email list</h2>
        <p>Greenfield Ambience has an optional email list for new films. If you enter your address in the box on the <a href="../ambience/">Ambience page</a> or on a film page, your address goes to <a href="${esc(SIGNUP.policy)}" rel="noopener">${esc(SIGNUP.provider)}</a>, which stores it and sends the emails for us. You get a confirmation email first, and you are on the list only after you click the link in it. We use your address only to send you these emails and we don't sell or share it. Every email has an unsubscribe link that removes you, and we keep your address until you unsubscribe. To see or delete what we hold, write to <a href="mailto:${MAIL}">${MAIL}</a>.</p>
        <p>The boxes load nothing from ${esc(SIGNUP.provider)} by themselves: your address is sent only when you press the button, and the confirmation page opens in a new tab.</p>`;
}

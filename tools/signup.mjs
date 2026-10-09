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
 * and, for the privacy text that goes live with the box (GDPR / Thailand PDPA; a person has to fill these in):
 *
 *     controller: { name: 'Full name of the person running the site', address: 'Postal address (PO box or virtual mailbox)' },
 *     providerPlace: 'the United States',                      // where the provider stores the address
 *     updated: '2026-11-02',                                    // the day the privacy page changes (shown as "last updated")
 *
 * Any value that is empty or still in [square brackets] stops the build (sync-ambience and deploy), so the
 * box can never go live with a placeholder in its privacy text. Have the adviser read the generated
 * paragraph once before the first public day (PLAN-CONVERSION.md section 4).
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

/** What the owner still has to fill in: a list of problems, empty when the config is complete. */
export function signupProblems(cfg = SIGNUP) {
  if (!cfg) return [];
  const bad = (v) => typeof v !== 'string' || !v.trim() || /^\s*\[.*\]\s*$/.test(v) || /\b(?:todo|tbd|xxx)\b/i.test(v);
  const out = [];
  if (!/^https:\/\/[a-z0-9.-]+\//.test(cfg.action || '')) out.push('action (an https:// form address)');
  if (bad(cfg.provider)) out.push('provider');
  if (!/^https:\/\/[a-z0-9.-]+\//.test(cfg.policy || '')) out.push('policy (the provider\'s privacy page, https://)');
  if (bad(cfg.controller?.name)) out.push('controller.name');
  if (bad(cfg.controller?.address)) out.push('controller.address');
  if (bad(cfg.providerPlace)) out.push('providerPlace');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.updated || '')) out.push('updated (YYYY-MM-DD)');
  return out;
}

/** The box, as a page section ('' while switched off). `up` = path back to the site root, e.g. '../../'. */
export function signupSection(up, cfg = SIGNUP) {
  if (!cfg) return '';
  const hidden = Object.entries(cfg.extra || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<section class="section" id="signup" aria-labelledby="signup-title">
      <div class="wrap">
        <p class="fig"><span>email</span> <b>new films</b></p>
        <h2 class="h2" id="signup-title">Know when a new world is out</h2>
        <p class="lede">A short email about once a month: new films, and what is coming next.</p>
        <form class="signup" action="${esc(cfg.action)}" method="post" target="_blank" rel="noopener">
          <label class="signup-label" for="signup-email">Email address</label>
          <div class="signup-row">
            <input id="signup-email" name="email" type="email" required autocomplete="email" inputmode="email" placeholder="you@example.com">${hidden}
            <button class="btn btn--lg" type="submit">Email me new films</button>
          </div>
          <p class="signup-note">Pressing the button sends your address to ${esc(cfg.provider)}, which emails you a confirmation first; you are on the list only after you click it. Every email has an unsubscribe link, and you can withdraw at any time. Details: <a href="${up}privacy/#email-list">privacy</a>.</p>
        </form>
      </div>
    </section>`;
}

/** The privacy page's paragraphs ('' while switched off). Refuses to render with a missing or placeholder value. */
export function privacyBlock(cfg = SIGNUP) {
  if (!cfg) return '';
  const missing = signupProblems(cfg);
  if (missing.length) throw new Error(`tools/signup.mjs: the email box is on but these are missing or still placeholders: ${missing.join(', ')}`);
  const who = `${esc(cfg.controller.name)}, ${esc(cfg.controller.address)}`;
  return `<h2 id="email-list">Email list</h2>
        <p>The optional email list for new Greenfield Ambience films is run by ${who} (the controller of your data). You can reach us at <a href="mailto:${MAIL}">${MAIL}</a>.</p>
        <ul>
          <li><strong>What we collect and why.</strong> Only the email address you type into the box on the <a href="../ambience/">Ambience page</a> or a film page, and, with it, the time of sign-up and the confirmation (our email provider records these as proof that you agreed). We use them only to send you the emails you asked for: new films and what is coming next, about once a month. We don't sell or share your address and we use it for nothing else.</li>
          <li><strong>Legal basis.</strong> Your consent. Giving your address is voluntary, and nothing on this site depends on it.</li>
          <li><strong>Double opt-in.</strong> After you press the button, ${esc(cfg.provider)} sends you a confirmation email. You are on the list only after you click the link in it. An address that is never confirmed is not added.</li>
          <li><strong>Who handles it.</strong> <a href="${esc(cfg.policy)}" rel="noopener">${esc(cfg.provider)}</a> stores your address and sends the emails for us, as our processor, on servers in ${esc(cfg.providerPlace)}. If you live elsewhere, your address is therefore sent abroad, under the provider's own safeguards.</li>
          <li><strong>How long.</strong> Until you unsubscribe or ask us to delete it; then we remove it from the list. The provider may keep a minimal record that you unsubscribed, so you are not emailed again.</li>
          <li><strong>Your rights.</strong> You can withdraw your consent at any time with the unsubscribe link in every email, or by writing to us; that doesn't affect emails sent before. You can also ask to see, correct or delete what we hold, and complain to your data protection authority (in Thailand, the Personal Data Protection Committee; in the EU, the authority of your country).</li>
        </ul>
        <p>The boxes load nothing from ${esc(cfg.provider)} by themselves: your address is sent only when you press the button, and the confirmation page opens in a new tab.</p>`;
}

/** The "last updated" day for the privacy page: the box's own date while it is on, else null (the page keeps its date). */
export const privacyDate = (cfg = SIGNUP) => (cfg && /^\d{4}-\d{2}-\d{2}$/.test(cfg.updated || '') ? cfg.updated : null);

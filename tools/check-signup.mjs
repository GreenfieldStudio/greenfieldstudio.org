// check-signup.mjs — the email box's privacy text: a complete config renders every GDPR item, a placeholder or
// missing value refuses to render, and off renders nothing. Run by `npm run audit`. No browser, no network.
import { signupProblems, privacyBlock, signupSection } from './signup.mjs';
const good = { provider: 'Buttondown', action: 'https://buttondown.com/api/emails/embed-subscribe/greenfield', policy: 'https://buttondown.com/legal/privacy', extra: { embed: '1' },
  controller: { name: 'Jane Doe', address: 'PO Box 1, Bangkok 10110, Thailand' }, providerPlace: 'the United States', updated: '2026-11-02' };
let ok = true; const t = (c, m) => { if (!c) { ok = false; console.log('FAIL', m); } };
t(signupProblems(null).length === 0, 'off = no problems');
t(signupProblems(good).length === 0, 'good config passes: ' + signupProblems(good));
const ph = { ...good, controller: { name: '[full name]', address: '[address]' } };
t(signupProblems(ph).length === 2, 'placeholders flagged');
let threw = false; try { privacyBlock(ph); } catch { threw = true; } t(threw, 'placeholder refuses to render');
const html = privacyBlock(good);
for (const w of ['Jane Doe', 'PO Box 1', 'consent', 'Double opt-in', 'Buttondown', 'the United States', 'withdraw', 'complain', 'How long', 'id="email-list"', 'mailto:']) t(html.includes(w), 'privacy text has ' + w);
t(!/\[|undefined|\$\{/.test(html), 'no placeholder leftovers');
t(signupSection('../', good).includes('withdraw'), 'box note mentions withdrawal');
t(signupSection('../', null) === '' && privacyBlock(null) === '', 'off renders nothing');
console.log(ok ? 'GDPR checks OK' : 'GDPR checks FAILED'); process.exit(ok ? 0 : 1);

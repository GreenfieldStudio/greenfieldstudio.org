#!/usr/bin/env node
/**
 * check-deploy.mjs — tests for tools/deploy.mjs --push against local bare repos (DEPLOY_REMOTE).
 *
 *   node tools/check-deploy.mjs
 *
 * Builds a tiny fake site in a temp folder (copy of the real tools/ + a few pages), then publishes it
 * to a bare repo standing in for GitHub. Covers: first publish, second publish with changes, no-op
 * publish, source-only change, a remote that refuses non-fast-forward updates (pre-receive hook, like
 * the repo's ruleset), a remote that refuses everything, a remote that cannot be reached, and the
 * dry run. Nothing here touches GitHub, the real .deploy/ folder or the real gh-pages branch.
 */
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVACY_MARKER, BEACON_SRC, CLOUDFLARE_BEACON_TOKEN } from './analytics.mjs';
import { SIGNUP, PRIVACY_SIGNUP_MARKER } from './signup.mjs';

const REAL = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = mkdtempSync(join(tmpdir(), 'check-deploy-'));
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'tester', GIT_AUTHOR_EMAIL: 'tester@example.invalid',
  GIT_COMMITTER_NAME: 'tester', GIT_COMMITTER_EMAIL: 'tester@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
};
delete ENV.DEPLOY_REMOTE;

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

// ── a fake site that passes deploy.mjs's preconditions ──────────────────────────
const SITE = join(ROOT, 'site');
mkdirSync(join(SITE, 'tools'), { recursive: true });
for (const f of ['deploy.mjs', 'analytics.mjs', 'signup.mjs']) cpSync(join(REAL, f), join(SITE, 'tools', f));
cpSync(join(REAL, 'lib'), join(SITE, 'tools', 'lib'), { recursive: true });
const privacy = `<html><body>privacy ${CLOUDFLARE_BEACON_TOKEN ? PRIVACY_MARKER : ''} ${SIGNUP ? PRIVACY_SIGNUP_MARKER : ''}</body></html>\n`;
function writeSite(extra = {}) {
  put(join(SITE, 'index.html'), `<html><body>home ${extra.home || 'v1'}</body></html>\n`);
  put(join(SITE, '404.html'), '<html><body>404</body></html>\n');
  put(join(SITE, 'CNAME'), 'greenfieldstudio.org\n');
  put(join(SITE, '.nojekyll'), '');
  put(join(SITE, 'privacy', 'index.html'), privacy);
  put(join(SITE, 'play', 'index.html'), '<html><body>game</body></html>\n');
  put(join(SITE, 'play', 'BUILD.txt'), 'commit 0123456789abcdef\n');
  put(join(SITE, 'press', 'greenfield-studio-presskit.zip'), 'zip');
  put(join(SITE, 'README.md'), `readme ${extra.readme || 'v1'}\n`); // excluded from the deploy
  rmSync(join(SITE, 'journal'), { recursive: true, force: true });
  if (extra.journal) put(join(SITE, 'journal', 'index.html'), `<html><body>${extra.journal}</body></html>\n`);
}

function bare(name, hook) {
  const dir = join(ROOT, name + '.git');
  git(['init', '-q', '--bare', '-b', 'main', dir]);
  if (hook) { const p = join(dir, 'hooks', 'pre-receive'); writeFileSync(p, hook); chmodSync(p, 0o755); }
  return dir;
}
// Refuses any update that is not a fast-forward, and any deletion (what the repo's ruleset says).
const NO_FORCE_HOOK = `#!/bin/sh
zero=0000000000000000000000000000000000000000
while read old new ref; do
  [ "$new" = "$zero" ] && { echo "GH013: deletion refused" >&2; exit 1; }
  [ "$old" = "$zero" ] && continue
  git merge-base --is-ancestor "$old" "$new" || { echo "GH013: Cannot force-push to this branch" >&2; exit 1; }
done
`;
const REFUSE_ALL_HOOK = '#!/bin/sh\necho "GH013: Repository rule violations found" >&2\nexit 1\n';

function deploy(remote, args = ['--push']) {
  const r = spawnSync(process.execPath, [join(SITE, 'tools', 'deploy.mjs'), ...args], {
    cwd: SITE, encoding: 'utf8', env: { ...ENV, ...(remote ? { DEPLOY_REMOTE: remote } : {}) }, timeout: 120000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const tip = (remote) => { try { return git(['rev-parse', '--verify', '-q', 'refs/heads/gh-pages'], remote); } catch (_) { return ''; } };
const count = (remote) => Number(git(['rev-list', '--count', 'gh-pages'], remote));
const files = (remote) => git(['ls-tree', '-r', '--name-only', 'gh-pages'], remote).split('\n').sort();
const show = (remote, p) => git(['show', `gh-pages:${p}`], remote);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('first publish creates gh-pages with the site, CNAME and .nojekyll', () => {
  writeSite();
  const remote = bare('first', NO_FORCE_HOOK);
  const r = deploy(remote);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /new branch/);
  assert.equal(count(remote), 1);
  assert.deepEqual(files(remote), ['.nojekyll', '404.html', 'CNAME', 'index.html', 'play/BUILD.txt', 'play/index.html', 'press/greenfield-studio-presskit.zip', 'privacy/index.html']);
  assert.equal(show(remote, 'CNAME'), 'greenfieldstudio.org');
  if (CLOUDFLARE_BEACON_TOKEN) assert.ok(show(remote, 'index.html').includes(BEACON_SRC), 'counter added to the deployed page');
  assert.ok(!existsSync(join(SITE, '.deploy', '.git')), 'scratch repo removed');
});

test('second publish with changes is one normal commit on top, history kept', () => {
  writeSite();
  const remote = bare('second', NO_FORCE_HOOK);
  assert.equal(deploy(remote).code, 0);
  const first = tip(remote);
  writeSite({ home: 'v2', journal: 'new page' });
  const r = deploy(remote);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /fast-forward from/);
  assert.equal(count(remote), 2);
  assert.equal(git(['rev-parse', 'gh-pages~1'], remote), first, 'the old tip is the parent');
  assert.ok(show(remote, 'index.html').includes('home v2'));
  assert.ok(files(remote).includes('journal/index.html'));
  assert.equal(show(remote, 'CNAME'), 'greenfieldstudio.org');
  assert.ok(files(remote).includes('.nojekyll'));
  // A file that left the site leaves the branch, too.
  writeSite({ home: 'v2' });
  assert.equal(deploy(remote).code, 0);
  assert.equal(count(remote), 3);
  assert.ok(!files(remote).includes('journal/index.html'));
});

test('publishing the same site again makes no commit and no push', () => {
  writeSite();
  const remote = bare('noop', NO_FORCE_HOOK);
  assert.equal(deploy(remote).code, 0);
  const before = tip(remote);
  const r = deploy(remote);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing to publish/);
  assert.doesNotMatch(r.out, /pushing to/);
  assert.equal(tip(remote), before);
  assert.equal(count(remote), 1);
});

test('a change only in files the deploy leaves out makes no commit', () => {
  writeSite();
  const remote = bare('excluded', NO_FORCE_HOOK);
  assert.equal(deploy(remote).code, 0);
  const before = tip(remote);
  writeSite({ readme: 'v2' });
  const r = deploy(remote);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing to publish/);
  assert.equal(tip(remote), before);
});

test('the no-force hook is real: a force-push of a rewritten gh-pages is refused', () => {
  writeSite();
  const remote = bare('hook', NO_FORCE_HOOK);
  assert.equal(deploy(remote).code, 0);
  const before = tip(remote);
  const orphan = join(ROOT, 'orphan');
  git(['init', '-q', '-b', 'gh-pages', orphan]);
  put(join(orphan, 'x'), 'x');
  git(['add', '-A'], orphan);
  git(['commit', '-q', '-m', 'orphan'], orphan);
  const r = spawnSync('git', ['push', '--force', remote, 'gh-pages'], { cwd: orphan, encoding: 'utf8', env: ENV });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Cannot force-push/);
  assert.equal(tip(remote), before);
  rmSync(orphan, { recursive: true, force: true });
});

test('a remote that refuses the push: exit 1, says so, gh-pages untouched, never "done"', () => {
  writeSite();
  const remote = bare('refuse');
  assert.equal(deploy(remote).code, 0);
  const before = tip(remote);
  const hook = join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, REFUSE_ALL_HOOK);
  chmodSync(hook, 0o755);
  writeSite({ home: 'v2' });
  const r = deploy(remote);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /push failed/);
  assert.match(r.out, /GH013/);
  assert.doesNotMatch(r.out, /deploy: done/);
  assert.equal(tip(remote), before);
  assert.ok(!existsSync(join(SITE, '.deploy', '.git')), 'scratch repo removed after a failed push, too');
});

// Code lines only (comment-only lines dropped, the harmless rmSync option `force: true` removed).
const forceIn = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\bforce: true\b/g, '')).filter((l) => /force|['"]-f\w*['"]|['"]\+|`\+|\+HEAD|\+refs/i.test(l));
test('the push never carries --force (no force flag, "-f" or "+" refspec in the code)', () => {
  assert.deepEqual(forceIn(readFileSync(join(REAL, 'deploy.mjs'), 'utf8')), []);
  // and the detector does fire on the usual spellings
  for (const bad of ["x(['push', '--force', r])", "x(['push', '-f', r])", "x(['push', r, '+HEAD:refs/heads/gh-pages'])", "x(['push', '--force-with-lease'])"]) {
    assert.equal(forceIn(bad).length, 1, bad);
  }
});

test('an unreachable remote fails loudly and the token in its URL never reaches the output', () => {
  writeSite();
  const r = deploy('https://x-access-token:SECRETTOKEN123@127.0.0.1:9/none/none.git');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /reading gh-pages failed/);
  assert.doesNotMatch(r.out, /SECRETTOKEN123/);
});

test('dry run assembles but never touches the remote', () => {
  writeSite();
  const remote = bare('dry');
  const r = deploy(remote, []);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /dry run/);
  assert.equal(tip(remote), '');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack || e}`); }
}
rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${tests.length} failed.` : `\nall ${tests.length} passed.`);
process.exit(failed ? 1 : 0);

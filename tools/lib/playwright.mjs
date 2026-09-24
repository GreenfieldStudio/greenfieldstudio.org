// Resolve Playwright without making it a dependency of the site: use an installed copy if
// there is one, else borrow the Minigolf Pro checkout's (it already ships Playwright for its
// own e2e suite). Override with PLAYWRIGHT_PATH=<.../node_modules/playwright/index.mjs>.
import { join, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadPlaywright() {
  try { return await import('playwright'); } catch (_) {}
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    join(process.env.MINIGOLF_REPO || join(SITE, '..', 'minigolf-pro'), 'node_modules', 'playwright', 'index.mjs'),
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return import(pathToFileURL(p).href);
  throw new Error('Playwright not found. `npm i -D playwright` here, or set PLAYWRIGHT_PATH.');
}

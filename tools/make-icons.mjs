#!/usr/bin/env node
/**
 * make-icons.mjs — rasterize favicon.svg into favicon.ico (32 px) so legacy browsers get
 * the same mark as modern ones. ffmpeg has no SVG decoder here, so Chromium renders it.
 *   node tools/make-icons.mjs
 */
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { loadPlaywright } from './lib/playwright.mjs';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(SITE, 'favicon.svg'), 'utf8');
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 32, height: 32 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="32" height="32" ')}</body></html>`);
const png = join(tmpdir(), `gs-favicon-${process.pid}.png`);
await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: 32, height: 32 } });
await browser.close();
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, join(SITE, 'favicon.ico')], { stdio: 'inherit' });
rmSync(png, { force: true });
if (r.status !== 0) process.exit(1);
console.log('favicon.ico written (32×32 from favicon.svg)');

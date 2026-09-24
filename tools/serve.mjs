#!/usr/bin/env node
/**
 * serve.mjs — zero-dependency static server for previewing the site locally.
 * Behaves like GitHub Pages where it matters: directory URLs serve index.html,
 * unknown paths get /404.html with a 404 status, and media honours byte ranges
 * (browsers need Range to seek or loop a <video>).
 *
 *   node tools/serve.mjs                         # http://localhost:5501/
 *   node tools/serve.mjs --port 8080
 *   node tools/serve.mjs --base greenfieldstudio.org     # mimic the github.io project URL (/greenfieldstudio.org/)
 *   (write the base WITHOUT a leading slash: Git Bash rewrites "/x/" args into Windows paths)
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const ROOT = resolve(arg('root', join(dirname(fileURLToPath(import.meta.url)), '..')));
const PORT = Number(arg('port', 5501));
const BASE = ('/' + arg('base', '/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8',
};

function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  const abs = normalize(join(ROOT, p));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null; // traversal
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const idx = join(abs, 'index.html');
    return existsSync(idx) ? { file: idx, redirect: !urlPath.endsWith('/') } : null;
  }
  return existsSync(abs) ? { file: abs } : null;
}

function send(req, res, file, status = 200) {
  const size = statSync(file).size;
  const headers = {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && status === 200) {
    let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : size - 1;
    if (Number.isNaN(start) || start < 0 || start >= size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(status, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (!url.pathname.startsWith(BASE)) {
    if (BASE !== '/' && url.pathname === '/') { res.writeHead(302, { Location: BASE }); return res.end(); }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('outside --base');
  }
  const rel = '/' + url.pathname.slice(BASE.length);
  const hit = resolveFile(rel);
  if (hit && hit.redirect) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
  if (hit) return send(req, res, hit.file);
  const nf = join(ROOT, '404.html');
  if (existsSync(nf)) return send(req, res, nf, 404);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404');
}).listen(PORT, () => {
  console.log(`serving ${ROOT}\n  → http://localhost:${PORT}${BASE}`);
});

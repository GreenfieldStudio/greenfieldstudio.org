// Atomic writes for everything the site serves (WR-654, WS W-3): a file at its final name is either the
// old complete one or the new complete one, never a half-written or empty one, and no temp file stays.
// The temp file is `<stem>.new<ext>` in the SAME folder (so the rename never crosses a disk, and ffmpeg
// can still pick its muxer from the extension): hero-loop.webm -> hero-loop.new.webm.
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { extname } from 'node:path';

/** The temp name beside `out`: `a/b.webp` -> `a/b.new.webp`. */
export const tmpPath = (out) => { const e = extname(out); return `${out.slice(0, out.length - e.length)}.new${e}`; };

function flush(path) {
  const fd = openSync(path, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Write `data` (string or Buffer) to `path`: temp file beside it, flush, rename. On failure the old file is untouched and no temp is left. */
export function writeFileAtomic(path, data) {
  const tmp = tmpPath(path);
  try {
    const fd = openSync(tmp, 'w');
    try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true }); // after a successful rename this is a no-op
  }
}

/**
 * Let `produce(tmp)` (an ffmpeg run, a copy, a zip) write the temp file, then publish it at `out`.
 * produce returns true on success; a false, a throw, a missing or too small (< minBytes) temp file leave
 * `out` byte-identical and delete the temp. Returns true when `out` was replaced.
 */
export function publishAtomic(out, produce, { minBytes = 1 } = {}) {
  const tmp = tmpPath(out);
  rmSync(tmp, { force: true });
  try {
    if (!produce(tmp) || !existsSync(tmp) || statSync(tmp).size < minBytes) return false;
    flush(tmp);
    renameSync(tmp, out);
    return true;
  } finally {
    rmSync(tmp, { force: true });
  }
}

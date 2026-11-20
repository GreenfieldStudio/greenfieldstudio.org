// The three ways tools/make-media.mjs puts a file at its final name (ffmpeg output, copy, press zip), all
// atomic (WR-654, WS-05): the output is built beside the old file and renamed over it only when the tool
// exited 0 and wrote something. A failed or killed run leaves the old file byte-identical and no temp file.
// `run` / `copy` are for tests.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { publishAtomic } from './atomic.mjs';

/** One ffmpeg run into `out`; true when the new file replaced the old one. */
export function ffmpegTo(src, out, args, { inputArgs = [], run = spawnSync } = {}) {
  return publishAtomic(out, (tmp) => run('ffmpeg', ['-v', 'error', '-y', ...inputArgs, '-i', src, ...args, tmp], { stdio: 'inherit' }).status === 0);
}

/** Copy `src` over `out` atomically. */
export function copyTo(src, out, { copy = copyFileSync } = {}) {
  return publishAtomic(out, (tmp) => { copy(src, tmp); return true; });
}

/**
 * The press zip: `members` are file names inside `pressDir`. Windows' bsdtar (writes zip when the name ends in
 * .zip; the temp name keeps that ending) when `bsdtar` exists, else zip(1).
 */
export function zipTo(zip, pressDir, members, { run = spawnSync, bsdtar = 'C:/Windows/System32/tar.exe', exists = existsSync } = {}) {
  return publishAtomic(zip, (tmp) => {
    const r = exists(bsdtar)
      ? run(bsdtar, ['-a', '-c', '-f', tmp, '-C', pressDir, ...members], { stdio: 'inherit' })
      : run('zip', ['-q', '-j', tmp, ...members.map((m) => join(pressDir, m))], { stdio: 'inherit' });
    return r.status === 0;
  });
}

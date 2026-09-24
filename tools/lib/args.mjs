// Refuse unknown --options instead of silently ignoring them. A misspelt option otherwise
// falls back to a default without a word: `sync-game --dist <dir>` (the flag is --from) once
// copied a stale game build into play/ from the default location.
export function strictOptions(known) {
  const bad = process.argv.slice(2).filter((a) => a.startsWith('--') && !known.includes(a.slice(2)));
  if (bad.length) {
    console.error(`unknown option ${bad.join(', ')}. Known: ${known.map((k) => `--${k}`).join(' ')}`);
    process.exit(2);
  }
}

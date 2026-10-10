# Stem Music Setup

1. Copy `manifest.example.json` to `manifest.json`.
2. Replace stem file paths with your exported loops.
3. Keep every layer loop the same musical length (for example, 8 bars).
4. Export stems with identical sample rate and exact start point (bar 1 beat 1).

The runtime reads `/audio/stems/manifest.json` and falls back to procedural music if the file is missing.

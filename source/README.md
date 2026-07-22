# source/

Drop your **piano score in AlphaTex** here — one `.alphatab` file per piece.

The contents of this directory are gitignored (your inputs are yours, and are often
copyrighted). Only this README is tracked.

An acceptable source is *AlphaTex with pitched staves*: a score whose staves carry real
pitches (`\staff {score}`) rather than string/fret pairs. What the header claims the
instrument is does not matter — `CanonRock/Canon in D/cannon-rock-Piano.alphatab` declares
itself as electric guitar and bass, in Korean, and is still a perfectly good pitched source.

Ingest it with:

```
node tools/piano-validate.mjs source/<name>.alphatab
node tools/piano-extract.mjs source/<name>.alphatab
```

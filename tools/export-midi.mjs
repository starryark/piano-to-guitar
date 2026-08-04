// tools/export-midi.mjs — write a tab out as a Standard MIDI File.
// PTG-native (Wave 5). The alphaTab call sequence lives in lib/midi-export.mjs;
// this file is arguments, policy and an atomic write.
//
// Usage:
//   node tools/export-midi.mjs <tab.alphatab> --out <file.mid> [--force]
//        [--single-track] [--json]
//
// WHAT THIS IS FOR
// ----------------
// Getting the arrangement into a DAW, in front of an amp sim, and next to the
// source. It exports NOTES. It does not export tone, and General MIDI playback
// of this file tells you nothing about gain, cabinet response or pickup choice
// (contract C15) — see docs/specs/audio-rendering-decision.md.
//
// EXIT CONTRACT (C2):
//   0 = a complete MIDI file was written.
//   2 = usage / unparseable tab / IO failure / a refused overwrite.
//   1 = never. There is no musical gate here to fail.
//
// THREE POLICIES, DECLARED RATHER THAN DISCOVERED
// -----------------------------------------------
// 1. OVERWRITE IS OPT-IN. An existing `--out` is refused unless `--force`. The
//    thing most likely to sit at that path is the last export a human is
//    currently auditioning.
// 2. PARENT DIRECTORIES ARE NEVER CREATED. A missing directory is exit 2, not an
//    invitation to invent a tree — `--out projcts/foo/cover.mid` (typo) must
//    fail loudly rather than silently succeed somewhere nobody will look.
// 3. THE WRITE IS ATOMIC. Bytes go to a temporary file in the DESTINATION
//    directory (so the rename cannot cross a filesystem) and are renamed into
//    place only after the write returns. A crash therefore leaves either the old
//    file or no file — never a half-written one that a DAW will happily open.

import * as fs from 'node:fs';
import path from 'node:path';
import { loadTex } from './lib/score-utils.mjs';
import { scoreToMidi } from './lib/midi-export.mjs';
import { emit, emitErr } from './lib/emit.mjs';

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let out = null;
  let force = false;
  let singleTrack = false;
  let json = false;
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a.startsWith('--out=')) out = a.slice('--out='.length);
    else if (a === '--force') force = true;
    else if (a === '--single-track') singleTrack = true;
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
  }
  return { file, out, force, singleTrack, json };
}

const USAGE = 'Usage: node tools/export-midi.mjs <tab.alphatab> --out <file.mid> '
  + '[--force] [--single-track] [--json]';

const { file, out: outArg, force, singleTrack, json } = parseArgs(process.argv.slice(2));

/** Every failure route out of this tool is exit 2 (C2). */
function fail(...messages) {
  if (json) emit(JSON.stringify({ ok: false, file: file ?? null, errors: messages }, null, 2));
  for (const m of messages) emitErr(m);
  if (!json) emitErr(USAGE);
  process.exit(2);
}

if (!file) fail('No tab file given.');
if (!outArg) fail('No output path given (--out <file.mid>).');
if (!fs.existsSync(file)) fail(`No tab at "${file}".`);

const outPath = path.resolve(outArg);
const srcPath = path.resolve(file);

// Policy 0: never write over the input. A typo'd `--out` that lands on
// `cover.alphatab` would destroy the arrangement, and no flag makes that a
// reasonable thing to allow — so `--force` deliberately does NOT override it.
if (outPath === srcPath) {
  fail(`Refusing to write MIDI over the source tab "${file}".`);
}

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  // Policy 2: no directory creation. A missing parent is far more often a typo
  // than an intention.
  fail(`Output directory "${outDir}" does not exist. Create it first, or fix --out.`);
}
if (fs.existsSync(outPath) && !force) {
  fail(`"${outPath}" already exists. Pass --force to overwrite it.`);
}

// ---- parse -----------------------------------------------------------------
let loaded;
try {
  loaded = loadTex(file);
} catch (e) {
  fail(`Cannot read "${file}": ${e.message}`);
}
if (!loaded.ok) {
  fail(`"${file}" did not parse — run tools/validate.mjs for the diagnostics.`,
    ...loaded.errors.slice(0, 6).map((e) => `  ${(e.message ?? JSON.stringify(e)).trim()}`));
}

// ---- generate --------------------------------------------------------------
let midi;
try {
  midi = scoreToMidi(loaded.score, { multiTrack: !singleTrack });
} catch (e) {
  fail(`MIDI generation failed: ${e.message}`);
}

// ---- write, atomically -----------------------------------------------------
// The temp file lives in the DESTINATION directory so `rename` stays within one
// filesystem and is therefore atomic; a temp in the OS temp dir could land on a
// different device and degrade to a copy, which is exactly the non-atomic write
// this is avoiding. The pid keeps two concurrent exports from colliding.
const tmpPath = path.join(outDir, `.${path.basename(outPath)}.${process.pid}.tmp`);
try {
  fs.writeFileSync(tmpPath, midi.bytes);
  fs.renameSync(tmpPath, outPath);
} catch (e) {
  try { fs.rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
  fail(`Cannot write "${outPath}": ${e.message}`);
}

const result = {
  ok: true,
  file,
  out: outPath,
  bytes: midi.bytes.length,
  tracks: midi.tracks,
  format: midi.format,
  scoreTracks: loaded.score.tracks.length,
};

if (json) {
  emit(JSON.stringify(result, null, 2));
  process.exit(0);
}

emit(`MIDI EXPORT  ${file}`);
emit(`             -> ${outPath}`);
emit(`             ${midi.bytes.length} bytes, ${midi.tracks} MIDI track(s) `
  + `from ${loaded.score.tracks.length} score track(s), format ${midi.format}`);
emit('');
emit('NOTE  This exports NOTES, not TONE. General MIDI playback of this file says nothing');
emit('      about gain, cabinet response or pickup choice — route it through an amp sim or');
emit('      a guitar VST to judge those. See docs/specs/audio-rendering-decision.md.');
process.exit(0);

// Vendored from abc-to-guitar@ba7e29c — tools/midi.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// PTG: this file was substantially cut down in WP3. The ABC branch (abcjs) and
// PTG: the --backing two-track mode were deleted: this project has no ABC, no
// PTG: abcjs dependency, and the user chose a single electric-guitar output
// PTG: track with no backing render. What remains is the AlphaTex -> MIDI
// PTG: exporter, which serves BOTH sides of the pipeline — the piano source
// PTG: (for the reference recording) and the guitar tab (for the audition).
//
// midi.mjs — export an AlphaTex file (piano source or guitar arrangement) to
// standard MIDI, so the human can A/B them at every gate. That comparison IS
// the audition; no tool can judge whether the arrangement sounds good.
//
// CLI: node tools/midi.mjs <file.alphatab> [more...] [-o out.mid]
//
// Writes out/<basename>.mid. Exit 0 = all ok, 1 = at least one failure, 2 = usage.

import * as alphaTab from '@coderline/alphatab';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadTex } from './lib/score-utils.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(REPO_ROOT, 'out');

// ============================================================================
// CLI parsing
// ============================================================================
const argv = process.argv.slice(2);
const oIndex = argv.indexOf('-o');
const explicitOut = oIndex >= 0 ? argv[oIndex + 1] : null;
// Known value-taking flags; their values must not be treated as input files.
const valueFlags = new Set(['-o']);
// NB: guard on oIndex >= 0 — without it, `i !== oIndex + 1` becomes `i !== 0`
// and silently swallows the first input file.
const files = argv.filter((a, i) => {
  if (a.startsWith('--') && !valueFlags.has(a)) return false; // boolean flag
  if (valueFlags.has(a)) return false;                        // flag name
  // skip a value belonging to a value-taking flag
  if (i > 0 && valueFlags.has(argv[i - 1])) return false;
  return !a.startsWith('-');
});

function usageExit(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/midi.mjs <file.alphatab> [more...] [-o out.mid]');
  process.exit(2);
}

if (!files.length) usageExit();
if (explicitOut && files.length > 1) usageExit('-o takes a single input file');

mkdirSync(OUT_DIR, { recursive: true });
let failed = false;

// ============================================================================
// AlphaTex export
// ============================================================================
/** AlphaTex -> one .mid, via alphaTab's MIDI generator. */
function exportAlphaTex(file, base) {
  const result = loadTex(file);
  if (!result.ok) {
    throw new Error('parse failed:\n' +
      result.errors.map((e) => `      ${e.severity ?? 'error'} ${e.message}`).join('\n'));
  }
  const midiFile = new alphaTab.midi.MidiFile();
  // smf1Mode (the `true`) is required: MIDI 2.0 per-note bends cannot be
  // written to a .mid file, and this arrangement style leans on bends.
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, true);
  new alphaTab.midi.MidiFileGenerator(result.score, result.settings, handler).generate();

  const target = explicitOut ?? path.join(OUT_DIR, `${base}.mid`);
  const bytes = midiFile.toBinary();
  writeFileSync(target, bytes);
  console.log(`wrote ${path.relative(REPO_ROOT, target)} (${bytes.length} bytes, ` +
    `tempo ${result.score.tempo}, ${result.score.tracks.length} track(s))`);
}

// ============================================================================
// Dispatch
// ============================================================================
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, path.extname(file));
  try {
    if (ext === '.alphatab' || ext === '.tex') {
      exportAlphaTex(file, base);
    } else {
      throw new Error(`unknown extension "${ext}" — expected .alphatab`);
    }
  } catch (e) {
    console.error(`FAIL  ${file}: ${e.message}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);

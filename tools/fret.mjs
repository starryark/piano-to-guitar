#!/usr/bin/env node
// tools/fret.mjs — pitch <-> fret CLI: answer "what pitch is fret.string?" /
// "where does note X live?" / "is my bar's lowest note in the chord?" so an
// agent never hand-computes a fret.string token again.
//
//   node tools/fret.mjs <fret>.<string> [--maxfret N]                 FORWARD
//   node tools/fret.mjs <NoteName>       [--maxfret N]                REVERSE
//   node tools/fret.mjs <fret>.<string>... --pcset <tok>... --root <name>  PCSET-CHECK
//
// String numbering throughout is SOURCE/AlphaTex (string 1 = high e, string 6
// = low E) — the numbering `OPEN` and `positionsFor` already speak.
//
// Exit: 0 valid result / pcset PASS, 1 out-of-range / pcset FAIL, 2 usage.
// See docs/specs/tooling.md §A for the full contract.

import { OPEN, MAX_FRET, positionsFor } from './lib/fretboard.mjs';
import { midiToName } from './lib/score-utils.mjs';
import { nameToPc } from './lib/analysis.mjs';

const USAGE = 'Usage: node tools/fret.mjs <fret>.<string> | <NoteName> [--maxfret N] | ' +
  '<fret>.<string>… --pcset <n>… --root <name>';

function fail(msg) {
  console.error(`fret.mjs: ${msg}`);
  process.exit(2);
}

function usageFail() {
  console.error(USAGE);
  process.exit(2);
}

const FRET_STRING_RE = /^(\d+)\.(\d+)$/;
const NOTE_NAME_RE = /^([A-Ga-g])([#b]?)(-?\d+)$/;

// ---- argv split: positionals (before any --flag) + flags -----------------
function parseArgs(argv) {
  const positional = [];
  let i = 0;
  for (; i < argv.length; i++) {
    if (argv[i].startsWith('--')) break;
    positional.push(argv[i]);
  }
  const flags = { pcset: null, root: null, maxfret: null };
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pcset') {
      const toks = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) toks.push(argv[++i]);
      flags.pcset = toks;
    } else if (a === '--root') {
      flags.root = argv[++i];
    } else if (a === '--maxfret') {
      flags.maxfret = argv[++i];
    } else {
      usageFail();
    }
  }
  return { positional, flags };
}

/** Note name (sharp or flat) or bare integer 0..11 -> pitch class, or null. */
function tokenToPc(tok) {
  if (/^\d+$/.test(tok)) {
    const n = Number(tok);
    return n >= 0 && n <= 11 ? n : null;
  }
  return nameToPc(tok);
}

if (process.argv.length <= 2) usageFail();

const { positional, flags } = parseArgs(process.argv.slice(2));

// ---- mode selection (deterministic order, per spec A.2) -------------------
if (flags.pcset !== null) {
  // ---- PCSET-CHECK mode -----------------------------------------------
  if (positional.length === 0) fail('pcset mode requires at least one <fret>.<string> token');
  if (flags.root === null) fail('missing --root in pcset mode');

  const positions = [];
  for (const tok of positional) {
    const m = FRET_STRING_RE.exec(tok);
    if (!m) fail(`bad <fret>.<string> token '${tok}'`);
    const fret = Number(m[1]);
    const string = Number(m[2]);
    if (string < 1 || string > 6) fail(`string must be 1..6 (got ${string})`);
    positions.push({ fret, string, midi: OPEN[string] + fret });
  }

  const rootPc = tokenToPc(flags.root);
  if (rootPc === null) fail(`unknown note name '${flags.root}'`);

  if (flags.pcset.length === 0) fail('--pcset requires at least one token');
  const pcset = new Set();
  for (const tok of flags.pcset) {
    const p = tokenToPc(tok);
    if (p === null) fail(`unknown note name '${tok}'`);
    pcset.add(p);
  }

  const lowest = positions.reduce((a, b) => (a.midi <= b.midi ? a : b));
  const lowPc = ((lowest.midi % 12) + 12) % 12;
  const inSet = lowPc === rootPc || pcset.has(lowPc);
  const sortedPcs = [...pcset].sort((a, b) => a - b);

  console.log(
    `lowest ${lowest.fret}.${lowest.string} = ${midiToName(lowest.midi)} (pc ${lowPc}); ` +
    `root ${flags.root} (pc ${rootPc}), pcset {${sortedPcs.join(',')}} -> ` +
    `${inSet ? 'IN SET (OK)' : 'NOT IN SET (FAIL)'}`
  );
  process.exit(inSet ? 0 : 1);
}

if (positional.length !== 1) usageFail();
const tok = positional[0];

let maxFret = MAX_FRET;
if (flags.maxfret !== null) {
  if (!/^\d+$/.test(flags.maxfret)) fail(`bad --maxfret '${flags.maxfret}'; expected a non-negative integer`);
  maxFret = Number(flags.maxfret);
}

const fsMatch = FRET_STRING_RE.exec(tok);
const nameMatch = NOTE_NAME_RE.exec(tok);

if (fsMatch) {
  // ---- FORWARD mode -----------------------------------------------------
  const fret = Number(fsMatch[1]);
  const string = Number(fsMatch[2]);
  if (string < 1 || string > 6) fail(`string must be 1..6 (got ${string})`);
  const midi = OPEN[string] + fret;
  const name = midiToName(midi);
  const midiPc = ((midi % 12) + 12) % 12;
  let line = `${fret}.${string} = ${name} (pc ${midiPc})`;
  if (fret > maxFret) {
    line += ` [OUT OF RANGE: fret ${fret} > maxfret ${maxFret}]`;
    console.log(line);
    process.exit(1);
  }
  console.log(line);
  process.exit(0);
} else if (nameMatch) {
  // ---- REVERSE mode -------------------------------------------------------
  const letter = nameMatch[1].toUpperCase();
  const accidental = nameMatch[2];
  const octave = Number(nameMatch[3]);
  const pcv = nameToPc(letter + accidental);
  if (pcv === null) fail(`unknown note name '${tok}'`);
  const midi = pcv + 12 * (octave + 1);
  const positions = positionsFor(midi, { maxFret });
  const header = `${tok} (midi ${midi}, pc ${pcv}):`;
  if (positions.length === 0) {
    console.log(
      `${header} no playable position (out of range on a 6-string standard-tuned guitar, maxfret ${maxFret})`
    );
    process.exit(1);
  }
  const list = positions.map((p) => `${p.fret}.${p.string}`).join(' ');
  // When --maxfret filtered the reverse list, say so rather than dropping positions silently.
  let hiddenNote = '';
  if (flags.maxfret !== null) {
    const hidden = positionsFor(midi, { maxFret: MAX_FRET }).length - positions.length;
    if (hidden > 0) hiddenNote = `  (${hidden} position(s) above maxfret ${maxFret} hidden)`;
  }
  console.log(`${header} ${list}${hiddenNote}`);
  process.exit(0);
} else {
  usageFail();
}

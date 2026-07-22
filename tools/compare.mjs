// Vendored from abc-to-guitar@ba7e29c — tools/compare.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// compare.mjs — the fidelity gate between a reduced guitar tab and its source.
//
// Usage:
//   node tools/compare.mjs <tab.alphatab> <digest.json> --bars N-M
//       [--transpose N] [--json] [--map <sidecar.json>]
//
// This is a rock cover: NOT every source note is played, and that is correct.
// A plain note-coverage checker would flag every good artistic reduction as a
// defect. So this tool protects only what MUST survive a reduction and reports
// everything else as information the human weighs at the gate.
//
// HARD GATES (either failure => exit 1):
//   • Melodic skeleton coverage — every structural melody note in the digest's
//     `melodySkeleton` must appear in the tab's top-sounding line for that bar,
//     OCTAVE-EQUIVALENT (the arrangement octave-folds; that is correct). We
//     compare by pitch class only, never exact octave.
//   • Harmonic root motion — the tab bar's LOWEST sounding pitch class must
//     equal the digest chord root's pitch class OR be a member of its pcset
//     (a chord tone of that harmony).
//
// SOFT SIGNALS (reported, NEVER affect the exit code):
//   • Chord quality — with the power-chord rule: root+5th with no 3rd is a
//     correct rendering of BOTH major and minor, so a missing 3rd is never a
//     miss. Quality is informational only.
//   • Reduction density — "% of source notes retained". Low is expected/good.
//   • Dropped-note list per bar — source pitches whose class is absent from the
//     tab bar, so the human can judge the losses.
//   • Contour correlation — does the tab's top-line shape track the source's.
//
// --transpose N CONVENTION (exactly this, do not reinterpret):
//   N means the TAB is written N semitones ABOVE the source. All comparison
//   happens in SOURCE pitch space — we SUBTRACT N from every tab MIDI before
//   taking its pitch class. The digest is already source pitch. Default N = 0.
//
//   Derive N, never inherit it: N = (target key pitch class − source key pitch
//   class), reduced to the nearest signed value in −6..+5. Read the source key
//   from the digest's `key`; the target key is whatever Gate A approved. Sanity
//   check it against a note you can name in both — if the tab's tonic does not
//   land N semitones above the digest's, N is wrong and every gate below it is
//   measuring the wrong thing.
//
// CORRESPONDENCE-AWARE MODE (--map <sidecar.json>):
//   A tab whose bars do not align 1:1 with the source cannot be graded by the
//   bar-aligned loop above. --map supplies a sidecar of entries, each pinning a
//   contiguous tab span to a mode:
//     • free      — composed material (intro/coda/variation); NO fidelity gate.
//     • quote     — protect the melody: in-order subsequence match of the
//                  source skeleton pcs against the tab span's per-beat top-note
//                  pc sequence, PLUS root motion per proportional slice.
//     • recompose — root motion only: slice the tab span into N proportional
//                  pieces (N = source bar count) and chord-tone-check each.
//   The map REPLACES the 1:1 alignment loop. Fail-closed on every malformed
//   map, uncovered tab bar, missing source field, or contract violation —
//   the gate never weakens to a vacuous PASS. See `loadAndValidateMap` and
//   `runMapEntry` below for the exact rules.
//
// Output: JSON to stdout, same conventions as validate.mjs / playability.mjs
//   (top-level `ok`, `file`). Default = human-readable report; --json = machine
//   JSON. A machine result object is ALWAYS built:
//     { ok, file, digest, bars, transpose,
//       hardGates:{ melodicSkeleton, harmonicRoots }, soft:{...}, failures:[...] }
//   In --map mode the shape is:
//     { ok, file, digest, bars, transpose, map,
//       mapResults:[{mode, tabBars, sourceBars?, ok, failures:[]}], failures:[...] }
//   Exit 0 iff BOTH hard gates pass for every compared bar; 1 on any hard-gate
//   failure; 2 on usage / IO error.

import * as fs from 'fs';
import { loadTex, walkBeats, midiToName } from './lib/score-utils.mjs';
import { fromAlphaTabNote, STRING_COUNT } from './lib/fretboard.mjs';

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let transpose = 0;
  let json = false;
  let map = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--transpose') transpose = Number(argv[++i]);
    else if (a.startsWith('--transpose=')) transpose = Number(a.slice('--transpose='.length));
    else if (a === '--map') map = argv[++i];
    else if (a.startsWith('--map=')) map = a.slice('--map='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  return { file: positional[0] ?? null, digest: positional[1] ?? null, bars, transpose, json, map };
}

/** Parse "9-16" | "5" -> {lo, hi}; exit 2 on garbage. */
function parseBarRange(spec) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(spec).trim());
  if (!m) {
    console.error(`Bad --bars "${spec}"; expected N or N-M`);
    process.exit(2);
  }
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

const { file, digest: digestPath, bars, transpose, json, map: mapPath } = parseArgs(process.argv.slice(2));
if (!file || !digestPath || !bars) {
  console.error('Usage: node tools/compare.mjs <tab.alphatab> <digest.json> --bars N-M [--transpose N] [--json] [--map <file>]');
  process.exit(2);
}
if (!Number.isFinite(transpose)) {
  console.error(`Bad --transpose; expected an integer semitone offset`);
  process.exit(2);
}
const range = parseBarRange(bars);

// ---- pitch-class helpers --------------------------------------------------
const pc = (midi) => (((midi % 12) + 12) % 12);
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Note-name string ("Eb", "F#", "Bb", "C") -> pitch class 0..11. */
function noteNameToPc(name) {
  const s = String(name).trim();
  let p = LETTER_PC[s[0]?.toUpperCase()];
  if (p === undefined) return null;
  for (const ch of s.slice(1)) {
    if (ch === '#' || ch === '♯') p += 1;
    else if (ch === 'b' || ch === 'B' || ch === '♭') p -= 1;
  }
  return ((p % 12) + 12) % 12;
}

// ---- load inputs ----------------------------------------------------------
let digest;
try {
  digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read digest "${digestPath}": ${e.message}`);
  process.exit(2);
}

let loaded;
try {
  loaded = loadTex(file);
} catch (e) {
  console.error(`Cannot read tab "${file}": ${e.message}`);
  process.exit(2);
}
if (!loaded.ok) {
  const out = { ok: false, file, digest: digestPath, bars, transpose, errors: loaded.errors };
  console.log(JSON.stringify(out, null, 2));
  process.exit(2);
}
const { score } = loaded;

// ---- collect the tab, per bar, in SOURCE pitch space ----------------------
// For each bar we need: the top-sounding line (highest MIDI per beat), the set
// of all pitch classes present, the lowest pitch class, and an ordered top-line
// sequence for contour. Every tab MIDI is shifted DOWN by `transpose` first.
const tabBars = new Map(); // barNum -> { topPcs:Set, allPcs:Set, lowMidi, topSeq:[], noteCount }
walkBeats(score, ({ staff, bar, beat }) => {
  const barNum = bar.index + 1;
  if (barNum < range.lo || barNum > range.hi) return;
  if (beat.isRest || !beat.notes.length) return;
  const stringCount = staff.stringTuning?.tunings?.length || STRING_COUNT;

  let entry = tabBars.get(barNum);
  if (!entry) {
    entry = { topPcs: new Set(), allPcs: new Set(), lowMidi: Infinity, topSeq: [], noteCount: 0 };
    tabBars.set(barNum, entry);
  }

  let beatTop = -Infinity;
  for (const n of beat.notes) {
    const { midi } = fromAlphaTabNote(n, stringCount); // the ONE correct MIDI read
    if (!Number.isFinite(midi)) continue;
    const src = midi - transpose;                      // into source space
    entry.allPcs.add(pc(src));
    entry.noteCount++;
    if (src < entry.lowMidi) entry.lowMidi = src;
    if (src > beatTop) beatTop = src;
  }
  if (Number.isFinite(beatTop)) {
    entry.topPcs.add(pc(beatTop));
    entry.topSeq.push(beatTop);
  }
});

// ---- compare, bar by bar --------------------------------------------------
const digestByBar = new Map(digest.bars.map((b) => [b.bar, b]));

// ============================================================================
// CORRESPONDENCE-AWARE MODE (--map <file>)
// ============================================================================
// When --map is supplied the sidecar REPLACES the 1:1 bar-aligned loop. Each
// entry pins a contiguous TAB span to a mode:
//   free      — no fidelity gate (composed material).
//   quote     — in-order skeleton subsequence match + proportional root motion.
//   recompose — proportional root motion only.
// Every malformed map, uncovered tab bar, missing source field, or contract
// violation exits 2 — the gate never weakens to a vacuous PASS. The legacy
// bar-aligned loop below is skipped entirely when --map is present, so its
// behavior is byte-identical when --map is absent.
function mapUsage(msg) {
  console.error(`compare: ${msg}`);
  process.exit(2);
}

/** Validate a [start, end] inclusive range; return null on malformation. */
function badRange(r) {
  if (!Array.isArray(r) || r.length !== 2) return 'not a 2-element array';
  const [s, e] = r;
  if (!Number.isInteger(s) || !Number.isInteger(e)) return 'values not integers';
  if (s < 1 || e < 1) return 'values < 1';
  if (e < s) return 'end < start';
  return null;
}

/**
 * Load + fail-closed-validate a sidecar. Returns { song?, entries:[...] }.
 * Each normalized entry: { mode, tabBars:[s,e], sourceBars?:[s,e], note? }.
 * Source-bar existence in the digest is verified up front so per-mode logic
 * can index digestByBar.get() without re-checking.
 */
function loadAndValidateMap(mapPath, range, digestByBar) {
  let raw;
  try {
    raw = fs.readFileSync(mapPath, 'utf8');
  } catch (e) {
    mapUsage(`map file unreadable: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    mapUsage(`map file unreadable: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object') mapUsage('map file unreadable: top level is not an object');
  if (!Array.isArray(parsed.entries)) mapUsage('map missing "entries" array');
  if (parsed.entries.length === 0) mapUsage('map "entries" is empty');

  const seen = new Map(); // tabBar -> entryIndex, for coverage/overlap
  const entries = parsed.entries.map((entry, i) => {
    if (!entry || typeof entry !== 'object') mapUsage(`entry ${i} is not an object`);
    if (!('tabBars' in entry)) mapUsage(`entry ${i} missing "tabBars"`);
    if (!('mode' in entry)) mapUsage(`entry ${i} missing "mode"`);
    const mode = entry.mode;
    if (!['free', 'quote', 'recompose'].includes(mode)) {
      mapUsage(`entry ${i} mode "${mode}" not in {free, quote, recompose}`);
    }
    const tb = badRange(entry.tabBars);
    if (tb) mapUsage(`entry ${i} tabBars ${tb} (got ${JSON.stringify(entry.tabBars)})`);
    const [tS, tE] = entry.tabBars;

    let sourceBars = undefined;
    if (mode !== 'free') {
      if (!('sourceBars' in entry)) mapUsage(`entry ${i} mode "${mode}" requires "sourceBars"`);
      const sb = badRange(entry.sourceBars);
      if (sb) mapUsage(`entry ${i} sourceBars ${sb} (got ${JSON.stringify(entry.sourceBars)})`);
      const [sS, sE] = entry.sourceBars;
      for (let b = sS; b <= sE; b++) {
        if (!digestByBar.has(b)) {
          mapUsage(`entry ${i} sourceBars references bar ${b}, absent from the digest`);
        }
      }
      sourceBars = [sS, sE];
    }

    // Overlap check across tabBars ranges (any bar in exactly two entries =>
    // covered-by-multiple, which also fails the coverage check below; this
    // explicit pass makes the message unambiguous).
    for (let b = tS; b <= tE; b++) {
      if (seen.has(b)) mapUsage(`tab bar ${b} is covered by multiple entries`);
      seen.set(b, i);
    }

    const out = { mode, tabBars: [tS, tE] };
    if (sourceBars) out.sourceBars = sourceBars;
    if ('note' in entry) out.note = entry.note;
    return out;
  });

  // Coverage check: every tab bar in --bars must be covered by exactly one
  // entry. (Overlaps were rejected above, so this only catches gaps.)
  for (let b = range.lo; b <= range.hi; b++) {
    if (!seen.has(b)) mapUsage(`tab bar ${b} is uncovered`);
  }

  const out = { entries };
  if (parsed.song !== undefined) out.song = parsed.song;
  return out;
}

/**
 * Proportional slice of a tab span for source bar i (0-indexed) of N.
 * Returns [startBar, endBar] inclusive. T = tab span length, N = source span
 * length. Last slice absorbs the leftover so the union always equals [S, E].
 */
function proportionalSlice(tS, tE, i, N) {
  const T = tE - tS + 1;
  const lo = tS + Math.floor((i * T) / N);
  const hi = i === N - 1 ? tE : tS + Math.floor(((i + 1) * T) / N) - 1;
  return [lo, Math.max(lo, hi)];
}

/** Lowest tab pc in [lo, hi] inclusive, or null if the span has no tab notes. */
function lowestTabPcInSpan(lo, hi, tabBars, transpose) {
  let lowMidi = Infinity;
  for (let b = lo; b <= hi; b++) {
    const tb = tabBars.get(b);
    if (tb && Number.isFinite(tb.lowMidi) && tb.lowMidi < lowMidi) lowMidi = tb.lowMidi;
  }
  if (!Number.isFinite(lowMidi)) return null;
  return pc(lowMidi - transpose); // transpose-aware (into source space)
}

/** Concatenate per-beat top-note pc across tab bars [lo..hi] (transpose-aware). */
function tabTopPcSeq(lo, hi, tabBars, transpose) {
  const seq = [];
  for (let b = lo; b <= hi; b++) {
    const tb = tabBars.get(b);
    if (!tb) continue;
    for (const m of tb.topSeq) seq.push(pc(m - transpose));
  }
  return seq;
}

/**
 * In-order subsequence test: every element of `needle` must appear in
 * `haystack` in the same relative order (not necessarily contiguous).
 */
function isSubsequence(needle, haystack) {
  let i = 0;
  for (const h of haystack) {
    if (i < needle.length && needle[i] === h) i++;
  }
  return i === needle.length;
}

/** Run a single map entry's gate. Mutates `failures` (caller's) and returns
 *  { mode, tabBars, sourceBars?, ok, failures:[...] }. */
function runMapEntry(entry, tabBars, digestByBar, transpose) {
  const failures = [];
  const [tS, tE] = entry.tabBars;

  if (entry.mode === 'free') {
    return { mode: entry.mode, tabBars: entry.tabBars, ok: true, failures };
  }

  const [sS, sE] = entry.sourceBars;
  const sourceBarsList = [];
  for (let b = sS; b <= sE; b++) sourceBarsList.push(digestByBar.get(b));

  // Fail-open guard: each mapped source bar must carry the contract keys.
  for (let idx = 0; idx < sourceBarsList.length; idx++) {
    const sb = sourceBarsList[idx];
    if (!('melodySkeleton' in sb) || !('harmony' in sb)) {
      mapUsage(
        `source bar ${sb.bar} (referenced by tab span [${tS},${tE}]) is missing ` +
        `the melodySkeleton or harmony field — the gate would be vacuous`);
    }
  }

  if (entry.mode === 'quote') {
    // Skeleton in-order subsequence.
    const needle = [];
    for (const sb of sourceBarsList) {
      for (const n of (sb.melodySkeleton || [])) needle.push(pc(n.midi));
    }
    const hay = tabTopPcSeq(tS, tE, tabBars, transpose);
    if (!isSubsequence(needle, hay)) {
      failures.push({
        gate: 'melodicSkeleton', entry: entry.tabBars,
        message: `quote tabBars [${tS},${tE}] top-line pc sequence [${hay.join(',')}] ` +
          `does not contain source skeleton [${needle.join(',')}] in order`,
      });
    }
  }

  // Root motion (proportional slice) — runs for both quote and recompose.
  const N = sourceBarsList.length;
  for (let i = 0; i < N; i++) {
    const sb = sourceBarsList[i];
    const [lo, hi] = proportionalSlice(tS, tE, i, N);
    const lowPc = lowestTabPcInSpan(lo, hi, tabBars, transpose);
    const rootPc = noteNameToPc(sb.harmony?.root);
    const pcset = new Set(sb.harmony?.pcset || []);
    const ok = lowPc !== null && (lowPc === rootPc || pcset.has(lowPc));
    if (!ok) {
      const shown = lowPc === null ? 'no tab notes' : `lowest pc ${lowPc}`;
      failures.push({
        gate: 'harmonicRoots', entry: entry.tabBars, slice: i, sourceBar: sb.bar,
        tabSlice: [lo, hi],
        message: `recompose/quote slice ${i} (tab bars [${lo},${hi}] -> source bar ${sb.bar}): ` +
          `${shown} is neither root ${sb.harmony?.root} (pc ${rootPc}) ` +
          `nor a chord tone (pcset [${[...pcset].join(',')}])`,
      });
    }
  }

  const result = { mode: entry.mode, tabBars: entry.tabBars, sourceBars: entry.sourceBars,
    ok: failures.length === 0, failures };
  return result;
}

if (mapPath) {
  const map = loadAndValidateMap(mapPath, range, digestByBar);
  // Filter to entries whose tabBars intersect --bars. Coverage has already
  // been verified on the union of all entries for the whole --bars range;
  // entries entirely outside --bars are skipped from evaluation but their
  // tabBars still participated in the coverage/overlap checks above.
  const activeEntries = map.entries.filter((e) => {
    const [tS, tE] = e.tabBars;
    return tE >= range.lo && tS <= range.hi;
  });
  const mapResults = activeEntries.map((e) => runMapEntry(e, tabBars, digestByBar, transpose));
  const aggregated = mapResults.flatMap((r) => r.failures.map((f) => ({
    ...f,
    mode: r.mode,
    tabBars: r.tabBars,
    sourceBars: r.sourceBars,
  })));
  const mapOk = mapResults.every((r) => r.ok);

  const mapResult = {
    ok: mapOk,
    file,
    digest: digestPath,
    bars,
    transpose,
    map: mapPath,
    mapResults,
    failures: aggregated,
  };

  if (json) {
    console.log(JSON.stringify(mapResult, null, 2));
    process.exit(mapOk ? 0 : 1);
  }

  // Human-readable report: one line per entry.
  const tsign = transpose >= 0 ? `+${transpose}` : `${transpose}`;
  const rangeLabel = range.lo === range.hi ? `Bar ${range.lo}` : `Bars ${range.lo}-${range.hi}`;
  const lines = [];
  lines.push(`${rangeLabel} vs source (transpose ${tsign}, map ${mapPath})`);
  for (const r of mapResults) {
    const tag = r.sourceBars ? `  sourceBars=[${r.sourceBars.join(',')}]` : '';
    const tail = r.ok ? 'PASS' : `FAIL: ${r.failures[0].message}`;
    lines.push(`  ${r.mode.padEnd(9)} tabBars=[${r.tabBars.join(',')}]${tag}  ${tail}`);
    for (const f of r.failures.slice(1)) lines.push(`                     ${f.message}`);
  }
  console.log(lines.join('\n'));
  process.exit(mapOk ? 0 : 1);
}

const comparedBars = [];

let skelCovered = 0, skelTotal = 0;
let rootCovered = 0, rootTotal = 0;
let powerCount = 0, exactCount = 0;
let tabNoteCount = 0, sourceNoteCount = 0;
const dropped = [];       // { bar, notes:[names] }
const failures = [];      // { gate, bar, message }
const srcContour = [];    // aligned source melody skeleton pitches
const tabContour = [];    // aligned tab top-line pitches (source space)

for (let barNum = range.lo; barNum <= range.hi; barNum++) {
  const db = digestByBar.get(barNum);
  if (!db) continue; // digest has no such bar; nothing to protect here
  comparedBars.push(barNum);
  const tb = tabBars.get(barNum) || { topPcs: new Set(), allPcs: new Set(), lowMidi: Infinity, topSeq: [], noteCount: 0 };

  // --- HARD GATE 1: melodic skeleton coverage (octave-equivalent) ---------
  const skeleton = db.melodySkeleton || [];
  for (const note of skeleton) {
    skelTotal++;
    if (tb.topPcs.has(pc(note.midi))) {
      skelCovered++;
    } else {
      failures.push({
        gate: 'melodicSkeleton', bar: barNum,
        message: `bar ${barNum}: skeleton ${note.name || midiToName(note.midi)} ` +
          `(pc ${pc(note.midi)}) not in tab top line`,
      });
    }
  }

  // --- HARD GATE 2: harmonic root motion ----------------------------------
  // A bar with skeleton but no tab content can't satisfy the root gate either.
  if (skeleton.length > 0 || db.harmony) {
    rootTotal++;
    const rootPc = noteNameToPc(db.harmony?.root);
    const pcset = new Set(db.harmony?.pcset || []);
    const lowPc = Number.isFinite(tb.lowMidi) ? pc(tb.lowMidi) : null;
    if (lowPc !== null && (lowPc === rootPc || pcset.has(lowPc))) {
      rootCovered++;
    } else {
      const shown = lowPc === null ? 'no tab notes' : `lowest pc ${lowPc}`;
      failures.push({
        gate: 'harmonicRoots', bar: barNum,
        message: `bar ${barNum}: ${shown} is neither root ${db.harmony?.root} ` +
          `(pc ${rootPc}) nor a chord tone (pcset [${[...pcset].join(',')}])`,
      });
    }
  }

  // --- SOFT: chord quality (power-chord rule) -----------------------------
  if (db.harmony) {
    const rootPc = noteNameToPc(db.harmony.root);
    const hasThird = tb.allPcs.has((rootPc + 3) % 12) || tb.allPcs.has((rootPc + 4) % 12);
    if (hasThird) exactCount++; else powerCount++; // no 3rd => neutral, never a miss
  }

  // --- SOFT: density + dropped notes --------------------------------------
  tabNoteCount += tb.noteCount;
  const srcNotes = [];
  for (const v of db.voices || []) for (const n of v.notes) srcNotes.push(n);
  sourceNoteCount += srcNotes.length;

  const dropNames = [];
  const seen = new Set();
  for (const n of srcNotes) {
    if (tb.allPcs.has(pc(n.midi))) continue; // its class survived somewhere
    const nm = n.name || midiToName(n.midi);
    if (seen.has(nm)) continue;
    seen.add(nm);
    dropNames.push(nm);
  }
  if (dropNames.length) dropped.push({ bar: barNum, notes: dropNames });

  // --- SOFT: contour (align per bar by index to avoid cross-bar drift) -----
  const sk = skeleton.map((n) => n.midi);
  const k = Math.min(sk.length, tb.topSeq.length);
  for (let i = 0; i < k; i++) { srcContour.push(sk[i]); tabContour.push(tb.topSeq[i]); }
}

/** Pearson correlation of two equal-length series, or null if undefined. */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null; // a flat line has no contour to correlate
  return sxy / Math.sqrt(sxx * syy);
}
const contourR = pearson(srcContour, tabContour);

// ---- assemble the machine result ------------------------------------------
// CONTRACT CHECK — the hard gates FAIL OPEN by construction: `covered === total`
// is trivially true when total is 0, so a digest that lost its `melodySkeleton`
// or `harmony` fields would report PASS while protecting nothing. An empty
// skeleton for a given bar is legitimate (a bar of rests); a digest whose bars
// do not carry the KEY at all is contract drift, and must never read as a pass.
const barsInRange = [];
for (let b = range.lo; b <= range.hi; b++) {
  const db = digestByBar.get(b);
  if (db) barsInRange.push(db);
}
const missingSkeletonKey = barsInRange.filter((b) => !('melodySkeleton' in b));
const missingHarmonyKey = barsInRange.filter((b) => !('harmony' in b));
if (barsInRange.length && (missingSkeletonKey.length || missingHarmonyKey.length)) {
  console.error(
    `compare: digest ${digestPath} is missing required per-bar fields ` +
    `(${missingSkeletonKey.length} bar(s) without melodySkeleton, ` +
    `${missingHarmonyKey.length} without harmony). The fidelity gate cannot ` +
    'run and would otherwise report a vacuous PASS. Re-extract the digest: ' +   // PTG: was abc-extract.py
    'node tools/piano-extract.mjs <the .alphatab this tab was arranged from>');
  process.exit(2);
}

const melodicSkeleton = { covered: skelCovered, total: skelTotal, ok: skelCovered === skelTotal };
const harmonicRoots = { covered: rootCovered, total: rootTotal, ok: rootCovered === rootTotal };
const densityPercent = sourceNoteCount ? Math.round((tabNoteCount / sourceNoteCount) * 100) : null;
const ok = melodicSkeleton.ok && harmonicRoots.ok;

const result = {
  ok,
  file,
  digest: digestPath,
  bars,
  transpose,
  comparedBars,
  hardGates: { melodicSkeleton, harmonicRoots },
  soft: {
    chordQuality: { power: powerCount, exact: exactCount },
    density: { tabNotes: tabNoteCount, sourceNotes: sourceNoteCount, percent: densityPercent },
    dropped,
    contour: { r: contourR === null ? null : Number(contourR.toFixed(3)) },
  },
  failures,
};

// ---- output ---------------------------------------------------------------
if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

// Human-readable report (the format the human reads at the gate).
const tsign = transpose >= 0 ? `+${transpose}` : `${transpose}`;
const rangeLabel = range.lo === range.hi ? `Bar ${range.lo}` : `Bars ${range.lo}-${range.hi}`;
const lines = [];
lines.push(`${rangeLabel} vs source (transpose ${tsign})`);
lines.push(`  melodic skeleton   ${melodicSkeleton.covered}/${melodicSkeleton.total}   ${melodicSkeleton.ok ? 'OK' : 'FAIL'}`);
lines.push(`  harmonic roots     ${harmonicRoots.covered}/${harmonicRoots.total}   ${harmonicRoots.ok ? 'OK' : 'FAIL'}`);
lines.push(`  chord quality      ${powerCount} power-chord (major/minor neutral), ${exactCount} exact`);
lines.push(`  density            ${densityPercent === null ? 'n/a' : `${densityPercent}%`} of source notes retained`);
lines.push(`  contour            ${contourR === null ? 'n/a' : contourR.toFixed(2)} correlation with source top line`);
if (dropped.length) {
  const cap = 8;
  const fmt = ({ bar, notes }) => {
    const shown = notes.slice(0, cap).join(' ');
    const more = notes.length > cap ? ` (+${notes.length - cap} more)` : '';
    return `bar ${bar}: ${shown}${more}`;
  };
  lines.push(`  dropped            ${fmt(dropped[0])}`);
  for (const d of dropped.slice(1)) lines.push(`                     ${fmt(d)}`);
}
if (failures.length) {
  lines.push(`  failures           ${failures[0].message}`);
  for (const f of failures.slice(1)) lines.push(`                     ${f.message}`);
}
console.log(lines.join('\n'));
process.exit(ok ? 0 : 1);

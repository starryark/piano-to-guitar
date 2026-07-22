// tools/lib/analysis.mjs — the musical analysis behind the piano digest.
//
// PORT PROVENANCE
// ---------------
// The musical analysis is a port of abc-to-guitar/tools/abc-extract.py (1385
// lines). Only the *analysis* is ported; that file's front end reads MusicXML
// produced by abc2xml, and there is no MusicXML exporter in @coderline/alphatab
// (only AlphaTexExporter / Gp7Exporter / ScoreExporter), so the Python is a
// SPECIFICATION TO READ, never a runtime dependency. Lines 68-395 of the Python
// (run_abc2xml, read_unit_note_length, pitch_to_migi, spell_written,
// parse_measure) are MusicXML plumbing and are REPLACED by the alphaTab reader
// below, which gets explicit pitch and duration for free.
//
// Ported, with the Python line ranges they came from:
//   detect_harmony            154-192   -> detectHarmony       (P0, gate-critical)
//   top_line                  408-450   -> topLine             (P0)
//   strong_beats              451-467   -> strongBeats         (P0, gate-critical)
//   melody_skeleton           468-491   -> melodySkeleton      (P0, gate-critical)
//   fold_into_guitar          144-150   -> foldIntoGuitar      (P0)
//   bar_signature/similarity/
//     detect_duplicates       495-599   -> detectDuplicates    (P1)
//   detect_harmonic_loop      600-881   -> detectHarmonicLoop  (P1)
//   detect_sections           885-933   -> detectSections      (P1)
//   contour_string/render_map 1115-1313 -> contourString/renderMap (P1)
//
// Every deliberate departure from the Python is marked `// DIVERGENCE:` and
// explains itself. Search for that token to audit them all at once.
//
// TRAPS (measured, see the build plan §2.6):
//  * NEVER call fromAlphaTabNote() from lib/fretboard.mjs on a pitched note.
//    Pitched notes carry string === -1, so it computes OPEN[7 - (-1)] ===
//    undefined and returns {string: 8, fret: -1} — garbage that does not throw.
//    That helper is the guitar-OUTPUT-side boundary. Here we read
//    note.realValue directly and emit no string/fret at all.
//  * Piano voice indices are STAFF-GLOBAL: in canon-in-d-hard staff 0 uses
//    voices 0-3 and staff 1 uses voices 4-7. melodyVoice / bassVoice are
//    therefore derived from SOUNDING REGISTER (mean MIDI), never from a voice,
//    staff or track index, and never from a track name (the corpus has Korean
//    track names).
//  * The declared key signature lies (Canon Rock 1 declares \ks c while
//    sounding in E). `key` is inferred from pitch content; the declared value
//    is reported alongside it as `keyDeclared` and never used for anything.

import * as alphaTab from '@coderline/alphatab';
import * as fs from 'fs';
import * as path from 'path';
import { QUARTER_TICKS } from './score-utils.mjs';

export { QUARTER_TICKS };

// Practical sounding guitar range in standard tuning: E2 (40) .. ~E5 (76).
export const GUITAR_LOW = 40;
export const GUITAR_HIGH = 76;

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// fifths -> major tonic (used for the score-level key label). Python 41-48.
export const MAJOR_BY_FIFTHS = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};
export const MINOR_BY_FIFTHS = {
  '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D',
  0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#',
};

// Chord templates: [quality, intervals, symbol-suffix]. Order matters only for
// stable tie-breaking; the scoring below decides the winner. Python 52-65.
export const CHORD_TEMPLATES = [
  ['maj7', [0, 4, 7, 11], 'maj7'],
  ['min7', [0, 3, 7, 10], 'm7'],
  ['dom7', [0, 4, 7, 10], '7'],
  ['dim7', [0, 3, 6, 9], 'dim7'],
  ['m7b5', [0, 3, 6, 10], 'm7b5'],
  ['maj', [0, 4, 7], ''],
  ['min', [0, 3, 7], 'm'],
  ['dim', [0, 3, 6], 'dim'],
  ['aug', [0, 4, 8], 'aug'],
  ['sus4', [0, 5, 7], 'sus4'],
  ['sus2', [0, 2, 7], 'sus2'],
  ['5', [0, 7], '5'],
];

// --------------------------------------------------------------------------- //
// small numeric helpers
// --------------------------------------------------------------------------- //
const round4 = (x) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;
const mod12 = (x) => ((x % 12) + 12) % 12;

/** Python's `_int_if_whole` (395-396). */
export function intIfWhole(x) {
  return Number.isInteger(x) ? x : Math.round(x * 100) / 100;
}

/** Python tuple comparison: element-wise, booleans compare as 0/1. */
function cmpTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    let x = a[i];
    let y = b[i];
    if (typeof x === 'boolean') x = x ? 1 : 0;
    if (typeof y === 'boolean') y = y ? 1 : 0;
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// --------------------------------------------------------------------------- //
// pitch / naming helpers (Python 134-149)
// --------------------------------------------------------------------------- //
export function pcName(midi, preferFlat) {
  const names = preferFlat ? FLAT_NAMES : SHARP_NAMES;
  return names[mod12(midi)];
}

export function midiName(midi, preferFlat) {
  const names = preferFlat ? FLAT_NAMES : SHARP_NAMES;
  return `${names[mod12(midi)]}${Math.floor(midi / 12) - 1}`;
}

/** Python fold_into_guitar (144-148): raise by octaves until inside the guitar. */
export function foldIntoGuitar(midi) {
  let m = midi;
  while (m < GUITAR_LOW) m += 12;
  return m;
}

// Reverse name -> pitch class (Python 654-665). The union of SHARP_NAMES and
// FLAT_NAMES covers every name detectHarmony can emit.
const NAME_TO_PC = {};
SHARP_NAMES.forEach((n, i) => { if (!(n in NAME_TO_PC)) NAME_TO_PC[n] = i; });
FLAT_NAMES.forEach((n, i) => { if (!(n in NAME_TO_PC)) NAME_TO_PC[n] = i; });

export function nameToPc(name) {
  return name in NAME_TO_PC ? NAME_TO_PC[name] : null;
}

// --------------------------------------------------------------------------- //
// harmony: pitch-class set -> {root, quality, symbol, pcset}   (Python 154-192)
// --------------------------------------------------------------------------- //
/**
 * Deterministic best-fit chord from the pitch classes in a bar.
 *
 * `opts.anchorBass` (default TRUE) is a DIVERGENCE from the Python — see the
 * long comment below. Pass `{ anchorBass: false }` for byte-faithful Python
 * behaviour; analysis.test.mjs asserts both modes.
 *
 * DIVERGENCE (deliberate, and the reason this port exists):
 *   The Python searches every pitch class in the bar for the best-fitting
 *   template and gives the sounding bass a +1 nudge (line 170-171). On a
 *   chaconne — exactly the shape of this project's corpus — that nudge is too
 *   small: bar 1 of canon-in-d-hard sounds {D, A} over a low A, and the Python
 *   scores D5 at 6 against Asus4 at 5, reporting the root a fourth away from
 *   the bass. Across a Pachelbel ground bass that turns the root motion into
 *   maj7 mush, which the build plan names as a KNOWN WEAKNESS OF THE PYTHON
 *   that must not be inherited silently.
 *   With anchorBass the root is pinned to the sounding bass pitch class and
 *   only the QUALITY is searched. That is how a figured-bass / ground-bass
 *   piano texture actually states its harmony: the left hand names the root.
 *   When no template fits over the bass at all (a semitone dyad, a single
 *   pitch) we take the Python's own `note` fallback rooted on that same bass
 *   rather than hunting for a foreign root — a C#/D dyad is not a "Dmaj7".
 *
 *   CONSEQUENCE, and it is a contract the arranger can rely on: whenever a bar
 *   sounds at all, `harmony.root` IS the lowest sounding pitch class. Root
 *   motion in this digest is the bass line. The price is that inversions are
 *   labelled from the bass (C/E reads as "Em"); the gate is unaffected, since
 *   compare.mjs accepts the root OR any member of `pcset`, and `pcset` still
 *   carries every pitch class in the bar.
 *
 *   The full Python search is still used verbatim when anchoring cannot apply
 *   (anchorBass:false, or a bassPc that does not sound in the bar).
 */
export function detectHarmony(pcsPresent, bassPc, preferFlat, opts = {}) {
  const anchorBass = opts.anchorBass !== false;
  if (!pcsPresent || pcsPresent.length === 0) return null;
  const present = [...new Set(pcsPresent.map(mod12))];

  const search = (roots) => {
    let best = null; // [score, isBassRoot, -idx, root, quality, suffix]
    for (let idx = 0; idx < CHORD_TEMPLATES.length; idx++) {
      const [quality, intervals, suffix] = CHORD_TEMPLATES[idx];
      const tset = new Set(intervals);
      for (const root of roots) {
        const rel = new Set(present.map((p) => mod12(p - root)));
        let matched = 0;
        for (const t of tset) if (rel.has(t)) matched++;
        const missing = tset.size - matched;
        let extra = 0;
        for (const r of rel) if (!tset.has(r)) extra++;
        if (matched < 2) continue;
        let score = matched * 3 - missing * 2 - extra;
        if (root === bassPc) score += 1;
        const key = [score, root === bassPc, -idx, root, quality, suffix];
        if (best === null || cmpTuple(key, best) > 0) best = key;
      }
    }
    return best;
  };

  const canAnchor = anchorBass && bassPc !== null && bassPc !== undefined
    && present.includes(mod12(bassPc));
  // Anchored: search the quality over the bass root only, and never widen the
  // root search on a miss — a miss means "no chord here", not "some other root".
  const best = canAnchor ? search([mod12(bassPc)]) : search(present);

  const pcset = [...present].sort((a, b) => a - b);
  if (best === null) {
    // No template fit (e.g. a single pitch class): report the bass as root.
    const root = (bassPc !== null && bassPc !== undefined) ? mod12(bassPc) : pcset[0];
    return {
      root: pcName(root, preferFlat),
      quality: 'note',
      symbol: pcName(root, preferFlat),
      pcset,
    };
  }
  const [, , , root, quality, suffix] = best;
  return {
    root: pcName(root, preferFlat),
    quality,
    symbol: pcName(root, preferFlat) + suffix,
    pcset,
  };
}

// --------------------------------------------------------------------------- //
// melodic line extraction (Python 408-491)
// --------------------------------------------------------------------------- //
/**
 * Collapse a (possibly chordal) voice into a monophonic line: one note per
 * onset — the highest (melody) or lowest (bass) at that onset. Python 408-422.
 */
export function topLine(notes, highest = true) {
  const byOnset = new Map();
  for (const n of notes) {
    const o = n.onset;
    if (!byOnset.has(o)) {
      byOnset.set(o, n);
    } else {
      const cur = byOnset.get(o);
      if ((highest && n.midi > cur.midi) || (!highest && n.midi < cur.midi)) byOnset.set(o, n);
    }
  }
  return [...byOnset.keys()].sort((a, b) => a - b).map((o) => byOnset.get(o));
}

// Strong-beat onsets in quarter-note beats from the bar start, by meter. The
// downbeat is always strong; these supply the secondary accents. Python 434-448.
//
// This table exists because halving the bar is only correct for duple meters.
// In 7/4 barBeats/2 is 3.5 — a position that falls BETWEEN quarter-note onsets,
// so it never matches any note and the bar silently degrades to "downbeat
// only". Same for 3/4 (1.5) and every other odd numerator. Since melodySkeleton
// is what the hard fidelity gate protects, that shrinks the protected set
// without any error being reported.
export const STRONG_BEATS = new Map([
  ['2/2', [0.0, 2.0]],
  ['4/4', [0.0, 2.0]],
  ['2/4', [0.0]],
  ['3/4', [0.0]],
  ['5/4', [0.0, 3.0]],       // 3+2
  ['6/4', [0.0, 3.0]],       // 3+3
  ['7/4', [0.0, 2.0, 4.0]],  // 2+2+3
  ['3/8', [0.0]],
  ['5/8', [0.0, 1.5]],       // 3+2 eighths
  ['6/8', [0.0, 1.5]],       // 3+3
  ['7/8', [0.0, 1.0, 2.0]],  // 2+2+3
  ['9/8', [0.0, 1.5, 3.0]],
  ['12/8', [0.0, 1.5, 3.0, 4.5]],
]);

/** Strong-beat onsets for a meter, in quarter-note beats. Python 451-465. */
export function strongBeats(timeNum, timeDen, barBeats) {
  const known = STRONG_BEATS.get(`${timeNum}/${timeDen}`);
  if (known !== undefined) return known.filter((b) => b < barBeats + 0.01);
  // Compound duple/triple/quadruple: accent every dotted-quarter group.
  if (timeDen === 8 && timeNum % 3 === 0) {
    const out = [];
    for (let i = 0; i < Math.floor(timeNum / 3); i++) out.push(round4(i * 1.5));
    return out;
  }
  // Simple meter, even numerator: downbeat + midpoint is genuinely correct.
  if (timeNum % 2 === 0 && barBeats) return [0.0, round4(barBeats / 2.0)];
  // Anything else: downbeat only. Never invent an accent that could land
  // between onsets — a missing strong beat costs coverage, a phantom one costs
  // correctness.
  return [0.0];
}

/**
 * Structural subset: on a strong beat OR >= 1 beat long OR a contour turn.
 * Python 468-489.
 */
export function melodySkeleton(melody, barBeats, timeNum = 4, timeDen = 4) {
  if (!melody || melody.length === 0) return [];
  const strong = strongBeats(timeNum, timeDen, barBeats);
  const out = [];
  for (let i = 0; i < melody.length; i++) {
    const n = melody[i];
    const onset = n.onset;
    const isStrong = strong.some((s) => Math.abs(onset - s) < 0.01);
    const isLong = n.beats >= 1.0;
    let isTurn = false;
    if (i > 0 && i < melody.length - 1) {
      const prevM = melody[i - 1].midi;
      const nextM = melody[i + 1].midi;
      const curM = n.midi;
      if ((curM > prevM && curM > nextM) || (curM < prevM && curM < nextM)) isTurn = true;
    }
    if (isStrong || isLong || isTurn) out.push(n);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// duplicate-range detection (Python 495-597)
// --------------------------------------------------------------------------- //
/**
 * Exact, order-independent signature of a bar's full note content. Python
 * returns a tuple; JS has no hashable tuples, so we serialise the sorted list
 * to a string. `EMPTY_SIG` is the analogue of Python's `()`.
 */
export const EMPTY_SIG = '[]';

export function barSignature(flatNotes) {
  const sorted = [...flatNotes].sort(cmpTuple);
  return JSON.stringify(sorted);
}

/** Pitch-class multiset overlap between two bars (0..1). Python 500-508. */
export function barSimilarity(aNotes, bNotes) {
  const count = (notes) => {
    const c = new Map();
    for (const t of notes) {
      const k = mod12(t[2]);
      c.set(k, (c.get(k) || 0) + 1);
    }
    return c;
  };
  const ca = count(aNotes);
  const cb = count(bNotes);
  let inter = 0;
  for (const [k, v] of ca) inter += Math.min(v, cb.get(k) || 0);
  const sa = [...ca.values()].reduce((a, b) => a + b, 0);
  const sb = [...cb.values()].reduce((a, b) => a + b, 0);
  return inter / Math.max(sa, sb, 1);
}

/** Maximal consecutive exact-match runs at a fixed bar offset. Python 511-538. */
export function findExactRuns(sigs, minLen = 4) {
  const n = sigs.length;
  const runs = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + minLen; b < n; b++) {
      if (sigs[a] !== sigs[b] || sigs[a] === EMPTY_SIG) continue;
      let length = 0;
      while (
        b + length < n
        && sigs[a + length] === sigs[b + length]
        && sigs[a + length] !== EMPTY_SIG
      ) length++;
      if (length >= minLen) runs.push([length, a, a + length - 1, b, b + length - 1]);
    }
  }
  runs.sort((x, y) => -cmpTuple(x, y)); // longest first (Python sort(reverse=True))
  const accepted = [];
  const used = new Set();
  for (const [, a1, a2, b1, b2] of runs) {
    const span = [];
    for (let i = a1; i <= a2; i++) span.push(i);
    for (let i = b1; i <= b2; i++) span.push(i);
    if (span.some((i) => used.has(i))) continue;
    accepted.push([a1, a2, b1, b2]);
    for (const i of span) used.add(i);
  }
  return accepted;
}

/** Compare equal-length sections; report near-identical ones. Python 541-561. */
export function findNearSections(sections, barsFlat, sigs, minLen = 4) {
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const [a1, a2] = sections[i];
      const [b1, b2] = sections[j];
      if ((a2 - a1) !== (b2 - b1)) continue;
      if ((a2 - a1 + 1) < minLen) continue;
      const length = a2 - a1 + 1;
      const sims = [];
      let exact = true;
      for (let k = 0; k < length; k++) {
        if (sigs[a1 + k] !== sigs[b1 + k]) exact = false;
        sims.push(barSimilarity(barsFlat[a1 + k], barsFlat[b1 + k]));
      }
      const avg = sims.reduce((x, y) => x + y, 0) / sims.length;
      if (!exact && avg >= 0.85) out.push([a1, a2, b1, b2, Math.round(avg * 1000) / 1000]);
    }
  }
  return out;
}

/**
 * Combine exact runs and near-identical sections into duplicateRanges.
 * (barsFlat / sigs are 0-indexed; sections are 0-indexed inclusive pairs.)
 * Reported ranges are converted to 1-based bar numbers. Python 564-597.
 */
export function detectDuplicates(barsFlat, sigs, sections) {
  const near = findNearSections(sections, barsFlat, sigs);
  const exact = findExactRuns(sigs);

  const result = [];
  const nearSpans = [];
  for (const [a1, a2, b1, b2, avg] of near) {
    result.push({ a: [a1 + 1, a2 + 1], b: [b1 + 1, b2 + 1], kind: 'near-identical', similarity: avg });
    nearSpans.push([a1, a2, b1, b2]);
  }

  const contained = (a1, a2, b1, b2) => nearSpans.some(([na1, na2, nb1, nb2]) =>
    (a1 - b1) === (na1 - nb1) && na1 <= a1 && a2 <= na2 && nb1 <= b1 && b2 <= nb2);

  for (const [a1, a2, b1, b2] of exact) {
    if (contained(a1, a2, b1, b2)) continue;
    result.push({ a: [a1 + 1, a2 + 1], b: [b1 + 1, b2 + 1], kind: 'identical' });
  }
  result.sort((x, y) => x.a[0] - y.a[0]);
  return result;
}

// --------------------------------------------------------------------------- //
// harmonic-loop / ground-bass detection (Python 600-879)
// --------------------------------------------------------------------------- //
// A "harmonic loop" is the structural fact that a piece is one repeating chord
// progression: a chaconne, a pop loop, a Pachelbel-style ground bass. When that
// holds, "quote the melody, recompose the rest" becomes tractable — so surface
// it as data.
export const COVERAGE_MIN = 0.80;  // >= 80% of bars from firstBar to last must match
export const PASSES_MIN = 3;       // >= 3 full traversals of the cycle
export const MIN_CYCLE_LEN = 2;
export const MAX_CYCLE_LEN = 8;

/**
 * Tuple identity for a bar's harmony, serialised to a string so it can be
 * compared with ===. null -> null (silent position). Python 625-651.
 *
 * NB: the root pc is recovered from harmony.root (a NAME like "D" or "Bb"),
 * NOT from pcset[0] — pcset is sorted, so pcset[0] is the LOWEST pitch class,
 * which for a Dmaj7 with a passing C# would report the root as C#.
 */
export function harmonyKey(harmony, rootOnly = false) {
  if (!harmony || (harmony.quality === 'note' && !(harmony.pcset && harmony.pcset.length))) return null;
  const rootName = harmony.root;
  const rootPc = rootName ? nameToPc(rootName) : null;
  if (rootPc === null || rootPc === undefined) return null;
  return rootOnly ? `${rootPc}` : `${rootPc}|${harmony.quality}`;
}

function firstNonemptyBar(harmonySeq) {
  for (let i = 0; i < harmonySeq.length; i++) if (harmonySeq[i] !== null) return i;
  return null;
}

/** Score a candidate cycle starting at firstBarIdx with length L. Python 676-737. */
export function evalLoop(harmonySeq, firstBarIdx, L) {
  const tail = harmonySeq.slice(firstBarIdx);
  if (tail.length < L * PASSES_MIN) return null;

  const cycleKeys = new Array(L).fill(null);
  const cycleSeen = new Array(L).fill(false);
  for (let k = 0; k < L; k++) {
    const obs = tail[k];
    if (obs !== null && obs !== undefined) { cycleKeys[k] = obs; cycleSeen[k] = true; }
  }
  // A slot silent in pass 1 may be voiced in pass 2. Deterministic on pass index.
  for (let p = 1; p < PASSES_MIN; p++) {
    for (let k = 0; k < L; k++) {
      const idx = p * L + k;
      if (idx >= tail.length) break;
      if (!cycleSeen[k] && tail[idx] !== null && tail[idx] !== undefined) {
        cycleKeys[k] = tail[idx];
        cycleSeen[k] = true;
      }
    }
  }
  // A permanently-silent slot is a hole, not a cycle.
  if (!cycleSeen.every(Boolean)) return null;

  const total = tail.length;
  let matched = 0;
  for (let i = 0; i < tail.length; i++) {
    const slot = cycleKeys[i % L];
    if (tail[i] !== null && tail[i] === slot) matched++;
  }
  const coverage = total ? matched / total : 0.0;
  const passes = Math.floor(tail.length / L);
  if (passes < PASSES_MIN) return null;
  if (coverage < COVERAGE_MIN) return null;
  return { coverage, passes, cycleKeys };
}

/** Find the shortest repeating harmonic cycle in the piece, or null. Python 740-879. */
export function detectHarmonicLoop(bars) {
  const n = bars.length;
  if (n < MIN_CYCLE_LEN * PASSES_MIN) return null;

  const harmonyStrict = bars.map((b) => harmonyKey(b.harmony, false));
  const harmonyRoot = bars.map((b) => harmonyKey(b.harmony, true));

  const bestForView = (view) => {
    // Candidate firstBar positions in priority order: earliest first. A start
    // must have a chord to anchor; position 0 is included as a cheap fallback.
    const candidates = new Set([0]);
    for (let i = 0; i < view.length; i++) if (view[i] !== null) candidates.add(i);
    const ordered = [...candidates].sort((a, b) => a - b);
    if (firstNonemptyBar(view) === null) return null;

    let best = null; // [firstBarIdx, L, ev]
    for (const fb of ordered) {
      for (let L = MIN_CYCLE_LEN; L <= MAX_CYCLE_LEN; L++) {
        const ev = evalLoop(view, fb, L);
        if (ev === null) continue;
        if (best === null || cmpTuple([fb, L], [best[0], best[1]]) < 0) best = [fb, L, ev];
      }
      // The outer key (firstBar) dominates the inner (L), so once a cycle is
      // found at this firstBar no later start can win.
      if (best !== null && best[0] === fb) return best;
    }
    return best;
  };

  // Strict (root_pc, quality) first; then relax to root only — the documented
  // escape hatch for chaconnes whose bass states roots without full triads.
  let best = bestForView(harmonyStrict);
  let rootOnly = false;
  if (best === null) {
    best = bestForView(harmonyRoot);
    rootOnly = true;
  }
  if (best === null) return null;

  const [firstBarIdx, L, ev] = best;
  const { coverage, passes, cycleKeys } = ev;
  const firstBar = bars[firstBarIdx].bar;

  const passesList = [];
  for (let p = 0; p < passes; p++) {
    const startIdx = firstBarIdx + p * L;
    const endIdx = startIdx + L - 1;
    if (endIdx >= n) break; // only full traversals count
    passesList.push([bars[startIdx].bar, bars[endIdx].bar]);
  }
  if (passesList.length < PASSES_MIN) return null;

  const cycle = [];
  for (let k = 0; k < L; k++) {
    let p = 0;
    let slotIdx = firstBarIdx + k;
    while (slotIdx < n && harmonyKey(bars[slotIdx].harmony, rootOnly) !== cycleKeys[k]) {
      p += 1;
      slotIdx = firstBarIdx + p * L + k;
    }
    const h = slotIdx < n ? bars[slotIdx].harmony : null;
    cycle.push({
      bar: slotIdx < n ? bars[slotIdx].bar : null,
      root: h ? h.root : null,
      quality: h ? h.quality : null,
      symbol: h ? h.symbol : null,
      pcset: h ? h.pcset : null,
    });
  }

  return {
    length: L,
    firstBar,
    passes: passesList,
    coverage: Math.round(coverage * 1e4) / 1e4,
    cycle,
    rootOnly, // tells the reader whether qualities were matched
  };
}

// --------------------------------------------------------------------------- //
// section detection (Python 885-931)
// --------------------------------------------------------------------------- //
/**
 * Section boundaries from structural barlines, fermatas, TS & tempo changes.
 * Returns { sections: [{startBar, endBar, reason}], idxRanges: [[s,e], ...] }.
 *
 * DIVERGENCE: MusicXML's `<bar-style>` does not exist in AlphaTex. The caller
 * supplies the AlphaTex analogues in `barlineStyles`: '||' (masterBar
 * isDoubleBar), 'repeat' (a repeat close, or the next bar opening a repeat) and
 * 'section' (the next bar carries a \section rehearsal marker). Everything
 * else — fermata, TS change, tempo change, the final bar — is exactly the
 * Python's logic.
 */
export function detectSections(bars, barlineStyles) {
  const n = bars.length;
  const boundaries = new Set();
  const reasons = new Map();
  for (let i = 0; i < n; i++) {
    const barNo = i + 1;
    const rec = bars[i];
    const style = barlineStyles.get(barNo);
    let reason = null;
    if (style === '|]') reason = '|]';
    else if (style === '||') reason = '||';
    else if (style === 'repeat') reason = 'repeat';
    else if (style === 'section') reason = 'section';
    else if (rec.fermata) reason = 'fermata';
    // a change in the NEXT bar also closes this one
    if (i + 1 < n) {
      const nxt = bars[i + 1];
      if (reason === null && nxt.tsChanged) reason = 'TS';
      if (reason === null && nxt.tempo !== rec.tempo) reason = 'tempo';
    }
    if (reason !== null || barNo === n) {
      boundaries.add(barNo);
      reasons.set(barNo, reason || 'end');
    }
  }

  const sections = [];
  const idxRanges = [];
  let start = 1;
  for (let barNo = 1; barNo <= n; barNo++) {
    if (boundaries.has(barNo)) {
      sections.push({ startBar: start, endBar: barNo, reason: reasons.get(barNo) });
      idxRanges.push([start - 1, barNo - 1]);
      start = barNo + 1;
    }
  }
  if (start <= n) {
    sections.push({ startBar: start, endBar: n, reason: 'end' });
    idxRanges.push([start - 1, n - 1]);
  }
  return { sections, idxRanges };
}

// --------------------------------------------------------------------------- //
// key inference from pitch content
// --------------------------------------------------------------------------- //
// REPLACES the Python's `<key><fifths>` read (lines 957-965). §2.1 fact 3 of
// the build plan is measured: the declared key signature LIES (Canon Rock 1
// declares \ks c while sounding in E). Krumhansl-Schmuckler profile
// correlation over a duration-weighted pitch-class histogram, which is the
// standard published method and needs no training data.
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_PC_TO_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
const MINOR_PC_TO_FIFTHS = { 9: 0, 4: 1, 11: 2, 6: 3, 1: 4, 8: 5, 3: 6, 2: -1, 7: -2, 0: -3, 5: -4, 10: -5 };

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx; const dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return -Infinity;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * `weights` is a 12-slot duration-weighted pitch-class histogram.
 * Returns { key, fifths, mode, tonicPc, preferFlat, confidence }.
 */
export function inferKey(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) {
    return { key: 'C', fifths: 0, mode: 'major', tonicPc: 0, preferFlat: false, confidence: 0 };
  }
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = weights.map((_, i) => weights[(i + tonic) % 12]);
    for (const [mode, profile] of [['major', KS_MAJOR], ['minor', KS_MINOR]]) {
      const r = pearson(rotated, profile);
      // Tie-break deterministically: higher r, then major before minor, then
      // the lower tonic pitch class.
      const key = [r, mode === 'major', -tonic];
      if (best === null || cmpTuple(key, best.key) > 0) best = { key, tonic, mode, r };
    }
  }
  const fifthsTable = best.mode === 'major' ? MAJOR_PC_TO_FIFTHS : MINOR_PC_TO_FIFTHS;
  const fifths = best.tonic in fifthsTable ? fifthsTable[best.tonic] : 0;
  const label = best.mode === 'major'
    ? MAJOR_BY_FIFTHS[String(fifths)]
    : `${MINOR_BY_FIFTHS[String(fifths)]}m`;
  return {
    key: label,
    fifths,
    mode: best.mode,
    tonicPc: best.tonic,
    preferFlat: fifths < 0,
    confidence: Math.round(best.r * 1e4) / 1e4,
  };
}

// --------------------------------------------------------------------------- //
// alphaTab front end — REPLACES the Python's MusicXML plumbing (lines 68-395)
// --------------------------------------------------------------------------- //
const SEVERITY = { 0: 'hint', 1: 'warning', 2: 'error' };

function collectDiagnostics(iterable) {
  const out = [];
  if (!iterable) return out;
  for (const d of iterable) {
    out.push({
      code: d.code,
      severity: SEVERITY[d.severity] ?? String(d.severity),
      message: d.message,
      line: d.start?.line,
      col: d.start?.col,
    });
  }
  return out;
}

/** Parse AlphaTex TEXT (not a path) into a Score. Mirrors score-utils' loadTex,
 *  which only accepts a path — the normalizer hands us a string. */
export function parseTex(text) {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(text, settings);
  try {
    return { ok: true, score: importer.readScore(), settings };
  } catch (e) {
    const source = typeof e.iterateDiagnostics === 'function' ? e
      : (e.inner && typeof e.inner.iterateDiagnostics === 'function') ? e.inner
        : (e.cause && typeof e.cause.iterateDiagnostics === 'function') ? e.cause
          : null;
    let errors = source ? collectDiagnostics(source.iterateDiagnostics()) : [];
    if (errors.length === 0) {
      for (const bag of [importer.lexerDiagnostics, importer.parserDiagnostics]) {
        if (bag?.items) errors.push(...collectDiagnostics(bag.items));
      }
    }
    if (errors.length === 0) errors = [{ severity: 'error', message: String(e.message ?? e) }];
    return { ok: false, errors };
  }
}

/**
 * ===================== WP1 INTEGRATION POINT =====================
 * Read a piano .alphatab, route it through WP1's normalizer if that module
 * exists, and parse it. WP1 owns tools/lib/piano-source.mjs (the AT218
 * pitched/fretted fix that unblocks canon-in-d-easy.alphatab); this is the ONE
 * place this work package touches it. The import is dynamic and optional so
 * the extractor keeps working — on the five files that parse unaided — while
 * WP1 is still in flight. When WP1 lands, nothing here needs to change.
 * =================================================================
 */
export async function loadPianoScore(file) {
  let mod = null;
  try {
    mod = await import('./piano-source.mjs');
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    // WP1 has not landed — fall through and read/parse the raw text ourselves.
  }

  const normalizer = { available: false, rewrites: 0, skipped: 0, encoding: 'utf8' };

  // Encoding: WP1's reader detects utf-8 / utf-8-bom / latin-1 and reports it.
  // Never assume UTF-8 — the corpus carries non-ASCII (Korean) track names.
  let text;
  if (mod && typeof mod.readPianoSource === 'function') {
    const read = mod.readPianoSource(file);
    text = read.text;
    normalizer.encoding = read.encoding;
  } else {
    text = fs.readFileSync(file).toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  }

  let normalized = text;
  const fn = mod && (mod.normalizePianoSource || mod.normalize || mod.default);
  if (typeof fn === 'function') {
    const res = fn(text);
    if (typeof res === 'string') {
      normalized = res;
    } else if (res && typeof res === 'object') {
      normalized = res.text ?? res.normalized ?? res.source ?? res.out ?? text;
      const rw = res.rewrites ?? res.edits ?? null;
      normalizer.rewrites = Array.isArray(rw) ? rw.length
        : (res.counts?.negativeFretRests ?? res.count ?? 0);
      normalizer.skipped = Array.isArray(res.skipped) ? res.skipped.length
        : (res.counts?.negativeFretSkipped ?? 0);
      normalizer.detail = res.counts ?? null;
    }
    normalizer.available = true;
  }

  const parsed = parseTex(normalized);
  return { ...parsed, text, normalized, normalizer, encoding: normalizer.encoding };
}

const ARPEGGIO_BRUSH = new Set([3, 4]); // BrushType.ArpeggioUp / ArpeggioDown
// alphaTab spells the enum `Ottavia` (sic) — Regular === 2, i.e. NO octave
// transposition. Anything else is a real 8va/8vb/15ma sign. Comparing against
// 0 or a truthiness test would flag every bar in the corpus.
const OTTAVA_REGULAR = 2;

/** Read a single bar (across every track/staff/voice) into a raw record. */
function readBar(score, barIndex, state, preferFlat) {
  const mb = score.masterBars[barIndex];
  const timeNum = mb.timeSignatureNumerator;
  const timeDen = mb.timeSignatureDenominator;
  const tsChanged = state.seenFirstBar
    && (timeNum !== state.timeNum || timeDen !== state.timeDen);

  // Tempo: masterBar.tempoAutomations is where AlphaTex's \tempo lands. The
  // downbeat tempo is the one in force at the bar start; a later automation in
  // the same bar changes the running tempo for the NEXT bar (Python 258-264).
  let downbeatTempo = state.tempo;
  let currentTempo = state.tempo;
  const autos = [...(mb.tempoAutomations || [])].sort(
    (a, b) => (a.ratioPosition ?? 0) - (b.ratioPosition ?? 0));
  for (const a of autos) {
    const v = Number(a.value);
    if (!Number.isFinite(v)) continue;
    if ((a.ratioPosition ?? 0) <= 0) downbeatTempo = v;
    currentTempo = v;
  }

  const notesByVoice = new Map();  // globalVoiceId -> [note]
  const voiceMeta = new Map();     // globalVoiceId -> {track, staff, voice}
  const flatNotes = [];            // [voiceId, onset, midi, beats, tied]
  let maxPos = 0.0;
  let hasFermata = mb.fermata ? (mb.fermata.size ?? 0) > 0 : false;
  let hasArpeggio = false;
  let hasBrush = false;
  let hasOttava = false;
  let hasTuplet = false;
  let hasGrace = false;

  for (let t = 0; t < score.tracks.length; t++) {
    const track = score.tracks[t];
    for (const staff of track.staves) {
      const bar = staff.bars[barIndex];
      if (!bar) continue;
      for (const voice of bar.voices) {
        // Voice ids are STAFF-GLOBAL (staff 1 of canon-in-d-hard uses 4-7); the
        // track offset only disambiguates multi-track sources such as
        // cannon-rock-Piano. For a single-track score this is voice.index.
        const vid = t * 100 + voice.index;
        for (const beat of voice.beats) {
          const onset = round4(beat.playbackStart / QUARTER_TICKS);
          const beats = round4(beat.playbackDuration / QUARTER_TICKS);
          const end = onset + beats;
          if (end > maxPos) maxPos = end;
          if (beat.fermata) hasFermata = true;
          if (ARPEGGIO_BRUSH.has(beat.brushType)) hasArpeggio = true;
          else if (beat.brushType) hasBrush = true;
          if (Number.isFinite(beat.ottava) && beat.ottava !== OTTAVA_REGULAR) hasOttava = true;
          if (beat.hasTuplet || (beat.tupletDenominator > 1)) hasTuplet = true;
          if (beat.graceType) hasGrace = true;
          if (beat.isRest) continue;
          for (const note of beat.notes) {
            // TRAP: never fromAlphaTabNote() here — pitched notes carry
            // string === -1 and it silently returns garbage. realValue is the
            // sounding MIDI number and is the only correct read on this side.
            const midi = note.realValue;
            if (!Number.isFinite(midi)) continue;
            const tuplet = beat.tupletDenominator > 1
              ? `${beat.tupletNumerator}:${beat.tupletDenominator}` : null;
            const ornaments = [];
            if (ARPEGGIO_BRUSH.has(beat.brushType)) ornaments.push('arpeggio');
            if (beat.fermata) ornaments.push('fermata');
            const rec = {
              midi,
              name: midiName(midi, preferFlat),
              beats,
              onset,
              tied: !!note.isTieDestination,
              tuplet,
              ornaments,
            };
            if (!notesByVoice.has(vid)) {
              notesByVoice.set(vid, []);
              voiceMeta.set(vid, { track: t, staff: staff.index, voice: voice.index });
            }
            notesByVoice.get(vid).push(rec);
            flatNotes.push([vid, onset, midi, beats, rec.tied]);
          }
        }
      }
    }
  }

  state.timeNum = timeNum;
  state.timeDen = timeDen;
  state.tempo = currentTempo;
  state.seenFirstBar = true;

  const barBeats = timeNum * 4.0 / timeDen;
  const presentVoices = [...notesByVoice.keys()].sort((a, b) => a - b);
  const voices = presentVoices.map((v) => ({
    voice: v,
    ...voiceMeta.get(v),
    notes: notesByVoice.get(v),
  }));

  // Melody = the highest-SOUNDING voice, bass = the lowest — derived from
  // pitch, never from voice/staff/track order (Python 336-351). Piano voice
  // ids are staff-global and the corpus's track names are non-ASCII: neither
  // is a usable signal.
  const meanMidi = (v) => {
    const ns = notesByVoice.get(v);
    return ns.length ? ns.reduce((a, n) => a + n.midi, 0) / ns.length : 0.0;
  };
  let trebleV = null;
  let bassV = null;
  if (presentVoices.length) {
    const ranked = [...presentVoices].sort((a, b) => cmpTuple([-meanMidi(a), a], [-meanMidi(b), b]));
    trebleV = ranked[0];
    bassV = ranked[ranked.length - 1];
  }

  const melody = topLine(notesByVoice.get(trebleV) || [], true);
  const bass = topLine(notesByVoice.get(bassV) || [], false);
  const bassFolded = bass.map((n) => ({
    ...n,
    midi: foldIntoGuitar(n.midi),
    name: midiName(foldIntoGuitar(n.midi), preferFlat),
  }));
  const skeleton = melodySkeleton(melody, barBeats, timeNum, timeDen);

  // ---- harmony: sub-bar resolution (WP2b, build plan §0.1) -----------------
  // The corpus's harmonic rhythm is FINER than one bar. canon-in-d-hard is a
  // chaconne with TWO chords per bar (D | A Bm | F#m G | D G | A at half-bar
  // resolution). Detecting one harmony per bar merges both chords plus the
  // bar's passing tones into a single pcset, which widens to the whole D-major
  // scale (mean width 6.33 of 12 — measured). That made compare.mjs's
  // harmonicRoots gate ~53% permissive: it degraded from "does this bar sit on
  // the right chord?" to "is this note diatonic?" and reported PASS while
  // protecting almost nothing.
  //
  // Fix, measured before coding (probe across all six corpus files):
  //  1. ROOT stays the WHOLE-BAR lowest sounding pitch class — unchanged. This
  //     preserves the §3.3 invariant "harmony.root === lowest sounding pc in
  //     every bar, 0 violations across all 797 bars" verbatim, and the §2.1
  //     measured bass line (A F# D G …) reproduces exactly. The width defect
  //     was never a root-accuracy defect (§0.1).
  //  2. PCSET is narrowed to the PRIMARY half-bar's harmonic stratum: notes of
  //     duration >= 1 beat (quarter note or longer) — i.e. the bass and any
  //     sustained chord tones, NOT the sixteenth-note passing-tone runs a
  //     chaconne decorates itself with. An eighth-note passing tone does not
  //     define a chord; a half note does. When the texture carries no long
  //     notes at all (most lead-line cover bars), fall back to every note in
  //     that half-bar — never widen to the whole bar.
  //  3. The "primary" half-bar is the one that SOUNDS the bar's lowest note —
  //     so the root lives in the pcset's own chord, not its neighbour's. When
  //     the lowest note sounds in both halves, the first half wins by
  //     convention; the root is identical either way.
  //
  // This is NOT "weight tuning of the chord table" (which WP5 measured was
  // unnecessary): CHORD_TEMPLATES and the scoring formula are untouched. Only
  // the pcset INPUT is stratified, by duration, inside the analysis window.
  // canon-in-d-hard: mean width 6.33 -> 2.65, ZERO bars at 7 pcs. Every other
  // corpus file narrows too; none regresses.
  const halfBeats = barBeats / 2;
  const allPcs = [];
  const allMidis = [];
  // Per-half-bar note buckets, carrying the duration needed to pick the stratum.
  const halfA = []; // onset in [0, halfBeats)
  const halfB = []; // onset in [halfBeats, barBeats]
  for (const v of voices) {
    for (const n of v.notes) {
      allPcs.push(mod12(n.midi));
      allMidis.push(n.midi);
      const bucket = n.onset < halfBeats ? halfA : halfB;
      bucket.push({ midi: n.midi, beats: n.beats });
    }
  }
  const bassPc = allMidis.length ? mod12(Math.min(...allMidis)) : null;

  // Whole-bar chord (root+quality search), for the legacy single-harmony field.
  // Kept byte-faithful: same input pcs, same bassPc, same detectHarmony call.
  const harmony = detectHarmony(allPcs, bassPc, preferFlat);

  // Narrow the pcset to the primary half-bar's harmonic stratum. The root and
  // symbol computed above are REUSED — only pcset is replaced — so the §3.3
  // invariant and the chaconne bass line are preserved by construction.
  if (harmony && bassPc !== null && (halfA.length || halfB.length)) {
    const bassMidi = Math.min(...allMidis);
    // Primary half-bar = the one containing the bar's lowest sounding note.
    const prim = halfA.some((n) => n.midi === bassMidi) ? halfA : halfB;
    const stratum = prim.filter((n) => n.beats >= 1.0);
    const sourceNotes = stratum.length ? stratum : prim;
    const narrowed = [...new Set(sourceNotes.map((n) => mod12(n.midi)))].sort((a, b) => a - b);
    // Guarantee the root pc is present in the pcset: compare.mjs accepts the
    // root OR any pcset member, so a missing root is harmless to the gate, but
    // keeping it makes the pcset read as "this chord" to a human.
    if (!narrowed.includes(mod12(bassPc))) narrowed.push(mod12(bassPc));
    narrowed.sort((a, b) => a - b);
    harmony.pcset = narrowed;
  }

  // harmonySpans: the full per-half-bar chord sequence, for the bar map and any
  // future finer-grained gate. compare.mjs does not read this today (the single
  // narrowed `harmony` already fixes §0.1); it is additive contract surface.
  const harmonySpans = [halfA, halfB].map((win) => {
    if (!win.length) return null;
    const longNotes = win.filter((n) => n.beats >= 1.0);
    const src = longNotes.length ? longNotes : win;
    const pcs = src.map((n) => mod12(n.midi));
    const spanBassPc = mod12(Math.min(...src.map((n) => n.midi)));
    return detectHarmony(pcs, spanBassPc, preferFlat);
  });

  return {
    record: {
      timeSig: `${timeNum}/${timeDen}`,
      barBeats: round4(barBeats),
      filledBeats: round4(maxPos),
      tempo: intIfWhole(downbeatTempo),
      tsChanged,
      fermata: hasFermata,
      arpeggio: hasArpeggio,
      brush: hasBrush,
      ottava: hasOttava,
      tuplet: hasTuplet,
      grace: hasGrace,
      isDoubleBar: !!mb.isDoubleBar,
      repeatClose: (mb.repeatCount || 0) > 0,
      hasSectionMark: !!mb.section,
      voices,
      melodyVoice: trebleV,
      bassVoice: bassV,
      melody: melody.map(slim),
      melodySkeleton: skeleton.map(slim),
      bass: bass.map(slim),
      bassFolded: bassFolded.map(slim),
      harmony,
      harmonySpans,
    },
    flatNotes,
  };
}

/** Python `_slim` (399-405). */
function slim(note) {
  return { midi: note.midi, name: note.name, beats: note.beats, onset: note.onset };
}

/** Python `_finalize_bar` (1089-1109): order the keys per the schema contract. */
function finalizeBar(rec) {
  const out = {
    bar: rec.bar,
    sourceBarNumber: rec.sourceBarNumber,
    timeSig: rec.timeSig,
    tempo: rec.tempo,
    tempoChanged: rec.tempoChanged,
    voices: rec.voices,
    melodyVoice: rec.melodyVoice,
    bassVoice: rec.bassVoice,
    melody: rec.melody,
    melodySkeleton: rec.melodySkeleton,
    bass: rec.bass,
    bassFolded: rec.bassFolded,
    harmony: rec.harmony,
    harmonySpans: rec.harmonySpans,
    flags: rec.flags,
  };
  if (rec.pickup) out.pickup = true;
  return out;
}

/**
 * Build the digest from a parsed Score. The output shape is the contract in
 * §2.5 of the build plan; tools/compare.mjs reads it directly and exits 2 when
 * a referenced bar is missing melodySkeleton or harmony.
 */
export function buildDigest(score, meta = {}) {
  const nBars = score.masterBars.length;

  // --- pass 1: duration-weighted pitch-class histogram, for key inference ----
  const weights = new Array(12).fill(0);
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isRest) continue;
            const w = Math.max(beat.playbackDuration / QUARTER_TICKS, 0.001);
            for (const note of beat.notes) {
              if (!Number.isFinite(note.realValue)) continue;
              weights[mod12(note.realValue)] += w;
            }
          }
        }
      }
    }
  }
  const inferred = inferKey(weights);
  const preferFlat = inferred.preferFlat;

  // Declared key signature — REPORTED, NEVER TRUSTED (§2.1 fact 3).
  const firstBar = score.tracks[0]?.staves[0]?.bars[0];
  const declaredFifths = firstBar ? (firstBar.keySignature ?? 0) : 0;
  const declaredMinor = firstBar ? (firstBar.keySignatureType === 1) : false;
  const declaredKey = declaredMinor
    ? `${MINOR_BY_FIFTHS[String(declaredFifths)] ?? '?'}m`
    : (MAJOR_BY_FIFTHS[String(declaredFifths)] ?? '?');

  // --- pass 2: per-bar records --------------------------------------------
  const state = { timeNum: 4, timeDen: 4, tempo: score.tempo || 120, seenFirstBar: false };
  const barRecords = [];
  const barsFlat = [];
  const barlineStyles = new Map();
  let hasPickup = false;

  for (let i = 0; i < nBars; i++) {
    const { record, flatNotes } = readBar(score, i, state, preferFlat);
    record.bar = i + 1;
    // Bar identity is POSITIONAL — detectSections/detectDuplicates index by
    // position, so any other numbering desynchronises every downstream range.
    // AlphaTex carries no bar numbers of its own, so sourceBarNumber is the
    // positional number too; it stays in the contract for cross-referencing.
    record.sourceBarNumber = i + 1;
    const mb = score.masterBars[i];
    if (i === 0 && (mb.isAnacrusis || record.filledBeats < record.barBeats - 0.01)) {
      record.pickup = true;
      hasPickup = true;
    }
    barRecords.push(record);
    barsFlat.push(flatNotes);
  }

  // Structural barlines, AlphaTex flavour (see detectSections' DIVERGENCE note).
  for (let i = 0; i < nBars; i++) {
    const rec = barRecords[i];
    const nxt = barRecords[i + 1];
    const nextMb = score.masterBars[i + 1];
    if (rec.isDoubleBar) barlineStyles.set(i + 1, '||');
    else if (rec.repeatClose || (nextMb && nextMb.isRepeatStart)) barlineStyles.set(i + 1, 'repeat');
    else if (nxt && nxt.hasSectionMark) barlineStyles.set(i + 1, 'section');
  }

  // tempo-change flags relative to the previous bar's downbeat tempo
  let prevTempo = null;
  for (const rec of barRecords) {
    rec.tempoChanged = prevTempo !== null && rec.tempo !== prevTempo;
    prevTempo = rec.tempo;
  }

  const meterInitial = barRecords.length ? barRecords[0].timeSig : '4/4';
  const tempoInitial = barRecords.length ? barRecords[0].tempo : null;

  const allMidis = [];
  for (const rec of barRecords) for (const v of rec.voices) for (const n of v.notes) allMidis.push(n.midi);
  const low = allMidis.length ? Math.min(...allMidis) : 0;
  const high = allMidis.length ? Math.max(...allMidis) : 0;
  const below = allMidis.filter((m) => m < GUITAR_LOW).length;
  const above = allMidis.filter((m) => m > GUITAR_HIGH).length;

  const sigs = barsFlat.map(barSignature);
  const { sections, idxRanges } = detectSections(barRecords, barlineStyles);
  const duplicateRanges = detectDuplicates(barsFlat, sigs, idxRanges);
  const harmonicLoop = detectHarmonicLoop(
    barRecords.map((r) => ({ bar: r.bar, harmony: r.harmony })));

  for (const rec of barRecords) {
    const flags = [];
    if (rec.arpeggio) flags.push('arpeggio');
    if (rec.brush) flags.push('brush');
    if (rec.ottava) flags.push('8va');
    if (rec.tsChanged) flags.push('tsChange');
    if (rec.fermata) flags.push('fermata');
    if (rec.tuplet) flags.push('tuplet');
    if (rec.grace) flags.push('grace');
    const outOfRange = rec.voices.some((v) => v.notes.some(
      (n) => n.midi < GUITAR_LOW || n.midi > GUITAR_HIGH));
    if (outOfRange) flags.push('outOfRange');
    if (!rec.voices.length) flags.push('empty');
    // A bar that HAS melody notes but whose skeleton came back empty is
    // unprotected by compare.mjs's hard gate. That is the Python's behaviour
    // (a 2-note melody has no interior note, so no contour turn is possible,
    // and neither note is on a strong beat or >= 1 beat long) and it is kept
    // for parity — but it is FLAGGED rather than left silent, so a fail-open
    // hole is greppable in the digest instead of being discovered at the gate.
    if (rec.melody.length && !rec.melodySkeleton.length) flags.push('noSkeleton');
    // A source voice that overruns its own meter (canon-in-d-hard bar 45 holds
    // 6 beats of one voice inside a 4/4 bar). Report it — the onsets past the
    // barline are real, and an arranger reading the map needs to know.
    if (rec.filledBeats > rec.barBeats + 0.01) flags.push('overfull');
    rec.flags = flags;
  }

  return {
    song: meta.song || score.title || meta.stem || '',
    sourceFile: meta.sourceFile || '',
    key: inferred.key,
    keyFifths: inferred.fifths,
    keyMode: inferred.mode,
    keyConfidence: inferred.confidence,
    // The declared \ks is REPORTED, never used. Canon Rock 1 declares \ks c
    // while sounding in E — trusting it would mis-spell every note name.
    keyDeclared: declaredKey,
    keyDeclaredFifths: declaredFifths,
    keyDisagrees: declaredFifths !== inferred.fifths,
    meterInitial,
    tempoInitial,
    guitarRange: { lowMidi: GUITAR_LOW, highMidi: GUITAR_HIGH },
    pitchRange: {
      lowMidi: low,
      lowName: midiName(low, preferFlat),
      highMidi: high,
      highName: midiName(high, preferFlat),
    },
    rangeDeficit: { belowLowCount: below, aboveHighCount: above },
    partCount: score.tracks.length,
    pickup: hasPickup,
    sections,
    duplicateRanges,
    bars: barRecords.map(finalizeBar),
    harmonicLoop,
  };
}

/** One call: path -> { digest, preferFlat, normalizer } (or throws). */
export async function extractDigest(file) {
  const loaded = await loadPianoScore(file);
  if (!loaded.ok) {
    const err = new Error(`cannot parse ${file}`);
    err.diagnostics = loaded.errors;
    throw err;
  }
  const stem = path.basename(file).replace(/\.[^.]+$/, '');
  const digest = buildDigest(loaded.score, {
    sourceFile: path.basename(file),
    stem,
    song: loaded.score.title || stem,
  });
  return { digest, preferFlat: digest.keyFifths < 0, normalizer: loaded.normalizer };
}

// --------------------------------------------------------------------------- //
// map.md rendering (Python 1115-1311)
// --------------------------------------------------------------------------- //
export function contourString(skeleton) {
  if (!skeleton || !skeleton.length) return '';
  const parts = [skeleton[0].name];
  for (let i = 1; i < skeleton.length; i++) {
    const prev = skeleton[i - 1];
    const cur = skeleton[i];
    const arrow = cur.midi > prev.midi ? '/' : (cur.midi < prev.midi ? '\\' : '=');
    parts.push(arrow + cur.name);
  }
  return parts.join(' ');
}

/** Render the pass list, compressing runs of contiguous full passes. Python 1167-1200. */
export function compressPasses(passes) {
  if (!passes || !passes.length) return 'none';
  const runs = [];
  let startPass = 1;
  let groupStart = passes[0][0];
  let groupEnd = passes[0][1];
  for (let i = 1; i < passes.length; i++) {
    const p = passes[i];
    if (p[0] === groupEnd + 1) {
      groupEnd = p[1];
    } else {
      runs.push([startPass, i, groupStart, groupEnd]);
      startPass = i + 1;
      groupStart = p[0];
      groupEnd = p[1];
    }
  }
  runs.push([startPass, passes.length, groupStart, groupEnd]);
  return runs.map(([f, l, sb, eb]) => (f === l
    ? `pass ${f} (bars ${sb}-${eb})`
    : `passes ${f}-${l} (bars ${sb}-${eb})`)).join(', ');
}

function renderHarmonicLoop(digest) {
  const hl = digest.harmonicLoop;
  if (!hl) {
    return ['## Harmonic loop', '',
      'No repeating harmonic progression detected (no cycle of length 2-8 with '
      + '>=80% coverage and >=3 passes).', ''];
  }
  const out = ['## Harmonic loop', '',
    `- Cycle length: **${hl.length}** bars  |  First bar: **${hl.firstBar}**`
    + `  |  Coverage: **${Math.round(hl.coverage * 100)}%**  |  Passes: **${hl.passes.length}**`];
  if (hl.rootOnly) {
    out.push('  _matched on root motion only; chord qualities vary across passes '
      + 'and the spellings below are the first-observed voicing._');
  }
  const symbols = hl.cycle.map((s) => (s && s.symbol ? s.symbol : '(rest)'));
  out.push('');
  out.push(`- Cycle: \`${symbols.join(' -> ')}\``);
  out.push('');
  out.push(`- Passes: ${compressPasses(hl.passes)}`);
  out.push('');
  return out;
}

export function renderMap(digest, preferFlat) {
  const lines = [];
  lines.push(`# Bar map -- ${digest.song}`);
  lines.push('');
  lines.push(`- Source: \`${digest.sourceFile}\``);
  lines.push(
    `- Key (inferred from pitch content): **${digest.key}** (fifths ${digest.keyFifths}, `
    + `r=${digest.keyConfidence})`);
  lines.push(
    `- Key declared by \`\\ks\`: **${digest.keyDeclared}** (fifths ${digest.keyDeclaredFifths})`
    + (digest.keyDisagrees
      ? '  — **DISAGREES with the sounding key; the declaration is not trusted anywhere '
        + 'in this digest.**'
      : '  — agrees.'));
  lines.push(
    `- Initial meter: **${digest.meterInitial}**  |  Initial tempo: **${digest.tempoInitial}** BPM`);
  const pr = digest.pitchRange;
  const gr = digest.guitarRange;
  const rd = digest.rangeDeficit;
  lines.push(
    `- Pitch range: **${pr.lowName}..${pr.highName}** (MIDI ${pr.lowMidi}..${pr.highMidi})  vs guitar `
    + `${midiName(gr.lowMidi, preferFlat)}..${midiName(gr.highMidi, preferFlat)} `
    + `(MIDI ${gr.lowMidi}..${gr.highMidi})`);

  const melVotes = new Map();
  const bassVotes = new Map();
  for (const b of digest.bars) {
    if (b.melodyVoice !== null && b.melodyVoice !== undefined) {
      melVotes.set(b.melodyVoice, (melVotes.get(b.melodyVoice) || 0) + 1);
    }
    if (b.bassVoice !== null && b.bassVoice !== undefined) {
      bassVotes.set(b.bassVoice, (bassVotes.get(b.bassVoice) || 0) + 1);
    }
  }
  const topVote = (m) => (m.size
    ? [...m.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))[0][0] : '?');
  lines.push(
    `- Melody voice: **${topVote(melVotes)}**  |  Bass voice: **${topVote(bassVotes)}**  `
    + '(chosen by sounding register, not voice/staff/track id)  |  '
    + `Pickup bar: **${digest.pickup ? 'yes' : 'no'}**`);
  lines.push(
    `- Range deficit: **${rd.belowLowCount}** note(s) below guitar low, `
    + `**${rd.aboveHighCount}** above guitar high`);
  lines.push(`- Tracks/parts: **${digest.partCount}**  |  Bars: **${digest.bars.length}**`);
  lines.push('');

  const meterCounts = new Map();
  for (const b of digest.bars) meterCounts.set(b.timeSig, (meterCounts.get(b.timeSig) || 0) + 1);
  const dist = [...meterCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}: ${v} bars`).join(', ');
  lines.push(`- Meter distribution: ${dist}`);
  lines.push('');

  // coverage of the two gate-critical fields — a 0 here means the gate is vacuous
  const withSkel = digest.bars.filter((b) => (b.melodySkeleton || []).length).length;
  const withRoot = digest.bars.filter((b) => b.harmony && b.harmony.root).length;
  lines.push(
    `- Gate-critical coverage: **${withSkel}/${digest.bars.length}** bars carry a non-empty `
    + `\`melodySkeleton\`, **${withRoot}/${digest.bars.length}** carry a \`harmony.root\`. `
    + '(compare.mjs gates are `covered === total` and are vacuous at total 0.)');
  lines.push('');

  lines.push('## Sections');
  lines.push('');
  lines.push('| start | end | bars | reason |');
  lines.push('|---|---|---|---|');
  for (const s of digest.sections) {
    lines.push(`| ${s.startBar} | ${s.endBar} | ${s.endBar - s.startBar + 1} | ${s.reason} |`);
  }
  lines.push('');

  lines.push('## Duplicate ranges');
  lines.push('');
  if (digest.duplicateRanges.length) {
    lines.push('| a | b | kind | similarity |');
    lines.push('|---|---|---|---|');
    for (const d of digest.duplicateRanges) {
      lines.push(`| ${d.a[0]}-${d.a[1]} | ${d.b[0]}-${d.b[1]} | ${d.kind} | ${d.similarity ?? '1.0'} |`);
    }
  } else {
    lines.push('_none detected_');
  }
  lines.push('');

  lines.push(...renderHarmonicLoop(digest));

  lines.push('## Bars');
  lines.push('');
  lines.push('| bar | TS | tempo | chord | melody contour | bass | flags |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const b of digest.bars) {
    const chord = b.harmony ? b.harmony.symbol : '';
    const contour = contourString(b.melodySkeleton);
    const bassNames = [...new Set((b.bassFolded || []).map((n) => n.name))].join(' ');
    const flags = (b.flags || []).join(',');
    const tempo = b.tempoChanged ? `${b.tempo}*` : String(b.tempo);
    lines.push(
      `| ${b.bar} | ${b.timeSig} | ${tempo} | ${chord} | ${contour} | ${bassNames} | ${flags} |`);
  }
  lines.push('');
  return lines.join('\n');
}

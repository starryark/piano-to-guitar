// analysis.test.mjs — port verification for tools/lib/analysis.mjs.
// Run: node tools/lib/analysis.test.mjs   (exit 0 = all green, 1 = failure)
//
// WHAT THIS FILE IS FOR
// --------------------
// tools/lib/analysis.mjs is a PORT of abc-to-guitar/tools/abc-extract.py. A
// port cannot be eyeballed: `detect_harmony`'s quality/pcset table and
// `strong_beats`'s meter derivation are exactly where a silent divergence
// hides, and a silent divergence in either one shrinks what the hard fidelity
// gate protects WITHOUT ANY ERROR BEING REPORTED. Every case below was
// hand-computed from the Python source (line numbers cited) and is asserted
// against this port. Where the port DELIBERATELY diverges, the test pins BOTH
// behaviours so the divergence can never drift into an accident.
//
// The last block is the end-to-end acceptance from the build plan, asserted
// here so `npm test` protects it: 57 bars of canon-in-d-hard, every one with a
// non-empty melodySkeleton and a non-null harmony.root, and the measured
// D-major chaconne root motion over bars 1-20.
//
// FAIL-OPEN: compare.mjs's hard gates are `covered === total`, trivially true
// at total 0. Every coverage assertion below therefore also asserts the total
// is NON-ZERO. A clean 0/0 is a failure, not a success.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUITAR_LOW,
  GUITAR_HIGH,
  CHORD_TEMPLATES,
  STRONG_BEATS,
  pcName,
  midiName,
  nameToPc,
  foldIntoGuitar,
  detectHarmony,
  topLine,
  strongBeats,
  melodySkeleton,
  barSignature,
  barSimilarity,
  findExactRuns,
  detectDuplicates,
  harmonyKey,
  evalLoop,
  detectHarmonicLoop,
  detectSections,
  inferKey,
  contourString,
  compressPasses,
  renderMap,
  extractDigest,
  intIfWhole,
  EMPTY_SIG,
} from './analysis.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = (rel) => path.join(REPO, 'CanonRock', rel);

// The CanonRock corpus is gitignored and optional. When absent, the 17 E2E
// tests below can't run (they read real source files) — so they register via
// corpusTest, which records their names in `skipped` and exits 0 with a
// notice instead of failing on a missing file. Portable tests always run.
const HAVE_CORPUS = existsSync(path.join(REPO, 'CanonRock'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const skipped = [];
const corpusTest = (name, fn) => {
  if (HAVE_CORPUS) tests.push([name, fn]);
  else skipped.push(name);
};

/** A note as the analysis functions consume it. */
const n = (onset, midi, beats = 0.5, name = midiName(midi, false)) => ({ onset, midi, beats, name });

// =========================================================================
// constants — the tables the Python's behaviour hangs off
// =========================================================================

test('constants match the Python (abc-extract.py 33-34, 52-65)', () => {
  assert.equal(GUITAR_LOW, 40, 'E2');
  assert.equal(GUITAR_HIGH, 76, 'E5');
  // Order matters: the tie-break key carries -idx, so reordering this table
  // silently changes which of two equal-scoring chords wins.
  assert.deepEqual(CHORD_TEMPLATES.map((t) => t[0]), [
    'maj7', 'min7', 'dom7', 'dim7', 'm7b5', 'maj', 'min', 'dim', 'aug', 'sus4', 'sus2', '5',
  ]);
  assert.deepEqual(CHORD_TEMPLATES.map((t) => t[2]), [
    'maj7', 'm7', '7', 'dim7', 'm7b5', '', 'm', 'dim', 'aug', 'sus4', 'sus2', '5',
  ]);
  assert.deepEqual(CHORD_TEMPLATES.find((t) => t[0] === 'sus4')[1], [0, 5, 7]);
  assert.deepEqual(CHORD_TEMPLATES.find((t) => t[0] === '5')[1], [0, 7]);
});

test('intIfWhole (abc-extract.py 395-396)', () => {
  assert.equal(intIfWhole(120), 120);
  assert.equal(intIfWhole(120.0), 120);
  assert.equal(intIfWhole(89.5), 89.5);
  assert.equal(intIfWhole(89.456), 89.46);
});

// =========================================================================
// pitch naming + fold_into_guitar (abc-extract.py 134-149)
// =========================================================================

test('pcName / midiName honour prefer_flat (Python 134-141)', () => {
  assert.equal(midiName(60, false), 'C4');
  assert.equal(midiName(40, false), 'E2');
  assert.equal(midiName(78, false), 'F#5');
  assert.equal(midiName(78, true), 'Gb5');
  assert.equal(midiName(70, true), 'Bb4');
  assert.equal(midiName(70, false), 'A#4');
  assert.equal(pcName(6, false), 'F#');
  assert.equal(pcName(6, true), 'Gb');
});

test('foldIntoGuitar raises by octaves until >= E2 (Python 144-148)', () => {
  assert.equal(foldIntoGuitar(40), 40, 'already the low E — untouched');
  assert.equal(foldIntoGuitar(45), 45);
  assert.equal(foldIntoGuitar(39), 51, 'one octave up');
  assert.equal(foldIntoGuitar(28), 40, 'lands exactly on the low E');
  assert.equal(foldIntoGuitar(24), 48, 'two octaves up');
  assert.equal(foldIntoGuitar(88), 88, 'never folds DOWN — only up');
});

test('CONTRACT: every root name detectHarmony can emit parses in compare.mjs', () => {
  // compare.mjs's own noteNameToPc (tools/compare.mjs:123), reproduced. If this
  // ever disagrees, the harmonicRoots gate silently compares against null.
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const compareNoteNameToPc = (name) => {
    const s = String(name).trim();
    let p = LETTER_PC[s[0]?.toUpperCase()];
    if (p === undefined) return null;
    for (const ch of s.slice(1)) {
      if (ch === '#' || ch === '♯') p += 1;
      else if (ch === 'b' || ch === 'B' || ch === '♭') p -= 1;
    }
    return ((p % 12) + 12) % 12;
  };
  for (let pc = 0; pc < 12; pc++) {
    for (const flat of [false, true]) {
      const name = pcName(pc, flat);
      assert.equal(compareNoteNameToPc(name), pc, `compare.mjs must read "${name}" as pc ${pc}`);
      assert.equal(nameToPc(name), pc, `analysis.nameToPc must read "${name}" as pc ${pc}`);
    }
  }
});

// =========================================================================
// detect_harmony (abc-extract.py 154-192) — the gate-critical one
// =========================================================================
// Scoring, verbatim from the Python: for each (template, root in present)
//   rel     = {(pc - root) % 12 for pc in present}
//   matched = |tset & rel| ; missing = |tset - rel| ; extra = |rel - tset|
//   skip if matched < 2
//   score   = matched*3 - missing*2 - extra   (+1 when root == bass_pc)
//   winner  = max on (score, root==bass, -idx, root, quality, suffix)
// Every expectation below was worked out by hand with that formula.

const py = (pcs, bass, flat = false) => detectHarmony(pcs, bass, flat, { anchorBass: false });

test('detect_harmony: plain triad — C E G over C', () => {
  // root 0: maj matched3 missing0 extra0 = 9, +1 bass = 10 (beats maj7's 8)
  assert.deepEqual(py([0, 4, 7], 0), { root: 'C', quality: 'maj', symbol: 'C', pcset: [0, 4, 7] });
});

test('detect_harmony: dominant seventh — C E G Bb over C', () => {
  // root 0: dom7 matched4 missing0 extra0 = 12, +1 = 13
  assert.deepEqual(py([0, 4, 7, 10], 0),
    { root: 'C', quality: 'dom7', symbol: 'C7', pcset: [0, 4, 7, 10] });
});

test('detect_harmony: minor seventh — F# A C# E over F# (canon-in-d-hard bar 2 shape)', () => {
  // present {1,2,4,6,9,11}, bass 6. root 6 -> rel {0,3,5,7,8,10}
  //   min7 matched4 missing0 extra2 = 10, +1 = 11  <- winner
  //   root 2 maj7 matched4 missing0 extra2 = 10 (no bass bonus)
  const h = py([1, 2, 4, 6, 9, 11], 6);
  assert.equal(h.root, 'F#');
  assert.equal(h.quality, 'min7');
  assert.equal(h.symbol, 'F#m7');
  assert.deepEqual(h.pcset, [1, 2, 4, 6, 9, 11]);
});

test('detect_harmony: tie on score is broken by template ORDER (-idx), not by luck', () => {
  // present {2,6,7,9,11} with the bass anchored on 2 -> rel {0,4,5,7,9}
  //   maj  matched3 missing0 extra2 = 7 (+1 bass) = 8   idx 5
  //   sus4 matched3 missing0 extra2 = 7 (+1 bass) = 8   idx 9
  // -idx: -5 > -9, so maj wins. Reordering CHORD_TEMPLATES would flip this.
  const h = detectHarmony([2, 6, 7, 9, 11], 2, false);
  assert.equal(h.quality, 'maj');
  assert.equal(h.symbol, 'D');
});

test('DIVERGENCE: the Python reads canon-in-d-hard bar 3 as "Gmaj7" — the mush, exactly', () => {
  // Same pitch classes {D,F#,G,A,B} over a D bass. The Python's full root
  // search finds root 7 (G): rel {0,2,4,7,11}, maj7 matched4 missing0 extra1
  // = 11, which beats D's bass-bonused 8. So the Python labels a D-rooted bar
  // Gmaj7 — the "maj7 mush across a chaconne" the build plan warns about, in
  // one bar. This test exists so the mush can never come back unnoticed.
  const pythonAnswer = py([2, 6, 7, 9, 11], 2);
  assert.equal(pythonAnswer.root, 'G');
  assert.equal(pythonAnswer.quality, 'maj7');
  assert.equal(detectHarmony([2, 6, 7, 9, 11], 2, false).root, 'D', 'the port says D');
});

test('detect_harmony: no template fit -> the `note` fallback (Python 175-183)', () => {
  assert.deepEqual(py([9], 9),
    { root: 'A', quality: 'note', symbol: 'A', pcset: [9] });
  // bass_pc null -> sorted(present)[0] becomes the root
  assert.deepEqual(py([9], null),
    { root: 'A', quality: 'note', symbol: 'A', pcset: [9] });
});

test('detect_harmony: empty input -> null (Python 156-157)', () => {
  assert.equal(py([], 0), null);
  assert.equal(py(null, 0), null);
  assert.equal(detectHarmony([], 0, false), null);
});

test('detect_harmony: pcset is sorted, de-duplicated, and octave-reduced', () => {
  assert.deepEqual(py([7, 0, 4, 0, 7], 0).pcset, [0, 4, 7]);
  assert.deepEqual(detectHarmony([12, 16, 19], 0, false).pcset, [0, 4, 7]);
});

test('detect_harmony: prefer_flat selects the spelling of root and symbol', () => {
  assert.equal(py([10, 2, 5], 10, true).root, 'Bb');
  assert.equal(py([10, 2, 5], 10, false).root, 'A#');
  assert.equal(py([6, 10, 1], 6, true).symbol, 'Gb');
  assert.equal(py([6, 10, 1], 6, false).symbol, 'F#');
});

// ---- the deliberate divergence, pinned from both sides -------------------

test('DIVERGENCE: anchorBass:false reproduces the Python EXACTLY on the bar it gets wrong', () => {
  // canon-in-d-hard bar 1 sounds {D, A} over a low A (measured).
  //   root 2 ("5"): matched2 missing0 extra0 = 6, no bass bonus  -> 6
  //   root 9 (sus4): matched2 missing1 extra0 = 4, +1 bass       -> 5
  // The Python therefore reports the root a FOURTH away from the sounding
  // bass. That is the known weakness the build plan names.
  assert.deepEqual(py([2, 9], 9),
    { root: 'D', quality: '5', symbol: 'D5', pcset: [2, 9] });
});

test('DIVERGENCE: anchorBass (the default) roots the chord on the sounding bass', () => {
  const h = detectHarmony([2, 9], 9, false);
  assert.deepEqual(h, { root: 'A', quality: 'sus4', symbol: 'Asus4', pcset: [2, 9] });
});

test('DIVERGENCE: anchorBass changes only the ROOT SEARCH, never the scoring', () => {
  // Swept, not hand-listed, so the invariant cannot be asserted vacuously:
  //  (a) whenever the Python's own winner is ALREADY rooted on the bass, the
  //      two modes must return byte-identical objects — anchoring touches the
  //      root search and nothing else;
  //  (b) whenever a bar sounds at all, the anchored root IS the bass pc.
  let sameCount = 0;
  let movedCount = 0;
  const pcsets = [
    [0, 4, 7], [0, 4, 7, 10], [0, 3, 7], [0, 3, 7, 10], [0, 4, 7, 11], [0, 5, 7],
    [0, 2, 7], [0, 7], [2, 6, 9], [2, 6, 9, 1], [1, 2, 4, 6, 9, 11],
    [2, 6, 7, 9, 11], [1, 2, 4, 7, 9, 11], [2, 9], [4, 8, 11], [0, 3, 6, 9],
  ];
  for (const pcs of pcsets) {
    for (const bass of pcs) {
      const anchored = detectHarmony(pcs, bass, false);
      const python = py(pcs, bass);
      assert.equal(nameToPc(anchored.root), bass, `anchored root must be the bass (${pcs}/${bass})`);
      if (nameToPc(python.root) === bass) {
        assert.deepEqual(anchored, python,
          `anchorBass must not move an already-bass-rooted answer (${pcs}/${bass})`);
        sameCount++;
      } else {
        movedCount++;
      }
    }
  }
  assert.ok(sameCount > 20, `expected many no-op cases, got ${sameCount}`);
  assert.ok(movedCount > 5, `expected the divergence to bite somewhere, got ${movedCount}`);
});

test('DIVERGENCE: with no template over the bass, the label stays ON the bass', () => {
  // present {0,1}: the interval 1 appears in NO template, so nothing fits over
  // C. The Python widens the search and lands on C#maj7 (matched {0,11} = 2) —
  // calling a semitone dyad a major seventh. The port reports the honest thing.
  assert.equal(py([0, 1], 0).root, 'C#', 'the Python widens to a foreign root');
  assert.equal(py([0, 1], 0).quality, 'maj7');
  assert.deepEqual(detectHarmony([0, 1], 0, false),
    { root: 'C', quality: 'note', symbol: 'C', pcset: [0, 1] });
  // Measured: cannon-rock-Piano bar 3 sounds exactly this shape a tone up.
  assert.equal(detectHarmony([1, 2], 1, false).root, 'C#');
});

test('DIVERGENCE: a bass pitch class outside the bar cannot anchor anything', () => {
  // bass_pc must be present to anchor; otherwise the Python path runs.
  assert.deepEqual(detectHarmony([0, 4, 7], 3, false), py([0, 4, 7], 3));
});

// =========================================================================
// top_line (abc-extract.py 408-422)
// =========================================================================

test('top_line: one note per onset, highest or lowest', () => {
  const notes = [n(0, 60), n(0, 64), n(0, 55), n(1, 62)];
  assert.deepEqual(topLine(notes, true).map((x) => x.midi), [64, 62]);
  assert.deepEqual(topLine(notes, false).map((x) => x.midi), [55, 62]);
});

test('top_line: output is ordered by onset regardless of input order', () => {
  const notes = [n(2, 60), n(0, 65), n(1, 61)];
  assert.deepEqual(topLine(notes, true).map((x) => x.onset), [0, 1, 2]);
});

test('top_line: a tie at the same onset keeps the FIRST note (Python uses > / <)', () => {
  const a = { ...n(0, 60), name: 'first' };
  const b = { ...n(0, 60), name: 'second' };
  assert.equal(topLine([a, b], true)[0].name, 'first');
  assert.equal(topLine([a, b], false)[0].name, 'first');
});

test('top_line: empty voice -> empty line', () => {
  assert.deepEqual(topLine([], true), []);
});

// =========================================================================
// strong_beats (abc-extract.py 434-465) — gate-critical
// =========================================================================

test('strong_beats: the STRONG_BEATS table is the Python table, verbatim', () => {
  const expected = {
    '2/2': [0.0, 2.0], '4/4': [0.0, 2.0], '2/4': [0.0], '3/4': [0.0],
    '5/4': [0.0, 3.0], '6/4': [0.0, 3.0], '7/4': [0.0, 2.0, 4.0],
    '3/8': [0.0], '5/8': [0.0, 1.5], '6/8': [0.0, 1.5], '7/8': [0.0, 1.0, 2.0],
    '9/8': [0.0, 1.5, 3.0], '12/8': [0.0, 1.5, 3.0, 4.5],
  };
  assert.equal(STRONG_BEATS.size, Object.keys(expected).length);
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(STRONG_BEATS.get(k), v, k);
});

test('strong_beats: every tabled meter resolves to its tabled accents', () => {
  const cases = [
    [2, 2, 4, [0, 2]], [4, 4, 4, [0, 2]], [2, 4, 2, [0]], [3, 4, 3, [0]],
    [5, 4, 5, [0, 3]], [6, 4, 6, [0, 3]], [7, 4, 7, [0, 2, 4]],
    [3, 8, 1.5, [0]], [5, 8, 2.5, [0, 1.5]], [6, 8, 3, [0, 1.5]],
    [7, 8, 3.5, [0, 1, 2]], [9, 8, 4.5, [0, 1.5, 3]], [12, 8, 6, [0, 1.5, 3, 4.5]],
  ];
  for (const [num, den, beats, want] of cases) {
    assert.deepEqual(strongBeats(num, den, beats), want, `${num}/${den}`);
  }
});

test('REGRESSION: odd meters must NOT be halved (the whole point of the table)', () => {
  // Halving 7/4 gives 3.5 — a position BETWEEN quarter-note onsets, matching no
  // note, silently degrading the bar to "downbeat only" and shrinking what the
  // hard gate protects. Same trap in 3/4 (1.5) and 5/4 (2.5).
  assert.ok(!strongBeats(7, 4, 7).includes(3.5), '7/4 must not accent 3.5');
  assert.deepEqual(strongBeats(7, 4, 7), [0, 2, 4]);
  assert.ok(!strongBeats(3, 4, 3).includes(1.5), '3/4 must not accent 1.5');
  assert.ok(!strongBeats(5, 4, 5).includes(2.5), '5/4 must not accent 2.5');
});

test('strong_beats: accents beyond the bar are filtered (Python 455)', () => {
  assert.deepEqual(strongBeats(4, 4, 1), [0], 'a 1-beat 4/4 bar has only a downbeat');
  assert.deepEqual(strongBeats(4, 4, 2.01), [0, 2]);
  // The filter is `b < barBeats + 0.01`, so an accent landing exactly on the
  // bar length survives — 3.0 is kept at barBeats 3, dropped at 2.5.
  assert.deepEqual(strongBeats(12, 8, 3), [0, 1.5, 3]);
  assert.deepEqual(strongBeats(12, 8, 2.5), [0, 1.5]);
});

test('strong_beats: untabled compound meter accents each dotted-quarter (Python 457-458)', () => {
  assert.deepEqual(strongBeats(15, 8, 7.5), [0, 1.5, 3, 4.5, 6]);
  assert.deepEqual(strongBeats(21, 8, 10.5), [0, 1.5, 3, 4.5, 6, 7.5, 9]);
});

test('strong_beats: untabled simple even meter = downbeat + midpoint (Python 460-461)', () => {
  assert.deepEqual(strongBeats(8, 4, 8), [0, 4]);
  assert.deepEqual(strongBeats(10, 4, 10), [0, 5]);
});

test('strong_beats: anything else is downbeat only (Python 465)', () => {
  assert.deepEqual(strongBeats(11, 4, 11), [0]);
  assert.deepEqual(strongBeats(13, 16, 3.25), [0]);
  assert.deepEqual(strongBeats(4, 4, 0), [0], 'a zero-length bar cannot have a midpoint');
});

// =========================================================================
// melody_skeleton (abc-extract.py 468-489) — gate-critical
// =========================================================================

test('melody_skeleton: empty melody -> empty skeleton', () => {
  assert.deepEqual(melodySkeleton([], 4, 4, 4), []);
  assert.deepEqual(melodySkeleton(null, 4, 4, 4), []);
});

test('melody_skeleton: STRONG-BEAT rule — a rising run of 8ths keeps only 0 and 2', () => {
  const mel = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((o, i) => n(o, 60 + i, 0.5));
  // monotonic, so no contour turn anywhere; all 0.5 beats, so nothing is long.
  assert.deepEqual(melodySkeleton(mel, 4, 4, 4).map((x) => x.onset), [0, 2]);
});

test('melody_skeleton: LONG rule — >= 1 beat qualifies off a strong beat', () => {
  const mel = [n(0.5, 60, 1.0), n(1.5, 62, 0.5), n(2.5, 64, 2.0)];
  // 0.5 is long (1.0), 1.5 is short/weak/monotonic, 2.5 is long (2.0)
  assert.deepEqual(melodySkeleton(mel, 4, 4, 4).map((x) => x.onset), [0.5, 2.5]);
  assert.equal(melodySkeleton([n(0.5, 60, 0.99)], 4, 4, 4).length, 0, '0.99 beats is not long');
  assert.equal(melodySkeleton([n(0.5, 60, 1.0)], 4, 4, 4).length, 1, '1.0 beats exactly is long');
});

test('melody_skeleton: TURN rule — an interior local max or min qualifies', () => {
  const peak = [n(0.25, 60, 0.25), n(0.5, 64, 0.25), n(0.75, 60, 0.25)];
  assert.deepEqual(melodySkeleton(peak, 4, 4, 4).map((x) => x.onset), [0.5], 'local max');
  const trough = [n(0.25, 64, 0.25), n(0.5, 60, 0.25), n(0.75, 64, 0.25)];
  assert.deepEqual(melodySkeleton(trough, 4, 4, 4).map((x) => x.onset), [0.5], 'local min');
  const flat = [n(0.25, 60, 0.25), n(0.5, 60, 0.25), n(0.75, 60, 0.25)];
  assert.deepEqual(melodySkeleton(flat, 4, 4, 4), [], 'a repeated note is not a turn');
});

test('melody_skeleton: first and last notes can never be turns (Python 479)', () => {
  // Two short weak notes: neither has an interior position, so the skeleton is
  // empty. This is the ONE fail-open shape the digest flags as `noSkeleton`.
  assert.deepEqual(melodySkeleton([n(0.25, 60, 0.25), n(0.75, 72, 0.25)], 4, 4, 4), []);
});

test('melody_skeleton: onset matching has a 0.01 tolerance (Python 476)', () => {
  assert.equal(melodySkeleton([n(2.005, 60, 0.25)], 4, 4, 4).length, 1, 'within tolerance');
  assert.equal(melodySkeleton([n(2.02, 60, 0.25)], 4, 4, 4).length, 0, 'outside tolerance');
});

test('REGRESSION: melody_skeleton uses the METER, not half the bar (7/4)', () => {
  const mel = [n(0, 60, 0.5), n(2, 62, 0.5), n(3.5, 64, 0.5), n(4, 66, 0.5), n(6, 68, 0.5)];
  const got = melodySkeleton(mel, 7, 7, 4).map((x) => x.onset);
  assert.deepEqual(got, [0, 2, 4], 'accents at 0/2/4; 3.5 (the halving point) is NOT structural');
});

test('melody_skeleton: skeleton notes are the SAME objects as the melody notes', () => {
  // compare.mjs reads note.midi and note.name off the skeleton; a rebuilt
  // object that lost `name` would degrade every failure message.
  const mel = [n(0, 62, 2.0)];
  const sk = melodySkeleton(mel, 4, 4, 4);
  assert.equal(sk[0], mel[0]);
  assert.equal(sk[0].name, 'D4');
});

// =========================================================================
// duplicate detection (abc-extract.py 495-597)
// =========================================================================

test('bar_signature is order-independent and exact', () => {
  const a = barSignature([[0, 0, 60, 1, false], [0, 1, 64, 1, false]]);
  const b = barSignature([[0, 1, 64, 1, false], [0, 0, 60, 1, false]]);
  assert.equal(a, b, 'ordering must not change the signature');
  assert.notEqual(a, barSignature([[0, 0, 61, 1, false], [0, 1, 64, 1, false]]));
  assert.equal(barSignature([]), EMPTY_SIG);
});

test('bar_similarity is a pitch-class multiset overlap (Python 500-508)', () => {
  const A = [[0, 0, 60, 1, false], [0, 1, 64, 1, false]];
  assert.equal(barSimilarity(A, A), 1);
  // same pitch classes an octave apart -> still 1
  assert.equal(barSimilarity(A, [[0, 0, 72, 1, false], [0, 1, 76, 1, false]]), 1);
  assert.equal(barSimilarity(A, [[0, 0, 61, 1, false], [0, 1, 65, 1, false]]), 0);
  assert.equal(barSimilarity(A, [[0, 0, 60, 1, false]]), 0.5, 'normalised by the LONGER bar');
  assert.equal(barSimilarity([], []), 0, 'max(...,1) guards the divide');
});

test('find_exact_runs needs min_len and rejects empty bars (Python 511-538)', () => {
  const sig = (k) => JSON.stringify([[0, 0, k, 1, false]]);
  const sigs = [sig(1), sig(2), sig(3), sig(4), sig(1), sig(2), sig(3), sig(4)];
  assert.deepEqual(findExactRuns(sigs, 4), [[0, 3, 4, 7]]);
  assert.deepEqual(findExactRuns(sigs, 5), [], 'a 4-bar run cannot satisfy min_len 5');
  const empties = new Array(12).fill(EMPTY_SIG);
  assert.deepEqual(findExactRuns(empties, 4), [], 'empty bars never count as a repeat');
});

test('detect_duplicates reports 1-BASED bar numbers (Python 564-597)', () => {
  const sig = (k) => JSON.stringify([[0, 0, k, 1, false]]);
  const sigs = [sig(1), sig(2), sig(3), sig(4), sig(1), sig(2), sig(3), sig(4)];
  const barsFlat = sigs.map((_, i) => [[0, 0, 60 + (i % 4), 1, false]]);
  const out = detectDuplicates(barsFlat, sigs, [[0, 3], [4, 7]]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].a, [1, 4]);
  assert.deepEqual(out[0].b, [5, 8]);
  assert.equal(out[0].kind, 'identical');
});

// =========================================================================
// harmonic loop (abc-extract.py 600-879)
// =========================================================================

const H = (root, quality = 'maj') => ({ root, quality, symbol: root, pcset: [nameToPc(root)] });

test('_harmony_key: null harmony -> null; a `note` chord WITH a pcset still keys', () => {
  assert.equal(harmonyKey(null), null);
  assert.equal(harmonyKey({ quality: 'note', pcset: [], root: 'A' }), null);
  assert.equal(harmonyKey({ quality: 'note', pcset: [9], root: 'A' }), '9|note');
  assert.equal(harmonyKey({ quality: 'note', pcset: [9], root: 'A' }, true), '9');
  assert.equal(harmonyKey({ root: 'zzz', quality: 'maj', pcset: [0] }), null, 'unparseable root');
});

test('_harmony_key reads the ROOT NAME, never pcset[0] (Python 637-641)', () => {
  // A Dmaj7 with a passing C#: pcset[0] is 1 (C#), the root is D (2).
  assert.equal(harmonyKey({ root: 'D', quality: 'maj7', pcset: [1, 2, 6, 9] }, true), '2');
});

test('_eval_loop enforces >= PASSES_MIN passes and >= 80% coverage (Python 676-737)', () => {
  const seq = ['2|maj', '9|maj', '11|min', '6|min'];
  const twelve = [...seq, ...seq, ...seq];
  const ev = evalLoop(twelve, 0, 4);
  assert.equal(ev.passes, 3);
  assert.equal(ev.coverage, 1);
  assert.equal(evalLoop([...seq, ...seq], 0, 4), null, 'only 2 passes');
  assert.equal(evalLoop(twelve, 0, 5), null, '5 does not divide the pattern -> coverage < 80%');
});

test('_eval_loop rejects a cycle with a permanently silent slot (Python 716-719)', () => {
  const holed = ['2|maj', null, '11|min', '6|min'];
  assert.equal(evalLoop([...holed, ...holed, ...holed], 0, 4), null);
});

test('detect_harmonic_loop finds the 4-bar cycle and reports 1-based passes', () => {
  const cycle = ['D', 'A', 'B', 'F#'];
  const bars = [];
  for (let i = 0; i < 12; i++) bars.push({ bar: i + 1, harmony: H(cycle[i % 4]) });
  const hl = detectHarmonicLoop(bars);
  assert.equal(hl.length, 4);
  assert.equal(hl.firstBar, 1);
  assert.equal(hl.passes.length, 3);
  assert.deepEqual(hl.passes, [[1, 4], [5, 8], [9, 12]]);
  assert.equal(hl.coverage, 1);
  assert.equal(hl.rootOnly, false, 'strict (root, quality) matching succeeded');
  assert.deepEqual(hl.cycle.map((c) => c.root), cycle);
});

test('detect_harmonic_loop tolerates leading SILENT bars, earliest firstBar wins', () => {
  // Python 782-790 puts position 0 in the candidate list unconditionally and
  // sorts candidates ascending, so a leading silent bar does NOT push firstBar
  // forward as long as a cycle still validates from 0: the empty slots are
  // filled from a later pass (Python 707-715) and the silent bars merely cost
  // coverage. Canon in D's four opening rest bars are exactly this shape.
  const cycle = ['D', 'A', 'B', 'F#'];
  const bars = [{ bar: 1, harmony: null }, { bar: 2, harmony: null }];
  for (let i = 0; i < 12; i++) bars.push({ bar: i + 3, harmony: H(cycle[i % 4]) });
  const hl = detectHarmonicLoop(bars);
  assert.equal(hl.firstBar, 1, 'earliest firstBar dominates smallest L (Python 798-809)');
  assert.equal(hl.length, 4);
  assert.equal(hl.passes.length, 3);
  // 2 silent bars out of 14 -> 12/14
  assert.ok(hl.coverage > 0.8 && hl.coverage < 0.9, `coverage ${hl.coverage}`);
  // The canonical slots are still spelled from a bar that actually sounded.
  assert.ok(hl.cycle.every((c) => c.root !== null), 'no hole in the reported cycle');
});

test('detect_harmonic_loop relaxes to ROOT-ONLY for a chaconne (Python 816-821)', () => {
  // Same roots, qualities alternating between passes — strict matching fails,
  // root-only matching succeeds. This is the documented escape hatch.
  const roots = ['D', 'A', 'B', 'F#'];
  const bars = [];
  for (let i = 0; i < 12; i++) {
    const q = i < 4 ? 'maj' : (i < 8 ? 'maj7' : 'dom7');
    bars.push({ bar: i + 1, harmony: { ...H(roots[i % 4]), quality: q } });
  }
  const hl = detectHarmonicLoop(bars);
  assert.equal(hl.rootOnly, true);
  assert.equal(hl.length, 4);
  assert.deepEqual(hl.cycle.map((c) => c.root), roots);
});

test('detect_harmonic_loop returns null when there is no loop', () => {
  assert.equal(detectHarmonicLoop([]), null);
  assert.equal(detectHarmonicLoop([{ bar: 1, harmony: H('D') }]), null, 'too short');
  const noise = ['D', 'A', 'B', 'F#', 'C', 'E', 'G', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
  assert.equal(detectHarmonicLoop(noise.map((r, i) => ({ bar: i + 1, harmony: H(r) }))), null);
});

test('compress_passes collapses contiguous runs (Python 1167-1200)', () => {
  assert.equal(compressPasses([]), 'none');
  assert.equal(compressPasses([[1, 2]]), 'pass 1 (bars 1-2)');
  assert.equal(compressPasses([[1, 2], [3, 4], [5, 6]]), 'passes 1-3 (bars 1-6)');
  assert.equal(compressPasses([[1, 2], [3, 4], [9, 10]]),
    'passes 1-2 (bars 1-4), pass 3 (bars 9-10)');
});

// =========================================================================
// sections (abc-extract.py 885-931)
// =========================================================================

const barRec = (over = {}) => ({ fermata: false, tsChanged: false, tempo: 120, ...over });

test('detect_sections closes on the last bar even with no marker', () => {
  const bars = [barRec(), barRec(), barRec(), barRec()];
  const { sections, idxRanges } = detectSections(bars, new Map());
  assert.deepEqual(sections, [{ startBar: 1, endBar: 4, reason: 'end' }]);
  assert.deepEqual(idxRanges, [[0, 3]]);
});

test('detect_sections splits on a TS change in the NEXT bar (Python 908-911)', () => {
  const bars = [barRec(), barRec(), barRec({ tsChanged: true }), barRec()];
  const { sections } = detectSections(bars, new Map());
  assert.deepEqual(sections, [
    { startBar: 1, endBar: 2, reason: 'TS' },
    { startBar: 3, endBar: 4, reason: 'end' },
  ]);
});

test('detect_sections splits on a tempo change in the NEXT bar', () => {
  const bars = [barRec(), barRec(), barRec({ tempo: 90 }), barRec({ tempo: 90 })];
  const { sections } = detectSections(bars, new Map());
  assert.deepEqual(sections.map((s) => s.reason), ['tempo', 'end']);
});

test('detect_sections splits on a fermata and on a structural barline', () => {
  const bars = [barRec(), barRec({ fermata: true }), barRec(), barRec()];
  assert.equal(detectSections(bars, new Map()).sections[0].reason, 'fermata');
  const styles = new Map([[2, '||']]);
  assert.equal(detectSections([barRec(), barRec(), barRec(), barRec()], styles)
    .sections[0].reason, '||');
});

test('detect_sections: a barline style outranks a fermata in the same bar', () => {
  const bars = [barRec(), barRec({ fermata: true }), barRec(), barRec()];
  const { sections } = detectSections(bars, new Map([[2, 'repeat']]));
  assert.equal(sections[0].reason, 'repeat');
});

// =========================================================================
// key inference (REPLACES the Python's <key><fifths> read)
// =========================================================================

test('inferKey reads pitch content, and a silent score does not crash', () => {
  const w = new Array(12).fill(0);
  assert.equal(inferKey(w).key, 'C');
  assert.equal(inferKey(w).confidence, 0);
  // a clean D-major diatonic weighting
  const dMajor = [0, 0, 10, 0, 6, 0, 7, 5, 0, 8, 0, 5];
  const k = inferKey(dMajor);
  assert.equal(k.key, 'D');
  assert.equal(k.fifths, 2);
  assert.equal(k.preferFlat, false);
});

test('inferKey picks flats for flat keys, so note names spell correctly', () => {
  // F major: F G A Bb C D E
  const fMajor = new Array(12).fill(0);
  for (const [pc, w] of [[5, 10], [7, 6], [9, 7], [10, 5], [0, 8], [2, 5], [4, 4]]) fMajor[pc] = w;
  const k = inferKey(fMajor);
  assert.equal(k.key, 'F');
  assert.equal(k.fifths, -1);
  assert.equal(k.preferFlat, true, 'F major must spell Bb, not A#');
});

// =========================================================================
// map rendering (abc-extract.py 1115-1127)
// =========================================================================

test('contour_string draws / \\ = between consecutive skeleton notes', () => {
  const sk = [
    { name: 'D4', midi: 62 }, { name: 'F#4', midi: 66 },
    { name: 'D4', midi: 62 }, { name: 'D4', midi: 62 },
  ];
  assert.equal(contourString(sk), 'D4 /F#4 \\D4 =D4');
  assert.equal(contourString([]), '');
  assert.equal(contourString([{ name: 'A3', midi: 57 }]), 'A3');
});

// =========================================================================
// END-TO-END ACCEPTANCE — the build plan's own numbers, asserted
// =========================================================================

let hardDigest = null;

corpusTest('E2E: canon-in-d-hard extracts to a 57-bar digest', async () => {
  const { digest } = await extractDigest(CORPUS('Canon in D/canon-in-d-hard.alphatab'));
  hardDigest = digest;
  assert.equal(digest.bars.length, 57, 'measured: 57 bars');
  assert.equal(digest.meterInitial, '4/4');
  assert.equal(digest.tempoInitial, 120, 'measured: 120 BPM');
  assert.equal(digest.partCount, 1);
});

corpusTest('E2E: every top-level contract field is present (build plan §2.5)', () => {
  for (const key of [
    'song', 'sourceFile', 'key', 'meterInitial', 'tempoInitial', 'guitarRange',
    'pitchRange', 'rangeDeficit', 'partCount', 'pickup', 'sections',
    'duplicateRanges', 'bars', 'harmonicLoop',
  ]) assert.ok(key in hardDigest, `top-level field "${key}" is part of the contract`);
  assert.deepEqual(hardDigest.guitarRange, { lowMidi: 40, highMidi: 76 });
  assert.equal(typeof hardDigest.rangeDeficit.belowLowCount, 'number');
  assert.equal(typeof hardDigest.rangeDeficit.aboveHighCount, 'number');
});

corpusTest('E2E: every per-bar contract field is present on EVERY bar', () => {
  const required = [
    'bar', 'sourceBarNumber', 'timeSig', 'tempo', 'tempoChanged', 'voices',
    'melodyVoice', 'bassVoice', 'melody', 'melodySkeleton', 'bass', 'bassFolded',
    'harmony', 'harmonySpans', 'flags',
  ];
  for (const b of hardDigest.bars) {
    for (const key of required) assert.ok(key in b, `bar ${b.bar} is missing "${key}"`);
  }
  // The exact guard compare.mjs runs (tools/compare.mjs:358, :565-566).
  assert.equal(hardDigest.bars.filter((b) => !('melodySkeleton' in b)).length, 0);
  assert.equal(hardDigest.bars.filter((b) => !('harmony' in b)).length, 0);
  // Bar ids are positional and contiguous — detectSections/detectDuplicates
  // index by position, so a gap desynchronises every downstream range.
  assert.deepEqual(hardDigest.bars.map((b) => b.bar),
    Array.from({ length: 57 }, (_, i) => i + 1));
});

corpusTest('E2E: WP2b — pcset is NARROWED so the harmonic gate is not vacuous (§0.1)', () => {
  // The blocking defect this project shipped with (build plan §0.1): with one
  // harmony per bar, a chaconne's two chords plus passing tones merge into a
  // pcset spanning the whole D-major scale — mean width 6.33 of 12, 32 of 57
  // bars carrying all 7 diatonic pitch classes. compare.mjs's harmonicRoots
  // gate accepts the root OR any pcset member, so that width made the gate
  // ~53% permissive: "does this note sit on the right chord?" degraded to "is
  // this note diatonic?" and reported PASS while protecting almost nothing.
  //
  // WP2b narrows the pcset to the primary half-bar's harmonic stratum (notes
  // of duration >= 1 beat; fallback to all primary-half-bar notes). This test
  // pins the acceptance bound from the build plan so the gate can NEVER
  // silently re-widen: mean pcset width <= 4.0 across canon-in-d-hard, and NO
  // bar may carry 7 pitch classes. If this test fails the gate is theatre again.
  const widths = hardDigest.bars.map((b) => (b.harmony?.pcset || []).length);
  const mean = widths.reduce((a, x) => a + x, 0) / widths.length;
  const worst = Math.max(...widths);
  const atSeven = widths.filter((w) => w === 7).length;
  assert.ok(mean <= 4.0,
    `mean pcset width ${mean.toFixed(2)} > 4.0 — the harmonic gate is permissive (§0.1)`);
  assert.equal(atSeven, 0,
    `${atSeven} bar(s) carry all 7 diatonic pitch classes — a whole-scale pcset (§0.1)`);
  assert.ok(worst <= 6, `widest pcset is ${worst}; expected <= 6`);
});

corpusTest('E2E: WP2b — harmonySpans carries the half-bar chords a chaconne actually has', () => {
  // harmonySpans[] is the additive contract surface WP2b ships alongside the
  // narrowed per-bar harmony. compare.mjs does not read it yet (the narrowed
  // `harmony` already fixes §0.1); it exists for the bar map and any future
  // finer-grained gate. canon-in-d-hard's first bar is the chaconne's D|A
  // boundary — the two half-bars are distinct single-root chords.
  for (const b of hardDigest.bars) {
    assert.ok(Array.isArray(b.harmonySpans), `bar ${b.bar}: harmonySpans must be an array`);
    assert.equal(b.harmonySpans.length, 2, `bar ${b.bar}: expected two half-bar spans`);
  }
  // Bar 1: half A holds D (root pc 2), half B holds A (root pc 9). This is the
  // §2.1 ground bass at the resolution it actually lives at.
  const [a, b] = hardDigest.bars[0].harmonySpans;
  assert.equal(nameToPc(a.root), 2, `bar 1 span A root ${a.root} != D`);
  assert.equal(nameToPc(b.root), 9, `bar 1 span B root ${b.root} != A`);
  // The narrowed per-bar harmony.root must be the span that sounds the bar's
  // lowest note (here A, in span B) — so root motion is preserved.
  assert.equal(nameToPc(hardDigest.bars[0].harmony.root), 9);
});

corpusTest('E2E: NON-ZERO coverage — 57/57 melodySkeleton and 57/57 harmony.root', () => {
  const total = hardDigest.bars.length;
  const skel = hardDigest.bars.filter((b) => b.melodySkeleton.length > 0).length;
  const root = hardDigest.bars.filter((b) => b.harmony && b.harmony.root !== null).length;
  // FAIL-OPEN GUARD: compare.mjs's gates are `covered === total`, vacuously
  // true at 0. Assert the totals are non-zero BEFORE asserting they match.
  assert.ok(total > 0, 'a 0-bar digest is a failure, not a pass');
  assert.ok(skel > 0, 'a digest with no melodySkeleton anywhere protects nothing');
  assert.ok(root > 0, 'a digest with no harmony.root anywhere protects nothing');
  assert.equal(skel, 57, `every bar must carry a melodySkeleton (got ${skel}/${total})`);
  assert.equal(root, 57, `every bar must carry a harmony.root (got ${root}/${total})`);
});

corpusTest('E2E: harmony.root over bars 1-20 reproduces the MEASURED D-major chaconne', () => {
  // Build plan §2.1, measured by probing the source (lowest sounding note per
  // bar). If this comes back as maj7 mush or nulls, the PORT is wrong — never
  // the source.
  const expected = 'A F# D G A F# D G A F# D G A F# D G A F# D G'.split(' ');
  const got = hardDigest.bars.slice(0, 20).map((b) => b.harmony.root);
  assert.deepEqual(got, expected);
});

corpusTest('E2E: harmony.root equals the lowest sounding pitch class in EVERY bar', () => {
  // The stronger form of the assertion above, across all 57 bars. This is what
  // the anchorBass divergence buys, and it is the property the arranger relies
  // on when reading root motion off the bar map.
  let checked = 0;
  for (const b of hardDigest.bars) {
    const midis = b.voices.flatMap((v) => v.notes.map((x) => x.midi));
    if (!midis.length) continue;
    const lowPc = ((Math.min(...midis) % 12) + 12) % 12;
    assert.equal(nameToPc(b.harmony.root), lowPc,
      `bar ${b.bar}: root ${b.harmony.root} != sounding bass pc ${lowPc}`);
    checked++;
  }
  assert.ok(checked >= 57, `expected all 57 bars to sound; only ${checked} did`);
});

corpusTest('E2E: melodySkeleton is a subset of melody, and both are octave-real MIDI', () => {
  let skeletonNotes = 0;
  for (const b of hardDigest.bars) {
    const melOnsets = new Set(b.melody.map((x) => `${x.onset}:${x.midi}`));
    for (const s of b.melodySkeleton) {
      assert.ok(melOnsets.has(`${s.onset}:${s.midi}`),
        `bar ${b.bar}: skeleton note ${s.name}@${s.onset} is not in melody[]`);
      assert.ok(Number.isFinite(s.midi) && s.midi > 0 && s.midi < 128, 'a real MIDI number');
      assert.equal(typeof s.name, 'string');
      skeletonNotes++;
    }
  }
  assert.ok(skeletonNotes > 100, `expected a substantial skeleton, got ${skeletonNotes} notes`);
});

corpusTest('E2E: TRAP — no string/fret leaks onto the source side (§2.6)', () => {
  // fromAlphaTabNote() returns {string: 8, fret: -1} on a pitched note without
  // throwing. If it were ever called here, these keys would appear.
  for (const b of hardDigest.bars) {
    for (const v of b.voices) {
      for (const note of v.notes) {
        assert.ok(!('string' in note), `bar ${b.bar}: a source note must carry no string`);
        assert.ok(!('fret' in note), `bar ${b.bar}: a source note must carry no fret`);
      }
    }
  }
});

corpusTest('E2E: TRAP — melody/bass voices come from register, and staff 1 uses voices 4-7', () => {
  // Measured (§2.6): staff 0 uses voices 0-3, staff 1 uses voices 4-7. If the
  // selection ever keyed off voice INDEX, bassVoice would be a low number.
  const bassVoices = new Set(hardDigest.bars.map((b) => b.bassVoice).filter((v) => v !== null));
  const melVoices = new Set(hardDigest.bars.map((b) => b.melodyVoice).filter((v) => v !== null));
  assert.ok([...bassVoices].some((v) => v >= 4),
    `bass must be read from the low staff's voices (4-7); saw ${[...bassVoices]}`);
  assert.ok(bassVoices.size > 0 && melVoices.size > 0);
  // And the register relation must actually hold, bar by bar.
  for (const b of hardDigest.bars) {
    if (b.melodyVoice === null || b.bassVoice === null || b.melodyVoice === b.bassVoice) continue;
    const mean = (vid) => {
      const v = b.voices.find((x) => x.voice === vid);
      return v.notes.reduce((a, x) => a + x.midi, 0) / v.notes.length;
    };
    assert.ok(mean(b.melodyVoice) > mean(b.bassVoice),
      `bar ${b.bar}: melodyVoice must sound above bassVoice`);
  }
});

corpusTest('E2E: bassFolded lifts every bass note into the guitar range', () => {
  let folded = 0;
  for (const b of hardDigest.bars) {
    assert.equal(b.bassFolded.length, b.bass.length, `bar ${b.bar}: 1:1 with bass[]`);
    for (let i = 0; i < b.bass.length; i++) {
      assert.ok(b.bassFolded[i].midi >= GUITAR_LOW,
        `bar ${b.bar}: folded bass ${b.bassFolded[i].midi} is still below E2`);
      assert.equal((b.bassFolded[i].midi - b.bass[i].midi) % 12, 0, 'octave transposition only');
      if (b.bassFolded[i].midi !== b.bass[i].midi) folded++;
    }
  }
  assert.ok(folded > 0, 'canon-in-d-hard has bass below E2; something must have folded');
});

corpusTest('E2E: durations are in QUARTER-NOTE BEATS (a whole note in 4/4 is 4.0)', () => {
  const all = hardDigest.bars.flatMap((b) => b.voices.flatMap((v) => v.notes));
  assert.ok(all.length > 2000, `measured: ~3023 notes, got ${all.length}`);
  assert.ok(all.every((x) => x.beats > 0 && x.beats <= 8), 'no tick-scale durations leaked');
  assert.ok(all.some((x) => x.beats === 2), 'half notes read as 2.0 beats');
  assert.ok(all.some((x) => x.beats === 0.5), 'eighth notes read as 0.5 beats');
  assert.ok(all.some((x) => x.beats === 4), 'whole notes read as 4.0 beats');
});

corpusTest('E2E: onsets are BAR-RELATIVE, not absolute score positions', () => {
  // alphaTab's beat.playbackStart is relative to its own bar. If it were ever
  // read as an absolute tick position, the last bar's onsets would be ~224
  // beats (56 bars x 4), not ~0-4. This is the assertion that catches it.
  const last = hardDigest.bars[hardDigest.bars.length - 1];
  const lastOnsets = last.voices.flatMap((v) => v.notes.map((x) => x.onset));
  assert.ok(lastOnsets.length > 0);
  assert.ok(Math.max(...lastOnsets) < 8,
    `bar ${last.bar} onsets max ${Math.max(...lastOnsets)} — that is an absolute position`);

  // Onsets past the barline are legitimate but rare: canon-in-d-hard bar 45
  // holds one voice of 6 beats inside a 4/4 bar. Those bars are FLAGGED, never
  // silently normalised.
  const all = hardDigest.bars.flatMap((b) => b.voices.flatMap(
    (v) => v.notes.map((x) => ({ bar: b.bar, onset: x.onset, flags: b.flags }))));
  const past = all.filter((x) => x.onset >= 4.0);
  assert.ok(past.length / all.length < 0.02, 'the overwhelming majority sit inside the bar');
  for (const x of past) {
    assert.ok(x.flags.includes('overfull'),
      `bar ${x.bar} has an onset at ${x.onset} in a 4/4 bar and must carry the overfull flag`);
  }
  assert.ok(hardDigest.bars.some((b) => b.flags.includes('overfull')),
    'measured: canon-in-d-hard bar 45 is overfull — the flag must actually fire');
});

corpusTest('E2E: the declared \\ks is reported but never trusted (§2.1 fact 3)', async () => {
  assert.equal(hardDigest.key, 'D', 'inferred from pitch content');
  assert.equal(hardDigest.keyDeclared, 'D');
  assert.equal(hardDigest.keyDisagrees, false);

  const { digest } = await extractDigest(CORPUS('Canon Rock/Canon Rock 1.alphatab'));
  assert.equal(digest.keyDeclared, 'C', 'the file declares \\ks c');
  assert.equal(digest.keyDisagrees, true, 'and it is a lie — flag it');
  assert.notEqual(digest.key, 'C', 'the inferred key must not be the declared one');
  // Non-ASCII / unusual track names must never be a signal, and the cover is
  // 210 bars against 57 in the source — the expansion the sidecar exists for.
  assert.equal(digest.bars.length, 210);
});

corpusTest('E2E: a multi-TRACK source is merged, not truncated (cannon-rock-Piano)', async () => {
  // Two tracks with Korean names (일렉 기타 / 일렉트릭 베이스). The Python
  // REFUSES more than one <part>; this port merges them, because the bass
  // track is where the root motion lives.
  const { digest } = await extractDigest(CORPUS('Canon in D/cannon-rock-Piano.alphatab'));
  assert.equal(digest.partCount, 2);
  assert.equal(digest.bars.length, 217);
  const roots = digest.bars.slice(0, 20).map((b) => (b.harmony ? b.harmony.root : '-'));
  // Measured (build plan §2.1). Bar 1 is silent.
  assert.deepEqual(roots,
    '- E C# A B E C# A G D A B E G D G A D A B'.split(' '));
  const withNotes = digest.bars.filter((b) => b.voices.length).length;
  assert.ok(withNotes > 200, 'both tracks must contribute notes');
});

corpusTest('E2E: renderMap produces a bar map with one row per bar', () => {
  const md = renderMap(hardDigest, false);
  assert.match(md, /^# Bar map -- /);
  assert.match(md, /## Sections/);
  assert.match(md, /## Duplicate ranges/);
  assert.match(md, /## Harmonic loop/);
  assert.match(md, /## Bars/);
  assert.match(md, /Gate-critical coverage: \*\*57\/57\*\*/);
  const rows = md.split('\n').filter((l) => /^\| \d+ \| \d+\/\d+ \|/.test(l));
  assert.equal(rows.length, 57, 'one table row per bar');
  assert.ok(md.includes('| 1 | 4/4 | 120 | Asus4 |'), 'bar 1 renders its chord symbol');
});

// --- runner --------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${err.stack ?? err.message}\n\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
if (skipped.length) {
  process.stdout.write(`\nSKIP: ${skipped.length} corpus test(s) (CanonRock/ absent — supply the corpus to run them):\n`);
  for (const s of skipped) process.stdout.write(`  SKIP ${s}\n`);
}
process.exit(failed ? 1 : 0);

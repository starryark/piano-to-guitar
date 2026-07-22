// piano-source.test.mjs — self-test for tools/lib/piano-source.mjs
// Run: node tools/lib/piano-source.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// The corpus contracts at the bottom read CanonRock/ — READ-ONLY, never written.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  STAFF_KIND,
  readPianoSource,
  scanSource,
  normalizePianoSource,
  normalizePianoFile,
  isPitchedStaff,
  isFrettedStaff,
  parsedStaffKind,
  parseAlphaTex,
  loadPianoSource,
  inferKeyFromPitchClasses,
  keyAccidentals,
  accidentalsToText,
  PITCH_CLASS_NAMES,
} from './piano-source.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpus = (rel) => join(REPO, 'CanonRock', rel);

// The CanonRock corpus is gitignored and optional. When absent, the corpus
// tests below can't run (they read real source files) — so they register via
// corpusTest, which records their names in `skipped` and exits 0 with a
// notice instead of failing on a missing file. Portable tests always run.
const HAVE_CORPUS = existsSync(join(REPO, 'CanonRock'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const skipped = [];
const corpusTest = (name, fn) => {
  if (HAVE_CORPUS) tests.push([name, fn]);
  else skipped.push(name);
};

// --- fixtures ----------------------------------------------------------
// Minimal, hand-written, and deliberately NOT copied from the corpus, so a
// change in the corpus cannot quietly redefine what these assert.

const PITCHED_PIANO = `\\title "T"
\\track ("Piano" "Pno.") {
  instrument acousticgrandpiano
}
  \\staff {
    score
  }
    \\ts (4 4)
    \\tempo 100
    \\ks d
      D4.4{beam Up}
      B3.4{beam Up}
      -1.1.4{beam Up}
      A4{lf 4}.4{beam Up}
    |
`;

const FRETTED_GUITAR = `\\track ("Gt" "Gt") {
  instrument distortionguitar
}
  \\staff {
    score
    tabs
  }
    \\tuning (E4 B3 G3 D3 A2 E2) {
      label "Guitar Standard Tuning"
    }
    \\ts (4 4)
    \\ks c
      12.2.4{beam Down}
      14.2.4{beam Down}
      -1.1.4{beam Down}
      0.6.4
    |
`;

// --- reading -----------------------------------------------------------

corpusTest('readPianoSource reports the encoding rather than assuming it', () => {
  const r = readPianoSource(corpus('Canon in D/canon-in-d-easy.alphatab'));
  assert.equal(r.encoding, 'utf-8');
  assert.ok(r.byteLength > 0);
  assert.ok(r.text.startsWith('\\artist'));
});

corpusTest('readPianoSource decodes a non-ASCII (Korean) track name intact', () => {
  const r = readPianoSource(corpus('Canon in D/cannon-rock-Piano.alphatab'));
  assert.ok(r.text.includes('일렉'), 'Korean track name survives the read');
  assert.ok(r.text.includes('기타'));
  assert.ok(r.text.includes('베이스'));
  // …and the separator inside that name is U+00A0 NO-BREAK SPACE, not U+0020.
  // Never match a track name by eye or by equality — this is exactly why nothing
  // in this toolchain is allowed to key logic off a track name.
  const NBSP = String.fromCharCode(0xa0);
  const { staves } = scanSource(r.text);
  assert.equal(staves[0].trackName.length, 5);
  assert.equal(staves[0].trackName.charCodeAt(2), 0xa0,
    "the separator is U+00A0 NO-BREAK SPACE, not U+0020 — never match a track name by eye");
  assert.ok(staves[1].trackName.includes(NBSP));
  assert.equal(staves[0].trackName.normalize('NFC'), staves[0].trackName, 'already NFC');
});

// --- staff-kind detection ----------------------------------------------

test('a `\\staff { score }` with pitched notes is PITCHED', () => {
  const { staves } = scanSource(PITCHED_PIANO);
  assert.equal(staves.length, 1);
  assert.equal(staves[0].kind, STAFF_KIND.PITCHED);
  assert.equal(isPitchedStaff(staves[0]), true);
  assert.equal(isFrettedStaff(staves[0]), false);
  assert.equal(staves[0].tokens.pitched, 3);
  assert.equal(staves[0].tokens.negativeFret, 1);
  assert.equal(staves[0].tokens.fretted, 0, 'fret -1 is NOT counted as fretted evidence');
});

test('a `\\tuning (…)` staff is FRETTED whatever else it contains', () => {
  const { staves } = scanSource(FRETTED_GUITAR);
  assert.equal(staves.length, 1);
  assert.equal(staves[0].kind, STAFF_KIND.FRETTED);
  assert.match(staves[0].kindReason, /6 strings/);
});

test('`\\staff { score tabs }` alone is enough to make a staff FRETTED', () => {
  const tex = '\\staff {\n score\n tabs\n}\n 12.2.4\n';
  const { staves } = scanSource(tex);
  assert.equal(staves[0].kind, STAFF_KIND.FRETTED);
  assert.equal(staves[0].display.join('+'), 'score+tabs');
});

test('`\\tuning piano` forces PITCHED even next to fret tokens', () => {
  const tex = '\\staff {\n score\n}\n\\tuning piano\n 12.2.4\n';
  const { staves } = scanSource(tex);
  assert.equal(staves[0].kind, STAFF_KIND.PITCHED);
  assert.equal(staves[0].kindReason, '\\tuning piano');
});

test('a staff with BOTH real fret tokens and pitched tokens is UNKNOWN, never guessed', () => {
  const tex = '\\staff {\n score\n}\n D4.4\n 12.2.4\n -1.1.4\n';
  const { staves } = scanSource(tex);
  assert.equal(staves[0].kind, STAFF_KIND.UNKNOWN);
  assert.match(staves[0].kindReason, /ambiguous/);
});

test('track/staff bookkeeping survives multiple tracks and staves', () => {
  const tex = PITCHED_PIANO + FRETTED_GUITAR;
  const { staves, tracks } = scanSource(tex);
  assert.equal(tracks.length, 2);
  assert.deepEqual(staves.map((s) => [s.trackIndex, s.staffIndex, s.kind]),
    [[0, 0, STAFF_KIND.PITCHED], [1, 0, STAFF_KIND.FRETTED]]);
  assert.deepEqual(staves.map((s) => s.trackName), ['Piano', 'Gt']);
});

test('`\\track {…}` body lines are metadata, never mistaken for beats', () => {
  const { staves } = scanSource(PITCHED_PIANO);
  assert.equal(staves[0].tokens.articulation, 0,
    '`instrument acousticgrandpiano` must not be read as a percussion articulation');
  assert.equal(staves[0].beats, 4);
});

test('parsedStaffKind mirrors the text scan on both fixture kinds', () => {
  const pitched = parseAlphaTex(PITCHED_PIANO.replace('-1.1.4{beam Up}', 'r.4'));
  assert.equal(pitched.ok, true);
  assert.equal(parsedStaffKind(pitched.score.tracks[0].staves[0]), STAFF_KIND.PITCHED);
  const fretted = parseAlphaTex(FRETTED_GUITAR.replace('-1.1.4{beam Down}', 'r.4'));
  assert.equal(fretted.ok, true);
  assert.equal(parsedStaffKind(fretted.score.tracks[0].staves[0]), STAFF_KIND.FRETTED);
});

// --- the one rewrite ---------------------------------------------------

test('CONTRACT: `-1.<string>.<dur>` becomes `r.<dur>` in a pitched staff', () => {
  const r = normalizePianoSource(PITCHED_PIANO);
  assert.equal(r.counts.negativeFretRests, 1);
  assert.equal(r.rewrites.length, 1);
  assert.equal(r.rewrites[0].from, '-1.1.4{beam Up}');
  assert.equal(r.rewrites[0].to, 'r.4{beam Up}');
  assert.equal(r.rewrites[0].line, 13);
  assert.equal(r.rewrites[0].staffIndex, 0);
  assert.equal(r.rewrites[0].trackIndex, 0);
  assert.equal(r.rewrites[0].string, 1);
  assert.equal(r.rewrites[0].duration, 4);
  assert.equal(r.rewrites[0].rule, 'negative-fret-rest');
});

test('CONTRACT: a fretted staff is left completely alone', () => {
  const r = normalizePianoSource(FRETTED_GUITAR);
  assert.equal(r.counts.negativeFretRests, 0);
  assert.equal(r.text, FRETTED_GUITAR, 'byte-identical');
  assert.equal(r.skipped.length, 1, 'the token is REPORTED, not silently ignored');
  assert.match(r.skipped[0].why, /fretted/);
});

test('the rewrite changes the text ONLY inside the reported spans', () => {
  const r = normalizePianoSource(PITCHED_PIANO);
  let rebuilt = r.text;
  for (const w of r.rewrites) rebuilt = rebuilt.replace(w.to, w.from);
  assert.equal(rebuilt, PITCHED_PIANO, 'undoing every reported rewrite restores the original byte-for-byte');
});

test('beat properties survive the rewrite; note properties are reported as dropped', () => {
  const tex = '\\staff {\n score\n}\n D4.4\n -1.1{v}.8{beam Up beam split}\n';
  const r = normalizePianoSource(tex);
  assert.equal(r.rewrites.length, 1);
  assert.equal(r.rewrites[0].to, 'r.8{beam Up beam split}');
  assert.equal(r.rewrites[0].droppedNoteProps, '{v}');
});

test('a `-1` inside a chord is REPORTED, never rewritten — a chord member is not a rest', () => {
  const tex = '\\staff {\n score\n}\n D4.4\n (-1.1 A4).4\n';
  const r = normalizePianoSource(tex);
  assert.equal(r.counts.negativeFretRests, 0);
  assert.equal(r.counts.negativeFretSkipped, 1);
  assert.match(r.skipped[0].why, /chord/);
  assert.equal(r.text, tex);
});

test('a zero-rewrite normalization still returns a full, printable report', () => {
  const r = normalizePianoSource('\\staff {\n score\n}\n D4.4\n');
  assert.equal(r.changed, false);
  assert.deepEqual(r.rewrites, []);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.counts.negativeFretRests, 0);
  assert.equal(r.counts.staves, 1);
  assert.equal(r.counts.pitchedStaves, 1);
});

test('the normalizer touches nothing else — no engraving is stripped', () => {
  const noisy = '\\systemsLayout (3 3 3)\n\\bracketExtendMode groupsimilarinstruments\n' +
    '\\staff {\n score\n}\n Gb5{lf 4}.2{beam Down}\n \\ottava regular\n \\simile none\n';
  const r = normalizePianoSource(noisy);
  assert.equal(r.text, noisy, '\\systemsLayout, {lf 4}, \\ottava and \\simile all survive untouched');
});

// --- parsing -----------------------------------------------------------

test('parseAlphaTex reports AT218 as an error and does not throw', () => {
  const r = parseAlphaTex(PITCHED_PIANO);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 218);
  assert.equal(r.errors[0].line, 13);
});

test('the normalized fixture parses clean and keeps the beat count', () => {
  const r = loadPianoSourceFromText(PITCHED_PIANO);
  assert.equal(r.ok, true);
  const voice = r.score.tracks[0].staves[0].bars[0].voices[0];
  assert.equal(voice.beats.length, 4, 'the rest still occupies its one beat');
  assert.equal(voice.beats[2].isRest, true);
});

function loadPianoSourceFromText(text) {
  return parseAlphaTex(normalizePianoSource(text).text);
}

// --- key inference -----------------------------------------------------

test('the Krumhansl-Kessler profiles are the published ones', () => {
  // Guards a real bug this module had: dropping index 6 of the major profile
  // biases every result toward the relative minor, silently and plausibly.
  const cMajorish = [10, 0, 6, 0, 8, 6, 0, 9, 0, 6, 0, 5];
  const k = inferKeyFromPitchClasses(cMajorish);
  assert.equal(k.key, 'C major');
  assert.ok(k.score > 0.9, `confidence ${k.score} should be decisive`);
});

test('a D-major histogram infers D major with 2 sharps', () => {
  const w = new Array(12).fill(0);
  const put = (name, v) => { w[PITCH_CLASS_NAMES.indexOf(name)] = v; };
  put('D', 90); put('A', 75); put('F#', 56); put('G', 60); put('B', 52); put('C#', 30); put('E', 19);
  const k = inferKeyFromPitchClasses(w);
  assert.equal(k.key, 'D major');
  assert.equal(k.accidentals, 2);
  assert.equal(k.tonicPc, 2);
});

test('an empty histogram infers nothing rather than guessing', () => {
  assert.equal(inferKeyFromPitchClasses(new Array(12).fill(0)), null);
  assert.equal(inferKeyFromPitchClasses(null), null);
});

test('keyAccidentals treats a minor key as its relative major', () => {
  assert.equal(keyAccidentals(2, 'major'), 2);   // D major
  assert.equal(keyAccidentals(11, 'minor'), 2);  // B minor
  assert.equal(keyAccidentals(0, 'major'), 0);   // C major
  assert.equal(keyAccidentals(9, 'minor'), 0);   // A minor
  assert.equal(keyAccidentals(4, 'major'), 4);   // E major
  assert.equal(accidentalsToText(4), '4#');
  assert.equal(accidentalsToText(-2), '2b');
  assert.equal(accidentalsToText(0), 'none');
});

// --- corpus contracts (CanonRock/ is READ-ONLY) ------------------------

corpusTest('CORPUS: canon-in-d-easy needs exactly 11 rewrites and then parses', () => {
  const file = corpus('Canon in D/canon-in-d-easy.alphatab');
  const before = readFileSync(file);
  const r = loadPianoSource(file);
  assert.equal(r.normalization.counts.negativeFretRests, 11);
  assert.deepEqual(r.normalization.rewrites.map((w) => w.line),
    [64, 74, 77, 95, 116, 121, 144, 152, 249, 263, 295]);
  assert.ok(r.normalization.rewrites.every((w) => w.staffKind === STAFF_KIND.PITCHED));
  assert.equal(r.ok, true, 'parses after normalization');
  assert.equal(r.errors.length, 0);
  assert.deepEqual(readFileSync(file), before, 'the corpus file on disk is untouched');
});

corpusTest('CORPUS: the other five files normalize to a no-op and still parse', () => {
  const expected = [
    ['Canon in D/canon-in-d-intermediate.alphatab', 1, [2], 102, 100, 1599],
    ['Canon in D/canon-in-d-hard.alphatab', 1, [2], 57, 120, 3023],
    ['Canon in D/cannon-rock-Piano.alphatab', 2, [1, 1], 217, 120, 3009],
    ['Canon Rock/Canon Rock 1.alphatab', 1, [1], 210, 90, 1461],
    ['Canon Rock/Canon Rock 2.alphatab', 1, [1], 162, 170, 1046],
  ];
  for (const [rel, tracks, staves, bars, tempo, notes] of expected) {
    const r = loadPianoSource(corpus(rel));
    assert.equal(r.normalization.counts.negativeFretRests, 0, `${rel}: expected a no-op`);
    assert.equal(r.normalization.text, r.normalization.raw, `${rel}: text must be byte-identical`);
    assert.equal(r.ok, true, `${rel}: must parse`);
    assert.equal(r.score.tracks.length, tracks, `${rel}: tracks`);
    assert.deepEqual(r.score.tracks.map((t) => t.staves.length), staves, `${rel}: staves per track`);
    assert.equal(r.score.masterBars.length, bars, `${rel}: bars`);
    assert.equal(r.score.tempo, tempo, `${rel}: tempo`);
    let n = 0;
    for (const t of r.score.tracks) for (const st of t.staves) for (const b of st.bars) for (const v of b.voices) for (const be of v.beats) n += be.notes.length;
    assert.equal(n, notes, `${rel}: notes`);
  }
});

corpusTest('CORPUS: staff kinds are detected correctly across all six files', () => {
  const expected = {
    'Canon in D/canon-in-d-easy.alphatab': ['pitched', 'pitched'],
    'Canon in D/canon-in-d-intermediate.alphatab': ['pitched', 'pitched'],
    'Canon in D/canon-in-d-hard.alphatab': ['pitched', 'pitched'],
    'Canon in D/cannon-rock-Piano.alphatab': ['pitched', 'pitched'],
    'Canon Rock/Canon Rock 1.alphatab': ['fretted'],
    'Canon Rock/Canon Rock 2.alphatab': ['fretted'],
  };
  for (const [rel, kinds] of Object.entries(expected)) {
    const n = normalizePianoFile(corpus(rel));
    assert.deepEqual(n.staves.map((s) => s.kind), kinds, rel);
  }
});

corpusTest('CORPUS: piano voice indices are staff-global — staff 1 of canon-in-d-hard uses 4-7', () => {
  // Nothing in this module keys off a voice index; this asserts WHY.
  const r = loadPianoSource(corpus('Canon in D/canon-in-d-hard.alphatab'));
  const used = r.score.tracks[0].staves.map((st) => {
    const s = new Set();
    for (const bar of st.bars) bar.voices.forEach((v, vi) => { for (const b of v.beats) if (b.notes.length) s.add(vi); });
    return [...s].sort((a, b) => a - b);
  });
  assert.deepEqual(used, [[0, 1, 2, 3], [4, 5, 6, 7]]);
});

// --- runner ------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
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

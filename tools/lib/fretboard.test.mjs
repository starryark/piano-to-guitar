// Vendored from abc-to-guitar@ba7e29c — tools/lib/fretboard.test.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// fretboard.test.mjs — self-test for tools/lib/fretboard.mjs
// Run: node tools/lib/fretboard.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.

import assert from 'node:assert/strict';
import {
  OPEN,
  STRING_COUNT,
  MAX_FRET,
  fromAlphaTabNote,
  toAlphaTabString,
  positionsFor,
  spanOf,
  isPlayableVoicing,
  intervalsOf,
} from './fretboard.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Strip to just {string, fret} so position lists compare readably. */
const sf = (positions) => positions.map(({ string, fret }) => ({ string, fret }));

// --- constants ---------------------------------------------------------

test('OPEN is source-numbered with an unused index 0', () => {
  assert.deepEqual(OPEN, [null, 64, 59, 55, 50, 45, 40]);
  assert.equal(OPEN[1], 64, 'string 1 is the high e (MIDI 64)');
  assert.equal(OPEN[6], 40, 'string 6 is the low E (MIDI 40)');
  assert.equal(STRING_COUNT, 6);
  assert.equal(MAX_FRET, 22);
});

// --- §2 required assertion 1 -------------------------------------------

test('CONTRACT: fromAlphaTabNote inverts alphaTab string 1 (low E) to source 6', () => {
  assert.deepEqual(
    fromAlphaTabNote({ string: 1, fret: 0, realValue: 40 }),
    { string: 6, fret: 0, midi: 40 }
  );
});

test('fromAlphaTabNote inverts across the whole neck', () => {
  // alphaTab internal 6 == source 1 == high e.
  assert.deepEqual(
    fromAlphaTabNote({ string: 6, fret: 0, realValue: 64 }),
    { string: 1, fret: 0, midi: 64 }
  );
  assert.deepEqual(
    fromAlphaTabNote({ string: 4, fret: 5, realValue: 60 }),
    { string: 3, fret: 5, midi: 60 }
  );
});

test('fromAlphaTabNote falls back to tuning+fret when realValue is absent', () => {
  assert.deepEqual(
    fromAlphaTabNote({ string: 1, fret: 3 }),
    { string: 6, fret: 3, midi: 43 } // 40 + 3
  );
});

test('fromAlphaTabNote honours a non-default stringCount', () => {
  // 7-string staff: internal 1 is still the lowest string -> source 7.
  assert.equal(fromAlphaTabNote({ string: 1, fret: 0, realValue: 35 }, 7).string, 7);
  assert.equal(fromAlphaTabNote({ string: 7, fret: 0, realValue: 64 }, 7).string, 1);
});

test('fromAlphaTabNote rejects malformed notes', () => {
  assert.throws(() => fromAlphaTabNote(null), TypeError);
  assert.throws(() => fromAlphaTabNote({ fret: 0 }), TypeError);
  assert.throws(() => fromAlphaTabNote({ string: 1 }), TypeError);
});

// --- toAlphaTabString round-tripping -----------------------------------

test('toAlphaTabString is the exact inverse of fromAlphaTabNote', () => {
  for (let sourceString = 1; sourceString <= STRING_COUNT; sourceString++) {
    for (const fret of [0, 1, 7, 12, 22]) {
      const midi = OPEN[sourceString] + fret;
      const internal = toAlphaTabString(sourceString);
      const back = fromAlphaTabNote({ string: internal, fret, realValue: midi });
      assert.deepEqual(
        back,
        { string: sourceString, fret, midi },
        `round trip failed for source string ${sourceString} fret ${fret}`
      );
    }
  }
});

test('toAlphaTabString is an involution and matches the frozen formula', () => {
  for (let s = 1; s <= STRING_COUNT; s++) {
    assert.equal(toAlphaTabString(s), (STRING_COUNT + 1) - s);
    assert.equal(toAlphaTabString(toAlphaTabString(s)), s);
  }
  assert.equal(toAlphaTabString(1, 7), 7);
  assert.throws(() => toAlphaTabString('not a number'), TypeError);
});

// --- §2 required assertion 2 -------------------------------------------

test('CONTRACT: positionsFor(64) yields five positions, high e first', () => {
  assert.deepEqual(sf(positionsFor(64)), [
    { string: 1, fret: 0 },
    { string: 2, fret: 5 },
    { string: 3, fret: 9 },
    { string: 4, fret: 14 },
    { string: 5, fret: 19 },
  ]);
  // String 6 would need fret 24, past MAX_FRET 22.
});

test('positionsFor carries midi through and sorts by string ascending', () => {
  const ps = positionsFor(55);
  assert.ok(ps.every((p) => p.midi === 55));
  const strings = ps.map((p) => p.string);
  assert.deepEqual(strings, [...strings].sort((a, b) => a - b));
  // G3 (55) sits below the open B string (59), so string 2 offers no position.
  assert.deepEqual(sf(ps), [
    { string: 3, fret: 0 },
    { string: 4, fret: 5 },
    { string: 5, fret: 10 },
    { string: 6, fret: 15 },
  ]);
});

test('positionsFor returns [] for out-of-range pitches (callers must handle)', () => {
  assert.deepEqual(positionsFor(39), [], 'below the low E');
  assert.deepEqual(positionsFor(0), []);
  assert.deepEqual(positionsFor(64 + MAX_FRET + 1), [], 'above fret 22 on the high e');
  assert.deepEqual(positionsFor(null), []);
  assert.deepEqual(positionsFor(NaN), []);
  // The documented crash site: [0] is undefined, not an object.
  assert.equal(positionsFor(39)[0], undefined);
});

test('positionsFor honours maxFret and custom tunings in both accepted shapes', () => {
  assert.deepEqual(sf(positionsFor(64, { maxFret: 12 })), [
    { string: 1, fret: 0 },
    { string: 2, fret: 5 },
    { string: 3, fret: 9 },
  ]);
  // Drop D, OPEN shape.
  const dropDOpen = [null, 64, 59, 55, 50, 45, 38];
  assert.deepEqual(sf(positionsFor(38, { tuning: dropDOpen })), [{ string: 6, fret: 0 }]);
  // Same tuning, bare high-to-low shape.
  const dropDBare = [64, 59, 55, 50, 45, 38];
  assert.deepEqual(
    sf(positionsFor(38, { tuning: dropDBare })),
    sf(positionsFor(38, { tuning: dropDOpen }))
  );
});

// --- §2 required assertion 3 -------------------------------------------

test('CONTRACT: spanOf exempts open strings', () => {
  const r = spanOf([{ string: 6, fret: 0 }, { string: 4, fret: 7 }, { string: 3, fret: 9 }]);
  assert.equal(r.span, 2, 'frets 7..9; the open 6th string is exempt');
  assert.deepEqual(r, { span: 2, minFret: 7, maxFret: 9, frettedCount: 2, openCount: 1 });
});

test('spanOf: all-open and empty voicings have span 0', () => {
  assert.deepEqual(
    spanOf([{ string: 1, fret: 0 }, { string: 2, fret: 0 }, { string: 3, fret: 0 }]),
    { span: 0, minFret: 0, maxFret: 0, frettedCount: 0, openCount: 3 }
  );
  assert.deepEqual(
    spanOf([]),
    { span: 0, minFret: 0, maxFret: 0, frettedCount: 0, openCount: 0 }
  );
});

test('spanOf: a single fretted note has span 0 at its own fret', () => {
  assert.deepEqual(
    spanOf([{ string: 3, fret: 12 }]),
    { span: 0, minFret: 12, maxFret: 12, frettedCount: 1, openCount: 0 }
  );
});

// --- isPlayableVoicing -------------------------------------------------

const rules = (r) => r.violations.map((v) => v.rule).sort();

test('isPlayableVoicing accepts an ordinary open E-shape barre and open chord', () => {
  const openG = [
    { string: 6, fret: 3 }, { string: 5, fret: 2 }, { string: 4, fret: 0 },
    { string: 3, fret: 0 }, { string: 2, fret: 0 }, { string: 1, fret: 3 },
  ];
  const r = isPlayableVoicing(openG);
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true);
  assert.equal(r.span, 1);
});

test('isPlayableVoicing flags duplicate-string', () => {
  const r = isPlayableVoicing([{ string: 3, fret: 5 }, { string: 3, fret: 7 }]);
  assert.equal(r.ok, false);
  assert.ok(rules(r).includes('duplicate-string'));
  assert.match(r.violations[0].message, /String 3 used twice/);
});

test('isPlayableVoicing flags span past the default 4 below fret 7', () => {
  const r = isPlayableVoicing([{ string: 6, fret: 1 }, { string: 4, fret: 6 }]);
  assert.equal(r.ok, false);
  assert.equal(r.span, 5);
  assert.ok(rules(r).includes('span'));
  assert.match(r.violations.find((v) => v.rule === 'span').message, /max 4/);
});

test('isPlayableVoicing allows span 5 when minFret >= 7', () => {
  const r = isPlayableVoicing([{ string: 6, fret: 7 }, { string: 4, fret: 12 }]);
  assert.equal(r.span, 5);
  assert.equal(r.ok, true, 'span 5 is allowed above fret 7');
  // ...but 6 is still too wide up there.
  const wide = isPlayableVoicing([{ string: 6, fret: 7 }, { string: 4, fret: 13 }]);
  assert.equal(wide.ok, false);
  assert.ok(rules(wide).includes('span'));
});

test('isPlayableVoicing honours an explicit maxSpan override', () => {
  const v = [{ string: 6, fret: 1 }, { string: 4, fret: 6 }];
  assert.equal(isPlayableVoicing(v, { maxSpan: 5 }).ok, true);
  assert.equal(isPlayableVoicing(v, { maxSpan: 2 }).ok, false);
});

test('isPlayableVoicing flags fret-range violations on fret and string', () => {
  const high = isPlayableVoicing([{ string: 1, fret: MAX_FRET + 1 }]);
  assert.equal(high.ok, false);
  assert.deepEqual(rules(high), ['fret-range']);
  assert.match(high.violations[0].message, /outside 0\.\.22/);

  const negative = isPlayableVoicing([{ string: 1, fret: -1 }]);
  assert.ok(rules(negative).includes('fret-range'));

  const badString = isPlayableVoicing([{ string: 7, fret: 3 }]);
  assert.ok(rules(badString).includes('fret-range'));
  assert.match(badString.violations[0].message, /outside 1\.\.6/);

  const badZero = isPlayableVoicing([{ string: 0, fret: 3 }]);
  assert.ok(rules(badZero).includes('fret-range'));
});

test('isPlayableVoicing flags unreachable voicings', () => {
  // Five distinct fretted frets, four fingers.
  const r = isPlayableVoicing(
    [
      { string: 5, fret: 8 }, { string: 4, fret: 9 }, { string: 3, fret: 10 },
      { string: 2, fret: 11 }, { string: 1, fret: 12 },
    ],
    { maxSpan: 99 } // isolate the unreachable rule from the span rule
  );
  assert.equal(r.ok, false);
  assert.deepEqual(rules(r), ['unreachable']);

  // More notes than strings.
  const tooMany = isPlayableVoicing([
    { string: 1, fret: 0 }, { string: 2, fret: 0 }, { string: 3, fret: 0 },
    { string: 4, fret: 0 }, { string: 5, fret: 0 }, { string: 6, fret: 0 },
    { string: 1, fret: 0 },
  ]);
  assert.ok(rules(tooMany).includes('unreachable'));
});

test('isPlayableVoicing tolerates empty input', () => {
  const r = isPlayableVoicing([]);
  assert.deepEqual(r, { ok: true, span: 0, violations: [] });
});

test('isPlayableVoicing can report several rules at once', () => {
  // Same string twice, fret 30 past the neck, and a 29-fret span.
  const r = isPlayableVoicing([{ string: 2, fret: 1 }, { string: 2, fret: 30 }]);
  assert.equal(r.ok, false);
  assert.deepEqual(rules(r), ['duplicate-string', 'fret-range', 'span']);
});

// --- intervalsOf -------------------------------------------------------

test('intervalsOf reports adjacent gaps low to high', () => {
  const r = intervalsOf([64, 55, 60]); // G3, C4, E4
  assert.deepEqual(r.sorted, [55, 60, 64]);
  assert.deepEqual(r.semitones, [5, 4]);
  assert.deepEqual(r.pitchClasses, [0, 4, 7]);
  assert.equal(r.hasSemitoneClash, false);
  assert.equal(r.minGap, 4);
  assert.equal(r.widest, 5);
});

test('intervalsOf detects a semitone clash', () => {
  const r = intervalsOf([60, 61, 67]); // C4 / Db4 rub
  assert.equal(r.hasSemitoneClash, true);
  assert.equal(r.minGap, 1);
  assert.deepEqual(r.semitones, [1, 6]);

  // A minor 9th (13 semitones) is NOT a clash — only the adjacent gap counts.
  assert.equal(intervalsOf([60, 73]).hasSemitoneClash, false);
  // ...but the same two pitch classes packed into one octave is.
  assert.equal(intervalsOf([60, 61]).hasSemitoneClash, true);
});

test('intervalsOf keeps duplicates in sorted but dedupes pitchClasses', () => {
  const r = intervalsOf([64, 64, 52]);
  assert.deepEqual(r.sorted, [52, 64, 64]);
  assert.deepEqual(r.semitones, [12, 0]);
  assert.deepEqual(r.pitchClasses, [4]);
  assert.equal(r.minGap, 0, 'a doubled pitch is a gap of 0, not a clash');
  assert.equal(r.hasSemitoneClash, false);
});

test('intervalsOf handles empty and single-pitch sets', () => {
  assert.deepEqual(intervalsOf([]), {
    sorted: [], semitones: [], pitchClasses: [],
    hasSemitoneClash: false, minGap: 0, widest: 0,
  });
  assert.deepEqual(intervalsOf([60]), {
    sorted: [60], semitones: [], pitchClasses: [0],
    hasSemitoneClash: false, minGap: 0, widest: 0,
  });
  assert.deepEqual(intervalsOf(null).sorted, []);
});

test('intervalsOf drops non-numeric entries', () => {
  assert.deepEqual(intervalsOf([60, null, 64, undefined, NaN]).sorted, [60, 64]);
});

// --- integration -------------------------------------------------------

test('positionsFor -> isPlayableVoicing composes for a real power chord', () => {
  // G5: G2 (string 6 fret 3) + D3 (string 5 fret 5)
  const g2 = positionsFor(43).find((p) => p.string === 6);
  const d3 = positionsFor(50).find((p) => p.string === 5);
  assert.ok(g2 && d3, 'both pitches must be reachable');
  assert.deepEqual(sf([g2, d3]), [{ string: 6, fret: 3 }, { string: 5, fret: 5 }]);
  const r = isPlayableVoicing([g2, d3]);
  assert.equal(r.ok, true);
  assert.equal(r.span, 2);
  assert.equal(intervalsOf([43, 50]).semitones[0], 7, 'a perfect fifth');
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
process.exit(failed ? 1 : 0);

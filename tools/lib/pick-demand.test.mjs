// pick-demand.test.mjs — self-test for tools/lib/pick-demand.mjs (contract C12).
// Run: node tools/lib/pick-demand.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// The classifier's whole value is that it reproduces
// reference/guitar-playability.md's "Tempo × subdivision ceiling" table EXACTLY.
// A table encoded in code is only trustworthy if something reads it back, so
// every cell is asserted, and every tempo BOUNDARY is asserted from both sides:
// 99/100/101, 139/140/141, 179/180/181. Off-by-one at a band edge is the one
// bug a spot check would never find and a musician would immediately feel.
//
// C12 pins the band semantics as [lo, hi) except the last, so 100 BPM belongs to
// the SECOND band even though the reference's prose row header reads "<= 100".
// That disagreement between prose and machine rule is exactly why it is pinned
// here rather than left to the reader.

import assert from 'node:assert/strict';
import {
  classifyPickDemand,
  pickDemandAdvisoryCode,
  subdivisionOf,
  tempoBandOf,
  LEVELS,
  TEMPO_BOUNDARIES,
  DEFAULT_MAX_BURST_BEATS,
} from './pick-demand.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Level for one cell, with a short run so `sustained` never colours it. */
const levelAt = (tempo, duration, extra = {}) =>
  classifyPickDemand({ tempo, duration, consecutiveAttacks: 1, ...extra }).level;

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

test('subdivisionOf maps alphaTab durations onto the reference columns', () => {
  assert.equal(subdivisionOf(1), 'other', 'whole note');
  assert.equal(subdivisionOf(2), 'other', 'half note');
  assert.equal(subdivisionOf(4), 'other', 'quarter — no picking-speed question');
  assert.equal(subdivisionOf(8), '8th');
  assert.equal(subdivisionOf(16), '16th');
  assert.equal(subdivisionOf(32), '32nd');
  // A 16th TRIPLET is duration 16 at 3:2 -> effective 24: six attacks per beat.
  // The reference groups it with 32nds ("16th triplets / 32nds").
  assert.equal(subdivisionOf(24), '32nd', '16th triplet belongs to the hardest column');
  // Faster than a 32nd must not fall off the end into `other`.
  assert.equal(subdivisionOf(64), '32nd');
  assert.equal(subdivisionOf(128), '32nd');
});

test('tempo bands are UPPER-INCLUSIVE (lo, hi] — boundaries 100 / 140 / 180', () => {
  // The reference's first row reads "<= 100 BPM" and its last "> 180", so a
  // boundary tempo belongs to the band BELOW it. Off-by-one here silently
  // re-grades an entire tempo band, which is why all three boundaries are
  // pinned from both sides.
  assert.deepEqual(TEMPO_BOUNDARIES, [100, 140, 180]);
  assert.equal(tempoBandOf(40), 0);
  assert.equal(tempoBandOf(99), 0);
  assert.equal(tempoBandOf(100), 0, '100 is the END of band 1 — the reference says "<= 100"');
  assert.equal(tempoBandOf(101), 1);
  assert.equal(tempoBandOf(139), 1);
  assert.equal(tempoBandOf(140), 1, '140 closes band 2, not opens band 3');
  assert.equal(tempoBandOf(141), 2);
  assert.equal(tempoBandOf(179), 2);
  assert.equal(tempoBandOf(180), 2, '180 closes band 3 — the reference says "> 180"');
  assert.equal(tempoBandOf(181), 3);
  assert.equal(tempoBandOf(300), 3, 'the last band is unbounded above');
});

test('every table cell matches the reference, at every boundary tempo', () => {
  // rows: [tempo, 8ths, 16ths, 32nd/16th-triplet]. The three tempos per band are
  // the boundary triples the acceptance criteria name.
  const expected = [
    // band 0 — <= 100
    [40, 'easy', 'easy', 'expert'],
    [99, 'easy', 'easy', 'expert'],
    [100, 'easy', 'easy', 'expert'],
    // band 1 — (100, 140]
    [101, 'easy', 'moderate', 'expert'],
    [139, 'easy', 'moderate', 'expert'],
    [140, 'easy', 'moderate', 'expert'],
    // band 2 — (140, 180]
    [141, 'easy', 'hard', 'avoid'],
    [179, 'easy', 'hard', 'avoid'],
    [180, 'easy', 'hard', 'avoid'],
    // band 3 — > 180
    [181, 'moderate', 'expert', 'avoid'],
    [240, 'moderate', 'expert', 'avoid'],
  ];
  for (const [tempo, eighths, sixteenths, thirtyseconds] of expected) {
    assert.equal(levelAt(tempo, 8), eighths, `8ths at ${tempo} BPM`);
    assert.equal(levelAt(tempo, 16), sixteenths, `16ths at ${tempo} BPM`);
    assert.equal(levelAt(tempo, 32), thirtyseconds, `32nds at ${tempo} BPM`);
    // A 16th triplet shares the 32nd column by construction.
    assert.equal(levelAt(tempo, 24), thirtyseconds, `16th triplets at ${tempo} BPM`);
    // Quarter notes and slower are never a picking-speed question.
    assert.equal(levelAt(tempo, 4), 'easy', `quarters at ${tempo} BPM`);
  }
});

// ---------------------------------------------------------------------------
// Burst budget
// ---------------------------------------------------------------------------

test('sustained is the reference\'s <= 2-beat burst budget, measured in beats', () => {
  assert.equal(DEFAULT_MAX_BURST_BEATS, 2);
  // 16ths: 4 per beat, so 8 attacks is exactly 2 beats — the budget, not past it.
  assert.equal(classifyPickDemand({ tempo: 168, duration: 16, consecutiveAttacks: 8 }).sustained,
    false, '8 sixteenths = exactly 2 beats is still a legal burst');
  const nine = classifyPickDemand({ tempo: 168, duration: 16, consecutiveAttacks: 9 });
  assert.equal(nine.sustained, true, '9 sixteenths = 2.25 beats exceeds the budget');
  assert.equal(nine.runBeats, 2.25);
  // 8ths: 2 per beat, so the same budget is 4 attacks.
  assert.equal(classifyPickDemand({ tempo: 200, duration: 8, consecutiveAttacks: 4 }).sustained, false);
  assert.equal(classifyPickDemand({ tempo: 200, duration: 8, consecutiveAttacks: 5 }).sustained, true);
  // 32nds: 8 per beat -> 16 attacks.
  assert.equal(classifyPickDemand({ tempo: 90, duration: 32, consecutiveAttacks: 16 }).sustained, false);
  assert.equal(classifyPickDemand({ tempo: 90, duration: 32, consecutiveAttacks: 17 }).sustained, true);
  // The budget is a parameter (Wave 3 feeds profile.pickDemand.maxBurstBeats).
  assert.equal(
    classifyPickDemand({ tempo: 168, duration: 16, consecutiveAttacks: 9, maxBurstBeats: 4 }).sustained,
    false, 'a wider budget must actually widen it');
});

test('a run of zero attacks is never sustained', () => {
  const r = classifyPickDemand({ tempo: 200, duration: 32, consecutiveAttacks: 0 });
  assert.equal(r.sustained, false);
  assert.equal(r.runBeats, 0);
});

// ---------------------------------------------------------------------------
// Articulation
// ---------------------------------------------------------------------------

test('non-picked articulation downgrades the level by exactly one step', () => {
  // 16ths at 200 BPM: picked = expert.
  assert.equal(levelAt(200, 16), 'expert');
  assert.equal(levelAt(200, 16, { articulation: 'legato' }), 'hard');
  assert.equal(levelAt(200, 16, { articulation: 'tremolo' }), 'hard');
  // 32nds at 200: avoid -> expert.
  assert.equal(levelAt(200, 32), 'avoid');
  assert.equal(levelAt(200, 32, { articulation: 'tremolo' }), 'expert');
  // The downgrade floors at `easy` rather than running off the array.
  assert.equal(levelAt(90, 8, { articulation: 'legato' }), 'easy');
  // `baseLevel` keeps the un-downgraded reading visible for diagnostics.
  const r = classifyPickDemand({ tempo: 200, duration: 32, consecutiveAttacks: 1, articulation: 'legato' });
  assert.equal(r.baseLevel, 'avoid');
  assert.equal(r.level, 'expert');
});

// ---------------------------------------------------------------------------
// Advisory selection — the positive/negative pair C11.6 asks for
// ---------------------------------------------------------------------------

test('advisory codes: avoid always fires; hard/expert need a sustained run', () => {
  // NEGATIVE: an easy/moderate cell never fires, sustained or not.
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 120, duration: 16, consecutiveAttacks: 64 })), null,
  'moderate is not a finding however long it runs');
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 240, duration: 8, consecutiveAttacks: 64 })), null,
  'moderate 8ths at 240 BPM is still not a finding');

  // NEGATIVE: a hard/expert cell in a SHORT burst is explicitly sanctioned by
  // the reference ("expert, short bursts only") — silence is the correct answer.
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 168, duration: 16, consecutiveAttacks: 8 })), null,
  'a 2-beat burst of 16ths at 168 must stay quiet');
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 90, duration: 32, consecutiveAttacks: 4 })), null,
  'a 4-note flourish of 32nds must stay quiet');

  // POSITIVE: the same cells past the burst budget.
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 168, duration: 16, consecutiveAttacks: 9 })), 'pick-demand.hard');
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 200, duration: 16, consecutiveAttacks: 9 })), 'pick-demand.expert');
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 90, duration: 32, consecutiveAttacks: 17 })), 'pick-demand.expert');

  // POSITIVE: `avoid` is not burst-conditional — the reference cell reads "no".
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 160, duration: 32, consecutiveAttacks: 1 })), 'pick-demand.avoid');
  assert.equal(pickDemandAdvisoryCode(
    classifyPickDemand({ tempo: 200, duration: 24, consecutiveAttacks: 1 })), 'pick-demand.avoid');
});

test('the returned shape is contract C12\'s, with the level from LEVELS', () => {
  const r = classifyPickDemand({ tempo: 168, duration: 16, consecutiveAttacks: 10 });
  for (const k of ['level', 'tempo', 'subdivision', 'consecutiveAttacks', 'sustained']) {
    assert.ok(k in r, `missing contract key "${k}"`);
  }
  assert.ok(LEVELS.includes(r.level));
  assert.equal(r.tempo, 168);
  assert.equal(r.subdivision, '16th');
  assert.equal(r.consecutiveAttacks, 10);
  assert.equal(r.sustained, true);
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test('malformed input throws rather than classifying a shred passage as easy', () => {
  assert.throws(() => classifyPickDemand({ tempo: 'fast', duration: 16, consecutiveAttacks: 1 }), TypeError);
  assert.throws(() => classifyPickDemand({ tempo: 120, duration: null, consecutiveAttacks: 1 }), TypeError);
  assert.throws(() => classifyPickDemand({ tempo: 120, duration: 16, consecutiveAttacks: 1.5 }), TypeError);
  assert.throws(() => classifyPickDemand({ tempo: 120, duration: 16, consecutiveAttacks: -1 }), TypeError);
  assert.throws(() => classifyPickDemand({
    tempo: 120, duration: 16, consecutiveAttacks: 1, articulation: 'strummed',
  }), TypeError);
  assert.throws(() => pickDemandAdvisoryCode(null), TypeError);
});

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

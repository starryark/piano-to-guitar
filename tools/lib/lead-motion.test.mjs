// lead-motion.test.mjs — self-test for `analyzeLeadStringLeaps` in
// tools/lib/fingering.mjs (Implement.md §4.4, Plan §8.3, contract C3 `lead.*`).
// Run: node tools/lib/lead-motion.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// A string leap is only a finding when NOTHING in the writing explains it, so
// almost every test here is a suppression test: the same three-string jump,
// written five different ways, must fire exactly once. If a suppressor silently
// stopped working the analyzer would not go quiet — it would start shouting at
// idiomatic writing, which is the failure mode that gets an advisory ignored
// forever.
//
// The other half is the event model, and it caught a real defect: alphaTab's
// `beat.playbackStart` is BAR-RELATIVE, not absolute. Reading it as absolute
// made every bar start at tick 0, so sorting by time interleaved all the bars
// and invented leaps between notes that are seconds apart. The cross-bar test
// below is the one that would catch that again.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTex } from './score-utils.mjs';
import { hasAdvisory } from './advisory.mjs';
import {
  LEAD_LEAP_MIN_STRINGS,
  LEAD_REST_SUPPRESS_BEATS,
  analyzeLeadStringLeaps,
} from './fingering.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures', 'lead');

function scoreOf(file, dir = FIX) {
  const loaded = loadTex(path.join(dir, file));
  assert.equal(loaded.ok, true,
    `${file} did not parse: ${JSON.stringify((loaded.errors ?? []).filter((e) => e.severity === 'error').slice(0, 3))}`);
  return loaded.score;
}
const analyze = (file, opts) => analyzeLeadStringLeaps(scoreOf(file), opts);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test('a 3-string skip between adjacent eighths fires', () => {
  const r = analyze('leap-fast.alphatab');
  assert.ok(r.stats.leaps > 0, 'expected leaps');
  assert.equal(hasAdvisory(r.advisories, 'lead.string-leap'), true);
  const a = r.advisories[0];
  assert.equal(Math.abs(a.data.toString - a.data.fromString), a.data.strings);
  assert.ok(a.data.strings >= LEAD_LEAP_MIN_STRINGS);
});

test('a 2-string move at the same speed stays silent', () => {
  // The threshold is "MORE than two strings". A tool that warned here would be
  // objecting to ordinary melodic writing.
  const r = analyze('leap-adjacent.alphatab');
  assert.equal(r.stats.leaps, 0, 'a two-string move is not a leap');
  assert.deepEqual(r.advisories, []);
  assert.ok(r.stats.transitions > 10, 'the fixture really does have transitions to judge');
});

test('the threshold is configurable per call, never per style', () => {
  const strict = analyze('leap-adjacent.alphatab', { minStrings: 2 });
  assert.ok(strict.stats.leaps > 0, 'lowering the bar must expose the same movement');
  const loose = analyze('leap-fast.alphatab', { minStrings: 5 });
  assert.equal(loose.stats.leaps, 0);
});

// ---------------------------------------------------------------------------
// Suppression — the same jump, written five ways
// ---------------------------------------------------------------------------

test('a long rest suppresses: after a breath the hand is free', () => {
  const r = analyze('leap-rest.alphatab');
  assert.equal(r.stats.leaps, 0);
  assert.ok(r.stats.transitions > 0, 'the transitions were examined, not skipped');
});

test('a slide suppresses: the leap IS the gesture', () => {
  assert.equal(analyze('leap-slide.alphatab').stats.leaps, 0);
});

test('a hammer/pull link suppresses', () => {
  assert.equal(analyze('leap-legato.alphatab').stats.leaps, 0);
});

test('let-ring suppresses: the note was written to carry across the move', () => {
  assert.equal(analyze('leap-letring.alphatab').stats.leaps, 0);
});

test('a tie chain suppresses, and its continuations are not attacks', () => {
  const r = analyze('leap-tie.alphatab');
  assert.equal(r.stats.events, 2, 'four beats of one tied note is ONE attack per bar');
  assert.equal(r.stats.leaps, 0);
});

test('the gap is measured as SILENCE, so a sustained note is not free time', () => {
  // A tie chain occupies real time. If a continuation were dropped outright, the
  // held note would end at its first fragment and the three beats it is still
  // sounding would read as three beats of freedom for the hand.
  const r = analyze('leap-tie.alphatab', { minStrings: 1 });
  const cross = r.leaps.find((l) => l.fromBar !== l.toBar);
  assert.equal(cross, undefined,
    'the bar-1 note sustains to the bar line, so there is no short gap to the bar-2 attack');
});

test('every suppressor is REPORTED even when it did not fire', () => {
  // "We looked at the slide and it was not there" is the evidence that lets a
  // reader disagree with the finding.
  const a = analyze('leap-fast.alphatab').advisories[0];
  assert.deepEqual(Object.keys(a.data.considered).sort(),
    ['legato', 'letRing', 'rest', 'slide', 'tie']);
  assert.ok(Object.values(a.data.considered).every((v) => v === false));
});

// ---------------------------------------------------------------------------
// The event model
// ---------------------------------------------------------------------------

test('voices are independent: two lines 3 strings apart produce no leap', () => {
  // §8.3 policies 5 and 6. Without per-voice streams this fixture reads as one
  // line hopping between string 1 and string 4 on every eighth.
  const r = analyze('leap-two-voices.alphatab');
  assert.equal(r.stats.streams, 2, 'one stream per (track, staff, voice)');
  assert.equal(r.stats.leaps, 0);
});

test('the lead of a chord is the HIGHEST attacked pitch, deterministically', () => {
  // The fixture alternates a (string 4 + string 1) grip with a lone string-4
  // note. Reading the lead as the highest pitch makes that a 3-string leap;
  // reading it as the lowest makes it no movement at all.
  const r = analyze('leap-chord-lead.alphatab');
  assert.ok(r.stats.leaps > 0, 'the highest attacked pitch is on string 1');
  assert.equal(r.leaps[0].fromString, 1);
  assert.equal(r.leaps[0].toString, 4);
});

test('bars do not overlap: playbackStart is bar-relative, and is treated as such', () => {
  // THE REGRESSION. `beat.playbackStart` restarts at 0 in every bar; only
  // `masterBar.start + playbackStart` is absolute. Reading it as absolute made
  // every bar occupy the same ticks, so a time-ordered walk interleaved them and
  // reported leaps between notes that are a bar apart.
  const r = analyze('leap-fast.alphatab');
  assert.ok(r.leaps.length > 0, 'the fixture must produce leaps for this to assert anything');
  // Every reported leap must be between temporally ADJACENT attacks — never
  // spanning more than a bar line, and never with a negative gap.
  for (const leap of r.leaps) {
    assert.ok(Math.abs(leap.toBar - leap.fromBar) <= 1,
      `a leap spanned bars ${leap.fromBar} -> ${leap.toBar}`);
    assert.ok(leap.gapBeats >= 0, 'a negative gap means the tick model is inverted');
  }
});

test('a bar range scopes the analysis', () => {
  const all = analyze('leap-fast.alphatab');
  const one = analyze('leap-fast.alphatab', { range: { lo: 1, hi: 1 } });
  assert.ok(one.stats.events < all.stats.events);
  assert.ok(one.leaps.every((l) => l.fromBar === 1 && l.toBar === 1));
});

test('trackIndices restricts the analysis (Wave 5 preparation)', () => {
  const all = analyze('leap-fast.alphatab');
  assert.ok(all.stats.leaps > 0);
  const none = analyze('leap-fast.alphatab', { trackIndices: [9] });
  assert.equal(none.stats.events, 0);
  assert.equal(none.stats.leaps, 0);
});

test('a piano staff is skipped with a reason: its notes have no string at all', () => {
  const score = scoreOf('chaconne-excerpt.alphatab', path.join(ROOT, 'tools', 'fixtures'));
  const r = analyzeLeadStringLeaps(score);
  assert.ok(r.stats.skippedStaves.length > 0);
  assert.ok(r.stats.skippedStaves.every((s) => typeof s.reason === 'string' && s.reason.length));
  assert.equal(r.stats.leaps, 0);
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test('repeated identical leaps collapse into one advisory carrying occurrences', () => {
  // A riff that alternates a low pedal with a high stab poses the same question
  // fourteen times; fourteen copies of it is how a real finding gets scrolled
  // past. Same doctrine as fingering's located advisories and pick-demand.
  const r = analyze('leap-fast.alphatab');
  assert.ok(r.stats.leaps > r.advisories.length, 'the fixture repeats the same leap');
  const total = r.advisories.reduce((n, a) => n + a.data.occurrences, 0);
  assert.equal(total, r.stats.leaps, 'no occurrence may be lost in the collapse');
});

test('the advisory is C3-shaped and carries its evidence in data', () => {
  const a = analyze('leap-fast.alphatab').advisories[0];
  assert.equal(a.code, 'lead.string-leap');
  assert.equal(a.severity, 'warning');
  assert.equal(typeof a.message, 'string');
  assert.equal(typeof a.bar, 'number');
  for (const k of ['fromString', 'toString', 'strings', 'fromNote', 'toNote', 'semitones',
    'gapBeats', 'voice', 'considered', 'occurrences']) {
    assert.ok(k in a.data, `data.${k} missing`);
  }
});

test('no NaN or Infinity reaches JSON', () => {
  for (const file of fs.readdirSync(FIX)) {
    const text = JSON.stringify(analyze(file));
    const walk = (v) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${file}: non-finite number`);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(JSON.parse(text));
  }
});

test('two analyses of the same input are byte-identical', () => {
  assert.equal(JSON.stringify(analyze('leap-fast.alphatab')),
    JSON.stringify(analyze('leap-fast.alphatab')));
});

test('the rest threshold is the phrase breath, not an independent number', () => {
  assert.equal(LEAD_REST_SUPPRESS_BEATS, 2,
    'a breath is the same claim about the same hand the phrase model already makes');
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

// contract.test.mjs — the melody-contract validator (tools/lib/contract.mjs).
// Run: node tools/lib/contract.test.mjs   (exit 0 = all green, 1 = failure)
//
// §4.3's fail-closed list, pinned one case per rule. The validator guards the
// contract GATE (compare.mjs refuses to run on an invalid contract), so a rule
// silently going soft here would let a hollow contract read as PASS at Gate B.

import assert from 'node:assert/strict';
import { validateContract, pitchToMidi, effectiveRelocation } from './contract.mjs';
import { parseTex, buildDigest } from './analysis.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A tiny real digest, for evidence checks: bar 1 = attacks; bar 2 = a tie
// continuation of F#4 (head in bar 1).
const DIGEST_TEXT = String.raw`
\tempo 120
.
\track "Piano" { instrument acousticgrandpiano }
\staff { score }
\voice
\ts (4 4)
B4.4 B4.4 A4.4 F#4.4 |
F#4{t}.2 A4.2 |
`;
const parsed = parseTex(DIGEST_TEXT);
const DIGEST = buildDigest(parsed.score, { song: 'contract test' });

const validPhrase = () => ({
  id: 'p1',
  sourceBars: [1, 1],
  events: [
    { bar: 1, onset: 0, pitch: 'B4', duration: 1 },
    { bar: 1, onset: 2, pitch: 'A4', duration: 1 },
  ],
});
const base = () => ({ version: 1, song: 't', phrases: [validPhrase()] });

test('a well-formed contract validates, with non-zero obligation stats', () => {
  const r = validateContract(base(), DIGEST);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.stats.requiredEvents, 2);
  assert.equal(r.stats.durationObligations, 2);
});

test('VACUITY: zero phrases, zero obligations, or an empty phrase all fail', () => {
  assert.equal(validateContract({ version: 1, phrases: [] }).ok, false);
  const noObligations = { version: 1, phrases: [{ id: 'p', sourceBars: [1, 1], events: [{ bar: 1, onset: 0, pitch: 'B4', required: false }] }] };
  const r = validateContract(noObligations, DIGEST);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /protects nothing|ZERO obligations/i.test(e.message)));
});

test('nonexistent source bars fail against the digest', () => {
  const c = base();
  c.phrases[0].sourceBars = [1, 9];
  const r = validateContract(c, DIGEST);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /absent from the digest/.test(e.message)));
});

test('impossible pitch under the declared relocation fails', () => {
  const c = base();
  c.phrases[0].events.push({ bar: 1, onset: 3, pitch: 'F#4', duration: 1, octaveRelocation: -36 });
  const r = validateContract(c, DIGEST);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /outside the guitar range/.test(e.message)));
});

test('invalid duration policies fail (<=0, minimum > source, attacks < 1)', () => {
  const c1 = base();
  c1.phrases[0].events[0].duration = 0;
  assert.equal(validateContract(c1, DIGEST).ok, false);
  const c2 = base();
  c2.phrases[0].events[0].sourceDuration = 0.5; // duration 1 > source 0.5
  assert.equal(validateContract(c2, DIGEST).ok, false);
  const c3 = base();
  c3.phrases[0].events[0].attacks = 0;
  assert.equal(validateContract(c3, DIGEST).ok, false);
});

test('contradictory obligations at the same source moment fail', () => {
  const c = base();
  c.phrases.push({
    id: 'p2',
    sourceBars: [1, 1],
    events: [{ bar: 1, onset: 0, pitch: 'B4', duration: 0.5 }], // same B4@1:0, other duration
  });
  const r = validateContract(c, DIGEST);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /contradicts/.test(e.message)));
});

test('a relocation group cutting through a phrase needs explicit justification', () => {
  const c = base();
  c.phrases[0].sourceBars = [1, 2];
  c.phrases[0].events.push({ bar: 2, onset: 2, pitch: 'A4', duration: 1 });
  c.relocationGroups = [{ sourceBars: [2, 2], semitones: -12, reason: 'range' }];
  const r = validateContract(c, DIGEST);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /cuts through phrase/.test(e.message)));
  c.relocationGroups[0].allowMidPhrase = true;
  const r2 = validateContract(c, DIGEST);
  assert.ok(!r2.errors.some((e) => /cuts through phrase/.test(e.message)));
});

test('a required event whose only evidence is a tied continuation fails', () => {
  const c = base();
  c.phrases[0].sourceBars = [1, 2];
  // F#4 at bar 2 onset 0 exists ONLY as the tail of the bar-1 tie chain.
  c.phrases[0].events.push({ bar: 2, onset: 0, pitch: 'F#4', duration: 1 });
  const r = validateContract(c, DIGEST);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /only as a tied continuation/.test(e.message)));
});

test('relocation must be a whole octave; overlapping groups fail', () => {
  const c = base();
  c.relocationGroups = [{ sourceBars: [1, 1], semitones: -5, reason: 'x', allowMidPhrase: true }];
  assert.equal(validateContract(c, DIGEST).ok, false);
  const c2 = base();
  c2.phrases[0].sourceBars = [1, 2];
  c2.relocationGroups = [
    { sourceBars: [1, 2], semitones: -12, reason: 'x' },
    { sourceBars: [2, 2], semitones: 12, reason: 'y', allowMidPhrase: true },
  ];
  const r = validateContract(c2, DIGEST);
  assert.ok(r.errors.some((e) => /overlapping groups/.test(e.message)));
});

test('effectiveRelocation precedence: event > phrase > group', () => {
  const contract = {
    version: 1,
    phrases: [{
      id: 'p', sourceBars: [1, 2],
      allowedReductions: { octaveRelocation: -12 },
      events: [],
    }],
    relocationGroups: [{ sourceBars: [1, 2], semitones: 12 }],
  };
  const phrase = contract.phrases[0];
  assert.equal(effectiveRelocation(contract, phrase, { bar: 1, octaveRelocation: 24 }), 24);
  assert.equal(effectiveRelocation(contract, phrase, { bar: 1 }), -12);
  delete phrase.allowedReductions;
  assert.equal(effectiveRelocation(contract, phrase, { bar: 1 }), 12);
  assert.equal(effectiveRelocation(contract, phrase, { bar: 5 }), 0);
});

test('pitchToMidi: octave-exact scientific pitch', () => {
  assert.equal(pitchToMidi('A4'), 69);
  assert.equal(pitchToMidi('C#5'), 73);
  assert.equal(pitchToMidi('Bb3'), 58);
  assert.equal(pitchToMidi('E2'), 40);
  assert.equal(pitchToMidi('H4'), null);
  assert.equal(pitchToMidi('A'), null);
});

// --------------------------------------------------------------------------- //
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

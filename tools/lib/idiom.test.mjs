// idiom.test.mjs — self-test for tools/lib/idiom.mjs and tools/idiom.mjs
// (contract C3 + addendum §A3). Run: node tools/lib/idiom.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// An idiom score is an OPINION expressed as a number, and the danger is not that
// the number is slightly off — it is that the tool says something confident about
// music it never looked at. So the suite is weighted toward the four ways this
// module could lie:
//
//   1. counting a SUSTAIN as a repetition (a tie destination is not an attack);
//   2. merging two independent VOICES or TRACKS into one phantom riff;
//   3. reporting "no measurement" as "measured zero" (a single-note line has no
//      grips, and that is not the same as having bad ones);
//   4. universalising one genre's techniques — the false positive Implement.md
//      §3.2 forbids by name.
//
// Every weighted feature gets a positive fixture (it fires) and a negative one
// (it stays quiet), per contract C11.6. Tests assert CODES and structural
// fields, never prose.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTex } from './score-utils.mjs';
import { loadStyleProfile, mergeStyleProfile } from './style-profile.mjs';
import { hasAdvisory } from './advisory.mjs';
import {
  FEATURE_ORDER,
  GRIP_FEATURES,
  analyzeIdiomDensity,
  extractIdiomEvents,
  extractIdiomFeatures,
  findPalmMuteRuns,
  isOctaveGrip,
  isPowerChord,
  isShellVoicing,
  scoreFeatures,
} from './idiom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures', 'idiom');
const CLI = path.join(ROOT, 'tools', 'idiom.mjs');

const profileOf = (name) => {
  const r = loadStyleProfile(name);
  assert.equal(r.ok, true, `style ${name}: ${r.errors.join('; ')}`);
  return r.profile;
};

const scoreOf = (file) => {
  const loaded = loadTex(path.join(FIX, file));
  assert.equal(loaded.ok, true, `${file} did not parse: ${JSON.stringify(loaded.errors?.slice(0, 3))}`);
  return loaded.score;
};

/** Analyse a fixture under a style (optionally with a profile override). */
function analyze(file, style = 'hard-rock', { range, overrides, trackIndices } = {}) {
  let profile = profileOf(style);
  if (overrides) {
    const merged = mergeStyleProfile(profile, overrides);
    assert.equal(merged.ok, true, merged.errors.join('; '));
    profile = merged.profile;
  }
  return analyzeIdiomDensity(scoreOf(file), { profile, range, trackIndices });
}

const featuresOf = (file, opts) => extractIdiomFeatures(scoreOf(file), opts).features;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Grip classification — the primitives every grip feature is built on
// ---------------------------------------------------------------------------

test('a power chord is root+5th (+octave), with or without the octave, never with a 3rd', () => {
  assert.equal(isPowerChord([40, 47]), true, 'E2 + B2');
  assert.equal(isPowerChord([40, 47, 52]), true, 'E2 + B2 + E3');
  assert.equal(isPowerChord([40, 44, 47]), false, 'a major 3rd disqualifies it');
  assert.equal(isPowerChord([40, 43, 47]), false, 'a minor 3rd disqualifies it');
  assert.equal(isPowerChord([40]), false, 'one note is not a grip');
});

test('a bass note and a fifth three octaves up is arithmetic, not a power chord', () => {
  // The POWER_CHORD_MAX_SPAN guard. Without it every widely-spaced simultaneity
  // whose interval happens to be 7 mod 12 would score as a rock grip.
  assert.equal(isPowerChord([40, 47 + 24]), false);
  assert.equal(isPowerChord([40, 47 + 12]), true, 'within two octaves is still a grip');
});

test('an octave grip is one pitch class spanning at least an octave', () => {
  assert.equal(isOctaveGrip([40, 52]), true);
  assert.equal(isOctaveGrip([40, 52, 64]), true);
  assert.equal(isOctaveGrip([40, 47]), false, 'a fifth is not an octave');
  assert.equal(isOctaveGrip([40, 40]), false, 'a unison spans nothing');
});

test('a shell voicing is root + 3rd + 7th with the 5th deliberately absent', () => {
  assert.equal(isShellVoicing([48, 52, 58]), true, 'C7: root, maj3, min7');
  assert.equal(isShellVoicing([48, 51, 58]), true, 'Cm7: root, min3, min7');
  assert.equal(isShellVoicing([48, 52, 55, 58]), false, 'four notes is not a shell');
  assert.equal(isShellVoicing([48, 52, 55]), false, 'a plain triad has a 5th and no 7th');
  assert.equal(isShellVoicing([48, 55, 58]), false, 'a 5th disqualifies it');
});

// ---------------------------------------------------------------------------
// The event model — the three ways this module could lie
// ---------------------------------------------------------------------------

test('a tie destination is not an attack: a sustain is not repetition', () => {
  const { streams } = extractIdiomEvents(scoreOf('tie-sustain.alphatab'));
  const attacks = streams.reduce((n, s) => n + s.attacks.length, 0);
  const holds = streams.reduce((n, s) => n + s.items.filter((i) => i.kind === 'hold').length, 0);
  assert.ok(holds > 0, 'the tied bars must register as holds');
  assert.ok(attacks <= 2, `one struck chord held across bars must not read as many attacks (got ${attacks})`);
  // And it must not be graded at all — two attacks is not a style.
  const r = analyze('tie-sustain.alphatab');
  assert.equal(r.graded, false);
  assert.equal(r.score, null, 'too little evidence is null, never 0');
  assert.deepEqual(r.advisories, [], 'a passage that cannot be graded gets no verdict');
});

test('voices stay separate: a muted voice does not mute the other one', () => {
  const { streams } = extractIdiomEvents(scoreOf('two-voices.alphatab'));
  assert.equal(streams.length, 2, 'one stream per (track, staff, voice)');
  const perStream = streams.map((s) => findPalmMuteRuns(s).covered.size);
  assert.ok(perStream.includes(0), 'the un-muted voice must have no muted run');
  assert.ok(perStream.some((n) => n > 0), 'the muted voice must have one');
  // Aggregated, exactly half the attacks are muted — not all of them, which is
  // what a merged stream would have produced.
  const f = featuresOf('two-voices.alphatab');
  assert.equal(f.palmMutedRepetition.value, 0.5);
});

test('a piano staff has no grips and is SKIPPED with a reason, not scored', () => {
  // The trap fingering.mjs documented: a `\staff { score }` reports no string
  // tuning and its notes come back string:-1/fret:-1. Guessing "6 strings"
  // produced confident nonsense there; it must not happen here either.
  const src = path.join(ROOT, 'tools', 'fixtures', 'chaconne-excerpt.alphatab');
  const loaded = loadTex(src);
  assert.equal(loaded.ok, true);
  const r = analyzeIdiomDensity(loaded.score, { profile: profileOf('hard-rock') });
  assert.ok(r.stats.skippedStaves.length > 0, 'a score staff must be skipped');
  assert.ok(r.stats.skippedStaves.every((s) => typeof s.reason === 'string' && s.reason.length));
  assert.equal(r.graded, false, 'a piano source has no idiom score, low or otherwise');
});

test('a bar range scopes the analysis', () => {
  const all = analyze('metal-riff.alphatab');
  const two = analyze('metal-riff.alphatab', 'hard-rock', { range: { lo: 1, hi: 2 } });
  assert.ok(two.stats.attackEvents < all.stats.attackEvents);
  assert.equal(two.stats.barStart, 1);
  assert.equal(two.stats.barEnd, 2);
});

test('an empty range yields no NaN, no advisory, and no verdict', () => {
  const r = analyze('metal-riff.alphatab', 'hard-rock', { range: { lo: 900, hi: 999 } });
  assert.equal(r.stats.attackEvents, 0);
  assert.equal(r.score, null);
  assert.equal(r.graded, false);
  assert.deepEqual(r.advisories, []);
  for (const f of Object.values(r.features)) {
    assert.equal(f.measured, false);
    assert.equal(f.value, 0, 'an unmeasured feature reports 0 for display');
    assert.ok(Number.isFinite(f.value));
  }
});

test('nothing that reaches JSON is NaN or Infinity, and no alphaTab object leaks', () => {
  for (const file of fs.readdirSync(FIX)) {
    const r = analyze(file);
    const text = JSON.stringify(r);
    assert.ok(!/null,"(numerator|denominator)"/.test(text));
    const walk = (v) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${file}: non-finite number`);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(JSON.parse(text));
    assert.ok(!text.includes('"beat"'), `${file}: a parsed alphaTab beat leaked into the result`);
  }
});

// ---------------------------------------------------------------------------
// Per-feature positive/negative pairs (C11.6)
// ---------------------------------------------------------------------------

test('powerChord: fires on a power-chord riff, silent on piano block chords', () => {
  assert.ok(featuresOf('metal-riff.alphatab').powerChord.value > 0.9);
  assert.equal(featuresOf('piano-block.alphatab').powerChord.value, 0);
});

test('octave: fires on an octave riff, silent on a power-chord riff', () => {
  assert.equal(featuresOf('octaves.alphatab').octave.value, 1);
  assert.equal(featuresOf('metal-riff.alphatab').octave.value, 0);
});

test('pedalTone: fires on a low pedal under changing stabs, silent on block chords', () => {
  assert.ok(featuresOf('metal-riff.alphatab').pedalTone.value > 0.9);
  assert.equal(featuresOf('piano-block.alphatab').pedalTone.value, 0);
});

test('palmMutedRepetition: fires on a muted run, silent on a clean jazz comp', () => {
  assert.ok(featuresOf('metal-riff.alphatab').palmMutedRepetition.value > 0);
  assert.equal(featuresOf('jazz-shell.alphatab').palmMutedRepetition.value, 0);
});

test('leadArticulation: fires on bends/slides/vibrato, silent on a muted riff', () => {
  assert.ok(featuresOf('lead-articulation.alphatab').leadArticulation.value > 0.5);
  assert.equal(featuresOf('metal-riff.alphatab').leadArticulation.value, 0);
});

test('riffCell: fires on a repeating figure, silent on static repeated chords', () => {
  assert.ok(featuresOf('metal-riff.alphatab').riffCell.value > 0.5);
  // piano-block repeats the SAME chord — repetition without movement is not a
  // riff cell, it is exactly the texture blockChord pushes back on.
  assert.equal(featuresOf('piano-block.alphatab').riffCell.value, 0);
});

test('blockChord: fires on literal piano chords, silent on power chords AND on shells', () => {
  assert.equal(featuresOf('piano-block.alphatab').blockChord.value, 1);
  assert.equal(featuresOf('metal-riff.alphatab').blockChord.value, 0,
    'a power chord is a guitar grip, not a block chord');
  assert.equal(featuresOf('jazz-shell.alphatab').blockChord.value, 0,
    'a shell voicing is a guitar grip, not a block chord');
});

test('fragmentation: fires on eighths, silent on a bar of quarters', () => {
  assert.ok(featuresOf('metal-riff.alphatab').fragmentation.value > 0.5);
  assert.equal(featuresOf('piano-block.alphatab').fragmentation.value, 0);
});

test('shellVoicing: fires on jazz shells, silent on the metal and piano fixtures', () => {
  assert.equal(featuresOf('jazz-shell.alphatab').shellVoicing.value, 1);
  assert.equal(featuresOf('metal-riff.alphatab').shellVoicing.value, 0);
  assert.equal(featuresOf('piano-block.alphatab').shellVoicing.value, 0);
});

test('syncopation: an off-beat attack that anticipates counts; straight eighths do not', () => {
  // Straight subdivision is not displacement — the whole point of the two-part
  // rule in §A3. A bar of on-and-off eighths must read 0% syncopated.
  assert.equal(featuresOf('metal-riff.alphatab').syncopation.value, 0);
  assert.ok(featuresOf('jazz-shell.alphatab').syncopation.value > 0,
    'a chord pushed onto the "and" after a rest IS an anticipation');
});

// ---------------------------------------------------------------------------
// Denominators — "not measured" is not "measured zero"
// ---------------------------------------------------------------------------

test('a single-note line leaves every GRIP feature unmeasured, not zero', () => {
  const f = featuresOf('plain-line.alphatab');
  for (const name of GRIP_FEATURES) {
    assert.equal(f[name].measured, false, `${name} has no denominator on a single-note line`);
    assert.equal(f[name].denominator, 0);
  }
  for (const name of FEATURE_ORDER.filter((n) => !GRIP_FEATURES.includes(n))) {
    assert.equal(f[name].measured, true, `${name} is measured against all attacks`);
  }
});

test('an unmeasured feature is dropped from BOTH sides of the ratio', () => {
  const features = featuresOf('plain-line.alphatab');
  const weights = profileOf('hard-rock').idiom.weights;
  const s = scoreFeatures(features, weights);
  // hard-rock's grip family (powerChord 3 / octave 1 / shellVoicing 0) is
  // entirely unmeasured here, so its max must NOT be in the denominator.
  const nonGrip = FEATURE_ORDER
    .filter((n) => !GRIP_FEATURES.includes(n) && weights[n] > 0)
    .reduce((sum, n) => sum + weights[n], 0);
  assert.equal(s.positiveWeight, nonGrip);
});

test('the grip family charges max(weight) once, not the sum', () => {
  // Without this an all-octave riff is marked down for the power chords it did
  // not simultaneously play — an artefact of arithmetic, not an opinion.
  const features = featuresOf('octaves.alphatab');
  const weights = profileOf('hard-rock').idiom.weights;
  const s = scoreFeatures(features, weights);
  const gripMax = Math.max(...GRIP_FEATURES.map((n) => Math.max(weights[n], 0)));
  const nonGrip = FEATURE_ORDER
    .filter((n) => !GRIP_FEATURES.includes(n) && weights[n] > 0)
    .reduce((sum, n) => sum + weights[n], 0);
  assert.equal(s.positiveWeight, gripMax + nonGrip);
});

test('the score is clamped to 0..10 — a heavily piano-like passage is 0, never negative', () => {
  const r = analyze('piano-block.alphatab');
  assert.ok(r.weightedScore.raw < 0, 'the raw sum is genuinely negative');
  assert.equal(r.score, 0, 'but the reported score is clamped');
});

// ---------------------------------------------------------------------------
// The false positives Implement.md §3.2 and Plan §7.3 forbid by name
// ---------------------------------------------------------------------------

test('a clean jazz comp is NOT criticised by the jazz profile for lacking palm muting', () => {
  const r = analyze('jazz-shell.alphatab', 'jazz');
  assert.equal(hasAdvisory(r.advisories, 'idiom.low-density'), false,
    `idiomatic jazz scored ${r.score} against the jazz floor and warned`);
  assert.equal(r.features.palmMutedRepetition.value, 0, 'it really has no palm muting');
  assert.equal(profileOf('jazz').idiom.weights.palmMutedRepetition, 0,
    'and jazz weights that feature at zero, so it cannot be the reason');
});

test('a metal power-chord passage is not criticised for having no thirds', () => {
  for (const style of ['hard-rock', 'metal']) {
    const r = analyze('metal-riff.alphatab', style);
    assert.equal(hasAdvisory(r.advisories, 'idiom.low-density'), false,
      `${style} warned on an idiomatic power-chord riff (score ${r.score})`);
  }
  // And the thirds are genuinely absent — the fixture is not passing by accident.
  assert.equal(featuresOf('metal-riff.alphatab').powerChord.value, 1);
});

test('piano-like repeated block chords DO trigger the intended negative pressure', () => {
  for (const style of ['hard-rock', 'metal', 'blues', 'jazz']) {
    const r = analyze('piano-block.alphatab', style);
    assert.equal(hasAdvisory(r.advisories, 'idiom.low-density'), true,
      `${style} stayed quiet on a literal piano transcription (score ${r.score})`);
  }
});

// ---------------------------------------------------------------------------
// Style behaviour
// ---------------------------------------------------------------------------

test('changing the style changes the advice on the SAME notes', () => {
  const rock = analyze('plain-line.alphatab', 'hard-rock');
  const jazz = analyze('plain-line.alphatab', 'jazz');
  assert.equal(hasAdvisory(rock.advisories, 'idiom.low-density'), false);
  assert.equal(hasAdvisory(jazz.advisories, 'idiom.low-density'), true);
});

test('changing the style never changes what was PARSED', () => {
  const a = analyze('metal-riff.alphatab', 'hard-rock');
  const b = analyze('metal-riff.alphatab', 'jazz');
  assert.equal(a.stats.attackEvents, b.stats.attackEvents);
  assert.equal(a.stats.multiNoteAttacks, b.stats.multiNoteAttacks);
  assert.equal(a.stats.notes, b.stats.notes);
  // Feature VALUES are measurements of the score, not of the style.
  for (const name of FEATURE_ORDER) {
    assert.deepEqual(a.features[name], b.features[name], `${name} must be style-independent`);
  }
});

test('raising a style threshold flips the advisory, and lowering it flips it back', () => {
  const quiet = analyze('octaves.alphatab', 'hard-rock');
  assert.equal(hasAdvisory(quiet.advisories, 'idiom.low-density'), false);
  const strict = analyze('octaves.alphatab', 'hard-rock', { overrides: { idiom: { warnBelow: 9 } } });
  assert.equal(hasAdvisory(strict.advisories, 'idiom.low-density'), true);
  assert.equal(strict.stats.attackEvents, quiet.stats.attackEvents, 'the notes did not change');
});

test('minAttacks withholds a verdict on a passage too short to grade', () => {
  const graded = analyze('metal-riff.alphatab', 'hard-rock');
  assert.equal(graded.graded, true);
  const withheld = analyze('metal-riff.alphatab', 'hard-rock',
    { overrides: { idiom: { minAttacks: 9999 } } });
  assert.equal(withheld.graded, false);
  assert.equal(withheld.score, null);
  assert.deepEqual(withheld.advisories, []);
  assert.ok(withheld.stats.attackEvents > 0, 'the events were still counted and reported');
});

test('the advisory carries its evidence in data, not only in prose', () => {
  const r = analyze('piano-block.alphatab', 'hard-rock');
  const a = r.advisories.find((x) => x.code === 'idiom.low-density');
  assert.ok(a, 'expected the advisory');
  assert.equal(a.severity, 'warning');
  assert.equal(a.data.style, 'hard-rock');
  assert.equal(a.data.threshold, profileOf('hard-rock').idiom.warnBelow);
  assert.equal(typeof a.data.score, 'number');
  assert.equal(typeof a.data.attackEvents, 'number');
  assert.ok(Array.isArray(a.data.strongestFeatures));
  assert.ok(Array.isArray(a.data.missingFeatures));
  assert.ok(a.data.missingFeatures.every((m) => profileOf('hard-rock').idiom.weights[m.feature] > 0),
    'a zero-weighted feature can never be reported as missing');
});

test('jazz can never report palm muting as a missing feature', () => {
  // The structural form of "no missing-palm-mute spam": the advisory's
  // missingFeatures list is filtered by weight > 0, and jazz weights it 0.
  const r = analyze('plain-line.alphatab', 'jazz');
  const a = r.advisories.find((x) => x.code === 'idiom.low-density');
  assert.ok(a);
  assert.ok(!a.data.missingFeatures.some((m) => m.feature === 'palmMutedRepetition'));
});

test('trackIndices restricts the analysis (Wave 5 preparation)', () => {
  const all = analyze('metal-riff.alphatab', 'hard-rock');
  const none = analyze('metal-riff.alphatab', 'hard-rock', { trackIndices: [7] });
  assert.ok(all.stats.attackEvents > 0);
  assert.equal(none.stats.attackEvents, 0, 'an index no track has yields no events');
  assert.equal(none.graded, false);
});

test('analyzeIdiomDensity refuses to run without a validated profile', () => {
  assert.throws(() => analyzeIdiomDensity(scoreOf('metal-riff.alphatab'), {}), TypeError);
  assert.throws(() => analyzeIdiomDensity(scoreOf('metal-riff.alphatab'), { profile: {} }), TypeError);
});

test('two analyses of the same input are byte-identical', () => {
  const a = JSON.stringify(analyze('metal-riff.alphatab', 'metal'));
  const b = JSON.stringify(analyze('metal-riff.alphatab', 'metal'));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// CLI (contract C2)
// ---------------------------------------------------------------------------

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('C2: a soft-only analyzer exits 0 even when it has advisories', () => {
  const r = cli(path.join(FIX, 'piano-block.alphatab'), '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(hasAdvisory(out.advisories, 'idiom.low-density'), true);
});

test('C2: an unknown style exits 2 and never falls back to hard-rock', () => {
  const r = cli(path.join(FIX, 'metal-riff.alphatab'), '--style', 'polka', '--json');
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.join(' ').includes('unknown style'));
});

test('C2: an unparseable tab exits 2, not 1', () => {
  const bad = path.join(ROOT, 'tools', 'fixtures', 'broken-syntax.alphatab');
  const r = cli(bad, '--json');
  assert.equal(r.status, 2);
});

test('C2: a missing file argument exits 2', () => {
  assert.equal(cli().status, 2);
  assert.equal(cli(path.join(FIX, 'no-such-file.alphatab'), '--json').status, 2);
});

test('C2: a bad --bars range exits 2', () => {
  assert.equal(cli(path.join(FIX, 'metal-riff.alphatab'), '--bars', 'x-y').status, 2);
});

test('the CLI reports which style it used and where the choice came from', () => {
  const dflt = JSON.parse(cli(path.join(FIX, 'metal-riff.alphatab'), '--json').stdout);
  assert.equal(dflt.style, 'hard-rock');
  assert.equal(dflt.styleSource, 'default', 'an absent --style must read as "default", not "cli"');
  const chosen = JSON.parse(cli(path.join(FIX, 'metal-riff.alphatab'), '--style', 'metal', '--json').stdout);
  assert.equal(chosen.style, 'metal');
  assert.equal(chosen.styleSource, 'cli');
});

test('the CLI is deterministic across runs', () => {
  const a = cli(path.join(FIX, 'jazz-shell.alphatab'), '--style', 'jazz', '--json').stdout;
  const b = cli(path.join(FIX, 'jazz-shell.alphatab'), '--style', 'jazz', '--json').stdout;
  assert.equal(a, b);
});

test('the CLI never rewrites the tab it analyses (C15)', () => {
  const file = path.join(FIX, 'metal-riff.alphatab');
  const before = fs.readFileSync(file);
  cli(file, '--style', 'metal');
  cli(file, '--json');
  assert.ok(before.equals(fs.readFileSync(file)), 'the fixture must be byte-identical after a run');
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

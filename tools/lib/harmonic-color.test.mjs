// harmonic-color.test.mjs — self-test for tools/lib/harmonic-color.mjs and its
// map-mode integration in tools/compare.mjs (contracts C3, C11.2, C11.4).
// Run: node tools/lib/harmonic-color.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// This analyzer sits one inch from a sentence the whole repository is built on:
// *"a power chord (root+5th, no 3rd) correctly renders BOTH major and minor — a
// missing 3rd is never a miss."* An over-eager version of this module would
// contradict that on every bar of every rock arrangement, and the advisory would
// be switched off inside a week. So the suite is weighted toward SILENCE:
//
//   • one power chord in a passage of shell voicings  -> quiet
//   • a low high-gain reduction that dropped only a 3rd -> quiet
//   • a colour tone moved to an upper-register melody note -> quiet
//   • a source that never had a 3rd or 7th to lose -> quiet
//   • metal, which IS root-fifth writing -> not even measured
//
// and only then toward the one case that should speak: eight consecutive
// harmonies with 3rds and 7ths, all rendered as bare fifths, nothing carrying
// the colour anywhere.
//
// C11.2 is the other invariant on trial: this module reads `harmonySpans[]`, the
// ADDITIVE field, and must never touch `harmony.pcset`'s narrowing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStyleProfile } from './style-profile.mjs';
import { hasAdvisory } from './advisory.mjs';
import {
  LOW_REGISTER_CEILING,
  OBLIGATING_FUNCTIONS,
  analyzeHarmonicColor,
  classifySlice,
  functionsOf,
  isRootFifthOnly,
  noteNameToPc,
  readTabSlice,
  sourceSlicesOf,
} from './harmonic-color.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures', 'harmonic-color');
const SCRATCH = path.join(ROOT, 'out', 'harmonic-color-test');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

function digestOf(stem) {
  const out = path.join(SCRATCH, `${stem}.json`);
  if (!fs.existsSync(out)) {
    const r = node([path.join(ROOT, 'tools', 'piano-extract.mjs'),
      path.join(FIX, `${stem}.alphatab`), '--out', SCRATCH]);
    assert.equal(r.status, 0, `piano-extract ${stem}: ${r.stderr}`);
  }
  return out;
}

/** Run compare.mjs in map mode and return its machine result. */
function compare(tab, sourceStem, { style = 'hard-rock', gain } = {}) {
  const args = [path.join(ROOT, 'tools', 'compare.mjs'), path.join(FIX, tab), digestOf(sourceStem),
    '--bars', '1-8', '--map', path.join(FIX, 'sidecar.json'), '--style', style, '--json'];
  if (gain) args.push('--gain', gain);
  const r = node(args);
  assert.notEqual(r.status, 2, `compare exited 2: ${r.stderr}`);
  return { status: r.status, json: JSON.parse(r.stdout) };
}

const profileOf = (name) => loadStyleProfile(name).profile;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

test('note names read to pitch classes, accidentals included', () => {
  assert.equal(noteNameToPc('C'), 0);
  assert.equal(noteNameToPc('F#'), 6);
  assert.equal(noteNameToPc('Bb'), 10);
  assert.equal(noteNameToPc('Cb'), 11, 'must wrap, not go negative');
  assert.equal(noteNameToPc(''), null);
  assert.equal(noteNameToPc(null), null);
});

test('colour functions are read relative to the root, not absolutely', () => {
  // A minor (root 9): C=0 is the minor third, G=7 is the minor seventh.
  assert.deepEqual(functionsOf(9, [9, 0, 4, 7]).sort(), ['minor-seventh', 'minor-third']);
  // C major (root 0): E=4 major third, B=11 major seventh, D=2 ninth.
  assert.deepEqual(functionsOf(0, [0, 4, 7, 11, 2]).sort(),
    ['major-seventh', 'major-third', 'ninth']);
  assert.deepEqual(functionsOf(0, [0, 7]), [], 'root and fifth name no colour');
  assert.deepEqual(functionsOf(null, [0, 4]), []);
});

test('the 9th is preserving colour but never obligating colour', () => {
  // Asymmetric on purpose: an interval of 2 above the root is a 9th in one
  // reading and a sus2 or a passing tone in another, and the pcset cannot tell
  // them apart. The asymmetry always favours silence.
  assert.ok(!OBLIGATING_FUNCTIONS.includes('ninth'));
  assert.ok(functionsOf(0, [0, 2, 7]).includes('ninth'));
});

test('root-fifth-only is measured against the target\'s OWN bass', () => {
  const slice = (pcs, lowMidi) => ({ pcs: new Set(pcs), lowMidi });
  assert.equal(isRootFifthOnly(slice([2, 9], 50)), true, 'D + A above a D bass');
  assert.equal(isRootFifthOnly(slice([2, 9, 6], 50)), false, 'a third disqualifies it');
  assert.equal(isRootFifthOnly(slice([], 50)), false, 'no notes is not a power chord');
});

test('harmonySpans[] is preferred, and a null half-bar is ABSENT, not colourless', () => {
  // The defect this guards: a whole-note source emits [span, null]. Treating the
  // null as a slice inserts a permanent reset into every bar, so no run could
  // ever reach a threshold.
  const withNull = sourceSlicesOf({
    bar: 3,
    harmony: { root: 'C', pcset: [0, 4, 7] },
    harmonySpans: [{ root: 'C', pcset: [0, 4, 7] }, null],
  });
  assert.equal(withNull.length, 1);
  assert.equal(withNull[0].source, 'harmonySpans');

  const bothSpans = sourceSlicesOf({
    bar: 3,
    harmony: { root: 'C', pcset: [0, 4, 7] },
    harmonySpans: [{ root: 'C', pcset: [0, 4] }, { root: 'G', pcset: [7, 11] }],
  });
  assert.equal(bothSpans.length, 2, 'both half-bar chords are separate slices');
  assert.equal(bothSpans[1].root, 'G');

  const fallback = sourceSlicesOf({ bar: 3, harmony: { root: 'C', pcset: [0, 4, 7] } });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].source, 'harmony', 'the coarse field is the last resort, and says so');
});

test('C11.2: the module never reads or widens harmony.pcset when spans exist', () => {
  // A bar whose narrow `harmony.pcset` disagrees with its spans must be read
  // through the SPANS. If this ever regressed to the coarse field, re-widening
  // it would look like an improvement and restore the vacuous-gate defect.
  const slices = sourceSlicesOf({
    bar: 1,
    harmony: { root: 'C', pcset: [0, 1, 2, 3, 4, 5, 6] },
    harmonySpans: [{ root: 'C', pcset: [0, 7] }],
  });
  assert.deepEqual(slices[0].pcset, [0, 7]);
  assert.deepEqual(functionsOf(slices[0].rootPc, slices[0].pcset), []);
});

// ---------------------------------------------------------------------------
// Slice classification
// ---------------------------------------------------------------------------

const target = (pcs, { lowMidi = 48, highMidi = 60, topPcs = [], noteCount = 2 } = {}) => ({
  tabBars: [1, 1],
  slice: { pcs: new Set(pcs), topPcs: new Set(topPcs), lowMidi, highMidi, noteCount },
});
const src = (root, pcset, extra = {}) => ({
  bar: 1, index: 0, of: 1, source: 'harmonySpans', root, rootPc: noteNameToPc(root),
  symbol: `${root}x`, pcset, ...extra,
});

test('a source with no 3rd or 7th creates NO obligation — C11.4, stated as code', () => {
  const r = classifySlice(src('C', [0, 7]), target([0, 7]), { gain: 'high' });
  assert.equal(r.verdict, 'no-obligation');
});

test('a one-pitch-class source is insufficient evidence', () => {
  assert.equal(classifySlice(src('C', [0]), target([0, 7])).verdict, 'insufficient-evidence');
  assert.equal(classifySlice(src(null, [0, 4]), target([0, 4])).verdict, 'insufficient-evidence');
});

test('a root+3rd dyad IS enough evidence — the pcset is the sustained stratum', () => {
  const r = classifySlice(src('C', [0, 4]), target([0, 7], { lowMidi: 48, highMidi: 60 }));
  assert.equal(r.verdict, 'flattened');
  assert.deepEqual(r.omittedFunctions, ['major-third']);
});

test('literal preservation: the source colour pc is somewhere in the target', () => {
  const r = classifySlice(src('C', [0, 4, 11]), target([0, 4, 7]));
  assert.equal(r.verdict, 'preserved');
  assert.equal(r.preservedBy, 'literal');
  assert.deepEqual(r.preservedFunctions, ['major-third']);
});

test('upper-register preservation is recognised and reported as such', () => {
  const r = classifySlice(src('C', [0, 4, 11]), target([0, 7, 11], { topPcs: [11] }));
  assert.equal(r.verdict, 'preserved');
  assert.equal(r.preservedBy, 'upper-register',
    'a 7th moved into the melody satisfies preservation (Plan §8.1)');
});

test('a target with colour of its OWN is a reharmonization, not a flattening', () => {
  const r = classifySlice(src('C', [0, 4, 11]), target([2, 5, 9], { lowMidi: 50 }));
  assert.equal(r.verdict, 'preserved');
  assert.equal(r.preservedBy, 'functional');
});

test('a target with no notes at all is not a flattening claim', () => {
  const r = classifySlice(src('C', [0, 4, 11]), target([], { noteCount: 0 }));
  assert.equal(r.verdict, 'no-target');
});

test('gain exemption: a low high-gain reduction that lost only a 3rd is exempt', () => {
  const low = target([4, 11], { lowMidi: 40, highMidi: LOW_REGISTER_CEILING - 1 });
  const r = classifySlice(src('E', [4, 7, 11]), low, { gain: 'high' });
  assert.equal(r.verdict, 'exempt');
  assert.match(r.reason, /mud/);
});

test('gain exemption does NOT apply to a lost 7th', () => {
  // A 7th is the chord's identity, not its brightness, and it can always go in
  // the upper register instead. Nothing about distortion excuses losing it.
  // G2 + D3: a genuine low power chord (bass pc 7, intervals {0,7}) under a G7.
  const low = target([7, 2], { lowMidi: 43, highMidi: LOW_REGISTER_CEILING - 5 });
  const r = classifySlice(src('G', [7, 11, 5]), low, { gain: 'high' });
  assert.equal(r.verdict, 'flattened');
  assert.ok(r.omittedFunctions.includes('minor-seventh'));
});

test('gain exemption does NOT apply under clean or crunch gain', () => {
  const low = target([4, 11], { lowMidi: 40, highMidi: LOW_REGISTER_CEILING - 1 });
  for (const gain of ['clean', 'crunch']) {
    assert.equal(classifySlice(src('E', [4, 7, 11]), low, { gain }).verdict, 'flattened', gain);
  }
});

test('gain exemption does NOT apply in an upper register', () => {
  const high = target([4, 11], { lowMidi: 52, highMidi: LOW_REGISTER_CEILING + 12 });
  assert.equal(classifySlice(src('E', [4, 7, 11]), high, { gain: 'high' }).verdict, 'flattened');
});

test('readTabSlice unions bars and reports register honestly', () => {
  const tabBars = new Map([
    [1, { allPcs: new Set([0, 7]), topPcs: new Set([7]), lowMidi: 48, topSeq: [55], noteCount: 2 }],
    [2, { allPcs: new Set([4]), topPcs: new Set([4]), lowMidi: 52, topSeq: [64], noteCount: 1 }],
  ]);
  const s = readTabSlice(tabBars, 1, 2);
  assert.deepEqual([...s.pcs].sort(), [0, 4, 7]);
  assert.equal(s.lowMidi, 48);
  assert.equal(s.highMidi, 64);
  assert.equal(s.noteCount, 3);
  const empty = readTabSlice(tabBars, 9, 9);
  assert.equal(empty.lowMidi, null, 'no bars means no register, not register 0');
  assert.equal(empty.noteCount, 0);
});

// ---------------------------------------------------------------------------
// Run accumulation
// ---------------------------------------------------------------------------

/** A synthetic run of N identical flattening slices over N tab bars. */
function syntheticRun(n, { mode = 'recompose', style = 'jazz' } = {}) {
  const digestByBar = new Map();
  const tabBars = new Map();
  for (let b = 1; b <= n; b++) {
    digestByBar.set(b, { bar: b, harmonySpans: [{ root: 'C', symbol: 'Cmaj7', pcset: [0, 4, 11] }] });
    tabBars.set(b, { allPcs: new Set([0, 7]), topPcs: new Set([7]), lowMidi: 60, topSeq: [67], noteCount: 2 });
  }
  return analyzeHarmonicColor({
    entries: [{ mode, tabBars: [1, n], sourceBars: [1, n] }],
    digestByBar,
    tabBars,
    profile: profileOf(style),
    gain: 'clean',
  });
}

test('a run one slice short of the threshold stays silent', () => {
  const need = profileOf('jazz').harmonicColor.consecutiveSlicesBeforeWarn;
  const r = syntheticRun(need - 1);
  assert.equal(r.stats.flattened, need - 1, 'the slices really were flattened');
  assert.deepEqual(r.advisories, [], 'but the run never reached the threshold');
});

test('a run exactly at the threshold speaks, once', () => {
  const need = profileOf('jazz').harmonicColor.consecutiveSlicesBeforeWarn;
  const r = syntheticRun(need);
  assert.equal(r.advisories.length, 1);
  assert.equal(r.advisories[0].data.consecutiveSlices, need);
});

test('a long run is ONE advisory, not one per slice', () => {
  const r = syntheticRun(16);
  assert.equal(r.advisories.length, 1, 'sixteen copies is how a real finding gets scrolled past');
  assert.equal(r.advisories[0].data.consecutiveSlices, 16);
  assert.equal(r.advisories[0].data.slices.length, 16, 'per-slice evidence stays in data');
});

test('a free span breaks the run — added material links nothing', () => {
  const digestByBar = new Map();
  const tabBars = new Map();
  for (let b = 1; b <= 6; b++) {
    digestByBar.set(b, { bar: b, harmonySpans: [{ root: 'C', symbol: 'Cmaj7', pcset: [0, 4, 11] }] });
    tabBars.set(b, { allPcs: new Set([0, 7]), topPcs: new Set([7]), lowMidi: 60, topSeq: [67], noteCount: 2 });
  }
  const profile = profileOf('jazz');
  const split = analyzeHarmonicColor({
    entries: [
      { mode: 'recompose', tabBars: [1, 1], sourceBars: [1, 1] },
      { mode: 'free', tabBars: [2, 5] },
      { mode: 'recompose', tabBars: [6, 6], sourceBars: [6, 6] },
    ],
    digestByBar, tabBars, profile, gain: 'clean',
  });
  assert.equal(split.stats.flattened, 2);
  assert.deepEqual(split.advisories, [],
    'two flattened slices either side of a free span are not two consecutive slices');
});

test('a gap between entries breaks the run', () => {
  const digestByBar = new Map();
  const tabBars = new Map();
  for (let b = 1; b <= 6; b++) {
    digestByBar.set(b, { bar: b, harmonySpans: [{ root: 'C', symbol: 'Cmaj7', pcset: [0, 4, 11] }] });
    tabBars.set(b, { allPcs: new Set([0, 7]), topPcs: new Set([7]), lowMidi: 60, topSeq: [67], noteCount: 2 });
  }
  const r = analyzeHarmonicColor({
    entries: [
      { mode: 'recompose', tabBars: [1, 1], sourceBars: [1, 1] },
      { mode: 'recompose', tabBars: [5, 5], sourceBars: [5, 5] },
    ],
    digestByBar, tabBars, profile: profileOf('jazz'), gain: 'clean',
  });
  assert.deepEqual(r.advisories, [], 'unmapped ground between two entries is a reset');
});

test('entries are walked in TAB order, whatever order the sidecar declares them', () => {
  const digestByBar = new Map();
  const tabBars = new Map();
  for (let b = 1; b <= 4; b++) {
    digestByBar.set(b, { bar: b, harmonySpans: [{ root: 'C', symbol: 'Cmaj7', pcset: [0, 4, 11] }] });
    tabBars.set(b, { allPcs: new Set([0, 7]), topPcs: new Set([7]), lowMidi: 60, topSeq: [67], noteCount: 2 });
  }
  const args = { digestByBar, tabBars, profile: profileOf('jazz'), gain: 'clean' };
  const forward = analyzeHarmonicColor({ ...args,
    entries: [{ mode: 'recompose', tabBars: [1, 2], sourceBars: [1, 2] },
      { mode: 'recompose', tabBars: [3, 4], sourceBars: [3, 4] }] });
  const backward = analyzeHarmonicColor({ ...args,
    entries: [{ mode: 'recompose', tabBars: [3, 4], sourceBars: [3, 4] },
      { mode: 'recompose', tabBars: [1, 2], sourceBars: [1, 2] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(forward.advisories)),
    JSON.parse(JSON.stringify(backward.advisories)),
    'a listener hears the arrangement in one order regardless of file order');
});

test('a disabled profile does not measure, rather than measuring and suppressing', () => {
  const r = syntheticRun(16, { style: 'metal' });
  assert.equal(r.stats.enabled, false);
  assert.equal(r.slices.length, 0, 'a reader of the JSON must see no slices, not silent ones');
  assert.deepEqual(r.advisories, []);
});

test('bad arguments throw rather than producing confident nonsense', () => {
  const ok = { entries: [], digestByBar: new Map(), tabBars: new Map(), profile: profileOf('jazz') };
  assert.throws(() => analyzeHarmonicColor({ ...ok, entries: null }), TypeError);
  assert.throws(() => analyzeHarmonicColor({ ...ok, digestByBar: {} }), TypeError);
  assert.throws(() => analyzeHarmonicColor({ ...ok, tabBars: {} }), TypeError);
  assert.throws(() => analyzeHarmonicColor({ ...ok, profile: {} }), TypeError);
});

// ---------------------------------------------------------------------------
// End to end through compare.mjs — the Wave 4 acceptance scenarios
// ---------------------------------------------------------------------------

test('root motion PASSES while sustained flattening warns', () => {
  // Plan §8.4's first acceptance scenario, and the one that proves the two
  // channels are independent: the hard gate is satisfied and the soft one is not.
  const { status, json } = compare('flattened-tab.alphatab', 'jazz-source', { style: 'jazz' });
  assert.equal(status, 0, 'the hard fidelity gate passes');
  assert.equal(json.ok, true);
  assert.equal(hasAdvisory(json.soft.advisories, 'harmonic-flattening'), true);
  assert.equal(json.harmonicColor.stats.flattened, 8);
});

test('an upper-register colour tone prevents the warning', () => {
  const { status, json } = compare('shell-tab.alphatab', 'jazz-source', { style: 'jazz' });
  assert.equal(status, 0);
  assert.deepEqual(json.soft.advisories, []);
  assert.equal(json.harmonicColor.stats.verdicts.flattened, undefined);
});

test('ONE deliberate power chord among shell voicings does not trigger', () => {
  const { json } = compare('one-power-chord-tab.alphatab', 'jazz-source', { style: 'jazz' });
  assert.equal(json.harmonicColor.stats.flattened, 1, 'it really was flattened');
  assert.deepEqual(json.soft.advisories, [], 'and one slice is not sustained flattening');
});

test('a high-gain LOW-register reduction that lost only 3rds is suppressed', () => {
  const high = compare('low-power-tab.alphatab', 'low-source', { style: 'hard-rock', gain: 'high' });
  assert.equal(high.json.harmonicColor.stats.verdicts.exempt, 8);
  assert.deepEqual(high.json.soft.advisories, []);
});

test('the same reduction under CLEAN gain is flattening again', () => {
  const clean = compare('low-power-tab.alphatab', 'low-source', { style: 'hard-rock', gain: 'clean' });
  assert.equal(clean.json.harmonicColor.stats.flattened, 8);
  assert.equal(hasAdvisory(clean.json.soft.advisories, 'harmonic-flattening'), true);
});

test('metal never produces colour warnings on power-chord writing', () => {
  const { json } = compare('flattened-tab.alphatab', 'jazz-source', { style: 'metal', gain: 'high' });
  assert.equal(json.harmonicColor.stats.enabled, false);
  assert.deepEqual(json.soft.advisories, []);
});

test('style moves the advice; the HARD result is bit-identical across styles', () => {
  const runs = ['hard-rock', 'metal', 'blues', 'jazz'].map((s) =>
    compare('flattened-tab.alphatab', 'jazz-source', { style: s, gain: 'clean' }));
  const baseline = JSON.stringify({ ok: runs[0].json.ok, mapResults: runs[0].json.mapResults,
    failures: runs[0].json.failures });
  for (const r of runs) {
    assert.equal(JSON.stringify({ ok: r.json.ok, mapResults: r.json.mapResults,
      failures: r.json.failures }), baseline);
  }
  const advCounts = runs.map((r) => r.json.soft.advisories.length);
  assert.ok(new Set(advCounts).size > 1, 'but the advice must actually differ across styles');
});

test('compare\'s soft block stays ADDITIVE: contourWarnings keeps its shape', () => {
  const { json } = compare('flattened-tab.alphatab', 'jazz-source', { style: 'jazz' });
  assert.ok(Array.isArray(json.soft.contourWarnings), 'the historical key must survive verbatim');
  assert.ok(Array.isArray(json.soft.advisories));
});

test('the advisory carries its evidence, and names harmonySpans as the source', () => {
  const { json } = compare('flattened-tab.alphatab', 'jazz-source', { style: 'jazz' });
  const a = json.soft.advisories.find((x) => x.code === 'harmonic-flattening');
  assert.ok(a);
  assert.equal(a.severity, 'warning');
  assert.equal(a.data.style, 'jazz');
  assert.equal(a.data.gain, 'clean');
  assert.ok(a.data.consecutiveSlices >= a.data.threshold);
  assert.deepEqual(a.data.evidence, ['harmonySpans'], 'C11.2: the additive field, not the narrow one');
  assert.ok(a.data.omittedFunctions.length > 0);
  assert.ok(Array.isArray(a.data.slices) && a.data.slices.length === a.data.consecutiveSlices);
});

test('two compare runs produce byte-identical JSON', () => {
  const a = compare('flattened-tab.alphatab', 'jazz-source', { style: 'jazz' });
  const b = compare('flattened-tab.alphatab', 'jazz-source', { style: 'jazz' });
  assert.equal(JSON.stringify(a.json), JSON.stringify(b.json));
});

test('an unknown --style is exit 2 from compare too', () => {
  const r = node([path.join(ROOT, 'tools', 'compare.mjs'), path.join(FIX, 'shell-tab.alphatab'),
    digestOf('jazz-source'), '--bars', '1-8', '--map', path.join(FIX, 'sidecar.json'),
    '--style', 'polka', '--json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown style/);
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
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

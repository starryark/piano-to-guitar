// style-profile.test.mjs — self-test for tools/lib/style-profile.mjs
// (contract C6 + addendum §A2). Run: node tools/lib/style-profile.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// A style profile is a policy document that CHANGES WHAT THE TOOL SAYS while
// leaving the run's own report claiming the style you asked for. So most of the
// assertions here are refusals: an unknown key, a missing key, a wrong schema
// version, a weight of the wrong type must all stop the run rather than quietly
// leave a hard-rock number in a jazz analysis.
//
// The other half is COMPATIBILITY: `hard-rock` is the default profile, and the
// one thing it may never do is change how a default run behaves. Its
// `defaultGain` is therefore pinned to `"high"` here — see §A1.1 of the addendum
// for why that beats C6's illustrative `"crunch"`.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDIOM_WEIGHTS,
  KNOWN_STYLES,
  STYLES_DIR,
  STYLE_SCHEMA_VERSION,
  TIER2_WEIGHTS,
  loadStyleProfile,
  mergeStyleProfile,
  validateStyleProfile,
} from './style-profile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCRATCH = path.join(ROOT, 'out', 'style-profile-test');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

/** A structurally valid profile, as a mutable plain object to damage per test. */
function goodProfile(name = 'hard-rock') {
  return {
    schemaVersion: 1,
    name,
    defaultGain: 'high',
    idiom: {
      warnBelow: 4.5,
      minAttacks: 8,
      weights: Object.fromEntries(IDIOM_WEIGHTS.map((k) => [k, 1])),
    },
    harmonicColor: { enabled: true, consecutiveSlicesBeforeWarn: 4 },
    pickDemand: { warnAtLevel: 'hard', maxBurstBeats: 2 },
    techniqueBias: {},
    freeSpanWarnShare: 0.4,
  };
}

/** Write a scratch profile file and return the directory to load it from. */
function scratchStyle(name, body) {
  const dir = path.join(SCRATCH, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`),
    typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  return dir;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Assert a validation failed AND that its message names the thing that broke —
 *  a refusal with an unhelpful message is only half a fail-closed validator. */
function assertRejects(result, needle) {
  assert.equal(result.ok, false, 'expected a refusal');
  assert.equal(result.profile, null, 'a refused profile must not be returned');
  const joined = result.errors.join(' | ');
  assert.ok(joined.includes(needle), `expected an error mentioning "${needle}", got: ${joined}`);
}

// ---------------------------------------------------------------------------
// The shipped profiles
// ---------------------------------------------------------------------------

test('every KNOWN_STYLE ships a profile that loads and validates', () => {
  for (const name of KNOWN_STYLES) {
    const r = loadStyleProfile(name);
    assert.equal(r.ok, true, `${name}: ${r.errors.join('; ')}`);
    assert.equal(r.profile.name, name);
    assert.equal(r.profile.schemaVersion, STYLE_SCHEMA_VERSION);
  }
});

test('KNOWN_STYLES and reference/styles/ agree in both directions', () => {
  // A file nobody can name is dead weight; a name with no file is a crash.
  const onDisk = fs.readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
  assert.deepEqual(onDisk, [...KNOWN_STYLES].sort());
});

test('C6/§A1.1: hard-rock defaultGain is "high" — the legacy default, unchanged', () => {
  const { profile } = loadStyleProfile('hard-rock');
  // playability's `gain-voicing` advisory fires only under high gain. Shipping
  // "crunch" here would silently delete an existing soft finding from every
  // default run, which is exactly the compatibility break C6 forbids.
  assert.equal(profile.defaultGain, 'high');
});

test('§A3: every Tier-2 feature ships at weight 0 in every profile', () => {
  for (const name of KNOWN_STYLES) {
    const { profile } = loadStyleProfile(name);
    for (const k of TIER2_WEIGHTS) {
      assert.equal(profile.idiom.weights[k], 0,
        `${name}.idiom.weights.${k} must stay 0 until a calibrated fixture pair exists`);
    }
  }
});

test('every profile declares every known weight — no silent zeroes', () => {
  for (const name of KNOWN_STYLES) {
    const { profile } = loadStyleProfile(name);
    assert.deepEqual(Object.keys(profile.idiom.weights).sort(), [...IDIOM_WEIGHTS].sort(),
      `${name} must state a weight for every feature`);
  }
});

test('jazz cannot be penalised for absent palm muting', () => {
  // 3.2 of Implement.md, as a number rather than a promise: a zero weight
  // contributes nothing to the numerator AND nothing to the denominator, so the
  // feature cannot move a jazz score in either direction.
  const { profile } = loadStyleProfile('jazz');
  assert.equal(profile.idiom.weights.palmMutedRepetition, 0);
});

test('metal tolerates sustained root-fifth writing; jazz does not', () => {
  const metal = loadStyleProfile('metal').profile;
  const jazz = loadStyleProfile('jazz').profile;
  assert.equal(metal.harmonicColor.enabled, false, 'a metal riff IS root-fifth writing');
  assert.equal(jazz.harmonicColor.enabled, true);
  assert.ok(jazz.harmonicColor.consecutiveSlicesBeforeWarn
    < metal.harmonicColor.consecutiveSlicesBeforeWarn);
});

// ---------------------------------------------------------------------------
// Refusals — the fail-closed half
// ---------------------------------------------------------------------------

test('an unknown style name is an operational error, never a fallback', () => {
  const r = loadStyleProfile('polka');
  assertRejects(r, 'unknown style "polka"');
});

test('a traversal-shaped style name is refused as a NAME, before any file access', () => {
  for (const bad of ['../../etc/passwd', 'hard-rock/../metal', 'a\\b', './jazz', 'Jazz']) {
    const r = loadStyleProfile(bad);
    assertRejects(r, 'not a valid profile name');
  }
});

test('an empty or non-string style name is refused', () => {
  assertRejects(loadStyleProfile(''), 'non-empty string');
  assertRejects(loadStyleProfile(null), 'non-empty string');
  assertRejects(loadStyleProfile(42), 'non-empty string');
});

test('malformed JSON is an operational error naming the file', () => {
  const dir = scratchStyle('metal', '{ "schemaVersion": 1, ');
  const r = loadStyleProfile('metal', { dir });
  assertRejects(r, 'not valid JSON');
});

test('a missing profile file is an operational error', () => {
  const dir = path.join(SCRATCH, 'empty-dir');
  fs.mkdirSync(dir, { recursive: true });
  assertRejects(loadStyleProfile('blues', { dir }), 'cannot read style profile');
});

test('a wrong schemaVersion is refused', () => {
  const p = goodProfile();
  p.schemaVersion = 2;
  assertRejects(validateStyleProfile(p), 'schemaVersion must be 1');
});

test('an unknown TOP-LEVEL key is refused', () => {
  const p = goodProfile();
  p.tempoBias = 3;
  assertRejects(validateStyleProfile(p), 'unknown key "tempoBias"');
});

test('an unknown NESTED key is refused', () => {
  const p = goodProfile();
  p.idiom.warnAbove = 9;
  assertRejects(validateStyleProfile(p), 'unknown key "idiom.warnAbove"');
});

test('a mis-cased weight name is refused rather than silently ignored', () => {
  // The exact defect the module header describes: `powerchord` would leave the
  // real weight at its default while the run still reports the chosen style.
  const p = goodProfile();
  delete p.idiom.weights.powerChord;
  p.idiom.weights.powerchord = 3;
  const r = validateStyleProfile(p);
  assertRejects(r, 'unknown key "idiom.weights.powerchord"');
  assert.ok(r.errors.join(' | ').includes('missing required key "idiom.weights.powerChord"'),
    'the missing correctly-spelled key must ALSO be reported');
});

test('a missing required key is refused', () => {
  const p = goodProfile();
  delete p.freeSpanWarnShare;
  assertRejects(validateStyleProfile(p), 'missing required key "freeSpanWarnShare"');
});

test('a weight of the wrong type is refused', () => {
  const p = goodProfile();
  p.idiom.weights.riffCell = '3';
  assertRejects(validateStyleProfile(p), 'idiom.weights.riffCell must be a finite number');
});

test('an out-of-range threshold is refused', () => {
  const a = goodProfile();
  a.idiom.warnBelow = 42;
  assertRejects(validateStyleProfile(a), 'idiom.warnBelow must be within 0..10');

  const b = goodProfile();
  b.freeSpanWarnShare = 1.5;
  assertRejects(validateStyleProfile(b), 'freeSpanWarnShare must be within 0..1');

  const c = goodProfile();
  c.harmonicColor.consecutiveSlicesBeforeWarn = 0;
  assertRejects(validateStyleProfile(c), 'consecutiveSlicesBeforeWarn must be within 1..64');
});

test('a non-integer count is refused', () => {
  const p = goodProfile();
  p.idiom.minAttacks = 8.5;
  assertRejects(validateStyleProfile(p), 'idiom.minAttacks must be an integer');
});

test('a bad enum value is refused', () => {
  const a = goodProfile();
  a.defaultGain = 'searing';
  assertRejects(validateStyleProfile(a), 'defaultGain must be one of high|crunch|clean');

  const b = goodProfile();
  b.pickDemand.warnAtLevel = 'easy';
  assertRejects(validateStyleProfile(b), 'pickDemand.warnAtLevel must be one of hard|expert|avoid');
});

test('NaN and Infinity are refused as numbers', () => {
  const p = goodProfile();
  p.idiom.warnBelow = Number.POSITIVE_INFINITY;
  assertRejects(validateStyleProfile(p), 'must be a finite number');
});

test('techniqueBias is RESERVED: present, an object, and empty', () => {
  const a = goodProfile();
  a.techniqueBias = { bendBonus: 2 };
  assertRejects(validateStyleProfile(a), 'techniqueBias is RESERVED');

  const b = goodProfile();
  delete b.techniqueBias;
  assertRejects(validateStyleProfile(b), 'missing required key "techniqueBias"');
});

test('a profile whose declared name disagrees with its file name is refused', () => {
  const dir = scratchStyle('blues', { ...goodProfile('jazz') });
  assertRejects(loadStyleProfile('blues', { dir }), 'does not match the profile file name');
});

test('a non-object profile is refused', () => {
  assertRejects(validateStyleProfile([1, 2, 3]), 'must be a JSON object, got an array');
  assertRejects(validateStyleProfile('hard-rock'), 'must be a JSON object, got string');
  assertRejects(validateStyleProfile(null), 'must be a JSON object, got object');
});

test('every problem is reported at once, not one per run', () => {
  const p = goodProfile();
  p.schemaVersion = 7;
  p.defaultGain = 'loud';
  delete p.freeSpanWarnShare;
  const r = validateStyleProfile(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3, `expected every problem at once, got ${r.errors.length}`);
});

// ---------------------------------------------------------------------------
// Merge + immutability
// ---------------------------------------------------------------------------

test('a safe deep override merges leaf-by-leaf and leaves siblings alone', () => {
  const base = loadStyleProfile('hard-rock').profile;
  const r = mergeStyleProfile(base, { idiom: { warnBelow: 6, weights: { riffCell: 4 } } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.profile.idiom.warnBelow, 6);
  assert.equal(r.profile.idiom.weights.riffCell, 4);
  assert.equal(r.profile.idiom.weights.powerChord, base.idiom.weights.powerChord,
    'an untouched sibling weight must survive the merge');
  assert.equal(r.profile.idiom.minAttacks, base.idiom.minAttacks);
  assert.equal(r.profile.freeSpanWarnShare, base.freeSpanWarnShare);
});

test('an override is re-validated: it cannot smuggle in an unknown key', () => {
  const base = loadStyleProfile('hard-rock').profile;
  assertRejects(mergeStyleProfile(base, { idiom: { weights: { cowbell: 9 } } }),
    'unknown key "idiom.weights.cowbell"');
});

test('an override cannot smuggle in an out-of-range value', () => {
  const base = loadStyleProfile('metal').profile;
  assertRejects(mergeStyleProfile(base, { freeSpanWarnShare: 2 }), 'within 0..1');
});

test('arrays are never merged by index — they are refused', () => {
  const base = loadStyleProfile('hard-rock').profile;
  assertRejects(mergeStyleProfile(base, { idiom: { weights: [1, 2] } }), 'arrays are never merged');
});

test('loadStyleProfile applies overrides through the same merge path', () => {
  const r = loadStyleProfile('jazz', { overrides: { defaultGain: 'crunch' } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.profile.defaultGain, 'crunch');
  assert.equal(loadStyleProfile('jazz').profile.defaultGain, 'clean',
    'the override must not have leaked into a later plain load');
});

test('a returned profile is deep-frozen, and merging does not mutate the base', () => {
  const base = loadStyleProfile('hard-rock').profile;
  assert.throws(() => { base.idiom.warnBelow = 0; }, TypeError);
  assert.throws(() => { base.idiom.weights.powerChord = 99; }, TypeError);
  const merged = mergeStyleProfile(base, { idiom: { warnBelow: 1 } }).profile;
  assert.equal(base.idiom.warnBelow, 4.5, 'the base profile must be untouched by a merge');
  assert.equal(merged.idiom.warnBelow, 1);
  assert.throws(() => { merged.name = 'x'; }, TypeError, 'a merged profile is frozen too');
});

test('two loads of the same profile are structurally identical', () => {
  // Determinism (§A6): key order is fixed by the normalizer, not by the file.
  const a = JSON.stringify(loadStyleProfile('blues').profile);
  const b = JSON.stringify(loadStyleProfile('blues').profile);
  assert.equal(a, b);
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

// scenario-harness.test.mjs — does the calibration corpus actually fail?
// Run: node tools/scenario-harness.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// `tools/lib/scenarios.test.mjs` is the corpus that proves the toolchain gives
// good advice. This one proves THAT suite is not vacuous. A green test tells you
// nothing until you have watched it go red for the right reason: a schema that
// silently ignores an unknown field, a pair invariant that never actually
// compares anything, or an expectation that would be satisfied by any result at
// all, all pass forever while proving nothing.
//
// So every case here BREAKS the corpus in one specific way and asserts the
// validator rejects it. The mutation is always applied to a deep COPY — a
// mutation test that leaves the repository broken when it crashes is a worse bug
// than the one it was looking for.
//
// SCOPE. These cases all exercise MANIFEST VALIDATION, which lives in
// `tools/lib/scenario-manifest.mjs` as a pure function precisely so this suite
// can call it directly. Routing them through the corpus runner instead would
// cost a full check.mjs sweep per case — about half an hour to re-prove
// `assert.ok`, which is how a meta-test ends up deleted. The expensive half —
// mutating a fixture and watching a scenario's expectations go red — is
// exercised by the corpus itself every time a fixture changes.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateManifestSchema, validatePairInvariants, ManifestError,
} from './lib/scenario-manifest.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(TOOLS, 'fixtures');
const REAL = path.join(FIX, 'scenarios', 'manifest.json');

const pristine = JSON.parse(fs.readFileSync(REAL, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(pristine));

/**
 * Apply a mutation to a copy of the real manifest and report which validator
 * rejected it, if any. Nothing is ever written back to the repository.
 */
function validate(mutate) {
  const m = clone();
  mutate(m);
  const out = { schemaOk: false, pairsOk: false, error: null };
  try {
    validateManifestSchema(m, { fixturesDir: FIX });
    out.schemaOk = true;
  } catch (err) {
    if (!(err instanceof ManifestError)) throw err;
    out.error = err.message;
    return out;
  }
  try {
    validatePairInvariants(m);
    out.pairsOk = true;
  } catch (err) {
    if (!(err instanceof ManifestError)) throw err;
    out.error = err.message;
  }
  return out;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Assert the SCHEMA test rejected this manifest. */
function rejectedBySchema(name, mutate) {
  test(`schema rejects: ${name}`, () => {
    const r = validate(mutate);
    assert.equal(r.schemaOk, false,
      `the schema accepted "${name}" — it fails open\n${r.error ?? "(nothing was rejected)"}`);
  });
}

/** Assert the PAIR-INVARIANT test rejected this manifest. */
function rejectedByPairs(name, mutate) {
  test(`pair invariant rejects: ${name}`, () => {
    const r = validate(mutate);
    assert.equal(r.pairsOk, false,
      `the pair invariant accepted "${name}" — it proves nothing\n${r.error ?? "(nothing was rejected)"}`);
  });
}

const byId = (m, id) => m.scenarios.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// The control. If this one fails, every rejection below is meaningless — they
// could all be failing for an unrelated reason.
// ---------------------------------------------------------------------------

test('CONTROL: the unmodified manifest passes both validation tests', () => {
  const r = validate(() => {});
  assert.ok(r.schemaOk, `the real manifest fails its own schema\n${r.error ?? "(no error)"}`);
  assert.ok(r.pairsOk, `the real manifest fails its own pair invariants\n${r.error ?? "(no error)"}`);
});

// ---------------------------------------------------------------------------
// Fail closed: a typo must never read as a default
// ---------------------------------------------------------------------------

rejectedBySchema('an unknown top-level field', (m) => {
  m.scenarios[0].sytle = 'jazz';           // the typo that silently does nothing
});

rejectedBySchema('an unknown expectation field', (m) => {
  m.scenarios[0].expect.advisoriesPresent = ['harmonic-flattening'];   // the v1 name
});

rejectedBySchema('a duplicate scenario id', (m) => {
  m.scenarios[1].id = m.scenarios[0].id;
});

rejectedBySchema('an unknown polarity', (m) => {
  m.scenarios[0].polarity = 'good';
});

rejectedBySchema('an unknown variant axis', (m) => {
  m.scenarios[0].variantAxis = 'vibes';
});

rejectedBySchema('a target file that does not exist', (m) => {
  m.scenarios[0].target = 'harmonic-color/not-a-real-tab.alphatab';
});

rejectedBySchema('an omitted map key (bar-locked must be WRITTEN, not forgotten)', (m) => {
  delete m.scenarios[0].map;
});

rejectedBySchema('a bars range that is not a range', (m) => {
  m.scenarios[0].bars = 'the whole thing';
});

// ---------------------------------------------------------------------------
// Fail closed: an expectation that cannot fail
// ---------------------------------------------------------------------------

rejectedBySchema('exit 0 paired with hardPass false', (m) => {
  m.scenarios[0].expect.hardPass = false;
});

rejectedBySchema('exit 1 paired with hardPass true', (m) => {
  m.scenarios[0].expect.exit = 1;
});

rejectedBySchema('a code both required and forbidden', (m) => {
  m.scenarios[0].expect.requiredAdvisoryCodes = ['harmonic-flattening'];
  // forbiddenAdvisoryCodes already lists it
});

rejectedBySchema('a failing scenario that does not name the gate it fails', (m) => {
  delete byId(m, 'role-aware-swapped').expect.failReasons;
});

rejectedBySchema('data fields demanded of an advisory the scenario never requires', (m) => {
  // Vacuous by construction: an advisory that does not fire cannot fail a check
  // on the fields it would have carried.
  m.scenarios[0].expect.requiredDataFields = { 'idiom.low-density': ['score'] };
});

rejectedBySchema('a count ceiling on a code that is already forbidden', (m) => {
  m.scenarios[0].expect.maximumAdvisoryCounts = { 'harmonic-flattening': 2 };
});

rejectedBySchema('an unknown requiredStats comparison', (m) => {
  m.scenarios[0].expect.requiredStats = { 'analyzers.idiom.score': { roughly: 3 } };
});

rejectedBySchema('a requiredStats rule that states no comparison at all', (m) => {
  m.scenarios[0].expect.requiredStats = { 'analyzers.idiom.score': {} };
});

rejectedBySchema('a track claimed as both lead and rhythm', (m) => {
  const s = byId(m, 'role-aware-correct');
  s.lead = [0];
  s.rhythm = [0, 1];
});

rejectedBySchema('a lead declared with no rhythm', (m) => {
  delete byId(m, 'role-aware-correct').rhythm;
});

// ---------------------------------------------------------------------------
// Fail closed: a pair that varies more than one thing proves nothing
// ---------------------------------------------------------------------------
// This is the class of defect the whole Wave 6 schema exists to catch. Before
// pairs declared an axis, every one of these was a legal, green corpus entry
// whose result could be attributed to whichever input you happened to believe in.

rejectedByPairs('a target pair whose members also differ in STYLE', (m) => {
  byId(m, 'jazz-flattened-negative').style = 'blues';
});

rejectedByPairs('a target pair whose members also differ in MAP', (m) => {
  byId(m, 'jazz-flattened-negative').map = 'sidecar-audit/free-half.json';
});

rejectedByPairs('a target pair whose members also differ in BARS', (m) => {
  byId(m, 'jazz-flattened-negative').bars = '1-4';
});

rejectedByPairs('a style pair whose members also differ in TARGET', (m) => {
  byId(m, 'flattened-under-metal').target = 'harmonic-color/shell-tab.alphatab';
});

rejectedByPairs('a map pair whose members also differ in SOURCE', (m) => {
  byId(m, 'sidecar-excessively-free').source = 'harmonic-color/jazz-source.alphatab';
});

rejectedByPairs('a role pair whose members also differ in STYLE', (m) => {
  byId(m, 'role-aware-swapped').style = 'metal';
});

rejectedByPairs('a role pair whose members do NOT differ in roles', (m) => {
  const swapped = byId(m, 'role-aware-swapped');
  swapped.lead = [0];
  swapped.rhythm = [1];      // now identical to role-aware-correct
});

rejectedByPairs('a pair whose members disagree about their own axis', (m) => {
  byId(m, 'jazz-flattened-negative').variantAxis = 'style';
});

rejectedByPairs('a pair with no member claiming the toolchain should stay quiet', (m) => {
  byId(m, 'jazz-shell-positive').polarity = 'negative';
});

rejectedByPairs('a pair with no member claiming the toolchain should speak', (m) => {
  byId(m, 'jazz-flattened-negative').polarity = 'positive';
});

rejectedByPairs('a lone scenario with no pair to compare against', (m) => {
  byId(m, 'jazz-flattened-negative').pairId = 'orphan';
});

rejectedByPairs('two members that are the same polarity AND the same variant', (m) => {
  // A copy is not a comparison.
  const dup = JSON.parse(JSON.stringify(byId(m, 'jazz-shell-positive')));
  dup.id = 'jazz-shell-positive-again';
  m.scenarios.push(dup);
});

rejectedByPairs('a corpus that has collapsed back to a single axis', (m) => {
  for (const s of m.scenarios) s.variantAxis = 'target';
});

// ---------------------------------------------------------------------------

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

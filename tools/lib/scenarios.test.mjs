// scenarios.test.mjs — drive every paired scenario in
// tools/fixtures/scenarios/manifest.json through the real gate.
// Run: node tools/lib/scenarios.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// Every other suite tests an analyzer against inputs shaped to exercise it. This
// one asks the only question that finally matters: on a realistic arrangement,
// run through the command a human actually types, does the toolchain say
// something USEFUL — and, far more importantly, does it stay quiet when there is
// nothing to say?
//
// The fixtures come in PAIRS sharing one source and one sidecar, differing only
// in the target tab. That is what makes a result meaningful: if the positive and
// negative halves of a pair produce different advice, the difference is in the
// ARRANGEMENT, because nothing else changed.
//
// Expectations live in the manifest as advisory CODES (Plan §6.3), not prose, so
// wording stays free to improve. `advisoriesAbsent` is the half that earns its
// keep — a false positive on idiomatic writing is how an advisory system gets
// switched off and never switched back on.
//
// The suite also enforces an ADVISORY BUDGET (Plan §10.3): a valid arrangement
// gets few enough findings for a human to actually read, and no finding repeats
// per-note where one per region would do.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures');
const SCRATCH = path.join(ROOT, 'out', 'scenarios-test');
const CHECK = path.join(ROOT, 'tools', 'check.mjs');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'scenarios', 'manifest.json'), 'utf8'));

/** Extract a digest once per source, into a per-source scratch directory (two
 *  sources can share a basename, and piano-extract writes by basename). */
const digestCache = new Map();
function digestOf(sourceRel) {
  if (digestCache.has(sourceRel)) return digestCache.get(sourceRel);
  const dir = path.join(SCRATCH, sourceRel.replace(/[\\/.]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const r = node([path.join(ROOT, 'tools', 'piano-extract.mjs'), path.join(FIX, sourceRel), '--out', dir]);
  assert.equal(r.status, 0, `piano-extract ${sourceRel}: ${r.stderr}`);
  const stem = path.basename(sourceRel, path.extname(sourceRel));
  const out = path.join(dir, `${stem}.json`);
  assert.ok(fs.existsSync(out), `no digest at ${out}`);
  digestCache.set(sourceRel, out);
  return out;
}

/** Run check.mjs exactly as a human would, for one scenario. */
function runScenario(s) {
  const args = [CHECK, path.join(FIX, s.target), '--bars', s.bars,
    '--digest', digestOf(s.source), '--map', path.join(FIX, s.map), '--style', s.style];
  if (s.arrangementMode) args.push('--arrangement-mode', s.arrangementMode);
  if (s.lead) args.push('--lead', s.lead.join(','));
  if (s.rhythm) args.push('--rhythm', s.rhythm.join(','));
  args.push('--json');
  const r = node(args);
  assert.notEqual(r.status, 2, `${s.name}: operational failure (exit 2)\n${r.stderr}`);
  return { status: r.status, json: JSON.parse(r.stdout) };
}

/** Every advisory code (and native playability type) the run produced. */
const codesOf = (json) => Object.values(json.soft).flat().map((a) => a.code ?? a.type);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// The manifest itself
// ---------------------------------------------------------------------------

test('the manifest is well-formed and every file it names exists', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.scenarios) && manifest.scenarios.length >= 8,
    'a calibration corpus of fewer than 8 scenarios is not a corpus');
  const names = new Set();
  for (const s of manifest.scenarios) {
    assert.ok(s.name && !names.has(s.name), `duplicate or missing scenario name: ${s.name}`);
    names.add(s.name);
    assert.ok(s.intent && s.intent.length > 20, `${s.name}: every scenario states its musical intent`);
    for (const key of ['source', 'target', 'map']) {
      assert.ok(fs.existsSync(path.join(FIX, s[key])), `${s.name}: missing ${key} "${s[key]}"`);
    }
    assert.ok(/^\d+(-\d+)?$/.test(s.bars), `${s.name}: bad bars "${s.bars}"`);
    assert.ok(Array.isArray(s.expect.advisoriesPresent));
    assert.ok(Array.isArray(s.expect.advisoriesAbsent));
  }
});

test('the corpus really is PAIRED: every source carries a positive and a negative', () => {
  // A corpus of positives proves only that the tools are quiet, and a corpus of
  // negatives only that they are loud. The pairing is what makes either mean
  // anything.
  const bySource = new Map();
  for (const s of manifest.scenarios) {
    if (!bySource.has(s.source)) bySource.set(s.source, []);
    bySource.get(s.source).push(s);
  }
  for (const [source, group] of bySource) {
    assert.ok(group.length >= 2, `${source} has only one scenario — nothing to compare it against`);
    const quiet = group.some((s) => s.expect.advisoriesPresent.length === 0);
    const loud = group.some((s) => s.expect.advisoriesPresent.length > 0
      || s.expect.hardPass === false);
    assert.ok(quiet && loud, `${source}: expected at least one quiet and one loud scenario`);
  }
});

// ---------------------------------------------------------------------------
// One test per scenario
// ---------------------------------------------------------------------------

for (const s of manifest.scenarios) {
  test(`scenario ${s.name}`, () => {
    const { status, json } = runScenario(s);
    assert.equal(status, s.expect.exit, `${s.name}: exit ${status}, expected ${s.expect.exit}`
      + (json.failReasons?.length ? ` (${json.failReasons.join(', ')})` : ''));
    assert.equal(json.ok, s.expect.hardPass, `${s.name}: hardPass ${json.ok}`);

    for (const reason of s.expect.failReasons ?? []) {
      assert.ok(json.failReasons.includes(reason),
        `${s.name}: expected fail reason "${reason}", got [${json.failReasons.join(', ')}]`);
    }

    const codes = codesOf(json);
    for (const code of s.expect.advisoriesPresent) {
      assert.ok(codes.includes(code),
        `${s.name}: expected advisory "${code}", got [${[...new Set(codes)].join(', ')}]`);
    }
    for (const code of s.expect.advisoriesAbsent) {
      assert.ok(!codes.includes(code),
        `${s.name}: FALSE POSITIVE — "${code}" fired on writing that is idiomatic for ${s.style}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Calibration (Plan §10.3)
// ---------------------------------------------------------------------------

test('advisory budget: a valid arrangement stays readable by a human', () => {
  // "A good target is not zero warnings. It is few enough for a human to
  // review." A run that produces forty findings has produced none, because
  // nobody reads forty.
  const BUDGET = 12;
  for (const s of manifest.scenarios) {
    if (!s.expect.hardPass) continue;
    const { json } = runScenario(s);
    const n = codesOf(json).length;
    assert.ok(n <= BUDGET, `${s.name}: ${n} soft findings exceeds the readable budget of ${BUDGET}`);
  }
});

test('deduplication: no code repeats more than a handful of times in one run', () => {
  // One root problem must not become one finding per note. Every analyzer that
  // can repeat collapses into `data.occurrences`; this is the cross-cutting
  // assertion that none of them regressed.
  const MAX_PER_CODE = 4;
  for (const s of manifest.scenarios) {
    const { json } = runScenario(s);
    const counts = new Map();
    for (const c of codesOf(json)) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const [code, n] of counts) {
      // playability's per-bar `sustain` notice is intentionally per-bar and
      // predates the C3 advisory contract; it is not a C3 code.
      if (code === 'sustain') continue;
      assert.ok(n <= MAX_PER_CODE,
        `${s.name}: "${code}" fired ${n} times — one region-level finding should suffice`);
    }
  }
});

test('every advisory explains WHY, in data rather than only in prose', () => {
  for (const s of manifest.scenarios) {
    const { json } = runScenario(s);
    for (const [subsystem, list] of Object.entries(json.soft)) {
      if (subsystem === 'playability') continue;   // native pre-C3 shape, by contract
      for (const a of list) {
        assert.equal(typeof a.code, 'string', `${s.name}: advisory with no code`);
        assert.ok(a.data && typeof a.data === 'object',
          `${s.name}: ${a.code} carries no evidence object`);
        assert.ok(Object.keys(a.data).length > 0, `${s.name}: ${a.code} has an empty data object`);
      }
    }
  }
});

test('changing the style changes the ADVICE and never the hard result', () => {
  // The invariant, checked once more on realistic material rather than on a
  // synthetic fixture.
  const s = manifest.scenarios.find((x) => x.name === 'jazz-flattened-negative');
  const results = ['hard-rock', 'metal', 'blues', 'jazz'].map((style) =>
    runScenario({ ...s, style }));
  const baseline = JSON.stringify(results[0].json.hard);
  for (const r of results) {
    assert.equal(JSON.stringify(r.json.hard), baseline, 'hard results must not move with style');
  }
  const advice = results.map((r) => codesOf(r.json).sort().join(','));
  assert.ok(new Set(advice).size > 1, 'but the advice must actually differ across styles');
});

test('every scenario is deterministic across runs', () => {
  for (const s of manifest.scenarios) {
    const a = JSON.stringify(runScenario(s).json);
    const b = JSON.stringify(runScenario(s).json);
    assert.equal(a, b, `${s.name}: two identical runs disagreed`);
  }
});

test('no scenario tab is ever modified by being checked (C15)', () => {
  const before = new Map();
  for (const s of manifest.scenarios) {
    const p = path.join(FIX, s.target);
    if (!before.has(p)) before.set(p, fs.readFileSync(p));
  }
  for (const s of manifest.scenarios) runScenario(s);
  for (const [p, bytes] of before) {
    assert.ok(bytes.equals(fs.readFileSync(p)), `${p} was modified by a gate run`);
  }
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

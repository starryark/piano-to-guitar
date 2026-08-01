// playability.test.mjs — self-test for tools/playability.mjs.
// Run: node tools/playability.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// Covers the `position-jump-slow` advisory (docs/specs/tooling.md §C.4) and,
// from PTG Wave 1, the CLI-level contracts C7 (exit semantics), C5 (--max-fret
// and project config), C13 (harmonic nodes) and C14 (hybrid picking). Those are
// tested HERE rather than in a library suite because every one of them is a
// claim about what the PROCESS does — an exit code, a resolved configuration, a
// finding's severity — and a library test cannot observe any of it.
//
// playability.mjs is a CLI with top-level side effects (parses argv, exits on
// import), so it CANNOT be imported — driven as a subprocess, same pattern as
// tools/smoke.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const TOOL = path.join(TOOLS, 'playability.mjs');
const fix = (n) => path.join(TOOLS, 'fixtures', n);
const FIXTURE = fix('position-jump-slow.alphatab');

function run(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: ROOT });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const types = (list) => (list ?? []).map((x) => x.type);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('fires on the jump section (bars 1-2): warning, not error', () => {
  const { json } = run([FIXTURE, '--bars', '1-2', '--json']);
  assert.ok(json, 'expected JSON output');
  assert.deepEqual(json.errors, [], 'no hard finding expected');
  assert.ok(
    json.warnings.some((w) => w.type === 'position-jump-slow'),
    'expected at least one position-jump-slow warning'
  );
  const slowWarnings = json.warnings.filter((w) => w.type === 'position-jump-slow');
  assert.ok(
    slowWarnings.some((w) => /of 10 frets/.test(w.message)),
    'expected a warning mentioning "of 10 frets"'
  );
  const allMessages = slowWarnings.map((w) => w.message).join('\n');
  assert.match(allMessages, /3 -> 13/, 'expected the 3 -> 13 direction to appear');
  assert.match(allMessages, /13 -> 3/, 'expected the 13 -> 3 direction to appear');
});

test('silent on the benign section (bar 3): no position-jump-slow warnings', () => {
  const { json } = run([FIXTURE, '--bars', '3', '--json']);
  assert.ok(json, 'expected JSON output');
  assert.ok(
    json.warnings.every((w) => w.type !== 'position-jump-slow'),
    `expected no position-jump-slow warnings, got: ${JSON.stringify(json.warnings)}`
  );
  assert.equal(json.warnings.length, 0, 'bar 3 should be entirely silent');
});

test('does not misfire as the fast position-jump check (bars 1-2 are eighths)', () => {
  const { json } = run([FIXTURE, '--bars', '1-2', '--json']);
  assert.ok(json, 'expected JSON output');
  assert.ok(
    json.errors.every((e) => e.type !== 'position-jump'),
    `expected no fast position-jump errors, got: ${JSON.stringify(json.errors)}`
  );
});

// ---------------------------------------------------------------------------
// PTG Wave 1, contract C7 — exit semantics
// ---------------------------------------------------------------------------
// Three exit codes, three meanings, and the first of them is the one this wave
// corrected: a warning is a report, not a refusal.

test('C7: a warning-only run exits 0 and still serializes the warnings', () => {
  const r = run([FIXTURE, '--bars', '1-2', '--json']);
  assert.deepEqual(r.json.errors, [], 'the fixture must be free of hard findings');
  assert.ok(r.json.warnings.length > 0, 'the fixture must actually produce warnings');
  assert.equal(r.code, 0, 'warnings must NOT fail the process (this is the Wave 1 correction)');
  assert.equal(r.json.ok, true, '`ok` now means errors.length === 0');
});

test('C7: any hard error exits 1', () => {
  const r = run([fix('non-adjacent-triad.alphatab'), '--bars', '1', '--json']);
  assert.ok(r.json.errors.length > 0);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
});

test('C7: --warnings-as-errors is the opt-in route back to exit 1', () => {
  const r = run([FIXTURE, '--bars', '1-2', '--warnings-as-errors', '--json']);
  assert.deepEqual(r.json.warnings, [], 'escalation must empty warnings[]');
  assert.ok(r.json.errors.every((e) => e.escalatedFromWarning),
    'the fixture has no native errors, so every error must be an escalated warning');
  assert.equal(r.code, 1, 'escalated warnings legitimately drive exit 1');
});

test('C2: a usage failure exits 2 and prints no JSON verdict', () => {
  const noFile = run(['--bars', '1']);
  assert.equal(noFile.code, 2);
  assert.equal(noFile.json, null, 'a usage failure must not look like a verdict');
  assert.match(noFile.stderr, /Usage:/);
  assert.equal(run([FIXTURE, '--gain', 'searing']).code, 2, 'a bad --gain is usage');
  assert.equal(run([FIXTURE, '--bars', 'x-y']).code, 2, 'a bad --bars is usage');
  assert.equal(run([FIXTURE, '--max-fret', 'twenty']).code, 2, 'a bad --max-fret is usage');
  assert.equal(run([FIXTURE, '--max-fret', '0']).code, 2, 'a --max-fret out of range is usage');
});

// ---------------------------------------------------------------------------
// PTG Wave 1, contract C5 — configurable instrument
// ---------------------------------------------------------------------------

test('C5: fret 23 is rejected at max fret 22 and accepted at max fret 24', () => {
  const TAB = fix('maxfret-project/fret23.alphatab');
  const rejected = run([TAB, '--bars', '1', '--max-fret', '22', '--json']);
  const fretRange = rejected.json.errors.filter((e) => e.type === 'fret-range');
  assert.equal(fretRange.length, 1, `expected one fret-range error, got ${JSON.stringify(rejected.json.errors)}`);
  assert.match(fretRange[0].message, /Fret 23 is outside 0\.\.22/);
  assert.equal(rejected.code, 1);

  const accepted = run([TAB, '--bars', '1', '--max-fret', '24', '--json']);
  assert.deepEqual(accepted.json.errors, [], 'fret 23 is ordinary on a 24-fret neck');
  assert.equal(accepted.code, 0);
});

test('C5: a co-located config.json is picked up automatically', () => {
  // tools/fixtures/maxfret-project/config.json declares instrument.maxFret 24.
  const r = run([fix('maxfret-project/fret23.alphatab'), '--bars', '1', '--json']);
  assert.equal(r.json.instrument.maxFret, 24);
  assert.equal(r.json.configSources.maxFret, 'config');
  assert.ok(/maxfret-project/.test(r.json.configPath ?? ''), `configPath: ${r.json.configPath}`);
  assert.deepEqual(r.json.errors, []);
  assert.equal(r.code, 0);
});

test('C5: CLI --max-fret overrides the project config', () => {
  const r = run([fix('maxfret-project/fret23.alphatab'), '--bars', '1', '--max-fret', '22', '--json']);
  assert.equal(r.json.instrument.maxFret, 22, 'the CLI must beat the file');
  assert.equal(r.json.configSources.maxFret, 'cli',
    'the value alone proves nothing (22 is also the default) — provenance is the claim');
  assert.ok(r.json.errors.some((e) => e.type === 'fret-range'),
    'the override must actually reach the fret-range check');
});

test('C5: --policy maxFret stays a SEPARATE, additional project constraint', () => {
  // The instrument limit says the fret does not exist; the policy says the
  // project chose not to go there. Both are meaningful, so both are reported.
  const TAB = fix('maxfret-project/fret23.alphatab');
  const r = run([TAB, '--bars', '1', '--max-fret', '24', '--policy', fix('guitar-policy.json'), '--json']);
  assert.deepEqual(r.json.errors.filter((e) => e.type === 'fret-range'), [],
    'fret 23 is within the 24-fret instrument');
  assert.ok(r.json.errors.some((e) => e.type === 'policy-max-fret'),
    'the policy ceiling of 21 must still bite');
});

// ---------------------------------------------------------------------------
// PTG Wave 1, contract C13 — harmonic nodes
// ---------------------------------------------------------------------------

test('C13: reliable natural-harmonic nodes (5/7/12/19) produce no finding', () => {
  const r = run([fix('harmonic-nodes.alphatab'), '--bars', '1-2', '--json']);
  assert.deepEqual(r.json.errors, []);
  assert.deepEqual(r.json.warnings, [], 'rule 13\'s four nodes are silent, not merely non-fatal');
  assert.equal(r.code, 0);
});

test('C13: an EXTENDED node (4/9/16/24) warns, and does not fail the gate', () => {
  const r = run([fix('harmonic-nodes.alphatab'), '--bars', '3-4', '--json']);
  assert.deepEqual(r.json.errors, [], 'an extended node is a real node — never an error');
  const ext = r.json.warnings.filter((w) => w.type === 'harmonic-node-extended');
  assert.equal(ext.length, 3, `expected frets 4, 9 and 16 to warn, got ${JSON.stringify(types(r.json.warnings))}`);
  for (const fret of [4, 9, 16]) {
    assert.ok(ext.some((w) => new RegExp(`fret ${fret} `).test(w.message)), `fret ${fret} missing`);
  }
  assert.equal(r.code, 0);
});

test('C13: a natural harmonic anywhere else is still a hard error', () => {
  const r = run([fix('harmonic-nodes.alphatab'), '--bars', '5', '--json']);
  const errs = r.json.errors.filter((e) => e.type === 'harmonic-node');
  assert.equal(errs.length, 2, 'frets 3 and 6 are not nodes at all');
  assert.match(errs[0].message, /nodes exist only at frets 5, 7, 12, 19/, 'today\'s message shape is kept');
  assert.equal(r.code, 1);
});

test('C13: artificial / pinch / tap / feedback harmonics skip natural-node validation', () => {
  // These are produced by the RIGHT hand relative to the fretted note, so the
  // written fret says nothing about whether a natural node lives there.
  // `3.1{ah}` and `6.1{ph}` are everyday notation and must not be refused.
  const r = run([fix('harmonic-nodes.alphatab'), '--bars', '6-7', '--json']);
  assert.deepEqual(r.json.errors, [], 'non-natural harmonics must not hit the node table');
  assert.deepEqual(r.json.warnings.filter((w) => /^harmonic-node/.test(w.type)), []);
  assert.equal(r.code, 0);
});

// ---------------------------------------------------------------------------
// PTG Wave 1, contract C14 — hybrid picking
// ---------------------------------------------------------------------------

test('C14: a non-adjacent DYAD warns only (exit 0), with the pinned wording', () => {
  const r = run([fix('non-adjacent-dyad.alphatab'), '--bars', '1', '--json']);
  assert.deepEqual(r.json.errors, [], 'hybrid picking is an ordinary technique, not a defect');
  const w = r.json.warnings.find((x) => x.type === 'non-adjacent-dyad');
  assert.ok(w, `expected a non-adjacent-dyad warning, got ${JSON.stringify(types(r.json.warnings))}`);
  assert.ok(w.message.includes('Non-adjacent dyad: hybrid picking or a roll may be required.'),
    `C14 pins this sentence verbatim; got: ${w.message}`);
  assert.equal(r.code, 0);
});

test('C14: a non-adjacent 3-note grip remains a hard error', () => {
  const r = run([fix('non-adjacent-triad.alphatab'), '--bars', '1', '--json']);
  const e = r.json.errors.find((x) => x.type === 'non-adjacent-strings');
  assert.ok(e, `expected non-adjacent-strings, got ${JSON.stringify(types(r.json.errors))}`);
  assert.match(e.message, /non-adjacent strings 2,4,6/);
  assert.deepEqual(r.json.warnings.filter((w) => w.type === 'non-adjacent-dyad'), [],
    'a 3-note grip is not also a dyad');
  assert.equal(r.code, 1);
});

test('C14: an ADJACENT dyad and a brushed non-adjacent beat stay silent', () => {
  // The negative half of C11.6: the split must not have turned every multi-note
  // beat into a finding. `policy-violations.alphatab` bar 1 is 16 adjacent
  // (strings 1-2) 16th dyads; brushed/rolled beats are exempt by construction.
  const r = run([fix('policy-violations.alphatab'), '--bars', '1', '--json']);
  assert.deepEqual(r.json.warnings.filter((w) => w.type === 'non-adjacent-dyad'), []);
  assert.deepEqual(r.json.errors.filter((e) => e.type === 'non-adjacent-strings'), []);
});

// ---------------------------------------------------------------------------
// PTG Wave 1, contract C12 — pick demand (end to end through the CLI)
// ---------------------------------------------------------------------------

test('C12: a sustained fast run warns; a short burst of the same notes does not', () => {
  const TAB = fix('pick-demand.alphatab');   // \tempo 168
  // Bar 1: eight 16ths = exactly 2 beats, then a half rest. Inside the budget.
  const burst = run([TAB, '--bars', '1', '--json']);
  assert.deepEqual(burst.json.warnings.filter((w) => /^pick-demand/.test(w.type)), [],
    'a 2-beat burst is explicitly sanctioned by the reference');

  // Bar 2: sixteen 16ths = 4 beats. Past the budget, at a "hard" table cell.
  const sustained = run([TAB, '--bars', '2', '--json']);
  const pd = sustained.json.warnings.filter((w) => /^pick-demand/.test(w.type));
  assert.equal(pd.length, 1, 'exactly ONE advisory per run, not one per beat');
  assert.equal(pd[0].type, 'pick-demand.hard');
  assert.equal(pd[0].code, 'pick-demand.hard', 'C3 code and native type must agree');
  assert.equal(pd[0].severity, 'warning');
  assert.equal(pd[0].data.level, 'hard');
  assert.equal(pd[0].data.subdivision, '16th');
  assert.equal(pd[0].data.tempo, 168);
  assert.equal(pd[0].data.sustained, true);

  // Bar 3: eighths at 168 BPM — "easy" in the table, whatever the run length.
  const eighths = run([TAB, '--bars', '3', '--json']);
  assert.deepEqual(eighths.json.warnings.filter((w) => /^pick-demand/.test(w.type)), []);

  // And pick demand NEVER fails the gate.
  assert.equal(sustained.json.errors.length, 0);
  assert.equal(sustained.code, 0);
});

test('C12: the retired pick-speed warning is gone for good', () => {
  const r = run([fix('pick-demand.alphatab'), '--bars', '1-3', '--json']);
  assert.deepEqual([...r.json.errors, ...r.json.warnings].filter((f) => f.type === 'pick-speed'), [],
    'PICK_CEILING_NPS was an invented constant; nothing may resurrect its code');
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

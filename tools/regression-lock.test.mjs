// regression-lock.test.mjs — the compatibility floor.
// Run: node tools/regression-lock.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// Every other suite asks whether a feature works. This one asks whether
// something that already worked still does. The distinction matters because the
// failures it catches are the ones nobody is looking for: a default that quietly
// moved, an exit code that changed meaning, an analysis command that started
// writing to the file it was asked to read.
//
// The ledger of what is protected, and why each entry is compatibility-sensitive,
// is docs/specs/wave6-regression-lock.md. This file is that document executed.
//
// THREE THINGS IT REFUSES TO ACCEPT
// ---------------------------------
// 1. A PASS over nothing. The hard gates fail open by construction — 0 of 0
//    covered is a PASS — so every assertion that a gate passed is paired with an
//    assertion that it had something to grade. `0/0` is not evidence.
// 2. A mutated input. An analysis command reads; it does not write. Every
//    user-facing analysis CLI is run and every file it was handed is compared
//    byte for byte afterwards.
// 3. An exit code that means two things. `0` succeeded, `1` a hard musical or
//    mechanical failure, `2` malformed input or an operational failure. A tool
//    that returns 1 for a missing file has made its exit code useless.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const OUT = path.join(ROOT, 'out', 'regression-lock');
const fix = (n) => path.join(TOOLS, 'fixtures', n);
const tool = (n) => path.join(TOOLS, n);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function run(args, { cwd = ROOT } = {}) {
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', cwd, timeout: 120_000, killSignal: 'SIGKILL',
  });
  const describe = () => `command: node ${args.join(' ')}\n`
    + `status:  ${r.status}   signal: ${r.signal ?? '(none)'}\n`
    + `stderr:  ${(r.stderr ?? '').slice(0, 800) || '(empty)'}`;
  if (r.error) throw new Error(`child failed to run (${r.error.code ?? r.error.message})\n${describe()}`);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not every command is --json */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json, describe };
}

// One digest per source, reused by everything below.
const DIGESTS = {};
for (const [key, src] of Object.entries({
  chaconne: 'chaconne-excerpt.alphatab',
  jazz: 'harmonic-color/jazz-source.alphatab',
  dual: 'dual/source.alphatab',
  contract: 'contract-source.alphatab',
})) {
  const dir = path.join(OUT, key);
  fs.mkdirSync(dir, { recursive: true });
  const r = run([tool('piano-extract.mjs'), fix(src), '--out', dir]);
  assert.equal(r.code, 0, `piano-extract ${src}\n${r.describe()}`);
  DIGESTS[key] = path.join(dir, `${path.basename(src, '.alphatab')}.json`);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// 1. Exit-code semantics, at the process boundary (C7)
// ---------------------------------------------------------------------------
// A table, because the claim is about the SET of codes, not about any one of
// them. The historical trap this pins: playability used to exit 1 on warnings,
// which made its exit code unusable for automation. Anything that reintroduces a
// second meaning for a code shows up here.

test('C7: exit 0 is success (advisories included), 1 is a hard failure, 2 is operational', () => {
  const cases = [
    // [expected exit, why, argv]
    [0, 'a mapped cover that passes every hard gate',
      [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
        '--digest', DIGESTS.chaconne, '--map', fix('e2e-sidecar.json')]],
    [0, 'soft findings do not move the verdict',
      [tool('playability.mjs'), fix('position-jump-slow.alphatab'), '--bars', '1-2']],
    [1, 'a bar-locked 1:1 gate against a cover that legitimately fails it',
      [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8', '--digest', DIGESTS.chaconne]],
    [1, 'a hard mechanical error',
      [tool('playability.mjs'), fix('non-adjacent-triad.alphatab'), '--bars', '1']],
    [1, 'a tab that does not parse fails validate --strict',
      [tool('check.mjs'), fix('broken-syntax.alphatab'), '--bars', '1', '--digest', DIGESTS.chaconne]],
    [2, 'no arguments at all',
      [tool('check.mjs')]],
    [2, '--bars is required on every run',
      [tool('check.mjs'), fix('e2e-tab.alphatab'), '--digest', DIGESTS.chaconne]],
    [2, 'an unparseable --bars range',
      [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', 'nonsense', '--digest', DIGESTS.chaconne]],
    [2, 'a tab file that does not exist',
      [tool('check.mjs'), fix('does-not-exist.alphatab'), '--bars', '1-8', '--digest', DIGESTS.chaconne]],
    [2, 'a digest that does not exist',
      [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8', '--digest', path.join(OUT, 'nope.json')]],
    [2, 'an unknown style is an error, never a silent fallback',
      [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8', '--digest', DIGESTS.chaconne,
        '--style', 'klezmer']],
    [2, 'dual-guitar with no roles declared',
      [tool('check.mjs'), fix('dual/cover.alphatab'), '--bars', '1-4', '--digest', DIGESTS.dual,
        '--arrangement-mode', 'dual-guitar']],
    [2, 'a track claimed as both lead and rhythm',
      [tool('check.mjs'), fix('dual/cover.alphatab'), '--bars', '1-4', '--digest', DIGESTS.dual,
        '--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '0']],
  ];
  for (const [expected, why, argv] of cases) {
    const r = run(argv);
    assert.equal(r.code, expected, `expected exit ${expected} — ${why}\n${r.describe()}`);
  }
});

test('C7: a soft-only run exits 0 from every advisory-bearing CLI', () => {
  // Each of these can produce findings and none of them may gate on one.
  const soloOnly = [
    [tool('fingering.mjs'), fix('fingering-greedy-trap.alphatab'), '--bars', '1-2', '--json'],
    [tool('idiom.mjs'), fix('idiom/piano-block.alphatab'), '--bars', '1-4', '--json'],
    [tool('sidecar-audit.mjs'), '--digest', DIGESTS.chaconne, '--map', fix('sidecar-audit/free-half.json'), '--json'],
  ];
  for (const argv of soloOnly) {
    const r = run(argv);
    assert.equal(r.code, 0, `a soft-only analyzer must exit 0\n${r.describe()}`);
    assert.ok(r.json, `expected --json output\n${r.describe()}`);
    const advisories = r.json.advisories ?? [];
    assert.ok(Array.isArray(advisories), 'advisories must be an array even when empty');
  }
});

// ---------------------------------------------------------------------------
// 2. Historical defaults (C6 / A1 / A5)
// ---------------------------------------------------------------------------

test('defaults: no configuration at all still means hard-rock, high gain, solo', () => {
  const r = run([tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
    '--digest', DIGESTS.chaconne, '--map', fix('e2e-sidecar.json'), '--json']);
  assert.equal(r.code, 0, r.describe());
  assert.equal(r.json.configuration.style, 'hard-rock');
  assert.equal(r.json.configuration.gain, 'high');
  assert.equal(r.json.configuration.arrangementMode, 'solo');
  assert.deepEqual(r.json.configuration.tracks.rhythm, [],
    'solo declares no rhythm track — dual-guitar is opt-in (A5)');
  assert.equal(r.json.instrument.maxFret, 22, 'the built-in instrument is 22 frets');
  assert.equal(r.json.instrument.stringCount, 6);
});

test('defaults: stating the defaults explicitly changes nothing at all', () => {
  // If `--style hard-rock` ever diverges from saying nothing, then "hard-rock is
  // the default" has stopped being true and every existing project moved.
  const base = [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
    '--digest', DIGESTS.chaconne, '--map', fix('e2e-sidecar.json'), '--json'];
  const implicit = run(base).json;
  const explicit = run([...base, '--style', 'hard-rock', '--gain', 'high', '--arrangement-mode', 'solo']).json;

  // `configuration.provenance` is EXPECTED to differ — it is the record of where
  // each value came from, and the whole point is that it says "cli" in one case
  // and "default" in the other. Everything else must match.
  assert.equal(JSON.stringify(implicit.hard), JSON.stringify(explicit.hard),
    'the hard result must not depend on whether the default was typed out');
  assert.equal(JSON.stringify(implicit.soft), JSON.stringify(explicit.soft),
    'nor the advice');
  assert.equal(implicit.configuration.style, explicit.configuration.style);
  assert.equal(implicit.configuration.gain, explicit.configuration.gain);
});

test('defaults: every style leaves the hard result bit-identical', () => {
  const base = [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
    '--digest', DIGESTS.chaconne, '--map', fix('e2e-sidecar.json'), '--json'];
  const results = ['hard-rock', 'metal', 'blues', 'jazz'].map((s) => run([...base, '--style', s]));
  const baseline = JSON.stringify(results[0].json.hard);
  for (const r of results) {
    assert.equal(r.code, 0, r.describe());
    assert.equal(JSON.stringify(r.json.hard), baseline,
      'a style profile is soft policy and may never move a hard gate (C6)');
  }
});

// ---------------------------------------------------------------------------
// 3. Anti-vacuity — a PASS must have graded something
// ---------------------------------------------------------------------------

test('anti-vacuity: a passing bar-locked gate reports non-zero coverage totals', () => {
  const r = run([tool('check.mjs'), fix('harmonic-color/shell-tab.alphatab'), '--bars', '1-8',
    '--digest', DIGESTS.jazz, '--json']);
  assert.equal(r.code, 0, r.describe());
  const g = r.json.hard.compare.hardGates;
  assert.ok(g.melodicSkeleton.total > 0,
    `melodic skeleton graded ${g.melodicSkeleton.total} notes — 0/0 is a trivial PASS, not evidence`);
  assert.ok(g.harmonicRoots.total > 0, 'harmonic roots graded nothing');
  assert.equal(g.melodicSkeleton.covered, g.melodicSkeleton.total);
  assert.ok(r.json.hard.playability.stats.notesAnalyzed > 0, 'playability analysed no notes');
  assert.ok(r.json.hard.playability.stats.beatsAnalyzed > 0, 'playability analysed no beats');
});

test('anti-vacuity: a passing MAP-mode gate reports entries and skeleton coverage', () => {
  const r = run([tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
    '--digest', DIGESTS.chaconne, '--map', fix('e2e-sidecar.json'), '--json']);
  assert.equal(r.code, 0, r.describe());
  assert.ok(r.json.hard.compare.mapResults.length > 0, 'no sidecar entry was evaluated');
  assert.ok(r.json.hard.compare.mapResults.every((e) => e.ok), 'every entry must have passed');
  const sk = r.json.analyzers.sidecar.metrics.melodySkeletonSpace;
  assert.ok(sk.total > 0, 'the source contributed no melodic skeleton to protect');
  assert.ok(r.json.analyzers.sidecar.metrics.tabSpace.totalTabBars > 0, 'no tab bars in range');
});

test('anti-vacuity: a contract span reports non-zero obligations or it is not a gate', () => {
  const r = run([tool('check.mjs'), fix('contract-tab-pass.alphatab'), '--bars', '1-3',
    '--digest', DIGESTS.contract, '--map', fix('contract-sidecar.json'),
    '--contract', fix('contract-melody.json'), '--json']);
  assert.equal(r.code, 0, r.describe());
  const contractEntries = r.json.hard.compare.mapResults.filter((e) => /contract/.test(e.mode));
  assert.ok(contractEntries.length > 0, 'the fixture must actually exercise a contract span');
  assert.ok(contractEntries.every((e) => e.ok), 'every contract span in the PASS fixture must pass');
});

// ---------------------------------------------------------------------------
// 4. The §A.2 pitch-class-set narrowing stays narrow
// ---------------------------------------------------------------------------

test('§A.2: harmony.pcset stays the narrowed half-bar stratum, and never re-widens', () => {
  // This was the project's blocking defect: a whole-bar pcset let a random
  // diatonic note satisfy the harmonic gate ~53% of the time, so the gate
  // reported PASS while protecting almost nothing. The fix narrowed the pcset
  // INPUT; the temptation the lock exists to resist is "making the gate more
  // forgiving" by widening it back.
  const digest = JSON.parse(fs.readFileSync(DIGESTS.chaconne, 'utf8'));
  const widths = digest.bars.map((b) => (b.harmony?.pcset ?? []).length);
  assert.ok(widths.length > 0, 'the digest has no bars to measure');
  const mean = widths.reduce((a, x) => a + x, 0) / widths.length;
  assert.ok(mean <= 4.0, `mean pcset width ${mean.toFixed(2)} > 4.0 — the harmonic gate has re-widened`);
  assert.equal(widths.filter((w) => w >= 7).length, 0,
    'a 7-pitch-class bar is the whole major scale — that is the defect, restored');

  // The root invariant the narrowing had to preserve. `harmony.root` is the
  // whole-bar lowest sounding pitch class, serialized as a note NAME, and it was
  // deliberately left untouched by the fix — the defect was pcset WIDTH, not
  // root accuracy. AGENTS.md §A.2 records the measured chaconne bass line, so
  // that exact sequence is what this pins.
  for (const b of digest.bars) {
    if (!b.harmony || b.harmony.root === null || b.harmony.root === undefined) continue;
    assert.match(String(b.harmony.root), /^[A-G][#b]?$/, `bar ${b.bar}: root is not a note name`);
  }
  const roots = digest.bars.slice(0, 8).map((b) => b.harmony?.root).join(' ');
  assert.equal(roots, 'A F# D G A F# D G',
    'the chaconne bass line recorded in AGENTS.md §A.2 has moved — the root invariant is broken');

  // And the detail was MOVED, not deleted — harmonySpans still carries both
  // half-bar chords, which is what makes the narrowing a re-window rather than a
  // loss of information.
  const withSpans = digest.bars.filter((b) => Array.isArray(b.harmonySpans) && b.harmonySpans.length > 0);
  assert.ok(withSpans.length > 0, 'harmonySpans[] is gone — the narrowing became a deletion');
  assert.ok(withSpans.some((b) => b.harmonySpans.length >= 2),
    'no bar carries two half-bar chords, which is the resolution harmonySpans exists to keep');
});

// ---------------------------------------------------------------------------
// 5. Determinism across a representative matrix
// ---------------------------------------------------------------------------

test('determinism: every analysis command produces byte-identical JSON twice', () => {
  const matrix = [
    ['check bar-locked', [tool('check.mjs'), fix('harmonic-color/shell-tab.alphatab'), '--bars', '1-8',
      '--digest', DIGESTS.jazz, '--json']],
    ['check map-mode', [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
      '--digest', DIGESTS.chaconne, '--map', fix('e2e-sidecar.json'), '--json']],
    ['check dual-guitar', [tool('check.mjs'), fix('dual/cover.alphatab'), '--bars', '1-4',
      '--digest', DIGESTS.dual, '--map', fix('dual/sidecar.json'),
      '--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1', '--json']],
    ['check jazz', [tool('check.mjs'), fix('harmonic-color/flattened-tab.alphatab'), '--bars', '1-8',
      '--digest', DIGESTS.jazz, '--map', fix('harmonic-color/sidecar.json'), '--style', 'jazz', '--json']],
    ['playability', [tool('playability.mjs'), fix('position-jump-slow.alphatab'), '--bars', '1-3', '--json']],
    ['fingering', [tool('fingering.mjs'), fix('fingering-greedy-trap.alphatab'), '--bars', '1-2', '--json']],
    ['idiom', [tool('idiom.mjs'), fix('idiom/metal-riff.alphatab'), '--bars', '1-4', '--style', 'metal', '--json']],
    ['sidecar-audit', [tool('sidecar-audit.mjs'), '--digest', DIGESTS.chaconne,
      '--map', fix('sidecar-audit/mixed.json'), '--json']],
    ['compare', [tool('compare.mjs'), fix('e2e-tab.alphatab'), DIGESTS.chaconne,
      '--bars', '1-8', '--map', fix('e2e-sidecar.json'), '--json']],
  ];
  for (const [name, argv] of matrix) {
    const a = run(argv);
    const b = run(argv);
    assert.equal(a.code, b.code, `${name}: exit code moved between runs`);
    assert.equal(a.stdout, b.stdout, `${name}: two identical runs produced different JSON`);
    assert.ok(a.stdout.trim().length > 0, `${name}: produced no output to compare`);
  }
});

// ---------------------------------------------------------------------------
// 6. No analysis command writes to what it was asked to read (C15)
// ---------------------------------------------------------------------------

test('C15: every user-facing analysis CLI leaves its inputs byte-identical', () => {
  // The plan's ask, made exhaustive: the previous coverage tested check.mjs,
  // fingering.mjs and idiom.mjs. A tool that starts rewriting the score is the
  // single most destructive regression this project could ship, and the arranger
  // would discover it by losing work.
  const inputs = [
    'e2e-tab.alphatab', 'e2e-sidecar.json', 'chaconne-excerpt.alphatab',
    'harmonic-color/shell-tab.alphatab', 'harmonic-color/jazz-source.alphatab',
    'harmonic-color/sidecar.json', 'dual/cover.alphatab', 'dual/source.alphatab',
    'dual/sidecar.json', 'contract-source.alphatab', 'contract-tab-pass.alphatab',
    'contract-melody.json', 'contract-sidecar.json', 'guitar-policy.json',
    'position-jump-slow.alphatab', 'idiom/metal-riff.alphatab',
    'fingering-greedy-trap.alphatab', 'sidecar-audit/mixed.json',
    'gain-voicing.alphatab', 'narrow-span-policy.json',
  ];
  const before = new Map(inputs.map((rel) => [rel, fs.readFileSync(fix(rel))]));
  const digestsBefore = new Map(Object.entries(DIGESTS).map(([k, p]) => [k, fs.readFileSync(p)]));

  const commands = [
    [tool('validate.mjs'), '--strict', fix('e2e-tab.alphatab')],
    [tool('playability.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
      '--policy', fix('guitar-policy.json'), '--json'],
    [tool('compare.mjs'), fix('e2e-tab.alphatab'), DIGESTS.chaconne, '--bars', '1-8',
      '--map', fix('e2e-sidecar.json'), '--json'],
    [tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8', '--digest', DIGESTS.chaconne,
      '--map', fix('e2e-sidecar.json'), '--json'],
    [tool('check.mjs'), fix('contract-tab-pass.alphatab'), '--bars', '1-3', '--digest', DIGESTS.contract,
      '--map', fix('contract-sidecar.json'), '--contract', fix('contract-melody.json'), '--json'],
    [tool('check.mjs'), fix('dual/cover.alphatab'), '--bars', '1-4', '--digest', DIGESTS.dual,
      '--map', fix('dual/sidecar.json'), '--arrangement-mode', 'dual-guitar',
      '--lead', '0', '--rhythm', '1', '--json'],
    [tool('fingering.mjs'), fix('fingering-greedy-trap.alphatab'), '--bars', '1-2', '--json'],
    [tool('idiom.mjs'), fix('idiom/metal-riff.alphatab'), '--bars', '1-4', '--json'],
    [tool('sidecar-audit.mjs'), '--digest', DIGESTS.chaconne, '--map', fix('sidecar-audit/mixed.json'), '--json'],
    [tool('tab-events.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-4', '--json'],
    [tool('piano-validate.mjs'), fix('chaconne-excerpt.alphatab')],
    [tool('source-profile.mjs'), fix('chaconne-excerpt.alphatab'), '--json'],
    [tool('contract-validate.mjs'), fix('contract-melody.json'), '--digest', DIGESTS.contract, '--json'],
    [tool('foreground.mjs'), DIGESTS.chaconne, '--out', path.join(OUT, 'fg')],
    [tool('export-midi.mjs'), fix('e2e-tab.alphatab'), '--out', path.join(OUT, 'lock.mid'), '--json'],
  ];
  for (const argv of commands) {
    const r = run(argv);
    assert.notEqual(r.code, null, `${path.basename(argv[0])} did not exit\n${r.describe()}`);
    assert.ok(r.code === 0 || r.code === 1,
      `${path.basename(argv[0])} exited ${r.code} — an operational failure means the command `
      + `never ran, so this test would prove nothing\n${r.describe()}`);
  }

  for (const [rel, bytes] of before) {
    assert.ok(bytes.equals(fs.readFileSync(fix(rel))),
      `${rel} was MODIFIED by an analysis command — analysis reads, it does not write`);
  }
  for (const [key, bytes] of digestsBefore) {
    assert.ok(bytes.equals(fs.readFileSync(DIGESTS[key])), `digest ${key} was modified by an analysis command`);
  }
});

test('C15: export-midi refuses to write over the source, with or without --force', () => {
  // The one destructive path a "write" tool actually has. Overwriting the score
  // with its own MIDI render is unrecoverable, and --force must not reach it.
  const src = fix('e2e-tab.alphatab');
  const before = fs.readFileSync(src);
  for (const extra of [[], ['--force']]) {
    const r = run([tool('export-midi.mjs'), src, '--out', src, ...extra, '--json']);
    assert.equal(r.code, 2, `writing MIDI over the source must be an operational refusal\n${r.describe()}`);
  }
  assert.ok(before.equals(fs.readFileSync(src)), 'the source was overwritten by its own MIDI export');
});

// ---------------------------------------------------------------------------

let failed = 0;
try {
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
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

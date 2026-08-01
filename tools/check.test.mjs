// check.test.mjs — integration self-test for tools/check.mjs
// (contracts C2/C4/C5/C6 + addendum §A1). Run: node tools/check.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// check.mjs is the one command a human runs at every gate, and Wave 3 gave it
// two new powers that could each break it quietly:
//
//   1. CONFIGURATION PRECEDENCE. The gate now resolves a style profile and a
//      gain through a four-level ladder. The failure mode is invisible: an
//      absent `--gain` that still overwrites the project's choice looks exactly
//      like a working tool. So every precedence test asserts the PROVENANCE
//      (`configuration.provenance.gain === 'config'`), not only the value — a
//      resolved `gain: 'high'` proves nothing, since it is also the default.
//
//   2. SOFT ANALYZERS INSIDE A HARD GATE. Two new child processes run on every
//      gate run. They must never move the verdict, and an analyzer that CRASHED
//      must never be reported as an analyzer that found nothing. Both are
//      tested against a real broken toolchain, not a mocked one.
//
// The suite runs check.mjs as a subprocess throughout, because that is how it is
// used and because it calls `process.exit` — the exit CODE is half the contract.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAdvisory } from './lib/advisory.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIX = path.join(ROOT, 'tools', 'fixtures');
const SCRATCH = path.join(ROOT, 'out', 'check-test');
const CHECK = path.join(ROOT, 'tools', 'check.mjs');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });
const fix = (n) => path.join(FIX, n);

/** Build a digest for a source fixture, once, into the scratch dir. */
function digestOf(stem) {
  const out = path.join(SCRATCH, `${stem}.json`);
  if (!fs.existsSync(out)) {
    const r = node([path.join(ROOT, 'tools', 'piano-extract.mjs'), fix(`${stem}.alphatab`), '--out', SCRATCH]);
    assert.equal(r.status, 0, `piano-extract ${stem} failed: ${r.stderr}`);
  }
  return out;
}

/** Run check.mjs --json and return { status, json, stdout, stderr }. */
function check(args) {
  const r = node([CHECK, ...args, '--json']);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

/** The standard passing end-to-end scenario, as an argument list. */
const e2e = (extra = []) => [
  fix('e2e-tab.alphatab'), '--bars', '1-8',
  '--digest', digestOf('chaconne-excerpt'),
  '--map', fix('e2e-sidecar.json'),
  ...extra,
];

/** A project dir holding a COPY of the e2e tab + an optional config.json, so a
 *  config-precedence test does not have to write inside tools/fixtures. */
function project(slug, config) {
  const dir = path.join(SCRATCH, slug);
  fs.mkdirSync(dir, { recursive: true });
  const tab = path.join(dir, 'cover.alphatab');
  fs.copyFileSync(fix('e2e-tab.alphatab'), tab);
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'config.json'),
      typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  }
  return tab;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Compatibility — the default run must behave exactly as it did
// ---------------------------------------------------------------------------

test('no config anywhere: hard-rock, high gain, and every historical field survives', () => {
  const { status, json } = check(e2e());
  assert.equal(status, 0);
  assert.equal(json.ok, true);
  assert.equal(json.configuration.style, 'hard-rock');
  assert.equal(json.configuration.provenance.style, 'default');
  assert.equal(json.gain, 'high', 'the pre-Wave-3 default gain is unchanged');
  // C4: additive only. Nothing that existed before Wave 3 may be renamed away.
  for (const k of ['ok', 'file', 'bars', 'transpose', 'gain', 'digest', 'instrument',
    'configPath', 'configSources', 'hard', 'soft', 'failReasons']) {
    assert.ok(k in json, `historical key "${k}" disappeared from check --json`);
  }
  assert.deepEqual(Object.keys(json.soft).sort(),
    ['compare', 'fingering', 'idiom', 'playability', 'sidecar'],
    'C4: all five soft keys, always');
  for (const v of Object.values(json.soft)) assert.ok(Array.isArray(v), 'arrays, never null');
});

test('C4: the soft block is still all-arrays when the tab does not parse', () => {
  const { status, json } = check([fix('broken-syntax.alphatab'), '--bars', '1-2',
    '--digest', digestOf('chaconne-excerpt')]);
  assert.equal(status, 1, 'an unparseable tab is a HARD failure, not an operational one');
  for (const [k, v] of Object.entries(json.soft)) {
    assert.deepEqual(v, [], `soft.${k} must be an empty array when nothing ran`);
  }
  assert.equal(json.analyzers.fingering, null, 'a stage that never ran reports null, not {}');
  assert.equal(json.analyzers.idiom, null);
});

// ---------------------------------------------------------------------------
// §A1 — absent is not a default
// ---------------------------------------------------------------------------

test('a project config supplies the style, and provenance says so', () => {
  const tab = project('styled', { schemaVersion: 1, style: 'jazz' });
  const { status, json } = check([tab, '--bars', '1-8', '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('e2e-sidecar.json')]);
  assert.equal(status, 0);
  assert.equal(json.configuration.style, 'jazz');
  assert.equal(json.configuration.provenance.style, 'config');
});

test('CLI --style overrides the project config', () => {
  const tab = project('styled-cli', { schemaVersion: 1, style: 'jazz' });
  const { json } = check([tab, '--bars', '1-8', '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('e2e-sidecar.json'), '--style', 'metal']);
  assert.equal(json.configuration.style, 'metal');
  assert.equal(json.configuration.provenance.style, 'cli');
});

test('the style profile supplies the gain when nothing else does', () => {
  // THE §A1 REGRESSION. Before Wave 3 `--gain` defaulted to the literal 'high'
  // during argument parsing, so this could never happen: the CLI had already
  // spoken for the user and the profile's voice was structurally unreachable.
  const { json } = check(e2e(['--style', 'jazz']));
  assert.equal(json.gain, 'clean', 'jazz is a clean-gain genre');
  assert.equal(json.configuration.provenance.gain, 'style-profile');
});

test('a project config gain outranks the profile default', () => {
  const tab = project('gained', { schemaVersion: 1, style: 'jazz', gain: 'crunch' });
  const { json } = check([tab, '--bars', '1-8', '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('e2e-sidecar.json')]);
  assert.equal(json.gain, 'crunch');
  assert.equal(json.configuration.provenance.gain, 'config');
});

test('CLI --gain outranks both', () => {
  const tab = project('gained-cli', { schemaVersion: 1, style: 'jazz', gain: 'crunch' });
  const { json } = check([tab, '--bars', '1-8', '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('e2e-sidecar.json'), '--gain', 'high']);
  assert.equal(json.gain, 'high');
  assert.equal(json.configuration.provenance.gain, 'cli');
});

test('an explicit --style hard-rock behaves identically to no --style at all', () => {
  const implicit = check(e2e()).json;
  const explicit = check(e2e(['--style', 'hard-rock'])).json;
  assert.deepEqual(explicit.hard, implicit.hard);
  assert.deepEqual(explicit.soft, implicit.soft);
  assert.equal(explicit.gain, implicit.gain);
  // Only the provenance may differ — and it must.
  assert.equal(implicit.configuration.provenance.style, 'default');
  assert.equal(explicit.configuration.provenance.style, 'cli');
});

// ---------------------------------------------------------------------------
// The style invariant: soft advice may move, hard results may not
// ---------------------------------------------------------------------------

test('same tab, same map, different style: HARD results are bit-identical', () => {
  const runs = ['hard-rock', 'metal', 'blues', 'jazz'].map((s) => check(e2e(['--style', s])));
  for (const r of runs) assert.equal(r.status, 0, 'every style must still pass the gate');
  const baseline = JSON.stringify(runs[0].json.hard);
  for (let i = 1; i < runs.length; i++) {
    assert.equal(JSON.stringify(runs[i].json.hard), baseline,
      'a style profile is soft musical policy — it may not touch validate/playability/compare');
  }
});

test('changing the style CAN change the soft advice', () => {
  const rock = check(e2e(['--style', 'hard-rock'])).json;
  const metal = check(e2e(['--style', 'metal'])).json;
  // Same notes, same features — only the weights and the floor differ.
  assert.deepEqual(rock.analyzers.idiom.features, metal.analyzers.idiom.features);
  assert.notEqual(rock.analyzers.idiom.score, metal.analyzers.idiom.score);
  assert.equal(rock.analyzers.idiom.settings.style, 'hard-rock');
  assert.equal(metal.analyzers.idiom.settings.style, 'metal');
});

// ---------------------------------------------------------------------------
// Soft analyzers reach the report
// ---------------------------------------------------------------------------

test('an idiom advisory reaches soft.idiom, and exits 0', () => {
  const { status, json } = check([fix('idiom/piano-block.alphatab'), '--bars', '1-4',
    '--digest', digestOf('chaconne-excerpt')]);
  assert.equal(hasAdvisory(json.soft.idiom, 'idiom.low-density'), true);
  assert.equal(status, json.ok ? 0 : 1);
  assert.notEqual(status, 2, 'a soft finding is never an operational failure');
});

test('a fingering advisory reaches soft.fingering', () => {
  const { json } = check([fix('fingering-greedy-trap.alphatab'), '--bars', '1-4',
    '--digest', digestOf('chaconne-excerpt')]);
  assert.ok(json.soft.fingering.length > 0, 'the greedy-trap fixture has a cheaper fingering');
  assert.ok(json.soft.fingering.every((a) => typeof a.code === 'string' && a.code.startsWith('fingering.')),
    'C3: every entry is a namespaced advisory');
});

test('soft findings never move the verdict: the gate still exits 0', () => {
  const { status, json } = check(e2e());
  const softCount = Object.values(json.soft).reduce((n, l) => n + l.length, 0);
  assert.ok(softCount > 0, 'this scenario really does produce soft findings');
  assert.equal(status, 0);
  assert.deepEqual(json.failReasons, []);
});

test('a HARD failure still exits 1, and the analyzers still ran', () => {
  const digest = digestOf('contract-source');
  const { status, json } = check([fix('contract-tab-fail.alphatab'), '--bars', '1-3',
    '--digest', digest, '--map', fix('contract-sidecar.json')]);
  assert.equal(status, 1);
  assert.equal(json.ok, false);
  assert.ok(json.failReasons.length > 0);
  // The tab parsed, so the soft stages are still meaningful and still ran.
  assert.notEqual(json.analyzers.idiom, null);
});

test('the human report marks the soft stages SOFT, never PASS/FAIL', () => {
  const r = node([CHECK, ...e2e()]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ {2}fingering {12}SOFT/m);
  assert.match(r.stdout, /^ {2}idiom {16}SOFT/m);
  assert.match(r.stdout, /style hard-rock \(default\)/);
});

// ---------------------------------------------------------------------------
// Operational failures are exit 2 — never a quiet empty advisory list
// ---------------------------------------------------------------------------

test('a malformed --style exits 2 and produces no verdict', () => {
  const r = check(e2e(['--style', 'polka']));
  assert.equal(r.status, 2);
  assert.equal(r.json, null, 'exit 2 prints usage on stderr, not a JSON verdict');
  assert.match(r.stderr, /unknown style "polka"/);
});

test('a malformed project config exits 2', () => {
  const tab = project('bad-config', { schemaVersion: 1, styel: 'jazz' });
  const r = check([tab, '--bars', '1-8', '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('e2e-sidecar.json')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown config key "styel"/);
});

// A REAL broken toolchain, not a mock. check.mjs resolves its children relative
// to its own location, so a copy of tools/ + reference/styles/ with one child
// sabotaged reproduces the failure exactly as a damaged install would.
function sabotagedToolchain(slug, sabotage) {
  const home = path.join(SCRATCH, slug);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(home, 'tools'), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}fixtures`),
  });
  fs.cpSync(path.join(ROOT, 'reference', 'styles'), path.join(home, 'reference', 'styles'),
    { recursive: true });
  sabotage(path.join(home, 'tools'));
  return path.join(home, 'tools', 'check.mjs');
}

test('an analyzer that emits non-JSON is exit 2, not an empty advisory array', () => {
  const broken = sabotagedToolchain('garbage-analyzer', (tools) => {
    fs.writeFileSync(path.join(tools, 'idiom.mjs'),
      'console.log("this is not json"); process.exit(0);\n');
  });
  const r = node([broken, ...e2e(), '--json']);
  assert.equal(r.status, 2, 'a soft analyzer that cannot be understood is an OPERATIONAL failure');
  assert.match(r.stderr, /idiom\.mjs could not analyse/);
});

test('a MISSING analyzer is exit 2', () => {
  const broken = sabotagedToolchain('missing-analyzer', (tools) => {
    fs.rmSync(path.join(tools, 'fingering.mjs'));
  });
  const r = node([broken, ...e2e(), '--json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /fingering\.mjs could not analyse/);
});

test('an analyzer that exits 2 propagates as exit 2', () => {
  const broken = sabotagedToolchain('failing-analyzer', (tools) => {
    fs.writeFileSync(path.join(tools, 'idiom.mjs'),
      'console.log(JSON.stringify({ ok: false, errors: ["deliberate failure"] })); process.exit(2);\n');
  });
  const r = node([broken, ...e2e(), '--json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /deliberate failure/);
});

test('an unmodified copy of the toolchain still passes — the sabotage tests are honest', () => {
  // Without this, all three tests above would pass just as happily if the COPY
  // itself were broken, and they would be asserting nothing about sabotage.
  const clean = sabotagedToolchain('clean-copy', () => {});
  const r = node([clean, ...e2e(), '--json']);
  assert.equal(r.status, 0, r.stderr);
});

// ---------------------------------------------------------------------------
// Determinism (§A6)
// ---------------------------------------------------------------------------

test('two identical runs produce byte-identical JSON', () => {
  const a = node([CHECK, ...e2e(['--style', 'blues']), '--json']).stdout;
  const b = node([CHECK, ...e2e(['--style', 'blues']), '--json']).stdout;
  assert.equal(a, b);
});

test('the gate never rewrites the tab it grades (C15)', () => {
  const before = fs.readFileSync(fix('e2e-tab.alphatab'));
  check(e2e(['--style', 'metal']));
  assert.ok(before.equals(fs.readFileSync(fix('e2e-tab.alphatab'))));
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

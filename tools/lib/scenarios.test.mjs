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
// WHAT A "PAIR" IS (Wave 6)
// -------------------------
// Before Wave 6 the corpus grouped scenarios by SOURCE and asserted that each
// source carried a loud and a quiet member. That proves variants exist; it does
// not prove that a pair varies the dimension it claims to. Two scenarios could
// differ in style AND target and still satisfy it, and the resulting difference
// in advice would attribute to whichever one you happened to believe in.
//
// So a pair now DECLARES its axis, and this file enforces it: members of a
// `target` pair must be byte-identical in every field except `target`, members of
// a `style` pair in every field except `style`, and so on. A malformed pair fails
// during manifest validation, before check.mjs runs once — the failure is a
// statement about the fixture, and it should not have to be inferred from a
// confusing advisory diff.
//
// Expectations are advisory CODES (C3), never prose, so wording stays free to
// improve. `forbiddenAdvisoryCodes` is the half that earns its keep — a false
// positive on idiomatic writing is how an advisory system gets switched off and
// never switched back on.
//
// EXECUTION REUSE (Wave 6)
// ------------------------
// The suite asks ~10 questions of each scenario, and it used to spawn a fresh
// check.mjs for every one — 88 s of wall clock, almost all of it re-parsing the
// same eight bars. Runs are now cached on the EXACT argv, so a scenario executes
// once and every question reads the same result. Three tests opt out on purpose,
// because a cached answer would make them vacuous: determinism (which must
// observe two real runs), mutation (which must observe a real write), and the
// style-invariance sweep's repeat of the baseline style.

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

// Generous on purpose: this is a runaway guard, not a performance budget. A
// scenario that legitimately needs 30 s is a scenario worth waiting for; one
// that needs 120 s has hung, and a hung child with no timeout takes the whole
// suite down with no diagnosis.
const CHILD_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Manifest schema (fail closed)
// ---------------------------------------------------------------------------
// A typo in a fixture must never read as a default. Every key is listed; an
// unknown one is an error, not an ignored extra.

const SCENARIO_KEYS = new Set([
  'id', 'pairId', 'polarity', 'variantAxis', 'intent',
  'source', 'target', 'map', 'bars', 'style', 'gain',
  'arrangementMode', 'lead', 'rhythm', 'policy', 'maxFret', 'transpose',
  'expect',
]);
const EXPECT_KEYS = new Set([
  'exit', 'hardPass', 'failReasons',
  'requiredAdvisoryCodes', 'forbiddenAdvisoryCodes',
  'maximumTotalAdvisories', 'maximumAdvisoryCounts',
  'requiredDataFields', 'requiredStats',
]);
const POLARITIES = new Set(['positive', 'negative', 'comparison']);
const STAT_OPS = new Set(['minimum', 'maximum', 'equals', 'equalsJson']);

/** Which fields a pair on each axis must SHARE, and which it must VARY. */
const AXES = {
  target: {
    shared: ['source', 'map', 'style', 'gain', 'arrangementMode', 'lead', 'rhythm', 'bars', 'policy'],
    varied: ['target'],
  },
  style: {
    shared: ['source', 'target', 'map', 'arrangementMode', 'lead', 'rhythm', 'bars', 'policy'],
    varied: ['style'],
  },
  map: {
    shared: ['source', 'target', 'style', 'gain', 'arrangementMode', 'lead', 'rhythm', 'bars', 'policy'],
    varied: ['map'],
  },
  roles: {
    shared: ['source', 'target', 'map', 'style', 'gain', 'arrangementMode', 'bars', 'policy'],
    varied: ['lead', 'rhythm'],
  },
  configuration: {
    shared: ['source', 'target', 'map', 'style', 'bars'],
    varied: ['gain', 'arrangementMode', 'lead', 'rhythm', 'policy', 'maxFret', 'transpose'],
  },
};

// Codes whose repetition is per-bar BY CONTRACT, and so exempt from the
// deduplication ceiling. Both predate C3 and both are located findings: a reader
// wants to know WHICH bars, and collapsing them would delete that.
const PER_BAR_BY_CONTRACT = new Set(['sustain', 'compare.dropped-notes']);

const DEFAULT_TOTAL_BUDGET = 12;   // soft findings, on a scenario that passes
const DEFAULT_MAX_PER_CODE = 4;    // one root problem is not fourteen findings

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const manifestPath = path.join(FIX, 'scenarios', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// ---------------------------------------------------------------------------
// Child process plumbing
// ---------------------------------------------------------------------------

/**
 * Spawn node with a timeout and turn every failure mode into a message that
 * names the command. `spawnSync` reports a timeout as `error.code ==='ETIMEDOUT'`
 * with a partial stdout, which reads exactly like a tool that printed nothing —
 * the difference has to be stated or a hang gets debugged as a parse bug.
 */
function node(args, { cwd = ROOT } = {}) {
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', cwd, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL',
  });
  const describe = () => [
    `command: node ${args.join(' ')}`,
    `cwd:     ${cwd}`,
    `status:  ${r.status}`,
    `signal:  ${r.signal ?? '(none)'}`,
    r.error ? `error:   ${r.error.code ?? r.error.message}` : null,
    `stdout:  ${(r.stdout ?? '').slice(0, 2000) || '(empty)'}`,
    `stderr:  ${(r.stderr ?? '').slice(0, 2000) || '(empty)'}`,
  ].filter(Boolean).join('\n');
  if (r.error?.code === 'ETIMEDOUT') {
    throw new Error(`child timed out after ${CHILD_TIMEOUT_MS} ms\n${describe()}`);
  }
  if (r.error) throw new Error(`child failed to run\n${describe()}`);
  return { ...r, describe };
}

/** Parse a tool's --json stdout strictly, with the command in the message. */
function parseJson(r, what) {
  const text = (r.stdout ?? '').trim();
  if (text === '') throw new Error(`${what}: produced no stdout to parse\n${r.describe()}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${what}: stdout is not one JSON document (${err.message})\n${r.describe()}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`${what}: expected a JSON object, got ${typeof parsed}\n${r.describe()}`);
  }
  return parsed;
}

/** Extract a digest once per source, into a per-source scratch directory (two
 *  sources can share a basename, and piano-extract writes by basename). */
const digestCache = new Map();
function digestOf(sourceRel) {
  if (digestCache.has(sourceRel)) return digestCache.get(sourceRel);
  const dir = path.join(SCRATCH, sourceRel.replace(/[\\/.]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const r = node([path.join(ROOT, 'tools', 'piano-extract.mjs'), path.join(FIX, sourceRel), '--out', dir]);
  assert.equal(r.status, 0, `piano-extract ${sourceRel}:\n${r.describe()}`);
  const stem = path.basename(sourceRel, path.extname(sourceRel));
  const out = path.join(dir, `${stem}.json`);
  assert.ok(fs.existsSync(out), `no digest at ${out}\n${r.describe()}`);
  digestCache.set(sourceRel, out);
  return out;
}

/** The exact argv a human would type for one scenario. */
function argvFor(s) {
  const args = [CHECK, path.join(FIX, s.target), '--bars', s.bars, '--digest', digestOf(s.source)];
  if (s.map !== null) args.push('--map', path.join(FIX, s.map));
  args.push('--style', s.style);
  if (s.gain) args.push('--gain', s.gain);
  if (s.arrangementMode) args.push('--arrangement-mode', s.arrangementMode);
  if (s.lead) args.push('--lead', s.lead.join(','));
  if (s.rhythm) args.push('--rhythm', s.rhythm.join(','));
  if (s.policy) args.push('--policy', path.join(FIX, s.policy));
  if (s.maxFret !== undefined) args.push('--max-fret', String(s.maxFret));
  if (s.transpose !== undefined) args.push('--transpose', String(s.transpose));
  args.push('--json');
  return args;
}

/**
 * Run check.mjs for one scenario. Cached on the exact argv — see the header.
 * `fresh: true` forces a real execution for the tests that must observe one.
 */
const runCache = new Map();
function runScenario(s, { fresh = false } = {}) {
  const args = argvFor(s);
  const key = args.join(' ');
  if (!fresh && runCache.has(key)) return runCache.get(key);
  const r = node(args);
  assert.notEqual(r.status, 2, `${s.id}: operational failure (exit 2)\n${r.describe()}`);
  const out = { status: r.status, json: parseJson(r, s.id), describe: r.describe, args };
  if (!fresh) runCache.set(key, out);
  return out;
}

/** Every advisory code (and native playability type) the run produced. */
const codesOf = (json) => Object.values(json.soft).flat().map((a) => a.code ?? a.type);

/** Counts per code, for the budget and dedup assertions. */
function countsOf(json) {
  const counts = new Map();
  for (const c of codesOf(json)) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

/** A one-line summary of what a run actually said, for every failure message. */
function summarize(res) {
  const counts = [...countsOf(res.json)].map(([c, n]) => (n > 1 ? `${c}×${n}` : c));
  return [
    `  command:  node ${res.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
    `  exit:     ${res.status}   ok: ${res.json.ok}   failReasons: [${(res.json.failReasons ?? []).join(', ')}]`,
    `  advisories: ${counts.join(', ') || '(silent)'}`,
  ].join('\n');
}

/** Read a dotted path out of the run's JSON. Returns `undefined` if absent. */
function readPath(obj, dotted) {
  let cur = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Every file the corpus hands to the gate, hashed BEFORE the first test runs.
 * The C15 no-mutation check reads this at the end, so it covers every execution
 * the suite performed rather than a private set of its own.
 */
const INPUT_BYTES = new Map();
for (const s of manifest.scenarios ?? []) {
  for (const rel of [s.target, s.source, s.map, s.policy]) {
    if (typeof rel !== 'string') continue;
    const p = path.join(FIX, rel);
    if (!INPUT_BYTES.has(p) && fs.existsSync(p)) INPUT_BYTES.set(p, fs.readFileSync(p));
  }
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// The manifest itself — validated before a single gate runs
// ---------------------------------------------------------------------------

test('manifest: schema is fail-closed and every path it names exists', () => {
  assert.equal(manifest.schemaVersion, 2, 'this runner reads schemaVersion 2');
  assert.ok(Array.isArray(manifest.scenarios) && manifest.scenarios.length >= 8,
    'a calibration corpus of fewer than 8 scenarios is not a corpus');

  const ids = new Set();
  for (const s of manifest.scenarios) {
    const where = s.id ?? '(scenario with no id)';

    for (const key of Object.keys(s)) {
      assert.ok(SCENARIO_KEYS.has(key), `${where}: unknown scenario field "${key}"`);
    }
    for (const key of ['id', 'pairId', 'polarity', 'variantAxis', 'intent', 'source', 'target', 'bars', 'style']) {
      assert.equal(typeof s[key], 'string', `${where}: "${key}" must be a string`);
      assert.notEqual(s[key].trim(), '', `${where}: "${key}" must not be empty`);
    }
    assert.ok(!ids.has(s.id), `duplicate scenario id: ${s.id}`);
    ids.add(s.id);

    assert.ok(POLARITIES.has(s.polarity),
      `${where}: polarity "${s.polarity}" is not one of ${[...POLARITIES].join('|')}`);
    assert.ok(Object.hasOwn(AXES, s.variantAxis),
      `${where}: variantAxis "${s.variantAxis}" is not one of ${Object.keys(AXES).join('|')}`);
    assert.ok(s.intent.length > 20, `${where}: every scenario states its musical intent`);

    // `map: null` means bar-locked and must be WRITTEN. An omitted key would let
    // a forgotten map read as a deliberate one.
    assert.ok(Object.hasOwn(s, 'map'), `${where}: "map" is required — write null for bar-locked`);
    assert.ok(s.map === null || typeof s.map === 'string', `${where}: "map" must be a string or null`);

    for (const key of ['source', 'target', 'map', 'policy']) {
      if (s[key] === null || s[key] === undefined) continue;
      assert.ok(fs.existsSync(path.join(FIX, s[key])), `${where}: missing ${key} "${s[key]}"`);
    }
    assert.ok(/^\d+(-\d+)?$/.test(s.bars), `${where}: bad bars "${s.bars}"`);

    for (const key of ['lead', 'rhythm']) {
      if (s[key] === undefined) continue;
      assert.ok(Array.isArray(s[key]) && s[key].length > 0
        && s[key].every((i) => Number.isInteger(i) && i >= 0),
        `${where}: "${key}" must be a non-empty array of track indices`);
    }
    if (s.lead && s.rhythm) {
      const overlap = s.lead.filter((i) => s.rhythm.includes(i));
      assert.equal(overlap.length, 0, `${where}: track(s) ${overlap} declared both lead and rhythm`);
    }
    assert.ok((s.lead === undefined) === (s.rhythm === undefined),
      `${where}: lead and rhythm are declared together or not at all`);
    if (s.arrangementMode !== undefined) {
      assert.ok(['solo', 'dual-guitar'].includes(s.arrangementMode),
        `${where}: bad arrangementMode "${s.arrangementMode}"`);
    }

    // --- expectations ---
    const e = s.expect;
    assert.ok(e && typeof e === 'object', `${where}: missing "expect"`);
    for (const key of Object.keys(e)) {
      assert.ok(EXPECT_KEYS.has(key), `${where}: unknown expectation field "${key}"`);
    }
    assert.ok([0, 1].includes(e.exit), `${where}: expect.exit must be 0 or 1 (2 is an operational failure)`);
    assert.equal(typeof e.hardPass, 'boolean', `${where}: expect.hardPass must be a boolean`);
    assert.equal(e.exit === 0, e.hardPass,
      `${where}: exit ${e.exit} contradicts hardPass ${e.hardPass} — exit 0 IS the hard pass (C7)`);

    for (const key of ['requiredAdvisoryCodes', 'forbiddenAdvisoryCodes']) {
      assert.ok(Array.isArray(e[key]), `${where}: expect.${key} must be an array`);
      assert.ok(e[key].every((c) => typeof c === 'string' && c.trim() !== ''),
        `${where}: expect.${key} must contain non-empty strings`);
    }
    const overlap = e.requiredAdvisoryCodes.filter((c) => e.forbiddenAdvisoryCodes.includes(c));
    assert.equal(overlap.length, 0,
      `${where}: code(s) ${overlap.join(', ')} are both required and forbidden`);

    if (e.failReasons !== undefined) {
      assert.ok(Array.isArray(e.failReasons) && e.failReasons.every((r) => typeof r === 'string'),
        `${where}: expect.failReasons must be an array of strings`);
      assert.ok(e.hardPass === false || e.failReasons.length === 0,
        `${where}: a passing scenario cannot declare fail reasons`);
    }
    assert.ok(e.hardPass || (e.failReasons ?? []).length > 0,
      `${where}: a failing scenario must name the hard gate it fails, so a DIFFERENT failure cannot pass this test`);

    if (e.maximumTotalAdvisories !== undefined) {
      assert.ok(Number.isInteger(e.maximumTotalAdvisories) && e.maximumTotalAdvisories >= 0,
        `${where}: expect.maximumTotalAdvisories must be a non-negative integer`);
    }
    for (const [code, n] of Object.entries(e.maximumAdvisoryCounts ?? {})) {
      assert.ok(Number.isInteger(n) && n >= 0,
        `${where}: expect.maximumAdvisoryCounts["${code}"] must be a non-negative integer`);
      assert.ok(!e.forbiddenAdvisoryCodes.includes(code),
        `${where}: "${code}" is forbidden, so a count ceiling for it says nothing`);
    }
    for (const [code, fields] of Object.entries(e.requiredDataFields ?? {})) {
      assert.ok(Array.isArray(fields) && fields.length > 0 && fields.every((f) => typeof f === 'string'),
        `${where}: expect.requiredDataFields["${code}"] must be a non-empty array of field names`);
      assert.ok(e.requiredAdvisoryCodes.includes(code),
        `${where}: data fields demanded of "${code}", which the scenario never requires — `
        + 'an advisory that does not fire would satisfy this vacuously');
    }
    for (const [dotted, rule] of Object.entries(e.requiredStats ?? {})) {
      assert.ok(rule && typeof rule === 'object' && Object.keys(rule).length > 0,
        `${where}: expect.requiredStats["${dotted}"] must state at least one comparison`);
      for (const op of Object.keys(rule)) {
        assert.ok(STAT_OPS.has(op),
          `${where}: expect.requiredStats["${dotted}"] has unknown comparison "${op}"`);
      }
    }
  }
});

test('manifest: every pair varies exactly the dimension it declares', () => {
  const pairs = new Map();
  for (const s of manifest.scenarios) {
    if (!pairs.has(s.pairId)) pairs.set(s.pairId, []);
    pairs.get(s.pairId).push(s);
  }

  for (const [pairId, members] of pairs) {
    assert.ok(members.length >= 2,
      `pair "${pairId}" has one member — nothing to compare it against`);

    const axis = members[0].variantAxis;
    for (const m of members) {
      assert.equal(m.variantAxis, axis,
        `pair "${pairId}": member ${m.id} declares axis "${m.variantAxis}", the pair is "${axis}"`);
    }

    // Every pair needs someone claiming silence and someone claiming a signal.
    // Two positives prove only that the tools are quiet.
    assert.ok(members.some((m) => m.polarity === 'positive'),
      `pair "${pairId}": no member claims the toolchain should stay quiet`);
    assert.ok(members.some((m) => m.polarity !== 'positive'),
      `pair "${pairId}": every member is positive — nothing is being contrasted`);

    const seenPolarity = new Map();
    for (const m of members) {
      const key = `${m.polarity}:${JSON.stringify(AXES[axis].varied.map((f) => m[f] ?? null))}`;
      assert.ok(!seenPolarity.has(key),
        `pair "${pairId}": ${m.id} and ${seenPolarity.get(key)} are the same polarity AND the same `
        + `variant — one of them is a copy, not a comparison`);
      seenPolarity.set(key, m.id);
    }

    const { shared, varied } = AXES[axis];
    const norm = (v) => JSON.stringify(v ?? null);
    for (const field of shared) {
      const values = new Set(members.map((m) => norm(m[field])));
      assert.equal(values.size, 1,
        `pair "${pairId}" varies "${axis}", so every member must share "${field}" — `
        + `found ${[...values].join(' vs ')}\n  members: ${members.map((m) => m.id).join(', ')}`);
    }
    const variedDiffers = varied.some((field) =>
      new Set(members.map((m) => norm(m[field]))).size > 1);
    assert.ok(variedDiffers,
      `pair "${pairId}" declares axis "${axis}" but no member differs in ${varied.join('/')} — `
      + 'the pair varies nothing and proves nothing');
  }

  // The corpus as a whole has to exercise more than one axis, or "pairing" has
  // quietly collapsed back into "two targets".
  const axes = new Set(manifest.scenarios.map((s) => s.variantAxis));
  assert.ok(axes.size >= 4,
    `the corpus exercises only ${[...axes].join(', ')} — style, map and role calibration need their own axes`);
});

// ---------------------------------------------------------------------------
// One test per scenario
// ---------------------------------------------------------------------------

for (const s of manifest.scenarios) {
  test(`scenario ${s.id} [${s.pairId}/${s.polarity}/${s.variantAxis}]`, () => {
    const res = runScenario(s);
    const { status, json } = res;
    const ctx = summarize(res);

    assert.equal(status, s.expect.exit, `${s.id}: exit ${status}, expected ${s.expect.exit}\n${ctx}`);
    assert.equal(json.ok, s.expect.hardPass, `${s.id}: hardPass ${json.ok}\n${ctx}`);

    for (const reason of s.expect.failReasons ?? []) {
      assert.ok(json.failReasons.includes(reason),
        `${s.id}: expected fail reason "${reason}"\n${ctx}`);
    }

    const codes = codesOf(json);
    for (const code of s.expect.requiredAdvisoryCodes) {
      assert.ok(codes.includes(code), `${s.id}: expected advisory "${code}"\n${ctx}`);
    }
    for (const code of s.expect.forbiddenAdvisoryCodes) {
      assert.ok(!codes.includes(code),
        `${s.id}: FALSE POSITIVE — "${code}" fired on writing that is idiomatic for ${s.style}\n${ctx}`);
    }

    // Declared ceilings are assertions, not hints.
    for (const [code, max] of Object.entries(s.expect.maximumAdvisoryCounts ?? {})) {
      const n = codes.filter((c) => c === code).length;
      assert.ok(n <= max, `${s.id}: "${code}" fired ${n} times, ceiling is ${max}\n${ctx}`);
    }

    // Evidence: a required advisory must show its work in the fields the
    // scenario says matter, not merely carry a non-empty object.
    for (const [code, fields] of Object.entries(s.expect.requiredDataFields ?? {})) {
      const found = Object.values(json.soft).flat().filter((a) => (a.code ?? a.type) === code);
      assert.ok(found.length > 0, `${s.id}: "${code}" did not fire, so its evidence cannot be checked\n${ctx}`);
      for (const field of fields) {
        assert.ok(found.some((a) => a.data && a.data[field] !== undefined),
          `${s.id}: no "${code}" advisory carries data.${field}\n`
          + `  data seen: ${JSON.stringify(found.map((a) => Object.keys(a.data ?? {})))}\n${ctx}`);
      }
    }

    // Anti-vacuity: prove the analyzer actually looked at something. A gate that
    // passes over zero events is not evidence of anything (AGENTS.md: "the hard
    // gates fail open by construction — 0/0 is a PASS").
    for (const [dotted, rule] of Object.entries(s.expect.requiredStats ?? {})) {
      const actual = readPath(json, dotted);
      assert.notEqual(actual, undefined, `${s.id}: no such stat "${dotted}" in the run JSON\n${ctx}`);
      if (rule.minimum !== undefined) {
        assert.ok(typeof actual === 'number' && actual >= rule.minimum,
          `${s.id}: ${dotted} = ${JSON.stringify(actual)}, expected >= ${rule.minimum}\n${ctx}`);
      }
      if (rule.maximum !== undefined) {
        assert.ok(typeof actual === 'number' && actual <= rule.maximum,
          `${s.id}: ${dotted} = ${JSON.stringify(actual)}, expected <= ${rule.maximum}\n${ctx}`);
      }
      if (rule.equals !== undefined) {
        assert.strictEqual(actual, rule.equals, `${s.id}: ${dotted}\n${ctx}`);
      }
      if (rule.equalsJson !== undefined) {
        assert.deepStrictEqual(actual, rule.equalsJson, `${s.id}: ${dotted}\n${ctx}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Calibration across the whole corpus
// ---------------------------------------------------------------------------

test('advisory budget: a valid arrangement stays readable by a human', () => {
  // "A good target is not zero warnings. It is few enough for a human to
  // review." A run that produces forty findings has produced none, because
  // nobody reads forty.
  for (const s of manifest.scenarios) {
    const budget = s.expect.maximumTotalAdvisories
      ?? (s.expect.hardPass ? DEFAULT_TOTAL_BUDGET : null);
    if (budget === null) continue;
    const res = runScenario(s);
    const n = codesOf(res.json).length;
    assert.ok(n <= budget,
      `${s.id}: ${n} soft findings exceeds the readable budget of ${budget}\n${summarize(res)}`);
  }
});

test('deduplication: no code repeats more than a handful of times in one run', () => {
  // One root problem must not become one finding per note. Every analyzer that
  // can repeat collapses into `data.occurrences`; this is the cross-cutting
  // assertion that none of them regressed.
  for (const s of manifest.scenarios) {
    const res = runScenario(s);
    for (const [code, n] of countsOf(res.json)) {
      if (PER_BAR_BY_CONTRACT.has(code)) continue;
      const ceiling = s.expect.maximumAdvisoryCounts?.[code] ?? DEFAULT_MAX_PER_CODE;
      assert.ok(n <= ceiling,
        `${s.id}: "${code}" fired ${n} times — one region-level finding should suffice\n${summarize(res)}`);
    }
  }
});

test('every advisory explains WHY, in data rather than only in prose', () => {
  for (const s of manifest.scenarios) {
    const res = runScenario(s);
    for (const [subsystem, list] of Object.entries(res.json.soft)) {
      if (subsystem === 'playability') continue;   // native pre-C3 shape, by contract
      for (const a of list) {
        assert.equal(typeof a.code, 'string', `${s.id}: advisory with no code\n${summarize(res)}`);
        assert.ok(a.data && typeof a.data === 'object',
          `${s.id}: ${a.code} carries no evidence object\n${summarize(res)}`);
        assert.ok(Object.keys(a.data).length > 0,
          `${s.id}: ${a.code} has an empty data object\n${summarize(res)}`);
      }
    }
  }
});

test('every scenario proves it analysed something (0/0 is not a pass)', () => {
  for (const s of manifest.scenarios) {
    const res = runScenario(s);
    const stats = res.json.hard.playability?.stats;
    assert.ok(stats, `${s.id}: playability did not report stats\n${summarize(res)}`);
    assert.ok(stats.notesAnalyzed > 0,
      `${s.id}: analysed 0 notes — the verdict is vacuous\n${summarize(res)}`);
    assert.ok(stats.beatsAnalyzed > 0,
      `${s.id}: analysed 0 beats — the verdict is vacuous\n${summarize(res)}`);
  }
});

test('changing the style changes the ADVICE and never the hard result', () => {
  // The invariant, checked on realistic material rather than on a synthetic
  // fixture. The baseline run is forced FRESH: reading it from the cache would
  // compare a stored result against itself.
  const s = manifest.scenarios.find((x) => x.id === 'jazz-flattened-negative');
  const results = ['hard-rock', 'metal', 'blues', 'jazz'].map((style) =>
    runScenario({ ...s, style }, { fresh: true }));
  const baseline = JSON.stringify(results[0].json.hard);
  for (const r of results) {
    assert.equal(JSON.stringify(r.json.hard), baseline,
      `hard results must not move with style\n${summarize(r)}`);
  }
  const advice = results.map((r) => codesOf(r.json).sort().join(','));
  assert.ok(new Set(advice).size > 1, 'but the advice must actually differ across styles');
});

test('solo is the DEFAULT: saying nothing and saying "solo" agree exactly', () => {
  // "Absence of role flags must not silently select dual mode." The dual fixture
  // is the sharpest test of it — it is the one score where a wrong default would
  // change the melodic verdict.
  const dual = manifest.scenarios.find((x) => x.id === 'role-aware-correct');
  const implicit = runScenario({ ...dual, arrangementMode: undefined, lead: undefined, rhythm: undefined });
  const explicit = runScenario({ ...dual, arrangementMode: 'solo', lead: undefined, rhythm: undefined });

  assert.equal(implicit.json.analyzers.roles.arrangementMode, 'solo',
    `no --arrangement-mode must resolve to solo\n${summarize(implicit)}`);
  assert.deepEqual(implicit.json.analyzers.roles, explicit.json.analyzers.roles,
    'implicit and explicit solo must resolve to the same roles');
  assert.equal(JSON.stringify(implicit.json.hard), JSON.stringify(explicit.json.hard),
    'implicit and explicit solo must produce the same hard result');
  assert.equal(codesOf(implicit.json).join(','), codesOf(explicit.json).join(','),
    'implicit and explicit solo must produce the same advice');
});

test('declaring dual roles does not disturb the solo result on the same score', () => {
  // Dual-guitar is opt-in (C9/A5). Opting in with the CORRECT roles must not
  // make a previously-passing score fail: roles narrow which track answers which
  // question, they do not add a gate.
  const dual = manifest.scenarios.find((x) => x.id === 'role-aware-correct');
  const solo = runScenario({ ...dual, arrangementMode: undefined, lead: undefined, rhythm: undefined });
  const explicit = runScenario(dual);

  assert.equal(solo.json.ok, true, `solo baseline must pass\n${summarize(solo)}`);
  assert.equal(explicit.json.ok, true, `correct dual roles must pass\n${summarize(explicit)}`);
  assert.deepEqual(solo.json.analyzers.roles.rhythm, [], 'solo declares no rhythm track');
  assert.deepEqual(explicit.json.analyzers.roles.rhythm, [1], 'dual declares track 1 as rhythm');
});

test('every scenario is deterministic across runs', () => {
  for (const s of manifest.scenarios) {
    // Both runs are FRESH on purpose: a cached second run would compare a string
    // to itself and pass on a nondeterministic tool.
    const a = JSON.stringify(runScenario(s, { fresh: true }).json);
    const b = JSON.stringify(runScenario(s, { fresh: true }).json);
    assert.equal(a, b, `${s.id}: two identical runs disagreed`);
  }
});

test('no scenario input is ever modified by being checked (C15)', () => {
  // Targets, sources AND maps: a gate that rewrote the map it was handed would
  // be just as wrong as one that rewrote the tab.
  //
  // The bytes were captured at module load, BEFORE any test ran, and this test
  // is registered last. So it does not check its own runs — it checks every run
  // the whole suite performed, which is a stronger claim than the re-run version
  // it replaced and costs nothing.
  assert.ok(INPUT_BYTES.size > 0, 'no scenario inputs were captured');
  for (const [p, bytes] of INPUT_BYTES) {
    assert.ok(bytes.equals(fs.readFileSync(p)), `${p} was modified by a gate run`);
  }
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
  // Cleanup runs after a pass, a failure, and a throw out of the loop itself —
  // a suite that only tidies up when it succeeds leaves its worst runs on disk.
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

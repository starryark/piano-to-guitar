import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTex, buildDigest } from './lib/analysis.mjs';
import { walkBeats, QUARTER_TICKS } from './lib/score-utils.mjs';
import { lockPlan, loadPlanLock, writeJson, readJson, hashObject, sha256, validatePlan } from './lib/generation-plan.mjs';
import { compileArrangementIR, validateArrangementIR, durationTicks } from './lib/arrangement-ir.mjs';
import { generateChunk, makeRequest, retrieveCraft, inspectCandidate, ROOT } from './lib/generation.mjs';
import { validateBenchmark } from './generation-benchmark.mjs';

const FIX = path.join(ROOT, 'tools/fixtures/generation');
const plan = readJson(path.join(FIX, 'plan.json'));
const ir = readJson(path.join(FIX, 'ir.json'));
const model = readJson(path.join(FIX, 'model.json'));
const digest = buildDigest(parseTex(fs.readFileSync(path.join(FIX, 'source.alphatab'), 'utf8')).score);
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-generation-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeJson(path.join(dir, 'plan.json'), plan);
  writeJson(path.join(dir, 'source.json'), digest);
  const lock = lockPlan(path.join(dir, 'plan.json'), path.join(dir, 'source.json'), 'Fixture approval for automated tests only');
  writeJson(path.join(dir, 'plan.lock.json'), lock);
  return { dir, lock };
}
function parsedEvents(tex) {
  const parsed = parseTex(tex);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const events = [];
  walkBeats(parsed.score, ({ beat, barIndex }) => events.push({ bar: barIndex + 1, ticks: beat.playbackDuration,
    pitches: beat.notes.map(n => n.realValue).sort((a, b) => a - b), beat }));
  return { score: parsed.score, events };
}

test('lock pins source, modes and approval; a recomputed replacement hash is not the approved hash', t => {
  const { dir, lock } = setup(t);
  assert.equal(loadPlanLock(path.join(dir, 'plan.lock.json'), lock.lockSha256).plan.transpose, 0);
  const tampered = structuredClone(lock);
  tampered.plan.sidecar.entries[0].mode = 'free';
  const { lockSha256, ...payload } = tampered;
  tampered.lockSha256 = hashObject(payload);
  writeJson(path.join(dir, 'tampered.json'), tampered);
  assert.throws(() => loadPlanLock(path.join(dir, 'tampered.json'), lockSha256), /hash mismatch/);
  assert.throws(() => lockPlan(path.join(dir, 'plan.json'), path.join(dir, 'source.json'), ''), /approval/);
});

test('plan rejects mode abuse, source gaps, noisy quotes and oversized chunks', () => {
  const p = structuredClone(plan);
  p.sidecar.entries[0].mode = 'free';
  assert.throws(() => validatePlan(p, digest), /sourceBars/);
  p.sidecar.entries[0].mode = 'quote';
  p.sidecar.entries[0].sourceBars = [200, 200];
  assert.throws(() => validatePlan(p, digest), /absent/);
  const d = structuredClone(digest); d.sourceProfile.kind = 'noisy-transcription';
  assert.throws(() => validatePlan(plan, d), /reviewed melody contract/);
  p.sidecar.entries[0].sourceBars = [1, 1];
  p.sidecar.entries[0].tabBars = [1, 9];
  p.bars = Array.from({ length: 9 }, (_, i) => ({ bar: i + 1, meter: [4, 4], tempo: 120 }));
  p.sidecar.entries = p.sidecar.entries.slice(0, 1);
  assert.throws(() => validatePlan(p, digest), /at most 8/);
});

test('compiler preserves exact pitches, attacks and durations and is deterministic', () => {
  const compiled = compileArrangementIR(ir, plan, plan.sidecar.entries[0]);
  assert.deepEqual(compiled, compileArrangementIR(ir, plan, plan.sidecar.entries[0]));
  const { events } = parsedEvents(compiled.alphatex);
  assert.deepEqual(events.map(e => e.pitches), ir.events.map(e => e.pitches));
  assert.deepEqual(events.map(e => e.ticks), [960, 960, 960, 960]);
  assert.equal(events.length, 4);
});

test('IR rejects schema drift, implicit gaps, zero attacks, unknown techniques and impossible pitches', () => {
  for (const [mutate, pattern] of [
    [x => { x.mode = 'free'; }, /unknown field mode/],
    [x => { x.tabBars = [1, 2]; }, /approved tabBars/],
    [x => { x.events[1].beat = 1.5; }, /overlap or gap/],
    [x => { x.events.forEach(e => { e.pitches = []; }); }, /zero attacks/],
    [x => { x.events[0].techniques = ['bend']; }, /unsupported/],
    [x => { x.events[0].pitches = [20]; }, /no legal voicing/],
  ]) {
    const value = structuredClone(ir); mutate(value);
    assert.throws(() => compileArrangementIR(value, plan, plan.sidecar.entries[0]), pattern);
  }
});

test('mixed meters, dotted rests, triplets, repeated attacks and note effects survive parsing', () => {
  const p = structuredClone(plan); p.bars[0].meter = [3, 4]; p.bars[1].meter = [5, 8]; p.bars[1].tempo = 92;
  const event = (bar, beat, value, dots, pitches, techniques = [], triplet = false) => ({ bar, beat, duration: { value, dots, triplet }, pitches, techniques });
  const x = { ...ir, tabBars: [1, 2], events: [
    event(1, 0, 8, 0, [64], [], true), event(1, 1 / 3, 8, 0, [64], [], true), event(1, 2 / 3, 8, 0, [67], ['vibrato'], true),
    event(1, 1, 4, 1, [], []), event(1, 2.5, 8, 0, [40, 47, 52], ['palm-mute']),
    event(2, 0, 4, 2, [67], ['accent']), event(2, 1.75, 8, 1, [69], ['staccato']),
  ] };
  const compiled = compileArrangementIR(x, p, { tabBars: [1, 2] });
  const parsed = parsedEvents(compiled.alphatex);
  assert.deepEqual(parsed.events.map(e => e.ticks), x.events.map(e => durationTicks(e.duration)));
  assert.deepEqual(parsed.events.map(e => e.pitches), x.events.map(e => e.pitches));
  assert.equal(parsed.score.masterBars[1].timeSignatureNumerator, 5);
  assert.equal(parsed.score.masterBars[1].timeSignatureDenominator, 8);
  assert.ok(parsed.events[2].beat.notes.every(n => n.vibrato !== 0));
  assert.ok(parsed.events[4].beat.notes.every(n => n.isPalmMute));
  assert.equal(parsed.events.reduce((s, e) => s + e.ticks, 0), 5.5 * QUARTER_TICKS);
});

test('raw baseline cannot change parsed tuning, tempo, bar count or track layout', t => {
  const { dir } = setup(t);
  const tex = compileArrangementIR(ir, plan, plan.sidecar.entries[0]).alphatex;
  const file = path.join(dir, 'candidate.alphatab');
  fs.writeFileSync(file, tex);
  inspectCandidate(file, plan, 1);
  for (const [altered, pattern] of [
    [tex.replaceAll('tempo 120', 'tempo 90'), /tempo/],
    [tex.replace('E4 B3 G3 D3 A2 E2', 'E4 B3 G3 D3 A2 D2'), /tuning/],
    [tex.replace(/[^\n]+ \|\n$/, 'r.1 |\n'), /zero attacks/],
    [tex.replace('\\ts (4 4)', '\\ac \\ts (4 4)'), /pickup/],
    [`${tex}r.1 |`, /bar count/],
    [`${tex}\\track "Other"\n\\staff {tabs}\nr.1 |`, /track layout/],
  ]) {
    fs.writeFileSync(file, altered);
    assert.throws(() => inspectCandidate(file, plan, 1), pattern);
  }
});

test('retrieval is deterministic and restricted to craft; prompt scopes source bars', t => {
  const { lock } = setup(t);
  assert.deepEqual(retrieveCraft('hard-rock palm mute'), retrieveCraft('hard-rock palm mute'));
  const { request } = makeRequest(lock, 0);
  assert.deepEqual(request.input.source.bars.map(b => b.bar), [1]);
  assert.ok(request.input.retrieval.documents.length > 0);
  assert.ok(request.input.retrieval.documents.every(d => d.id.startsWith('reference/') && !d.id.includes('case-canon')));
  assert.equal(makeRequest(lock, 0, { retrieval: false }).request.input.retrieval.documents.length, 0);
});

test('repair uses real gate evidence, snapshots provenance and requires approval before appending', async t => {
  const { dir, lock } = setup(t);
  const bad = structuredClone(ir); bad.events.forEach(e => { e.pitches = [65]; });
  let called = 0;
  const result = await generateChunk({ lock, entryIndex: 0, out: path.join(dir, 'run'), model, generate: async request => {
    if (called++) {
      assert.equal(request.input.previousFailure.stage, 'gate');
      assert.equal(request.input.previousFailure.report.ok, false);
      assert.equal(request.input.entry.mode, 'quote');
    }
    return { output: called === 1 ? bad : ir };
  } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(called, 2);
  const attempt = path.join(dir, 'run', result.attempt);
  const history = fs.readFileSync(path.join(attempt, 'history/log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(history.verdict, null);
  assert.ok(history.files.generation);
  assert.equal(readJson(path.join(attempt, 'history', history.files.generation)).model.modelId, model.modelId);
  assert.throws(() => makeRequest(lock, 1, { previous: path.join(dir, 'run') }), /lacks human APPROVED/);
  const verdict = spawnSync(process.execPath, [path.join(ROOT, 'tools/history.mjs'), 'verdict', 'APPROVED', '--project', attempt], { encoding: 'utf8' });
  assert.equal(verdict.status, 0, verdict.stderr);
  const nextIR = { ...ir, tabBars: [2, 2], events: ir.events.map((e, i) => ({ ...e, bar: 2, pitches: [[67], [69], [71], [67]][i] })) };
  const next = await generateChunk({ lock, entryIndex: 1, out: path.join(dir, 'next'), model, previous: path.join(dir, 'run'), generate: async () => ({ output: nextIR }) });
  assert.equal(next.ok, true, JSON.stringify(next));
  const prefix = fs.readFileSync(path.join(attempt, 'cover.alphatab'), 'utf8');
  assert.ok(fs.readFileSync(path.join(dir, 'next', next.attempt, 'cover.alphatab'), 'utf8').startsWith(prefix));
  fs.appendFileSync(path.join(attempt, 'cover.alphatab'), '// edit');
  assert.throws(() => makeRequest(lock, 1, { previous: path.join(dir, 'run') }), /changed after generation/);
});

test('compile failures exhaust at three attempts; never invoke the gate or overwrite a run', async t => {
  const { dir, lock } = setup(t);
  let calls = 0;
  const out = path.join(dir, 'run');
  const result = await generateChunk({ lock, entryIndex: 0, out, model, generate: async () => { calls++; return { output: { ...ir, mode: 'free' } }; } });
  assert.equal(result.exitCode, 1);
  assert.equal(calls, 3);
  assert.ok(result.attempts.every(a => a.stage === 'compile'));
  assert.ok(!fs.existsSync(path.join(out, 'attempt-1/history')));
  await assert.rejects(() => generateChunk({ lock, entryIndex: 0, out, model, generate: async () => ({ output: ir }) }), /EEXIST/);
});

test('adapter errors and timeouts are operational failures, never repair attempts', async t => {
  const { dir, lock } = setup(t);
  let calls = 0;
  await assert.rejects(() => generateChunk({ lock, entryIndex: 0, out: path.join(dir, 'error'), model, generate: async () => { calls++; throw new Error('offline'); } }), /offline/);
  assert.equal(calls, 1);
  assert.equal(readJson(path.join(dir, 'error/result.json')).exitCode, 2);
  await assert.rejects(() => generateChunk({ lock, entryIndex: 0, out: path.join(dir, 'timeout'), model, timeoutMs: 10, generate: async () => new Promise(() => {}) }), /timed out/);
  assert.equal(readJson(path.join(dir, 'timeout/result.json')).exitCode, 2);
});

test('history does not attribute hand edits to stale generation metadata', t => {
  const { dir } = setup(t);
  const tex = compileArrangementIR(ir, plan, plan.sidecar.entries[0]).alphatex;
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), tex);
  writeJson(path.join(dir, 'sidecar.json'), plan.sidecar);
  writeJson(path.join(dir, 'generation.json'), { coverSha256: sha256(tex), sidecarSha256: sha256(fs.readFileSync(path.join(dir, 'sidecar.json'))), model });
  const snap = () => spawnSync(process.execPath, [path.join(ROOT, 'tools/history.mjs'), 'snap', '--project', dir], { encoding: 'utf8' });
  assert.equal(snap().status, 0);
  fs.appendFileSync(path.join(dir, 'cover.alphatab'), '// manual edit\n');
  assert.equal(snap().status, 0);
  const history = fs.readFileSync(path.join(dir, 'history/log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(history[0].files.generation);
  assert.equal(history[1].files.generation, undefined);
});

test('benchmark rejects cross-composition leakage and unspecified rights', () => {
  const manifest = readJson(path.join(FIX, 'benchmark.json'));
  validateBenchmark(manifest);
  const leaked = structuredClone(manifest);
  leaked.cases[1].compositionId = leaked.cases[0].compositionId;
  leaked.cases[1].split = 'train';
  assert.throws(() => validateBenchmark(leaked), /composition leakage/);
  manifest.cases[0].rightsBasis = 'unrecorded';
  assert.throws(() => validateBenchmark(manifest), /original synthetic/);
});

test('CLI rejects missing metadata/unknown flags and writes an offline prompt without invoking a model', t => {
  const { dir, lock } = setup(t);
  const cli = args => spawnSync(process.execPath, [path.join(ROOT, 'tools/llm-arrange.mjs'), ...args], { encoding: 'utf8' });
  const flags = ['--lock', path.join(dir, 'plan.lock.json'), '--lock-sha256', lock.lockSha256, '--entry', '1'];
  const prompt = path.join(dir, 'request.json');
  assert.equal(cli(['prompt', ...flags, '--out', prompt]).status, 0);
  assert.equal(readJson(prompt).input.entry.mode, 'quote');
  assert.equal(cli(['run', ...flags, '--out', path.join(dir, 'missing-model')]).status, 2);
  assert.equal(cli(['prompt', ...flags, '--out', prompt, '--mode', 'free']).status, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'missing-model')));
});

test('target-space transposition passes the real gate and adapter mutations cannot weaken the plan', async t => {
  const { dir } = setup(t);
  const transposed = structuredClone(plan); transposed.transpose = 1;
  writeJson(path.join(dir, 'transposed-plan.json'), transposed);
  const lock = lockPlan(path.join(dir, 'transposed-plan.json'), path.join(dir, 'source.json'), 'Synthetic transpose test');
  const target = structuredClone(ir); target.events.forEach(e => { e.pitches = e.pitches.map(p => p + 1); });
  const result = await generateChunk({ lock, entryIndex: 0, out: path.join(dir, 'transpose'), model, maxRepairs: 0,
    generate: async request => { request.input.plan.sidecar.entries[0].mode = 'free'; return { output: target }; } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(readJson(path.join(dir, 'transpose', result.attempt, 'sidecar.json')).entries[0].mode, 'quote');
  assert.equal(lock.plan.sidecar.entries[0].mode, 'quote');
});

test('gate operational failures stop without consuming musical repair budget', async t => {
  const { dir, lock } = setup(t);
  lock.policy = { unknownPolicyKey: true };
  const { lockSha256, ...payload } = lock;
  lock.lockSha256 = hashObject(payload);
  let calls = 0;
  await assert.rejects(() => generateChunk({ lock, entryIndex: 0, out: path.join(dir, 'bad-policy'), model,
    generate: async () => { calls++; return { output: ir }; } }), /gate operational failure/);
  assert.equal(calls, 1);
  assert.equal(readJson(path.join(dir, 'bad-policy/result.json')).exitCode, 2);
});

test('CLI replay completes offline and binds model provenance to the passing snapshot', t => {
  const { dir, lock } = setup(t);
  writeJson(path.join(dir, 'responses.json'), [{ output: ir }]);
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools/llm-arrange.mjs'), 'run',
    '--lock', path.join(dir, 'plan.lock.json'), '--lock-sha256', lock.lockSha256, '--entry', '1',
    '--model', path.join(FIX, 'model.json'), '--responses', path.join(dir, 'responses.json'),
    '--max-repairs', '0', '--out', path.join(dir, 'cli-run')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.humanVerdict, 'PENDING');
  const provenance = readJson(path.join(dir, 'cli-run', result.attempt, 'generation.json'));
  assert.equal(provenance.adapter.kind, 'replay');
  assert.equal(provenance.lockSha256, lock.lockSha256);
  assert.equal(provenance.model.modelId, model.modelId);
});

test('run freezes effective config and rejects style profile drift before generation', async t => {
  const { dir, lock } = setup(t);
  writeJson(path.join(dir, 'config.json'), { unexpectedAncestorKey: true });
  const result = await generateChunk({ lock, entryIndex: 0, out: path.join(dir, 'isolated'), model, maxRepairs: 0,
    generate: async () => ({ output: ir }) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const frozen = readJson(path.join(dir, 'isolated', result.attempt, 'config.json'));
  assert.equal(frozen.arrangementMode, 'solo');
  assert.deepEqual(frozen.tracks, { lead: [0], rhythm: [] });
  lock.styleProfile = structuredClone(lock.styleProfile);
  lock.styleProfile.idiom.warnBelow += 1;
  const { lockSha256, ...payload } = lock; lock.lockSha256 = hashObject(payload);
  assert.throws(() => makeRequest(lock, 0), /style profile changed/);
});

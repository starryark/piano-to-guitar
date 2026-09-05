import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTex } from './score-utils.mjs';
import { compileArrangementIR, ARRANGEMENT_IR_SCHEMA, durationTicks } from './arrangement-ir.mjs';
import { canonical, hashObject, sha256, readJson, writeJson, keys, requireThat, materializeLock } from './generation-plan.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROMPT_VERSION = 'ptg-arranger-v1';
const PROMPT = fs.readFileSync(path.join(ROOT, 'prompts/arranger-v1.md'), 'utf8');
const CRAFT = ['reference/piano-to-guitar-arranging.md', 'reference/electric-guitar-voice.md',
  'reference/rock-riff-construction.md', 'reference/guitar-fretboard.md', 'reference/guitar-playability.md'];

// Deterministic, heading-level lexical retrieval; no network, embeddings, song
// corpus, project history, or filesystem-wide indexing.
export function retrieveCraft(query, limit = 3) {
  const words = new Set(query.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const docs = [];
  for (const file of CRAFT) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    const sections = text.split(/(?=^#{1,4} )/m);
    sections.forEach((section, i) => {
      const heading = section.split('\n')[0];
      const score = [...words].reduce((s, w) => s + (heading.toLowerCase().includes(w) ? 4 : 0) + (section.toLowerCase().includes(w) ? 1 : 0), 0);
      if (score) docs.push({ id: `${file}#${i}`, heading, score, text: section.slice(0, 3500), documentSha256: sha256(text) });
    });
  }
  docs.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return { corpusRevision: hashObject(CRAFT.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')) }))), documents: docs.slice(0, limit) };
}

export function validateModelMetadata(model) {
  keys(model, ['provider', 'modelId', 'modelRevision', 'tokenizerRevision', 'sampling'], 'model');
  for (const k of ['provider', 'modelId', 'modelRevision', 'tokenizerRevision']) requireThat(typeof model[k] === 'string' && model[k].trim(), `model.${k} required (use unsupported/unrecorded explicitly)`);
  keys(model.sampling, ['temperature', 'topP', 'seed'], 'model.sampling');
  for (const k of ['temperature', 'topP', 'seed']) {
    const v = model.sampling[k];
    requireThat(['unsupported', 'unrecorded'].includes(v) || (typeof v === 'number' && Number.isFinite(v)), `sampling.${k} must be numeric, unsupported or unrecorded`);
    if (typeof v === 'number') requireThat(k === 'seed' ? Number.isSafeInteger(v) : v >= 0 && (k !== 'topP' || v <= 1), `invalid sampling.${k}`);
  }
  return model;
}

export function codeProvenance() {
  const files = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name.endsWith('.mjs')) files.push({ file: path.relative(ROOT, file).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(file)) });
    }
  }
  visit(path.join(ROOT, 'tools'));
  const git = args => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const commit = git(['rev-parse', 'HEAD']), dirty = git(['status', '--porcelain', '--untracked-files=no']);
  return { node: process.version, platform: process.platform, arch: process.arch,
    gateCodeCommit: commit.status === 0 ? commit.stdout.trim() : 'unavailable',
    trackedWorktreeDirty: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : 'unavailable',
    codeTreeSha256: hashObject(files), codeFiles: files,
    packageLockSha256: sha256(fs.readFileSync(path.join(ROOT, 'package-lock.json'))),
    alphaTabVersion: readJson(path.join(ROOT, 'node_modules/@coderline/alphatab/package.json')).version };
}

function previousApproved(previous, lock, entryIndex) {
  if (entryIndex === 0) { requireThat(!previous, 'first entry cannot have a previous run'); return null; }
  requireThat(previous, 'later entries require --previous with an APPROVED generation run');
  const result = readJson(path.join(previous, 'result.json'));
  requireThat(result.ok && result.lockSha256 === lock.lockSha256 && result.entryIndex === entryIndex - 1, 'previous run must pass with the same plan and preceding entry');
  requireThat(/^attempt-\d+$/.test(result.attempt), 'invalid previous attempt path');
  const dir = path.join(previous, result.attempt);
  const log = fs.readFileSync(path.join(dir, 'history/log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const latest = log.at(-1);
  requireThat(latest?.verdict === 'APPROVED' && latest.gate?.ok, 'previous chunk lacks human APPROVED verdict on a passing history version');
  const alphatex = fs.readFileSync(path.join(dir, 'cover.alphatab'), 'utf8');
  requireThat(sha256(alphatex) === result.coverSha256, 'previous candidate changed after generation');
  const snapshot = fs.readFileSync(path.join(dir, 'history', latest.files.cover), 'utf8');
  requireThat(snapshot === alphatex, 'previous human approval does not match the current candidate');
  requireThat(sha256(fs.readFileSync(path.join(dir, 'sidecar.json'))) === result.sidecarSha256, 'previous correspondence changed');
  requireThat(latest.files.sidecar && sha256(fs.readFileSync(path.join(dir, 'history', latest.files.sidecar))) === result.sidecarSha256, 'previous approval used a different correspondence map');
  return { run: path.resolve(previous), coverSha256: result.coverSha256, historySeq: latest.seq, alphatex };
}

export function makeRequest(lock, entryIndex, { format = 'ir', previous = null, retrieval = true } = {}) {
  const { lockSha256, ...payload } = lock;
  requireThat(hashObject(payload) === lockSha256, 'approved plan lock hash mismatch');
  requireThat(['ir', 'alphatex'].includes(format), 'format must be ir or alphatex');
  requireThat(Number.isInteger(entryIndex) && entryIndex >= 0 && entryIndex < lock.plan.sidecar.entries.length, 'entry index is outside the plan');
  // Reuse the gate's contract file resolution without writing into the project.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-plan-'));
  let normalized;
  try { normalized = materializeLock(lock, scratch); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  const entry = normalized.entries[entryIndex];
  const prior = previousApproved(previous, lock, entryIndex);
  const sourceBars = entry.sourceBars ? lock.digest.bars.filter(b => b.bar >= entry.sourceBars[0] && b.bar <= entry.sourceBars[1]) : [];
  const craft = retrieveCraft(`${lock.plan.style} ${lock.plan.gain} ${lock.plan.groove} ${entry.note}`, retrieval ? 3 : 0);
  const request = { promptVersion: PROMPT_VERSION, system: PROMPT, format,
    schema: format === 'ir' ? ARRANGEMENT_IR_SCHEMA : null,
    input: { lockSha256: lock.lockSha256, plan: lock.plan, entry,
      source: { key: lock.digest.key, sourceProfile: lock.digest.sourceProfile, bars: sourceBars },
      melodyContract: lock.contract, guitarPolicy: lock.policy, styleProfile: lock.styleProfile,
      priorApproved: prior, nextEntry: normalized.entries[entryIndex + 1] ?? null,
      retrieval: craft, previousFailure: null } };
  return { request, entry, prior };
}

// Check the PARSED score against parameters the fidelity gate does not enforce.
// Raw AlphaTex is an experimental baseline, never a route around the plan lock.
export function inspectCandidate(file, plan, endBar, firstBar = 1) {
  const parsed = loadTex(file);
  requireThat(parsed.ok, `candidate syntax: ${JSON.stringify(parsed.errors)}`);
  const score = parsed.score;
  requireThat(score.tracks.length === 1 && score.tracks[0].staves.length === 1, 'candidate changed the solo track layout');
  const staff = score.tracks[0].staves[0];
  requireThat(canonical(staff.stringTuning?.tunings) === canonical(plan.tuning), 'candidate changed tuning');
  // alphaTab defaults guitar notation to display -12; it does not change sound.
  requireThat(!staff.capo && !staff.transpositionPitch && staff.displayTranspositionPitch === -12, 'candidate added capo/transposition');
  const program = plan.gain === 'high' ? 30 : plan.gain === 'crunch' ? 29 : 27;
  requireThat(score.tracks[0].playbackInfo.program === program, 'candidate changed the approved guitar program');
  requireThat(score.masterBars.length === endBar && staff.bars.length === endBar, 'candidate changed approved bar count');
  let tempo = score.tempo, attacks = 0;
  score.masterBars.forEach((mb, i) => {
    const b = plan.bars[i];
    requireThat(mb.timeSignatureNumerator === b.meter[0] && mb.timeSignatureDenominator === b.meter[1], `bar ${i + 1}: candidate changed meter`);
    requireThat(!mb.isRepeatStart && !mb.repeatCount && !mb.alternateEndings, 'candidate introduced repeats');
    requireThat(!mb.isAnacrusis && !mb.directions?.size, 'candidate introduced a pickup or navigation outside the plan');
    for (const a of mb.tempoAutomations ?? []) {
      requireThat((a.ratioPosition ?? 0) === 0 && a.value === b.tempo, `bar ${i + 1}: candidate changed tempo`);
      tempo = a.value;
    }
    requireThat(tempo === b.tempo, `bar ${i + 1}: candidate changed tempo`);
    requireThat(staff.bars[i].voices.length === 1, 'candidate added a rhythmic voice');
    if (i + 1 >= firstBar) for (const beat of staff.bars[i].voices[0].beats) {
      if (beat.notes.some(n => !n.isTieDestination)) attacks++;
    }
  });
  requireThat(attacks > 0, 'candidate chunk has zero attacks');
  return score;
}

function auditCompilation(score, ir) {
  const staff = score.tracks[0].staves[0];
  for (let bar = ir.tabBars[0]; bar <= ir.tabBars[1]; bar++) {
    const expected = ir.events.filter(e => e.bar === bar);
    const actual = staff.bars[bar - 1].voices[0].beats;
    requireThat(expected.length === actual.length, `compiler event-count mismatch at bar ${bar}`);
    expected.forEach((e, i) => {
      const beat = actual[i];
      const pitches = beat.notes.map(n => n.realValue).sort((a, b) => a - b);
      requireThat(canonical(pitches) === canonical([...e.pitches].sort((a, b) => a - b)), `compiler pitch mismatch at bar ${bar}, event ${i}`);
      requireThat(beat.playbackDuration === durationTicks(e.duration), `compiler duration mismatch at bar ${bar}, event ${i}`);
      requireThat(beat.notes.every(n => !n.isTieDestination), 'compiler converted an attack into a continuation');
      for (const n of beat.notes) {
        if (e.techniques.includes('palm-mute')) requireThat(n.isPalmMute, 'compiler lost palm mute');
        if (e.techniques.includes('vibrato')) requireThat(n.vibrato !== 0, 'compiler lost vibrato');
        if (e.techniques.includes('staccato')) requireThat(n.isStaccato, 'compiler lost staccato');
        if (e.techniques.includes('accent')) requireThat(n.accentuated !== 0, 'compiler lost accent');
      }
    });
  }
}

function tool(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('gate tool timed out')); }, 120000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function withTimeout(generate, request, context, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => generate(structuredClone(request), { ...context, signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('adapter timed out')); }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function generateChunk({ lock, entryIndex, out, model, generate, adapter = { kind: 'injected' },
  format = 'ir', previous = null, retrieval = true, maxRepairs = 2, timeoutMs = 120000, onProgress = () => {} }) {
  validateModelMetadata(model);
  requireThat(Number.isInteger(maxRepairs) && maxRepairs >= 0 && maxRepairs <= 2, 'maxRepairs must be 0..2 (workflow: at most three attempts)');
  requireThat(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 3600000, 'timeoutMs must be 1..3600000');
  const { request, entry, prior } = makeRequest(lock, entryIndex, { format, previous, retrieval });
  out = path.resolve(out);
  fs.mkdirSync(out); // exclusive: an existing run is never overwritten
  writeJson(path.join(out, 'plan.lock.json'), lock);
  const runtime = codeProvenance();
  writeJson(path.join(out, 'runtime.json'), runtime);
  let feedback = null;
  const attempts = [];
  try {
    for (let attempt = 0; attempt <= maxRepairs; attempt++) {
      const name = `attempt-${attempt + 1}`, dir = path.join(out, name);
      fs.mkdirSync(dir);
      const { plan } = materializeLock(lock, dir);
      const sidecar = { ...plan.sidecar, entries: plan.sidecar.entries.slice(0, entryIndex + 1) };
      writeJson(path.join(dir, 'sidecar.json'), sidecar);
      const currentRequest = { ...request, model, input: { ...request.input, previousFailure: feedback } };
      writeJson(path.join(dir, 'request.json'), currentRequest);
      const manifest = { schemaVersion: 1, model, adapter, promptVersion: PROMPT_VERSION,
        promptSha256: hashObject(currentRequest), systemPromptSha256: sha256(PROMPT),
        irSchemaVersion: format === 'ir' ? '1.0' : 'not-applicable', format,
        lockSha256: lock.lockSha256, sourceDigestSha256: lock.sourceDigestSha256,
        frozenDigestSha256: hashObject(lock.digest), retrievalCorpusRevision: request.input.retrieval.corpusRevision,
        retrievedDocuments: request.input.retrieval.documents.map(({ id, documentSha256 }) => ({ id, documentSha256 })),
        runtimeSha256: hashObject(runtime), priorApprovedSha256: prior?.coverSha256 ?? null,
        attempt, entryIndex, humanVerdict: 'PENDING', startedAt: new Date().toISOString() };
      onProgress({ attempt: attempt + 1, phase: 'generate' });
      let response;
      try {
        response = await withTimeout(generate, currentRequest, { attempt }, timeoutMs);
        keys(response, ['output', 'usage', 'requestId'], 'adapter response');
        requireThat(typeof response.output === 'string' || (format === 'ir' && response.output && typeof response.output === 'object'), 'adapter response.output must be text or IR');
        writeJson(path.join(dir, 'response.json'), response);
        manifest.responseSha256 = hashObject(response);
        manifest.usage = response.usage ?? 'unrecorded';
        manifest.requestId = response.requestId ?? 'unsupported';
      } catch (e) {
        manifest.operationalError = e.message;
        writeJson(path.join(dir, 'generation.json'), manifest);
        writeJson(path.join(out, 'result.json'), { ok: false, exitCode: 2, lockSha256: lock.lockSha256, entryIndex, attempts, error: e.message });
        throw e; // adapter/IO failures are never musical repair feedback
      }
      let alphatex, ir = null;
      try {
        if (format === 'ir') {
          ir = typeof response.output === 'string' ? JSON.parse(response.output) : response.output;
          writeJson(path.join(dir, 'arrangement.json'), ir);
          const compiled = compileArrangementIR(ir, plan, entry, prior?.alphatex ?? '');
          alphatex = compiled.alphatex;
          writeJson(path.join(dir, 'fingering.json'), compiled.positions);
        } else {
          alphatex = response.output;
          requireThat(!prior || alphatex.startsWith(prior.alphatex), 'raw output rewrote approved prefix');
        }
        fs.writeFileSync(path.join(dir, 'cover.alphatab'), alphatex, { flag: 'wx' });
        const score = inspectCandidate(path.join(dir, 'cover.alphatab'), plan, entry.tabBars[1], entry.tabBars[0]);
        if (ir) auditCompilation(score, ir);
      } catch (e) {
        if (e.code) throw e; // filesystem failures are operational, not musical
        feedback = { stage: 'compile', errors: [{ code: 'generation.invalid-candidate', message: e.message }] };
        manifest.compileFailure = feedback;
        writeJson(path.join(dir, 'generation.json'), manifest);
        writeJson(path.join(dir, 'feedback.json'), feedback);
        attempts.push({ attempt: name, stage: 'compile', ok: false });
        continue;
      }
      manifest.coverSha256 = sha256(alphatex);
      manifest.sidecarSha256 = sha256(fs.readFileSync(path.join(dir, 'sidecar.json')));
      writeJson(path.join(dir, 'generation.json'), manifest);
      onProgress({ attempt: attempt + 1, phase: 'gate' });
      const args = [path.join(ROOT, 'tools/history.mjs'), 'check', 'cover.alphatab', '--map', 'sidecar.json',
        '--digest', 'source.json', '--bars', `1-${entry.tabBars[1]}`, '--transpose', String(plan.transpose),
        '--style', plan.style, '--gain', plan.gain, '--max-fret', String(plan.maxFret), '--arrangement-mode', 'solo', '--lead', '0'];
      if (lock.policy) args.push('--policy', 'guitar-policy.json');
      // Mandatory parsed-effects inspection; keep the evidence even if the gate fails.
      const events = await tool([path.join(ROOT, 'tools/tab-events.mjs'), 'cover.alphatab', '--json'], dir);
      if (events.code !== 0) throw new Error(`event inspector failed: ${events.stderr}`);
      writeJson(path.join(dir, 'events.json'), JSON.parse(events.stdout));
      const gate = await tool(args, dir);
      fs.writeFileSync(path.join(dir, 'gate.txt'), gate.stdout + gate.stderr, { flag: 'wx' });
      if (![0, 1].includes(gate.code)) {
        writeJson(path.join(out, 'result.json'), { ok: false, exitCode: 2, entryIndex, lockSha256: lock.lockSha256, attempts, error: 'gate operational failure' });
        throw new Error(`gate operational failure: ${gate.stderr || gate.stdout}`);
      }
      const history = fs.readFileSync(path.join(dir, 'history/log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
      const report = readJson(path.join(dir, 'history', history.files.report));
      requireThat(report.ok === (gate.code === 0), 'gate exit/report disagreement');
      attempts.push({ attempt: name, stage: 'gate', ok: report.ok, failReasons: report.failReasons });
      if (report.ok) {
        const result = { ok: true, exitCode: 0, lockSha256: lock.lockSha256, entryIndex, attempt: name,
          coverSha256: manifest.coverSha256, sidecarSha256: manifest.sidecarSha256, attempts, humanVerdict: 'PENDING' };
        writeJson(path.join(out, 'result.json'), result);
        return result;
      }
      feedback = { stage: 'gate', report };
      writeJson(path.join(dir, 'feedback.json'), feedback);
    }
    const result = { ok: false, exitCode: 1, lockSha256: lock.lockSha256, entryIndex, attempts, lastFailure: feedback, humanVerdict: 'PENDING' };
    writeJson(path.join(out, 'result.json'), result);
    return result;
  } catch (e) {
    if (!fs.existsSync(path.join(out, 'result.json'))) writeJson(path.join(out, 'result.json'), {
      ok: false, exitCode: 2, lockSha256: lock.lockSha256, entryIndex, attempts, error: e.message,
    });
    throw e;
  }
}

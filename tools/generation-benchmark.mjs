#!/usr/bin/env node
// CPU/offline by default. --adapter + --model opt into actual model experiments.
// No human preferences or quality improvements are inferred from machine PASS.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { emit, emitErr } from './lib/emit.mjs';
import { parseTex, buildDigest } from './lib/analysis.mjs';
import { compileArrangementIR } from './lib/arrangement-ir.mjs';
import { readJson, writeJson, lockPlan, requireThat, hashObject, sha256 } from './lib/generation-plan.mjs';
import { generateChunk, ROOT } from './lib/generation.mjs';

export function validateBenchmark(manifest) {
  requireThat(manifest?.schemaVersion === 1 && Array.isArray(manifest.cases) && manifest.cases.length > 0, 'benchmark needs nonempty version-1 cases');
  const ids = new Set(), splits = new Map();
  for (const c of manifest.cases) {
    requireThat(typeof c.id === 'string' && /^[a-z0-9-]+$/.test(c.id) && !ids.has(c.id), 'benchmark case IDs must be unique path-safe strings');
    ids.add(c.id);
    requireThat(typeof c.compositionId === 'string' && c.compositionId.trim(), 'composition identity required');
    requireThat(['train', 'validation', 'test'].includes(c.split), 'invalid composition split');
    requireThat(!splits.has(c.compositionId) || splits.get(c.compositionId) === c.split, 'composition leakage across splits');
    splits.set(c.compositionId, c.split);
    requireThat(c.rightsBasis === 'original-synthetic-exercise', 'this shipped benchmark only admits its original synthetic exercises');
    for (const field of ['source', 'plan', 'ir']) requireThat(typeof c[field] === 'string' && /^[a-z0-9-]+\.(alphatab|json)$/.test(c[field]), `invalid fixture ${field}`);
    requireThat(c.source.endsWith('.alphatab') && c.plan.endsWith('.json') && c.ir.endsWith('.json'), 'benchmark source must remain AlphaTex');
  }
  return manifest;
}

export async function benchmark({ out, adapterFile = null, modelFile = null, onProgress = () => {} }) {
  const fixtureDir = path.join(ROOT, 'tools/fixtures/generation');
  const manifest = validateBenchmark(readJson(path.join(fixtureDir, 'benchmark.json')));
  requireThat(Boolean(adapterFile) === Boolean(modelFile), 'supply --adapter and --model together');
  const model = readJson(modelFile ?? path.join(fixtureDir, 'model.json'));
  let external;
  if (adapterFile) {
    requireThat(adapterFile.endsWith('.mjs'), 'adapter must be .mjs');
    external = (await import(pathToFileURL(path.resolve(adapterFile)).href)).generate;
    requireThat(typeof external === 'function', 'adapter must export generate');
  }
  fs.mkdirSync(out);
  const rows = [];
  const fixtureHashes = manifest.cases.map(c => ({ id: c.id, source: sha256(fs.readFileSync(path.join(fixtureDir, c.source))),
    plan: sha256(fs.readFileSync(path.join(fixtureDir, c.plan))), ir: sha256(fs.readFileSync(path.join(fixtureDir, c.ir))) }));
  for (const c of manifest.cases.filter(c => c.split === 'test')) {
    const source = parseTex(fs.readFileSync(path.join(fixtureDir, c.source), 'utf8'));
    requireThat(source.ok, 'benchmark source failed parsing');
    const digestPath = path.join(out, `${c.id}.source.json`);
    writeJson(digestPath, buildDigest(source.score));
    const lock = lockPlan(path.join(fixtureDir, c.plan), digestPath, 'Synthetic benchmark plan; no real arrangement approval claimed');
    const ir = readJson(path.join(fixtureDir, c.ir));
    for (const variant of [{ id: 'raw', format: 'alphatex', retrieval: false }, { id: 'ir', format: 'ir', retrieval: false }, { id: 'ir-craft', format: 'ir', retrieval: true }]) {
      onProgress({ case: c.id, variant: variant.id });
      const output = variant.format === 'ir' ? ir : compileArrangementIR(ir, lock.plan, lock.plan.sidecar.entries[0]).alphatex;
      const result = await generateChunk({ lock, entryIndex: 0, out: path.join(out, `${c.id}-${variant.id}`), model,
        generate: external ?? (async () => ({ output })), format: variant.format, retrieval: variant.retrieval,
        adapter: external ? { kind: 'module', sha256: sha256(fs.readFileSync(adapterFile)) } : { kind: 'scripted-benchmark' } });
      rows.push({ case: c.id, compositionId: c.compositionId, split: c.split, variant: variant.id, ok: result.ok,
        attempts: result.attempts, humanVerdict: 'NOT_MEASURED', humanMinutesToApproval: null });
    }
  }
  requireThat(rows.length > 0, 'benchmark has zero test cases');
  const variants = ['raw', 'ir', 'ir-craft'].map(variant => {
    const selected = rows.filter(r => r.variant === variant);
    return { variant, total: selected.length, hardPassAfterRepairs: [0, 1, 2].map(repairs => ({ repairs,
      passed: selected.filter(r => r.attempts.some((a, i) => a.ok && i <= repairs)).length })) };
  });
  const report = { schemaVersion: 1, kind: external ? 'model-experiment' : 'scripted-pipeline-smoke',
    manifestSha256: hashObject(manifest), corpusSha256: hashObject(fixtureHashes), fixtureHashes,
    model, variants, rows, musicalQuality: 'NOT_MEASURED',
    caveat: 'Scripted outputs test plumbing only. The raw scripted candidate is compiler-produced. Model comparisons require --adapter and --model; blinded human evaluation remains separate.' };
  writeJson(path.join(out, 'benchmark-report.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    while (args.length) {
      const key = args.shift();
      requireThat(['--out', '--adapter', '--model'].includes(key) && args.length && !args[0].startsWith('--') && !options[key], 'Usage: node tools/generation-benchmark.mjs --out NEW_DIR [--adapter adapter.mjs --model model.json]');
      options[key] = args.shift();
    }
    requireThat(options['--out'], '--out is required and must not exist');
    const report = await benchmark({ out: path.resolve(options['--out']), adapterFile: options['--adapter'], modelFile: options['--model'],
      onProgress: r => emitErr(`benchmark: ${r.case} / ${r.variant}`) });
    emit(JSON.stringify({ kind: report.kind, variants: report.variants, musicalQuality: report.musicalQuality }, null, 2));
    process.exitCode = report.rows.every(r => r.ok) ? 0 : 1;
  } catch (e) { emitErr(`benchmark: ${e.message}`); process.exitCode = 2; }
}

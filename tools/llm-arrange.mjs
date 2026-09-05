#!/usr/bin/env node
// Optional, provider-neutral generation CLI. No API calls occur unless an
// explicitly selected local adapter implements them; response replay is offline.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { emit, emitErr } from './lib/emit.mjs';
import { lockPlan, loadPlanLock, readJson, writeJson, requireThat, sha256 } from './lib/generation-plan.mjs';
import { makeRequest, generateChunk, validateModelMetadata } from './lib/generation.mjs';

const usage = `Usage:
  node tools/llm-arrange.mjs lock --plan plan.json --digest source.json --approval "human Gate A decision" --out plan.lock.json [--policy guitar-policy.json]
  node tools/llm-arrange.mjs prompt --lock plan.lock.json --lock-sha256 HASH --entry 1 --out request.json [--model model.json] [--format ir|alphatex] [--previous RUN] [--no-retrieval]
  node tools/llm-arrange.mjs run --lock plan.lock.json --lock-sha256 HASH --entry 1 --out NEW_RUN_DIR --model model.json (--responses responses.json | --adapter adapter.mjs) [--format ir|alphatex] [--previous RUN] [--max-repairs 2] [--timeout-ms 120000] [--no-retrieval]
Exit: 0 lock/prompt written or machine PASS (human verdict PENDING); 1 attempts exhausted; 2 usage/IO/adapter/gate operational failure.`;

function parse(argv) {
  const command = argv.shift();
  const allowed = {
    lock: ['plan', 'digest', 'approval', 'out', 'policy'],
    prompt: ['lock', 'lock-sha256', 'entry', 'out', 'model', 'format', 'previous', 'no-retrieval'],
    run: ['lock', 'lock-sha256', 'entry', 'out', 'model', 'responses', 'adapter', 'format', 'previous', 'max-repairs', 'timeout-ms', 'no-retrieval'],
  };
  requireThat(allowed[command], usage);
  const options = {};
  while (argv.length) {
    const flag = argv.shift();
    requireThat(flag.startsWith('--') && allowed[command].includes(flag.slice(2)), `unknown flag ${flag}\n${usage}`);
    const key = flag.slice(2);
    requireThat(!(key in options), `duplicate ${flag}`);
    if (key === 'no-retrieval') options[key] = true;
    else {
      requireThat(argv.length && !argv[0].startsWith('--'), `missing value for ${flag}`);
      options[key] = argv.shift();
    }
  }
  requireThat(options.out, '--out is required');
  return { command, options };
}

try {
  if (process.argv.includes('--help')) { emit(usage); process.exit(0); }
  const { command, options: o } = parse(process.argv.slice(2));
  if (command === 'lock') {
    requireThat(o.plan && o.digest && o.approval, 'lock requires --plan, --digest and --approval');
    const lock = lockPlan(path.resolve(o.plan), path.resolve(o.digest), o.approval, o.policy ? path.resolve(o.policy) : null);
    writeJson(o.out, lock);
    emit(`Plan locked: ${o.out}\n--lock-sha256 ${lock.lockSha256}`);
  } else {
    requireThat(o.lock && o['lock-sha256'] && o.entry, '--lock, --lock-sha256 and --entry are required');
    const lock = loadPlanLock(o.lock, o['lock-sha256']);
    const common = { format: o.format ?? 'ir', previous: o.previous ?? null, retrieval: !o['no-retrieval'] };
    const entryIndex = Number(o.entry) - 1;
    if (command === 'prompt') {
      const { request } = makeRequest(lock, entryIndex, common);
      if (o.model) request.model = validateModelMetadata(readJson(o.model));
      writeJson(o.out, request);
      emit(`Prompt written: ${o.out}`);
    } else {
      requireThat(o.model, '--model is required; record unsupported/unrecorded metadata explicitly');
      requireThat(Boolean(o.responses) !== Boolean(o.adapter), 'select exactly one of --responses or --adapter');
      let generate, adapter;
      if (o.responses) {
        const responses = readJson(o.responses);
        requireThat(Array.isArray(responses) && responses.length > 0, '--responses must contain an array of {output, usage?, requestId?}');
        generate = async (_request, { attempt }) => {
          requireThat(attempt < responses.length, 'response replay exhausted; supply the next response or lower --max-repairs');
          return responses[attempt];
        };
        adapter = { kind: 'replay', sha256: sha256(fs.readFileSync(o.responses)) };
      } else {
        const file = path.resolve(o.adapter);
        requireThat(file.endsWith('.mjs'), '--adapter must name a local ESM .mjs file');
        const module = await import(pathToFileURL(file).href);
        requireThat(typeof module.generate === 'function', 'adapter must export async generate(request, {attempt, signal})');
        generate = module.generate;
        adapter = { kind: 'module', file, sha256: sha256(fs.readFileSync(file)) };
      }
      const result = await generateChunk({ lock, entryIndex, out: o.out, model: readJson(o.model), generate, adapter, ...common,
        maxRepairs: Number(o['max-repairs'] ?? 2), timeoutMs: Number(o['timeout-ms'] ?? 120000),
        onProgress: ({ attempt, phase }) => emitErr(`arrange: attempt ${attempt}: ${phase}`) });
      emit(JSON.stringify(result, null, 2));
      process.exitCode = result.exitCode;
    }
  }
} catch (e) {
  emitErr(`arrange: ${e.message}`);
  process.exitCode = 2;
}

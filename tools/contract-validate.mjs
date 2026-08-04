#!/usr/bin/env node
// tools/contract-validate.mjs — melody-contract validator (PTG-native,
// Improve_Plan §4.3).
//
//   node tools/contract-validate.mjs <melody-contract.json>
//        [--digest <source.json>] [--json]
//
// FAILS (exit 1) on: contradictory obligations, nonexistent source bars,
// impossible pitches under the declared relocation, invalid duration policies,
// relocation groups cutting through a phrase without justification, required
// events whose only source evidence is a tied continuation, and vacuous
// contracts (zero obligations anywhere, or a phrase protecting nothing).
//
// --digest enables the source-evidence checks (bar existence, attack vs tied
// continuation). Without it those checks are SKIPPED and reported as such —
// run with the digest before trusting a PASS.
//
// Exit: 0 valid, 1 invalid, 2 usage/IO.

import * as fs from 'node:fs';
import { loadContract, validateContract } from './lib/contract.mjs';
import { emit, emitErr } from './lib/emit.mjs';

function parseArgs(argv) {
  let digest = null;
  let json = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--digest') digest = argv[++i];
    else if (a.startsWith('--digest=')) digest = a.slice('--digest='.length);
    else if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      emitErr(`Unknown flag: ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  return { file: positional[0] ?? null, digest, json };
}

const { file, digest: digestPath, json } = parseArgs(process.argv.slice(2));
if (!file) {
  emitErr('Usage: node tools/contract-validate.mjs <melody-contract.json> [--digest <source.json>] [--json]');
  process.exit(2);
}

const loaded = loadContract(file);
if (!loaded.ok) {
  emitErr(loaded.errors[0].message);
  process.exit(2);
}

let digest = null;
if (digestPath) {
  try {
    digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
  } catch (e) {
    emitErr(`Cannot read digest "${digestPath}": ${e.message}`);
    process.exit(2);
  }
}

const result = validateContract(loaded.contract, digest);

if (json) {
  emit(JSON.stringify({ ok: result.ok, file, digest: digestPath, ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const L = [];
L.push(`CONTRACT  ${file}`);
if (result.stats) {
  const s = result.stats;
  L.push(`  phrases ${s.phrases}  |  required events ${s.requiredEvents}  |  `
    + `duration obligations ${s.durationObligations}  |  required gaps ${s.requiredGaps}  |  `
    + `relocation groups ${s.relocationGroups}  |  forbidden rules ${s.forbiddenRules}`);
}
L.push(digest
  ? `  source evidence checked against ${digestPath}`
  : '  !! no --digest given: bar existence and attack-evidence checks SKIPPED');
for (const e of result.errors) L.push(`  ERROR  ${e.where}: ${e.message}`);
for (const w of result.warnings) L.push(`  warn   ${w.where}: ${w.message}`);
L.push('');
L.push(result.ok ? 'CONTRACT: VALID' : `CONTRACT: INVALID — ${result.errors.length} error(s)`);
emit(L.join('\n'));
process.exit(result.ok ? 0 : 1);

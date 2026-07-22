#!/usr/bin/env node
// tools/piano-extract.mjs — piano AlphaTex source -> per-bar musical digest.
//
//   node tools/piano-extract.mjs <file.alphatab> [more.alphatab ...] [--out <dir>]
//
// Writes analysis/<stem>.json (the DIGEST — the contract tools/compare.mjs
// consumes) and analysis/<stem>-map.md (the human-readable bar map you read
// instead of the raw source). `--out <dir>` puts the pair somewhere else, so a
// fixture run never lands in the user's analysis/.
//
// Exit: 0 clean, 1 any failure, 2 usage.
//
// This replaces abc-to-guitar's `python tools/abc-extract.py`. Nothing about
// ABC survives: no abcjs, no abc2xml, no Python, no MusicXML. The musical
// analysis is ported into tools/lib/analysis.mjs (see its header for the
// function-by-function provenance); this file is only the CLI around it.
//
// CONTRACT (build plan §2.5). compare.mjs exits 2 if a referenced source bar
// is missing `melodySkeleton` or `harmony`, and its hard gates are
// `covered === total` — trivially TRUE at total 0. A digest that silently drops
// a field would therefore report PASS while protecting nothing, so this tool
// prints the per-bar coverage of both fields on every run and warns loudly if
// either is short. A suspiciously clean 0/0 is a failure, not a success.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { extractDigest, renderMap } from './lib/analysis.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const ANALYSIS_DIR = path.join(PROJECT_ROOT, 'analysis');

const USAGE = 'Usage: node tools/piano-extract.mjs <file.alphatab> [more...] [--out <dir>]';

function parseArgs(args) {
  let outDir = ANALYSIS_DIR;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg.startsWith('--out=')) {
      const value = arg === '--out' ? (args[++i] ?? '') : arg.slice('--out='.length);
      if (!value) {
        console.error('!! --out requires a directory');
        return null;
      }
      outDir = value;
    } else if (arg.startsWith('--')) {
      // Never silently treat an unknown flag as an input path — that would
      // report "not found: --bogus" and hide the real mistake.
      console.error(`!! unknown flag: ${arg}`);
      return null;
    } else {
      files.push(arg);
    }
  }
  return { outDir, files };
}

function display(p) {
  const rel = path.relative(PROJECT_ROOT, p);
  return rel.startsWith('..') ? p : rel.split(path.sep).join('/');
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) process.exit(2);
if (!parsed.files.length) {
  console.error(USAGE);
  process.exit(2);
}

const outDir = path.resolve(parsed.outDir);
fs.mkdirSync(outDir, { recursive: true });

let rc = 0;
for (const arg of parsed.files) {
  const file = path.resolve(arg);
  if (!fs.existsSync(file)) {
    console.error(`!! not found: ${file}`);
    rc = 1;
    continue;
  }
  let digest;
  let preferFlat;
  let normalizer;
  try {
    ({ digest, preferFlat, normalizer } = await extractDigest(file));
  } catch (e) {
    console.error(`!! failed on ${file}: ${e.message}`);
    for (const d of (e.diagnostics || []).slice(0, 8)) {
      console.error(`   ${d.severity} ${d.code ?? ''} line ${d.line ?? '?'}: ${d.message}`);
    }
    rc = 1;
    continue;
  }

  const stem = path.basename(file).replace(/\.[^.]+$/, '');
  const jsonPath = path.join(outDir, `${stem}.json`);
  const mapPath = path.join(outDir, `${stem}-map.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mapPath, renderMap(digest, preferFlat), 'utf8');

  const total = digest.bars.length;
  const skel = digest.bars.filter((b) => (b.melodySkeleton || []).length).length;
  const root = digest.bars.filter((b) => b.harmony && b.harmony.root).length;
  console.log(
    `${path.basename(file)}: ${total} bars -> ${display(jsonPath)}, ${display(mapPath)}`);
  console.log(
    `   key ${digest.key} (declared ${digest.keyDeclared}${digest.keyDisagrees ? ' — DISAGREES, not trusted' : ''})`
    + `  |  meter ${digest.meterInitial}  |  tempo ${digest.tempoInitial}`);
  console.log(`   melodySkeleton: ${skel}/${total} bars   harmony.root: ${root}/${total} bars`);
  if (normalizer && normalizer.available) {
    console.log(`   source normalizer: applied — ${normalizer.rewrites} rewrite(s), `
      + `${normalizer.skipped} skipped  |  encoding ${normalizer.encoding}`);
  } else {
    console.log('   source normalizer: tools/lib/piano-source.mjs not present — raw text parsed');
  }
  if (total === 0 || skel === 0 || root === 0) {
    console.error('!! VACUOUS DIGEST: a gate-critical field is empty across the whole score. '
      + 'compare.mjs would report a fail-open PASS on this. Refusing to call it a success.');
    rc = 1;
  } else if (skel < total || root < total) {
    console.error(`!! ${total - skel} bar(s) without a melodySkeleton and ${total - root} without a `
      + 'harmony.root. Those bars are unprotected by the fidelity gate — check the bar map.');
  }
}

process.exit(rc);

#!/usr/bin/env node
// tools/piano-extract.mjs — piano AlphaTex source -> per-bar musical digest.
//
//   node tools/piano-extract.mjs <file.alphatab> [more.alphatab ...] [--out <dir>]
//   node tools/piano-extract.mjs --manifest <source-set.json> --out <dir>
//
// Writes analysis/<stem>.json (the DIGEST — the contract tools/compare.mjs
// consumes) and analysis/<stem>-map.md (the human-readable bar map you read
// instead of the raw source). `--out <dir>` puts the pair somewhere else, so a
// fixture run never lands in the user's analysis/.
//
// MULTI-SOURCE INGEST (Improve_Plan §1.3): --manifest names a source-set file
//   { "sources": [ { "file": "Piano_only.alphatab", "role": "pitched-reference",
//                    "weight": 1 }, … ] }
// Each source (resolved relative to the manifest) is extracted exactly like a
// positional file, and a `source-set.report.json` is written next to the
// digests recording file → digest → role/weight, so downstream cross-source
// analysis (tools/foreground.mjs) knows what to agree or disagree about.
// Disagreement between sources is DATA to surface, never resolved silently.
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
import { emit, emitErr } from './lib/emit.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const ANALYSIS_DIR = path.join(PROJECT_ROOT, 'analysis');

const USAGE = 'Usage: node tools/piano-extract.mjs <file.alphatab> [more...] [--out <dir>]\n'
  + '       node tools/piano-extract.mjs --manifest <source-set.json> --out <dir>';

function parseArgs(args) {
  let outDir = ANALYSIS_DIR;
  let manifest = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg.startsWith('--out=')) {
      const value = arg === '--out' ? (args[++i] ?? '') : arg.slice('--out='.length);
      if (!value) {
        emitErr('!! --out requires a directory');
        return null;
      }
      outDir = value;
    } else if (arg === '--manifest' || arg.startsWith('--manifest=')) {
      const value = arg === '--manifest' ? (args[++i] ?? '') : arg.slice('--manifest='.length);
      if (!value) {
        emitErr('!! --manifest requires a file');
        return null;
      }
      manifest = value;
    } else if (arg.startsWith('--')) {
      // Never silently treat an unknown flag as an input path — that would
      // report "not found: --bogus" and hide the real mistake.
      emitErr(`!! unknown flag: ${arg}`);
      return null;
    } else {
      files.push(arg);
    }
  }
  return { outDir, files, manifest };
}

/** Load + fail-closed-validate a source-set manifest. Returns normalized
 *  entries [{ file (absolute), role, weight }] or null (error reported). */
function loadManifest(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    emitErr(`!! manifest unreadable: ${e.message}`);
    return null;
  }
  if (!parsed || !Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    emitErr('!! manifest must carry a non-empty "sources" array');
    return null;
  }
  const baseDir = path.dirname(path.resolve(manifestPath));
  const out = [];
  for (let i = 0; i < parsed.sources.length; i++) {
    const s = parsed.sources[i];
    if (!s || typeof s !== 'object' || typeof s.file !== 'string' || !s.file) {
      emitErr(`!! manifest source ${i} missing "file"`);
      return null;
    }
    out.push({
      file: path.resolve(baseDir, s.file),
      role: typeof s.role === 'string' ? s.role : 'pitched-reference',
      weight: Number.isFinite(s.weight) ? s.weight : 1,
    });
  }
  return out;
}

function display(p) {
  const rel = path.relative(PROJECT_ROOT, p);
  return rel.startsWith('..') ? p : rel.split(path.sep).join('/');
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) process.exit(2);

// --manifest expands into the same per-file loop as positional args; role and
// weight are recorded for the report written after the loop.
let manifestEntries = null;
if (parsed.manifest) {
  manifestEntries = loadManifest(parsed.manifest);
  if (!manifestEntries) process.exit(2);
  parsed.files.push(...manifestEntries.map((e) => e.file));
}
if (!parsed.files.length) {
  emitErr(USAGE);
  process.exit(2);
}

const outDir = path.resolve(parsed.outDir);
fs.mkdirSync(outDir, { recursive: true });

const reportEntries = [];
let rc = 0;
for (const arg of parsed.files) {
  const file = path.resolve(arg);
  if (!fs.existsSync(file)) {
    emitErr(`!! not found: ${file}`);
    rc = 1;
    continue;
  }
  let digest;
  let preferFlat;
  let normalizer;
  try {
    ({ digest, preferFlat, normalizer } = await extractDigest(file));
  } catch (e) {
    emitErr(`!! failed on ${file}: ${e.message}`);
    for (const d of (e.diagnostics || []).slice(0, 8)) {
      emitErr(`   ${d.severity} ${d.code ?? ''} line ${d.line ?? '?'}: ${d.message}`);
    }
    rc = 1;
    continue;
  }

  const stem = path.basename(file).replace(/\.[^.]+$/, '');
  const jsonPath = path.join(outDir, `${stem}.json`);
  const mapPath = path.join(outDir, `${stem}-map.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mapPath, renderMap(digest, preferFlat), 'utf8');

  const manifestEntry = manifestEntries?.find((e) => e.file === file);
  reportEntries.push({
    file: path.basename(file),
    digest: path.basename(jsonPath),
    role: manifestEntry?.role ?? null,
    weight: manifestEntry?.weight ?? null,
    bars: digest.bars.length,
    key: digest.key,
    sourceKind: digest.sourceProfile?.kind ?? null,
  });

  const total = digest.bars.length;
  const skel = digest.bars.filter((b) => (b.melodySkeleton || []).length).length;
  const root = digest.bars.filter((b) => b.harmony && b.harmony.root).length;
  emit(
    `${path.basename(file)}: ${total} bars -> ${display(jsonPath)}, ${display(mapPath)}`);
  emit(
    `   key ${digest.key} (declared ${digest.keyDeclared}${digest.keyDisagrees ? ' — DISAGREES, not trusted' : ''})`
    + `  |  meter ${digest.meterInitial}  |  tempo ${digest.tempoInitial}`);
  emit(`   melodySkeleton: ${skel}/${total} bars   harmony.root: ${root}/${total} bars`);
  if (normalizer && normalizer.available) {
    emit(`   source normalizer: applied — ${normalizer.rewrites} rewrite(s), `
      + `${normalizer.skipped} skipped  |  encoding ${normalizer.encoding}`);
  } else {
    emit('   source normalizer: tools/lib/piano-source.mjs not present — raw text parsed');
  }
  if (total === 0 || skel === 0 || root === 0) {
    emitErr('!! VACUOUS DIGEST: a gate-critical field is empty across the whole score. '
      + 'compare.mjs would report a fail-open PASS on this. Refusing to call it a success.');
    rc = 1;
  } else if (skel < total || root < total) {
    emitErr(`!! ${total - skel} bar(s) without a melodySkeleton and ${total - root} without a `
      + 'harmony.root. Those bars are unprotected by the fidelity gate — check the bar map.');
  }
}

// Manifest runs additionally record what was extracted and under which role,
// so cross-source analysis has a machine-readable set to consume.
if (manifestEntries && rc === 0) {
  const reportPath = path.join(outDir, 'source-set.report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({
    manifest: path.basename(parsed.manifest),
    sources: reportEntries,
  }, null, 2)}\n`, 'utf8');
  emit(`source set: ${reportEntries.length} source(s) -> ${display(reportPath)}`);
}

process.exit(rc);

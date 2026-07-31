#!/usr/bin/env node
// tools/foreground.mjs — perceptual-foreground candidates from a digest
// (PTG-native, Improve_Plan §3).
//
//   node tools/foreground.mjs <digest.json> [more-digests.json ...]
//        [--out <dir>] [--bars N-M] [--json]
//
// Reads the digest's per-bar `foregroundEvidence` attack graph and writes
//   <out>/foreground.json      the candidate lines + classifications
//   <out>/foreground-map.md    the human-readable Gate A review map
// Additional digests are treated as INDEPENDENT TRANSCRIPTIONS OF THE SAME
// PIECE (e.g. Basic Pitch run on a piano-only mix and on the full mix):
// agreement between them raises candidate confidence; disagreement stays
// visible as a warning — it is never silently resolved.
//
// The default --out is the first digest's directory (the project folder).
// --json additionally prints the document to stdout.
//
// Exit: 0 ok, 1 unusable digest, 2 usage.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildForeground, renderForegroundMap } from './lib/foreground.mjs';

function parseArgs(argv) {
  let out = null;
  let bars = null;
  let json = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a.startsWith('--out=')) out = a.slice('--out='.length);
    else if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  return { digests: positional, out, bars, json };
}

const { digests: digestPaths, out, bars, json } = parseArgs(process.argv.slice(2));
if (!digestPaths.length) {
  console.error('Usage: node tools/foreground.mjs <digest.json> [more...] [--out <dir>] [--bars N-M] [--json]');
  process.exit(2);
}

let range = null;
if (bars !== null) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(bars).trim());
  if (!m) {
    console.error(`Bad --bars "${bars}"; expected N or N-M`);
    process.exit(2);
  }
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  range = { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

const loaded = digestPaths.map((p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`Cannot read digest "${p}": ${e.message}`);
    process.exit(2);
  }
});

const [primary, ...others] = loaded;
if (!Array.isArray(primary.bars)) {
  console.error(`Digest "${digestPaths[0]}" has no bars[] — re-run piano-extract.`);
  process.exit(1);
}
if (!primary.bars.some((b) => (b.foregroundEvidence || []).length)) {
  console.error(`Digest "${digestPaths[0]}" carries no foregroundEvidence — it predates `
    + 'the attack-graph extractor. Re-run: node tools/piano-extract.mjs <source>');
  process.exit(1);
}

const doc = buildForeground(primary, {
  others,
  barLo: range?.lo,
  barHi: range?.hi,
});

const outDir = path.resolve(out ?? path.dirname(path.resolve(digestPaths[0])));
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'foreground.json');
const mapPath = path.join(outDir, 'foreground-map.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
fs.writeFileSync(mapPath, renderForegroundMap(doc), 'utf8');

if (json) console.log(JSON.stringify(doc, null, 2));
else {
  console.log(`${primary.song}: ${doc.summary.bars} bar(s) analyzed -> ${jsonPath}, ${mapPath}`);
  console.log(`   cross-sources: ${others.length}  |  ambiguous bars: `
    + `${doc.summary.ambiguousBars.length}${doc.summary.ambiguousBars.length
      ? ` (${doc.summary.ambiguousBars.slice(0, 12).join(', ')}${doc.summary.ambiguousBars.length > 12 ? ', …' : ''})`
      : ''}`);
  if (doc.summary.ambiguousBars.length) {
    console.log('   review the ambiguous bars in foreground-map.md before locking a melody contract.');
  }
}
process.exit(0);

// tools/sidecar-audit.mjs — read a correspondence map as a whole, as a CLI.
// PTG-native (Wave 4). Every metric definition lives in tools/lib/sidecar-audit.mjs
// (contract C10 + addendum §A4.1) and every sidecar semantic in tools/lib/sidecar.mjs
// (contract C8); this file is argument parsing and formatting.
//
// Usage:
//   node tools/sidecar-audit.mjs --digest source.json --map sidecar.json
//        [--bars N-M] [--style NAME] [--contract melody-contract.json] [--json]
//
// WHAT IT ANSWERS
// ---------------
// compare.mjs grades each span against what the sidecar declared. This tool asks
// the question nobody was asking: taken as a whole, how much of this arrangement
// is tied to the source at all, which source material has anything protecting
// it, and is any of it being counted twice?
//
// EXIT CONTRACT (C2) — SOFT-ONLY:
//   0 = ran to completion. Advisories may be present; they are NOT failures.
//   2 = usage / unreadable input / an invalid sidecar or digest.
//   1 = never. A high free share is a question, not a defect, and a sidecar the
//       gate would refuse is an exit-2 input problem, not a musical verdict.
//
// It reuses the GATE's own sidecar validator, deliberately. Two copies of a
// fail-closed validator drift, and the drift is invisible: an audit would happily
// report on a map compare.mjs refuses to run.

import * as fs from 'node:fs';
import { loadSidecar, validateSidecar } from './lib/sidecar.mjs';
import { loadStyleProfile } from './lib/style-profile.mjs';
import { resolveConfig } from './lib/project-config.mjs';
import { auditSidecar } from './lib/sidecar-audit.mjs';
import { emit, emitErr } from './lib/emit.mjs';

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let digest = null;
  let map = null;
  let bars = null;
  let style;                 // §A1: undefined = "not set on the CLI"
  let contract = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--digest') digest = argv[++i];
    else if (a.startsWith('--digest=')) digest = a.slice('--digest='.length);
    else if (a === '--map') map = argv[++i];
    else if (a.startsWith('--map=')) map = a.slice('--map='.length);
    else if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--style') style = argv[++i];
    else if (a.startsWith('--style=')) style = a.slice('--style='.length);
    else if (a === '--contract') contract = argv[++i];
    else if (a.startsWith('--contract=')) contract = a.slice('--contract='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) {
      // Positional convenience: `sidecar-audit.mjs source.json sidecar.json`.
      if (digest === null) digest = a;
      else if (map === null) map = a;
    }
  }
  return { digest, map, bars, style, contract, json };
}

const USAGE = 'Usage: node tools/sidecar-audit.mjs --digest <source.json> --map <sidecar.json> '
  + '[--bars N-M] [--style hard-rock|metal|blues|jazz] [--contract <melody-contract.json>] [--json]';

const { digest: digestPath, map: mapPath, bars, style: styleArg, contract: contractArg, json }
  = parseArgs(process.argv.slice(2));

/** Every failure route out of this tool is exit 2 (C2). */
function fail(...messages) {
  if (json) emit(JSON.stringify({ ok: false, errors: messages }, null, 2));
  for (const m of messages) emitErr(m);
  if (!json) emitErr(USAGE);
  process.exit(2);
}

if (!digestPath) fail('No digest given (--digest <source.json>).');
if (!mapPath) fail('No sidecar given (--map <sidecar.json>).');

/** Parse "9-16" | "12" -> {lo, hi}, or null for "every mapped bar". */
function parseBarRange(spec) {
  if (!spec) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(spec).trim());
  if (!m) fail(`Bad --bars "${spec}"; expected N or N-M`);
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}
const cliRange = parseBarRange(bars);

// ---- style (contracts C5/C6, addendum §A1) ---------------------------------
// Anchored on the sidecar, so `projects/<slug>/config.json` is found the same
// way every other tool finds it.
const stage1 = resolveConfig({ anchorPath: mapPath, cli: { style: styleArg } });
if (!stage1.ok) fail(...stage1.errors);
const loadedStyle = loadStyleProfile(stage1.style);
if (!loadedStyle.ok) fail(...loadedStyle.errors);
const profile = loadedStyle.profile;
const config = resolveConfig({ anchorPath: mapPath, cli: { style: styleArg }, styleProfile: profile });
if (!config.ok) fail(...config.errors);

// ---- inputs ----------------------------------------------------------------
let digest;
try {
  digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
} catch (e) {
  fail(`Cannot read digest "${digestPath}": ${e.message}`);
}
if (!digest || !Array.isArray(digest.bars)) {
  fail(`Digest "${digestPath}" has no bars[] — run tools/piano-extract.mjs to regenerate it.`);
}
const digestByBar = new Map(digest.bars.map((b) => [b.bar, b]));

const loadedMap = loadSidecar(mapPath);
if (!loadedMap.ok) fail(`sidecar: ${loadedMap.errors[0].message}`);

// The audit's default window is every bar the sidecar covers — the map itself,
// audited whole. `validateSidecar` requires a range because the GATE requires
// full coverage of the bars it grades; handing it the map's own span asks
// exactly the question it can answer without inventing a stricter one.
const declared = loadedMap.data.entries
  .map((e) => e?.tabBars)
  .filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]));
const fullSpan = declared.length
  ? { lo: Math.min(...declared.map((r) => r[0])), hi: Math.max(...declared.map((r) => r[1])) }
  : { lo: 1, hi: 1 };
const range = cliRange ?? fullSpan;

const validated = validateSidecar(loadedMap.data, {
  range,
  digestByBar,
  digest,
  contractArg,
  mapPath,
});
if (!validated.ok) fail(`sidecar: ${validated.errors[0].message}`);

// ---- audit -----------------------------------------------------------------
let result;
try {
  result = auditSidecar({ entries: validated.entries, digest, range, profile });
} catch (e) {
  fail(`sidecar audit failed: ${e.message}`);
}

const out = {
  ok: true,                     // soft-only: there is no hard gate here to fail
  digest: digestPath,
  map: mapPath,
  song: validated.song ?? digest.song ?? null,
  bars: bars ?? null,
  style: profile.name,
  styleSource: config.sources.style,
  metrics: result.metrics,
  stats: result.stats,
  advisories: result.advisories,
};

if (json) {
  emit(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ---- human-readable report -------------------------------------------------
const L = [];
const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const list = (span) => (span.count === 0 ? '—'
  : `${span.count}  [${span.ranges.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(', ')}]`);

const t = result.metrics.tabSpace;
const s = result.metrics.sourceSpace;
const m = result.metrics.melodySkeletonSpace;

L.push(`SIDECAR AUDIT  ${mapPath}`);
L.push(`               digest ${digestPath}   bars ${range.lo}-${range.hi}`
  + `   style ${profile.name} (${config.sources.style})`);
L.push(`               ${result.stats.entriesInRange} of ${result.stats.entries} entr(y|ies) in range`);
L.push('');

L.push(`  TAB SPACE      (denominator: ${t.totalTabBars} mapped tab bar(s) in range)`);
L.push(`    quote            ${String(t.quoteTabBars).padStart(4)}`);
L.push(`    recompose        ${String(t.recomposeTabBars).padStart(4)}`);
L.push(`    contract         ${String(t.contractTabBars).padStart(4)}`);
L.push(`    free             ${String(t.freeTabBars).padStart(4)}   (${pct(t.freeTabBarShare)} of the range)`);
L.push('');

L.push(`  SOURCE SPACE   (denominator: ${s.digestBars} digest bar(s))`);
L.push(`    protected by quote/contract   ${list(s.sourceBarsByQuote)}`);
L.push(`    only under recompose          ${list(s.sourceBarsByRecompose)}`);
L.push(`    never referenced              ${list(s.sourceBarsUnreferenced)}`);
L.push(`    referenced more than once     ${list(s.sourceBarsMultiplyReferenced)}`);
if (s.sourceBarsMultiplyReferenced.count) {
  const shown = s.sourceBarsMultiplyReferenced.counts.slice(0, 8)
    .map((c) => `bar ${c.bar}×${c.references}`).join(', ');
  const more = s.sourceBarsMultiplyReferenced.counts.length > 8
    ? ` (+${s.sourceBarsMultiplyReferenced.counts.length - 8} more)` : '';
  L.push(`      ${shown}${more}`);
  L.push('      A bar used twice is ONE bar of coverage, counted once above.');
}
L.push('');

L.push(`  MELODY SKELETON  (denominator: ${m.total} skeleton note(s) in the digest)`);
L.push(`    covered by quote/contract     ${m.coveredByQuote}  (${pct(m.coveredByQuoteShare)})`);
L.push(`    only under recompose          ${m.coveredOnlyByRecompose}`);
L.push(`    unreferenced                  ${m.unreferenced}`);
L.push('    There is no "free" row here on purpose: a free span has no source');
L.push('    correspondence to state, so no source note can be classified by one.');

if (result.advisories.length) {
  L.push('');
  L.push('SOFT ADVISORIES');
  L.push('---------------');
  L.push(`  sidecar       (${result.advisories.length})`);
  for (const a of result.advisories) L.push(`    ~ [${a.code}] ${a.message}`);
  L.push('');
  L.push('NOTE  This tool never gates. The map above is one compare.mjs accepts; everything');
  L.push('      here is a question about proportion, and a cover that adds an intro, a solo');
  L.push('      and an outro is supposed to have a high free share.');
}

emit(L.join('\n'));
process.exit(0);

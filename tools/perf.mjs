// perf.mjs — stage timings over the scale fixture.
// Run: npm run perf      [--repeat N] [--json]
// Exit: 0 measured, 2 usage/IO. It has no opinion, so it has no failure code.
//
// WHY THIS IS A REPORT AND NOT A TEST
// -----------------------------------
// Plan.md §10.4 asks for six measurements: parse time, fingering time, idiom
// extraction time, map comparison time, sidecar audit time, and complete
// check.mjs time. It does NOT ask for a time budget, and it should not: a
// wall-clock assertion inside `npm test` fails on a loaded CI runner and passes
// on a quiet laptop, which trains a reader to ignore it.
//
// The measured shape of this toolchain makes that concrete. Analysis is cheap
// and process startup is not — over the same 200-bar tab, widening the analysis
// window 8× (bars 1-25 → 1-200) moved the full gate by under 20%. A timing
// assertion here would mostly be measuring how busy the machine is.
//
// So the DETERMINISTIC scaling claims live in tools/scale.test.mjs, which
// asserts on counts and bytes and never on a clock; this file reports the
// numbers a human needs to notice a real regression, and
// docs/specs/wave6-performance.md records what they were when measured.
//
// Report min AND median: min is the machine's honest floor for the work, and a
// median far above it means the run was contended rather than slow.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSource } from './fixtures/scale/generate.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const SCALE = path.join(TOOLS, 'fixtures', 'scale');
const OUT = path.join(ROOT, 'out', 'perf');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const repeatAt = argv.indexOf('--repeat');
const REPEAT = repeatAt === -1 ? 5 : Number(argv[repeatAt + 1]);

const usage = (why) => {
  process.stderr.write(`${why}\nusage: node tools/perf.mjs [--repeat N] [--json]\n`);
  process.exit(2);
};
// Fail closed on anything unrecognised, like every other CLI here: a typo'd flag
// that is silently ignored produces a report of the wrong thing.
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') continue;
  if (argv[i] === '--repeat') { i++; continue; }
  usage(`unknown argument: ${argv[i]}`);
}
if (!Number.isInteger(REPEAT) || REPEAT < 1) usage(`--repeat needs a positive integer, got ${argv[repeatAt + 1]}`);
for (const f of ['source.alphatab', 'cover.alphatab', 'sidecar.json']) {
  if (!fs.existsSync(path.join(SCALE, f))) {
    process.stderr.write(`missing scale fixture ${f}; run: node tools/fixtures/scale/generate.mjs\n`);
    process.exit(2);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const tool = (n) => path.join(TOOLS, n);
const fix = (n) => path.join(SCALE, n);

/** One timed subprocess run. Returns elapsed ms; throws on a nonzero exit so a
 *  broken command is never reported as a fast one. */
function once(args, { allowExit = [0] } = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!allowExit.includes(r.status)) {
    throw new Error(`node ${args.map((a) => path.relative(ROOT, a) || a).join(' ')}\n`
      + `  exit ${r.status}\n  ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  }
  return { ms, stdout: r.stdout };
}

function measure(label, args, opts) {
  const samples = [];
  let stdout = '';
  for (let i = 0; i < REPEAT; i++) {
    const r = once(args, opts);
    samples.push(r.ms);
    stdout = r.stdout;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    label,
    runs: REPEAT,
    min: +sorted[0].toFixed(1),
    median: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
    stdout,
  };
}

// ---------------------------------------------------------------------------
// Setup: the digest every downstream stage consumes.
// ---------------------------------------------------------------------------
once([tool('piano-extract.mjs'), fix('source.alphatab'), '--out', OUT]);
const digest = path.join(OUT, 'source.json');

const BARS = ['--bars', '1-200'];
const ROLES = ['--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1'];
const MAP = ['--map', fix('sidecar.json')];

// `node -e ''` is the floor every row above it includes. Without it a reader
// cannot tell a slow analyzer from six fast ones behind six interpreter starts.
const stages = [
  measure('node startup (baseline)', ['-e', '']),
  measure('piano-extract (parse + digest)', [tool('piano-extract.mjs'), fix('source.alphatab'), '--out', OUT]),
  measure('validate --strict', [tool('validate.mjs'), '--strict', fix('cover.alphatab')]),
  measure('playability', [tool('playability.mjs'), fix('cover.alphatab'), ...BARS, '--json']),
  measure('compare (map mode)', [tool('compare.mjs'), fix('cover.alphatab'), digest, ...BARS, ...MAP, ...ROLES, '--json']),
  measure('fingering', [tool('fingering.mjs'), fix('cover.alphatab'), ...BARS, '--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1', '--json']),
  measure('idiom', [tool('idiom.mjs'), fix('cover.alphatab'), ...BARS, '--json']),
  measure('sidecar-audit', [tool('sidecar-audit.mjs'), '--digest', digest, ...MAP, ...BARS, '--json']),
  measure('check.mjs (the full gate)', [tool('check.mjs'), fix('cover.alphatab'), ...MAP, ...BARS, '--digest', digest, ...ROLES, '--json']),
];

const startup = stages[0].min;
const full = stages.at(-1);
// Every stage inside check.mjs is a subprocess, so the gate pays one interpreter
// start and one re-parse per stage. Naming that overhead is the point: it is the
// single largest number in the table, and it is architectural, not accidental.
const inGate = stages.slice(2, -1);
const sumOfStages = +inGate.reduce((a, s) => a + s.min, 0).toFixed(1);

// ---------------------------------------------------------------------------
// Digest growth — the retention question, measured in bytes rather than seconds.
// ---------------------------------------------------------------------------
const growth = [];
for (const bars of [24, 48, 96, 192]) {
  const f = path.join(OUT, `growth-${bars}.alphatab`);
  fs.writeFileSync(f, buildSource(bars), 'utf8');
  once([tool('piano-extract.mjs'), f, '--out', OUT]);
  const bytes = fs.statSync(path.join(OUT, `growth-${bars}.json`)).size;
  const d = JSON.parse(fs.readFileSync(path.join(OUT, `growth-${bars}.json`), 'utf8'));
  const notes = d.bars.reduce((a, b) => a + b.voices.reduce((n, v) => n + v.notes.length, 0), 0);
  growth.push({ bars, bytes, notes, bytesPerBar: Math.round(bytes / bars), bytesPerNote: Math.round(bytes / notes) });
}

const idiomStats = JSON.parse(stages.find((s) => s.label === 'idiom').stdout).stats;
const playStats = JSON.parse(stages.find((s) => s.label === 'playability').stdout).stats;

const report = {
  fixture: {
    dir: path.relative(ROOT, SCALE).replaceAll('\\', '/'),
    sourceBars: growth.at(-1).bars,
    tabBars: idiomStats.barEnd,
    tabAttacks: idiomStats.attackEvents,
    tabNotes: idiomStats.notes,
    notesAnalysed: playStats.notesAnalyzed,
  },
  environment: {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    repeat: REPEAT,
  },
  stages: stages.map(({ stdout, ...s }) => s),
  subprocessOverhead: { startupMs: startup, sumOfStagesMs: sumOfStages, fullGateMs: full.min },
  digestGrowth: growth,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const out = [];
out.push(`SCALE FIXTURE  ${report.fixture.dir}`);
out.push(`  ${report.fixture.sourceBars} source bars -> ${report.fixture.tabBars} tab bars, `
  + `${report.fixture.tabAttacks} attack events, ${report.fixture.notesAnalysed} notes analysed`);
out.push(`  ${report.environment.node} on ${report.environment.platform}, ${REPEAT} run(s) per stage`);
out.push('');
out.push(`  ${pad('stage', 34)}${num('min', 8)}${num('median', 9)}${num('max', 8)}`);
out.push(`  ${'-'.repeat(58)}`);
for (const s of stages) out.push(`  ${pad(s.label, 34)}${num(s.min, 8)}${num(s.median, 9)}${num(s.max, 8)}`);
out.push('');
out.push(`  Every row includes ~${startup} ms of interpreter startup.`);
out.push(`  The gate's stages sum to ${sumOfStages} ms run separately; check.mjs takes ${full.min} ms,`);
out.push('  because it spawns each one and each re-parses the same tab. That re-parse is');
out.push('  the price of the subprocess boundary the tests exercise, and it is bounded:');
out.push('  it is paid per STAGE, never per bar.');
out.push('');
out.push('DIGEST GROWTH (retention, measured in bytes so no clock is involved)');
out.push('');
out.push(`  ${pad('source bars', 14)}${num('notes', 8)}${num('bytes', 11)}${num('per bar', 10)}${num('per note', 10)}`);
out.push(`  ${'-'.repeat(53)}`);
for (const g of growth) {
  out.push(`  ${pad(g.bars, 14)}${num(g.notes, 8)}${num(g.bytes, 11)}${num(g.bytesPerBar, 10)}${num(g.bytesPerNote, 10)}`);
}
const drift = growth.map((g) => g.bytesPerBar);
out.push('');
out.push(`  Bytes per bar across an 8x range: ${Math.min(...drift)}-${Math.max(...drift)}.`);
out.push('  Flat means linear retention. A per-bar figure that CLIMBS with length is the');
out.push('  signature of quadratic retention, and tools/scale.test.mjs fails on it.');
out.push('');
out.push(`IDIOM AT SCALE  ${idiomStats.attackEvents} attacks -> ${idiomStats.riffCells} riff cell(s), `
  + `${idiomStats.pedalFigures} pedal figure(s)`);
out.push('  Recurring material collapses into cells; it does not accumulate per attack.');
process.stdout.write(`${out.join('\n')}\n`);

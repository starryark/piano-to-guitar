// scale.test.mjs — does the toolchain still behave at length?
// Run: node tools/scale.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// Every other fixture in this repo is a handful of bars, because a handful of
// bars is what it takes to prove a rule. Plan.md §10.4 asks a different
// question: does anything here degrade when the score gets long? Four failure
// modes were named — excessive event retention, large canonical riff keys,
// recursive traversal problems, advisory explosions — and none of them can
// appear in an eight-bar fixture. So this suite drives the 200-bar,
// two-track fixture in tools/fixtures/scale/.
//
// NOT A CLOCK IN SIGHT
// --------------------
// The obvious way to test scaling is to time it, and it is the wrong way: a
// wall-clock threshold fails on a loaded CI runner and passes on a quiet laptop,
// so it teaches a reader to ignore red. Every claim below is instead a claim
// about a COUNT or a BYTE — digest bytes per bar, advisories per code, distinct
// riff keys, bars named. Those are identical on every machine, and a quadratic
// retention bug moves them just as surely as it moves a stopwatch.
//
// Timings are still measured; they are reported by `npm run perf` and recorded
// in docs/specs/wave6-performance.md, where a human reads them.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate, buildSource, SIZES } from './fixtures/scale/generate.mjs';
import { loadTex } from './lib/score-utils.mjs';
import {
  extractIdiomEvents, findRiffCells, riffCellKey, RIFF_CELL_EVENTS,
} from './lib/idiom.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const SCALE = path.join(TOOLS, 'fixtures', 'scale');
const OUT = path.join(ROOT, 'out', 'scale');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const tool = (n) => path.join(TOOLS, n);
const fix = (n) => path.join(SCALE, n);

function run(args) {
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', cwd: ROOT, timeout: 300_000, killSignal: 'SIGKILL',
  });
  const describe = () => `command: node ${args.join(' ')}\n`
    + `status:  ${r.status}   signal: ${r.signal ?? '(none)'}\n`
    + `stderr:  ${(r.stderr ?? '').slice(0, 800) || '(empty)'}`;
  if (r.error) throw new Error(`child failed to run (${r.error.code ?? r.error.message})\n${describe()}`);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not every command is --json */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr ?? '', json, describe };
}

// The digest every gate run below consumes. Built once: this suite is about
// behaviour at length, not about how often a digest can be rebuilt.
const extract = run([tool('piano-extract.mjs'), fix('source.alphatab'), '--out', OUT]);
assert.equal(extract.code, 0, `piano-extract on the scale source\n${extract.describe()}`);
const DIGEST = path.join(OUT, 'source.json');

const GATE = [
  tool('check.mjs'), fix('cover.alphatab'),
  '--map', fix('sidecar.json'),
  '--digest', DIGEST,
  '--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1',
];
const gateAt = (bars, extra = []) => run([...GATE, '--bars', bars, ...extra, '--json']);

const FULL = gateAt('1-200');
assert.equal(FULL.code, 0, `the scale gate must pass before anything else is asserted\n${FULL.describe()}`);
assert.ok(FULL.json, 'the scale gate must emit JSON');

/** Every C3 advisory the gate produced, flattened. soft.playability is excluded
 *  on purpose: it keeps playability's native per-bar shape (C3 forbids
 *  retro-fitting it), so it is asserted separately and by a different rule. */
const c3 = ['compare', 'fingering', 'idiom', 'sidecar'].flatMap((k) => FULL.json.soft[k]);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// 1. The fixture is its generator's output, and says so
// ---------------------------------------------------------------------------
// 400-odd bars of AlphaTex cannot be reviewed by reading them. They can be
// reviewed by reading the ~150 lines that produce them — but only while the two
// agree. A hand-edit to the .alphatab is a divergence between the fixture and
// its documented intent, so it fails here rather than quietly changing what
// every assertion below is about.

test('the checked-in scale fixture is exactly what generate.mjs produces', () => {
  // Compared with line endings normalised, and only line endings. This repo has
  // no .gitattributes, so a checkout under `core.autocrlf=true` (the Windows
  // default) hands this test CRLF files that the generator writes as LF. That is
  // git rewriting a checkout, not somebody editing a fixture, and the claim here
  // is about the notes.
  const lf = (s) => s.replace(/\r\n/g, '\n');
  for (const [name, expected] of Object.entries(generate())) {
    assert.equal(lf(fs.readFileSync(fix(name), 'utf8')), lf(expected),
      `tools/fixtures/scale/${name} has drifted from generate.mjs.\n`
      + 'Re-run: node tools/fixtures/scale/generate.mjs');
  }
});

test('the fixture is long enough and wide enough to be worth running', () => {
  // A "scale" fixture that is not at scale tests nothing. These floors are the
  // reason the suite exists: two tracks (multi-track traversal), and a length
  // well past the corpus cover's 210 bars.
  assert.equal(SIZES.tabBars, 200);
  assert.equal(SIZES.sourceBars, 192);
  assert.equal(FULL.json.hard.playability.stats.tracks, 2, 'multi-track, or the traversal claims are untested');
  assert.ok(FULL.json.hard.playability.stats.notesAnalyzed > 2000,
    `expected >2000 notes analysed, got ${FULL.json.hard.playability.stats.notesAnalyzed}`);
});

// ---------------------------------------------------------------------------
// 2. Excessive event retention — measured in bytes, across an 8× range
// ---------------------------------------------------------------------------
// The digest keeps every parsed note as raw evidence (voices[].notes) on top of
// the derived melody/bass/skeleton views. That is a deliberate contract, and it
// is also exactly the shape that hides a quadratic: one bar retaining something
// about every other bar costs nothing at 8 bars and megabytes at 200.
//
// Bytes per bar is the tell. Flat = linear retention. Climbing = a bar is
// holding the whole score, and it will keep climbing.

test('digest retention is linear: bytes per bar stays flat across 24→192 bars', () => {
  const rows = [];
  for (const bars of [24, 48, 96, 192]) {
    const f = path.join(OUT, `growth-${bars}.alphatab`);
    fs.writeFileSync(f, buildSource(bars), 'utf8');
    const r = run([tool('piano-extract.mjs'), f, '--out', OUT]);
    assert.equal(r.code, 0, `piano-extract at ${bars} bars\n${r.describe()}`);
    const digest = JSON.parse(fs.readFileSync(path.join(OUT, `growth-${bars}.json`), 'utf8'));
    const notes = digest.bars.reduce((a, b) => a + b.voices.reduce((n, v) => n + v.notes.length, 0), 0);
    rows.push({ bars, bytes: fs.statSync(path.join(OUT, `growth-${bars}.json`)).size, notes });
  }

  // Note count is exact, not approximate: one four-bar loop is 15 melody notes
  // (the fourth bar rests on beat 4) plus 4 bass notes. A digest that retains
  // more or fewer than that has changed what it keeps.
  for (const row of rows) {
    assert.equal(row.notes, (row.bars / 4) * 19, `note retention at ${row.bars} bars`);
    assert.equal(row.bars, JSON.parse(
      fs.readFileSync(path.join(OUT, `growth-${row.bars}.json`), 'utf8')).bars.length);
  }

  const perBar = rows.map((r) => r.bytes / r.bars);
  const ratio = Math.max(...perBar) / Math.min(...perBar);
  // Observed 1.018 — the drift is the fixed header amortizing, and it points the
  // harmless way (per-bar cost FALLS as the score grows). 1.15 leaves room for
  // an added per-bar field; a quadratic would arrive at 8×, not 1.2×.
  assert.ok(ratio <= 1.15,
    `digest bytes per bar drifted ${ratio.toFixed(3)}× across an 8× length range `
    + `(${perBar.map((p) => Math.round(p)).join(' → ')}). Something retains per-bar state `
    + 'that grows with the score.');
});

// ---------------------------------------------------------------------------
// 3. Large canonical riff keys
// ---------------------------------------------------------------------------
// findRiffCells canonicalises a window of attacks into a string key and buckets
// by it. Two ways that goes wrong at length: a key whose length grows with the
// score (memory, and no recurrence ever matches), or a key so specific that
// every window is unique (a map with one entry per attack). This fixture is
// deliberately periodic, so genuine recurrence is available to be found.

test('riff-cell keys stay bounded, and recurrence actually collapses', () => {
  const loaded = loadTex(fix('cover.alphatab'));
  assert.equal(loaded.ok, true, 'the scale cover must parse');
  const { streams } = extractIdiomEvents(loaded.score);
  assert.ok(streams.length >= 2, 'both tracks must reach the idiom extractor');

  // Every key the bucketing would build, over every window of the whole tab.
  // A key encodes RIFF_CELL_EVENTS events as three short lists of small
  // integers, so its length is a function of the WINDOW and never of the score.
  // If that ever stops being true, it stops being true here first.
  let longest = 0;
  let attacks = 0;
  const keys = new Set();
  for (const stream of streams) {
    attacks += stream.attacks.length;
    for (let i = 0; i + RIFF_CELL_EVENTS <= stream.attacks.length; i++) {
      const key = riffCellKey(stream.attacks.slice(i, i + RIFF_CELL_EVENTS));
      if (key === null) continue;
      keys.add(key);
      longest = Math.max(longest, key.length);
    }
  }
  assert.ok(attacks > 1000, `only ${attacks} attacks reached the extractor`);
  assert.ok(longest > 0 && longest <= RIFF_CELL_EVENTS * 12,
    `longest canonical riff key is ${longest} chars for a ${RIFF_CELL_EVENTS}-event window`);
  assert.ok(keys.size * 10 < attacks,
    `${keys.size} distinct keys over ${attacks} attacks — canonicalisation is not collapsing anything`);

  // And the collapse the analyzer actually reports: many attacks, few cells.
  let cells = 0;
  let covered = 0;
  for (const stream of streams) {
    const found = findRiffCells(stream);
    cells += found.cells;
    covered += found.covered.size;
  }
  assert.ok(cells > 0, 'a periodic 200-bar fixture must produce riff cells');
  assert.ok(covered > cells * 4,
    `${covered} covered attack(s) collapsed into only ${cells} cell(s) — `
    + 'expected recurrence to be found, not one cell per window');

  // And the CLI agrees with the library, so the number a human reads is this one.
  const cli = run([tool('idiom.mjs'), fix('cover.alphatab'), '--bars', '1-200', '--json']);
  assert.equal(cli.code, 0, cli.describe);
  assert.ok(cli.json.stats.riffCells > 0 && cli.json.stats.riffCells < cli.json.stats.attackEvents / 10,
    `${cli.json.stats.riffCells} riff cell(s) over ${cli.json.stats.attackEvents} attacks — `
    + 'cells should be a summary, not a per-attack log');
});

// ---------------------------------------------------------------------------
// 4. Advisory explosions
// ---------------------------------------------------------------------------
// AGENTS.md: one root problem is one finding with an occurrences count, not
// fourteen lines. Length is where that rule is actually tested — a 200-bar tab
// built from one repeated four-bar loop presents the SAME situation fifty times.

test('no C3 advisory code exceeds the corpus cap of 4, over 200 bars', () => {
  const perCode = new Map();
  for (const a of c3) perCode.set(a.code, (perCode.get(a.code) ?? 0) + 1);
  for (const [code, n] of perCode) {
    assert.ok(n <= 4, `${code} fired ${n}× on a 200-bar tab — deduplicate it to a region`);
  }
  // Every advisory still carries evidence (C3), at scale as anywhere else.
  for (const a of c3) {
    assert.ok(a.data && typeof a.data === 'object' && Object.keys(a.data).length > 0,
      `${a.code} carries no data at scale`);
  }
});

test('a repeated situation collapses into ONE finding carrying its count', () => {
  // The lead line poses the same fingering question in every four-bar phrase.
  // This is the assertion the scale fixture was built for: before it existed,
  // the analyzer emitted 32 identical advisories here, because no fixture had
  // ever had two phrases with the same problem in them.
  const better = FULL.json.soft.fingering.filter((a) => a.code === 'fingering.better-fingering');
  assert.equal(better.length, 1,
    `the same phrase-level problem in ${better.length} phrases must collapse to one finding`);
  const [{ data }] = better;
  assert.ok(data.occurrences > 10,
    `the collapsed finding must carry its repeat count, got ${JSON.stringify(data)}`);

  // And the payload stays O(1): collapsing 32 advisories into one that carries a
  // 32-entry array would be the same growth in a better hat.
  for (const a of c3) {
    for (const [k, v] of Object.entries(a.data)) {
      assert.ok(!Array.isArray(v) || v.length <= 16,
        `${a.code}.data.${k} is a ${v.length}-element array — advisory evidence must not `
        + 'grow with the length of the score');
    }
  }
});

test("playability's native per-bar warnings name distinct bars, one per place", () => {
  // soft.playability predates the C3 advisory contract and keeps its own shape,
  // so the dedup rule above does not apply to it. The rule that DOES apply is
  // that its growth tracks PLACES, not notes: 2688 notes analysed must not mean
  // 2688 lines. Pinned as observed so a change here is a decision, not a drift.
  const warnings = FULL.json.soft.playability;
  const bars = warnings.map((w) => w.bar);
  assert.equal(new Set(bars).size, bars.length,
    'two native warnings landed on the same bar — that is a duplicate, not a second place');
  assert.ok(warnings.length <= FULL.json.hard.playability.stats.bars,
    `${warnings.length} warnings over ${FULL.json.hard.playability.stats.bars} bars`);
  assert.ok(warnings.length * 20 < FULL.json.hard.playability.stats.notesAnalyzed,
    `${warnings.length} warnings for ${FULL.json.hard.playability.stats.notesAnalyzed} notes — `
    + 'warnings are tracking note count rather than distinct places');
});

// ---------------------------------------------------------------------------
// 5. Recursive traversal, and the window still meaning something
// ---------------------------------------------------------------------------

test('200 bars of two-track material traverse without a stack or heap failure', () => {
  // A recursive walker over beats/notes blows up at a depth no small fixture
  // reaches. The gate exiting 0 is most of the proof; the rest is that it did
  // not survive by quietly swallowing an error.
  assert.equal(FULL.code, 0, FULL.describe());
  assert.equal(FULL.json.ok, true);
  assert.doesNotMatch(FULL.stderr, /RangeError|Maximum call stack|heap out of memory/i,
    'the run completed but reported a runtime failure on stderr');
  assert.equal(FULL.json.hard.compare.mapResults.length, 4, 'all four sidecar spans must be graded');
  for (const entry of FULL.json.hard.compare.mapResults) {
    assert.equal(entry.ok, true, `span ${entry.mode} ${JSON.stringify(entry.tabBars)} failed`);
  }
});

test('--bars still scopes at length: a 64-bar window is a strict subset', () => {
  const narrow = gateAt('1-64');
  assert.equal(narrow.code, 0, narrow.describe());
  assert.ok(narrow.json.hard.playability.stats.notesAnalyzed
    < FULL.json.hard.playability.stats.notesAnalyzed,
  'a narrower window analysed just as much material as the full one');
  const wide = new Set(FULL.json.soft.playability.map((w) => w.bar));
  for (const w of narrow.json.soft.playability) {
    assert.ok(w.bar <= 64, `a 1-64 window reported bar ${w.bar}`);
    assert.ok(wide.has(w.bar), `bar ${w.bar} warns in a narrow window but not in the full one`);
  }
});

// ---------------------------------------------------------------------------
// 6. Determinism survives the length (A6)
// ---------------------------------------------------------------------------

test('two full-length gate runs are byte-identical', () => {
  const again = gateAt('1-200');
  assert.equal(again.code, FULL.code);
  assert.equal(again.stdout, FULL.stdout,
    'the 200-bar gate is not deterministic — an analyzer is emitting in traversal order somewhere');
});

// ---------------------------------------------------------------------------
// 7. The export path at length
// ---------------------------------------------------------------------------

test('MIDI export handles 200 bars × 2 tracks and writes one file', () => {
  const mid = path.join(OUT, 'scale.mid');
  const r = run([tool('export-midi.mjs'), fix('cover.alphatab'), '--out', mid, '--json']);
  assert.equal(r.code, 0, r.describe());
  const buf = fs.readFileSync(mid);
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'MThd', 'not a MIDI file');
  // Two guitar tracks in, at least two tracks out — and nothing left behind.
  const chunks = buf.toString('latin1').split('MTrk').length - 1;
  assert.ok(chunks >= 2, `expected ≥2 MTrk chunks, found ${chunks}`);
  assert.deepEqual(
    fs.readdirSync(OUT).filter((f) => f.startsWith('.') || f.endsWith('.tmp')), [],
    'export-midi left a temp file behind',
  );
});

// ---------------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`FAIL ${name}\n`);
    process.stderr.write(`\n--- ${name} ---\n${err?.message ?? err}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

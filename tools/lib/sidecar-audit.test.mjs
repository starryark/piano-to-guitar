// sidecar-audit.test.mjs — self-test for tools/lib/sidecar-audit.mjs and
// tools/sidecar-audit.mjs (contract C10 + addendum §A4.1).
// Run: node tools/lib/sidecar-audit.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// C10 opens by insisting on two DISJOINT spaces, and every test here defends one
// of the two ways that can be violated:
//
//   1. FABRICATING A SOURCE MAPPING FOR `free`. A free span has no `sourceBars`
//      by construction, so any "share of the source that is free" is ill-formed.
//      The suite asserts the free bucket exists in tab space and nowhere else.
//
//   2. COUNTING A REPEAT AS EXTRA COVERAGE. A source bar quoted by three spans
//      is ONE bar of coverage. Every source-space figure is a SET; the
//      repeated-source fixture is the one that would catch a regression to sums.
//
// Threshold behaviour is pinned at the boundary in both directions, because
// "> threshold" and ">= threshold" differ by exactly one fixture and neither
// reading is obviously wrong until someone writes it down.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSidecar, validateSidecar, SIDECAR_MODES } from './sidecar.mjs';
import { loadStyleProfile } from './style-profile.mjs';
import { hasAdvisory } from './advisory.mjs';
import { TAB_BUCKETS, auditSidecar, toRanges } from './sidecar-audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures');
const AFIX = path.join(FIX, 'sidecar-audit');
const CLI = path.join(ROOT, 'tools', 'sidecar-audit.mjs');
const SCRATCH = path.join(ROOT, 'out', 'sidecar-audit-test');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

/** Build a digest for a source fixture, once, into the scratch dir. */
function digestOf(stem) {
  const out = path.join(SCRATCH, `${stem}.json`);
  if (!fs.existsSync(out)) {
    const r = node([path.join(ROOT, 'tools', 'piano-extract.mjs'), path.join(FIX, `${stem}.alphatab`),
      '--out', SCRATCH]);
    assert.equal(r.status, 0, `piano-extract ${stem}: ${r.stderr}`);
  }
  return out;
}
const digestJson = (stem) => JSON.parse(fs.readFileSync(digestOf(stem), 'utf8'));

/** Load + validate a fixture sidecar exactly the way the gate does. */
function entriesOf(mapFile, stem = 'chaconne-excerpt', range = null) {
  const digest = digestJson(stem);
  const digestByBar = new Map(digest.bars.map((b) => [b.bar, b]));
  const mapPath = path.join(AFIX, mapFile);
  const loaded = loadSidecar(mapPath);
  assert.equal(loaded.ok, true, `${mapFile}: ${loaded.errors?.[0]?.message}`);
  const declared = loaded.data.entries.map((e) => e.tabBars);
  const span = {
    lo: Math.min(...declared.map((r) => r[0])),
    hi: Math.max(...declared.map((r) => r[1])),
  };
  const v = validateSidecar(loaded.data, { range: range ?? span, digestByBar, digest, mapPath });
  assert.equal(v.ok, true, `${mapFile}: ${v.errors?.[0]?.message}`);
  return { entries: v.entries, digest, range: range ?? span };
}

function audit(mapFile, { style = 'hard-rock', stem = 'chaconne-excerpt', range = null } = {}) {
  const { entries, digest, range: r } = entriesOf(mapFile, stem, range);
  const profile = loadStyleProfile(style).profile;
  return auditSidecar({ entries, digest, range: r, profile });
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Tab space
// ---------------------------------------------------------------------------

test('every sidecar mode has exactly one tab-space bucket', () => {
  // A mode with no bucket would vanish from every total and silently shrink the
  // free-share denominator, so the mapping is asserted to be exhaustive AND
  // non-overlapping rather than merely present.
  const placed = Object.values(TAB_BUCKETS).flat();
  assert.deepEqual([...placed].sort(), [...SIDECAR_MODES].sort());
  assert.equal(new Set(placed).size, placed.length, 'no mode may sit in two buckets');
});

test('the four buckets always sum to totalTabBars', () => {
  for (const f of ['all-quote.json', 'mixed.json', 'free-at-threshold.json',
    'free-above-threshold.json', 'repeated-source.json', 'source-gap.json']) {
    const t = audit(f).metrics.tabSpace;
    const sum = Object.keys(TAB_BUCKETS).reduce((n, k) => n + t[k], 0);
    assert.equal(sum, t.totalTabBars, `${f}: buckets ${sum} != total ${t.totalTabBars}`);
  }
});

test('an all-quote map has a zero free share', () => {
  const t = audit('all-quote.json').metrics.tabSpace;
  assert.equal(t.quoteTabBars, 8);
  assert.equal(t.freeTabBars, 0);
  assert.equal(t.freeTabBarShare, 0);
});

test('a mixed map splits per mode, and reports the raw per-mode counts too', () => {
  const t = audit('mixed.json').metrics.tabSpace;
  assert.equal(t.quoteTabBars, 3);
  assert.equal(t.recomposeTabBars, 3);
  assert.equal(t.freeTabBars, 2);
  assert.deepEqual(t.tabBarsByMode, { quote: 3, recompose: 3, free: 2 },
    'the aggregation must be checkable, not merely trusted');
});

test('contract and contract-recompose share the contract bucket', () => {
  const r = audit('contract-mixed.json', { stem: 'contract-source' });
  const t = r.metrics.tabSpace;
  assert.equal(t.contractTabBars, 3);
  assert.equal(t.quoteTabBars, 0);
  assert.equal(t.recomposeTabBars, 0);
  assert.deepEqual(t.tabBarsByMode, { contract: 1, 'contract-recompose': 2 });
});

test('in SOURCE space the axis is different: contract protects, contract-recompose does not', () => {
  // §A4.1's deliberate asymmetry. A tab bar's question is "what did the arranger
  // declare here?"; a source bar's question is "is anything protecting my
  // melody?" — and `contract-recompose` relaxes harmony but still pins the
  // phrase, so it sits with recompose in tab space's sibling bucket and with
  // recompose in source space too, while plain `contract` counts as protection.
  const s = audit('contract-mixed.json', { stem: 'contract-source' }).metrics.sourceSpace;
  assert.deepEqual(s.sourceBarsByQuote.bars, [1]);
  assert.deepEqual(s.sourceBarsByRecompose.bars, [2, 3]);
});

test('tab-space counts are CLIPPED to --bars', () => {
  const full = audit('mixed.json').metrics.tabSpace;
  const half = audit('mixed.json', { range: { lo: 1, hi: 4 } }).metrics.tabSpace;
  assert.equal(full.totalTabBars, 8);
  assert.equal(half.totalTabBars, 4, 'an entry straddling the window contributes only its slice');
  assert.equal(half.quoteTabBars, 2);
  assert.equal(half.recomposeTabBars, 2);
});

// ---------------------------------------------------------------------------
// Source space — sets, never sums
// ---------------------------------------------------------------------------

test('a repeated source reference is ONE bar of coverage, not two', () => {
  // THE regression this metric exists for. Both entries quote source bars 1-4;
  // a sum would claim 8 bars of coverage from a source that has 8 bars total,
  // i.e. "fully covered", when half of it was never touched.
  const s = audit('repeated-source.json').metrics.sourceSpace;
  assert.equal(s.sourceBarsByQuote.count, 4);
  assert.deepEqual(s.sourceBarsByQuote.bars, [1, 2, 3, 4]);
  assert.equal(s.sourceBarsUnreferenced.count, 4, 'bars 5-8 really were never referenced');
  assert.equal(s.sourceBarsMultiplyReferenced.count, 4);
  assert.deepEqual(s.sourceBarsMultiplyReferenced.counts.map((c) => c.references), [2, 2, 2, 2]);
});

test('"only under recompose" excludes any bar a quote also protects', () => {
  const s = audit('mixed.json').metrics.sourceSpace;
  const both = s.sourceBarsByQuote.bars.filter((b) => s.sourceBarsByRecompose.bars.includes(b));
  assert.deepEqual(both, [], 'the two sets must be disjoint');
  assert.deepEqual(s.sourceBarsByQuote.bars, [1, 2, 6]);
  assert.deepEqual(s.sourceBarsByRecompose.bars, [3, 4, 5]);
  assert.deepEqual(s.sourceBarsUnreferenced.bars, [7, 8]);
});

test('a free span contributes NOTHING to source space — no bucket, no fabrication', () => {
  const r = audit('source-gap.json');
  const s = r.metrics.sourceSpace;
  assert.equal(r.metrics.tabSpace.freeTabBars, 4, 'the free bars exist in TAB space');
  assert.deepEqual(Object.keys(s).filter((k) => /free/i.test(k)), [],
    'and have no representation whatever in source space');
  // The four free tab bars name no source, so bars 5-8 stay unreferenced.
  assert.deepEqual(s.sourceBarsUnreferenced.bars, [5, 6, 7, 8]);
});

test('every source-space set is emitted sorted, with matching ranges', () => {
  const s = audit('mixed.json').metrics.sourceSpace;
  for (const key of ['sourceBarsByQuote', 'sourceBarsByRecompose', 'sourceBarsUnreferenced',
    'sourceBarsMultiplyReferenced']) {
    const span = s[key];
    assert.deepEqual(span.bars, [...span.bars].sort((a, b) => a - b), `${key} is unsorted`);
    assert.equal(span.count, span.bars.length);
    assert.deepEqual(span.ranges, toRanges(span.bars), `${key} ranges disagree with bars`);
  }
});

test('toRanges compacts runs and keeps singletons', () => {
  assert.deepEqual(toRanges([]), []);
  assert.deepEqual(toRanges([3]), [[3, 3]]);
  assert.deepEqual(toRanges([1, 2, 3, 7, 8, 12]), [[1, 3], [7, 8], [12, 12]]);
});

// ---------------------------------------------------------------------------
// Melody-skeleton space
// ---------------------------------------------------------------------------

test('skeleton notes are classified by their source bar, with no free bucket', () => {
  const m = audit('mixed.json').metrics.melodySkeletonSpace;
  assert.equal(m.coveredByQuote + m.coveredOnlyByRecompose + m.unreferenced, m.total,
    'every skeleton note lands in exactly one of the three buckets');
  assert.ok(m.total > 0, 'the digest really has a skeleton to classify');
  assert.deepEqual(Object.keys(m).filter((k) => /free/i.test(k)), []);
});

test('a fully quoted map protects every skeleton note', () => {
  const m = audit('all-quote.json').metrics.melodySkeletonSpace;
  assert.equal(m.coveredByQuote, m.total);
  assert.equal(m.coveredByQuoteShare, 1);
  assert.equal(m.unreferenced, 0);
});

// ---------------------------------------------------------------------------
// The advisory
// ---------------------------------------------------------------------------

test('free share exactly AT the threshold does not warn', () => {
  const r = audit('free-at-threshold.json');
  assert.equal(r.metrics.tabSpace.freeTabBarShare, 0.4);
  assert.equal(loadStyleProfile('hard-rock').profile.freeSpanWarnShare, 0.4);
  assert.equal(hasAdvisory(r.advisories, 'sidecar.high-free-share'), false,
    'the rule is strictly greater than — a map that lands exactly on the guide is within it');
});

test('free share just above the threshold warns', () => {
  const r = audit('free-above-threshold.json');
  assert.equal(r.metrics.tabSpace.freeTabBarShare, 0.5);
  assert.equal(hasAdvisory(r.advisories, 'sidecar.high-free-share'), true);
});

test('the threshold is the STYLE\'s, and changing style changes the verdict', () => {
  // blues tolerates more added material (0.5); the same map that warns under
  // hard-rock is within the blues guide.
  assert.equal(loadStyleProfile('blues').profile.freeSpanWarnShare, 0.5);
  const rock = audit('free-above-threshold.json', { style: 'hard-rock' });
  const blues = audit('free-above-threshold.json', { style: 'blues' });
  assert.equal(hasAdvisory(rock.advisories, 'sidecar.high-free-share'), true);
  assert.equal(hasAdvisory(blues.advisories, 'sidecar.high-free-share'), false);
  assert.deepEqual(rock.metrics, blues.metrics, 'style moves the advice, never the measurement');
});

test('a responsibly mapped arrangement draws no advisory at all', () => {
  for (const f of ['all-quote.json', 'mixed.json', 'repeated-source.json']) {
    assert.deepEqual(audit(f).advisories, [], `${f} should be quiet`);
  }
});

test('the advisory carries its evidence and is worded as a question', () => {
  const a = audit('free-above-threshold.json').advisories[0];
  assert.equal(a.code, 'sidecar.high-free-share');
  assert.equal(a.severity, 'warning');
  assert.equal(a.data.freeTabBars, 5);
  assert.equal(a.data.totalTabBars, 10);
  assert.equal(a.data.threshold, 0.4);
  assert.equal(a.data.style, 'hard-rock');
  // C10: informational, never accusatory. A valid map may legitimately be free.
  assert.doesNotMatch(a.message, /evad|cheat|suspicious|violat/i);
});

test('without a profile the metrics still compute; only the advisory needs one', () => {
  const { entries, digest, range } = entriesOf('free-above-threshold.json');
  const r = auditSidecar({ entries, digest, range });
  assert.equal(r.metrics.tabSpace.freeTabBarShare, 0.5);
  assert.deepEqual(r.advisories, []);
});

// ---------------------------------------------------------------------------
// Refusals and edge cases
// ---------------------------------------------------------------------------

test('an empty denominator is neutral, never NaN and never a confident zero', () => {
  const { digest } = entriesOf('all-quote.json');
  const r = auditSidecar({ entries: [], digest, range: { lo: 1, hi: 8 }, profile: loadStyleProfile('hard-rock').profile });
  assert.equal(r.metrics.tabSpace.totalTabBars, 0);
  assert.equal(r.metrics.tabSpace.freeTabBarShare, null);
  assert.deepEqual(r.advisories, [], 'no evidence means no verdict');
});

test('bad arguments throw rather than producing confident nonsense', () => {
  assert.throws(() => auditSidecar({ entries: null, digest: { bars: [] } }), TypeError);
  assert.throws(() => auditSidecar({ entries: [], digest: null }), TypeError);
  assert.throws(() => auditSidecar({ entries: [], digest: {} }), TypeError);
});

test('an unbucketed mode is an error, not a silently dropped bar', () => {
  const { digest } = entriesOf('all-quote.json');
  assert.throws(
    () => auditSidecar({ entries: [{ mode: 'paraphrase', tabBars: [1, 2] }], digest, range: { lo: 1, hi: 2 } }),
    /has no tab-space bucket/);
});

test('two audits of the same input are byte-identical', () => {
  assert.equal(JSON.stringify(audit('mixed.json')), JSON.stringify(audit('mixed.json')));
});

// ---------------------------------------------------------------------------
// CLI (contract C2)
// ---------------------------------------------------------------------------

const cli = (...args) => node([CLI, ...args]);
const chaconne = () => digestOf('chaconne-excerpt');
const map = (f) => path.join(AFIX, f);

test('C2: a soft-only tool exits 0 even when it has an advisory', () => {
  const r = cli('--digest', chaconne(), '--map', map('free-above-threshold.json'), '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(hasAdvisory(out.advisories, 'sidecar.high-free-share'), true);
});

test('C2: an invalid sidecar mode exits 2 — the audit refuses what the gate refuses', () => {
  const r = cli('--digest', chaconne(), '--map', map('bad-mode.json'), '--json');
  assert.equal(r.status, 2);
  assert.match(JSON.parse(r.stdout).errors.join(' '), /mode "paraphrase" not in/);
});

test('C2: a source bar absent from the digest exits 2', () => {
  const r = cli('--digest', chaconne(), '--map', map('bad-source.json'), '--json');
  assert.equal(r.status, 2);
  assert.match(JSON.parse(r.stdout).errors.join(' '), /absent from the digest/);
});

test('C2: a hole in tab coverage exits 2', () => {
  const r = cli('--digest', chaconne(), '--map', map('tab-gap.json'), '--json');
  assert.equal(r.status, 2);
  assert.match(JSON.parse(r.stdout).errors.join(' '), /uncovered/);
});

test('C2: missing arguments, a missing file and an unknown style all exit 2', () => {
  assert.equal(cli('--json').status, 2);
  assert.equal(cli('--digest', chaconne(), '--json').status, 2);
  assert.equal(cli('--digest', chaconne(), '--map', map('nope.json'), '--json').status, 2);
  assert.equal(cli('--digest', chaconne(), '--map', map('mixed.json'), '--style', 'polka', '--json').status, 2);
  assert.equal(cli('--digest', path.join(SCRATCH, 'nope.json'), '--map', map('mixed.json'), '--json').status, 2);
});

test('the CLI defaults its window to the map\'s own span', () => {
  const out = JSON.parse(cli('--digest', chaconne(), '--map', map('mixed.json'), '--json').stdout);
  assert.deepEqual(out.metrics.range, { lo: 1, hi: 8 });
  const scoped = JSON.parse(
    cli('--digest', chaconne(), '--map', map('mixed.json'), '--bars', '1-4', '--json').stdout);
  assert.deepEqual(scoped.metrics.range, { lo: 1, hi: 4 });
  assert.equal(scoped.metrics.tabSpace.totalTabBars, 4);
});

test('the CLI is deterministic across runs', () => {
  const a = cli('--digest', chaconne(), '--map', map('mixed.json'), '--json').stdout;
  const b = cli('--digest', chaconne(), '--map', map('mixed.json'), '--json').stdout;
  assert.equal(a, b);
});

test('the human report never prints a free row in source or skeleton space', () => {
  const r = cli('--digest', chaconne(), '--map', map('source-gap.json'));
  assert.equal(r.status, 0);
  const [, sourceAndAfter] = r.stdout.split('SOURCE SPACE');
  assert.ok(sourceAndAfter, 'the report must have a source-space section');
  assert.doesNotMatch(sourceAndAfter.split('SOFT ADVISORIES')[0], /^\s+free\s/m);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${err.stack ?? err.message}\n\n`);
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

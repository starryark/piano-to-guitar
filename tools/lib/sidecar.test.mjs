// sidecar.test.mjs — the sidecar (correspondence-map) validator (tools/lib/sidecar.mjs).
// Run: node tools/lib/sidecar.test.mjs   (exit 0 = all green, 1 = failure)
//
// Wave 0 (contract C8) extracted this validator out of compare.mjs's inline
// `loadAndValidateMap`. The extraction is BEHAVIOR-PRESERVING, and "behavior"
// here means the exact refusal MESSAGE, not merely "it refused": compare.mjs
// feeds `errors[0].message` straight back into its own `mapUsage()`, so every
// string below is what a human sees on stderr as `compare: <message>` before
// exit 2. Those messages are the pinned surface — this suite exists so a future
// tidy-up of the validator cannot quietly reword or reorder them.
//
// The validator is FAIL-CLOSED and stops at the FIRST problem, exactly as the
// exiting version did. That is why every negative case below asserts one
// specific message rather than "some error occurred": a validator that failed
// for the wrong reason would still pass the weaker assertion, and a sidecar
// language whose refusals drift is a gate whose meaning drifts.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import {
  loadSidecar, validateSidecar, resolveMappedSpans,
  SIDECAR_MODES, CONTRACT_MODES,
} from './sidecar.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A stand-in digest index. validateSidecar only ever asks `digestByBar.has(b)`
// for source-bar existence, so a Map of bar numbers is the whole contract — no
// need to build a real digest for the non-contract paths.
const digestByBar = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((b) => [b, { bar: b }]));
const ctx = (over = {}) => ({
  range: { lo: 1, hi: 8 },
  digestByBar,
  digest: { bars: [...digestByBar.values()] },
  ...over,
});

/** The sidecar every negative case starts from: valid, covering tab bars 1-8. */
const valid = () => ({
  song: 'sidecar test',
  entries: [
    { mode: 'recompose', tabBars: [1, 4], sourceBars: [1, 4], note: 'first half' },
    { mode: 'quote', tabBars: [5, 8], sourceBars: [5, 8] },
  ],
});

/** Assert the FIRST (and only) refusal message, not just that it refused. */
function refuses(data, expected, context = ctx()) {
  const r = validateSidecar(data, context);
  assert.equal(r.ok, false, 'expected a refusal, got ok:true');
  assert.equal(r.errors.length, 1, 'fail-closed validation stops at the first problem');
  assert.equal(r.errors[0].message, expected);
}

// --- the happy path --------------------------------------------------------

test('a valid sidecar normalizes entries and carries `song` through', () => {
  const r = validateSidecar(valid(), ctx());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.errors.length, 0);
  assert.equal(r.song, 'sidecar test');
  assert.equal(r.contract, null);          // no contract-mode entry => none resolved
  assert.deepEqual(r.entries, [
    { mode: 'recompose', tabBars: [1, 4], sourceBars: [1, 4], note: 'first half' },
    { mode: 'quote', tabBars: [5, 8], sourceBars: [5, 8] },
  ]);
});

test('`free` entries carry NO sourceBars — added material has no correspondence', () => {
  // C8/C10: this is the property every "share of the source that is free"
  // metric would have to violate. It is structural, not incidental.
  const data = valid();
  data.entries[0] = { mode: 'free', tabBars: [1, 4] };
  const r = validateSidecar(data, ctx());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal('sourceBars' in r.entries[0], false);
  // ...and a `free` entry is NOT required to declare them, even though every
  // other non-contract mode is.
  assert.equal(r.entries[0].mode, 'free');
});

test('the mode list is exactly the five the gate implements', () => {
  assert.deepEqual(SIDECAR_MODES, ['free', 'quote', 'recompose', 'contract', 'contract-recompose']);
  assert.deepEqual(CONTRACT_MODES, ['contract', 'contract-recompose']);
});

// --- malformed top level ---------------------------------------------------

test('top level: non-object, missing entries, empty entries', () => {
  refuses(null, 'map file unreadable: top level is not an object');
  refuses([], 'map missing "entries" array');   // an array has no `.entries`
  refuses({ entries: {} }, 'map missing "entries" array');
  refuses({ entries: [] }, 'map "entries" is empty');
});

// --- malformed entries -----------------------------------------------------

test('entry shape: not an object, missing tabBars, missing mode', () => {
  refuses({ entries: [null] }, 'entry 0 is not an object');
  refuses({ entries: [{ mode: 'free' }] }, 'entry 0 missing "tabBars"');
  refuses({ entries: [{ tabBars: [1, 4] }] }, 'entry 0 missing "mode"');
});

test('an unknown mode is refused, and the message lists all five', () => {
  const data = valid();
  data.entries[1].mode = 'quotes';   // the plausible typo
  refuses(data, 'entry 1 mode "quotes" not in {free, quote, recompose, contract, contract-recompose}');
});

test('malformed tabBars ranges name the specific malformation', () => {
  const bad = (tabBars, reason) => {
    const data = valid();
    data.entries[0].tabBars = tabBars;
    refuses(data, `entry 0 tabBars ${reason} (got ${JSON.stringify(tabBars)})`);
  };
  bad([1], 'not a 2-element array');
  bad('1-4', 'not a 2-element array');
  bad([1.5, 4], 'values not integers');
  bad([0, 4], 'values < 1');          // bars are 1-based; 0 is a fencepost bug
  bad([4, 1], 'end < start');
});

test('a non-free mode must declare sourceBars, and they must be well-formed', () => {
  const data = valid();
  delete data.entries[0].sourceBars;
  refuses(data, 'entry 0 mode "recompose" requires "sourceBars"');

  const data2 = valid();
  data2.entries[0].sourceBars = [4, 1];
  refuses(data2, 'entry 0 sourceBars end < start (got [4,1])');
});

test('sourceBars outside the digest are refused — the gate never grades thin air', () => {
  const data = valid();
  data.entries[1].sourceBars = [5, 9];   // bar 9 does not exist in the digest
  refuses(data, 'entry 1 sourceBars references bar 9, absent from the digest');
});

// --- coverage and overlap --------------------------------------------------
// These two are the anti-vacuity guards: an uncovered bar would be graded by
// nothing, and a doubly-covered bar would be graded twice under conflicting
// modes. Both must stay refusals, not warnings.

test('overlapping tab spans are refused, naming the first doubly-covered bar', () => {
  const data = valid();
  data.entries[1].tabBars = [4, 8];   // bar 4 is already in entry 0
  refuses(data, 'tab bar 4 is covered by multiple entries');
});

test('a tab bar inside --bars covered by no entry is refused', () => {
  const data = valid();
  data.entries[1].tabBars = [6, 8];   // leaves tab bar 5 uncovered
  refuses(data, 'tab bar 5 is uncovered');
});

test('coverage is judged against --bars, not against the sidecar union', () => {
  // Entries covering 1-8 satisfy a narrower --bars window without complaint...
  const narrow = validateSidecar(valid(), ctx({ range: { lo: 2, hi: 3 } }));
  assert.equal(narrow.ok, true, JSON.stringify(narrow.errors));
  // ...but a WIDER window exposes the gap past the sidecar's end.
  refuses(valid(), 'tab bar 9 is uncovered', ctx({ range: { lo: 1, hi: 9 } }));
});

// --- contract modes --------------------------------------------------------

test('a contract-mode entry with no contract file is refused', () => {
  const data = valid();
  data.entries[1] = { mode: 'contract', tabBars: [5, 8], contractPhrase: 'p1' };
  refuses(data, 'map has contract-mode entries but no contract file: pass --contract '
    + 'or set a top-level "contract" path in the sidecar');
});

test('a sidecar-relative "contract" path needs the sidecar\'s own location', () => {
  // An in-memory sidecar has no mapPath to resolve "./melody.json" against, so
  // it gets the same honest refusal rather than resolving against cwd.
  const data = valid();
  data.contract = './melody-contract.json';
  data.entries[1] = { mode: 'contract', tabBars: [5, 8], contractPhrase: 'p1' };
  refuses(data, 'map has contract-mode entries but no contract file: pass --contract '
    + 'or set a top-level "contract" path in the sidecar');
});

test('an unreadable contract file is refused with the loader\'s own message', () => {
  const data = valid();
  data.entries[1] = { mode: 'contract', tabBars: [5, 8], contractPhrase: 'p1' };
  const missing = path.join(os.tmpdir(), 'ptg-no-such-contract.json');
  const r = validateSidecar(data, ctx({ contractArg: missing }));
  assert.equal(r.ok, false);
  // The message comes from contract.mjs's loader, passed through verbatim —
  // the sidecar validator must not reword another module's diagnosis.
  assert.match(r.errors[0].message, /ptg-no-such-contract\.json/);
});

// --- loadSidecar (IO + parse only) -----------------------------------------

test('loadSidecar: unreadable file and unparseable JSON share one message prefix', () => {
  const missing = path.join(os.tmpdir(), 'ptg-no-such-sidecar.json');
  const r = loadSidecar(missing);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /^map file unreadable: /);
  assert.equal(r.data, null);

  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-sidecar-')), 'bad.json');
  fs.writeFileSync(tmp, '{ not json', 'utf8');
  const r2 = loadSidecar(tmp);
  assert.equal(r2.ok, false);
  assert.match(r2.errors[0].message, /^map file unreadable: /);
});

test('loadSidecar: a well-formed file round-trips, a shape-broken one refuses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-sidecar-'));
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify(valid()), 'utf8');
  const r = loadSidecar(good);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data.entries.length, 2);

  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ entries: [] }), 'utf8');
  assert.equal(loadSidecar(empty).errors[0].message, 'map "entries" is empty');
});

test('the shipped e2e fixture sidecar validates', () => {
  // Guards the extraction against the one sidecar the smoke suite gates on.
  const fixture = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '..', 'fixtures', 'e2e-sidecar.json');
  const r = loadSidecar(fixture);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const v = validateSidecar(r.data, ctx());
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.entries.length, 2);
});

// --- resolveMappedSpans ----------------------------------------------------

test('resolveMappedSpans keeps entries INTERSECTING --bars, drops the rest', () => {
  const { entries } = validateSidecar(valid(), ctx());
  // Both spans intersect the full window.
  assert.equal(resolveMappedSpans(entries, { lo: 1, hi: 8 }).length, 2);
  // A window inside the first span selects only it.
  assert.deepEqual(resolveMappedSpans(entries, { lo: 2, hi: 3 }).map((e) => e.tabBars), [[1, 4]]);
  // A window inside the second selects only it.
  assert.deepEqual(resolveMappedSpans(entries, { lo: 6, hi: 7 }).map((e) => e.tabBars), [[5, 8]]);
  // Boundary: a window touching exactly one bar of a span still selects it.
  assert.deepEqual(resolveMappedSpans(entries, { lo: 4, hi: 4 }).map((e) => e.tabBars), [[1, 4]]);
  assert.deepEqual(resolveMappedSpans(entries, { lo: 5, hi: 5 }).map((e) => e.tabBars), [[5, 8]]);
  // A window past every span selects nothing (coverage was already proven).
  assert.deepEqual(resolveMappedSpans(entries, { lo: 20, hi: 30 }), []);
  // Defensive: a missing entry list is not a crash.
  assert.deepEqual(resolveMappedSpans(undefined, { lo: 1, hi: 8 }), []);
});

// --------------------------------------------------------------------------- //
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

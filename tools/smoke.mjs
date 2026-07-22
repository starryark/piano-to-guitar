// smoke.mjs — end-to-end health check for the Piano-to-guitar toolchain.
//
// Usage:  npm run smoke        (node tools/smoke.mjs)
//
// Drives every fixture under tools/fixtures/ with an EXPECTED EXIT CODE and,
// where the exit code alone is not enough, an assertion on the output. Run it
// after a clone and after any change to tools/.
//
// Why a runner rather than a chain of npm scripts: several fixtures are
// SUPPOSED to fail. `must fail` is a contract like any other, and it used to
// live only in a comment at the top of a fixture, enforced by nothing. Three of
// the checks below — the AT218 rewrite count, the §0.1 pcset-width bound, and
// the vacuous-digest refusal — protect properties whose regressions are
// invisible by construction: the gate would report PASS and sound fine.
//
// Modeled on abc-to-guitar/tools/smoke.mjs, but song-neutral and self-contained
// for THIS project: no Python, no ABC, no file in source/ or analysis/ is
// required. Generated digests and MIDI land in the gitignored out/smoke/
// directory — never in analysis/, which holds the user's current piece. That
// directory is wiped at the start of every run, so a stale digest from a
// previous run can never satisfy an assertion for a broken extractor.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const FIX = path.join(TOOLS, 'fixtures');
const OUT = path.join(ROOT, 'out');
const SMOKE_OUT = path.join(OUT, 'smoke');

// Wipe first: the digest assertions below read back what the extractor wrote,
// so a leftover file would let a broken extractor pass. Artifacts are kept on
// disk after the run so a failure can be diagnosed from what was produced.
fs.rmSync(SMOKE_OUT, { recursive: true, force: true });
fs.mkdirSync(SMOKE_OUT, { recursive: true });

const results = [];
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail: detail ?? '' });
  } catch (e) {
    failed++;
    results.push({ ok: false, name, detail: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function node(args) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** Run a tool and parse its stdout as JSON (or null if not JSON). */
function nodeJson(args) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* non-JSON => stays null */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: parsed };
}

const tool = (n) => path.join(TOOLS, n);
const fix = (n) => path.join(FIX, n);
const digestOf = (stem) => path.join(SMOKE_OUT, `${stem}.json`);
const readDigest = (stem) => JSON.parse(fs.readFileSync(digestOf(stem), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Source-side normalizer — the AT218 pitched/fretted fix (§2.3)
// ---------------------------------------------------------------------------
// canon-in-d-easy fails AT218 until the normalizer rewrites -1.<str>.<dur>
// tokens to rests in PITCHED staves. A regression here would silently make the
// source unparseable. The fixture carries exactly 3 such tokens; the count is
// the contract (the real file has 11).

check('AT218: piano-validate rewrites every pitched -1.N token to a rest', () => {
  const { code, json } = nodeJson([tool('piano-validate.mjs'), fix('at218-pitched-rest.alphatab')]);
  assert(code === 0, `expected exit 0, got ${code}\n${json ?? ''}`);
  assert(json && json.ok === true, 'validate reported ok:false on a fixture that should parse clean');
  const rw = json?.normalization?.rewrites ?? -1;
  assert(rw === 3, `expected exactly 3 rewrites (the fixture has 3 -1.N tokens), got ${rw}`);
  const skipped = json?.normalization?.counts?.negativeFretSkipped ?? 0;
  assert(skipped === 0, `${skipped} token(s) skipped — none should be in a pitched-only staff`);
  return `3 -1.N -> r.<dur> rewrites, 0 skipped`;
});

// ---------------------------------------------------------------------------
// 2. Digest contract + the WP2b pcset-width bound (§0.1)
// ---------------------------------------------------------------------------
// Two invisible-failure properties in one check:
//   (a) every bar carries NON-ZERO melodySkeleton and harmony.root — a digest
//       that loses a field makes compare.mjs's `covered === total` gates
//       vacuously true at total 0 (the §0.2 trap 2 disease).
//   (b) the §0.1 fix holds: mean pcset width <= 4.0 and NO bar carries 7 pitch
//       classes. If this regresses, the harmonic gate becomes ~53% permissive
//       again and reports PASS while protecting almost nothing.

check('digest: NON-ZERO coverage AND the §0.1 pcset-width bound hold', () => {
  const { code } = node([tool('piano-extract.mjs'), fix('chaconne-excerpt.alphatab'), '--out', SMOKE_OUT]);
  assert(code === 0, `piano-extract exit ${code}`);
  const d = readDigest('chaconne-excerpt');
  const total = d.bars.length;
  assert(total > 0, '0-bar digest');
  const skel = d.bars.filter((b) => (b.melodySkeleton || []).length > 0).length;
  const root = d.bars.filter((b) => b.harmony && b.harmony.root).length;
  assert(skel === total, `melodySkeleton ${skel}/${total} — a dropped field makes the gate vacuous`);
  assert(root === total, `harmony.root ${root}/${total} — a dropped field makes the gate vacuous`);
  const widths = d.bars.map((b) => (b.harmony?.pcset || []).length);
  const mean = widths.reduce((a, x) => a + x, 0) / widths.length;
  const atSeven = widths.filter((w) => w === 7).length;
  assert(mean <= 4.0, `mean pcset width ${mean.toFixed(2)} > 4.0 — the harmonic gate is permissive (§0.1)`);
  assert(atSeven === 0, `${atSeven} bar(s) carry all 7 diatonic pcs — a whole-scale pcset (§0.1)`);
  // The chaconne ground bass must reproduce: A F# D G (repeated).
  const roots = d.bars.map((b) => b.harmony.root);
  assert(roots.join(' ') === 'A F# D G A F# D G',
    `roots [${roots.join(' ')}] != the measured chaconne A F# D G A F# D G`);
  return `${total} bars, mean pcset width ${mean.toFixed(2)}, roots A F# D G A F# D G`;
});

// ---------------------------------------------------------------------------
// 3. Declared-key lie — \ks is reported, never trusted (§2.2 fact 4)
// ---------------------------------------------------------------------------
// Canon Rock 1 declares \ks c while sounding D. Trusting it would mis-spell
// every note name. The fixture declares C major but sounds D; the validator
// must report the disagreement as a flag, never an exit code.

check('declared \\ks lie: reported as a flag, never trusted', () => {
  const { code, json } = nodeJson([tool('piano-validate.mjs'), fix('key-lie-ks-c-sounds-D.alphatab')]);
  assert(code === 0, `expected exit 0 (disagreement is a flag, not an error), got ${code}`);
  assert(json?.key?.agrees === false, 'a declared \\ks c vs sounding D must report agrees:false');
  assert(json?.key?.sounding?.key === 'D major', `sounding key should be D major, got ${json?.key?.sounding?.key}`);
  return `declared C major, sounding ${json?.key?.sounding?.key}, agrees:${json?.key?.agrees}`;
});

// ---------------------------------------------------------------------------
// 4. validate --strict catches a broken tab (parse errors are HARD)
// ---------------------------------------------------------------------------

check('validate --strict: a syntactically-broken tab exits 1', () => {
  const { code, json } = nodeJson([tool('validate.mjs'), '--strict', fix('broken-syntax.alphatab')]);
  assert(code === 1, `expected exit 1, got ${code}`);
  assert(json?.ok === false, 'ok should be false');
  assert((json?.errors?.length ?? 0) > 0, 'errors[] must be non-empty on a broken tab');
  return `${json?.errors?.length} parse error(s) reported`;
});

// ---------------------------------------------------------------------------
// 5. validate --strict catches an overfull voice (bar-fill is HARD)
// ---------------------------------------------------------------------------
// canon-in-d-hard bar 45 holds 6 beats in 4/4 (§2.5). The fixture reproduces
// the shape: 5 beats in a 4/4 bar. --strict must make it fatal.

check('validate --strict: an overfull voice exits 1', () => {
  const { code, json } = nodeJson([tool('validate.mjs'), '--strict', fix('overfull-voice.alphatab')]);
  assert(code === 1, `expected exit 1, got ${code}`);
  const overfull = (json?.warnings ?? []).filter((w) => /overfull/.test(w.message ?? ''));
  assert(overfull.length > 0, 'expected an overfull bar-fill warning');
  return overfull[0]?.message?.slice(0, 60);
});

// ---------------------------------------------------------------------------
// 6. playability flags non-adjacent strings (the §2.2 fact 10 constraint)
// ---------------------------------------------------------------------------
// Across both real covers: 74 multi-note attacks, max 4 notes, ZERO
// non-adjacent string pairs. A dyad on strings 2 and 6 is unplayable with a
// flatpick and must be flagged as an error (a HARD gate signal).

check('playability: non-adjacent strings are an error', () => {
  const { code, json } = nodeJson([
    tool('playability.mjs'), fix('non-adjacent-dyad.alphatab'), '--bars', '1', '--json']);
  assert((json?.errors?.length ?? 0) > 0, 'expected a non-adjacent-strings error');
  const na = json.errors.find((e) => /non-adjacent/.test(e.type ?? '') || /non-adjacent/.test(e.message ?? ''));
  assert(na, `expected a non-adjacent-strings error, got: ${JSON.stringify(json.errors)}`);
  return `${json.errors.length} error(s); exit code ${code} (ignored by check.mjs — it gates on errors[])`;
});

// ---------------------------------------------------------------------------
// 7. End-to-end: check.mjs --map runs the whole pipeline and writes MIDI
// ---------------------------------------------------------------------------
// The acceptance criterion from the build plan: a hand-written tab + 2-entry
// sidecar passes check.mjs end to end, with MIDI landing in out/. This is the
// one command a human runs at every gate; if it cannot complete, the project
// has no gate. Verifies validate -> playability -> compare -> midi in order,
// a well-formed verdict (never exit 2, never 0/0), and a written .mid.

check('end-to-end: check.mjs --map passes and writes MIDI to out/', () => {
  // The digest must be regenerated into SMOKE_OUT so the test is self-contained.
  const ex = node([tool('piano-extract.mjs'), fix('chaconne-excerpt.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);

  const { code, json } = nodeJson([
    tool('check.mjs'), fix('e2e-tab.alphatab'),
    '--bars', '1-8',
    '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('e2e-sidecar.json'),
    '--json']);
  assert(code === 0, `expected GATE: PASS (exit 0), got exit ${code}\n${json?.failReasons ?? ''}`);
  assert(json?.ok === true, 'ok should be true');
  assert(json?.hard?.validate?.ok === true, 'validate should pass');
  assert(json?.hard?.playability?.ok === true, 'playability should pass (no errors)');
  assert(json?.hard?.compare?.ok === true, 'compare should pass');
  assert(json?.midi?.written === true, `MIDI should be written, got: ${JSON.stringify(json?.midi)}`);
  // The map mode result carries per-entry verdicts — both must pass.
  const mapResults = json?.hard?.compare?.mapResults ?? [];
  assert(mapResults.length === 2, `expected 2 map entries, got ${mapResults.length}`);
  assert(mapResults.every((r) => r.ok), 'every map entry should pass');
  // MIDI file actually exists on disk.
  const midiPath = path.join(OUT, 'e2e-tab.mid');
  assert(fs.existsSync(midiPath), `expected MIDI at ${midiPath}`);
  return `GATE: PASS — 2/2 map entries, MIDI written`;
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const tag = r.ok ? 'ok  ' : 'FAIL';
  console.log(`${tag}  ${r.name.padEnd(width)}  ${r.detail}`);
}
console.log();
if (failed === 0) {
  console.log(`SMOKE: PASS  (${results.length} checks)`);
  process.exit(0);
} else {
  console.log(`SMOKE: FAIL  (${failed} of ${results.length} checks failed)`);
  process.exit(1);
}

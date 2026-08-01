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
// required. Generated digests land in the gitignored out/smoke/ directory —
// never in analysis/, which holds the user's current piece. That
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
// 6. playability grades non-adjacent strings by note count (contract C14)
// ---------------------------------------------------------------------------
// Across both real covers: 74 multi-note attacks, max 4 notes, ZERO
// non-adjacent string pairs. A simultaneous grip a pick cannot take must be
// caught — but PTG Wave 1 splits it by how the player would actually answer it:
//   • a DYAD on strings 2 and 6 is the textbook hybrid-picking grip (pick + a
//     finger). It is a warning, and — with C7's corrected exit semantics — the
//     process exits 0. This check asserts BOTH halves, because a warning that
//     still exited 1 would be indistinguishable from the old hard failure.
//   • a THREE-note non-contiguous grip is not something a flatpick or a hybrid
//     grip absorbs mid-line; it stays a HARD error and exits 1.
// Asserting them together is what stops the split from silently collapsing back
// into one rule in either direction.

check('playability: non-adjacent dyad warns (exit 0), 3-note grip errors (exit 1)', () => {
  const dyad = nodeJson([
    tool('playability.mjs'), fix('non-adjacent-dyad.alphatab'), '--bars', '1', '--json']);
  assert((dyad.json?.errors?.length ?? -1) === 0,
    `a non-adjacent DYAD must not be a hard error, got: ${JSON.stringify(dyad.json?.errors)}`);
  const warn = (dyad.json?.warnings ?? []).find((w) => w.type === 'non-adjacent-dyad');
  assert(warn, `expected a non-adjacent-dyad warning, got: ${JSON.stringify(dyad.json?.warnings)}`);
  assert(/Non-adjacent dyad: hybrid picking or a roll may be required\./.test(warn.message),
    `the C14 wording must survive edits, got: ${warn.message}`);
  assert(dyad.code === 0, `warning-only run must exit 0 (contract C7), got ${dyad.code}`);

  const triad = nodeJson([
    tool('playability.mjs'), fix('non-adjacent-triad.alphatab'), '--bars', '1', '--json']);
  const na = (triad.json?.errors ?? []).find((e) => e.type === 'non-adjacent-strings');
  assert(na, `expected a non-adjacent-strings error, got: ${JSON.stringify(triad.json?.errors)}`);
  assert(triad.code === 1, `a hard playability error must exit 1, got ${triad.code}`);
  return `dyad -> 1 warning, exit ${dyad.code}; 3-note grip -> hard error, exit ${triad.code}`;
});

// ---------------------------------------------------------------------------
// 7. End-to-end: check.mjs --map runs the whole pipeline and reaches a verdict
// ---------------------------------------------------------------------------
// The acceptance criterion from the build plan: a hand-written tab + 2-entry
// sidecar passes check.mjs end to end. This is the one command a human runs at
// every gate; if it cannot complete, the project has no gate. Verifies validate
// -> playability -> compare in order, and a well-formed verdict (never exit 2,
// never 0/0).

check('end-to-end: check.mjs --map passes (validate → playability → compare)', () => {
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
  // The map mode result carries per-entry verdicts — both must pass.
  const mapResults = json?.hard?.compare?.mapResults ?? [];
  assert(mapResults.length === 2, `expected 2 map entries, got ${mapResults.length}`);
  assert(mapResults.every((r) => r.ok), 'every map entry should pass');
  return `GATE: PASS — 2/2 map entries`;
});

// ---------------------------------------------------------------------------
// 8. Map mode applies a non-zero transpose exactly once
// ---------------------------------------------------------------------------
// The tab is written three semitones below the source (C -> A). tabBars stores
// source-space MIDI during collection; map helpers must not subtract the
// transpose a second time.

check('compare --map: nonzero transpose is applied exactly once', () => {
  const ex = node([tool('piano-extract.mjs'), fix('transpose-source.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);

  const { code, json } = nodeJson([
    tool('compare.mjs'), fix('transpose-tab.alphatab'), digestOf('transpose-source'),
    '--bars', '1',
    '--transpose', '-3',
    '--map', fix('transpose-sidecar.json'),
    '--json']);
  assert(code === 0, `expected transpose-aware map PASS, got exit ${code}`);
  assert(json?.mapResults?.length === 1, 'expected one map result');
  assert(json.mapResults[0].ok === true, 'quote skeleton and root should pass');
  return 'C source → A tab with --transpose -3';
});

// ---------------------------------------------------------------------------
// 9. tab-events: parser truth beats text appearance (tie corruption visible)
// ---------------------------------------------------------------------------
// alphaTab parses a dash tie with no origin into a FRESH ATTACK of the open
// string — silently. tab-events.mjs must show the parsed truth (ATTACK, open
// A2) and its text-vs-model audit must count the swallowed tie intent.

check('tab-events: a malformed guitar tie is visible as an open-string ATTACK', () => {
  const { code, json } = nodeJson([
    tool('tab-events.mjs'), fix('tie-semantics-corruption.alphatab'), '--json']);
  assert(code === 0, `tab-events exit ${code}`);
  const bar3 = json?.bars?.find((b) => b.bar === 3);
  assert(bar3, 'bar 3 missing from the event dump');
  const n = bar3.events[0]?.notes?.[0];
  assert(n?.midi === 45, `expected the open-string A2 artifact (midi 45), got ${n?.midi}`);
  assert(n?.tieDestination === false && n?.attack === true,
    'the tie-shaped token must be reported as an ATTACK, not a continuation');
  assert(json?.tieIntentAudit?.dropped === 1,
    `expected exactly 1 dropped tie intent, got ${json?.tieIntentAudit?.dropped}`);
  // The legit tie pair in bar 1 must still read as a continuation.
  const bar1 = json.bars.find((b) => b.bar === 1);
  const cont = bar1.events.find((e) => e.onset === 2)?.notes?.[0];
  assert(cont?.tieDestination === true && cont?.attack === false,
    'the well-formed tie must remain a CONTINUATION');
  return 'open-string artifact shown as ATTACK; 1 dropped tie intent counted';
});

// ---------------------------------------------------------------------------
// 10. Tied microfragments coalesce: fragments are not attacks (§2.2)
// ---------------------------------------------------------------------------
// A Basic Pitch-shaped source shatters each note into tied fragments. The
// digest's interpreted layers (melody/skeleton) must carry one event per real
// attack with the chain's merged sounding duration, while the raw evidence
// layer keeps every fragment.

check('digest: tied microfragments coalesce into attacks with merged durations', () => {
  const ex = node([tool('piano-extract.mjs'), fix('tied-microfragments.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  const d = readDigest('tied-microfragments');
  const b1 = d.bars[0];
  assert(b1.voices[0].notes.length === 8, `raw evidence must keep all 8 fragments, got ${b1.voices[0].notes.length}`);
  const mel = b1.melody.map((n) => `${n.name}@${n.onset}`).join(' ');
  assert(mel === 'E5@0 A4@1 E4@2', `coalesced melody should be 3 attacks, got "${mel}"`);
  assert(b1.melody[0].beats === 2, `E5 head must carry chain duration 2, got ${b1.melody[0].beats}`);
  assert(b1.melody[2].beats === 1, `E4 must keep its own 1-beat duration, got ${b1.melody[2].beats}`);
  assert(d.tieAudit?.intent?.dropped === 1, `expected 1 dropped tie intent, got ${d.tieAudit?.intent?.dropped}`);
  assert(d.tieAudit?.tieAcrossGap === 1, `expected 1 gap tie, got ${d.tieAudit?.tieAcrossGap}`);
  return '8 fragments -> 3 attacks; sounding durations merged per chain';
});

// ---------------------------------------------------------------------------
// 11. source-profile: structural percussion exclusion + noise classification
// ---------------------------------------------------------------------------
// The percussion fixture names its drum track "Band" on purpose: a name-based
// classifier CANNOT catch it. Exclusion must come from structure (unpitched
// staff / channel 10 / articulation map). The noisy fixture must classify as
// a noisy transcription with its fragmented voices in one performance group.

check('source-profile: percussion excluded structurally; noise classified', () => {
  const p = nodeJson([tool('source-profile.mjs'), fix('percussion-plus-piano.alphatab'), '--json']);
  assert(p.code === 0, `source-profile exit ${p.code}`);
  const ex = p.json?.sourceProfile?.excludedTracks ?? [];
  assert(ex.length === 1 && ex[0].role === 'percussion',
    `expected 1 excluded percussion track, got ${JSON.stringify(ex)}`);
  assert(ex[0].name === 'Band', 'the fixture track name must stay non-indicative');
  assert(ex[0].evidence.some((e) => /unpitched|channel 10|articulation/.test(e)),
    'exclusion evidence must be structural');
  assert(p.json?.sourceProfile?.kind === 'clean-notation', 'clean fixture misclassified');

  const n = nodeJson([tool('source-profile.mjs'), fix('noisy-basic-pitch-voices.alphatab'), '--json']);
  assert(n.code === 0, `source-profile exit ${n.code}`);
  const sp = n.json?.sourceProfile;
  assert(sp?.kind === 'noisy-transcription', `expected noisy-transcription, got ${sp?.kind}`);
  assert(sp?.noiseSignals?.voiceFragmentation === 'high',
    `expected high fragmentation, got ${sp?.noiseSignals?.voiceFragmentation}`);
  assert(sp?.pitchedPerformanceGroups?.[0]?.voices?.length === 4,
    'all four fragmented voices must sit in one performance group');
  return 'drum track "Band" excluded structurally; noisy fixture classified noisy';
});

// ---------------------------------------------------------------------------
// 12. foreground pipeline: extract -> foreground.json + foreground-map.md
// ---------------------------------------------------------------------------
// End-to-end over the CLI (not the library): the false-high-octave fixture's
// bar 3 must rank the recurring lower melody above the octave artifact, with
// the alternative still visible. ALSO pinned here: on the fragmented-voices
// fixture the LEGACY highest-voice heuristic yields an empty melodySkeleton
// (piano-extract exits 1 with its vacuous-digest refusal) — that is the
// measured disease the foreground layer exists to cure. If that exit code
// changes, the digest heuristic changed: re-audit the foreground doctrine.

check('foreground: recurring lower melody beats the octave artifact (CLI e2e)', () => {
  const ex = node([tool('piano-extract.mjs'), fix('false-high-octave.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  const fg = node([tool('foreground.mjs'), digestOf('false-high-octave'), '--out', SMOKE_OUT]);
  assert(fg.code === 0, `foreground exit ${fg.code}\n${fg.out}`);
  const doc = JSON.parse(fs.readFileSync(path.join(SMOKE_OUT, 'foreground.json'), 'utf8'));
  const b3 = doc.bars.find((b) => b.bar === 3);
  const [w, ru] = b3.foregroundCandidates;
  assert(w.line.join(' ') === 'D5 E5 F#5 E5', `winner should be the lower line, got "${w.line.join(' ')}"`);
  assert(ru.line.includes('D6') && ru.confidence < w.confidence,
    'the artifact-topped line must remain visible and lower-ranked');
  assert(fs.existsSync(path.join(SMOKE_OUT, 'foreground-map.md')), 'foreground-map.md missing');

  const noisy = node([tool('piano-extract.mjs'), fix('noisy-basic-pitch-voices.alphatab'), '--out', SMOKE_OUT]);
  assert(noisy.code === 1,
    'EXPECTED failure: the legacy highest-voice heuristic must still produce a '
    + 'vacuous skeleton on fragmented voices (the disease the foreground layer cures). '
    + `Got exit ${noisy.code}.`);
  const fg2 = node([tool('foreground.mjs'), digestOf('noisy-basic-pitch-voices'), '--out', SMOKE_OUT]);
  assert(fg2.code === 0, `foreground exit ${fg2.code}`);
  const doc2 = JSON.parse(fs.readFileSync(path.join(SMOKE_OUT, 'foreground.json'), 'utf8'));
  const voices = new Set(doc2.bars[0].foregroundCandidates[0].notes.map((n) => n.voice));
  assert(voices.size >= 2, 'fragmented voices must recombine into one cross-voice line');
  return 'lower melody wins bar 3; artifact visible as alternative; voices recombined';
});

// ---------------------------------------------------------------------------
// 13. Contract-backed gate: check.mjs end-to-end (Improve_Plan §5)
// ---------------------------------------------------------------------------
// The full Gate-B command over a contract-mode sidecar. The PASS tab honours
// distinct repeated attacks, the kept breath, and the whole-phrase -12
// relocation; the FAIL tab merges the repeat into one sustain, plugs the
// breath with a bass tick, and plays the solo in the UNRELOCATED octave —
// each a distinct contract failure (octave-exact, so pc-identical notes in
// the wrong octave do not pass).

check('contract gate: PASS tab passes with non-zero obligation totals', () => {
  const ex = node([tool('piano-extract.mjs'), fix('contract-source.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  const cv = nodeJson([tool('contract-validate.mjs'), fix('contract-melody.json'),
    '--digest', digestOf('contract-source'), '--json']);
  assert(cv.code === 0, `contract-validate exit ${cv.code}: ${JSON.stringify(cv.json?.errors)}`);
  assert(cv.json?.stats?.requiredEvents === 9, `expected 9 required events, got ${cv.json?.stats?.requiredEvents}`);

  const { code, json } = nodeJson([
    tool('check.mjs'), fix('contract-tab-pass.alphatab'),
    '--bars', '1-3',
    '--digest', digestOf('contract-source'),
    '--map', fix('contract-sidecar.json'),
    '--json']);
  assert(code === 0, `expected GATE: PASS, got exit ${code} (${JSON.stringify(json?.failReasons)})`);
  const results = json?.hard?.compare?.mapResults ?? [];
  assert(results.length === 3 && results.every((r) => r.ok), 'all 3 contract entries must pass');
  const totals = results.map((r) => r.totals?.foregroundAttacks?.total ?? 0);
  assert(totals.every((t) => t > 0), `anti-vacuity: totals must be non-zero, got ${totals}`);
  return 'GATE: PASS — 9 attacks, 1 gap, 1 relocation group enforced';
});

check('contract gate: merged repeat, plugged breath, wrong octave each FAIL', () => {
  const { code, json } = nodeJson([
    tool('check.mjs'), fix('contract-tab-fail.alphatab'),
    '--bars', '1-3',
    '--digest', digestOf('contract-source'),
    '--map', fix('contract-sidecar.json'),
    '--json']);
  assert(code === 1, `expected GATE: FAIL (exit 1), got ${code}`);
  const results = json?.hard?.compare?.mapResults ?? [];
  const byPhrase = new Map(results.map((r) => [r.contractPhrase, r]));
  const theme = byPhrase.get('theme-1');
  assert(theme && !theme.ok && theme.failures.some((f) => /distinct attack/.test(f.message)),
    'the merged B4 repeat must fail the attack-count obligation');
  const breath = byPhrase.get('breath-1');
  assert(breath && !breath.ok && breath.failures.some((f) => /required gap/.test(f.message)),
    'the plugged breath must fail the required-gap obligation');
  const solo = byPhrase.get('solo-high');
  assert(solo && !solo.ok && solo.failures.some((f) => /octave-exact/.test(f.message)),
    'the unrelocated octave must fail (pitch class alone never passes a contract)');
  assert((json?.failReasons ?? []).includes('compare melody contract'),
    `failReasons must name the contract gate, got ${JSON.stringify(json?.failReasons)}`);
  return '3/3 engineered defects caught: repeat-merge, gap-fill, octave-miss';
});

// ---------------------------------------------------------------------------
// 14. Guitar policy (§7): texture constraints + warning escalation
// ---------------------------------------------------------------------------
// The same tab is mechanically CLEAN under the general checks but fails a
// single-note fast-attack policy and an exact 21-fret physical limit. And
// --warnings-as-errors escalates soft advisories into errors[] (the only
// channel check.mjs gates on), enabling zero-warning approval policies.

check('policy: fast 16th dyads + fret 22 fail; clean without policy', () => {
  const bare = nodeJson([tool('playability.mjs'), fix('policy-violations.alphatab'), '--bars', '1-2']);
  assert((bare.json?.errors?.length ?? -1) === 0, `expected 0 errors without policy, got ${bare.json?.errors?.length}`);

  const pol = nodeJson([tool('playability.mjs'), fix('policy-violations.alphatab'),
    '--bars', '1-2', '--policy', fix('guitar-policy.json')]);
  const types = new Set((pol.json?.errors ?? []).map((e) => e.type));
  assert(types.has('policy-fast-attack'), 'a 16th-note dyad must fail fastAttackMaxNotes: 1');
  assert(types.has('policy-max-fret'), 'fret 22 must fail the maxFret: 21 physical limit');
  assert(types.has('policy-rapid-grip'), 'the re-struck grip must fail the rapid-grip check');
  assert(pol.json?.gain === 'crunch', 'policy.gain must apply when --gain is not given');

  const esc = nodeJson([tool('playability.mjs'), fix('position-jump-slow.alphatab'),
    '--bars', '1-2', '--warnings-as-errors']);
  assert((esc.json?.warnings?.length ?? -1) === 0, 'escalation must empty warnings[]');
  assert((esc.json?.errors ?? []).some((e) => e.escalatedFromWarning),
    'escalated advisories must land in errors[] (the channel check.mjs gates on)');
  return 'fast-attack, max-fret, rapid-grip enforced; warnings escalate on demand';
});

// ---------------------------------------------------------------------------
// 15. History artifacts + final-review (§8): a PASS stays reproducible
// ---------------------------------------------------------------------------
// Gate-B through history.mjs must snapshot the contract/policy/report next to
// the tab (with hashes in the log entry), and final-review must flag chunks
// whose contract has since been edited — an old PASS graded under a different
// contract meant something else.

check('history: snapshots carry contract+policy+report; final-review flags drift', () => {
  const proj = path.join(SMOKE_OUT, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.copyFileSync(fix('contract-tab-pass.alphatab'), path.join(proj, 'cover.alphatab'));
  fs.copyFileSync(fix('contract-melody.json'), path.join(proj, 'melody-contract.json'));
  fs.copyFileSync(fix('guitar-policy.json'), path.join(proj, 'guitar-policy.json'));
  const sidecar = JSON.parse(fs.readFileSync(fix('contract-sidecar.json'), 'utf8'));
  sidecar.contract = 'melody-contract.json';
  fs.writeFileSync(path.join(proj, 'sidecar.json'), JSON.stringify(sidecar, null, 2));
  const ex = node([tool('piano-extract.mjs'), fix('contract-source.alphatab'), '--out', proj]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  fs.renameSync(path.join(proj, 'contract-source.json'), path.join(proj, 'source.json'));

  const gate = node([tool('history.mjs'), 'check', path.join(proj, 'cover.alphatab'),
    '--bars', '1-3', '--map', path.join(proj, 'sidecar.json'),
    '--digest', path.join(proj, 'source.json')]);
  assert(gate.code === 0, `history check exit ${gate.code}\n${gate.out}`);
  const entry = JSON.parse(fs.readFileSync(path.join(proj, 'history', 'log.jsonl'), 'utf8').trim());
  assert(entry.contractHash, 'log entry must record the contract hash');
  assert(entry.files.contract && entry.files.policy && entry.files.report,
    `snapshot must include contract+policy+report, got ${JSON.stringify(entry.files)}`);
  assert(fs.existsSync(path.join(proj, 'history', entry.files.contract)), 'contract snapshot missing');

  const v = node([tool('history.mjs'), 'verdict', 'APPROVED',
    '--recognizability', 'ACCEPT', '--no-log', '--project', proj]);
  assert(v.code === 0, `verdict exit ${v.code}`);

  // Edit the contract -> the recorded PASS no longer means the same thing.
  const c = JSON.parse(fs.readFileSync(path.join(proj, 'melody-contract.json'), 'utf8'));
  c.phrases[0].events[0].duration = 0.5;
  fs.writeFileSync(path.join(proj, 'melody-contract.json'), JSON.stringify(c, null, 2));
  const fr = nodeJson([tool('history.mjs'), 'final-review', path.join(proj, 'cover.alphatab'), '--json']);
  assert(fr.code === 0, `final-review exit ${fr.code}`);
  assert((fr.json?.chunksGradedUnderOlderContract ?? []).includes(1),
    'final-review must flag seq 1 as graded under an older contract');
  assert((fr.json?.chunksLackingReview ?? []).length === 0,
    'seq 1 has verdict + recognizability — must not be flagged unreviewed');
  assert(fr.json?.relocationGroups?.length === 1, 'relocation groups must surface');
  return 'artifacts snapshotted; contract edit -> drift flagged on the old PASS';
});

// ---------------------------------------------------------------------------
// 17. Every style profile loads, and NONE of them can move a hard result
// ---------------------------------------------------------------------------
// Waves 3-4 gave the gate a style knob. The knob is soft musical policy (C6),
// and the property worth a smoke check is the NEGATIVE one: turning it must
// change the advice and leave validate/playability/compare bit-identical. A
// regression here would be silent — every run still passes, just graded against
// the wrong genre's expectations.

check('all styles: soft advice moves, hard results do not', () => {
  const ex = node([tool('piano-extract.mjs'), fix('harmonic-color/jazz-source.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  const digest = digestOf('jazz-source');

  const styles = ['hard-rock', 'metal', 'blues', 'jazz'];
  const hard = new Set();
  const advice = new Set();
  for (const style of styles) {
    const { code, json } = nodeJson([
      tool('check.mjs'), fix('harmonic-color/flattened-tab.alphatab'),
      '--bars', '1-8', '--digest', digest,
      '--map', fix('harmonic-color/sidecar.json'), '--style', style, '--json']);
    assert(code === 0, `--style ${style} exit ${code}`);
    assert(json?.configuration?.style === style, `--style ${style} was not the style used`);
    hard.add(JSON.stringify(json.hard));
    advice.add(Object.values(json.soft).flat().map((a) => a.code ?? a.type).sort().join(','));
  }
  assert(hard.size === 1, `a style profile moved a HARD result (${hard.size} distinct hard blocks)`);
  assert(advice.size > 1, 'no style changed the advice — the profiles are not being read');
  return `${styles.length} styles, 1 hard result, ${advice.size} distinct advisory sets`;
});

// ---------------------------------------------------------------------------
// 18. Every soft analyzer is reachable from the one command a human runs
// ---------------------------------------------------------------------------
// Wave 0 shipped `soft.fingering`/`soft.idiom`/`soft.sidecar` as permanently
// empty arrays, and nothing noticed for two waves — an empty array is
// indistinguishable from a working analyzer with nothing to say. This check
// asserts each subsystem actually PRODUCED something on material chosen to
// provoke it, so "wired up" cannot silently become "wired to nothing".

check('all soft analyzers reachable from check.mjs (C4 five keys, none vacuous)', () => {
  const ex = node([tool('piano-extract.mjs'), fix('chaconne-excerpt.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  const { code, json } = nodeJson([
    tool('check.mjs'), fix('e2e-tab.alphatab'), '--bars', '1-8',
    '--digest', digestOf('chaconne-excerpt'),
    '--map', fix('sidecar-audit/free-half.json'), '--json']);
  assert(code === 0, `check exit ${code}`);

  const keys = Object.keys(json.soft ?? {}).sort();
  assert(keys.join(',') === 'compare,fingering,idiom,playability,sidecar',
    `C4: expected five soft keys, got [${keys}]`);
  for (const [k, v] of Object.entries(json.soft)) assert(Array.isArray(v), `soft.${k} is not an array`);

  // Each analyzer must have RUN, not merely have a key.
  assert(json.analyzers?.fingering?.stats, 'the fingering analyzer did not run');
  assert(json.analyzers?.idiom?.stats, 'the idiom analyzer did not run');
  assert(json.analyzers?.sidecar?.metrics, 'the sidecar audit did not run');
  assert(json.analyzers.idiom.stats.attackEvents > 0, 'idiom saw no attacks');
  assert(json.analyzers.sidecar.metrics.tabSpace.totalTabBars === 8, 'the audit read the wrong span');

  const codes = Object.values(json.soft).flat().map((a) => a.code ?? a.type);
  assert(codes.includes('sidecar.high-free-share'), 'the 50%-free map produced no sidecar advisory');
  return `5 keys, 3 analyzers ran, ${codes.length} finding(s)`;
});

// ---------------------------------------------------------------------------
// 19. Dual-guitar mode grades the declared LEAD, not whatever is highest
// ---------------------------------------------------------------------------
// The Wave 5 property that cannot be checked by looking at one run: the same two
// tracks, the same notes, roles declared the other way round, must reach the
// OPPOSITE verdict. If role selection ever silently degrades back to the
// aggregate, both runs pass and nothing looks wrong.

check('dual-guitar: swapping the roles flips the melody verdict', () => {
  const ex = node([tool('piano-extract.mjs'), fix('dual/source.alphatab'), '--out', SMOKE_OUT]);
  assert(ex.code === 0, `piano-extract exit ${ex.code}`);
  const digest = digestOf('source');
  const run = (lead, rhythm) => nodeJson([
    tool('check.mjs'), fix('dual/cover.alphatab'), '--bars', '1-4', '--digest', digest,
    '--map', fix('dual/sidecar.json'), '--arrangement-mode', 'dual-guitar',
    '--lead', lead, '--rhythm', rhythm, '--json']);

  const right = run('0', '1');
  assert(right.code === 0, `correct roles should PASS, got exit ${right.code}`);
  const wrong = run('1', '0');
  assert(wrong.code === 1, `swapped roles should FAIL the melody gate, got exit ${wrong.code}`);
  assert(wrong.json.failReasons.includes('compare melodic skeleton'),
    `expected a melodic-skeleton failure, got [${wrong.json?.failReasons}]`);

  // And solo mode — the default — still aggregates, so it passes either way.
  const solo = nodeJson([tool('check.mjs'), fix('dual/cover.alphatab'), '--bars', '1-4',
    '--digest', digest, '--map', fix('dual/sidecar.json'), '--json']);
  assert(solo.code === 0, 'solo mode must remain the compatible aggregate');
  return 'lead=0 PASS, lead=1 FAIL (melody), solo PASS';
});

// ---------------------------------------------------------------------------
// 20. MIDI export produces a real file, and never a truncated one
// ---------------------------------------------------------------------------
// The audition path. `MThd` plus a length beyond the bare header is the whole
// contract; the multi-track assertion is what proves a dual arrangement does not
// arrive in a DAW collapsed into one track.

check('MIDI export: MThd, multi-track, and nothing left behind on failure', () => {
  const dest = path.join(SMOKE_OUT, 'dual.mid');
  const { code, json } = nodeJson([tool('export-midi.mjs'), fix('dual/cover.alphatab'),
    '--out', dest, '--force', '--json']);
  assert(code === 0, `export-midi exit ${code}`);
  const bytes = fs.readFileSync(dest);
  assert(bytes.subarray(0, 4).toString('ascii') === 'MThd', 'not a Standard MIDI File');
  assert(bytes.length > 14, `only ${bytes.length} bytes — header and nothing else`);
  assert(json.tracks === 2, `expected 2 MIDI tracks from a 2-track score, got ${json.tracks}`);

  // A refused overwrite must leave the good file exactly as it was.
  const before = fs.readFileSync(dest);
  const refused = node([tool('export-midi.mjs'), fix('dual/cover.alphatab'), '--out', dest]);
  assert(refused.code === 2, 'overwrite without --force must be refused');
  assert(before.equals(fs.readFileSync(dest)), 'the existing file was damaged by a refused write');
  return `${bytes.length} bytes, 2 track(s), overwrite refused without --force`;
});

// ---------------------------------------------------------------------------
// 21. Determinism across the whole soft pipeline
// ---------------------------------------------------------------------------
// Every analyzer sorts its output and rounds its floats at the boundary (§A6).
// That is a lot of separate promises, and a single unsorted Set or unrounded
// float anywhere would break reproducibility of a stored gate report without
// breaking any individual test.

check('determinism: the full gate produces byte-identical JSON twice', () => {
  const args = [tool('check.mjs'), fix('harmonic-color/flattened-tab.alphatab'),
    '--bars', '1-8', '--digest', digestOf('jazz-source'),
    '--map', fix('harmonic-color/sidecar.json'), '--style', 'jazz', '--json'];
  const a = nodeJson(args);
  const b = nodeJson(args);
  assert(a.code === 0 && b.code === 0, 'both runs should pass');
  assert(a.stdout === b.stdout, 'two identical gate runs produced different JSON');
  const findings = Object.values(a.json.soft).flat().length;
  assert(findings > 0, 'a determinism check over an empty result proves nothing');
  return `identical across 2 runs, ${findings} soft finding(s) compared`;
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

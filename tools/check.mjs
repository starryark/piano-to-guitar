// Vendored from abc-to-guitar@ba7e29c — tools/check.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// check.mjs — the single consolidated chunk-gate orchestrator.
//
// Usage:
//   node tools/check.mjs <tab.alphatab> --bars N-M
//        [--transpose N] [--gain high|crunch|clean] [--digest <path>]
//        [--map <sidecar.json>] [--json]
//
// Runs validate --strict -> playability -> compare in order, prints ONE
// consolidated report, writes fresh MIDI for auditioning, and exits non-zero if
// any HARD gate fails. The skill requires this to pass before any tab is shown
// to the human.
//
// --map <file> is passed straight through to compare.mjs and switches the
// fidelity gate from bar-aligned to correspondence-aware mode. In map mode
// compare's result carries `mapResults[]` (one per entry) instead of the
// `hardGates` block; a `quote`/`recompose` entry that fails skeleton or roots
// is a HARD fail exactly like a bar-aligned skeleton/root miss. `free` entries
// can only fail via validate/playability.
//
// The three sub-tools are invoked as CHILD PROCESSES (never imported — they each
// call process.exit) and their stdout JSON is parsed. validate/playability/
// compare/midi live next to this file and are resolved relative to it, so the
// gate works regardless of the caller's cwd. Digests, however, are resolved
// relative to cwd (matching the `analysis/<name>.json` convention in the plan).
//
// HARD vs SOFT split (get this EXACTLY right):
//   HARD fail (=> overall exit 1) is ANY of:
//     • validate --strict exits non-zero (parse errors OR bar-fill warnings), OR
//     • playability `errors[]` is non-empty, OR
//     • compare reports a hard-gate failure (exit 1 / a false hardGate).
//   SOFT (reported, NEVER fatal):
//     • playability `warnings[]` (tone/physics advisories), PLUS
//     • ALL of compare's soft signals (chord quality, density, dropped, contour).
//
//   CRITICAL: playability exits 1 on EITHER errors[] OR warnings[] being
//   non-empty, so its EXIT CODE is NOT trustworthy here. We parse its JSON and
//   key the hard fail on `errors[]` ONLY; `warnings[]` are surfaced but never
//   gate. (validate's exit code, by contrast, IS trustworthy and used directly;
//   compare's exit code is trustworthy too — 0 pass / 1 hard-fail / 2 IO error.)
//
// Exit codes: 0 = no hard failure, 1 = a hard gate failed, 2 = usage / IO error
// (bad args, missing --bars, unresolvable digest, or a sub-tool that could not
// run). MIDI writing is a convenience, never a gate: a MIDI failure is reported
// but the hard-gate verdict stands. MIDI is still written on hard-fail runs (so
// the human can audition a rejected take) whenever the tab actually parses; it
// is only skipped when validate reports the tab is unparseable.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(TOOLS_DIR);
const OUT_DIR = path.join(REPO_ROOT, 'out');
const tool = (name) => path.join(TOOLS_DIR, name);

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let transpose = 0;
  let gain = 'high';        // matches playability's own default
  let digest = null;
  let map = null;
  let json = false;
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--transpose') transpose = argv[++i];
    else if (a.startsWith('--transpose=')) transpose = a.slice('--transpose='.length);
    else if (a === '--gain') gain = argv[++i];
    else if (a.startsWith('--gain=')) gain = a.slice('--gain='.length);
    else if (a === '--digest') digest = argv[++i];
    else if (a.startsWith('--digest=')) digest = a.slice('--digest='.length);
    else if (a === '--map') map = argv[++i];
    else if (a.startsWith('--map=')) map = a.slice('--map='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
  }
  return { file, bars, transpose, gain, digest, map, json };
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'Usage: node tools/check.mjs <tab.alphatab> --bars N-M ' +
    '[--transpose N] [--gain high|crunch|clean] [--digest <path>] ' +
    '[--map <sidecar.json>] [--json]');
  process.exit(2);
}

const { file, bars, transpose, gain, digest: digestArg, map: mapArg, json } = parseArgs(process.argv.slice(2));

if (!file) usage('No tab file given.');
if (!bars) usage('--bars N-M is required (compare needs a bar range).');
if (!/^\d+(?:-\d+)?$/.test(String(bars).trim())) usage(`Bad --bars "${bars}"; expected N or N-M.`);
if (!['high', 'crunch', 'clean'].includes(gain)) usage(`Bad --gain "${gain}"; expected high|crunch|clean.`);
const transposeNum = Number(transpose);
if (!Number.isFinite(transposeNum)) usage(`Bad --transpose "${transpose}"; expected an integer semitone offset.`);
if (!fs.existsSync(file)) usage(`No tab at "${file}".`);

// ---- digest resolution ----------------------------------------------------
// Default: analysis/<tabBasename>.json derived from the tab path. --digest wins.
const tabBase = path.basename(file, path.extname(file));
const digestPath = digestArg ?? path.join('analysis', `${tabBase}.json`);
if (!fs.existsSync(digestPath)) {
  usage(
    `No digest at ${digestPath} — pass --digest <path> or run: ` +
    `node tools/piano-extract.mjs source/${tabBase}.alphatab`);  // PTG: was abc-extract.py
}

// ---- map resolution -------------------------------------------------------
// --map is optional. Resolved relative to cwd (same convention as the digest),
// and its existence is checked here so a typo is a clear exit-2 instead of an
// opaque error from compare.mjs later.
const mapPath = mapArg ?? null;
if (mapPath && !fs.existsSync(mapPath)) {
  usage(`No map sidecar at "${mapPath}"`);
}

// ---- child-process helper -------------------------------------------------
/** Run a sub-tool, capture {code, stdout, stderr, json|null}. */
function run(script, args) {
  const r = spawnSync(process.execPath, [tool(script), ...args], { encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* non-JSON => stays null */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: parsed };
}

// ---- STAGE 1: validate --strict (its exit code IS trustworthy) ------------
const V = run('validate.mjs', ['--strict', file]);
// A hard parse failure prints { ok:false, errors:[...] } (no stats) — the tab is
// unparseable, so playability/compare/midi cannot run meaningfully downstream.
const parseFailed = !!(V.json && V.json.errors !== undefined);
const validateOk = V.code === 0;               // trust the exit code directly
const validateHard = { ok: validateOk, code: V.code, parseFailed };
if (V.json?.stats) validateHard.stats = V.json.stats;
if (V.json?.warnings?.length) validateHard.warnings = V.json.warnings;
if (V.json?.errors) validateHard.errors = V.json.errors;
if (V.json === null) validateHard.raw = (V.stderr || V.stdout || '').trim();

// ---- STAGES 2 & 3: only meaningful on a parseable tab ---------------------
let playHard = null;   // { ok, errors, warnings, stats }
let cmpHard = null;    // compare machine result (+ our ok flag)
let cmpIoError = null; // compare exit 2 => IO/usage problem, not a fidelity fail
let toolError = null;  // a sub-tool that could not produce JSON at all

if (!parseFailed) {
  // STAGE 2: playability — DO NOT trust exit code; gate on errors[] ONLY.
  const P = run('playability.mjs', [file, '--bars', bars, '--gain', gain]);
  if (P.json === null) {
    toolError = toolError ?? `playability.mjs produced no JSON:\n${(P.stderr || P.stdout || '').trim()}`;
  } else {
    playHard = {
      ok: (P.json.errors?.length ?? 0) === 0,   // HARD = errors[] empty
      errors: P.json.errors ?? [],
      warnings: P.json.warnings ?? [],          // SOFT — surfaced, never gates
      stats: P.json.stats,
      exitCode: P.code,                          // recorded to show it's ignored
    };
  }

  // STAGE 3: compare — the fidelity gate. Exit 0 pass / 1 hard-fail / 2 IO.
  const cmpArgs = [file, digestPath, '--bars', bars, '--transpose', String(transposeNum), '--json'];
  if (mapPath) cmpArgs.push('--map', mapPath);
  const C = run('compare.mjs', cmpArgs);
  if (C.code === 2) {
    cmpIoError = (C.stderr || C.stdout || 'compare reported an IO/usage error').trim();
  } else if (C.json === null) {
    toolError = toolError ?? `compare.mjs produced no JSON:\n${(C.stderr || C.stdout || '').trim()}`;
  } else {
    cmpHard = { ok: C.code === 0, ...C.json };   // C.json.ok already === (code===0)
  }
}

// ---- MIDI (convenience, never a gate) -------------------------------------
// Written even on hard-fail runs so the human can still audition a rejected
// take — but skipped when the tab is unparseable (midi.mjs would only fail).
let midi = { written: false, path: null, skipped: false, error: null };
if (parseFailed) {
  midi.skipped = true;
  midi.error = 'skipped — tab did not parse';
} else {
  const M = run('midi.mjs', [file]);
  const midiPath = path.join(OUT_DIR, `${tabBase}.mid`);
  if (M.code === 0 && fs.existsSync(midiPath)) {
    midi.written = true;
    midi.path = path.relative(REPO_ROOT, midiPath);
  } else {
    midi.error = (M.stderr || M.stdout || 'midi.mjs failed').trim();
  }
}

// ---- verdict --------------------------------------------------------------
// A sub-tool that could not run at all, or a compare IO error, is a setup
// problem (exit 2), distinct from a fidelity/playability HARD failure (exit 1).
if (toolError) usage(toolError);
if (cmpIoError) usage(`compare could not run: ${cmpIoError}`);

const hardFailReasons = [];
if (!validateHard.ok) hardFailReasons.push(parseFailed ? 'validate (unparseable tab)' : 'validate --strict');
if (playHard && !playHard.ok) hardFailReasons.push('playability errors');
if (cmpHard && !cmpHard.ok) {
  // Map mode: per-entry failures are the source of truth. A quote/recompose
  // entry failing melodicSkeleton/harmonicRoots is a hard fail; free entries
  // can only fail via validate/playability, never here.
  if (cmpHard.mapResults) {
    const gates = new Set();
    for (const r of cmpHard.mapResults) {
      for (const f of r.failures) {
        if (f.gate === 'melodicSkeleton') gates.add('compare melodic skeleton');
        else if (f.gate === 'harmonicRoots') gates.add('compare harmonic roots');
        else gates.add('compare');
      }
    }
    for (const g of gates) hardFailReasons.push(g);
  } else {
    if (cmpHard.hardGates?.melodicSkeleton && !cmpHard.hardGates.melodicSkeleton.ok) hardFailReasons.push('compare melodic skeleton');
    if (cmpHard.hardGates?.harmonicRoots && !cmpHard.hardGates.harmonicRoots.ok) hardFailReasons.push('compare harmonic roots');
    if (!cmpHard.hardGates) hardFailReasons.push('compare');
  }
}
const gateOk = hardFailReasons.length === 0;

// ---- machine output -------------------------------------------------------
const machine = {
  ok: gateOk,
  file,
  bars,
  transpose: transposeNum,
  gain,
  digest: digestPath,
  hard: {
    validate: validateHard,
    playability: playHard && { ok: playHard.ok, errors: playHard.errors, stats: playHard.stats },
    compare: cmpHard && (cmpHard.mapResults
      ? { ok: cmpHard.ok, map: cmpHard.map, mapResults: cmpHard.mapResults, failures: cmpHard.failures }
      : {
        ok: cmpHard.ok,
        hardGates: cmpHard.hardGates,
        failures: cmpHard.failures,
      }),
  },
  soft: {
    playability: playHard ? playHard.warnings : [],
    compare: cmpHard ? (cmpHard.mapResults ? null : cmpHard.soft) : null,
  },
  midi,
  failReasons: hardFailReasons,
};

if (json) {
  console.log(JSON.stringify(machine, null, 2));
  process.exit(gateOk ? 0 : 1);
}

// ---- human-readable consolidated report -----------------------------------
const mark = (ok) => (ok ? 'PASS' : 'FAIL');
const tsign = transposeNum >= 0 ? `+${transposeNum}` : `${transposeNum}`;
const L = [];

L.push(`CHECK  ${file}`);
L.push(`       bars ${bars}   transpose ${tsign}   gain ${gain}   digest ${digestPath}`);
L.push('');

// -- validate --
if (parseFailed) {
  L.push(`  validate --strict    FAIL   tab did not parse`);
  for (const e of (validateHard.errors ?? []).slice(0, 6)) {
    L.push(`       ! ${(e.message ?? JSON.stringify(e)).trim()}`);
  }
} else {
  const s = validateHard.stats;
  const detail = s ? `${s.beats} beats, ${s.notes} notes, ${s.pitchRange ?? 'n/a'}` : '';
  L.push(`  validate --strict    ${mark(validateHard.ok)}   ${detail}`);
  for (const w of (validateHard.warnings ?? [])) L.push(`       ! ${w.message}`);
}

// -- playability (errors HARD, warnings SOFT) --
if (playHard) {
  const nErr = playHard.errors.length;
  const nWarn = playHard.warnings.length;
  L.push(`  playability          ${mark(playHard.ok)}   ${nErr} error${nErr === 1 ? '' : 's'}` +
    ` (${nWarn} soft warning${nWarn === 1 ? '' : 's'}; exit ${playHard.exitCode} ignored)`);
  for (const e of playHard.errors) L.push(`       ! ${e.message}`);
  for (const w of playHard.warnings) L.push(`       ~ soft: ${w.message}`);
} else if (!parseFailed) {
  L.push(`  playability          n/a`);
} else {
  L.push(`  playability          SKIPPED   (tab did not parse)`);
}

// -- compare (fidelity gate; hardGates HARD, soft signals SOFT) --
if (cmpHard) {
  if (cmpHard.mapResults) {
    // Map mode: one line per entry.
    L.push(`  compare (fidelity)   ${mark(cmpHard.ok)}   map ${cmpHard.map}`);
    for (const r of cmpHard.mapResults) {
      const src = r.sourceBars ? `  sourceBars=[${r.sourceBars.join(',')}]` : '';
      const tail = r.ok ? mark(true) : `${mark(false)}  ${r.failures[0].message}`;
      L.push(`       # ${r.mode.padEnd(9)} tabBars=[${r.tabBars.join(',')}]${src}  ${tail}`);
      for (const f of r.failures.slice(1)) L.push(`                       ! ${f.message}`);
    }
  } else {
    const hg = cmpHard.hardGates;
    L.push(`  compare (fidelity)   ${mark(cmpHard.ok)}   ` +
      `melodic skeleton ${hg.melodicSkeleton.covered}/${hg.melodicSkeleton.total} ${mark(hg.melodicSkeleton.ok)}, ` +
      `harmonic roots ${hg.harmonicRoots.covered}/${hg.harmonicRoots.total} ${mark(hg.harmonicRoots.ok)}`);
    const soft = cmpHard.soft ?? {};
    const q = soft.chordQuality ?? {};
    const d = soft.density ?? {};
    L.push(`       ~ soft: chord quality ${q.power ?? 0} power / ${q.exact ?? 0} exact; ` +
      `density ${d.percent === null || d.percent === undefined ? 'n/a' : d.percent + '%'}; ` +
      `contour ${soft.contour?.r === null || soft.contour?.r === undefined ? 'n/a' : soft.contour.r}`);
    for (const dr of (soft.dropped ?? [])) {
      const shown = dr.notes.slice(0, 8).join(' ');
      const more = dr.notes.length > 8 ? ` (+${dr.notes.length - 8} more)` : '';
      L.push(`       ~ dropped bar ${dr.bar}: ${shown}${more}`);
    }
    for (const f of (cmpHard.failures ?? [])) L.push(`       ! ${f.message}`);
  }
} else if (!parseFailed) {
  L.push(`  compare (fidelity)   n/a`);
} else {
  L.push(`  compare (fidelity)   SKIPPED   (tab did not parse)`);
}

// -- midi --
if (midi.written) L.push(`  midi                 wrote ${midi.path}`);
else if (midi.skipped) L.push(`  midi                 SKIPPED (${midi.error})`);
else L.push(`  midi                 FAILED to write — ${midi.error}`);

L.push('');
L.push(gateOk ? 'GATE: PASS' : `GATE: FAIL — ${hardFailReasons.join(', ')}`);
console.log(L.join('\n'));

process.exit(gateOk ? 0 : 1);

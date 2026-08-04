// Vendored from abc-to-guitar@ba7e29c — tools/check.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// check.mjs — the single consolidated chunk-gate orchestrator.
//
// Usage:
//   node tools/check.mjs <tab.alphatab> --bars N-M
//        [--transpose N] [--gain high|crunch|clean] [--digest <path>]
//        [--map <sidecar.json>] [--max-fret N] [--json]
//
// Runs validate --strict -> playability -> compare in order, prints ONE
// consolidated report, and exits non-zero if any HARD gate fails. The skill
// requires this to pass before any tab is shown to the human.
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
// compare live next to this file and are resolved relative to it, so the gate
// works regardless of the caller's cwd. Digests, however, are resolved relative
// to cwd (matching the `analysis/<name>.json` convention in the plan).
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
//   PTG (Wave 0, contract C4): the SOFT block of --json ALWAYS carries all five
//   subsystem keys — playability, compare, fingering, idiom, sidecar — as
//   ARRAYS, in bar-locked AND --map mode. An analyzer that did not run
//   contributes []. `soft.compare` used to be `cmpHard.mapResults ? null :
//   cmpHard.soft`, i.e. null in exactly the mode every real Gate-B run uses, so
//   compare's map-mode contour advisory reached nobody. Soft findings are
//   derived AFTER the verdict below and can never influence it.
//
//   PTG (Wave 1, contract C7): playability's exit code is now TRUSTWORTHY —
//   0 when errors[] is empty, 1 when it is not, 2 on usage/IO — the same rule
//   validate and compare already follow. (It used to exit 1 on warnings too,
//   which is why the code below was written to ignore it.)
//   We nonetheless still key the hard fail on the PARSED `errors[]` rather than
//   on the exit code, and that is deliberate, not leftover distrust: this stage
//   needs the error LIST to print anyway, `errors[]` is the thing the contract
//   defines the gate in terms of, and deriving the verdict from the same datum
//   we report makes the report and the verdict incapable of disagreeing. The
//   defensive JSON parsing stays for the same reason — a sub-tool that produces
//   no JSON at all is an exit-2 setup problem, not a silent pass.
//
// Exit codes: 0 = no hard failure, 1 = a hard gate failed, 2 = usage / IO error
// (bad args, missing --bars, unresolvable digest, or a sub-tool that could not
// run).

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// PTG (Wave 0, contract C3): the one normalized soft-finding shape. This is the
// ONLY library check.mjs imports — the three sub-tools stay child processes.
import { advisory } from './lib/advisory.mjs';
// PTG (Wave 3, contract C6): the style profile is resolved HERE, at the gate's
// CLI boundary, for the same reason the instrument is — so a malformed profile
// is a clear exit 2 from the gate rather than an opaque failure three child
// processes down, and so every analyzer grades against the same one.
import { loadStyleProfile } from './lib/style-profile.mjs';
// PTG (Wave 1, contract C5): configuration precedence lives in ONE module. The
// gate resolves it here, at the CLI boundary, and passes the resolved instrument
// limits down to playability explicitly — so the two stages can never disagree
// about which guitar is being checked.
import { resolveConfig } from './lib/project-config.mjs';
import { emit, emitErr } from './lib/emit.mjs';  // PTG: synchronous stdio

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(TOOLS_DIR);
const tool = (name) => path.join(TOOLS_DIR, name);

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let transpose = 0;
  // PTG (Wave 3, addendum §A1): ABSENT IS NOT A DEFAULT. This used to be the
  // literal string 'high', which erased the difference between "the user asked
  // for high gain" and "the user said nothing" — so a project config or a style
  // profile could never supply a gain, because the CLI had already spoken for
  // the user. `undefined` here; `resolveConfig` is the only place a default is
  // applied. Same rule for --style and every flag added after it.
  let gain;
  let style;
  // PTG (Wave 5, contract C9): track roles. Same absent-is-not-a-default rule.
  let arrangementMode;
  let lead;
  let rhythm;
  let digest = null;
  let map = null;
  let contract = null;      // PTG: melody contract for contract-mode sidecars
  let policy = null;        // PTG: guitar policy for playability (§7)
  let maxFret = null;       // PTG Wave 1 (C5): null = "not set on the CLI"
  let warningsAsErrors = false; // PTG §7.3
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
    else if (a === '--style') style = argv[++i];                      // PTG Wave 3
    else if (a.startsWith('--style=')) style = a.slice('--style='.length);
    else if (a === '--arrangement-mode') arrangementMode = argv[++i];  // PTG Wave 5
    else if (a.startsWith('--arrangement-mode=')) arrangementMode = a.slice('--arrangement-mode='.length);
    else if (a === '--lead') lead = argv[++i];
    else if (a.startsWith('--lead=')) lead = a.slice('--lead='.length);
    else if (a === '--rhythm') rhythm = argv[++i];
    else if (a.startsWith('--rhythm=')) rhythm = a.slice('--rhythm='.length);
    else if (a === '--digest') digest = argv[++i];
    else if (a.startsWith('--digest=')) digest = a.slice('--digest='.length);
    else if (a === '--map') map = argv[++i];
    else if (a.startsWith('--map=')) map = a.slice('--map='.length);
    else if (a === '--contract') contract = argv[++i];   // PTG: melody contract (§5)
    else if (a.startsWith('--contract=')) contract = a.slice('--contract='.length);
    else if (a === '--policy') policy = argv[++i];       // PTG: guitar policy (§7)
    else if (a.startsWith('--policy=')) policy = a.slice('--policy='.length);
    else if (a === '--max-fret') maxFret = argv[++i];    // PTG Wave 1 (C5)
    else if (a.startsWith('--max-fret=')) maxFret = a.slice('--max-fret='.length);
    else if (a === '--warnings-as-errors') warningsAsErrors = true;  // PTG §7.3
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
  }
  return { file, bars, transpose, gain, style, arrangementMode, lead, rhythm, digest, map,
    contract, policy, maxFret, warningsAsErrors, json };
}

function usage(msg) {
  if (msg) emitErr(msg);
  emitErr(
    'Usage: node tools/check.mjs <tab.alphatab> --bars N-M ' +
    '[--transpose N] [--gain high|crunch|clean] [--style hard-rock|metal|blues|jazz] ' +
    '[--arrangement-mode solo|dual-guitar] [--lead 0,2] [--rhythm 1,3] ' +
    '[--digest <path>] [--map <sidecar.json>] [--contract <melody-contract.json>] ' +
    '[--policy <guitar-policy.json>] [--max-fret N] [--warnings-as-errors] [--json]');
  process.exit(2);
}

const {
  file, bars, transpose, gain: gainArg, style: styleArg,
  arrangementMode: modeArg, lead: leadArg, rhythm: rhythmArg,
  digest: digestArg, map: mapArg,
  contract: contractArg, policy: policyArg, maxFret: maxFretArg, warningsAsErrors, json,
} = parseArgs(process.argv.slice(2));

/** "0,2" -> [0,2]; undefined stays undefined (§A1: absent is not a default). */
function parseTrackList(spec, flag) {
  if (spec === undefined) return undefined;
  const parts = String(spec).split(',').map((x) => x.trim()).filter((x) => x !== '');
  const out = parts.map(Number);
  if (!out.length || out.some((n) => !Number.isInteger(n) || n < 0)) {
    usage(`Bad ${flag} "${spec}"; expected a comma-separated list of track indices, e.g. 0,2`);
  }
  return out;
}

if (!file) usage('No tab file given.');
if (!bars) usage('--bars N-M is required (compare needs a bar range).');
if (!/^\d+(?:-\d+)?$/.test(String(bars).trim())) usage(`Bad --bars "${bars}"; expected N or N-M.`);
// Shape-check a SUPPLIED value here (so the message names the flag); an absent
// one is left for resolveConfig to fill from config > profile > built-in.
if (gainArg !== undefined && !['high', 'crunch', 'clean'].includes(gainArg)) {
  usage(`Bad --gain "${gainArg}"; expected high|crunch|clean.`);
}
const transposeNum = Number(transpose);
if (!Number.isFinite(transposeNum)) usage(`Bad --transpose "${transpose}"; expected an integer semitone offset.`);
if (!fs.existsSync(file)) usage(`No tab at "${file}".`);

// ---- PTG (Wave 1, contract C5): instrument configuration ------------------
// Resolved HERE so a malformed `config.json` is a clear exit 2 from the gate
// itself, not an opaque failure inside a child process — and so the resolved
// number is passed to playability EXPLICITLY (as `--max-fret`) instead of both
// tools independently re-walking the filesystem and hoping to agree.
// Precedence: --max-fret > <dir of tab>/…/config.json > built-in 22.
if (maxFretArg !== null && !/^\d+$/.test(String(maxFretArg).trim())) {
  usage(`Bad --max-fret "${maxFretArg}"; expected a positive integer.`);
}

// ---- PTG (Wave 3, contract C6 + addendum §A1): style, in TWO stages ---------
// The profile supplies `defaultGain` to the configuration ladder, but the
// profile cannot be loaded until its NAME is resolved, and the name comes from
// the config file. So: resolve the name with no profile in play, load and
// validate that profile, then resolve everything again WITH it. The config file
// is read twice in the worst case; that is cheaper than a cache whose staleness
// nobody can see, and the file is a few hundred bytes.
//
// An unknown or malformed style is exit 2, never a fallback to hard-rock: a run
// that grades a jazz arrangement against rock weights while printing "jazz" is
// worse than a run that refuses.
const cliOverrides = {
  style: styleArg,
  gain: gainArg,
  maxFret: maxFretArg === null ? undefined : Number(maxFretArg),
  arrangementMode: modeArg,
  lead: parseTrackList(leadArg, '--lead'),
  rhythm: parseTrackList(rhythmArg, '--rhythm'),
};
const stage1 = resolveConfig({ anchorPath: file, cli: cliOverrides });
if (!stage1.ok) usage(stage1.errors.join('\n'));

const loadedStyle = loadStyleProfile(stage1.style);
if (!loadedStyle.ok) usage(loadedStyle.errors.join('\n'));
const styleProfile = loadedStyle.profile;

const config = resolveConfig({ anchorPath: file, cli: cliOverrides, styleProfile });
if (!config.ok) usage(config.errors.join('\n'));
const gain = config.gain;

// ---- digest resolution ----------------------------------------------------
// Resolution order: --digest (explicit, wins) -> co-located ./source.json next
// to the tab (the project-local convention, projects/<slug>/) -> legacy
// analysis/<tabBasename>.json. The first of the co-located/legacy pair that
// exists is used.  // PTG: project-layout fallback (was analysis/-only)
const tabBase = path.basename(file, path.extname(file));
const coLocatedDigestPath = path.join(path.dirname(file), 'source.json');  // PTG: project-local convention
const legacyDigestPath = path.join('analysis', `${tabBase}.json`);  // PTG: legacy fallback
const digestPath = digestArg ?? (fs.existsSync(coLocatedDigestPath) ? coLocatedDigestPath : legacyDigestPath);  // PTG: new resolution order
if (!fs.existsSync(digestPath)) {
  usage(
    `No digest at ${digestPath} — pass --digest <path> or run: ` +
    `node tools/piano-extract.mjs projects/<slug>/source.alphatab --out projects/<slug>`);  // PTG: project-layout hint
}

// ---- map resolution -------------------------------------------------------
// --map is optional. Resolved relative to cwd (same convention as the digest),
// and its existence is checked here so a typo is a clear exit-2 instead of an
// opaque error from compare.mjs later.
const mapPath = mapArg ?? null;
if (mapPath && !fs.existsSync(mapPath)) {
  usage(`No map sidecar at "${mapPath}"`);
}

// PTG: --contract is passed straight through to compare.mjs (contract-mode
// sidecars). Existence checked here for a clear exit-2 on typos.
const contractPath = contractArg ?? null;
if (contractPath && !fs.existsSync(contractPath)) {
  usage(`No melody contract at "${contractPath}"`);
}

// PTG: --policy is passed straight through to playability.mjs (§7).
const policyPath = policyArg ?? null;
if (policyPath && !fs.existsSync(policyPath)) {
  usage(`No guitar policy at "${policyPath}"`);
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
// unparseable, so playability/compare cannot run meaningfully downstream.
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
  // STAGE 2: playability — gate on the parsed errors[] (see the header note).
  const playArgs = [file, '--bars', bars, '--gain', gain];
  // PTG (Wave 1, C5): pass the ALREADY-RESOLVED instrument limit. Because CLI
  // beats config in playability too, this is idempotent — the child reaches the
  // same answer whether or not it finds the same config.json.
  playArgs.push('--max-fret', String(config.instrument.maxFret));
  if (policyPath) playArgs.push('--policy', policyPath);          // PTG §7
  if (warningsAsErrors) playArgs.push('--warnings-as-errors');    // PTG §7.3
  const P = run('playability.mjs', playArgs);
  if (P.json === null) {
    toolError = toolError ?? `playability.mjs produced no JSON:\n${(P.stderr || P.stdout || '').trim()}`;
  } else {
    playHard = {
      ok: (P.json.errors?.length ?? 0) === 0,   // HARD = errors[] empty
      errors: P.json.errors ?? [],
      warnings: P.json.warnings ?? [],          // SOFT — surfaced, never gates
      stats: P.json.stats,
      exitCode: P.code,   // recorded for diagnostics; C7 makes it agree with ok
    };
  }

  // STAGE 3: compare — the fidelity gate. Exit 0 pass / 1 hard-fail / 2 IO.
  // PTG (Wave 4): the ALREADY-RESOLVED style and gain travel down explicitly,
  // exactly as `--max-fret` does. compare would otherwise re-walk the filesystem
  // for a config and could reach a different answer than the gate printed.
  const cmpArgs = [file, digestPath, '--bars', bars, '--transpose', String(transposeNum),
    '--style', config.style, '--gain', gain,
    '--arrangement-mode', config.arrangementMode, '--json'];
  if (config.tracks.lead.length) cmpArgs.push('--lead', config.tracks.lead.join(','));
  if (config.tracks.rhythm.length) cmpArgs.push('--rhythm', config.tracks.rhythm.join(','));
  if (mapPath) cmpArgs.push('--map', mapPath);
  if (contractPath) cmpArgs.push('--contract', contractPath);   // PTG
  const C = run('compare.mjs', cmpArgs);
  if (C.code === 2) {
    cmpIoError = (C.stderr || C.stdout || 'compare reported an IO/usage error').trim();
  } else if (C.json === null) {
    toolError = toolError ?? `compare.mjs produced no JSON:\n${(C.stderr || C.stdout || '').trim()}`;
  } else {
    cmpHard = { ok: C.code === 0, ...C.json };   // C.json.ok already === (code===0)
  }
}

// ---- STAGES 4 & 5: the SOFT analyzers (PTG, Wave 3) ------------------------
// Same subprocess design as the hard stages, for the same reason: these tools
// each `process.exit`, and running the gate's analyzers exactly the way a human
// runs them by hand is what keeps the two from drifting.
//
// They run only on a tab that PARSED. Anything else would be analysing a file
// the gate has already declared unreadable, and the advisories would describe a
// score nobody has.
//
// THE ONE RULE THAT MATTERS HERE (Implement.md §3.6): a soft analyzer that could
// not run is an OPERATIONAL failure (exit 2), never an empty advisory array. An
// empty array is a claim — "we looked and found nothing" — and a crashed
// analyzer has no right to make it. Both tools are soft-only (C2), so a nonzero
// exit from either can only mean usage/IO/parse trouble.
let fingeringSoft = null;
let idiomSoft = null;
let sidecarSoft = null;

if (!parseFailed && !toolError) {
  const fingArgs = [file, '--bars', bars, '--max-fret', String(config.instrument.maxFret),
    '--arrangement-mode', config.arrangementMode];
  if (config.tracks.lead.length) fingArgs.push('--lead', config.tracks.lead.join(','));
  if (config.tracks.rhythm.length) fingArgs.push('--rhythm', config.tracks.rhythm.join(','));
  fingArgs.push('--json');
  const F = run('fingering.mjs', fingArgs);
  if (F.code !== 0 || F.json === null || F.json.ok !== true) {
    toolError = toolError ?? `fingering.mjs could not analyse the tab (exit ${F.code}):\n`
      + `${(F.json?.errors ?? []).join('\n') || (F.stderr || F.stdout || '').trim()}`;
  } else {
    fingeringSoft = F.json;
  }

  const I = run('idiom.mjs', [file, '--bars', bars, '--style', config.style, '--json']);
  if (I.code !== 0 || I.json === null || I.json.ok !== true) {
    toolError = toolError ?? `idiom.mjs could not analyse the tab (exit ${I.code}):\n`
      + `${(I.json?.errors ?? []).join('\n') || (I.stderr || I.stdout || '').trim()}`;
  } else {
    idiomSoft = I.json;
  }

  // STAGE 6 (PTG, Wave 4): the sidecar audit — ONLY when a map was supplied.
  // Without one there is no correspondence map to read, and a `[]` here means
  // exactly that: not "we audited and found nothing".
  if (mapPath) {
    const S = run('sidecar-audit.mjs', [
      '--digest', digestPath, '--map', mapPath, '--bars', bars, '--style', config.style, '--json']);
    if (S.code !== 0 || S.json === null || S.json.ok !== true) {
      toolError = toolError ?? `sidecar-audit.mjs could not audit the map (exit ${S.code}):\n`
        + `${(S.json?.errors ?? []).join('\n') || (S.stderr || S.stdout || '').trim()}`;
    } else {
      sidecarSoft = S.json;
    }
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
        else if (f.gate === 'contract') gates.add('compare melody contract');   // PTG
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

// ---- SOFT advisories (contracts C3 + C4) ----------------------------------
// Everything below this line is DERIVED from results already computed above.
// `gateOk` is fixed; nothing here can move it. That ordering is the guarantee
// the contract asks for ("soft output never influences the gate result"), made
// structural rather than promised.
//
// The subsystem order is the report order, and it is stable: playability and
// compare exist today, fingering/idiom/sidecar are filled by Waves 2/3/4 and
// ship as [] now so a consumer never has to feature-detect a key.
const SOFT_SUBSYSTEMS = ['playability', 'compare', 'fingering', 'idiom', 'sidecar'];

/**
 * Adapt compare's TWO legacy soft shapes into contract-C3 advisories.
 *
 * compare.mjs speaks a different soft dialect per mode — map mode emits
 * `soft.contourWarnings[]`, bar-locked mode emits a nested
 * `{chordQuality, density, dropped, contour}` object. Neither is retro-fitted
 * (existing tests pin both, and C3 says so explicitly); they are translated
 * HERE, at the boundary, so every consumer downstream sees one shape.
 *
 * Each advisory is emitted only when its underlying datum actually exists — an
 * absent measurement must read as "not measured", never as a finding of zero.
 */
function deriveCompareAdvisories(cmp) {
  const out = [];
  if (!cmp) return out;

  // --- map mode -------------------------------------------------------------
  // compare computes these per `quote` entry and prints them in its own human
  // report; before Wave 0 they never reached check.mjs's JSON at all.
  if (cmp.mapResults) {
    for (const cw of cmp.soft?.contourWarnings ?? []) {
      out.push(advisory(
        'compare.contour',
        `quote span tab bars [${cw.tabBars.join(',')}] (source bars [${cw.sourceBars.join(',')}]): `
        + `top line runs opposite the quoted source melody (r=${cw.r}) — confirm the inversion is intended`,
        { data: { tabBars: cw.tabBars, sourceBars: cw.sourceBars, r: cw.r } },
      ));
    }
    // PTG (Wave 4): compare's own C3-shaped advisories — today that means
    // `harmonic-flattening`. They arrive already normalized (the Wave-4 library
    // was built against the advisory contract), so unlike the two legacy shapes
    // above there is nothing to translate: pass them through verbatim rather
    // than re-wording them and inventing a second source of truth.
    out.push(...(cmp.soft?.advisories ?? []));
    return out;
  }

  // --- bar-locked mode ------------------------------------------------------
  const soft = cmp.soft ?? {};

  // Dropped notes: one advisory per bar, so a consumer can locate them. The
  // list is capped in the PROSE only — `data.notes` keeps every name.
  for (const dr of soft.dropped ?? []) {
    const shown = dr.notes.slice(0, 8).join(' ');
    const more = dr.notes.length > 8 ? ` (+${dr.notes.length - 8} more)` : '';
    out.push(advisory(
      'compare.dropped-notes',
      `bar ${dr.bar}: source pitch class(es) absent from the tab bar — ${shown}${more}`,
      { bar: dr.bar, data: { bar: dr.bar, notes: dr.notes } },
    ));
  }

  // Density: INFO, never a warning. A rock reduction is supposed to be sparse
  // (AGENTS.md: "Low density is expected and good") — this is context for the
  // human at the gate, not a defect claim.
  const percent = soft.density?.percent;
  if (percent !== undefined && percent !== null && percent < 100) {
    out.push(advisory(
      'compare.low-density',
      `${percent}% of source notes retained — reduction is expected in a cover; `
      + 'weigh it against the source, do not treat it as a loss to fix',
      { severity: 'info', data: { percent } },
    ));
  }

  // Contour: any NEGATIVE correlation is surfaced here (C4), which is a wider
  // net than compare's own printed warning (r < -0.5). Inverting the top line
  // is a legitimate arranging choice; the advisory asks for confirmation, and
  // `data.r` carries the magnitude so the reader can judge how strong it is.
  const r = soft.contour?.r;
  if (r !== undefined && r !== null && r < 0) {
    out.push(advisory(
      'compare.contour',
      `tab top line correlates ${r} with the source melody — the shapes run opposite; `
      + 'confirm the inversion is intended',
      { data: { r } },
    ));
  }

  // Chord quality: INFO, and deliberately not framed as a miss. A power chord
  // (root+5th, no 3rd) renders BOTH major and minor correctly — C11 invariant 4
  // says a missing 3rd is never a fidelity failure.
  const q = soft.chordQuality;
  if (q) {
    out.push(advisory(
      'compare.chord-quality',
      `${q.power ?? 0} bar(s) voiced as power chords (major/minor neutral), `
      + `${q.exact ?? 0} with an explicit 3rd — a missing 3rd is never a miss`,
      { severity: 'info', data: { power: q.power, exact: q.exact } },
    ));
  }

  return out;
}

// ---- machine output -------------------------------------------------------
const machine = {
  ok: gateOk,
  file,
  bars,
  transpose: transposeNum,
  gain,
  digest: digestPath,
  // PTG (Wave 1, C5): the resolved instrument and its provenance travel with the
  // verdict, so a stored gate report says which guitar it graded.
  instrument: config.instrument,
  configPath: config.configPath,
  configSources: config.sources,
  // PTG (Wave 3): the resolved run configuration, ADDITIVELY — every historical
  // field above is untouched. `provenance` is what makes a stored report
  // self-explaining: "gain: high (style-profile)" answers "why was it high?"
  // without anyone re-deriving the merge months later.
  configuration: {
    style: config.style,
    gain: config.gain,
    arrangementMode: config.arrangementMode,
    tracks: { lead: config.tracks.lead, rhythm: config.tracks.rhythm },
    maxFret: config.instrument.maxFret,
    stringCount: config.instrument.stringCount,
    provenance: config.sources,
  },
  hard: {
    validate: validateHard,
    playability: playHard && { ok: playHard.ok, errors: playHard.errors, stats: playHard.stats },
    compare: cmpHard && (cmpHard.mapResults
      ? { ok: cmpHard.ok, map: cmpHard.map, mapResults: cmpHard.mapResults, failures: cmpHard.failures }
      : {
        ok: cmpHard.ok,
        hardGates: cmpHard.hardGates,
        failures: cmpHard.failures,
        // PTG (Wave 0, C4): compare's raw bar-locked soft object, preserved
        // VERBATIM. `soft.compare` below is now the derived advisory view; a
        // reader (or an older consumer) that wants the original
        // chordQuality/density/dropped/contour numbers still finds them, so
        // normalizing the soft channel regressed nothing.
        soft: cmpHard.soft,
      }),
  },
  // PTG (Wave 0, contract C4): all five keys, always, as arrays, in both modes.
  soft: {
    // playability keeps its NATIVE {type, message, bar, …} warning shape —
    // existing tests pin it and C3 forbids retro-fitting it. [] when the stage
    // did not run, never null.
    playability: playHard ? playHard.warnings : [],
    compare: deriveCompareAdvisories(cmpHard),
    // Already C3-shaped at the source — these two analyzers were built against
    // the advisory contract, so unlike playability/compare there is nothing to
    // adapt at this boundary. [] here means "the stage did not run", which only
    // happens on a tab that did not parse; a stage that ran and failed is a
    // toolError above, not an empty array.
    fingering: fingeringSoft ? fingeringSoft.advisories : [],
    idiom: idiomSoft ? idiomSoft.advisories : [],
    // [] with no --map means "there was no map to audit", which is the honest
    // reading of an empty array here: bar-locked mode has no correspondence
    // claims to check.
    sidecar: sidecarSoft ? sidecarSoft.advisories : [],
  },
  // PTG (Wave 3): the soft analyzers' own summaries, so a stored report can say
  // WHY an idiom advisory did or did not fire without re-running anything.
  analyzers: {
    fingering: fingeringSoft && { stats: fingeringSoft.stats, settings: fingeringSoft.settings },
    idiom: idiomSoft && {
      score: idiomSoft.score,
      graded: idiomSoft.graded,
      features: idiomSoft.features,
      weightedScore: idiomSoft.weightedScore,
      stats: idiomSoft.stats,
      settings: idiomSoft.settings,
    },
    sidecar: sidecarSoft && { metrics: sidecarSoft.metrics, stats: sidecarSoft.stats },
    // PTG (Wave 5): the roles compare RESOLVED against the parsed score — which
    // tracks each question was allowed to look at. `configuration.tracks` above
    // says what was ASKED for; this says what it resolved to.
    roles: cmpHard?.roles ?? null,
    // compare's harmonic-colour pass is a property of the fidelity stage, so its
    // summary rides with the compare result rather than becoming a sixth stage.
    harmonicColor: cmpHard?.harmonicColor?.stats ?? null,
  },
  failReasons: hardFailReasons,
};

if (json) {
  emit(JSON.stringify(machine, null, 2));
  process.exit(gateOk ? 0 : 1);
}

// ---- human-readable consolidated report -----------------------------------
const mark = (ok) => (ok ? 'PASS' : 'FAIL');
const tsign = transposeNum >= 0 ? `+${transposeNum}` : `${transposeNum}`;
const L = [];

L.push(`CHECK  ${file}`);
L.push(`       bars ${bars}   transpose ${tsign}   gain ${gain} (${config.sources.gain})`
  + `   style ${config.style} (${config.sources.style})`);
L.push(`       digest ${digestPath}`);
// PTG (Wave 1, C5): print the instrument line only when something OVERRODE the
// built-in. On a default run it is noise; on a configured run it is the first
// thing a reader needs to interpret a fret-range finding.
if (config.sources.maxFret !== 'default' || config.sources.stringCount !== 'default') {
  L.push(`       instrument max fret ${config.instrument.maxFret} (${config.sources.maxFret})`
    + `   strings ${config.instrument.stringCount} (${config.sources.stringCount})`
    + (config.configPath ? `   config ${config.configPath}` : ''));
}
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
  // PTG (Wave 1, C7): the old text read "exit N ignored" — accurate when
  // playability exited 1 on warnings, and actively misleading now that it does
  // not. Soft warnings are still reported and still never gate; the exit code
  // simply agrees with the verdict.
  L.push(`  playability          ${mark(playHard.ok)}   ${nErr} error${nErr === 1 ? '' : 's'}` +
    ` (${nWarn} soft warning${nWarn === 1 ? '' : 's'}, non-gating)`);
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
      const ph = r.contractPhrase ? ` phrase="${r.contractPhrase}"` : '';  // PTG
      const tail = r.ok ? mark(true) : `${mark(false)}  ${r.failures[0].message}`;
      L.push(`       # ${r.mode.padEnd(9)} tabBars=[${r.tabBars.join(',')}]${src}${ph}  ${tail}`);
      for (const f of r.failures.slice(1)) L.push(`                       ! ${f.message}`);
      if (r.totals) {   // PTG §5.3: contract obligations are always shown, never 0/0
        const t = r.totals;
        const bits = [`attacks ${t.foregroundAttacks.covered}/${t.foregroundAttacks.total}`];
        if (t.durationObligations.total) bits.push(`durations ${t.durationObligations.covered}/${t.durationObligations.total}`);
        if (t.requiredGaps.total) bits.push(`gaps ${t.requiredGaps.covered}/${t.requiredGaps.total}`);
        if (t.forbiddenRules.total) bits.push(`forbidden ${t.forbiddenRules.covered}/${t.forbiddenRules.total}`);
        L.push(`                       ~ contract obligations: ${bits.join(', ')}`);
      }
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

// -- soft analyzers (PTG, Wave 3): one line each, never a verdict -------------
// Deliberately marked SOFT rather than PASS/FAIL. These stages have no pass, and
// printing one in the same column as the hard gates would train the eye to read
// them as gates — which is exactly the confusion contract C4 exists to prevent.
if (fingeringSoft) {
  const s = fingeringSoft.stats;
  L.push(`  fingering            SOFT   ${s.phrasesImproved}/${s.phrases} phrase(s) have a `
    + `cheaper alternative (${s.events} attacks)`);
} else if (parseFailed) {
  L.push(`  fingering            SKIPPED   (tab did not parse)`);
}
if (idiomSoft) {
  const detail = idiomSoft.graded
    ? `density ${idiomSoft.score}/10 vs ${idiomSoft.settings.style} floor ${idiomSoft.settings.warnBelow}`
    : `not graded — ${idiomSoft.stats.attackEvents} attack(s) is too little evidence`;
  L.push(`  idiom                SOFT   ${detail}`);
} else if (parseFailed) {
  L.push(`  idiom                SKIPPED   (tab did not parse)`);
}
if (sidecarSoft) {
  const t = sidecarSoft.metrics.tabSpace;
  const m = sidecarSoft.metrics.melodySkeletonSpace;
  L.push(`  sidecar audit        SOFT   ${t.quoteTabBars} quote / ${t.recomposeTabBars} recompose / `
    + `${t.contractTabBars} contract / ${t.freeTabBars} free of ${t.totalTabBars} tab bar(s); `
    + `${m.coveredByQuote}/${m.total} skeleton note(s) protected`);
}

// -- SOFT ADVISORIES (PTG, Wave 0, contract C4) --
// ONE trailing roll-up of every soft finding, grouped by subsystem. The
// per-stage `~ soft:` lines above are untouched — this is an ADDITIONAL
// summary, not a replacement, because those lines carry per-stage context this
// one deliberately drops.
//
// Printed only when something is in it. An always-present empty
// "SOFT ADVISORIES" header would train the reader to skip the section, which is
// the exact failure mode a summary exists to prevent.
const softLines = [];
for (const name of SOFT_SUBSYSTEMS) {
  const list = machine.soft[name] ?? [];
  if (!list.length) continue;
  softLines.push(`  ${name.padEnd(14)}(${list.length})`);
  for (const a of list) {
    // `code` for C3 advisories, `type` for playability's native warning shape.
    const tag = a.code ?? a.type ?? 'soft';
    softLines.push(`    ~ [${tag}] ${a.message}`);
  }
}
if (softLines.length) {
  L.push('');
  L.push('SOFT ADVISORIES');
  L.push('---------------');
  L.push(...softLines);
}

L.push('');
L.push(gateOk ? 'GATE: PASS' : `GATE: FAIL — ${hardFailReasons.join(', ')}`);
emit(L.join('\n'));

process.exit(gateOk ? 0 : 1);

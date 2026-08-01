// tools/lib/sidecar.mjs — sidecar (correspondence-map) semantics, in ONE place.
//
// EXTRACTED from tools/compare.mjs in Wave 0 (contract C8), BEHAVIOR-PRESERVING:
// every message string, every validation ORDER, and every exit-2 condition is
// byte-identical to what `loadAndValidateMap` did inline. Nothing here was
// redesigned; the sidecar language is exactly what it was.
//
// WHY EXTRACT IT AT ALL
// ---------------------
// Wave 4 adds `tools/sidecar-audit.mjs`, which must read a sidecar with the
// SAME semantics compare.mjs gates on. Two copies of a fail-closed validator
// drift, and the drift is invisible: the audit would report on a sidecar the
// gate would have refused, or vice versa. One module, one semantics.
//
// THE ONE STRUCTURAL CHANGE: A LIBRARY MUST NOT `process.exit`
// -----------------------------------------------------------
// compare.mjs's inline validator called `mapUsage(msg)`, which printed
// `compare: <msg>` to stderr and exited 2 — on the FIRST failure, so nothing
// after it ran. A library that exits is unusable from a test or a second tool.
// So these functions RETURN `{ok:false, errors:[{message}]}` on the first
// failure and the CALLER does the exiting. compare.mjs feeds
// `errors[0].message` straight back into its own `mapUsage()`, which is why the
// stderr text and the exit code are unchanged. `errors` is an array (contract
// C8) but only ever carries the first failure — fail-closed validation stops at
// the first problem, exactly as the exiting version did.
//
// Contract resolution imports `./contract.mjs` DIRECTLY rather than taking the
// three functions through `ctx`. contract.mjs is already a side-effect-free
// library; injecting them would have bought testability we already have and
// cost a way for a caller to hand the sidecar validator a different contract
// validator than the gate uses — precisely the drift this extraction exists to
// prevent.
//
// The `free` mode has NO `sourceBars` by construction (C8/C10): free spans are
// composed material with no source correspondence. Never fabricate one.

import * as fs from 'fs';
import path from 'path';
import { loadContract, validateContract, findPhrase } from './contract.mjs';

/** Every legal sidecar entry mode, in the order the error message lists them. */
export const SIDECAR_MODES = ['free', 'quote', 'recompose', 'contract', 'contract-recompose'];
/** The subset that pins a span to a melody-contract phrase (Improve_Plan §5). */
export const CONTRACT_MODES = ['contract', 'contract-recompose'];

/** First-failure result. The caller turns `message` into its own usage error. */
const fail = (message) => ({ ok: false, entries: [], contract: null, errors: [{ message }] });

/** Validate a [start, end] inclusive range; return null when well-formed, else
 *  the reason fragment the caller splices into its message. */
function badRange(r) {
  if (!Array.isArray(r) || r.length !== 2) return 'not a 2-element array';
  const [s, e] = r;
  if (!Number.isInteger(s) || !Number.isInteger(e)) return 'values not integers';
  if (s < 1 || e < 1) return 'values < 1';
  if (e < s) return 'end < start';
  return null;
}

/** Top-level shape checks, shared by loadSidecar and validateSidecar so the
 *  order is stated once. Returns a message, or null when the shape is fine. */
function topLevelProblem(data) {
  if (!data || typeof data !== 'object') return 'map file unreadable: top level is not an object';
  if (!Array.isArray(data.entries)) return 'map missing "entries" array';
  if (data.entries.length === 0) return 'map "entries" is empty';
  return null;
}

/**
 * Read + JSON.parse a sidecar and check its top-level shape.
 * -> { ok, data, errors:[{message}] }
 *
 * An unreadable file and unparseable JSON deliberately share one message
 * ("map file unreadable: …"): from the caller's side both mean "there is no
 * sidecar here", and the underlying `e.message` already says which.
 */
export function loadSidecar(mapPath) {
  let raw;
  try {
    raw = fs.readFileSync(mapPath, 'utf8');
  } catch (e) {
    return { ...fail(`map file unreadable: ${e.message}`), data: null };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ...fail(`map file unreadable: ${e.message}`), data: null };
  }
  const problem = topLevelProblem(data);
  if (problem) return { ...fail(problem), data };
  return { ok: true, data, errors: [] };
}

/**
 * Fail-closed-validate a parsed sidecar.
 *
 *   validateSidecar(data, { range, digestByBar, digest, contractArg, mapPath })
 *   -> { ok, entries, contract, errors:[{message}], song? }
 *
 * `ctx`:
 *   range        {lo, hi} — the --bars window every tab bar of which must be covered
 *   digestByBar  Map<barNumber, digestBar> — source-bar existence is verified UP
 *                FRONT so per-mode logic downstream can `.get()` without re-checking
 *   digest       the whole digest, for validateContract()
 *   contractArg  --contract path (wins over the sidecar's own "contract" field)
 *   mapPath      the sidecar's own path — the sidecar's "contract" is relative to it
 *
 * Each normalized entry: `{ mode, tabBars:[s,e], sourceBars?:[s,e],
 * contractPhrase?, note? }`.
 *
 * PTG (Improve_Plan §5): modes `contract` / `contract-recompose` pin a tab span
 * to a melody-contract PHRASE. The contract is fully validated against the
 * digest BEFORE any gate runs — an invalid or vacuous contract is a refusal,
 * never a PASS.
 */
export function validateSidecar(data, ctx = {}) {
  const { range, digestByBar, digest, contractArg = null, mapPath = null } = ctx;

  // Re-checked here (loadSidecar already did it) so validateSidecar is safe to
  // call standalone on an in-memory sidecar — Wave 4's audit tool will.
  const problem = topLevelProblem(data);
  if (problem) return fail(problem);
  const parsed = data;

  // --- resolve + validate the melody contract, when any entry needs one -----
  const needsContract = parsed.entries.some((e) => CONTRACT_MODES.includes(e?.mode));
  let contract = null;
  if (needsContract) {
    const contractPath = contractArg
      // A sidecar-relative "contract" path needs the sidecar's own location; a
      // caller that validates an in-memory sidecar has none, and gets the same
      // "no contract file" refusal rather than a crash.
      ?? (typeof parsed.contract === 'string' && mapPath
        ? path.resolve(path.dirname(path.resolve(mapPath)), parsed.contract)
        : null);
    if (!contractPath) {
      return fail('map has contract-mode entries but no contract file: pass --contract '
        + 'or set a top-level "contract" path in the sidecar');
    }
    const loadedContract = loadContract(contractPath);
    if (!loadedContract.ok) return fail(loadedContract.errors[0].message);
    const validation = validateContract(loadedContract.contract, digest);
    if (!validation.ok) {
      return fail(`melody contract ${contractPath} is INVALID — the gate refuses to run on it:\n`
        + validation.errors.map((e) => `  ${e.where}: ${e.message}`).join('\n'));
    }
    contract = loadedContract.contract;
  }

  // --- per-entry validation, in declaration order --------------------------
  const seen = new Map(); // tabBar -> entryIndex, for coverage/overlap
  const entries = [];
  for (let i = 0; i < parsed.entries.length; i++) {
    const entry = parsed.entries[i];
    if (!entry || typeof entry !== 'object') return fail(`entry ${i} is not an object`);
    if (!('tabBars' in entry)) return fail(`entry ${i} missing "tabBars"`);
    if (!('mode' in entry)) return fail(`entry ${i} missing "mode"`);
    const mode = entry.mode;
    if (!SIDECAR_MODES.includes(mode)) {
      return fail(`entry ${i} mode "${mode}" not in {${SIDECAR_MODES.join(', ')}}`);
    }
    const tb = badRange(entry.tabBars);
    if (tb) return fail(`entry ${i} tabBars ${tb} (got ${JSON.stringify(entry.tabBars)})`);
    const [tS, tE] = entry.tabBars;

    let sourceBars;
    let contractPhrase;
    if (CONTRACT_MODES.includes(mode)) {
      if (typeof entry.contractPhrase !== 'string' || !entry.contractPhrase) {
        return fail(`entry ${i} mode "${mode}" requires "contractPhrase"`);
      }
      const phrase = findPhrase(contract, entry.contractPhrase);
      if (!phrase) return fail(`entry ${i} contractPhrase "${entry.contractPhrase}" not found in the contract`);
      contractPhrase = entry.contractPhrase;
      // sourceBars come from the PHRASE — a contract span is source-tied by
      // construction; the contract validator already checked bar existence.
      sourceBars = [phrase.sourceBars[0], phrase.sourceBars[1]];
      for (let b = sourceBars[0]; b <= sourceBars[1]; b++) {
        if (!digestByBar.has(b)) {
          return fail(`entry ${i} phrase "${contractPhrase}" references bar ${b}, absent from the digest`);
        }
      }
    } else if (mode !== 'free') {
      // `free` carries NO sourceBars by construction (C8) — added material has
      // no source correspondence to state.
      if (!('sourceBars' in entry)) return fail(`entry ${i} mode "${mode}" requires "sourceBars"`);
      const sb = badRange(entry.sourceBars);
      if (sb) return fail(`entry ${i} sourceBars ${sb} (got ${JSON.stringify(entry.sourceBars)})`);
      const [sS, sE] = entry.sourceBars;
      for (let b = sS; b <= sE; b++) {
        if (!digestByBar.has(b)) {
          return fail(`entry ${i} sourceBars references bar ${b}, absent from the digest`);
        }
      }
      sourceBars = [sS, sE];
    }

    // Overlap check across tabBars ranges (any bar in exactly two entries =>
    // covered-by-multiple, which also fails the coverage check below; this
    // explicit pass makes the message unambiguous).
    for (let b = tS; b <= tE; b++) {
      if (seen.has(b)) return fail(`tab bar ${b} is covered by multiple entries`);
      seen.set(b, i);
    }

    const out = { mode, tabBars: [tS, tE] };
    if (sourceBars) out.sourceBars = sourceBars;
    if (contractPhrase) out.contractPhrase = contractPhrase;
    if ('note' in entry) out.note = entry.note;
    entries.push(out);
  }

  // Coverage check: every tab bar in --bars must be covered by exactly one
  // entry. (Overlaps were rejected above, so this only catches gaps.)
  for (let b = range.lo; b <= range.hi; b++) {
    if (!seen.has(b)) return fail(`tab bar ${b} is uncovered`);
  }

  const result = { ok: true, entries, contract, errors: [] };
  if (parsed.song !== undefined) result.song = parsed.song;
  return result;
}

/**
 * The entries whose tab span INTERSECTS [range.lo, range.hi] — i.e. the ones a
 * given --bars run actually evaluates.
 *
 * Coverage/overlap were already verified across the union of ALL entries by
 * validateSidecar, so an entry entirely outside --bars still did its job as
 * part of the coverage proof; it is simply not graded on this run.
 */
export function resolveMappedSpans(entries, range) {
  return (entries ?? []).filter((e) => {
    const [tS, tE] = e.tabBars;
    return tE >= range.lo && tS <= range.hi;
  });
}

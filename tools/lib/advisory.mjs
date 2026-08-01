// tools/lib/advisory.mjs — the ONE shape every NEW soft finding takes.
// PTG-native (Wave 0). Contract C3 in docs/specs/upgrade-contracts.md owns this
// surface; this file implements it and may not redefine it.
//
// WHY THIS EXISTS
// ---------------
// Before Wave 0 every analyzer invented its own advisory shape: playability
// emits `{type, message, bar, …}`, compare emits one nested
// `{chordQuality, density, dropped, contour}` object in bar-locked mode and a
// `{contourWarnings:[…]}` object in --map mode. So every CONSUMER (check.mjs,
// the history store, the Wave-4 audit tool) had to know every PRODUCER's
// private shape, and each new analyzer meant a new special case at each
// consumer. That is exactly how `soft.compare` came to be `null` in map mode
// without anyone noticing: nothing had a shape to be empty in.
//
// From Wave 0 on, a new soft finding is one flat object with a namespaced
// `code`. The two legacy shapes are deliberately NOT retro-fitted — existing
// tests pin them, and rewriting them would be a behavior change dressed as a
// cleanup. They are ADAPTED at the check.mjs boundary instead (contract C4).
//
// TESTS ASSERT `code`, NEVER PROSE. Message wording is free to improve; a code
// is a promise. That is why `code` is the required, validated field, and why
// C3 reserves a namespace per wave (`fingering.*`, `idiom.*`, `sidecar.*`, …).
//
// Pure ESM, node builtins only, NO top-level side effects — check.mjs imports
// this module directly, so anything running at import time would run inside
// the gate itself.
//
// VALIDATION POLICY: every rejection here is a `TypeError`, deliberately one
// class so a caller never has to guess which to catch. A malformed advisory is
// a programming error in an analyzer, not a user-input problem — it should
// crash loudly during development, never degrade into a silently-dropped
// finding at the gate.

/** The only two severities. `warning` is the default; there is no `error` — a
 *  hard finding is not an advisory, it belongs in the gate's `errors[]`. */
export const SEVERITIES = ['info', 'warning'];

/** Throw unless `value` is a non-empty string. */
function requireString(fn, what, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    const got = typeof value === 'string' ? JSON.stringify(value) : typeof value;
    throw new TypeError(`${fn}: ${what} must be a non-empty string (got ${got})`);
  }
}

/**
 * Normalize one soft finding into the C3 shape.
 *
 *   advisory('idiom.parallel-fifths', 'Bars 9-12 …', { bar: 9, data: {…} })
 *   -> { code, severity:'warning', message, bar:9, data:{…} }
 *
 * Optional location fields (`track`, `staff`, `bar`, `beat`) and `data` are
 * OMITTED rather than emitted as null, so a consumer can use `'bar' in a` to
 * mean "this finding is bar-located" without a null dance.
 */
export function advisory(code, message, opts = {}) {
  requireString('advisory', 'code', code);
  requireString('advisory', 'message', message);
  if (opts === null || typeof opts !== 'object') {
    throw new TypeError(`advisory: opts must be an object (got ${opts === null ? 'null' : typeof opts})`);
  }
  const severity = opts.severity ?? 'warning';
  if (!SEVERITIES.includes(severity)) {
    throw new TypeError(
      `advisory: severity must be one of ${SEVERITIES.join('|')} (got ${JSON.stringify(severity)})`);
  }
  // Field order matches the C3 example, so a --json diff between two runs reads
  // the same way a human reads the contract.
  const out = { code, severity, message };
  for (const k of ['track', 'staff', 'bar', 'beat']) {
    if (opts[k] !== undefined && opts[k] !== null) out[k] = opts[k];
  }
  if (opts.data !== undefined && opts.data !== null) out.data = opts.data;
  return out;
}

/**
 * Exact-code membership test — the helper tests use so they assert on codes
 * instead of prose. A missing/!Array list answers `false` (the honest answer to
 * "did this fire?" when nothing ran), but a non-string `code` is a caller bug
 * and throws: `hasAdvisory(list, undefined)` silently answering false would
 * make a typo'd assertion pass forever.
 */
export function hasAdvisory(list, code) {
  requireString('hasAdvisory', 'code', code);
  if (!Array.isArray(list)) return false;
  return list.some((a) => a && a.code === code);
}

/**
 * Bucket advisories by the segment before the first '.' — the reserved
 * namespace from C3 — preserving first-appearance order within each bucket:
 *
 *   ['fingering.position-jump', 'idiom.x', 'harmonic-flattening']
 *   -> { fingering: [...], idiom: [...], 'harmonic-flattening': [...] }
 *
 * A code with no dot (`harmonic-flattening` is one, by contract) keys on the
 * WHOLE code — it is its own namespace, not a member of an empty-named one.
 */
export function groupByPrefix(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    if (!a || typeof a.code !== 'string') {
      throw new TypeError(
        `groupByPrefix: every element must be an advisory with a string code (got ${JSON.stringify(a)})`);
    }
    const dot = a.code.indexOf('.');
    const key = dot === -1 ? a.code : a.code.slice(0, dot);
    (out[key] ??= []).push(a);
  }
  return out;
}

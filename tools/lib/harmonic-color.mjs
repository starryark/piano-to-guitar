// tools/lib/harmonic-color.mjs — is the source's harmonic COLOR surviving?
// PTG-native (Wave 4). Contract C3 (`harmonic-flattening`), C10/C8 (sidecar
// semantics), C11.2 (the pcset narrowing is untouchable) and C11.4 (a missing
// 3rd is never a fidelity failure) own this surface.
//
// WHAT THIS ANSWERS — AND THE SENTENCE IT MUST NEVER CONTRADICT
// -------------------------------------------------------------
// AGENTS.md: *"a power chord (root+5th, no 3rd) correctly renders BOTH major and
// minor — a missing 3rd is never a miss."* That is not a caveat to work around;
// it is the doctrine this module operates inside. So the question here is not
// "was a third dropped" — the answer is usually yes, and usually correct. It is:
//
//     Over a SUSTAINED stretch, has every scrap of the source's harmonic
//     identity — thirds, sevenths, extensions — been rendered as root-and-fifth,
//     with nothing anywhere in the target carrying it?
//
// One power chord is an arrangement. Fourteen bars of them under a progression
// that was going somewhere is a question worth asking. The whole design is about
// the difference, and every threshold is a style's, never this file's.
//
// FOUR REFUSALS, EACH LOAD-BEARING
// --------------------------------
// 1. IT NEVER WIDENS `harmony.pcset`. AGENTS.md §A.2 narrowed that set to the
//    primary half-bar's sustained stratum, and re-widening it would restore the
//    vacuous-gate defect. This module reads the ADDITIVE `harmonySpans[]` field
//    (both half-bar chords, each with its own pcset) — which is exactly what C11.2
//    says harmonic-color logic must consume — and falls back to the coarse
//    `harmony` only as a strictly more conservative last resort.
// 2. IT REFUSES TO SPEAK WITHOUT EVIDENCE. A source slice whose pcset is itself
//    root-and-fifth has no color to lose, and a slice with too few pitch classes
//    to name a chord has nothing to conclude from. Both RESET the run rather than
//    counting as flattening.
// 3. IT IS GAIN- AND REGISTER-AWARE. reference/electric-guitar-voice.md is
//    explicit that a low third under high gain turns to mud — distortion is a
//    nonlinear transfer function and intermodulates the interval. Telling a
//    guitarist to add one would be bad advice, so a low-register high-gain slice
//    that lost only a THIRD is exempt. A lost SEVENTH is never gain-excused.
// 4. IT SPEAKS ONCE PER REGION. One advisory per maximal flattened run, with the
//    per-slice evidence in `data`. Fourteen copies of one finding is how a real
//    finding gets scrolled past.
//
// Pure ESM, node builtins only, no filesystem access, no alphaTab import: the
// caller passes in the digest and an already-collected view of the tab.

import { advisory } from './advisory.mjs';

/** Semitone-above-root -> the harmonic function it names. */
export const COLOR_FUNCTIONS = Object.freeze({
  3: 'minor-third',
  4: 'major-third',
  10: 'minor-seventh',
  11: 'major-seventh',
  2: 'ninth',
});

/**
 * The functions whose ABSENCE creates an obligation to look.
 *
 * The 9th is deliberately excluded. An interval of 2 above the root is a 9th in
 * one reading and a suspension, a passing tone or the root of a sus2 in another,
 * and the digest's pcset cannot tell them apart. Plan §8.1 says "9th where
 * reliably represented", and the conservative reading of that is: a 9th COUNTS
 * as preserved color when the target has one, but never on its own creates the
 * obligation. Asymmetric on purpose — the asymmetry always favours silence.
 */
export const OBLIGATING_FUNCTIONS = Object.freeze(['minor-third', 'major-third',
  'minor-seventh', 'major-seventh']);

/** Below this the ear stops resolving a third under distortion.
 *  playability.mjs uses the same G3 boundary for its `gain-voicing` advisory —
 *  one number, one reference, two tools that cannot disagree. */
export const LOW_REGISTER_CEILING = 55;   // G3

/**
 * Fewest distinct pitch classes a source slice needs before this module will
 * read a harmonic function out of it.
 *
 * TWO, not three, and the reason is what the pcset actually contains. §A.2
 * narrowed it to the primary half-bar's SUSTAINED stratum — bass plus held chord
 * tones, with the sixteenth-note passing runs stripped out — so two entries
 * there is not a fragment, it is the chord as the source sustains it. Root + 3rd
 * is a complete statement of major-or-minor, and refusing to read it would make
 * this module silent on exactly the sparse two-voice writing where a lost third
 * is most audible. One pitch class is a root with nothing said about it, which
 * genuinely is insufficient.
 */
export const MIN_SOURCE_PCS = 2;

const pc = (n) => (((n % 12) + 12) % 12);
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#" | "Bb" | "C" -> pitch class, or null. Mirrors compare.mjs's reader. */
export function noteNameToPc(name) {
  if (typeof name !== 'string' || !name.length) return null;
  const base = LETTER_PC[name[0].toUpperCase()];
  if (base === undefined) return null;
  let v = base;
  for (const ch of name.slice(1)) {
    if (ch === '#') v += 1;
    else if (ch === 'b') v -= 1;
  }
  return pc(v);
}

/**
 * Proportional slice of a tab span for source slice i (0-indexed) of N.
 * Identical formula to compare.mjs's, deliberately: the advisory must describe
 * the same correspondence the gate graded, or it is talking about other music.
 */
export function proportionalSlice(tS, tE, i, N) {
  const T = tE - tS + 1;
  const lo = tS + Math.floor((i * T) / N);
  const hi = i === N - 1 ? tE : tS + Math.floor(((i + 1) * T) / N) - 1;
  return [lo, Math.max(lo, hi)];
}

/**
 * The harmonic slices of one digest bar, finest-available-evidence first.
 *
 * `harmonySpans[]` is the additive WP2b field carrying BOTH half-bar chords.
 * Using it is what C11.2 requires — it is finer evidence that exists precisely
 * so nobody has to re-widen `harmony.pcset` to get at it.
 */
export function sourceSlicesOf(bar) {
  // A half-bar with nothing sounding in it is emitted as `null` in
  // `harmonySpans[]`. That is an ABSENT span, not a colourless one, and the
  // difference matters: treating it as a slice would insert a permanent
  // "no-obligation" reset into every whole-note source, so no run could ever
  // reach a threshold. Filtered out before anything counts it.
  const usable = Array.isArray(bar?.harmonySpans)
    ? bar.harmonySpans.filter((h) => h && typeof h === 'object')
    : [];
  const spans = usable.length ? usable : (bar?.harmony ? [bar.harmony] : []);
  const fromSpans = usable.length > 0;
  return spans.map((h, index) => ({
    bar: bar.bar,
    index,
    of: spans.length,
    source: fromSpans ? 'harmonySpans' : 'harmony',
    root: h?.root ?? null,
    rootPc: noteNameToPc(h?.root),
    symbol: h?.symbol ?? null,
    pcset: [...new Set(h?.pcset ?? [])].sort((a, b) => a - b),
  }));
}

/** The color functions present in a pcset, relative to its root. */
export function functionsOf(rootPc, pcset) {
  if (rootPc === null) return [];
  const out = [];
  for (const p of pcset) {
    const fn = COLOR_FUNCTIONS[pc(p - rootPc)];
    if (fn && !out.includes(fn)) out.push(fn);
  }
  return out;
}

/**
 * Read one proportional tab slice out of the caller's per-bar view.
 *
 * The input shape is compare.mjs's own `tabBars` map — `{ allPcs:Set,
 * topPcs:Set, lowMidi:number, topSeq:number[] }` per bar, ALREADY in source
 * pitch space. Taking compare's view rather than re-walking the score is the
 * point: two readers of the same tab that disagree about what is in it would be
 * worse than no second reader at all.
 */
export function readTabSlice(tabBars, lo, hi) {
  const pcs = new Set();
  const topPcs = new Set();
  let lowMidi = Infinity;
  let highMidi = -Infinity;
  let noteCount = 0;
  for (let b = lo; b <= hi; b++) {
    const tb = tabBars.get(b);
    if (!tb) continue;
    for (const p of tb.allPcs) pcs.add(p);
    for (const p of tb.topPcs ?? []) topPcs.add(p);
    if (Number.isFinite(tb.lowMidi)) lowMidi = Math.min(lowMidi, tb.lowMidi);
    for (const m of tb.topSeq ?? []) highMidi = Math.max(highMidi, m);
    noteCount += tb.noteCount ?? 0;
  }
  return {
    pcs,
    topPcs,
    lowMidi: Number.isFinite(lowMidi) ? lowMidi : null,
    highMidi: Number.isFinite(highMidi) ? highMidi : null,
    noteCount,
  };
}

/** Is this target slice nothing but root, fifth and octave of its own bass? */
export function isRootFifthOnly(slice) {
  if (!slice.pcs.size || slice.lowMidi === null) return false;
  const bass = pc(slice.lowMidi);
  for (const p of slice.pcs) {
    const iv = pc(p - bass);
    if (iv !== 0 && iv !== 7) return false;
  }
  return true;
}

/**
 * Classify one (source slice -> target slice) correspondence.
 *
 * @returns {{ verdict: 'flattened'|'preserved'|'exempt'|'no-obligation'|
 *             'insufficient-evidence'|'no-target', ... }}
 */
export function classifySlice(src, target, { gain = 'high' } = {}) {
  const base = {
    sourceBar: src.bar,
    sourceSliceIndex: src.index,
    root: src.root,
    symbol: src.symbol,
    evidence: src.source,
    tabBars: target.tabBars,
  };

  if (src.rootPc === null || src.pcset.length < MIN_SOURCE_PCS) {
    // Two pitch classes cannot name a chord, and a slice with no root has no
    // reference to measure an interval from. Neither is a finding.
    return { ...base, verdict: 'insufficient-evidence', sourceFunctions: [], preservedBy: null };
  }

  const sourceFunctions = functionsOf(src.rootPc, src.pcset);
  const obligating = sourceFunctions.filter((f) => OBLIGATING_FUNCTIONS.includes(f));
  if (!obligating.length) {
    // The source is itself root-and-fifth (or has no nameable color). There is
    // nothing to preserve, so a power chord here is a faithful rendering.
    return { ...base, verdict: 'no-obligation', sourceFunctions, preservedBy: null };
  }

  if (!target.slice.noteCount) {
    return { ...base, verdict: 'no-target', sourceFunctions, preservedBy: null };
  }

  // --- preservation, in three flavours, any one of which is enough ----------
  // LITERAL: the source's own colour pitch class is somewhere in the target.
  const literal = sourceFunctions.filter((f) => {
    const iv = Number(Object.keys(COLOR_FUNCTIONS).find((k) => COLOR_FUNCTIONS[k] === f));
    return target.slice.pcs.has(pc(src.rootPc + iv));
  });
  // UPPER-REGISTER: it survives specifically in the top line. Plan §8.1 —
  // "a third or seventh moved to an upper-register melody note can satisfy
  // preservation" — so this is reported separately even though it is a subset.
  const upper = literal.filter((f) => {
    const iv = Number(Object.keys(COLOR_FUNCTIONS).find((k) => COLOR_FUNCTIONS[k] === f));
    return target.slice.topPcs.has(pc(src.rootPc + iv));
  });
  // FUNCTIONAL: the target states SOME colour of its own above its own bass —
  // a reharmonization, not a flattening. Only meaningful when the target is not
  // root-fifth-only, which the next test settles.
  const rootFifthOnly = isRootFifthOnly(target.slice);

  if (literal.length) {
    return {
      ...base,
      verdict: 'preserved',
      sourceFunctions,
      preservedFunctions: literal,
      preservedBy: upper.length ? 'upper-register' : 'literal',
    };
  }
  if (!rootFifthOnly) {
    // The target carries colour, just not the source's. That is a harmonic
    // CHOICE, and this module does not adjudicate choices — only erasure.
    return { ...base, verdict: 'preserved', sourceFunctions, preservedFunctions: [], preservedBy: 'functional' };
  }

  // --- the gain/register exemption -----------------------------------------
  // reference/electric-guitar-voice.md: under high gain a third below ~G3
  // intermodulates into mud. Advising one there would be wrong advice, so a
  // low-register high-gain slice that lost ONLY a third is exempt. A lost
  // SEVENTH is never gain-excused — a 7th is the chord's identity, not its
  // brightness, and it can always go in the upper register instead.
  const lostSevenths = obligating.some((f) => f.endsWith('seventh'));
  const lowRegister = target.slice.highMidi !== null && target.slice.highMidi < LOW_REGISTER_CEILING;
  if (gain === 'high' && lowRegister && !lostSevenths) {
    return {
      ...base,
      verdict: 'exempt',
      sourceFunctions,
      preservedBy: null,
      reason: 'high gain in a low register — a third here would mud, not clarify',
    };
  }

  return { ...base, verdict: 'flattened', sourceFunctions, omittedFunctions: obligating, preservedBy: null };
}

/**
 * Walk a mapped arrangement and report SUSTAINED harmonic flattening.
 *
 * @param {object} args
 * @param {object[]} args.entries Validated sidecar entries, in declaration order.
 * @param {Map<number, object>} args.digestByBar
 * @param {Map<number, object>} args.tabBars compare.mjs's per-bar tab view, in
 *        SOURCE pitch space (see `readTabSlice`).
 * @param {object} args.profile A validated style profile (C6).
 * @param {string} [args.gain]
 * @returns {{ slices: object[], runs: object[], advisories: object[], stats: object }}
 */
export function analyzeHarmonicColor({ entries, digestByBar, tabBars, profile, gain = 'high' } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('analyzeHarmonicColor: entries must be an array');
  if (!(digestByBar instanceof Map)) throw new TypeError('analyzeHarmonicColor: digestByBar must be a Map');
  if (!(tabBars instanceof Map)) throw new TypeError('analyzeHarmonicColor: tabBars must be a Map');
  if (!profile?.harmonicColor) {
    throw new TypeError('analyzeHarmonicColor: profile must be a validated style profile');
  }

  const enabled = profile.harmonicColor.enabled !== false;
  const need = profile.harmonicColor.consecutiveSlicesBeforeWarn;
  const slices = [];
  const runs = [];

  if (!enabled) {
    // metal, by profile: sustained root-fifth writing IS the genre. Returning
    // early rather than computing-and-suppressing keeps "disabled" honest — a
    // reader of the JSON sees no slices, not slices with no advisory.
    return {
      slices, runs, advisories: [],
      stats: { enabled: false, style: profile.name, gain, slicesExamined: 0, flattened: 0 },
    };
  }

  // Entries in TAB order, so "consecutive" means consecutive in the arrangement
  // rather than in the file. A sidecar is allowed to declare its spans in any
  // order; the listener hears them in one.
  const ordered = [...entries].sort((a, b) => a.tabBars[0] - b.tabBars[0]);

  let run = [];
  let previousTabEnd = null;
  const closeRun = () => {
    if (run.length >= need) runs.push([...run]);
    run = [];
  };

  for (const entry of ordered) {
    const [tS, tE] = entry.tabBars;
    // A hole between entries is unmapped ground: nothing links the two sides
    // across it, so a run cannot span it (§8.1 reset rule).
    if (previousTabEnd !== null && tS > previousTabEnd + 1) closeRun();
    previousTabEnd = Math.max(previousTabEnd ?? tE, tE);

    if (entry.mode === 'free' || !entry.sourceBars) {
      // Added material has no source correspondence, so it can neither flatten
      // anything nor continue a run through itself.
      closeRun();
      continue;
    }

    const [sS, sE] = entry.sourceBars;
    const srcSlices = [];
    for (let b = sS; b <= sE; b++) {
      const bar = digestByBar.get(b);
      if (!bar) continue;
      srcSlices.push(...sourceSlicesOf(bar));
    }
    const N = srcSlices.length;
    if (!N) { closeRun(); continue; }

    for (let i = 0; i < N; i++) {
      const src = srcSlices[i];
      const [lo, hi] = proportionalSlice(tS, tE, i, N);
      const slice = readTabSlice(tabBars, lo, hi);
      const classified = classifySlice(src, { tabBars: [lo, hi], slice }, { gain });
      classified.mode = entry.mode;
      slices.push(classified);
      if (classified.verdict === 'flattened') run.push(classified);
      else closeRun();
    }
  }
  closeRun();

  // ---- one advisory per maximal flattened run ------------------------------
  const advisories = [];
  for (const r of runs) {
    const first = r[0];
    const last = r[r.length - 1];
    const omitted = [...new Set(r.flatMap((s) => s.omittedFunctions))].sort();
    advisories.push(advisory(
      'harmonic-flattening',
      `tab bars ${first.tabBars[0]}-${last.tabBars[1]} (source bars ${first.sourceBar}-${last.sourceBar}): `
      + `${r.length} consecutive mapped harmonies carrying ${omitted.join('/')} are rendered as `
      + `root-and-fifth only, with none of that colour anywhere in the target. Under ${gain} gain, `
      + `the answer is rarely a low third — try the colour tone as an upper-register melody note, or `
      + `confirm that the sustained power-chord reduction is the intent.`,
      {
        bar: first.tabBars[0],
        data: {
          style: profile.name,
          gain,
          consecutiveSlices: r.length,
          threshold: need,
          tabBars: [first.tabBars[0], last.tabBars[1]],
          sourceBars: [first.sourceBar, last.sourceBar],
          omittedFunctions: omitted,
          evidence: [...new Set(r.map((s) => s.evidence))].sort(),
          slices: r.map((s) => ({
            sourceBar: s.sourceBar,
            sourceSliceIndex: s.sourceSliceIndex,
            symbol: s.symbol,
            tabBars: s.tabBars,
            omittedFunctions: s.omittedFunctions,
          })),
        },
      },
    ));
  }

  const counts = {};
  for (const s of slices) counts[s.verdict] = (counts[s.verdict] ?? 0) + 1;

  return {
    slices,
    runs,
    advisories,
    stats: {
      enabled: true,
      style: profile.name,
      gain,
      consecutiveSlicesBeforeWarn: need,
      slicesExamined: slices.length,
      flattened: counts.flattened ?? 0,
      verdicts: counts,
    },
  };
}

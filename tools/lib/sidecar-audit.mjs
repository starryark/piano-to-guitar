// tools/lib/sidecar-audit.mjs — what does this correspondence map actually claim?
// PTG-native (Wave 4). Contract C10 in docs/specs/upgrade-contracts.md and §A4.1
// of docs/specs/wave3-6-addendum.md own these metric definitions; this file
// implements them and may not redefine them.
//
// WHAT THIS IS FOR
// ----------------
// A sidecar is the arranger's declaration of what each span of the tab is DOING:
// quoting the source, recomposing over its roots, honouring a melody contract,
// or added outright. `compare.mjs` gates each span against that declaration. But
// nobody was reading the map as a whole — and the map as a whole is where the
// interesting question lives: how much of this arrangement is actually tied to
// the source at all, and which of the source's melody is protected by anything?
//
// THE ONE MISTAKE THIS MODULE EXISTS TO NOT MAKE
// -----------------------------------------------
// C10 opens by insisting on TWO DISJOINT SPACES, and the reason is that mixing
// them produces numbers that look authoritative and mean nothing:
//
//   • TAB space asks "what did the arranger declare over these bars?" Its
//     denominator is tab bars.
//   • SOURCE space asks "which source material has something protecting it?"
//     Its denominator is digest bars.
//
// `free` exists in the first and CANNOT exist in the second: a free span has no
// `sourceBars` by construction (C8), so "what share of the source is free" is
// not a hard question, it is an ill-formed one. This module never computes it
// and never fabricates a source mapping to make it computable.
//
// The second trap is `sourceBarsMultiplyReferenced`: a source bar quoted by
// three different spans is ONE bar of coverage, not three. Every source-space
// figure here is a SET, never a sum, so a repeated quote can never inflate a
// coverage claim.
//
// Pure ESM, node builtins only. No filesystem access — the caller loads the
// sidecar (via lib/sidecar.mjs, the one semantics) and the digest and passes
// them in, so the audit and the gate can never disagree about what the map says.

import { advisory } from './advisory.mjs';

/** Modes whose span protects the melodic skeleton of the source it names.
 *  C10's `sourceBarsByQuote` is defined in exactly these terms. */
export const SKELETON_PRESERVING_MODES = Object.freeze(['quote', 'contract']);

/** Modes that name source bars but protect only root motion. */
export const RECOMPOSE_MODES = Object.freeze(['recompose', 'contract-recompose']);

/** §A4.1: the four mutually-exclusive TAB-space buckets, and which modes fall in
 *  each. Exhaustive over SIDECAR_MODES — a mode missing from here is a bug, and
 *  `auditSidecar` throws rather than silently dropping its bars. */
export const TAB_BUCKETS = Object.freeze({
  quoteTabBars: ['quote'],
  recomposeTabBars: ['recompose'],
  contractTabBars: ['contract', 'contract-recompose'],
  freeTabBars: ['free'],
});

const bucketOfMode = (() => {
  const map = new Map();
  for (const [bucket, modes] of Object.entries(TAB_BUCKETS)) {
    for (const m of modes) map.set(m, bucket);
  }
  return (mode) => map.get(mode) ?? null;
})();

/** Sorted unique integers from a Set — the deterministic wire form (§A6). */
const sortedBars = (set) => [...set].sort((a, b) => a - b);

/**
 * Compact a sorted bar list into inclusive ranges: [1,2,3,7,8] -> [[1,3],[7,8]].
 * Emitted ALONGSIDE the flat list, never instead of it: ranges are readable, the
 * flat list is checkable, and a reader should not have to re-expand one to
 * verify the other.
 */
export function toRanges(bars) {
  const out = [];
  for (const b of bars) {
    const last = out[out.length - 1];
    if (last && b === last[1] + 1) last[1] = b;
    else out.push([b, b]);
  }
  return out;
}

const barSpan = (set) => ({ count: set.size, bars: sortedBars(set), ranges: toRanges(sortedBars(set)) });

const round = (n, places = 4) => {
  const f = 10 ** places;
  return Math.round(n * f) / f + 0;   // `+ 0` normalises -0 (§A6)
};

/**
 * Audit a validated sidecar against a digest.
 *
 * @param {object} args
 * @param {object[]} args.entries Normalized entries from `validateSidecar`.
 * @param {object} args.digest The source digest (needs `bars[]`).
 * @param {{lo:number,hi:number}|null} [args.range] The `--bars` window. Tab-space
 *        counts are CLIPPED to it; source/skeleton metrics use whole entries that
 *        intersect it (§A4.1 — a sidecar states a span correspondence, and
 *        slicing it per bar would fabricate one it never claimed).
 * @param {object|null} [args.profile] A validated style profile (C6). Without one
 *        the metrics are still computed; only the advisory needs a threshold.
 * @returns {{ metrics: object, advisories: object[], stats: object }}
 */
export function auditSidecar({ entries, digest, range = null, profile = null } = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError('auditSidecar: entries must be an array of validated sidecar entries');
  }
  if (!digest || !Array.isArray(digest.bars)) {
    throw new TypeError('auditSidecar: digest must be a parsed digest with a bars[] array');
  }

  const lo = range?.lo ?? -Infinity;
  const hi = range?.hi ?? Infinity;

  // ---- tab space --------------------------------------------------------
  // One bar belongs to exactly one entry: `validateSidecar` already refused any
  // overlap, so counting is addition, not set union. The bucket totals are
  // therefore guaranteed to sum to totalTabBars, and a test asserts it.
  const tabBarsByMode = {};
  const buckets = Object.fromEntries(Object.keys(TAB_BUCKETS).map((k) => [k, 0]));
  let totalTabBars = 0;
  const consideredEntries = [];

  for (const entry of entries) {
    const [tS, tE] = entry.tabBars;
    if (tE < lo || tS > hi) continue;          // wholly outside the window
    consideredEntries.push(entry);
    const clippedLo = Math.max(tS, lo);
    const clippedHi = Math.min(tE, hi);
    const bars = clippedHi - clippedLo + 1;
    const bucket = bucketOfMode(entry.mode);
    if (!bucket) {
      // Fail closed: a mode with no bucket would vanish from every total and
      // quietly shrink the free-share denominator.
      throw new Error(`auditSidecar: sidecar mode "${entry.mode}" has no tab-space bucket `
        + `(known: ${Object.values(TAB_BUCKETS).flat().join(', ')})`);
    }
    tabBarsByMode[entry.mode] = (tabBarsByMode[entry.mode] ?? 0) + bars;
    buckets[bucket] += bars;
    totalTabBars += bars;
  }

  // An empty denominator yields a NEUTRAL value, never NaN and never a
  // confident 0 share (§A3's rule, applied here too).
  const freeTabBarShare = totalTabBars > 0 ? round(buckets.freeTabBars / totalTabBars) : null;

  // ---- source space -----------------------------------------------------
  // Sets throughout (C10): a source bar referenced by three spans is one bar of
  // coverage. `refCount` records the repetition separately, because "this bar is
  // used three times" is real information — it is just not extra coverage.
  const bySkeletonPreserving = new Set();
  const byRecompose = new Set();
  const refCount = new Map();

  for (const entry of consideredEntries) {
    if (!entry.sourceBars) continue;           // `free` has none, by construction
    const [sS, sE] = entry.sourceBars;
    const preserving = SKELETON_PRESERVING_MODES.includes(entry.mode);
    for (let b = sS; b <= sE; b++) {
      refCount.set(b, (refCount.get(b) ?? 0) + 1);
      if (preserving) bySkeletonPreserving.add(b);
      else byRecompose.add(b);
    }
  }
  // "Referenced ONLY by recompose" (C10) — a bar quoted anywhere is quoted.
  for (const b of bySkeletonPreserving) byRecompose.delete(b);

  const digestBars = digest.bars.map((b) => b.bar).sort((a, b) => a - b);
  const unreferenced = new Set(digestBars.filter((b) => !refCount.has(b)));
  const multiplyReferenced = new Set([...refCount.entries()].filter(([, n]) => n >= 2).map(([b]) => b));

  // ---- melody-skeleton space --------------------------------------------
  // Denominator = digest skeleton NOTES, classified by the source bar they live
  // in. There is deliberately no `free` bucket (C10).
  let skelTotal = 0;
  let skelByQuote = 0;
  let skelByRecomposeOnly = 0;
  let skelUnreferenced = 0;
  for (const bar of digest.bars) {
    const n = Array.isArray(bar.melodySkeleton) ? bar.melodySkeleton.length : 0;
    if (!n) continue;
    skelTotal += n;
    if (bySkeletonPreserving.has(bar.bar)) skelByQuote += n;
    else if (byRecompose.has(bar.bar)) skelByRecomposeOnly += n;
    else skelUnreferenced += n;
  }

  const metrics = {
    range: range ? { lo: range.lo, hi: range.hi } : null,
    tabSpace: {
      totalTabBars,
      ...buckets,
      // The raw per-mode counts, so the aggregation above is checkable rather
      // than trusted.
      tabBarsByMode,
      freeTabBarShare,
    },
    sourceSpace: {
      digestBars: digestBars.length,
      sourceBarsByQuote: barSpan(bySkeletonPreserving),
      sourceBarsByRecompose: barSpan(byRecompose),
      sourceBarsUnreferenced: barSpan(unreferenced),
      sourceBarsMultiplyReferenced: {
        ...barSpan(multiplyReferenced),
        // Sorted by bar, so two runs cannot order it differently.
        counts: sortedBars(multiplyReferenced).map((b) => ({ bar: b, references: refCount.get(b) })),
      },
    },
    melodySkeletonSpace: {
      total: skelTotal,
      coveredByQuote: skelByQuote,
      coveredOnlyByRecompose: skelByRecomposeOnly,
      unreferenced: skelUnreferenced,
      // Neutral, not zero, when the digest carries no skeleton at all.
      coveredByQuoteShare: skelTotal > 0 ? round(skelByQuote / skelTotal) : null,
    },
  };

  // ---- advisory ---------------------------------------------------------
  // SOFT, and worded as a question. A fully valid map may legitimately have a
  // high free share — a cover that adds an intro, a solo and an outro is doing
  // its job. C10 is explicit that the wording stays informational and never
  // accusatory: the gate has already decided this map is legal.
  const advisories = [];
  const threshold = profile?.freeSpanWarnShare;
  if (freeTabBarShare !== null && typeof threshold === 'number' && freeTabBarShare > threshold) {
    advisories.push(advisory(
      'sidecar.high-free-share',
      `${Math.round(freeTabBarShare * 100)}% of the ${totalTabBars} mapped tab bar(s) in range are `
      + `declared free (${buckets.freeTabBars} bar(s)), above the ${profile.name} guide of `
      + `${Math.round(threshold * 100)}%. Free spans are added material and are gated by nothing `
      + `but playability — verify that this much of the arrangement is intended to stand on its own.`,
      {
        data: {
          style: profile.name,
          freeTabBars: buckets.freeTabBars,
          totalTabBars,
          freeTabBarShare,
          threshold,
          range: metrics.range,
        },
      },
    ));
  }

  return {
    metrics,
    advisories,
    stats: {
      entries: entries.length,
      entriesInRange: consideredEntries.length,
      modesSeen: Object.keys(tabBarsByMode).sort(),
    },
  };
}

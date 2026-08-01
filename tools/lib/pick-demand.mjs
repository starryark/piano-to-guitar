// tools/lib/pick-demand.mjs — the picking-hand speed classifier.
// PTG-native (Wave 1). Contract C12 in docs/specs/upgrade-contracts.md owns this
// surface; this file implements it and may not redefine it.
//
// WHY THIS EXISTS
// ---------------
// playability.mjs used to carry `PICK_CEILING_NPS = 16` — a single invented
// notes-per-second number with no source in the reference and no relationship to
// how a picking hand actually fails. It was also nearly inert: nps is
// `(duration/4) * (tempo/60)`, so 16ths at 120 BPM score 8 and even 32nds at
// 120 score exactly 16, which is not `> 16`. The check fired essentially never,
// which is worse than not existing — it read like coverage.
//
// reference/guitar-playability.md → "Tempo × subdivision ceiling" already states
// the real limit as a TABLE, because picking difficulty is not one scalar: it is
// jointly determined by (a) how fast the strokes come (tempo × subdivision) and
// (b) how LONG they keep coming ("a fast run should last <= 2 beats before a
// breath"). A 4-note burst of 32nds is a flourish any player can throw; the same
// stroke rate held for four bars is a different instrument skill. This module
// encodes the table for (a) and carries (b) as `sustained`.
//
// Pure ESM, node builtins only (in fact: no imports at all), NO top-level side
// effects and NO filesystem access — it is imported by a CLI that must stay
// deterministic and by its own unit test.
//
// VALIDATION POLICY: bad input throws `TypeError`, matching lib/advisory.mjs. A
// malformed classifier call is a programming error in an analyzer, not user
// input; it must crash loudly in development rather than silently classify a
// shredding passage as `easy`.

/** Difficulty levels, EASIEST FIRST. Index order is load-bearing: the
 *  articulation downgrade below is `index - 1`. */
export const LEVELS = ['easy', 'moderate', 'hard', 'expert', 'avoid'];

/** Subdivision columns of the reference table, plus `other` for
 *  quarter-and-slower (no picking-speed question exists there). */
export const SUBDIVISIONS = ['other', '8th', '16th', '32nd'];

/** Right-hand articulations. Only `picked` pays the full table price. */
export const ARTICULATIONS = ['picked', 'legato', 'tremolo'];

/**
 * Tempo band boundaries, in BPM.
 *
 * Bands are UPPER-INCLUSIVE — `(lo, hi]` — with boundaries at 100 / 140 / 180:
 *
 *     band 0 = t <= 100      band 2 = 140 < t <= 180
 *     band 1 = 100 < t <= 140    band 3 = t > 180
 *
 * This reads the reference table's row headers literally. Its first row is
 * written "<= 100 BPM" — explicitly inclusive — and its last is "> 180", so 100
 * belongs to the FIRST band and 180 to the third. The middle rows ("100-140",
 * "140-180") share their endpoints in the prose; upper-inclusive is the one
 * resolution that gives every tempo exactly one cell while honouring the two
 * rows that ARE unambiguous.
 *
 * (An earlier draft of contract C12 specified `[lo, hi)`, which put 100 BPM in
 * band 1 and contradicted the reference's own "<= 100". C12 was corrected to
 * match this; the boundary tests at 99/100/101, 139/140/141 and 179/180/181 pin
 * it, because off-by-one here silently re-grades a whole tempo band.)
 */
export const TEMPO_BOUNDARIES = [100, 140, 180];

/**
 * The reference's burst budget: "a fast run should last <= 2 beats before a
 * breath (longer note or rest) unless it is the climax."
 *
 * Wave 3 will feed `profile.pickDemand.maxBurstBeats` (contract C6) in here;
 * until then every caller gets the reference's own number.
 */
export const DEFAULT_MAX_BURST_BEATS = 2;

/**
 * The reference table, verbatim, as `subdivision -> level per tempo band`.
 *
 * Row index is the tempo band (0 = <=100, 1 = (100,140], 2 = (140,180],
 * 3 = >180). C12 maps the reference's prose cells onto LEVELS like this:
 *   "advanced"                  -> expert
 *   "expert, short bursts only" -> expert   (the burst nuance lives in `sustained`)
 *   "no"                        -> avoid
 *
 * `other` (quarter notes and slower) is `easy` in every band by construction:
 * the table is about picking SPEED, and there is no speed question below an
 * eighth note. It is a row rather than an early return so that the shape of the
 * lookup is uniform and a future style profile can override one cell.
 */
const TABLE = Object.freeze({
  other: Object.freeze(['easy', 'easy', 'easy', 'easy']),
  '8th': Object.freeze(['easy', 'easy', 'easy', 'moderate']),
  '16th': Object.freeze(['easy', 'moderate', 'hard', 'expert']),
  '32nd': Object.freeze(['expert', 'expert', 'avoid', 'avoid']),
});

function requireFiniteNumber(fn, what, value, { min = -Infinity, integer = false } = {}) {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new TypeError(
      `${fn}: ${what} must be a finite ${integer ? 'integer' : 'number'} >= ${min} `
      + `(got ${JSON.stringify(value)})`);
  }
  return n;
}

/**
 * Map an alphaTab duration value onto a reference-table column.
 *
 *   4 = quarter -> 'other'      8 = eighth -> '8th'
 *  16 = 16th    -> '16th'      32 = 32nd   -> '32nd'
 *
 * The mapping is by RANGE, not by exact value, for one reason: tuplets. A 16th
 * TRIPLET is `duration 16` with a 3:2 tuplet, i.e. an EFFECTIVE duration of 24
 * — six attacks per beat, between 16ths (4/beat) and 32nds (8/beat). The
 * reference groups it with 32nds ("16th triplets / 32nds"), and the range
 * `[24, inf) -> '32nd'` puts it exactly there. Callers that see a tuplet pass
 * `duration * tupletNumerator / tupletDenominator`; see playability.mjs.
 *
 * Anything faster than a 32nd (64ths and beyond) stays in the hardest column
 * rather than falling off the end into `other` — a hole there would classify
 * the most demanding writing in the piece as effortless.
 */
export function subdivisionOf(duration) {
  const d = requireFiniteNumber('subdivisionOf', 'duration', duration, { min: 0 });
  if (d >= 24) return '32nd';
  if (d >= 16) return '16th';
  if (d >= 8) return '8th';
  return 'other';
}

/**
 * Tempo -> band index 0..3. Bands are UPPER-INCLUSIVE `(lo, hi]`, per C12.
 * Band 0 is (-inf, 100] — an unbounded low side, because a tempo of 40 is as
 * easy as a tempo of 99 and nothing is gained by refusing it.
 */
export function tempoBandOf(tempo) {
  const t = requireFiniteNumber('tempoBandOf', 'tempo', tempo, { min: 0 });
  let band = 0;
  for (const boundary of TEMPO_BOUNDARIES) {
    if (t > boundary) band++;
  }
  return band;
}

/**
 * Classify one picking run.
 *
 * @param {object} args
 * @param {number} args.tempo   BPM in force at the run.
 * @param {number} args.duration alphaTab duration value, already tuplet-adjusted
 *        by the caller if a tuplet is in force (see `subdivisionOf`).
 * @param {number} args.consecutiveAttacks GENUINE pick attacks in the current
 *        run. Per C12 this excludes tied continuations, tremolo beats and legato
 *        destinations — the CALLER owns that counting (it needs the beat
 *        sequence); this module only interprets the number.
 * @param {'picked'|'legato'|'tremolo'} [args.articulation='picked']
 * @param {number} [args.maxBurstBeats=DEFAULT_MAX_BURST_BEATS] The reference's
 *        burst budget. Wave 3 passes `profile.pickDemand.maxBurstBeats`.
 * @returns {{ level: string, tempo: number, subdivision: string,
 *             consecutiveAttacks: number, sustained: boolean,
 *             runBeats: number, articulation: string, baseLevel: string }}
 *          The first five keys are the C12 contract shape; `runBeats`,
 *          `articulation` and `baseLevel` are ADDITIVE diagnostics (they let a
 *          message say *why* without the caller recomputing anything).
 */
export function classifyPickDemand({
  tempo,
  duration,
  consecutiveAttacks,
  articulation = 'picked',
  maxBurstBeats = DEFAULT_MAX_BURST_BEATS,
} = {}) {
  const t = requireFiniteNumber('classifyPickDemand', 'tempo', tempo, { min: 0 });
  const d = requireFiniteNumber('classifyPickDemand', 'duration', duration, { min: 0 });
  const attacks = requireFiniteNumber(
    'classifyPickDemand', 'consecutiveAttacks', consecutiveAttacks, { min: 0, integer: true });
  const budget = requireFiniteNumber(
    'classifyPickDemand', 'maxBurstBeats', maxBurstBeats, { min: 0 });
  if (!ARTICULATIONS.includes(articulation)) {
    throw new TypeError(
      `classifyPickDemand: articulation must be one of ${ARTICULATIONS.join('|')} `
      + `(got ${JSON.stringify(articulation)})`);
  }

  const subdivision = subdivisionOf(d);
  const band = tempoBandOf(t);
  const baseLevel = TABLE[subdivision][band];

  // Articulation downgrade. Legato and tremolo take the picking hand out of the
  // critical path — the reference says so directly ("sustained 16ths above 160
  // BPM only as tremolo picking on one pitch or with heavy legato"). One step,
  // not a reset to `easy`: a tremolo-picked 32nd passage at 200 BPM is still a
  // real demand on the arm, just not on stroke ACCURACY.
  let idx = LEVELS.indexOf(baseLevel);
  if (articulation !== 'picked') idx = Math.max(0, idx - 1);
  const level = LEVELS[idx];

  // Run length in BEATS, which is what the reference's budget is stated in.
  // `4 / duration` is the beat length of one attack (duration 4 = 1 beat,
  // 16 = 0.25 beats, 24 = a 16th triplet = 1/6 beat).
  const runBeats = d > 0 ? attacks * (4 / d) : 0;
  const sustained = runBeats > budget + 1e-9;

  return {
    level,
    tempo: t,
    subdivision,
    consecutiveAttacks: attacks,
    sustained,
    runBeats,
    articulation,
    baseLevel,
  };
}

/**
 * Which C12 advisory code (if any) a classification deserves.
 *
 * Returns `null` — no finding — or one of `pick-demand.hard` /
 * `pick-demand.expert` / `pick-demand.avoid`. Never an error code: C12 is
 * explicit that pick demand NEVER fails the gate.
 *
 * The `sustained` gate on `hard`/`expert` is the reference's own nuance, not an
 * invention: its table cell for expert reads "expert, SHORT BURSTS ONLY", and it
 * states outright that a fast run of <= 2 beats needs no apology. Warning on
 * every four-note flourish would bury the case the rule exists for — a run that
 * keeps going. `avoid` warns unconditionally because the reference's cells there
 * read "avoid" and "no", which are not burst-conditional.
 */
export function pickDemandAdvisoryCode(result) {
  if (!result || typeof result.level !== 'string') {
    throw new TypeError('pickDemandAdvisoryCode: expected a classifyPickDemand result');
  }
  if (result.level === 'avoid') return 'pick-demand.avoid';
  if (!result.sustained) return null;
  if (result.level === 'expert') return 'pick-demand.expert';
  if (result.level === 'hard') return 'pick-demand.hard';
  return null;
}

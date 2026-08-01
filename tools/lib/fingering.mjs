// tools/lib/fingering.mjs — phrase-level fingering analysis and recommendation.
// PTG-native (Wave 2). Contracts C2/C3/C5/C11/C15 in docs/specs/upgrade-contracts.md
// own this surface; this file implements them and may not redefine them.
//
// WHY THIS EXISTS
// ---------------
// Every mechanical check the toolchain had before Wave 2 grades ONE BEAT AT A
// TIME. `playability.mjs` asks "is this grip legal?", "is this jump bigger than
// five frets?" — good questions, all local. But a guitarist does not finger a
// beat, they finger a PHRASE: the reason to play E5 at `12.1` instead of `17.2`
// is almost never that beat, it is where the hand has to be two beats later.
// A tab can therefore be 100% legal beat-by-beat and still be written the way a
// pianist would type it onto a fretboard — every note in its lowest position,
// the hand teleporting up and down the neck between them.
//
// This module answers the phrase-level question: given the PITCHES the arranger
// committed to, is there a better way for a hand to play them? It is an
// ANALYZER AND RECOMMENDER ONLY.
//
//   ** IT NEVER REWRITES `cover.alphatab`. ** (C15, and Implement.md §2.1/2.4.)
//
// A suggestion here is an argument addressed to the arranger, who owns the
// decision — and who knows something this module deliberately does not model:
// per reference/guitar-fretboard.md → "Where a pitch sounds best", two positions
// for the same pitch are NOT interchangeable. `12.2` is round and vocal; `7.1`
// is tense and bright. Both are B4. This module costs the HAND, not the VOICE,
// so "cheaper" never means "better" on its own. Every consumer must carry that
// caveat to the reader; `tools/fingering.mjs` prints it.
//
// WHY DYNAMIC PROGRAMMING AND NOT A GREEDY PASS
// ---------------------------------------------
// Because the greedy answer is wrong in exactly the cases that matter, and
// `greedyFingering()` below exists to prove it rather than to be believed. Take
// G4 B4 E5 G5 E5 B4 (tools/fixtures/fingering-greedy-trap.alphatab): the
// cheapest fingering for the FIRST note is fret 3 on string 1 — nothing about
// that beat is wrong — and it strands the hand at the bottom of the neck in
// front of a line that lives at fret 12. Greedy pays for that mistake three
// times over; the global optimum accepts a slightly costlier first note and then
// never moves. Choosing beat i requires knowing beat i+3, which is the textbook
// argument for Viterbi-style DP over a window rather than a local minimum.
//
// WHAT IT MAY NOT DO — the rules that make a suggestion trustworthy
// -----------------------------------------------------------------
//   1. NEVER change a pitch. A candidate is a re-spelling of the same MIDI note
//      on a different string/fret. `assertPitchPreserved` is asserted in tests.
//   2. NEVER suggest something a HARD gate would reject. Candidates are filtered
//      through `isPlayableVoicing()` (fret range, duplicate string, span, reach)
//      and through playability's own hard rules that this module can see:
//      3+ simultaneous notes on non-contiguous strings, and the >5-fret position
//      jump between consecutive 16ths. A recommender that proposes gate failures
//      is worse than no recommender.
//   3. NEVER relocate a note whose position IS the technique (Implement.md §2.3).
//      See `noteRules()`: harmonics, ties, let-ring and dead notes are PINNED;
//      bends, palm mutes and vibrato are FILTERED to positions that still permit
//      the technique; hammer/pull and slide pairs are constrained ACROSS the
//      transition, so a legato pair may move together but never apart.
//   4. NEVER speak unless it is worth speaking. A suggestion is emitted only
//      when the improvement clears BOTH an absolute and a relative floor
//      (`MIN_IMPROVEMENT`, `MIN_IMPROVEMENT_RATIO`). Ties and rounding wins
//      produce NO changes and NO advisory — otherwise the analyzer would rewrite
//      idiomatic writing for a hundredth of a cost unit, which is how a soft
//      channel trains its reader to ignore it.
//
// STANDARD TUNING ONLY. `positionsFor()` is called against the module's standard
// `OPEN` table, so a staff whose string count is not 6 is SKIPPED and counted in
// `stats.skippedStaves` rather than analysed against the wrong instrument. That
// matches the rest of the toolchain (reference/tunings.md is standard-tuning
// first; `playability.mjs`'s policy loader refuses a non-standard `tuning`).
//
// Pure ESM, node builtins + `@coderline/alphatab` (for its effect enums) only.
// NO filesystem access and NO top-level side effects: instrument limits arrive
// as plain `opts`, resolved once at a CLI boundary by lib/project-config.mjs
// (C5). Deterministic by construction — no clock, no randomness, and every
// ordering is a total order with an explicit tie-break, because "run it twice,
// get the same advice" is an acceptance criterion.
//
// String numbering: alphaTab's `note.string` is INTERNAL (1 = low E). Every note
// goes through `fromAlphaTabNote()` exactly once, in `buildPhrases`, and nothing
// downstream touches `note.string` again. That function is the project's ONE
// inversion boundary — see the banner in lib/fretboard.mjs.

import * as at from '@coderline/alphatab';
import { QUARTER_TICKS, midiToName } from './score-utils.mjs';
import {
  fromAlphaTabNote,
  positionsFor,
  spanOf,
  isPlayableVoicing,
  DEFAULT_MAX_FRET,
  STRING_COUNT,
} from './fretboard.mjs';
import { advisory } from './advisory.mjs';

// ---------------------------------------------------------------------------
// Tunable constants — every one of them traceable to the reference library
// ---------------------------------------------------------------------------

/**
 * The comfortable fretting-hand window, as a SPAN (so 3 means frets n..n+3).
 *
 * reference/guitar-fretboard.md → "CAGED position map": *"voice the accompaniment
 * inside the same 4-fret window rather than jumping the hand across the neck.
 * That is how you keep a reduction inside one playability hand position."* Four
 * frets, four fingers. Anything wider is a stretch — legal up to
 * `isPlayableVoicing`'s hard `maxSpan`, but paid for here.
 */
export const COMFORT_SPAN = 3;

/**
 * A hand-station move of this many frets or fewer is NOT a shift.
 *
 * The hand covers a 4-fret window (above), so moving the *station* by one or two
 * frets is a finger reach inside the window the hand already occupies — the
 * index finger stays put. Charging for it would make every ordinary riff look
 * expensive and drown the real finding: the shift that actually picks the hand
 * up off the neck.
 */
export const FREE_SHIFT_FRETS = 2;

/** Above this fret the neck gets thin; above `VERY_HIGH_FRET` the reference
 *  says reserve it for climaxes ("thin sound, hard intonation"), so the cost
 *  slope doubles there rather than stepping. */
export const HIGH_FRET_START = 12;
export const VERY_HIGH_FRET = 17;

/** Mirrors playability.mjs's hard rule: >5 frets between consecutive 16ths with
 *  no slide is `position-jump`, an ERROR. A suggestion must never create one. */
export const FAST_JUMP_FRETS = 5;
/** Mirrors playability.mjs: legato reach on one string is ~4 frets. */
export const HAMMER_MAX_FRETS = 4;
/** Palm mute responds on the wound strings (playability's `palm-mute-string`). */
const WOUND_STRINGS = new Set([4, 5, 6]);

/** Beam width: best-N states carried between events. 24 is far above the
 *  branching factor of a single note (a pitch has at most 4-5 positions on a
 *  22-fret neck), so on melodic writing the search is effectively exact; the
 *  beam only bites on dense chord phrases, where it bounds the blow-up. */
export const DEFAULT_BEAM = 24;

/** Per-beat candidate ceiling, and the node budget for the chord enumeration
 *  that feeds it. Both exist so a six-note grip cannot turn one bar into a
 *  combinatorial search; truncation is REPORTED (`truncated` on the candidate,
 *  `stats.truncatedBeats`), never hidden. */
export const MAX_CANDIDATES_PER_BEAT = 48;
export const MAX_ENUM_NODES = 20000;

/**
 * The DP window, in events. A phrase longer than this is optimised in chained
 * windows: the next window starts from the grip the previous one committed to,
 * so the seam is costed like any other transition rather than re-planned from
 * nothing.
 *
 * Phrases are the natural window (they end at a breath, where the hand is free
 * anyway); this is the backstop for a phrase that never breathes.
 */
export const DEFAULT_MAX_PHRASE_EVENTS = 48;

/** A gap of this many beats or more ends a phrase — the "breath" that
 *  reference/guitar-playability.md gives a fast run. After it the hand is free,
 *  so no fingering decision crosses it. */
export const PHRASE_BREAK_BEATS = 2;

/**
 * Floors below which an improvement is not worth reporting. BOTH must clear.
 *
 * Without them the optimiser would emit a "suggestion" whenever it found a
 * fingering cheaper by a rounding error — including exact ties broken by
 * candidate order, which are not improvements at all. The relative floor is
 * taken against `max(|current|, 1)` so a phrase that already costs almost
 * nothing cannot produce a large-looking ratio out of noise.
 */
export const MIN_IMPROVEMENT = 1.0;
export const MIN_IMPROVEMENT_RATIO = 0.15;

/** A shift bigger than this, under time pressure, is what `fingering.position-jump`
 *  is about. Deliberately BELOW playability's hard 5-fret/16th rule: this module
 *  only speaks when it also has a cheaper alternative to offer, so it can afford
 *  to look at shifts that are legal but avoidable. */
export const POSITION_JUMP_FRETS = 4;

/** Cost charged where the WRITTEN fingering violates a hard constraint, so the
 *  current path stays a finite, comparable number instead of Infinity. The tab's
 *  real verdict on such a note is playability's, not this module's. */
export const HARD_VIOLATION_PENALTY = 100;

/** Float comparisons only ever need to separate real cost differences. */
const EPS = 1e-9;

/**
 * Cost weights. Exported and overridable so Wave 3's style profiles can lean the
 * model (a metal profile tolerates a high-fret line a jazz profile would not)
 * WITHOUT any wave rewriting the model itself.
 *
 * Scale: one unit ≈ one fret of avoidable hand travel at eighth-note pace.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  /** Per fret of hand-station shift beyond `FREE_SHIFT_FRETS`, × time pressure. */
  position: 1.0,
  /** Per string crossed by the melodic top line between two attacks. */
  stringCross: 0.35,
  /** Per string SKIPPED — beyond a simple crossing. Charged both melodically and
   *  inside a simultaneous dyad, where a non-adjacent pair is the hybrid-picking
   *  grip playability warns about (`non-adjacent-dyad`, C14). It is deliberately
   *  larger than a small shift: changing the right hand's technique is a bigger
   *  ask than moving the left hand two frets. */
  stringSkip: 1.5,
  /** Per fret of grip span beyond the 4-fret CAGED window. */
  stretch: 1.2,
  /** Per fret above `HIGH_FRET_START` (doubled above `VERY_HIGH_FRET`). */
  highFret: 0.15,
  /** BONUS per finger left anchored — same string AND same fret across a change. */
  commonTone: 0.5,
  /** BONUS for a beat the fretting hand does not have to hold at all (every note
   *  open). That is the "useful open string" of the plan's cost sketch: it is
   *  useful precisely because it buys the hand time to travel. A partly-open
   *  GRIP earns nothing — the hand is already parked on it. */
  openString: 0.25,
});

// ---------------------------------------------------------------------------
// alphaTab effect enums (same defensive lookup playability.mjs uses: these live
// under the `model` namespace in @coderline/alphatab 1.5, not at top level)
// ---------------------------------------------------------------------------
const enumValue = (name, member, literal) =>
  at.model?.[name]?.[member] ?? at[name]?.[member] ?? literal;

const HARMONIC_NONE = enumValue('HarmonicType', 'None', 0);
const SLIDE_NONE = enumValue('SlideOutType', 'None', 0);
const VIBRATO_NONE = enumValue('VibratoType', 'None', 0);
// Only these two slide types CONNECT to the following note; the rest (out-up,
// out-down, pick slides) go nowhere in particular and are position-dependent
// gestures in their own right, so they pin instead of linking.
const SLIDE_SHIFT = enumValue('SlideOutType', 'Shift', 1);
const SLIDE_LEGATO = enumValue('SlideOutType', 'Legato', 2);
const BRUSH_NONE = 0;   // brush AND arpeggio share beat.brushType; 0 = neither

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Canonical, order-independent key for a grip — the tie-break that makes every
 *  ordering in this module a TOTAL order, and therefore deterministic. */
export function gripKey(positions) {
  return [...positions]
    .map((p) => `${p.string}:${p.fret}`)
    .sort()
    .join(',');
}

/**
 * The hand station a grip implies: its lowest FRETTED fret.
 *
 * `null` for an all-open (or empty) grip — and that null is load-bearing, not a
 * missing value. When nothing is fretted the hand is not holding anything, so it
 * is free to be wherever the music needs it next; charging a shift to or from
 * such a beat would invent hand travel that never happens. It is also exactly
 * why an all-open beat earns the open-string bonus.
 */
export function positionOf(positions) {
  const s = spanOf(positions);
  return s.frettedCount > 0 ? s.minFret : null;
}

/** The string the ear follows: the highest-sounding note's string (string 1 is
 *  the high e, so that is the LOWEST string number in the grip). */
function topString(positions) {
  let best = null;
  for (const p of positions) {
    if (best === null || p.string < best) best = p.string;
  }
  return best;
}

/**
 * How much a hand shift costs at this speed.
 *
 *   16th (0.25 beats) -> 2.0     quarter (1 beat) -> 0.5
 *   8th  (0.5  beats) -> 1.0     half    (2 beats) -> 0.25
 *
 * Implement.md §2.2: "large movement + long rest = relatively cheap; large
 * movement + 16th note = expensive". Clamped at both ends so a grace-note gap
 * cannot produce an unbounded cost and a fermata cannot make travel free.
 */
export function timePressure(gapBeats) {
  const g = Number.isFinite(gapBeats) && gapBeats > 0 ? gapBeats : 0.0625;
  return clamp(0.5 / g, 0.25, 4);
}

/** Are these string numbers a contiguous block (a single pick sweep)? */
function contiguousStrings(positions) {
  const strings = [...new Set(positions.map((p) => p.string))].sort((a, b) => a - b);
  if (strings.length <= 1) return true;
  return strings[strings.length - 1] - strings[0] + 1 === strings.length;
}

// ---------------------------------------------------------------------------
// Technique protection (Implement.md §2.3)
// ---------------------------------------------------------------------------

/**
 * What a note's own effects permit.
 *
 * Two grades, because the plan asks for two:
 *   PIN     — the written position IS the sound. Moving it changes the music,
 *             not the fingering, so no alternative is generated at all.
 *   FILTER  — the technique survives relocation, but only onto positions that
 *             still permit it ("a candidate may move such a note only if the
 *             alternative explicitly preserves the technique").
 *
 * Pin reasons, and why each is a pin rather than a filter:
 *   harmonic   a natural harmonic's pitch is NOT `open + fret`; it is the node's
 *              partial. Relocating it by pitch would silently rewrite the note.
 *              Artificial/pinch/tap harmonics are equally position-bound (the
 *              node is measured from the fretted note), so every harmonic pins.
 *   tie        a tie chain is one sounding note. Its members must share one
 *              string and one fret; a chain-aware move is a Wave-2 non-goal, so
 *              the honest answer is not to move it.
 *   let-ring   {lr} is a statement about which STRING keeps ringing under the
 *              notes that follow. Move the note and the overlap it was written
 *              for disappears.
 *   dead-note  an `x` has no pitch to relocate by.
 *   open-string a written open string is a committed VOICE, not a cheap
 *              fingering — reference/guitar-fretboard.md: open strings "ring
 *              long and cannot be vibratoed, bent, or damped", which is the
 *              whole point of using one. One-directional: fretted -> open stays
 *              available (that is the plan's useful-open-string bonus); open ->
 *              fretted is a musical decision this module may not make.
 *   slide-out  an out/pick slide is a gesture away from a position, not a link
 *              to a pitch.
 *
 * @returns {{ pin: boolean, reasons: string[], allow: (pos) => boolean }}
 */
export function noteRules(note, beat = null) {
  const raw = note.raw ?? note;
  const reasons = [];
  const filters = [];

  const harmonicType = raw.harmonicType ?? HARMONIC_NONE;
  if (harmonicType !== HARMONIC_NONE) reasons.push('harmonic');
  if (raw.isDead) reasons.push('dead-note');
  if (raw.isTieOrigin || raw.isTieDestination) reasons.push('tie');
  if (raw.isLetRing || beat?.isLetRing) reasons.push('let-ring');

  const slide = raw.slideOutType ?? SLIDE_NONE;
  if (slide !== SLIDE_NONE && slide !== SLIDE_SHIFT && slide !== SLIDE_LEGATO) {
    reasons.push('slide-out');
  }

  // A WRITTEN open string is a committed voice, not a cheap fingering of a
  // pitch. reference/guitar-fretboard.md: open strings "ring long and cannot be
  // vibratoed, bent, or damped" — which is exactly why an arranger reaches for
  // one. So open -> fretted is a musical decision (change the note's character),
  // never a fingering optimisation, and this module does not get to propose it.
  //
  // The rule is deliberately ONE-DIRECTIONAL. Fretted -> open stays available:
  // that is the plan's "useful open string bonus", the optimiser DISCOVERING an
  // open string that frees the hand. Removing one the arranger already chose is
  // a different act. Without this, the cost model would trade an open-string
  // riff for a fretted one to save a little picking-hand travel — cheaper by the
  // numbers, wrong by the ear.
  if (note.fret === 0) reasons.push('open-string');

  // --- filters: the technique travels, but not everywhere ---
  if (raw.hasBend) {
    // playability's own bend rules: only the plain strings 1-3 bend in tune, and
    // a bend wants fret >= 5 for string tension.
    filters.push({ reason: 'bend', fn: (p) => p.string <= 3 && p.fret >= 5 });
  }
  if (raw.isPalmMute) {
    filters.push({ reason: 'palm-mute', fn: (p) => WOUND_STRINGS.has(p.string) });
  }
  const vibrato = raw.vibrato ?? VIBRATO_NONE;
  if (vibrato !== VIBRATO_NONE || (beat?.vibrato ?? VIBRATO_NONE) !== VIBRATO_NONE) {
    // You cannot vibrato an open string (the fretting hand is not on it).
    filters.push({ reason: 'vibrato', fn: (p) => p.fret > 0 });
  }

  const pin = reasons.length > 0;
  return {
    pin,
    reasons: pin ? reasons : filters.map((f) => f.reason),
    allow: (pos) => filters.every((f) => f.fn(pos)),
  };
}

/**
 * The legato link a beat projects onto the NEXT beat, or null.
 *
 * Hammer/pull and shift/legato slides are relations between two beats, not
 * properties of one, which is why they are enforced in the DP TRANSITION rather
 * than by pinning: a legato pair is free to move up the neck together, and only
 * forbidden to come apart. That is precisely "may move only if the alternative
 * explicitly preserves the technique", expressed as a constraint the optimiser
 * can satisfy instead of a veto it cannot.
 *
 * Multi-note beats are excluded by the caller: identifying WHICH note of a grip
 * a hammer resolves into needs the voice-leading model this wave does not have,
 * and guessing would be worse than declining — so those beats pin instead.
 */
function legatoLinkOf(notes) {
  for (const n of notes) {
    const raw = n.raw ?? n;
    if (raw.isHammerPullOrigin) return { type: 'hammer', maxReach: HAMMER_MAX_FRETS };
    const slide = raw.slideOutType ?? SLIDE_NONE;
    if (slide === SLIDE_SHIFT || slide === SLIDE_LEGATO) return { type: 'slide', maxReach: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/**
 * Cost of holding one grip, independent of what came before it.
 *
 * Stretch and high-fret are hand facts; the open bonus is the plan's
 * "useful open string", narrowed to the case where it is genuinely useful — a
 * beat with NOTHING fretted, which frees the hand to travel (see `positionOf`).
 * A partly-open chord earns nothing: the hand is holding it either way.
 */
export function staticCost(positions, weights = DEFAULT_WEIGHTS) {
  const s = spanOf(positions);
  let cost = 0;

  if (s.frettedCount > 0) {
    cost += Math.max(0, s.span - COMFORT_SPAN) * weights.stretch;
    cost += Math.max(0, s.minFret - HIGH_FRET_START) * weights.highFret;
    cost += Math.max(0, s.minFret - VERY_HIGH_FRET) * weights.highFret;   // steeper up top
  } else if (s.openCount > 0) {
    cost -= weights.openString;
  }

  // A non-adjacent DYAD is legal but needs hybrid picking (C14) — a real
  // right-hand decision, so it is priced, not banned. 3+ non-adjacent notes
  // never reach here: `candidatesForBeat` rejects them outright.
  if (positions.length === 2 && !contiguousStrings(positions)) {
    cost += weights.stringSkip;
  }
  return cost;
}

/**
 * Every legal way to play one beat's notes, cheapest-first.
 *
 * The written grip is always present when it is legal, so "change nothing" is
 * always reachable and always wins a tie.
 *
 * Rejection happens in two passes for a reason: per-note legality (does the
 * pitch exist there, does the technique survive) prunes the product BEFORE it is
 * enumerated, while whole-grip legality (duplicate string, span, reach, pick
 * reachability) can only be judged once a full assignment exists.
 */
export function candidatesForBeat(ev, opts) {
  const maxFret = opts.maxFret ?? DEFAULT_MAX_FRET;
  const stringCount = opts.stringCount ?? STRING_COUNT;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const notes = ev.notes;
  if (!notes.length) return [];

  const currentPositions = ev.currentPositions;

  // --- per-note option lists -------------------------------------------------
  const perNote = notes.map((n) => {
    const here = { string: n.string, fret: n.fret, midi: n.midi };
    if (ev.pinned || n.rules.pin) return [here];
    const all = positionsFor(n.midi, { maxFret })
      .filter((p) => p.string >= 1 && p.string <= stringCount)
      .filter((p) => n.rules.allow(p));
    // A note whose every alternative is filtered away stays where it is: the
    // written position is evidence that SOMETHING works, and dropping the beat
    // would lose the phrase.
    if (!all.length) return [here];
    // Guarantee the written position is present even where the pitch table and
    // the written fret disagree (an out-of-range note — playability's error to
    // report, not ours to hide by omitting the beat).
    if (!all.some((p) => p.string === here.string && p.fret === here.fret)) all.push(here);
    return all;
  });

  // --- bounded Cartesian product with early pruning --------------------------
  // `HAND_SPAN_CEILING` is the LOOSEST hard span `isPlayableVoicing` ever allows
  // (5, up the neck). It prunes hopeless partial assignments early; the real,
  // position-dependent legality test still runs on every completed grip.
  const HAND_SPAN_CEILING = 5;
  const out = [];
  const seen = new Set();
  let nodes = 0;
  let truncated = false;

  const walk = (i, acc, usedStrings, minF, maxF) => {
    if (truncated) return;
    if (++nodes > MAX_ENUM_NODES) { truncated = true; return; }
    if (i === perNote.length) {
      const positions = acc.slice();
      const key = gripKey(positions);
      if (seen.has(key)) return;
      if (!isPlayableVoicing(positions, { maxFret, stringCount }).ok) return;
      // playability C14: 3+ simultaneous notes on non-contiguous strings is a
      // HARD error unless the beat is brushed/arpeggiated. Never propose one.
      if (positions.length >= 3 && !ev.brushed && !contiguousStrings(positions)) return;
      seen.add(key);
      out.push({ positions, key, staticCost: staticCost(positions, weights) });
      return;
    }
    for (const p of perNote[i]) {
      if (usedStrings.has(p.string)) continue;               // one note per string
      const nMin = p.fret > 0 ? Math.min(minF, p.fret) : minF;
      const nMax = p.fret > 0 ? Math.max(maxF, p.fret) : maxF;
      if (nMin !== Infinity && nMax - nMin > HAND_SPAN_CEILING) continue;
      usedStrings.add(p.string);
      acc.push(p);
      walk(i + 1, acc, usedStrings, nMin, nMax);
      acc.pop();
      usedStrings.delete(p.string);
    }
  };
  walk(0, [], new Set(), Infinity, -Infinity);

  // Deterministic order: cheapest first, ties broken by the canonical key.
  out.sort((a, b) => (a.staticCost - b.staticCost) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const currentKey = gripKey(currentPositions);
  let list = out.slice(0, MAX_CANDIDATES_PER_BEAT);
  // Re-admit the written grip if the cap dropped it — "change nothing" must
  // always be on the table, or a truncated search could force a change.
  if (!list.some((c) => c.key === currentKey)) {
    const cur = out.find((c) => c.key === currentKey);
    if (cur) list = [cur, ...list.slice(0, MAX_CANDIDATES_PER_BEAT - 1)];
  }
  for (const c of list) {
    c.isCurrent = c.key === currentKey;
    if (truncated) c.truncated = true;
  }
  return list;
}

/**
 * Cost of moving the hand from one grip to the next — and whether it is legal
 * at all.
 *
 * `legal:false` is a HARD veto and is reserved for the two constraints a
 * suggestion must never break:
 *   • playability's `position-jump` error (>5 frets between consecutive 16ths
 *     with no slide out);
 *   • a legato/slide link coming apart (different string, or a hammer reach past
 *     ~4 frets).
 * Everything else is priced.
 */
export function transitionCost(prevPositions, curPositions, ctx = {}, weights = DEFAULT_WEIGHTS) {
  const { gapBeats, link, fastPair, slidesOut } = ctx;
  let cost = 0;

  const pPos = positionOf(prevPositions);
  const cPos = positionOf(curPositions);

  // --- hard: legato links may travel, but not come apart ---------------------
  if (link) {
    if (prevPositions.length !== 1 || curPositions.length !== 1) {
      // Multi-note legato is pinned upstream; reaching here means the shapes
      // disagree, so decline rather than guess.
      return { cost: 0, legal: false, reason: 'legato-multi-note' };
    }
    const a = prevPositions[0];
    const b = curPositions[0];
    if (a.string !== b.string) {
      return { cost: 0, legal: false, reason: `${link.type}-crosses-string` };
    }
    if (link.maxReach !== null && Math.abs(b.fret - a.fret) > link.maxReach) {
      return { cost: 0, legal: false, reason: `${link.type}-reach` };
    }
  }

  // --- hard: never create playability's fast position-jump error -------------
  if (fastPair && !slidesOut && pPos !== null && cPos !== null
    && Math.abs(cPos - pPos) > FAST_JUMP_FRETS) {
    return { cost: 0, legal: false, reason: 'fast-position-jump' };
  }

  // --- hand station ----------------------------------------------------------
  if (pPos !== null && cPos !== null) {
    const shift = Math.abs(cPos - pPos);
    cost += Math.max(0, shift - FREE_SHIFT_FRETS) * weights.position * timePressure(gapBeats);
  }

  // --- string crossing / skipping of the melodic top line --------------------
  const pTop = topString(prevPositions);
  const cTop = topString(curPositions);
  if (pTop !== null && cTop !== null) {
    const crossing = Math.abs(cTop - pTop);
    cost += crossing * weights.stringCross;
    cost += Math.max(0, crossing - 1) * weights.stringSkip;
  }

  // --- anchored fingers ------------------------------------------------------
  // A finger that does not move is a finger that does not have to be replaced —
  // but only across a CHANGE of grip. Re-striking the identical grip is not an
  // anchored finger, it is no hand movement at all, and it must score exactly 0.
  //
  // Awarding the bonus there was a real bug with a musically backwards result:
  // a repeated OPEN string earned nothing (no finger is down) while a repeated
  // FRETTED note earned the bonus every time, so the optimiser "improved" an
  // open-string riff by fretting it — harder to play, and a different sound
  // (reference/guitar-fretboard.md: an open string rings, and cannot be
  // vibratoed, bent or damped). Identical grips now tie, and the open-string
  // bonus in `staticCost` correctly settles the tie in the open string's favour.
  const unchanged = prevPositions.length === curPositions.length
    && gripKey(prevPositions) === gripKey(curPositions);
  if (!unchanged) {
    let common = 0;
    for (const a of prevPositions) {
      for (const b of curPositions) {
        if (a.string === b.string && a.fret === b.fret && a.fret > 0) { common++; break; }
      }
    }
    cost -= common * weights.commonTone;
  }

  return { cost, legal: true, reason: null };
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/** Deterministic total order over DP states. */
function stateOrder(a, b) {
  return (a.cost - b.cost) || (a.cand.key < b.cand.key ? -1 : a.cand.key > b.cand.key ? 1 : 0);
}

/** Transition context for the pair (events[i-1], events[i]). */
function pairContext(prevEv, curEv) {
  return {
    gapBeats: prevEv.durationBeats,
    link: prevEv.link,
    // playability's hard jump rule applies only between two 16th-or-faster beats.
    fastPair: prevEv.durationValue >= 16 && curEv.durationValue >= 16,
    slidesOut: prevEv.slidesOut,
  };
}

/**
 * Beam-limited Viterbi over one phrase, in windows of `maxPhraseEvents`.
 *
 * A window boundary is a SEAM, not a reset: the next window is seeded with the
 * grip the previous window committed to, and the first transition of the new
 * window is costed against it. (Restarting cold there would let the optimiser
 * teleport the hand once every 48 events for free.)
 *
 * Dead ends are real — a chain of hard constraints can be unsatisfiable from
 * every surviving state — and are handled by committing what exists, restarting
 * at that event, and recording a `discontinuity`. Never by throwing: a soft
 * analyzer that crashes on legal input is an operational failure (C2), not a
 * finding.
 *
 * @returns {{ path: object[], cost: number, discontinuities: object[] }}
 *          `path[i]` is the chosen candidate for `events[i]`.
 */
export function optimizePhrase(events, opts = {}) {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const beam = opts.beam ?? DEFAULT_BEAM;
  const windowSize = opts.maxPhraseEvents ?? DEFAULT_MAX_PHRASE_EVENTS;

  const discontinuities = [];
  const path = [];
  let total = 0;
  let states = null;      // null => the next event starts a fresh sub-search
  let seed = null;        // committed predecessor grip (already in `path`)
  let seedIndex = -1;
  let windowStart = 0;

  const prune = (list) => {
    list.sort(stateOrder);
    return list.length > beam ? list.slice(0, beam) : list;
  };

  /** Append the best surviving chain to `path` and return its last candidate. */
  const commit = () => {
    if (!states || !states.length) return null;
    states.sort(stateOrder);
    const best = states[0];
    const chain = [];
    for (let s = best; s; s = s.prev) chain.push(s.cand);
    chain.reverse();
    path.push(...chain);
    total += best.cost;
    states = null;
    return best.cand;
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const cands = ev.candidates;
    if (!cands.length) continue;

    if (states === null) {
      // Fresh sub-search. If the previous event was committed as a window seed,
      // the first step is still costed against it.
      let seeded = [];
      if (seed !== null && seedIndex === i - 1) {
        const ctx = pairContext(events[seedIndex], ev);
        for (const c of cands) {
          const t = transitionCost(seed.positions, c.positions, ctx, weights);
          if (!t.legal) continue;
          seeded.push({ cand: c, cost: t.cost + c.staticCost, prev: null });
        }
        if (!seeded.length) discontinuities.push({ index: i, bar: ev.barNum, reason: 'seam' });
      }
      if (!seeded.length) seeded = cands.map((c) => ({ cand: c, cost: c.staticCost, prev: null }));
      states = prune(seeded);
      seed = null;
      seedIndex = -1;
      continue;
    }

    const ctx = pairContext(events[i - 1], ev);
    const next = [];
    for (const c of cands) {
      let best = null;
      for (const s of states) {
        const t = transitionCost(s.cand.positions, c.positions, ctx, weights);
        if (!t.legal) continue;
        const cost = s.cost + t.cost + c.staticCost;
        if (best === null || cost < best.cost - EPS) best = { cand: c, cost, prev: s };
      }
      if (best) next.push(best);
    }

    if (!next.length) {
      // Unsatisfiable seam: commit what exists, then restart here.
      discontinuities.push({ index: i, bar: ev.barNum, reason: 'no-legal-transition' });
      commit();
      states = prune(cands.map((c) => ({ cand: c, cost: c.staticCost, prev: null })));
      windowStart = i;
      continue;
    }
    states = prune(next);

    // Window seam: commit and carry only the winning grip forward.
    if (i - windowStart + 1 >= windowSize && i < events.length - 1) {
      seed = commit();
      seedIndex = i;
      windowStart = i + 1;
    }
  }
  commit();

  return { path, cost: total, discontinuities };
}

/**
 * The straw man, kept honest and kept in the repo on purpose.
 *
 * Beat-by-beat local minimisation: choose each event's cheapest fingering given
 * ONLY the previous choice, ties broken by the canonical key (lowest string,
 * then lowest fret) — which is what a naive implementation does, and what a
 * player sight-reading one note at a time does.
 *
 * `fingering.test.mjs` pins that `optimizePhrase` beats this on
 * `tools/fixtures/fingering-greedy-trap.alphatab`. It exists to be beaten; it is
 * deliberately NOT wired into the analyzer.
 */
export function greedyFingering(events, opts = {}) {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const path = [];
  let cost = 0;
  let prevIdx = -1;

  for (let i = 0; i < events.length; i++) {
    const cands = events[i].candidates;
    if (!cands.length) continue;
    if (prevIdx === -1) {
      const pick = cands[0];   // already sorted by (staticCost, key)
      path.push(pick);
      cost += pick.staticCost;
      prevIdx = i;
      continue;
    }
    const ctx = pairContext(events[prevIdx], events[i]);
    const prev = path[path.length - 1];
    let best = null;
    for (const c of cands) {
      const t = transitionCost(prev.positions, c.positions, ctx, weights);
      if (!t.legal) continue;
      const step = t.cost + c.staticCost;
      if (best === null || step < best.step - EPS) best = { cand: c, step };
    }
    // Painted into a corner — exactly the failure mode the DP does not have.
    if (!best) best = { cand: cands[0], step: cands[0].staticCost + HARD_VIOLATION_PENALTY };
    path.push(best.cand);
    cost += best.step;
    prevIdx = i;
  }
  return { path, cost };
}

/**
 * Cost of the fingering the arranger actually wrote.
 *
 * Hard-constraint violations are charged `HARD_VIOLATION_PENALTY` instead of
 * being rejected: the written tab is a fact, and the number has to stay finite
 * and comparable to the suggestion's. The violations are reported so a reader
 * can see when the score is dominated by them — and they are playability's
 * finding to make, not this module's.
 */
export function currentPathCost(events, opts = {}) {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const maxFret = opts.maxFret ?? DEFAULT_MAX_FRET;
  const stringCount = opts.stringCount ?? STRING_COUNT;
  const violations = [];
  let cost = 0;
  let prevIdx = -1;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const positions = ev.currentPositions;
    if (!positions.length) continue;
    cost += staticCost(positions, weights);
    const v = isPlayableVoicing(positions, { maxFret, stringCount });
    if (!v.ok) {
      cost += HARD_VIOLATION_PENALTY;
      violations.push({ bar: ev.barNum, beat: ev.beatIndex, rules: v.violations.map((x) => x.rule) });
    }
    if (prevIdx !== -1) {
      const ctx = pairContext(events[prevIdx], ev);
      const t = transitionCost(events[prevIdx].currentPositions, positions, ctx, weights);
      cost += t.legal ? t.cost : HARD_VIOLATION_PENALTY;
      if (!t.legal) violations.push({ bar: ev.barNum, beat: ev.beatIndex, rules: [t.reason] });
    }
    prevIdx = i;
  }
  return { cost, violations };
}

// ---------------------------------------------------------------------------
// Score -> phrases
// ---------------------------------------------------------------------------

/**
 * Split the score into phrases of consecutive attacks, per (track, staff, voice).
 *
 * Per Implement.md §2.1 the input is derived DIRECTLY from the parsed alphaTab
 * score — there is no second beat representation to drift out of sync with the
 * one validate/playability/compare already read.
 *
 * A phrase ends at a rest, after a note of >= `PHRASE_BREAK_BEATS`, at a bar
 * outside `--bars`, or at a bar discontinuity. Those are the places the hand is
 * free, so no fingering decision needs to cross one.
 *
 * @returns {{ phrases: object[], skippedStaves: object[] }}
 */
export function buildPhrases(score, opts = {}) {
  const range = opts.range ?? null;
  const inRange = (barNum) => !range || (barNum >= range.lo && barNum <= range.hi);

  const phrases = [];
  const skippedStaves = [];
  let droppedNotes = 0;
  let phraseId = 0;

  for (let ti = 0; ti < score.tracks.length; ti++) {
    const track = score.tracks[ti];
    for (let si = 0; si < track.staves.length; si++) {
      const staff = track.staves[si];
      // THE staff gate. A staff's own `stringTuning` is the only trustworthy
      // evidence that it is a FRETTED staff at all, and it is checked before
      // anything else because the failure it prevents is the worst kind: silent
      // and confident.
      //
      // A piano/score staff (`\staff { score }`, as every `projects/<slug>/
      // source.alphatab` uses) reports `tunings: []`, and alphaTab gives its
      // notes `string: -1, fret: -1` — they have no fretboard position, only a
      // pitch. Falling back to "well, assume 6 strings" turned that -1 into
      // string 8 / fret -1, an impossible grip that then scored as a hard
      // violation, so the optimiser cheerfully "improved" every note of a piano
      // SOURCE by 100 cost units. Every one of those suggestions was noise
      // dressed as a finding. A staff with no tuning is not a guitar; say so.
      const tunings = staff.stringTuning?.tunings ?? [];
      if (tunings.length === 0) {
        skippedStaves.push({
          track: ti,
          staff: si,
          stringCount: 0,
          reason: 'not a fretted staff (no string tuning) — nothing here has a fingering',
        });
        continue;
      }
      const stringCount = tunings.length;
      if (stringCount !== STRING_COUNT) {
        // Standard tuning only (see the module header): analysing a 7-string or
        // re-tuned staff against the standard OPEN table would produce
        // confident, wrong pitches. Declining loudly beats answering wrongly.
        skippedStaves.push({ track: ti, staff: si, stringCount, reason: 'non-standard string count' });
        continue;
      }
      const voiceCount = staff.bars.reduce((m, b) => Math.max(m, b.voices.length), 0);

      for (let vi = 0; vi < voiceCount; vi++) {
        let tempo = score.tempo || 120;
        let events = [];
        let lastBar = null;

        const flush = () => {
          if (events.length) {
            phrases.push(makePhrase(phraseId++, ti, si, vi, events, { ...opts, stringCount }));
          }
          events = [];
        };

        for (const bar of staff.bars) {
          const auto = bar.masterBar?.tempoAutomation;
          if (auto && Number.isFinite(auto.value) && auto.value > 0) tempo = auto.value;
          const barNum = bar.index + 1;
          if (!inRange(barNum)) { flush(); lastBar = null; continue; }
          if (lastBar !== null && barNum !== lastBar + 1) flush();
          lastBar = barNum;
          const voice = bar.voices[vi];
          if (!voice) continue;

          for (const beat of voice.beats) {
            const durationBeats = beat.playbackDuration / QUARTER_TICKS;
            if (beat.isRest || !beat.notes.length) { flush(); continue; }

            // THE one inversion (lib/fretboard.mjs's banner): alphaTab-internal
            // string numbering becomes SOURCE numbering here and nowhere else.
            // The per-note guard is belt-and-braces behind the staff gate above:
            // a note with no fretboard position (string/fret -1) must never be
            // reasoned about as if it had one, and dropping it is COUNTED so the
            // omission is visible rather than silent.
            const notes = [];
            for (const raw of beat.notes) {
              if (!Number.isInteger(raw.string) || raw.string < 1 || raw.string > stringCount
                || !Number.isInteger(raw.fret) || raw.fret < 0) {
                droppedNotes++;
                continue;
              }
              const n = { raw, ...fromAlphaTabNote(raw, stringCount), durationBeats };
              if (Number.isFinite(n.midi)) notes.push(n);
              else droppedNotes++;
            }
            if (!notes.length) { flush(); continue; }
            for (const n of notes) n.rules = noteRules(n, beat);

            const link = legatoLinkOf(notes);
            const chordLegato = !!link && notes.length > 1;
            const ev = {
              beat,
              barNum,
              beatIndex: beat.index,
              tempo,
              durationBeats,
              durationValue: Number(beat.duration) || 0,
              notes,
              brushed: (beat.brushType ?? BRUSH_NONE) !== BRUSH_NONE,
              slidesOut: notes.some((n) => (n.raw.slideOutType ?? SLIDE_NONE) !== SLIDE_NONE),
              // A legato link is only followed when both ends are single notes;
              // a CHORD that hammers or slides pins itself and its partner.
              link: link && !chordLegato ? link : null,
              pinned: chordLegato,
              pinsNext: chordLegato,
              currentPositions: notes.map((n) => ({ string: n.string, fret: n.fret, midi: n.midi })),
            };
            events.push(ev);
            if (durationBeats >= PHRASE_BREAK_BEATS) flush();
          }
        }
        flush();
      }
    }
  }

  return { phrases, skippedStaves, droppedNotes };
}

/** Turn a raw event run into a phrase with candidates attached. */
function makePhrase(id, trackIndex, staffIndex, voiceIndex, events, opts) {
  // Propagate a chord-legato pin onto the beat it resolves into.
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].pinsNext) events[i + 1].pinned = true;
  }
  for (const ev of events) ev.candidates = candidatesForBeat(ev, opts);
  const bars = [...new Set(events.map((e) => e.barNum))].sort((a, b) => a - b);
  return {
    id,
    track: trackIndex,
    staff: staffIndex,
    voice: voiceIndex,
    bars,
    firstBar: bars[0],
    lastBar: bars[bars.length - 1],
    events,
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const round = (n, places = 2) => {
  const f = 10 ** places;
  // `+ 0` normalises -0 to 0, so two identical runs cannot print a different zero.
  return Math.round(n * f) / f + 0;
};

/** Largest hand-station shift anywhere along a path — the headline number for
 *  "does this fingering pick the hand up off the neck?". */
export function maxShiftOf(positionsList) {
  let max = 0;
  let prev = null;
  for (const positions of positionsList) {
    const pos = positionOf(positions);
    if (pos !== null && prev !== null) max = Math.max(max, Math.abs(pos - prev));
    if (pos !== null) prev = pos;
  }
  return max;
}

/** Widest grip anywhere along a path. */
function maxSpanOf(positionsList) {
  let max = 0;
  for (const positions of positionsList) max = Math.max(max, spanOf(positions).span);
  return max;
}

/** Total string crossings along a path (the melodic top line). */
function crossingsOf(positionsList) {
  let n = 0;
  for (let i = 1; i < positionsList.length; i++) {
    const a = topString(positionsList[i - 1]);
    const b = topString(positionsList[i]);
    if (a !== null && b !== null) n += Math.abs(b - a);
  }
  return n;
}

const describeNote = (p) => ({
  string: p.string, fret: p.fret, midi: p.midi, name: midiToName(p.midi),
});

/**
 * Analyse a parsed score and return phrase reports plus contract-C3 advisories.
 *
 * @param {object} score alphaTab Score.
 * @param {object} [opts]
 * @param {{lo:number,hi:number}|null} [opts.range] 1-based bar range.
 * @param {number} [opts.maxFret] Resolved instrument limit (C5) — NOT read from
 *        a file here; a CLI resolves it via lib/project-config.mjs.
 * @param {number} [opts.stringCount]
 * @param {object} [opts.weights] Override `DEFAULT_WEIGHTS` (Wave 3 style hook).
 * @param {number} [opts.beam]
 * @returns {{ phrases: object[], advisories: object[], stats: object, settings: object }}
 */
export function analyzeFingering(score, opts = {}) {
  const settings = {
    maxFret: opts.maxFret ?? DEFAULT_MAX_FRET,
    stringCount: opts.stringCount ?? STRING_COUNT,
    weights: opts.weights ?? DEFAULT_WEIGHTS,
    beam: opts.beam ?? DEFAULT_BEAM,
    maxPhraseEvents: opts.maxPhraseEvents ?? DEFAULT_MAX_PHRASE_EVENTS,
    range: opts.range ?? null,
  };

  const { phrases: built, skippedStaves, droppedNotes } = buildPhrases(score, settings);
  const reports = [];
  const advisories = [];
  let eventCount = 0;
  let noteCount = 0;
  let improvedCount = 0;
  let truncatedBeats = 0;

  for (const phrase of built) {
    const events = phrase.events;
    eventCount += events.length;
    for (const ev of events) {
      noteCount += ev.notes.length;
      if (ev.candidates.some((c) => c.truncated)) truncatedBeats++;
    }

    const current = currentPathCost(events, settings);
    const best = optimizePhrase(events, settings);

    const improvement = current.cost - best.cost;
    const material = improvement >= MIN_IMPROVEMENT
      && improvement / Math.max(Math.abs(current.cost), 1) >= MIN_IMPROVEMENT_RATIO;

    const currentList = events.map((e) => e.currentPositions);
    const suggestedList = best.path.map((c) => c.positions);

    const report = {
      id: phrase.id,
      track: phrase.track,
      staff: phrase.staff,
      voice: phrase.voice,
      bars: phrase.bars,
      firstBar: phrase.firstBar,
      lastBar: phrase.lastBar,
      events: events.length,
      current: {
        cost: round(current.cost),
        maxShift: maxShiftOf(currentList),
        maxSpan: maxSpanOf(currentList),
        crossings: crossingsOf(currentList),
        violations: current.violations,
      },
      suggested: {
        cost: round(best.cost),
        maxShift: maxShiftOf(suggestedList),
        maxSpan: maxSpanOf(suggestedList),
        crossings: crossingsOf(suggestedList),
      },
      improvement: round(improvement),
      material,
      changes: [],
      pinned: [],
      reason: null,
      discontinuities: best.discontinuities,
    };

    for (const ev of events) {
      for (const n of ev.notes) {
        if (!n.rules.pin && !ev.pinned) continue;
        report.pinned.push({
          bar: ev.barNum,
          beat: ev.beatIndex,
          note: midiToName(n.midi),
          string: n.string,
          fret: n.fret,
          reasons: n.rules.pin ? n.rules.reasons : ['legato-chord'],
        });
      }
    }

    // Changes are computed ONLY for a material improvement (header rule 4): an
    // immaterial win is not advice, it is noise with a number attached.
    if (material && best.path.length === events.length) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const to = best.path[i].positions;
        for (let k = 0; k < ev.currentPositions.length; k++) {
          const a = ev.currentPositions[k];
          const b = to[k];
          if (!b || (a.string === b.string && a.fret === b.fret)) continue;
          report.changes.push({
            bar: ev.barNum,
            beat: ev.beatIndex,
            from: describeNote(a),
            to: describeNote(b),
          });
        }
      }
      report.reason = reasonFor(report);
    }

    reports.push(report);

    if (report.changes.length) {
      improvedCount++;
      advisories.push(advisory(
        'fingering.better-fingering',
        `bars ${phrase.firstBar}-${phrase.lastBar}: a cheaper fingering of the SAME pitches exists `
        + `(hand cost ${report.current.cost} -> ${report.suggested.cost}) — ${report.reason}. `
        + `${report.changes.length} note(s) would move; no pitch changes. Positions differ in TONE `
        + `as well as difficulty, so confirm the voice before adopting it.`,
        {
          track: phrase.track,
          bar: phrase.firstBar,
          data: {
            phrase: phrase.id,
            bars: phrase.bars,
            currentCost: report.current.cost,
            suggestedCost: report.suggested.cost,
            improvement: report.improvement,
            changes: report.changes.length,
            reason: report.reason,
          },
        },
      ));
      advisories.push(...locatedAdvisories(phrase, events, best.path));
    }
  }

  return {
    phrases: reports,
    advisories,
    stats: {
      phrases: reports.length,
      events: eventCount,
      notes: noteCount,
      phrasesImproved: improvedCount,
      truncatedBeats,
      droppedNotes,
      skippedStaves,
    },
    settings: {
      maxFret: settings.maxFret,
      stringCount: settings.stringCount,
      beam: settings.beam,
      weights: settings.weights,
    },
  };
}

/** The single sentence that says WHY the suggestion is better (Implement.md §2.4). */
function reasonFor(report) {
  const { current, suggested } = report;
  if (suggested.maxShift < current.maxShift) {
    return `it removes a ${current.maxShift}-fret hand shift `
      + `(worst shift ${current.maxShift} -> ${suggested.maxShift})`;
  }
  if (suggested.maxSpan < current.maxSpan) {
    return `it narrows a ${current.maxSpan}-fret stretch to ${suggested.maxSpan}`;
  }
  if (suggested.crossings < current.crossings) {
    return `it keeps the line on nearer strings `
      + `(${current.crossings} -> ${suggested.crossings} string crossings)`;
  }
  return 'it lowers the total hand cost across the phrase';
}

/**
 * The LOCATED reasons behind a phrase-level suggestion.
 *
 * `fingering.better-fingering` is the headline; these two say WHERE, in the
 * shape contract C3 gives as its own example (`fingering.position-jump` with
 * `fromPosition`/`toPosition`). Both fire ONLY inside a phrase that already has
 * a material suggestion, which is what keeps them off ordinary writing: each
 * describes an AVOIDABLE problem, never merely a hard one. A shift with no
 * better alternative is playability's finding, not this module's.
 */
function locatedAdvisories(phrase, events, path) {
  const out = [];
  // ONE finding per distinct problem, not one per occurrence.
  //
  // A riff that alternates a low pedal with a high stab poses the SAME question
  // fourteen times; printing it fourteen times does not make it fourteen
  // findings, it makes the one finding unreadable. playability.mjs already
  // settled this for pick-demand ("a bar of 16ths would otherwise emit sixteen
  // copies of the same sentence, which is how a real finding gets scrolled
  // past") — same doctrine here. The repeat count is kept in `data.occurrences`,
  // because "this happens 14 times" is itself information; it is just not
  // fourteen advisories.
  const firstSeen = new Map();
  const push = (dedupeKey, make) => {
    const prior = firstSeen.get(dedupeKey);
    if (prior) { prior.data.occurrences++; return; }
    const a = make();
    a.data.occurrences = 1;
    firstSeen.set(dedupeKey, a);
    out.push(a);
  };

  // -- position jumps the suggestion actually removes -------------------------
  for (let i = 1; i < events.length && i < path.length; i++) {
    const gap = events[i - 1].durationBeats;
    if (timePressure(gap) < 1) continue;          // slower than an eighth: not a speed problem
    const a = positionOf(events[i - 1].currentPositions);
    const b = positionOf(events[i].currentPositions);
    if (a === null || b === null) continue;
    const shift = Math.abs(b - a);
    if (shift <= POSITION_JUMP_FRETS) continue;
    const sa = positionOf(path[i - 1].positions);
    const sb = positionOf(path[i].positions);
    if (sa === null || sb === null) continue;
    const suggestedShift = Math.abs(sb - sa);
    if (suggestedShift >= shift) continue;
    push(`jump:${a}->${b}`, () => advisory(
      'fingering.position-jump',
      `bar ${events[i].barNum}: the written fingering shifts the hand ${shift} frets `
      + `(fret ${a} -> ${b}) between attacks ${round(gap, 4)} beat(s) apart; the suggested `
      + `fingering needs ${suggestedShift}.`,
      {
        track: phrase.track,
        bar: events[i].barNum,
        beat: events[i].beatIndex,
        data: {
          fromPosition: a,
          toPosition: b,
          suggestedFrom: sa,
          suggestedTo: sb,
          gapBeats: round(gap, 4),
        },
      },
    ));
  }

  // -- stretches the suggestion actually narrows ------------------------------
  for (let i = 0; i < events.length && i < path.length; i++) {
    const cur = spanOf(events[i].currentPositions);
    if (cur.frettedCount < 2 || cur.span <= COMFORT_SPAN) continue;
    const sug = spanOf(path[i].positions);
    if (sug.span >= cur.span) continue;
    push(`stretch:${cur.minFret}-${cur.maxFret}->${sug.span}`, () => advisory(
      'fingering.stretch',
      `bar ${events[i].barNum}: the grip spans ${cur.span} frets (${cur.minFret}-${cur.maxFret}), `
      + `past the 4-fret window the hand covers without moving; the suggested voicing of the same `
      + `pitches spans ${sug.span}.`,
      {
        track: phrase.track,
        bar: events[i].barNum,
        beat: events[i].beatIndex,
        data: { span: cur.span, suggestedSpan: sug.span, minFret: cur.minFret, maxFret: cur.maxFret },
      },
    ));
  }

  return out;
}

/**
 * Guard: every suggested position sounds the pitch it replaced.
 *
 * Exported because it is the one invariant a fingering tool absolutely may not
 * break, and an invariant checked only inside its own module is not checked at
 * all — `fingering.test.mjs` asserts it across every fixture.
 */
export function assertPitchPreserved(events, path) {
  for (let i = 0; i < events.length && i < path.length; i++) {
    const cur = events[i].currentPositions;
    const sug = path[i].positions;
    if (cur.length !== sug.length) {
      throw new Error(`fingering: event ${i} changed note count ${cur.length} -> ${sug.length}`);
    }
    for (let k = 0; k < cur.length; k++) {
      if (cur[k].midi !== sug[k].midi) {
        throw new Error(
          `fingering: event ${i} note ${k} changed pitch ${cur[k].midi} -> ${sug[k].midi}`);
      }
    }
  }
  return true;
}

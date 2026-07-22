// Vendored from abc-to-guitar@ba7e29c — tools/lib/fretboard.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// fretboard.mjs — guitar fretboard geometry in AlphaTex/source string numbering.
//
// ============================================================================
// STRING NUMBERING — read this before using anything in this file.
// ============================================================================
// This module speaks AlphaTex/source numbering EXCLUSIVELY:
//
//     string 1 = high e = MIDI 64        string 4 = D  = MIDI 50
//     string 2 = B      = MIDI 59        string 5 = A  = MIDI 45
//     string 3 = G      = MIDI 55        string 6 = low E = MIDI 40
//
// alphaTab's internal model numbers strings the other way round (its string 1
// is the LOW E). No function in this file ever accepts or returns an
// alphaTab-internal string number — except `fromAlphaTabNote`, which is the
// one and only place the inversion is allowed to happen, and
// `toAlphaTabString`, which is its inverse for emitting AlphaTex.
//
// Pure ESM, node builtins only, no dependencies, no top-level side effects.
// (`check.mjs` imports this; it must never print or exit on import.)

/**
 * Coerce to a finite number, or `null`.
 *
 * Deliberately stricter than `Number()`: `Number(null)`, `Number('')` and
 * `Number(false)` are all `0`, which would silently turn a missing pitch or a
 * missing fret into a real MIDI 0 / an open string. Everything in this module
 * that reads caller-supplied numbers goes through here.
 */
function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Open-string MIDI by AlphaTex string number. Index 0 unused. */
export const OPEN = [null, 64, 59, 55, 50, 45, 40]; // OPEN[1]=E4 … OPEN[6]=E2

export const STRING_COUNT = 6;
export const MAX_FRET = 22;

/**
 * THE inversion boundary. sourceString = (stringCount + 1) - internalString.
 *
 * ==========================================================================
 * THIS IS THE ONLY PLACE IN THE ENTIRE PROJECT THAT INVERTS A STRING NUMBER.
 * ==========================================================================
 * alphaTab counts strings from the LOW E (its `note.string === 1` is the low
 * E); AlphaTex source counts from the HIGH e. Every consumer of an alphaTab
 * `Beat`/`Note` MUST pass each note through this function AT THE `walkBeats`
 * CALL SITE, and must never touch `note.string` afterwards.
 *
 * Invert exactly once. Inverting twice silently restores alphaTab numbering
 * and every downstream fret/pitch decision is then wrong by a mirror — which
 * looks plausible (frets stay in range) and is therefore extremely hard to
 * catch by eye. Inverting zero times is equally wrong and equally quiet.
 * If you find yourself writing `7 - something` anywhere else, stop: the
 * conversion belongs here, or you already did it.
 *
 * `tools/validate.mjs` inverts `note.string` at the display site using the
 * same formula (stringCount + 1 - internalString), so its `fretRangeByString`
 * keys are SOURCE-numbered (string1 = high e ... string6 = low E) and match
 * AlphaTex source convention.
 *
 * @param {{ string: number, fret: number, realValue?: number }} note
 *        An alphaTab Note (INTERNAL numbering) or any object shaped like one.
 * @param {number} [stringCount=STRING_COUNT] Strings on the staff the note
 *        belongs to. Pass `staff.stringTuning.tunings.length` for non-6-string
 *        staves; the inversion is relative to the staff, not to this module.
 * @returns {{ string: number, fret: number, midi: number }}
 *          `string` is SOURCE-numbered. `midi` comes from `note.realValue`
 *          when alphaTab supplied it, else from standard tuning + fret.
 */
export function fromAlphaTabNote(note, stringCount = STRING_COUNT) {
  if (note === null || typeof note !== 'object') {
    throw new TypeError('fromAlphaTabNote: expected a note object');
  }
  const internalString = num(note.string);
  const fret = num(note.fret);
  if (internalString === null) {
    throw new TypeError(`fromAlphaTabNote: note.string is not a number (${note.string})`);
  }
  if (fret === null) {
    throw new TypeError(`fromAlphaTabNote: note.fret is not a number (${note.fret})`);
  }

  // The one inversion.
  const sourceString = (stringCount + 1) - internalString;

  const real = num(note.realValue);
  const open = num(OPEN[sourceString]);
  const midi = real !== null && real >= 0
    ? real
    : open === null ? null : open + fret;

  return { string: sourceString, fret, midi };
}

/**
 * Inverse of `fromAlphaTabNote`'s string mapping, for emitting AlphaTex from
 * internal data or for talking back to the alphaTab object model.
 *
 * The mapping is an involution: `toAlphaTabString(toAlphaTabString(n)) === n`.
 * That is convenient but also the trap — see `fromAlphaTabNote`. Call it once.
 *
 * @param {number} sourceString AlphaTex string number (1 = high e).
 * @param {number} [stringCount=STRING_COUNT]
 * @returns {number} alphaTab-internal string number (1 = low E).
 */
export function toAlphaTabString(sourceString, stringCount = STRING_COUNT) {
  const s = num(sourceString);
  if (s === null) {
    throw new TypeError(`toAlphaTabString: expected a number, got ${sourceString}`);
  }
  return (stringCount + 1) - s;
}

/**
 * Normalize an `opts.tuning` into an OPEN-shaped array (index 0 unused).
 * Accepts either the OPEN shape `[null, 64, …]` or a bare high-to-low array
 * `[64, 59, 55, 50, 45, 40]`.
 */
function normalizeTuning(tuning) {
  if (!tuning) return OPEN;
  if (!Array.isArray(tuning)) {
    throw new TypeError('positionsFor: opts.tuning must be an array');
  }
  // OPEN shape: leading slot is a placeholder.
  if (tuning[0] === null || tuning[0] === undefined) return tuning;
  // Bare shape: shift so that index 1 is the highest string.
  return [null, ...tuning];
}

/**
 * All fretboard positions that produce `midi`, sorted by string ascending
 * (high e first), i.e. lowest string number first.
 *
 * IMPORTANT: returns `[]` for pitches the instrument cannot produce — below
 * the lowest open string, or above `maxFret` on string 1. Callers MUST handle
 * the empty array explicitly (report an out-of-range warning, octave-fold, or
 * substitute). Do NOT assume `positionsFor(m)[0]` exists; that is the single
 * most likely crash site in any consumer of this module.
 *
 * @param {number} midi
 * @param {{ maxFret?: number, tuning?: number[] }} [opts]
 *        `tuning` accepts either the OPEN shape (`[null, 64, …]`) or a bare
 *        high-to-low array (`[64, 59, …]`).
 * @returns {Array<{ string: number, fret: number, midi: number }>}
 */
export function positionsFor(midi, opts = {}) {
  const m = num(midi);
  if (m === null) return [];
  const maxFret = num(opts.maxFret) ?? MAX_FRET;
  const tuning = normalizeTuning(opts.tuning);

  const out = [];
  for (let s = 1; s < tuning.length; s++) {
    const open = num(tuning[s]);
    if (open === null) continue;
    const fret = m - open;
    if (fret >= 0 && fret <= maxFret) out.push({ string: s, fret, midi: m });
  }
  out.sort((a, b) => a.string - b.string);
  return out;
}

/**
 * Fret span of a voicing.
 *
 * Open strings (fret 0) are EXEMPT from the span: the fretting hand does not
 * reach for them, so `[{6,0},{4,7},{3,9}]` has span 2 (frets 7..9), not 9.
 * An all-open voicing therefore has span 0.
 *
 * @param {Array<{ string: number, fret: number }>} positions
 * @returns {{ span: number, minFret: number, maxFret: number,
 *             frettedCount: number, openCount: number }}
 *          All-open or empty ⇒ `{ span: 0, minFret: 0, maxFret: 0,
 *          frettedCount: 0, openCount: n }`.
 */
export function spanOf(positions) {
  const list = Array.isArray(positions) ? positions : [];
  let minFret = Infinity;
  let maxFret = -Infinity;
  let frettedCount = 0;
  let openCount = 0;

  for (const p of list) {
    const fret = num(p?.fret);
    if (fret === null) continue;
    if (fret === 0) {
      openCount++;
      continue;
    }
    frettedCount++;
    if (fret < minFret) minFret = fret;
    if (fret > maxFret) maxFret = fret;
  }

  if (frettedCount === 0) {
    return { span: 0, minFret: 0, maxFret: 0, frettedCount: 0, openCount };
  }
  return { span: maxFret - minFret, minFret, maxFret, frettedCount, openCount };
}

/**
 * Hard playability gate for a SIMULTANEOUS voicing (one chord / one beat).
 *
 * Violation rules:
 *   "duplicate-string" — two notes assigned to the same string. Physically
 *                        impossible; usually a voicing-assignment bug.
 *   "span"             — fretted span exceeds `maxSpan`.
 *   "fret-range"       — fret outside 0..MAX_FRET, or string outside
 *                        1..STRING_COUNT, or a non-finite value.
 *   "unreachable"      — needs more than four distinct fretted frets (four
 *                        fingers, each able to barre at most one fret), or
 *                        more notes than the instrument has strings.
 *
 * Default `maxSpan` is 5 when `minFret >= 7` (frets are narrower up the neck)
 * and 4 otherwise — matching the playability thresholds in §4.
 *
 * @param {Array<{ string: number, fret: number }>} positions
 * @param {{ maxSpan?: number }} [opts]
 * @returns {{ ok: boolean, span: number,
 *             violations: Array<{ rule: string, message: string }> }}
 */
export function isPlayableVoicing(positions, opts = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const violations = [];
  const { span, minFret, maxFret, frettedCount } = spanOf(list);

  // fret-range / malformed positions
  for (const p of list) {
    const s = num(p?.string);
    const f = num(p?.fret);
    if (s === null || !Number.isInteger(s) || s < 1 || s > STRING_COUNT) {
      violations.push({
        rule: 'fret-range',
        message: `String ${p?.string} is outside 1..${STRING_COUNT}`,
      });
    }
    if (f === null || f < 0 || f > MAX_FRET) {
      violations.push({
        rule: 'fret-range',
        message: `Fret ${p?.fret} is outside 0..${MAX_FRET}`,
      });
    }
  }

  // duplicate-string
  const seen = new Map();
  for (const p of list) {
    const s = num(p?.string);
    if (s === null) continue;
    if (seen.has(s)) {
      violations.push({
        rule: 'duplicate-string',
        message: `String ${s} used twice (frets ${seen.get(s)} and ${p.fret})`,
      });
    } else {
      seen.set(s, p.fret);
    }
  }

  // span
  const maxSpan = num(opts.maxSpan) ?? (minFret >= 7 ? 5 : 4);
  if (frettedCount > 0 && span > maxSpan) {
    violations.push({
      rule: 'span',
      message: `Span ${span} frets (${minFret}-${maxFret}), max ${maxSpan}`,
    });
  }

  // unreachable
  if (list.length > STRING_COUNT) {
    violations.push({
      rule: 'unreachable',
      message: `${list.length} notes on a ${STRING_COUNT}-string instrument`,
    });
  }
  const distinctFrettedFrets = new Set(
    list.map((p) => num(p?.fret)).filter((f) => f !== null && f > 0)
  );
  if (distinctFrettedFrets.size > 4) {
    violations.push({
      rule: 'unreachable',
      message: `Needs ${distinctFrettedFrets.size} distinct fretted frets ` +
        `(${[...distinctFrettedFrets].sort((a, b) => a - b).join(', ')}); only 4 fingers`,
    });
  }

  return { ok: violations.length === 0, span, violations };
}

/**
 * Interval analysis of a pitch set — the only pitch-set math the JS side
 * needs (there is deliberately no `harmony.mjs`; see §3).
 *
 * `sorted` is ascending and NOT deduplicated (a doubled pitch is a real fact
 * about a voicing and shows up as an adjacent gap of 0). `pitchClasses` IS
 * deduplicated.
 *
 * `minGap` and `widest` are the min/max of `semitones` — i.e. of the ADJACENT
 * gaps, not the total range. For fewer than two pitches there are no gaps and
 * both are 0.
 *
 * @param {number[]} midis
 * @returns {{ sorted: number[], semitones: number[], pitchClasses: number[],
 *             hasSemitoneClash: boolean, minGap: number, widest: number }}
 */
export function intervalsOf(midis) {
  const list = (Array.isArray(midis) ? midis : [])
    .map(num)
    .filter((n) => n !== null);

  const sorted = [...list].sort((a, b) => a - b);

  const semitones = [];
  for (let i = 1; i < sorted.length; i++) semitones.push(sorted[i] - sorted[i - 1]);

  const pitchClasses = [...new Set(sorted.map((m) => ((m % 12) + 12) % 12))]
    .sort((a, b) => a - b);

  const hasSemitoneClash = semitones.some((g) => g === 1);
  const minGap = semitones.length ? Math.min(...semitones) : 0;
  const widest = semitones.length ? Math.max(...semitones) : 0;

  return { sorted, semitones, pitchClasses, hasSemitoneClash, minGap, widest };
}

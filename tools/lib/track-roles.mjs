// tools/lib/track-roles.mjs — who is playing the melody, and who is under it?
// PTG-native (Wave 5). Contract C9 in docs/specs/upgrade-contracts.md and §A5 of
// docs/specs/wave3-6-addendum.md own this surface; this file implements them and
// may not redefine them.
//
// WHY ROLES EXIST AT ALL
// ----------------------
// Every fidelity check in this repo asks a question about ONE musical function:
// "is the melody there?" reads the top line, "are the roots there?" reads the
// bottom. With one guitar those two questions can both be asked of the whole
// score, because the whole score IS the one guitar. Add a second guitar and the
// aggregate stops answering either question honestly: a rhythm voicing whose top
// note happens to sit above the lead becomes "the melody", and the real melody
// passes or fails on an accident of voicing.
//
// So a role is not a label for humans. It is the SELECTOR that decides which
// notes a given question is allowed to look at.
//
// THE COMPATIBILITY OBLIGATION (C9, §A5)
// --------------------------------------
// `solo` is the default and its behaviour is bit-for-bit what shipped before
// Wave 5. That is achieved structurally rather than by care: in solo mode every
// view resolves to EVERY track, so a role-filtered read is the same read the
// pre-Wave-5 aggregate did. There is no second code path to keep in sync, and
// `views.lead === views.harmony === views.all` is asserted by a test.
//
// ROLES ARE NEVER INFERRED (C15). If a score has two tracks and no configuration
// says which is which, this module does not guess — solo mode simply keeps
// aggregating, exactly as it always has. Guessing would silently change a
// verdict on an existing project.
//
// Pure ESM, node builtins only. No filesystem access: configuration arrives
// already resolved from lib/project-config.mjs.

/** The two arrangement modes (C9). Mirrors project-config's own list. */
export const ARRANGEMENT_MODES = Object.freeze(['solo', 'dual-guitar']);

const isIndexList = (v) => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0);

/** Sorted, de-duplicated ascending. §A5: a repeated index states no
 *  contradiction, so it is NORMALIZED rather than refused. An index in BOTH
 *  lists is a contradiction, and that one is refused — see `validateTrackRoles`. */
const normalize = (list) => [...new Set(list)].sort((a, b) => a - b);

/**
 * Fail-closed-validate a role assignment against a score.
 *
 * @param {object} score alphaTab Score (only `tracks.length` is read).
 * @param {{arrangementMode:string, lead:number[], rhythm:number[]}} roles
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTrackRoles(score, roles) {
  const errors = [];
  const trackCount = Array.isArray(score?.tracks) ? score.tracks.length : 0;
  const { arrangementMode, lead, rhythm } = roles ?? {};

  if (!ARRANGEMENT_MODES.includes(arrangementMode)) {
    errors.push(`arrangementMode must be one of ${ARRANGEMENT_MODES.join('|')}, `
      + `got ${JSON.stringify(arrangementMode)}`);
    return { ok: false, errors };
  }
  if (!isIndexList(lead)) {
    errors.push(`tracks.lead must be an array of non-negative track INDICES, got ${JSON.stringify(lead)}`);
  }
  if (!isIndexList(rhythm)) {
    errors.push(`tracks.rhythm must be an array of non-negative track INDICES, got ${JSON.stringify(rhythm)}`);
  }
  if (errors.length) return { ok: false, errors };

  // Existence is checked in BOTH modes. A solo project that names track 3 of a
  // one-track score has a configuration bug whether or not anything reads it.
  for (const [label, list] of [['lead', lead], ['rhythm', rhythm]]) {
    for (const i of list) {
      if (i >= trackCount) {
        errors.push(`tracks.${label} names track ${i}, but the score has `
          + `${trackCount} track(s) (indices 0..${Math.max(trackCount - 1, 0)})`);
      }
    }
  }

  // Disjointness is a contradiction in any mode: one track cannot be both the
  // melody and the accompaniment for the same passage.
  const overlap = normalize(lead.filter((i) => rhythm.includes(i)));
  if (overlap.length) {
    errors.push(`track(s) ${overlap.join(', ')} are declared BOTH lead and rhythm; `
      + 'the two roles must be disjoint');
  }

  if (arrangementMode === 'dual-guitar') {
    if (!lead.length) {
      errors.push('dual-guitar requires at least one lead track (tracks.lead is empty)');
    }
    if (!rhythm.length) {
      errors.push('dual-guitar requires at least one rhythm track (tracks.rhythm is empty)');
    }
  } else if (rhythm.length) {
    // Refused rather than ignored: a config that names a rhythm track in solo
    // mode believes something about this run that is not true, and silently
    // dropping it is how a "dual arrangement" gets graded as a solo one.
    errors.push('solo mode has no rhythm track; set arrangementMode to "dual-guitar" '
      + `or remove tracks.rhythm (got [${rhythm.join(', ')}])`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Resolve normalized roles and the VIEWS every consumer reads.
 *
 * @param {object} score alphaTab Score.
 * @param {object} config A resolved config (contract C5) — `arrangementMode` and
 *        `tracks.{lead,rhythm}`.
 * @returns {{ ok: boolean, errors: string[], roles: object|null }}
 *
 * `roles.views` is the whole point:
 *
 *   solo         lead = harmony = all = EVERY track  (the pre-Wave-5 aggregate)
 *   dual-guitar  lead    = declared lead track(s)     — melody, contour, ordering
 *                harmony = union(lead, rhythm)        — roots, pitch-class colour
 *                all     = every track                — mechanical checks
 *
 * The harmony view is the union, not the rhythm track, because harmonic support
 * is a property of what SOUNDS, and the lead guitar is sounding too. C9 says so
 * directly. The lead view is the lead alone, because that is the whole reason
 * roles exist.
 */
export function resolveTrackRoles(score, config = {}) {
  const trackCount = Array.isArray(score?.tracks) ? score.tracks.length : 0;
  const arrangementMode = config.arrangementMode ?? 'solo';
  const lead = normalize(config.tracks?.lead ?? [0]);
  const rhythm = normalize(config.tracks?.rhythm ?? []);

  const validation = validateTrackRoles(score, { arrangementMode, lead, rhythm });
  if (!validation.ok) return { ok: false, errors: validation.errors, roles: null };

  const allGuitar = Array.from({ length: trackCount }, (_, i) => i);

  // In solo mode every view is the whole score. Not "lead = [0]" — that would
  // silently narrow an existing multi-track project's melody check to track 0
  // and change verdicts nobody asked to change. C9's "solo behaviour is
  // bit-for-bit what ships today" is a promise about the VIEWS, not the labels.
  const views = arrangementMode === 'dual-guitar'
    ? { lead: [...lead], harmony: normalize([...lead, ...rhythm]), all: allGuitar }
    : { lead: allGuitar, harmony: allGuitar, all: allGuitar };

  return {
    ok: true,
    errors: [],
    roles: {
      arrangementMode,
      lead,
      rhythm,
      allGuitar,
      views,
      // A label per track, for diagnostics only. Never read by a gate.
      labels: allGuitar.map((i) => (
        arrangementMode !== 'dual-guitar' ? 'guitar'
          : lead.includes(i) ? 'lead'
            : rhythm.includes(i) ? 'rhythm'
              : 'unassigned')),
    },
  };
}

/**
 * A predicate for "does this track belong to the view?".
 *
 * Returns a function rather than a Set so a caller can pass it straight into a
 * traversal without deciding how membership is represented.
 */
export function trackFilter(view) {
  const set = new Set(view ?? []);
  return (trackIndex) => set.has(trackIndex);
}

/** Do two views select exactly the same tracks? Used to prove that solo mode
 *  needs only ONE collection pass — and therefore that a role-filtered read and
 *  the pre-Wave-5 aggregate read cannot diverge. */
export function sameView(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

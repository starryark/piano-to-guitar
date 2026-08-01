// tools/lib/style-profile.mjs — the fail-closed loader for style profiles.
// PTG-native (Wave 3). Contract C6 in docs/specs/upgrade-contracts.md and §A2 of
// docs/specs/wave3-6-addendum.md own this surface; this file implements it and
// may not redefine it.
//
// WHAT A STYLE PROFILE IS — AND IS NOT
// ------------------------------------
// A profile is SOFT MUSICAL POLICY: how demanding this genre is about guitar
// idiom, how much sustained root-fifth writing it tolerates, how long a picking
// burst it considers normal, how much added material is unremarkable. It cannot
// touch a single physical law. C6 lists them and they are all enforced elsewhere
// by construction: one fretted note per string, fret-range legality, bar fill,
// melodic-skeleton and harmonic-root fidelity, pick reachability, tie integrity.
// Nothing in this module is read by any of those code paths, which is the real
// guarantee — not a promise in a comment, an absence of wiring.
//
// WHY IT FAILS CLOSED ON EVERY UNKNOWN KEY
// ----------------------------------------
// The same reason project-config.mjs does, one degree worse. A config typo
// silently keeps a default; a PROFILE typo silently keeps a default *while the
// run reports the style name you asked for*. `"warnbelow": 6` (lower-case b) in
// jazz.json would leave the jazz run grading against hard-rock's 4.5 and print
// "style jazz" over the top of it. So: unknown key at any level -> error; missing
// key -> error; wrong type -> error; out-of-range number -> error.
//
// Requiring every key (rather than merging over defaults) is deliberate. A
// profile is short, hand-written, and read by a human deciding whether to trust
// a warning. "What does blues.json actually say about pick demand?" must be
// answerable by reading blues.json, not by reading it and then mentally applying
// an inheritance chain from a module.
//
// Pure ESM, node builtins only, no top-level side effects beyond locating
// reference/styles/ from this file's own path.

import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STYLE_SCHEMA_VERSION = 1;

/** The built-in profiles. A name outside this set is an operational error — the
 *  toolchain does not silently invent a genre it has no calibration for. */
export const KNOWN_STYLES = Object.freeze(['hard-rock', 'metal', 'blues', 'jazz']);

/** The ONLY directory built-in profiles resolve from (§A2). */
export const STYLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'reference', 'styles');

/** The closed set of idiom weight names (§A3). Adding a feature means adding it
 *  here AND to every shipped profile — which is the point: a new feature that
 *  silently scores 0 in three genres is a calibration bug nobody sees. */
export const IDIOM_WEIGHTS = Object.freeze([
  'powerChord',
  'octave',
  'pedalTone',
  'palmMutedRepetition',
  'leadArticulation',
  'riffCell',
  'syncopation',
  'blockChord',
  'fragmentation',
  'shellVoicing',
]);

/** Tier-2 features (§A3): extracted and reported, but not yet trusted with a
 *  nonzero weight anywhere. `style-profile.test.mjs` pins that. */
export const TIER2_WEIGHTS = Object.freeze(['shellVoicing']);

const GAINS = ['high', 'crunch', 'clean'];
const PICK_LEVELS = ['hard', 'expert', 'avoid'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Report every unknown AND every missing key of a closed object, once. */
function checkKeys(obj, known, label, errors) {
  for (const k of Object.keys(obj)) {
    if (!known.includes(k)) {
      errors.push(`unknown key "${label}${k}" (known: ${known.join(', ')})`);
    }
  }
  for (const k of known) {
    if (!(k in obj)) errors.push(`missing required key "${label}${k}"`);
  }
}

function checkNumber(v, label, { min, max, integer = false }, errors) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(`${label} must be a finite number, got ${JSON.stringify(v)}`);
    return;
  }
  if (integer && !Number.isInteger(v)) {
    errors.push(`${label} must be an integer, got ${JSON.stringify(v)}`);
    return;
  }
  if (v < min || v > max) {
    errors.push(`${label} must be within ${min}..${max}, got ${v}`);
  }
}

function checkEnum(v, label, allowed, errors) {
  if (!allowed.includes(v)) {
    errors.push(`${label} must be one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
  }
}

const TOP_KEYS = ['schemaVersion', 'name', 'defaultGain', 'idiom', 'harmonicColor',
  'pickDemand', 'techniqueBias', 'freeSpanWarnShare'];
const IDIOM_KEYS = ['warnBelow', 'minAttacks', 'weights'];
const HARMONIC_KEYS = ['enabled', 'consecutiveSlicesBeforeWarn'];
const PICK_KEYS = ['warnAtLevel', 'maxBurstBeats'];

/**
 * Fail-closed-validate one parsed profile object.
 *
 * Collects EVERY problem rather than stopping at the first: a profile is
 * hand-edited, and reporting one typo per run turns a two-minute fix into four.
 *
 * @param {unknown} raw
 * @param {{ where?: string, expectName?: string }} [options]
 * @returns {{ ok: boolean, profile: object|null, errors: string[] }}
 *          `profile` is a normalized, DEEP-FROZEN clone; null when invalid.
 */
export function validateStyleProfile(raw, options = {}) {
  const { where = 'style profile', expectName = null } = options;
  const errors = [];
  const tag = (msg) => `${where}: ${msg}`;

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      profile: null,
      errors: [tag(`must be a JSON object, got ${Array.isArray(raw) ? 'an array' : typeof raw}`)],
    };
  }

  checkKeys(raw, TOP_KEYS, '', errors);

  if (raw.schemaVersion !== STYLE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${STYLE_SCHEMA_VERSION}, got ${JSON.stringify(raw.schemaVersion)}`);
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    errors.push(`name must be a non-empty string, got ${JSON.stringify(raw.name)}`);
  } else if (expectName !== null && raw.name !== expectName) {
    // A file whose declared name disagrees with its filename is the kind of
    // mismatch that makes a bug report unreproducible.
    errors.push(`name "${raw.name}" does not match the profile file name "${expectName}"`);
  }
  checkEnum(raw.defaultGain, 'defaultGain', GAINS, errors);
  checkNumber(raw.freeSpanWarnShare, 'freeSpanWarnShare', { min: 0, max: 1 }, errors);

  // -- idiom -----------------------------------------------------------------
  let weights = null;
  if (!isPlainObject(raw.idiom)) {
    errors.push(`idiom must be an object, got ${JSON.stringify(raw.idiom)}`);
  } else {
    checkKeys(raw.idiom, IDIOM_KEYS, 'idiom.', errors);
    checkNumber(raw.idiom.warnBelow, 'idiom.warnBelow', { min: 0, max: 10 }, errors);
    checkNumber(raw.idiom.minAttacks, 'idiom.minAttacks', { min: 0, max: 10000, integer: true }, errors);
    if (!isPlainObject(raw.idiom.weights)) {
      errors.push(`idiom.weights must be an object, got ${JSON.stringify(raw.idiom.weights)}`);
    } else {
      checkKeys(raw.idiom.weights, IDIOM_WEIGHTS, 'idiom.weights.', errors);
      weights = {};
      for (const k of IDIOM_WEIGHTS) {
        if (!(k in raw.idiom.weights)) continue;   // already reported as missing
        checkNumber(raw.idiom.weights[k], `idiom.weights.${k}`, { min: -10, max: 10 }, errors);
        weights[k] = raw.idiom.weights[k];
      }
    }
  }

  // -- harmonicColor ---------------------------------------------------------
  if (!isPlainObject(raw.harmonicColor)) {
    errors.push(`harmonicColor must be an object, got ${JSON.stringify(raw.harmonicColor)}`);
  } else {
    checkKeys(raw.harmonicColor, HARMONIC_KEYS, 'harmonicColor.', errors);
    if (typeof raw.harmonicColor.enabled !== 'boolean') {
      errors.push(`harmonicColor.enabled must be a boolean, got ${JSON.stringify(raw.harmonicColor.enabled)}`);
    }
    checkNumber(raw.harmonicColor.consecutiveSlicesBeforeWarn,
      'harmonicColor.consecutiveSlicesBeforeWarn', { min: 1, max: 64, integer: true }, errors);
  }

  // -- pickDemand ------------------------------------------------------------
  if (!isPlainObject(raw.pickDemand)) {
    errors.push(`pickDemand must be an object, got ${JSON.stringify(raw.pickDemand)}`);
  } else {
    checkKeys(raw.pickDemand, PICK_KEYS, 'pickDemand.', errors);
    checkEnum(raw.pickDemand.warnAtLevel, 'pickDemand.warnAtLevel', PICK_LEVELS, errors);
    checkNumber(raw.pickDemand.maxBurstBeats, 'pickDemand.maxBurstBeats', { min: 0, max: 32 }, errors);
  }

  // -- techniqueBias: RESERVED ----------------------------------------------
  // §A2: present, an object, and EMPTY. Wave 3 §7.4 forbids inventing
  // style-specific fingering-weight semantics without a frozen subshape, and
  // none is frozen. An object that accepts arbitrary keys acquires semantics by
  // accident — someone writes `{"bendBonus": 2}`, nothing reads it, and a later
  // reader assumes it works.
  if (!isPlainObject(raw.techniqueBias)) {
    errors.push(`techniqueBias must be an object, got ${JSON.stringify(raw.techniqueBias)}`);
  } else if (Object.keys(raw.techniqueBias).length > 0) {
    errors.push('techniqueBias is RESERVED and must be empty {} until a contract addendum '
      + `defines its subshape (got keys: ${Object.keys(raw.techniqueBias).join(', ')})`);
  }

  if (errors.length) return { ok: false, profile: null, errors: errors.map(tag) };

  // Normalized clone. Key order is fixed here, not inherited from the file, so
  // two profiles serialize comparably and a --json diff stays readable.
  const profile = deepFreeze({
    schemaVersion: raw.schemaVersion,
    name: raw.name,
    defaultGain: raw.defaultGain,
    idiom: {
      warnBelow: raw.idiom.warnBelow,
      minAttacks: raw.idiom.minAttacks,
      weights: Object.fromEntries(IDIOM_WEIGHTS.map((k) => [k, weights[k]])),
    },
    harmonicColor: {
      enabled: raw.harmonicColor.enabled,
      consecutiveSlicesBeforeWarn: raw.harmonicColor.consecutiveSlicesBeforeWarn,
    },
    pickDemand: {
      warnAtLevel: raw.pickDemand.warnAtLevel,
      maxBurstBeats: raw.pickDemand.maxBurstBeats,
    },
    techniqueBias: {},
    freeSpanWarnShare: raw.freeSpanWarnShare,
  });

  return { ok: true, profile, errors: [] };
}

/** Freeze an object graph. A consumer that mutates a shared profile would
 *  poison every later analyzer in the same process; freezing makes that a
 *  TypeError at the write instead of a wrong number three stages later. */
function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(obj);
}

/** Structured-clone a frozen profile back into a mutable plain object, so
 *  `mergeStyleProfile` can build on it without touching the frozen original. */
function thaw(v) {
  if (Array.isArray(v)) return v.map(thaw);
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, thaw(x)]));
  return v;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Deep-merge `overrides` onto `base` and re-validate the result.
 *
 * Objects merge key-by-key; every other value REPLACES. Arrays are refused
 * outright rather than merged: the schema contains none, and "merge arrays by
 * index" is the single most surprising rule a config merger can have.
 *
 * @param {object} base A validated profile (frozen is fine).
 * @param {object} overrides Partial profile.
 * @returns {{ ok: boolean, profile: object|null, errors: string[] }}
 */
export function mergeStyleProfile(base, overrides) {
  if (!isPlainObject(base)) {
    return { ok: false, profile: null, errors: ['mergeStyleProfile: base must be an object'] };
  }
  if (overrides === undefined || overrides === null) {
    return validateStyleProfile(thaw(base), { where: `style profile "${base.name}"` });
  }
  if (!isPlainObject(overrides)) {
    return {
      ok: false,
      profile: null,
      errors: [`mergeStyleProfile: overrides must be an object, got `
        + `${Array.isArray(overrides) ? 'an array' : typeof overrides}`],
    };
  }

  const arrayErrors = [];
  const merge = (a, b, trail) => {
    const out = thaw(a);
    for (const [k, v] of Object.entries(b)) {
      const at = `${trail}${k}`;
      if (Array.isArray(v)) {
        arrayErrors.push(`override "${at}" is an array; the style schema has no array fields `
          + 'and arrays are never merged');
        continue;
      }
      out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v, `${at}.`) : thaw(v);
    }
    return out;
  };

  const merged = merge(base, overrides, '');
  if (arrayErrors.length) return { ok: false, profile: null, errors: arrayErrors };
  // Re-validated in full: an override is untrusted input like any other, and the
  // merge is exactly where an unknown key would otherwise slip past the loader.
  return validateStyleProfile(merged, { where: `style profile "${base.name}" (with overrides)` });
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/** A profile NAME, not a path. The shape check happens before any filesystem
 *  contact so `../../../etc/passwd` is refused as a name, with a message that
 *  says so, rather than as a missing file. */
const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Load a built-in style profile by name.
 *
 *   loadStyleProfile('metal')                       -> { ok, profile, errors }
 *   loadStyleProfile('jazz', { overrides: {...} })  -> merged + re-validated
 *
 * Every failure is an OPERATIONAL error (the caller exits 2): an unknown style,
 * a malformed file, a wrong schema version, an unknown key. None of them is a
 * musical verdict, and none may degrade into "use hard-rock instead" — a run
 * that grades against a different genre than the one requested is worse than a
 * run that refuses.
 *
 * @param {string} name
 * @param {{ overrides?: object, dir?: string }} [options] `dir` exists for tests
 *        that need a scratch profile directory; production always uses STYLES_DIR.
 * @returns {{ ok: boolean, profile: object|null, errors: string[] }}
 */
export function loadStyleProfile(name, options = {}) {
  const { overrides, dir = STYLES_DIR } = options;

  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, profile: null, errors: [`style name must be a non-empty string, got ${JSON.stringify(name)}`] };
  }
  const clean = name.trim();
  if (!NAME_RE.test(clean)) {
    return {
      ok: false,
      profile: null,
      errors: [`style name "${clean}" is not a valid profile name (expected ${NAME_RE.source}); `
        + 'a style is selected by NAME, never by path'],
    };
  }
  if (!KNOWN_STYLES.includes(clean)) {
    return {
      ok: false,
      profile: null,
      errors: [`unknown style "${clean}" (known: ${KNOWN_STYLES.join(', ')})`],
    };
  }

  const file = path.join(dir, `${clean}.json`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, profile: null, errors: [`cannot read style profile "${file}": ${e.message}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, profile: null, errors: [`style profile "${file}" is not valid JSON: ${e.message}`] };
  }

  const validated = validateStyleProfile(parsed, { where: `style profile "${file}"`, expectName: clean });
  if (!validated.ok || overrides === undefined) return validated;
  return mergeStyleProfile(validated.profile, overrides);
}

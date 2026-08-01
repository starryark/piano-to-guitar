// tools/lib/project-config.mjs — the ONE place project configuration is found,
// validated and merged with CLI arguments.
// PTG-native (Wave 1). Contract C5 in docs/specs/upgrade-contracts.md owns this
// surface; this file implements it and may not redefine it.
//
// WHY THIS EXISTS
// ---------------
// Before Wave 1 the toolchain had exactly one instrument assumption — a 22-fret,
// 6-string guitar — burned in as a module constant in `fretboard.mjs`, and one
// ad-hoc per-project override channel (`--policy guitar-policy.json`, whose
// `maxFret` is a PROJECT TEXTURE constraint, not an instrument fact). A player
// on a 24-fret guitar had no way to say so, and every new configurable thing was
// going to grow its own flag, its own file and its own precedence order.
//
// This module fixes the precedence ONCE, for everything:
//
//     CLI argument > projects/<slug>/config.json > style-profile default > built-in
//
// and returns a single normalized object plus a `sources` provenance map, so a
// `--json` diagnostic can always answer "why is maxFret 24 on this run?" without
// anyone re-deriving the merge.
//
// WHAT DOES NOT BELONG HERE
// -------------------------
// No musical analysis. This module reads the filesystem (that is its whole job)
// precisely so that `fretboard.mjs` never has to: config resolution happens ONCE
// at a CLI boundary and the resolved limits travel downward as plain `opts`.
// C5 states that rule; this file is the half that makes it possible.
//
// FAIL CLOSED. An unknown key, a mistyped value, a `schemaVersion` from the
// future — all are errors, never a shrug-and-continue. The failure mode a
// silent config would produce is the worst kind: `"maxfret": 24` (lower-case f)
// silently leaving the gate at 22, or `"maxFret": "24"` silently comparing a
// number against a string. Both would look like the tool working. Exactly the
// same doctrine as `loadPolicy()` in playability.mjs, which is an exit-2
// condition at the CLI boundary.
//
// Pure ESM, node builtins only, NO top-level side effects beyond computing
// REPO_ROOT from this file's own location (check.mjs imports this module).

import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_FILENAME = 'config.json';

/** Repo root, derived from this file's location (tools/lib/ -> ../..). The
 *  upward search for a project config stops here — see `findProjectConfig`. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Built-in defaults — the bottom of the C5 precedence ladder. A project with
 *  no config.json resolves to exactly this, which is by construction the
 *  behavior the toolchain had before Wave 1. */
export const DEFAULTS = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  style: 'hard-rock',
  instrument: Object.freeze({ maxFret: 22, stringCount: 6 }),
  arrangementMode: 'solo',
  tracks: Object.freeze({ lead: Object.freeze([0]), rhythm: Object.freeze([]) }),
  gain: 'high',
});

export const KNOWN_ARRANGEMENT_MODES = ['solo', 'dual-guitar'];   // C9
export const KNOWN_GAINS = ['high', 'crunch', 'clean'];           // playability's own set

// Sanity bounds. These are not taste — they are "is this a guitar at all"
// bounds, wide enough that no real instrument is refused and narrow enough that
// a transposed-digit typo (`maxFret: 240`) is caught rather than believed.
const MAX_FRET_LIMIT = 36;
const STRING_COUNT_LIMIT = 12;

const KNOWN_TOP_KEYS = new Set(['schemaVersion', 'style', 'instrument', 'arrangementMode', 'tracks', 'gain']);
const KNOWN_INSTRUMENT_KEYS = new Set(['maxFret', 'stringCount']);
const KNOWN_TRACKS_KEYS = new Set(['lead', 'rhythm']);

/** CLI-supplied overrides this module accepts. Deliberately a closed set: an
 *  unrecognized key here is a WIRING bug in a tool, and it must not resolve to
 *  "silently ignored". */
const KNOWN_CLI_KEYS = new Set(['style', 'maxFret', 'stringCount', 'arrangementMode', 'gain', 'lead', 'rhythm']);

// `gain` IS a config.json key, and sits in the one ladder C5 defines:
//
//     --gain  >  config.json "gain"  >  styleProfile.defaultGain  >  'high'
//
// The style profile's `defaultGain` (C6) is a genre default — what hard-rock or
// jazz USUALLY sounds like. A project's gain is a Gate A decision about THIS
// arrangement, so it has to be able to outrank the genre default without the
// arranger re-typing `--gain` on every command. Those are two different
// questions, which is why two homes is one home each and not a precedence mess.
// Per-section gain changes remain a `--gain` override, as today.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Locate the nearest `config.json` at or above `anchorPath`.
 *
 * Search order: the directory CONTAINING the tab (or `anchorPath` itself when it
 * is a directory), then each parent, ending at the repo root inclusive — so
 * `projects/<slug>/config.json` is found for `projects/<slug>/cover.alphatab`,
 * and a repo-root `config.json` acts as a machine-wide default if anyone wants
 * one. The walk is bounded twice over (repo root, then the filesystem root) so
 * an anchor OUTSIDE the repo — a temp dir in a test, a tab someone dropped on
 * the desktop — still terminates instead of spinning.
 *
 * @param {string} anchorPath File or directory to start from.
 * @returns {string|null} Absolute path to the config, or null.
 */
export function findProjectConfig(anchorPath) {
  if (typeof anchorPath !== 'string' || anchorPath.trim() === '') {
    throw new TypeError(`findProjectConfig: anchorPath must be a non-empty string (got ${JSON.stringify(anchorPath)})`);
  }
  let dir = path.resolve(anchorPath);
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch { /* missing => treat as a file path */ }
  if (!isDir) dir = path.dirname(dir);

  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* not here; keep walking */ }

    // Stop at the repo root when we are inside the repo (the documented bound).
    const rel = path.relative(REPO_ROOT, dir);
    if (rel === '') return null;

    const parent = path.dirname(dir);
    if (parent === dir) return null;   // filesystem root: the outside-the-repo bound
    dir = parent;
  }
}

/**
 * Read + fail-closed-validate one `config.json`.
 *
 * Collects EVERY problem rather than throwing on the first, because a config is
 * usually hand-edited: reporting one typo at a time turns a two-minute fix into
 * four round trips.
 *
 * @param {string} configPath
 * @returns {{ ok: boolean, config: object|null, errors: string[] }}
 *          `config` is the raw validated object (NOT merged with defaults —
 *          that is `resolveConfig`'s job), or null when unreadable.
 */
export function loadProjectConfig(configPath) {
  if (typeof configPath !== 'string' || configPath.trim() === '') {
    throw new TypeError(`loadProjectConfig: configPath must be a non-empty string (got ${JSON.stringify(configPath)})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return { ok: false, config: null, errors: [`Cannot read config "${configPath}": ${e.message}`] };
  }
  const errors = [];
  const where = `in ${configPath}`;

  if (!isPlainObject(parsed)) {
    return { ok: false, config: null, errors: [`Config ${where} must be a JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`] };
  }

  for (const k of Object.keys(parsed)) {
    if (!KNOWN_TOP_KEYS.has(k)) {
      errors.push(`Unknown config key "${k}" ${where} (known: ${[...KNOWN_TOP_KEYS].join(', ')})`);
    }
  }

  if (parsed.schemaVersion !== undefined) {
    if (parsed.schemaVersion !== CONFIG_SCHEMA_VERSION) {
      errors.push(`config schemaVersion must be ${CONFIG_SCHEMA_VERSION}, got ${JSON.stringify(parsed.schemaVersion)} ${where}`);
    }
  }

  if (parsed.style !== undefined && (typeof parsed.style !== 'string' || parsed.style.trim() === '')) {
    errors.push(`config style must be a non-empty string, got ${JSON.stringify(parsed.style)} ${where}`);
  }

  if (parsed.arrangementMode !== undefined && !KNOWN_ARRANGEMENT_MODES.includes(parsed.arrangementMode)) {
    errors.push(`config arrangementMode must be one of ${KNOWN_ARRANGEMENT_MODES.join('|')}, `
      + `got ${JSON.stringify(parsed.arrangementMode)} ${where}`);
  }

  if (parsed.gain !== undefined && !KNOWN_GAINS.includes(parsed.gain)) {
    errors.push(`config gain must be one of ${KNOWN_GAINS.join('|')}, `
      + `got ${JSON.stringify(parsed.gain)} ${where}`);
  }

  if (parsed.instrument !== undefined) {
    if (!isPlainObject(parsed.instrument)) {
      errors.push(`config instrument must be an object, got ${JSON.stringify(parsed.instrument)} ${where}`);
    } else {
      for (const k of Object.keys(parsed.instrument)) {
        if (!KNOWN_INSTRUMENT_KEYS.has(k)) {
          errors.push(`Unknown config key "instrument.${k}" ${where} (known: ${[...KNOWN_INSTRUMENT_KEYS].join(', ')})`);
        }
      }
      errors.push(...validateMaxFret(parsed.instrument.maxFret, `config instrument.maxFret`, where));
      errors.push(...validateStringCount(parsed.instrument.stringCount, `config instrument.stringCount`, where));
    }
  }

  if (parsed.tracks !== undefined) {
    if (!isPlainObject(parsed.tracks)) {
      errors.push(`config tracks must be an object, got ${JSON.stringify(parsed.tracks)} ${where}`);
    } else {
      for (const k of Object.keys(parsed.tracks)) {
        if (!KNOWN_TRACKS_KEYS.has(k)) {
          errors.push(`Unknown config key "tracks.${k}" ${where} (known: ${[...KNOWN_TRACKS_KEYS].join(', ')})`);
        }
      }
      errors.push(...validateTrackList(parsed.tracks.lead, 'config tracks.lead', where));
      errors.push(...validateTrackList(parsed.tracks.rhythm, 'config tracks.rhythm', where));
    }
  }

  return { ok: errors.length === 0, config: errors.length === 0 ? parsed : null, errors };
}

// ---- value validators (shared by the config file and the CLI) --------------
// Each returns an array so callers can spread it; `undefined` is always legal
// (every field is optional) and yields no errors.

function validateMaxFret(v, label, where = '') {
  if (v === undefined) return [];
  const tail = where ? ` ${where}` : '';
  if (!Number.isInteger(v) || v < 1 || v > MAX_FRET_LIMIT) {
    return [`${label} must be an integer 1..${MAX_FRET_LIMIT}, got ${JSON.stringify(v)}${tail}`];
  }
  return [];
}

function validateStringCount(v, label, where = '') {
  if (v === undefined) return [];
  const tail = where ? ` ${where}` : '';
  if (!Number.isInteger(v) || v < 1 || v > STRING_COUNT_LIMIT) {
    return [`${label} must be an integer 1..${STRING_COUNT_LIMIT}, got ${JSON.stringify(v)}${tail}`];
  }
  return [];
}

function validateTrackList(v, label, where = '') {
  if (v === undefined) return [];
  const tail = where ? ` ${where}` : '';
  if (!Array.isArray(v) || v.some((x) => !Number.isInteger(x) || x < 0)) {
    // C9: roles are TRACK INDICES, never names. Refusing a string here is what
    // keeps that contract from eroding into name matching one project at a time.
    return [`${label} must be an array of non-negative track INDICES, got ${JSON.stringify(v)}${tail}`];
  }
  return [];
}

/**
 * Resolve the effective configuration for one run.
 *
 * Precedence (C5, one rule everywhere):
 *   CLI argument > projects/<slug>/config.json > style-profile default > built-in
 *
 * @param {object} args
 * @param {string} [args.anchorPath] Tab (or directory) whose project config to
 *        find. Omit to skip the filesystem entirely (built-ins + CLI only).
 * @param {string} [args.configPath] Explicit config path; skips the search.
 * @param {object} [args.cli] Values that came from the command line. Keys are
 *        `style, maxFret, stringCount, arrangementMode, gain, lead, rhythm`;
 *        `undefined` means "not given on the CLI" and never overrides.
 * @param {object} [args.styleProfile] Wave-3 style profile (contract C6). Only
 *        `defaultGain` is consumed in Wave 1; the slot exists so Wave 3 adds a
 *        source, not a precedence rule.
 * @returns {{ schemaVersion: number, style: string,
 *             instrument: { maxFret: number, stringCount: number },
 *             arrangementMode: string,
 *             tracks: { lead: number[], rhythm: number[] },
 *             gain: string,
 *             sources: Record<string, 'default'|'config'|'style-profile'|'cli'>,
 *             configPath: string|null, ok: boolean, errors: string[] }}
 *          On `ok: false` the value fields still hold the safe DEFAULTS so a
 *          caller that reports and exits never has to null-check; a caller that
 *          continues would be ignoring `errors`, which is its own bug.
 */
export function resolveConfig({ anchorPath, configPath, cli, styleProfile } = {}) {
  const errors = [];

  // --- CLI overrides: validated with the SAME validators as the file, so
  // `--max-fret 0` and `"maxFret": 0` fail identically. A flag that is checked
  // more loosely than a file is how the file's guarantee gets bypassed.
  const cliIn = cli ?? {};
  if (!isPlainObject(cliIn)) {
    throw new TypeError(`resolveConfig: cli must be an object (got ${JSON.stringify(cli)})`);
  }
  for (const k of Object.keys(cliIn)) {
    if (cliIn[k] === undefined) continue;             // "not given" is not a key
    if (!KNOWN_CLI_KEYS.has(k)) {
      errors.push(`Unknown CLI override "${k}" (known: ${[...KNOWN_CLI_KEYS].join(', ')})`);
    }
  }
  errors.push(...validateMaxFret(cliIn.maxFret, '--max-fret'));
  errors.push(...validateStringCount(cliIn.stringCount, '--string-count'));
  errors.push(...validateTrackList(cliIn.lead, '--lead'));
  errors.push(...validateTrackList(cliIn.rhythm, '--rhythm'));
  if (cliIn.style !== undefined && (typeof cliIn.style !== 'string' || cliIn.style.trim() === '')) {
    errors.push(`--style must be a non-empty string, got ${JSON.stringify(cliIn.style)}`);
  }
  if (cliIn.arrangementMode !== undefined && !KNOWN_ARRANGEMENT_MODES.includes(cliIn.arrangementMode)) {
    errors.push(`--arrangement-mode must be one of ${KNOWN_ARRANGEMENT_MODES.join('|')}, got ${JSON.stringify(cliIn.arrangementMode)}`);
  }
  if (cliIn.gain !== undefined && !KNOWN_GAINS.includes(cliIn.gain)) {
    errors.push(`--gain must be one of ${KNOWN_GAINS.join('|')}, got ${JSON.stringify(cliIn.gain)}`);
  }

  // --- project config file
  const foundPath = configPath ?? (anchorPath ? findProjectConfig(anchorPath) : null);
  let fileConfig = {};
  if (foundPath) {
    const loaded = loadProjectConfig(foundPath);
    if (!loaded.ok) errors.push(...loaded.errors);
    else fileConfig = loaded.config;
  }

  const profile = styleProfile ?? null;

  // --- merge. `pick` walks the ladder ONCE per leaf and records provenance in
  // the same step, so a value and its `sources` entry can never disagree.
  const sources = {};
  const pick = (name, cliVal, fileVal, profileVal, fallback) => {
    if (cliVal !== undefined) { sources[name] = 'cli'; return cliVal; }
    if (fileVal !== undefined) { sources[name] = 'config'; return fileVal; }
    if (profileVal !== undefined && profileVal !== null) { sources[name] = 'style-profile'; return profileVal; }
    sources[name] = 'default';
    return fallback;
  };

  const style = pick('style', cliIn.style, fileConfig.style, profile?.name, DEFAULTS.style);
  const maxFret = pick('maxFret', cliIn.maxFret, fileConfig.instrument?.maxFret, undefined, DEFAULTS.instrument.maxFret);
  const stringCount = pick('stringCount', cliIn.stringCount, fileConfig.instrument?.stringCount, undefined, DEFAULTS.instrument.stringCount);
  const arrangementMode = pick('arrangementMode', cliIn.arrangementMode, fileConfig.arrangementMode, undefined, DEFAULTS.arrangementMode);
  const lead = pick('lead', cliIn.lead, fileConfig.tracks?.lead, undefined, [...DEFAULTS.tracks.lead]);
  const rhythm = pick('rhythm', cliIn.rhythm, fileConfig.tracks?.rhythm, undefined, [...DEFAULTS.tracks.rhythm]);
  // gain is the one field where the style profile is a real contributor: the
  // profile's `defaultGain` (C6) is the genre's usual voice, the config's `gain`
  // is THIS arrangement's Gate A decision, and --gain is a per-run override.
  const gain = pick('gain', cliIn.gain, fileConfig.gain, profile?.defaultGain, DEFAULTS.gain);

  const ok = errors.length === 0;
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    style: ok ? style : DEFAULTS.style,
    instrument: {
      maxFret: ok ? maxFret : DEFAULTS.instrument.maxFret,
      stringCount: ok ? stringCount : DEFAULTS.instrument.stringCount,
    },
    arrangementMode: ok ? arrangementMode : DEFAULTS.arrangementMode,
    tracks: {
      lead: ok ? [...lead] : [...DEFAULTS.tracks.lead],
      rhythm: ok ? [...rhythm] : [...DEFAULTS.tracks.rhythm],
    },
    gain: ok ? gain : DEFAULTS.gain,
    sources,
    configPath: foundPath ?? null,
    ok,
    errors,
  };
}

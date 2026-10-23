// tools/lib/source-roles.mjs — the source-roles.json contract (PTG-native).
//
// A multi-instrument score does not keep its melody in its highest voice: a
// clarinet sings the verse under a piano's right hand, a synth takes the
// interlude, an acoustic guitar the solo. The digest's register heuristic
// ("melody = highest sounding voice") then grades the cover against the wrong
// line — and the gate protects whatever melodySkeleton says. foreground.mjs
// cannot settle it either: on a real band score it marked 103 of 106 bars
// ambiguous, because every instrument is a plausible line.
//
// source-roles.json is the human-reviewed answer, written as a PROPOSAL by
// tools/score-import.mjs for scores with more than one pitched part (a solo
// piano's tune is its top voice — no file) and confirmed at Gate A:
//
//   {
//     "schemaVersion": 1,
//     "status": "proposed" | "reviewed",
//     "melody": [ { "bars": [1, 9], "tracks": [0], "note": "clarinet" }, ... ],
//     "harmony": "accompaniment" | "all",
//     "excludeTracks": [6]
//   }
//
//   melody        per source-bar span (1-based, inclusive, non-overlapping):
//                 which track(s) carry the line. The digest's melody, skeleton
//                 and contour come from the highest voice OF THOSE TRACKS.
//                 `tracks: []` = the melody rests here (accompaniment only).
//                 Bars outside every span keep the register heuristic.
//   harmony       "accompaniment" (default): chord, root and bass come from
//                 the OTHER pitched tracks of each covered bar, so a melody's
//                 long notes cannot widen the pcset the gate protects (§A.2).
//                 "all": every pitched track, as without a roles file.
//   excludeTracks tracks ignored by the analysis entirely (sound effects, a
//                 click track) — like percussion, which is always excluded.
//
// Track indices are positions in the source.alphatab the roles are applied
// to. Validation fails CLOSED (exit 2 in every CLI): an unknown key, a track
// that does not exist, overlapping or out-of-range spans are errors, never a
// silently ignored setting. Applied by tools/lib/analysis.mjs; recorded in the
// digest as `sourceRoles` plus a per-bar `melodySource` — both present ONLY
// when roles are applied, so every roles-free digest is byte-identical.

import * as fs from 'node:fs';
import * as path from 'node:path';

export const ROLES_SCHEMA_VERSION = 1;
export const ROLES_FILE_SUFFIX = '-roles.json';
const ROLE_KEYS = ['schemaVersion', 'status', 'note', 'trackNames', 'melody', 'harmony', 'excludeTracks'];
const SPAN_KEYS = ['bars', 'tracks', 'note', 'evidence'];

export class RolesError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

/**
 * Validate a roles object against the source it will be applied to and return
 * the normalized form { status, harmony, excludeTracks, melody: [{bars, tracks, note}] }.
 * Throws RolesError on any problem.
 */
export function validateRoles(roles, { trackCount, barCount }) {
  const fail = (msg) => { throw new RolesError(`source-roles: ${msg}`); };
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) fail('must be a JSON object');
  for (const k of Object.keys(roles)) if (!ROLE_KEYS.includes(k)) fail(`unknown key "${k}" (allowed: ${ROLE_KEYS.join(', ')})`);
  if (roles.schemaVersion !== ROLES_SCHEMA_VERSION) fail(`schemaVersion must be ${ROLES_SCHEMA_VERSION}`);
  if (roles.status !== undefined && !['proposed', 'reviewed'].includes(roles.status)) fail('status must be "proposed" or "reviewed"');
  const trackOk = (t) => Number.isInteger(t) && t >= 0 && t < trackCount;
  const exclude = roles.excludeTracks ?? [];
  if (!Array.isArray(exclude) || !exclude.every(trackOk)) fail(`excludeTracks must list track indices 0..${trackCount - 1}`);
  const harmony = roles.harmony ?? 'accompaniment';
  if (!['accompaniment', 'all'].includes(harmony)) fail('harmony must be "accompaniment" or "all"');
  if (!Array.isArray(roles.melody)) fail('melody must be an array of { bars: [a, b], tracks: [...] }');
  const spans = roles.melody.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) fail(`melody[${i}] must be an object`);
    for (const k of Object.keys(s)) if (!SPAN_KEYS.includes(k)) fail(`melody[${i}]: unknown key "${k}" (allowed: ${SPAN_KEYS.join(', ')})`);
    const [a, b] = Array.isArray(s.bars) && s.bars.length === 2 ? s.bars : [];
    if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= barCount)) {
      fail(`melody[${i}].bars must be [a, b] with 1 <= a <= b <= ${barCount}`);
    }
    if (!Array.isArray(s.tracks) || !s.tracks.every(trackOk) || new Set(s.tracks).size !== s.tracks.length) {
      fail(`melody[${i}].tracks must list distinct track indices 0..${trackCount - 1}`);
    }
    if (s.tracks.some((t) => exclude.includes(t))) fail(`melody[${i}] names an excluded track`);
    return { bars: [a, b], tracks: [...s.tracks], note: typeof s.note === 'string' ? s.note : null };
  });
  const sorted = [...spans].sort((x, y) => x.bars[0] - y.bars[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].bars[0] <= sorted[i - 1].bars[1]) fail(`melody spans overlap at bar ${sorted[i].bars[0]}`);
  }
  return { status: roles.status ?? 'proposed', harmony, excludeTracks: [...exclude], melody: sorted };
}

/** The roles file that sits next to a source: <dir>/<stem>-roles.json. */
export function rolesPathFor(sourceFile) {
  const stem = path.basename(sourceFile).replace(/\.[^.]+$/, '');
  return path.join(path.dirname(sourceFile), `${stem}${ROLES_FILE_SUFFIX}`);
}

/** Read + parse a roles file (validation needs the parsed score; see validateRoles). */
export function readRolesFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (e) {
    throw new RolesError(`source-roles: cannot read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new RolesError(`source-roles: ${path.basename(file)} is not valid JSON: ${e.message}`);
  }
}

/** Bar number (1-based) -> the melody span covering it, or null. */
export function spanForBar(roles, bar) {
  if (!roles) return null;
  for (const s of roles.melody) if (bar >= s.bars[0] && bar <= s.bars[1]) return s;
  return null;
}

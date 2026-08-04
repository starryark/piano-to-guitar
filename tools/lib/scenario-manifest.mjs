// tools/lib/scenario-manifest.mjs — the schema and pair invariants for the
// paired calibration corpus (tools/fixtures/scenarios/manifest.json).
// PTG-native (Wave 6).
//
// WHY THIS IS A MODULE AND NOT PART OF THE RUNNER
// -----------------------------------------------
// Validation is a pure function of the manifest; execution spawns a check.mjs
// per scenario and takes the better part of a minute. Keeping them in one file
// meant the only way to ask "does the schema reject an unknown field?" was to
// run the entire corpus — so proving the schema fails closed cost 34 full corpus
// runs, and nobody was ever going to pay that.
//
// Split out, `tools/scenario-harness.test.mjs` feeds ~30 deliberately broken
// corpora straight through these functions in milliseconds, and the runner
// imports them unchanged. Nothing about the rules moved; only where they live.
//
// Pure ESM, node builtins only, no top-level side effects.

import * as fs from 'node:fs';
import path from 'node:path';

/** Every field a scenario may carry. An unknown one is an error, not an extra. */
export const SCENARIO_KEYS = new Set([
  'id', 'pairId', 'polarity', 'variantAxis', 'intent',
  'source', 'target', 'map', 'bars', 'style', 'gain',
  'arrangementMode', 'lead', 'rhythm', 'policy', 'maxFret', 'transpose',
  'expect',
]);

/** Every field an `expect` block may carry. */
export const EXPECT_KEYS = new Set([
  'exit', 'hardPass', 'failReasons',
  'requiredAdvisoryCodes', 'forbiddenAdvisoryCodes',
  'maximumTotalAdvisories', 'maximumAdvisoryCounts',
  'requiredDataFields', 'requiredStats',
]);

/** What a pair member CLAIMS about the toolchain's behaviour. */
export const POLARITIES = new Set(['positive', 'negative', 'comparison']);

/** The comparisons a `requiredStats` rule may state. */
export const STAT_OPS = new Set(['minimum', 'maximum', 'equals', 'equalsJson']);

/**
 * Which fields a pair on each axis must SHARE, and which it must VARY.
 *
 * This table is the point of the whole schema. A pair that varies two things at
 * once cannot attribute its own result: if the positive and negative halves
 * differ in both style and target, a difference in the advice belongs to
 * whichever one you happened to believe in.
 */
export const AXES = {
  target: {
    shared: ['source', 'map', 'style', 'gain', 'arrangementMode', 'lead', 'rhythm', 'bars', 'policy'],
    varied: ['target'],
  },
  style: {
    shared: ['source', 'target', 'map', 'arrangementMode', 'lead', 'rhythm', 'bars', 'policy'],
    varied: ['style'],
  },
  map: {
    shared: ['source', 'target', 'style', 'gain', 'arrangementMode', 'lead', 'rhythm', 'bars', 'policy'],
    varied: ['map'],
  },
  roles: {
    shared: ['source', 'target', 'map', 'style', 'gain', 'arrangementMode', 'bars', 'policy'],
    varied: ['lead', 'rhythm'],
  },
  configuration: {
    shared: ['source', 'target', 'map', 'style', 'bars'],
    varied: ['gain', 'arrangementMode', 'lead', 'rhythm', 'policy', 'maxFret', 'transpose'],
  },
};

/** Thrown for every rejection, so a caller never has to guess what to catch. */
export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

const fail = (msg) => { throw new ManifestError(msg); };
const need = (cond, msg) => { if (!cond) fail(msg); };

/**
 * Validate the manifest's shape and every scenario's expectations.
 *
 * @param {object} manifest        the parsed manifest
 * @param {{fixturesDir?: string}} [opts]  when given, every named path must exist
 * @returns {object} the same manifest, for chaining
 */
export function validateManifestSchema(manifest, opts = {}) {
  const { fixturesDir } = opts;

  need(manifest && typeof manifest === 'object', 'manifest is not an object');
  need(manifest.schemaVersion === 2, `unsupported schemaVersion ${manifest.schemaVersion} (this reader is 2)`);
  need(Array.isArray(manifest.scenarios) && manifest.scenarios.length >= 8,
    'a calibration corpus of fewer than 8 scenarios is not a corpus');

  const ids = new Set();
  for (const s of manifest.scenarios) {
    const where = s?.id ?? '(scenario with no id)';

    need(s && typeof s === 'object', 'a scenario is not an object');
    for (const key of Object.keys(s)) {
      need(SCENARIO_KEYS.has(key), `${where}: unknown scenario field "${key}"`);
    }
    for (const key of ['id', 'pairId', 'polarity', 'variantAxis', 'intent', 'source', 'target', 'bars', 'style']) {
      need(typeof s[key] === 'string' && s[key].trim() !== '',
        `${where}: "${key}" must be a non-empty string`);
    }
    need(!ids.has(s.id), `duplicate scenario id: ${s.id}`);
    ids.add(s.id);

    need(POLARITIES.has(s.polarity),
      `${where}: polarity "${s.polarity}" is not one of ${[...POLARITIES].join('|')}`);
    need(Object.hasOwn(AXES, s.variantAxis),
      `${where}: variantAxis "${s.variantAxis}" is not one of ${Object.keys(AXES).join('|')}`);
    need(s.intent.length > 20, `${where}: every scenario states its musical intent`);

    // `map: null` means BAR-LOCKED and must be written. An omitted key would let
    // a forgotten map read as a deliberate one.
    need(Object.hasOwn(s, 'map'), `${where}: "map" is required — write null for bar-locked`);
    need(s.map === null || typeof s.map === 'string', `${where}: "map" must be a string or null`);

    if (fixturesDir) {
      for (const key of ['source', 'target', 'map', 'policy']) {
        if (s[key] === null || s[key] === undefined) continue;
        need(fs.existsSync(path.join(fixturesDir, s[key])), `${where}: missing ${key} "${s[key]}"`);
      }
    }
    need(/^\d+(-\d+)?$/.test(s.bars), `${where}: bad bars "${s.bars}"`);

    for (const key of ['lead', 'rhythm']) {
      if (s[key] === undefined) continue;
      need(Array.isArray(s[key]) && s[key].length > 0
        && s[key].every((i) => Number.isInteger(i) && i >= 0),
        `${where}: "${key}" must be a non-empty array of track indices`);
    }
    need((s.lead === undefined) === (s.rhythm === undefined),
      `${where}: lead and rhythm are declared together or not at all`);
    if (s.lead && s.rhythm) {
      const overlap = s.lead.filter((i) => s.rhythm.includes(i));
      need(overlap.length === 0, `${where}: track(s) ${overlap} declared both lead and rhythm`);
    }
    if (s.arrangementMode !== undefined) {
      need(['solo', 'dual-guitar'].includes(s.arrangementMode),
        `${where}: bad arrangementMode "${s.arrangementMode}"`);
    }

    validateExpectations(s, where);
  }
  return manifest;
}

/** The `expect` block: every rule that would otherwise be satisfiable by anything. */
function validateExpectations(s, where) {
  const e = s.expect;
  need(e && typeof e === 'object', `${where}: missing "expect"`);
  for (const key of Object.keys(e)) {
    need(EXPECT_KEYS.has(key), `${where}: unknown expectation field "${key}"`);
  }

  need([0, 1].includes(e.exit), `${where}: expect.exit must be 0 or 1 (2 is an operational failure)`);
  need(typeof e.hardPass === 'boolean', `${where}: expect.hardPass must be a boolean`);
  need((e.exit === 0) === e.hardPass,
    `${where}: exit ${e.exit} contradicts hardPass ${e.hardPass} — exit 0 IS the hard pass (C7)`);

  for (const key of ['requiredAdvisoryCodes', 'forbiddenAdvisoryCodes']) {
    need(Array.isArray(e[key]), `${where}: expect.${key} must be an array`);
    need(e[key].every((c) => typeof c === 'string' && c.trim() !== ''),
      `${where}: expect.${key} must contain non-empty strings`);
  }
  const overlap = e.requiredAdvisoryCodes.filter((c) => e.forbiddenAdvisoryCodes.includes(c));
  need(overlap.length === 0, `${where}: code(s) ${overlap.join(', ')} are both required and forbidden`);

  if (e.failReasons !== undefined) {
    need(Array.isArray(e.failReasons) && e.failReasons.every((r) => typeof r === 'string'),
      `${where}: expect.failReasons must be an array of strings`);
    need(e.hardPass === false || e.failReasons.length === 0,
      `${where}: a passing scenario cannot declare fail reasons`);
  }
  // Without this, ANY hard failure would satisfy a failing scenario — including
  // one caused by a defect the scenario was built to rule out.
  need(e.hardPass || (e.failReasons ?? []).length > 0,
    `${where}: a failing scenario must name the hard gate it fails, so a DIFFERENT failure cannot pass it`);

  if (e.maximumTotalAdvisories !== undefined) {
    need(Number.isInteger(e.maximumTotalAdvisories) && e.maximumTotalAdvisories >= 0,
      `${where}: expect.maximumTotalAdvisories must be a non-negative integer`);
  }
  for (const [code, n] of Object.entries(e.maximumAdvisoryCounts ?? {})) {
    need(Number.isInteger(n) && n >= 0,
      `${where}: expect.maximumAdvisoryCounts["${code}"] must be a non-negative integer`);
    need(!e.forbiddenAdvisoryCodes.includes(code),
      `${where}: "${code}" is forbidden, so a count ceiling for it says nothing`);
  }
  for (const [code, fields] of Object.entries(e.requiredDataFields ?? {})) {
    need(Array.isArray(fields) && fields.length > 0 && fields.every((f) => typeof f === 'string'),
      `${where}: expect.requiredDataFields["${code}"] must be a non-empty array of field names`);
    need(e.requiredAdvisoryCodes.includes(code),
      `${where}: data fields demanded of "${code}", which the scenario never requires — `
      + 'an advisory that does not fire would satisfy this vacuously');
  }
  for (const [dotted, rule] of Object.entries(e.requiredStats ?? {})) {
    need(rule && typeof rule === 'object' && !Array.isArray(rule) && Object.keys(rule).length > 0,
      `${where}: expect.requiredStats["${dotted}"] must state at least one comparison`);
    for (const op of Object.keys(rule)) {
      need(STAT_OPS.has(op), `${where}: expect.requiredStats["${dotted}"] has unknown comparison "${op}"`);
    }
  }
}

/**
 * Validate that every pair varies exactly the dimension it declares.
 *
 * @param {object} manifest  a manifest that has already passed the schema
 * @returns {Map<string, object[]>} pairId -> members, for a caller that wants them
 */
export function validatePairInvariants(manifest) {
  const pairs = new Map();
  for (const s of manifest.scenarios) {
    if (!pairs.has(s.pairId)) pairs.set(s.pairId, []);
    pairs.get(s.pairId).push(s);
  }

  for (const [pairId, members] of pairs) {
    need(members.length >= 2, `pair "${pairId}" has one member — nothing to compare it against`);

    const axis = members[0].variantAxis;
    for (const m of members) {
      need(m.variantAxis === axis,
        `pair "${pairId}": member ${m.id} declares axis "${m.variantAxis}", the pair is "${axis}"`);
    }

    // Every pair needs someone claiming silence and someone claiming a signal.
    need(members.some((m) => m.polarity === 'positive'),
      `pair "${pairId}": no member claims the toolchain should stay quiet`);
    need(members.some((m) => m.polarity !== 'positive'),
      `pair "${pairId}": every member is positive — nothing is being contrasted`);

    const norm = (v) => JSON.stringify(v ?? null);
    const { shared, varied } = AXES[axis];

    // A copy is not a comparison.
    const seen = new Map();
    for (const m of members) {
      const key = `${m.polarity}:${varied.map((f) => norm(m[f])).join('|')}`;
      need(!seen.has(key),
        `pair "${pairId}": ${m.id} and ${seen.get(key)} are the same polarity AND the same variant — `
        + 'one of them is a copy, not a comparison');
      seen.set(key, m.id);
    }

    for (const field of shared) {
      const values = new Set(members.map((m) => norm(m[field])));
      need(values.size === 1,
        `pair "${pairId}" varies "${axis}", so every member must share "${field}" — `
        + `found ${[...values].join(' vs ')}  [members: ${members.map((m) => m.id).join(', ')}]`);
    }
    need(varied.some((field) => new Set(members.map((m) => norm(m[field]))).size > 1),
      `pair "${pairId}" declares axis "${axis}" but no member differs in ${varied.join('/')} — `
      + 'the pair varies nothing and proves nothing');
  }

  // The corpus as a whole has to exercise more than one axis, or "pairing" has
  // quietly collapsed back into "two targets".
  const axes = new Set(manifest.scenarios.map((s) => s.variantAxis));
  need(axes.size >= 4,
    `the corpus exercises only ${[...axes].join(', ')} — style, map and role calibration need their own axes`);

  return pairs;
}

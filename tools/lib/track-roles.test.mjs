// track-roles.test.mjs — self-test for tools/lib/track-roles.mjs and the
// role-aware comparison in tools/compare.mjs (contract C9 + addendum §A5).
// Run: node tools/lib/track-roles.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// Roles change which notes a fidelity question is allowed to look at, and that
// is exactly as dangerous as it sounds. Two failures are possible and only one
// of them is loud:
//
//   LOUD — dual mode grades the wrong track. Caught by the swapped-roles test:
//   a melody that lives only in the lead must NOT satisfy the melody gate when
//   the rhythm track is declared lead instead.
//
//   SILENT — solo mode quietly narrows to track 0 and starts passing or failing
//   existing multi-track projects differently. C9 says solo behaviour is
//   bit-for-bit what shipped before Wave 5, and the suite defends that
//   STRUCTURALLY: in solo every view is the same array, so a role-filtered read
//   and the old aggregate read are the same read. If that identity ever breaks,
//   the first test here fails before any verdict changes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARRANGEMENT_MODES,
  resolveTrackRoles,
  sameView,
  trackFilter,
  validateTrackRoles,
} from './track-roles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures', 'dual');
const SCRATCH = path.join(ROOT, 'out', 'track-roles-test');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

const DIGEST = (() => {
  const out = path.join(SCRATCH, 'source.json');
  const r = node([path.join(ROOT, 'tools', 'piano-extract.mjs'),
    path.join(FIX, 'source.alphatab'), '--out', SCRATCH]);
  assert.equal(r.status, 0, `piano-extract: ${r.stderr}`);
  return out;
})();

/** A score stub — only `tracks.length` is ever read. */
const scoreWith = (n) => ({ tracks: Array.from({ length: n }, (_, i) => ({ index: i })) });

/** Run compare.mjs on the dual fixture with the given role flags. */
function compare(extra = [], { map = false } = {}) {
  const args = [path.join(ROOT, 'tools', 'compare.mjs'), path.join(FIX, 'cover.alphatab'),
    DIGEST, '--bars', '1-4', ...extra, '--json'];
  if (map) args.splice(args.length - 1, 0, '--map', path.join(FIX, 'sidecar.json'));
  const r = node(args);
  assert.notEqual(r.status, 2, `compare exited 2: ${r.stderr}`);
  return { status: r.status, json: JSON.parse(r.stdout) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Solo compatibility — the silent failure
// ---------------------------------------------------------------------------

test('solo: every view is EVERY track, not the declared lead', () => {
  // The whole compatibility guarantee. `lead: [0]` is the default configuration
  // value, but narrowing the melody check to track 0 would change verdicts on
  // existing multi-track projects that nobody asked to change.
  const { ok, roles } = resolveTrackRoles(scoreWith(3), { arrangementMode: 'solo', tracks: { lead: [0], rhythm: [] } });
  assert.equal(ok, true);
  assert.deepEqual(roles.views.lead, [0, 1, 2]);
  assert.deepEqual(roles.views.harmony, [0, 1, 2]);
  assert.deepEqual(roles.views.all, [0, 1, 2]);
  assert.equal(sameView(roles.views.lead, roles.views.harmony), true,
    'identical views are what let compare collect ONCE — no second path to drift');
});

test('solo with no configuration at all resolves the same way', () => {
  const { ok, roles } = resolveTrackRoles(scoreWith(2), {});
  assert.equal(ok, true);
  assert.equal(roles.arrangementMode, 'solo');
  assert.deepEqual(roles.lead, [0]);
  assert.deepEqual(roles.rhythm, []);
  assert.deepEqual(roles.views.lead, [0, 1]);
});

test('solo: an explicitly declared lead is recorded but does not narrow the views', () => {
  const { roles } = resolveTrackRoles(scoreWith(3), { arrangementMode: 'solo', tracks: { lead: [2], rhythm: [] } });
  assert.deepEqual(roles.lead, [2], 'the declaration is kept');
  assert.deepEqual(roles.views.lead, [0, 1, 2], 'but solo still aggregates');
});

test('solo: every track is labelled plainly "guitar" — there are no roles to show', () => {
  const { roles } = resolveTrackRoles(scoreWith(2), {});
  assert.deepEqual(roles.labels, ['guitar', 'guitar']);
});

test('compare in solo mode reports the aggregate views and passes the fixture', () => {
  const { status, json } = compare();
  assert.equal(status, 0);
  assert.equal(json.roles.arrangementMode, 'solo');
  assert.deepEqual(json.roles.views.lead, [0, 1]);
  assert.deepEqual(json.roles.views.harmony, [0, 1]);
  assert.equal(json.hardGates.melodicSkeleton.covered, 16);
  assert.equal(json.hardGates.melodicSkeleton.total, 16);
  assert.equal(json.hardGates.harmonicRoots.covered, 4);
});

// ---------------------------------------------------------------------------
// Dual mode — the loud failure
// ---------------------------------------------------------------------------

test('dual: melody in the LEAD satisfies the melody gate', () => {
  const { status, json } = compare(['--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1']);
  assert.equal(status, 0);
  assert.deepEqual(json.roles.views.lead, [0], 'melody reads the lead alone');
  assert.deepEqual(json.roles.views.harmony, [0, 1], 'roots read the union');
  assert.equal(json.hardGates.melodicSkeleton.ok, true);
  assert.equal(json.hardGates.harmonicRoots.ok, true);
});

test('dual: melody present only in the RHYTHM track does NOT satisfy the lead obligation', () => {
  // The reason roles exist. With the aggregate view this passes, because the
  // melody is somewhere in the score; with roles it must not, because it is not
  // where the arrangement says the melody is.
  const { status, json } = compare(['--arrangement-mode', 'dual-guitar', '--lead', '1', '--rhythm', '0']);
  assert.equal(status, 1);
  assert.equal(json.hardGates.melodicSkeleton.ok, false);
  assert.ok(json.hardGates.melodicSkeleton.covered < json.hardGates.melodicSkeleton.total);
  assert.ok(json.failures.some((f) => f.gate === 'melodicSkeleton'));
});

test('dual: the harmonic view is the UNION, so the rhythm track is inside it', () => {
  // C9: roots and pitch-class colour read union(lead, rhythm), never the lead
  // alone. The melody gate narrowed to one track (previous test); the harmonic
  // one must not have. `density.tabNotes` counts the notes the harmonic view
  // actually saw, so it is a direct measurement of which tracks were read: the
  // lead track contributes 16 single notes, the rhythm track 16 dyads.
  const { json } = compare(['--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1']);
  assert.deepEqual(json.roles.views.harmony, [0, 1]);
  assert.equal(json.hardGates.harmonicRoots.ok, true);
  assert.equal(json.soft.density.tabNotes, 48,
    '16 lead notes + 32 rhythm notes — the rhythm guitar is in the harmonic view');
  // Whereas the MELODY view saw only the lead track's 16 notes.
  assert.deepEqual(json.roles.views.lead, [0]);
});

test('dual: roles are labelled per track, for diagnostics only', () => {
  const { roles } = resolveTrackRoles(scoreWith(3),
    { arrangementMode: 'dual-guitar', tracks: { lead: [0], rhythm: [1] } });
  assert.deepEqual(roles.labels, ['lead', 'rhythm', 'unassigned']);
  assert.deepEqual(roles.views.all, [0, 1, 2], 'mechanical checks still see every track');
});

test('the map-mode path is role-aware too', () => {
  const good = compare(['--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1'], { map: true });
  assert.equal(good.status, 0);
  assert.ok(good.json.mapResults.every((r) => r.ok));
  const swapped = compare(['--arrangement-mode', 'dual-guitar', '--lead', '1', '--rhythm', '0'], { map: true });
  assert.equal(swapped.status, 1, 'a quote span grades its melody against the lead view');
  assert.ok(swapped.json.failures.some((f) => f.gate === 'melodicSkeleton'));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function rejects(config, needle, tracks = 2) {
  const r = resolveTrackRoles(scoreWith(tracks), config);
  assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(config)}`);
  assert.equal(r.roles, null);
  const joined = r.errors.join(' | ');
  assert.ok(joined.includes(needle), `expected an error mentioning "${needle}", got: ${joined}`);
}

test('dual-guitar requires a lead AND a rhythm', () => {
  rejects({ arrangementMode: 'dual-guitar', tracks: { lead: [], rhythm: [1] } },
    'requires at least one lead track');
  rejects({ arrangementMode: 'dual-guitar', tracks: { lead: [0], rhythm: [] } },
    'requires at least one rhythm track');
});

test('the two roles must be disjoint', () => {
  rejects({ arrangementMode: 'dual-guitar', tracks: { lead: [0, 1], rhythm: [1] } },
    'declared BOTH lead and rhythm');
});

test('an out-of-range track index is refused, in either mode', () => {
  rejects({ arrangementMode: 'dual-guitar', tracks: { lead: [0], rhythm: [5] } },
    'the score has 2 track(s)');
  rejects({ arrangementMode: 'solo', tracks: { lead: [7], rhythm: [] } },
    'the score has 2 track(s)');
});

test('a rhythm track in SOLO mode is refused, not ignored', () => {
  // Silently dropping it is how a dual arrangement gets graded as a solo one.
  rejects({ arrangementMode: 'solo', tracks: { lead: [0], rhythm: [1] } },
    'solo mode has no rhythm track');
});

test('a duplicate index inside one list is NORMALIZED, not refused', () => {
  // §A5: a repeated index states no contradiction. An index in BOTH lists does.
  const { ok, roles } = resolveTrackRoles(scoreWith(3),
    { arrangementMode: 'dual-guitar', tracks: { lead: [2, 0, 2], rhythm: [1, 1] } });
  assert.equal(ok, true);
  assert.deepEqual(roles.lead, [0, 2], 'de-duplicated AND sorted ascending');
  assert.deepEqual(roles.rhythm, [1]);
  assert.deepEqual(roles.views.harmony, [0, 1, 2], 'the union is normalized too');
});

test('a bad arrangement mode or a non-index list is refused', () => {
  rejects({ arrangementMode: 'trio', tracks: { lead: [0], rhythm: [1] } }, 'arrangementMode must be one of');
  rejects({ arrangementMode: 'dual-guitar', tracks: { lead: ['Lead'], rhythm: [1] } }, 'track INDICES');
  rejects({ arrangementMode: 'dual-guitar', tracks: { lead: [-1], rhythm: [1] } }, 'track INDICES');
});

test('C15: roles are never INFERRED — two tracks and no config stays solo', () => {
  const { roles } = resolveTrackRoles(scoreWith(2), {});
  assert.equal(roles.arrangementMode, 'solo');
  assert.deepEqual(roles.rhythm, [], 'the second track is not guessed into a rhythm role');
});

test('validateTrackRoles reports every problem at once', () => {
  const r = validateTrackRoles(scoreWith(1),
    { arrangementMode: 'dual-guitar', lead: [0, 3], rhythm: [0] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2, `expected several problems, got ${r.errors.length}`);
});

test('ARRANGEMENT_MODES is the closed set both modules agree on', () => {
  assert.deepEqual([...ARRANGEMENT_MODES], ['solo', 'dual-guitar']);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test('trackFilter selects exactly the view', () => {
  const f = trackFilter([0, 2]);
  assert.equal(f(0), true);
  assert.equal(f(1), false);
  assert.equal(f(2), true);
  assert.equal(trackFilter(undefined)(0), false, 'an absent view selects nothing');
});

test('sameView is order-sensitive equality, and identity-fast', () => {
  const a = [0, 1];
  assert.equal(sameView(a, a), true);
  assert.equal(sameView([0, 1], [0, 1]), true);
  assert.equal(sameView([0, 1], [1, 0]), false);
  assert.equal(sameView([0], [0, 1]), false);
  assert.equal(sameView(null, [0]), false);
});

// ---------------------------------------------------------------------------
// CLI precedence and determinism
// ---------------------------------------------------------------------------

test('CLI role flags override a project config', () => {
  const dir = path.join(SCRATCH, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'cover.alphatab'), path.join(dir, 'cover.alphatab'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    schemaVersion: 1, arrangementMode: 'dual-guitar', tracks: { lead: [1], rhythm: [0] },
  }, null, 2));

  const run = (extra) => {
    const r = node([path.join(ROOT, 'tools', 'compare.mjs'), path.join(dir, 'cover.alphatab'),
      DIGEST, '--bars', '1-4', ...extra, '--json']);
    return JSON.parse(r.stdout);
  };
  const fromConfig = run([]);
  assert.deepEqual(fromConfig.roles.lead, [1], 'the config chose the rhythm track as lead');
  assert.equal(fromConfig.hardGates.melodicSkeleton.ok, false);

  const fromCli = run(['--lead', '0', '--rhythm', '1']);
  assert.deepEqual(fromCli.roles.lead, [0]);
  assert.equal(fromCli.hardGates.melodicSkeleton.ok, true);
});

test('a malformed --lead is exit 2', () => {
  const r = node([path.join(ROOT, 'tools', 'compare.mjs'), path.join(FIX, 'cover.alphatab'),
    DIGEST, '--bars', '1-4', '--lead', 'Lead', '--json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /expected a comma-separated list of track indices/);
});

test('two role-aware runs are byte-identical', () => {
  const a = compare(['--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1']);
  const b = compare(['--arrangement-mode', 'dual-guitar', '--lead', '0', '--rhythm', '1']);
  assert.equal(JSON.stringify(a.json), JSON.stringify(b.json));
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${err.stack ?? err.message}\n\n`);
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

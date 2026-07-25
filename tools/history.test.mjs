// history.test.mjs — self-test for tools/history.mjs's version store.
// Run: node tools/history.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// history.mjs is a CLI with top-level side effects (parses argv, exits), so it
// is driven as a subprocess — same pattern as tools/playability.test.mjs. The
// store mechanics (snap / dedup / diff / restore / verdict / list) are tested
// here in a throwaway project dir; the `check` front-end (which wraps check.mjs
// and needs a live digest) is exercised by the end-to-end verification steps.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(TOOLS, 'history.mjs');

// Three distinct bars, so a diff targets an unambiguous bar number.
const COVER_V1 = [
  '\\title "test"',
  '.',
  '3.6.4 5.6.4 7.6.4 8.6.4 |',
  '8.6.4 7.6.4 5.6.4 3.6.4 |',
  '3.6.4 3.6.4 3.6.4 3.6.4',
  '',
].join('\n');
// v2 differs only in bar 2 (last beat 3.6.4 -> 10.6.4).
const COVER_V2 = COVER_V1.replace('8.6.4 7.6.4 5.6.4 3.6.4 |', '8.6.4 7.6.4 5.6.4 10.6.4 |');
// v3 differs only in bar 3 — a distinct, uncaptured working edit.
const COVER_V3 = COVER_V1.replace('3.6.4 3.6.4 3.6.4 3.6.4', '3.6.4 3.6.4 3.6.4 12.6.4');
const SIDECAR = JSON.stringify({ song: 'test', entries: [] }, null, 2) + '\n';

function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-test-'));
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V1);
  fs.writeFileSync(path.join(dir, 'sidecar.json'), SIDECAR);
  fs.writeFileSync(path.join(dir, 'sessions.md'), '# test — session log\n');
  return dir;
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: dir });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function entries(dir) {
  const log = path.join(dir, 'history', 'log.jsonl');
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('snap captures seq 1 with both tab and sidecar', () => {
  const dir = freshProject();
  const { code, stdout } = run(dir, ['snap', '--note', 'first']);
  assert.equal(code, 0);
  assert.match(stdout, /saved seq 1/);
  const es = entries(dir);
  assert.equal(es.length, 1);
  assert.equal(es[0].seq, 1);
  assert.equal(es[0].note, 'first');
  assert.equal(es[0].verdict, null);
  assert.ok(fs.existsSync(path.join(dir, 'history', es[0].files.cover)), 'tab snapshot written');
  assert.ok(fs.existsSync(path.join(dir, 'history', es[0].files.sidecar)), 'sidecar snapshot written');
});

test('an unchanged re-snap is a de-duped no-op', () => {
  const dir = freshProject();
  run(dir, ['snap']);
  const { stdout } = run(dir, ['snap']);
  assert.match(stdout, /unchanged since seq 1/);
  assert.equal(entries(dir).length, 1, 'no second entry for identical bytes');
});

test('an edited tab captures seq 2', () => {
  const dir = freshProject();
  run(dir, ['snap']);
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V2);
  const { stdout } = run(dir, ['snap']);
  assert.match(stdout, /saved seq 2/);
  const es = entries(dir);
  assert.equal(es.length, 2);
  assert.equal(es[1].parent, 1, 'lineage points at the previous seq');
});

test('diff 1 2 names exactly the changed bar', () => {
  const dir = freshProject();
  run(dir, ['snap']);
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V2);
  run(dir, ['snap']);
  const { stdout } = run(dir, ['diff', '1', '2']);
  assert.match(stdout, /bar 2:/, 'bar 2 reported as changed');
  assert.match(stdout, /3\.6\.4.*->.*10\.6\.4/, 'shows the old -> new tokens');
  assert.doesNotMatch(stdout, /bar 1:/, 'bar 1 (header) unchanged');
  assert.doesNotMatch(stdout, /bar 3:/, 'bar 3 unchanged');
});

test('diff against current working tab (no second operand)', () => {
  const dir = freshProject();
  run(dir, ['snap']);           // seq 1 = v1
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V2); // working tab now v2
  const { stdout } = run(dir, ['diff', '1']);
  assert.match(stdout, /-> current/);
  assert.match(stdout, /bar 2:/);
});

test('verdict annotates the latest snapshot and logs a sessions.md stub', () => {
  const dir = freshProject();
  run(dir, ['snap']);
  const { code, stdout } = run(dir, ['verdict', 'REVISE:unplayable', '--note', 'hand jump']);
  assert.equal(code, 0);
  assert.match(stdout, /verdict = REVISE:unplayable/);
  const es = entries(dir);
  assert.equal(es[0].verdict, 'REVISE:unplayable');
  assert.equal(es[0].tag, 'unplayable');
  const sessions = fs.readFileSync(path.join(dir, 'sessions.md'), 'utf8');
  assert.match(sessions, /\[history seq 1\] REVISE:unplayable/);
});

test('verdict --no-log skips the sessions.md stub', () => {
  const dir = freshProject();
  run(dir, ['snap']);
  run(dir, ['verdict', 'APPROVED', '--no-log']);
  const sessions = fs.readFileSync(path.join(dir, 'sessions.md'), 'utf8');
  assert.doesNotMatch(sessions, /history seq/);
});

test('restore is non-destructive: uncaptured current is snapshotted, then reverted', () => {
  const dir = freshProject();
  run(dir, ['snap']);            // seq 1 = v1
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V2);
  run(dir, ['snap']);            // seq 2 = v2
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V3); // uncaptured working edit
  const { code, stdout } = run(dir, ['restore', '1', '--yes']);
  assert.equal(code, 0);
  assert.match(stdout, /restored seq 1/);
  // working tab is back to v1 ...
  assert.equal(fs.readFileSync(path.join(dir, 'cover.alphatab'), 'utf8'), COVER_V1);
  // ... and the uncaptured v3 was preserved as seq 3 before the overwrite (nothing lost).
  const es = entries(dir);
  assert.equal(es.length, 3);
  assert.match(es[2].note, /auto-snapshot before restore/);
  const v3snap = fs.readFileSync(path.join(dir, 'history', es[2].files.cover), 'utf8');
  assert.equal(v3snap, COVER_V3, 'the working edit is recoverable from history');
});

test('restore without --yes is a dry run (no file change)', () => {
  const dir = freshProject();
  run(dir, ['snap']);
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V2);
  run(dir, ['snap']);
  const before = fs.readFileSync(path.join(dir, 'cover.alphatab'), 'utf8');
  const { stdout } = run(dir, ['restore', '1']);
  assert.match(stdout, /would restore seq 1/);
  assert.equal(fs.readFileSync(path.join(dir, 'cover.alphatab'), 'utf8'), before, 'dry run left the tab alone');
  assert.equal(entries(dir).length, 2, 'dry run added no snapshot');
});

test('list hides failed intermediates by default, shows them with --all', () => {
  const dir = freshProject();
  // Two hand-made captures with a failing gate + no verdict = intermediate drafts.
  run(dir, ['snap']);
  const es0 = entries(dir);
  // Simulate a gate-failed draft by rewriting the log entry (store-level).
  es0[0].gate = { ok: false, failReasons: ['playability errors'], soft: null };
  fs.writeFileSync(path.join(dir, 'history', 'log.jsonl'), JSON.stringify(es0[0]) + '\n');
  fs.writeFileSync(path.join(dir, 'cover.alphatab'), COVER_V2);
  run(dir, ['snap']);           // seq 2, latest -> always visible
  const def = run(dir, ['list']).stdout;
  assert.match(def, /hidden/, 'the failed non-latest draft is collapsed by default');
  const all = run(dir, ['list', '--all']).stdout;
  assert.doesNotMatch(all, /hidden/, '--all shows every row');
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
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

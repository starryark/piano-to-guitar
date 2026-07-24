// playability.test.mjs — self-test for tools/playability.mjs's
// `position-jump-slow` advisory (docs/specs/tooling.md §C.4).
// Run: node tools/playability.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// playability.mjs is a CLI with top-level side effects (parses argv, exits on
// import), so it CANNOT be imported — driven as a subprocess, same pattern as
// tools/smoke.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const TOOL = path.join(TOOLS, 'playability.mjs');
const FIXTURE = path.join(TOOLS, 'fixtures', 'position-jump-slow.alphatab');

function run(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: ROOT });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('fires on the jump section (bars 1-2): warning, not error', () => {
  const { json } = run([FIXTURE, '--bars', '1-2', '--json']);
  assert.ok(json, 'expected JSON output');
  assert.deepEqual(json.errors, [], 'no hard finding expected');
  assert.ok(
    json.warnings.some((w) => w.type === 'position-jump-slow'),
    'expected at least one position-jump-slow warning'
  );
  const slowWarnings = json.warnings.filter((w) => w.type === 'position-jump-slow');
  assert.ok(
    slowWarnings.some((w) => /of 10 frets/.test(w.message)),
    'expected a warning mentioning "of 10 frets"'
  );
  const allMessages = slowWarnings.map((w) => w.message).join('\n');
  assert.match(allMessages, /3 -> 13/, 'expected the 3 -> 13 direction to appear');
  assert.match(allMessages, /13 -> 3/, 'expected the 13 -> 3 direction to appear');
});

test('silent on the benign section (bar 3): no position-jump-slow warnings', () => {
  const { json } = run([FIXTURE, '--bars', '3', '--json']);
  assert.ok(json, 'expected JSON output');
  assert.ok(
    json.warnings.every((w) => w.type !== 'position-jump-slow'),
    `expected no position-jump-slow warnings, got: ${JSON.stringify(json.warnings)}`
  );
  assert.equal(json.warnings.length, 0, 'bar 3 should be entirely silent');
});

test('does not misfire as the fast position-jump check (bars 1-2 are eighths)', () => {
  const { json } = run([FIXTURE, '--bars', '1-2', '--json']);
  assert.ok(json, 'expected JSON output');
  assert.ok(
    json.errors.every((e) => e.type !== 'position-jump'),
    `expected no fast position-jump errors, got: ${JSON.stringify(json.errors)}`
  );
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

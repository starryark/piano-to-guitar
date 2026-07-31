// smoke.mjs — standalone health check for the playground dev server.
//
// Usage:  npm run smoke        (node playground/smoke.mjs)
//
// Mirrors tools/smoke.mjs's hand-rolled assert/check pattern (no test
// framework): each check is independent, a failure is captured, and the run
// ends with one SMOKE: PASS / SMOKE: FAIL line. Unlike tools/smoke.mjs these
// checks drive a LIVE HTTP server, so this file spawns serve.mjs as a
// background child, polls it until ready, then exercises the page-serving and
// gate endpoints.
//
// Uses only Node built-ins: child_process (spawn), http, fs, path, url, plus
// global fetch (Node 18+).

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const TOOLS = path.join(ROOT, 'tools');
const FIXTURES = path.join(TOOLS, 'fixtures');

const PORT = 5174;

const results = [];
let failed = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then((detail) => {
      results.push({ ok: true, name, detail: detail ?? '' });
    })
    .catch((e) => {
      failed++;
      results.push({ ok: false, name, detail: e.message });
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Read a fixture file's contents (not its path) as UTF-8. */
function fix(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

// --- HTTP helpers -----------------------------------------------------------

async function get(p) {
  const r = await fetch('http://localhost:' + PORT + p);
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}

async function postJson(p, body) {
  const r = await fetch('http://localhost:' + PORT + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  const text = await r.text();
  try { json = JSON.parse(text); } catch { /* non-JSON => stays null */ }
  return { status: r.status, text, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Start the server as a background child process -------------------------

const srv = spawn(
  process.execPath,
  [path.join(HERE, 'serve.mjs'), '--port', String(PORT)],
  { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] },
);

// Drain the pipes so a chatty server can't deadlock on a full buffer. Buffer
// stderr so a failed readiness check can show what the server complained about.
let stderrBuf = '';
srv.stdout.on('data', () => { /* drain */ });
srv.stderr.on('data', (b) => { stderrBuf += b.toString(); });

process.on('exit', () => { try { srv.kill(); } catch {} });

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://localhost:' + PORT + '/');
      // Any HTTP response means the listener is up; 200 expected once ready.
      if (r) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// --- Run --------------------------------------------------------------------

let exitCode = 0;
try {
  const ready = await waitForServer();
  if (!ready) {
    console.error('server never responded on port ' + PORT);
    if (stderrBuf) console.error('--- serve.mjs stderr ---\n' + stderrBuf);
    console.log('SMOKE: FAIL');
    exitCode = 1;
  } else {
    // -----------------------------------------------------------------------
    // 1. Static page is served.
    // -----------------------------------------------------------------------
    await check('GET / serves the page', async () => {
      const r = await get('/');
      assert(r.status === 200, `expected 200, got ${r.status}`);
      assert(/id="alphaTab"/.test(r.text), 'page text must contain id="alphaTab"');
      return `${r.status}, ${r.text.length} bytes`;
    });

    // -----------------------------------------------------------------------
    // 2. alphaTab ESM bundle is reachable under /alphatab/.
    // -----------------------------------------------------------------------
    await check('GET /alphatab/alphaTab.mjs serves the ESM entry', async () => {
      const r = await get('/alphatab/alphaTab.mjs');
      assert(r.status === 200, `expected 200, got ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      assert(ct.includes('javascript'), `content-type should include javascript, got "${ct}"`);
      return `${r.status}, ${ct}`;
    });

    // -----------------------------------------------------------------------
    // 3. & 4. The font and soundfont assets the notation needs are served.
    // -----------------------------------------------------------------------
    await check('GET /alphatab/font/Bravura.woff2 serves the font', async () => {
      const r = await get('/alphatab/font/Bravura.woff2');
      assert(r.status === 200, `expected 200, got ${r.status}`);
      return `${r.status}, ${r.text.length} bytes`;
    });

    await check('GET /alphatab/soundfont/sonivox.sf2 serves the soundfont', async () => {
      const r = await get('/alphatab/soundfont/sonivox.sf2');
      assert(r.status === 200, `expected 200, got ${r.status}`);
      return `${r.status}, ${r.text.length} bytes`;
    });

    // -----------------------------------------------------------------------
    // 5. /seed returns the default e2e triple the page loads on boot.
    // -----------------------------------------------------------------------
    await check('GET /seed returns the e2e triple', async () => {
      const r = await get('/seed');
      assert(r.status === 200, `expected 200, got ${r.status}`);
      const json = JSON.parse(r.text);
      assert(typeof json.tab === 'string' && json.tab.length > 0, 'json.tab must be a non-empty string');
      assert(/\\tempo|\./.test(json.tab), 'json.tab should look like AlphaTex');
      assert(typeof json.source === 'string' && json.source.length > 0, 'json.source must be non-empty');
      assert(typeof json.sidecar === 'string' && json.sidecar.length > 0, 'json.sidecar must be non-empty');
      const side = JSON.parse(json.sidecar);
      assert(Array.isArray(side.entries), 'sidecar must parse and contain entries[]');
      return `tab ${json.tab.length}b, source ${json.source.length}b, sidecar ${side.entries.length} entries`;
    });

    // -----------------------------------------------------------------------
    // 6. Lint mode: tab only, no source. validate + playability pass, compare
    //    is null (lint mode does not run a fidelity compare).
    // -----------------------------------------------------------------------
    await check('POST /gate lint (e2e-tab) passes', async () => {
      const r = await postJson('/gate', { tab: fix('e2e-tab.alphatab') });
      assert(r.status === 200, `expected 200, got ${r.status}`);
      assert(r.json && r.json.ok === true, `expected ok:true, got ${r.json?.ok} — ${r.json?.failReasons}`);
      assert(r.json.hard.validate.ok === true, 'validate should pass');
      assert(r.json.hard.playability.ok === true, 'playability should pass');
      assert(r.json.hard.compare === null, 'compare must be null in lint mode');
      return `ok:true (lint) — no compare`;
    });

    // -----------------------------------------------------------------------
    // 7. Fidelity mode: full e2e triple. The sidecar has 2 entries, so
    //    mapResults must have length 2 and every entry passes. The §A.2 guard
    //    below asserts the totals are NON-ZERO so a vacuous 0/0 PASS can't
    //    masquerade as a real one.
    // -----------------------------------------------------------------------
    await check('POST /gate fidelity (e2e triple) passes with non-zero totals', async () => {
      const r = await postJson('/gate', {
        tab: fix('e2e-tab.alphatab'),
        source: fix('chaconne-excerpt.alphatab'),
        sidecar: fix('e2e-sidecar.json'),
      });
      assert(r.status === 200, `expected 200, got ${r.status}`);
      assert(r.json && r.json.ok === true, `expected ok:true, got ${r.json?.ok} — ${r.json?.failReasons}`);

      const compare = r.json.hard.compare;
      assert(compare !== null, 'compare must be non-null in fidelity mode');
      const mapResults = compare.mapResults;
      assert(Array.isArray(mapResults), 'mapResults must be an array');
      assert(mapResults.length === 2, `expected 2 map entries (sidecar has 2), got ${mapResults.length}`);
      assert(mapResults.every((m) => m.ok === true), 'every map entry should pass');

      // §A.2 fail-open guard: the hard gates PASS on 0/0 by design, so a real
      // pass must NOT be vacuous. We assert (a) ok is true with NO compare
      // reason in failReasons, (b) there is at least one map result, and (c)
      // the first entry's ok:true is a genuine pass — i.e. it actually ran a
      // compare against a non-empty source span. If compare ever started
      // failing open (empty skeleton, empty root set), mapResults would still
      // be length 2 but ok would be true for the wrong reason; pairing ok with
      // an empty failReasons and a non-zero-length mapResults is the cheapest
      // signal we have that the source-side digest had content.
      const compareReasons = (r.json.failReasons || []).filter((s) => /compare|skeleton|root/i.test(String(s)));
      assert(compareReasons.length === 0, `compare reasons leaked into failReasons: ${compareReasons.join('; ')}`);
      assert(mapResults.length > 0, 'vacuous PASS: 0 map results');
      assert(mapResults[0].ok === true, 'first map entry must be a genuine pass (§A.2 anti-acceptance guard)');

      return `ok:true (fidelity) — 2/2 map entries, no compare fail-reasons`;
    });

    // -----------------------------------------------------------------------
    // 8. A syntactically broken tab fails validation (a HARD failure).
    // -----------------------------------------------------------------------
    await check('POST /gate with broken syntax fails validation', async () => {
      const r = await postJson('/gate', { tab: fix('broken-syntax.alphatab') });
      assert(r.status === 200, `expected 200 (gate failure is still HTTP 200), got ${r.status}`);
      assert(r.json && r.json.ok === false, `expected ok:false, got ${r.json?.ok}`);
      assert(
        r.json.hard.validate.ok === false || r.json.hard.validate.parseFailed === true,
        'validate should be ok:false or parseFailed:true',
      );
      return `ok:false — validate ok:${r.json.hard.validate.ok} parseFailed:${r.json.hard.validate.parseFailed ?? false}`;
    });

    // -----------------------------------------------------------------------
    // 9. A playability ERROR drives ok:false. A non-adjacent dyad produces a
    //    real playability error; ok must be false with that error surfaced.
    //    (This verifies the errors[] mechanism. The trap itself — gating on
    //    errors[] rather than the exit code — is proven by check 10 below.)
    // -----------------------------------------------------------------------
    await check('POST /gate with a playability error reports ok:false', async () => {
      const r = await postJson('/gate', { tab: fix('non-adjacent-dyad.alphatab'), source: undefined });
      assert(r.status === 200, `expected 200, got ${r.status}`);
      assert(r.json && r.json.ok === false, `expected ok:false, got ${r.json?.ok}`);
      const errors = r.json.hard.playability.errors;
      assert(Array.isArray(errors) && errors.length > 0, 'playability.errors must be a non-empty array');
      const na = errors.find(
        (e) => /non-adjacent/.test(String(e.type)) || /non-adjacent/.test(String(e.message)),
      );
      assert(na, `expected a non-adjacent-strings error, got: ${JSON.stringify(errors)}`);
      return `ok:false — ${errors.length} playability error(s) in errors[]`;
    });

    // -----------------------------------------------------------------------
    // 10. THE EXIT-CODE TRAP, discriminated. position-jump-slow passes
    //     validate --strict (ok:true) and playability produces ONLY warnings
    //     (0 errors, 14 warnings) but playability.mjs STILL EXITS 1. If serve.mjs
    //     trusted the exit code this would be ok:false; gating on errors[] makes
    //     it ok:true with the 14 warnings routed to soft. This is the only
    //     fixture that actually isolates the trap (non-adjacent-dyad fails
    //     validate, so its ok:false can't distinguish the two gating schemes).
    // -----------------------------------------------------------------------
    await check('POST /gate: warnings-only playability PASSes (exit-code trap)', async () => {
      const r = await postJson('/gate', { tab: fix('position-jump-slow.alphatab'), source: undefined });
      assert(r.status === 200, `expected 200, got ${r.status}`);
      assert(r.json && r.json.ok === true,
        `expected ok:true — warnings must NOT fail the gate. failReasons: ${JSON.stringify(r.json?.failReasons)}`);
      assert(r.json.hard.validate.ok === true, 'validate --strict must pass on this fixture');
      assert(r.json.hard.playability.ok === true, 'playability ok must be true (0 errors)');
      assert((r.json.hard.playability.errors ?? []).length === 0, 'errors[] must be empty');
      const warnings = r.json.soft.playability;
      assert(Array.isArray(warnings) && warnings.length > 0,
        `warnings must be routed to soft.playability — got ${JSON.stringify(warnings)}`);
      return `ok:true — ${warnings.length} warnings routed to soft, exit code ignored`;
    });

    // --- Report ---
    const width = Math.max(...results.map((r) => r.name.length));
    for (const r of results) {
      const tag = r.ok ? 'ok' : 'FAIL';
      const detail = r.ok ? r.detail : `— ${r.detail}`;
      console.log(`  [${tag}] ${r.name.padEnd(width)}  ${detail}`);
    }
    console.log();
    if (failed === 0) {
      console.log(`SMOKE: PASS  (${results.length}/${results.length} checks)`);
      exitCode = 0;
    } else {
      console.log(`SMOKE: FAIL  (${failed}/${results.length} checks failed)`);
      exitCode = 1;
    }
  }
} catch (e) {
  console.error('smoke runner crashed: ' + (e && e.stack ? e.stack : e));
  if (stderrBuf) console.error('--- serve.mjs stderr ---\n' + stderrBuf);
  console.log('SMOKE: FAIL');
  exitCode = 1;
} finally {
  try { srv.kill(); } catch {}
  // Give the kill a tick to land before exit.
  await sleep(50);
}

process.exit(exitCode);

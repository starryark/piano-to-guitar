// playground/serve.mjs — self-contained HTTP server for the web playground.
//
// Static-serves playground/public/ and the repo's @coderline/alphatab/dist/ over
// HTTP (alphaTab's worker, AudioWorklet, Bravura font and soundfont cannot run
// from file://), exposes GET /seed (the PASS fixtures) and POST /gate (which
// spawns the repo's existing tools/ CLIs via spawnSync and returns machine JSON).
//
// Node built-ins only — no npm dependencies, no imports from tools/lib/. The
// gate logic stays in the tested CLIs under tools/; this file only orchestrates
// them and shapes their output.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // .../playground
const ROOT = path.dirname(HERE);                              // repo root
const TOOLS = path.join(ROOT, 'tools');
const FIXTURES = path.join(TOOLS, 'fixtures');
const PUBLIC = path.join(HERE, 'public');
// DIST: prefer playground's own node_modules (standalone) then fall back to repo.
const DIST = [path.join(HERE, 'node_modules/@coderline/alphatab/dist'),
              path.join(ROOT, 'node_modules/@coderline/alphatab/dist')]
  .find((p) => fs.existsSync(p));
if (!DIST) {
  throw new Error('alphaTab dist not found — run `npm install` in playground/ or the repo root.');
}

// ---- MIME types -----------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.sf2': 'application/octet-stream', '.sf3': 'application/octet-stream',
  '.eot': 'application/vnd.ms-fontobject', '.otf': 'font/otf', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
const mime = (p) => MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream';

// ---- helpers --------------------------------------------------------------
function streamFile(res, p) {
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime(p) });
    // Guard against a mid-stream read error after headers are sent — calling
    // writeHead again would throw "Cannot set headers after they are sent".
    fs.createReadStream(p)
      .on('error', () => { if (!res.headersSent) { res.writeHead(404); } res.end('not found'); })
      .pipe(res);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** Spawn a tools/ CLI, capture {code, stdout, stderr, json|null, timedOut}. */
function run(tool, args) {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args],
    { encoding: 'utf8', timeout: 15000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* stays null */ }
  // On timeout r.status is null and r.signal === 'SIGTERM'. Surfacing this
  // prevents a timed-out playability from being misread as "0 errors" (which
  // would otherwise be a false PASS in lint mode).
  const timedOut = r.signal === 'SIGTERM' && r.status === null;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json, timedOut };
}

// ---- POST /gate -----------------------------------------------------------
// Any timed-out spawn is a server error (500), never a gate verdict — otherwise
// a hung playability could be misread as "0 errors" and produce a false PASS.
function timedOut(res, tool) {
  return sendJson(res, 500, { error: `${tool} timed out (>15s)` });
}

async function handleGate(req, res) {
  // Read body with an error handler + a 5 MB cap so a client abort or an
  // oversized POST can't leave the response hanging or exhaust memory.
  const body = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  }).catch(() => null);
  if (body === null) {
    if (!res.headersSent) sendJson(res, 400, { error: 'invalid or oversized body' });
    return;
  }
  let payload; try { payload = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  const { tab, source, sidecar } = payload;
  const tmp = path.join(os.tmpdir(), 'ptg-' + crypto.randomUUID());
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fs.writeFileSync(path.join(tmp, 'tab.alphatab'), tab);
    if (source) fs.writeFileSync(path.join(tmp, 'source.alphatab'), source);
    if (sidecar) fs.writeFileSync(path.join(tmp, 'sidecar.json'), sidecar);

    const V = run('validate.mjs', ['--strict', path.join(tmp, 'tab.alphatab')]);
    if (V.timedOut) return timedOut(res, 'validate.mjs');

    // Parse-failed (or vacuous) short-circuit: still HTTP 200 — a gate failure,
    // not a server error.
    if (!V.json?.stats) {
      return sendJson(res, 200, {
        ok: false, mode: source ? 'fidelity' : 'lint',
        hard: { validate: { ok: false, parseFailed: true,
          errors: V.json?.errors ?? [{ message: 'validate produced no JSON', raw: V.stdout }] },
          playability: null, compare: null },
        soft: { playability: [], compare: null }, failReasons: ['validate --strict'] });
    }

    const N = V.json.stats.bars;
    if (!N) { // 0 bars: treat like a parse failure downstream tools can't run on.
      return sendJson(res, 200, {
        ok: false, mode: source ? 'fidelity' : 'lint',
        hard: { validate: { ok: false, parseFailed: true,
          errors: [{ message: 'validate reported 0 bars' }] },
          playability: null, compare: null },
        soft: { playability: [], compare: null }, failReasons: ['validate --strict'] });
    }

    if (source) {
      // Fidelity mode: extract source digest, then run check.mjs. Use ABSOLUTE
      // paths for --digest/--map so there's no cwd coupling.
      const EX = run('piano-extract.mjs', [path.join(tmp, 'source.alphatab'), '--out', tmp]);
      if (EX.timedOut) return timedOut(res, 'piano-extract.mjs');
      // piano-extract writes <tmp>/source.json + <tmp>/source-map.md.
      const checkArgs = [path.join(tmp, 'tab.alphatab'), '--bars', '1-' + N,
        '--digest', path.join(tmp, 'source.json'), '--json'];
      if (sidecar) checkArgs.push('--map', path.join(tmp, 'sidecar.json'));
      const C = run('check.mjs', checkArgs);
      if (C.timedOut) return timedOut(res, 'check.mjs');
      if (C.json === null) return sendJson(res, 500,
        { error: 'check.mjs produced no JSON', stderr: C.stderr, stdout: C.stdout });
      return sendJson(res, 200, { ...C.json, mode: 'fidelity' });
    }

    // Lint mode (no source). We DON'T call check.mjs here — there's no source to
    // compare against. The canonical gate logic lives in the tested tools, so we
    // call validate + playability directly and assemble the same machine shape
    // check.mjs would have produced.
    const P = run('playability.mjs', [path.join(tmp, 'tab.alphatab'), '--bars', '1-' + N]);
    if (P.timedOut) return timedOut(res, 'playability.mjs');
    // CRITICAL: playability.mjs exits 1 on EITHER errors OR warnings (it is
    // strict by nature), so its exit code is NOT trustworthy. Gate on
    // errors.length === 0 only; warnings are SOFT and never fatal.
    const pErrors = P.json?.errors ?? [];
    const pWarnings = P.json?.warnings ?? [];
    const failReasons = [];
    if (!V.json.ok) failReasons.push('validate --strict'); // --strict makes warnings fatal
    if (pErrors.length) failReasons.push('playability errors');
    return sendJson(res, 200, {
      ok: failReasons.length === 0, mode: 'lint',
      file: path.join(tmp, 'tab.alphatab'), bars: '1-' + N, transpose: 0, gain: 'high', digest: null,
      hard: {
        validate: { ok: !!V.json.ok, code: V.code, parseFailed: false,
          stats: V.json.stats, warnings: V.json.warnings ?? [] },
        playability: { ok: pErrors.length === 0, errors: pErrors, stats: P.json?.stats ?? null },
        compare: null,
      },
      soft: { playability: pWarnings, compare: null },
      failReasons,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ---- request router -------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  if (req.method === 'POST' && p === '/gate') return handleGate(req, res);

  if (req.method === 'GET' && p === '/seed') {
    return sendJson(res, 200, {
      tab: fs.readFileSync(path.join(FIXTURES, 'e2e-tab.alphatab'), 'utf8'),
      source: fs.readFileSync(path.join(FIXTURES, 'chaconne-excerpt.alphatab'), 'utf8'),
      sidecar: fs.readFileSync(path.join(FIXTURES, 'e2e-sidecar.json'), 'utf8'),
    });
  }

  if (req.method === 'GET') {
    // Path-traversal guard: reject any request containing '..' before resolving.
    if (p.includes('..')) { res.writeHead(400); return res.end('bad path'); }
    if (p === '/') return streamFile(res, path.join(PUBLIC, 'index.html'));
    if (p.startsWith('/alphatab/')) {
      return streamFile(res, path.join(DIST, p.slice('/alphatab/'.length)));
    }
    return streamFile(res, path.join(PUBLIC, p));
  }

  res.writeHead(404); res.end('not found');
});

// ---- CLI / listen ---------------------------------------------------------
const argPort = process.argv.find((a, i) => process.argv[i - 1] === '--port');
const port = Number(argPort || process.env.PORT || 5173);
server.listen(port, () => console.log(`playground → http://localhost:${port}`));

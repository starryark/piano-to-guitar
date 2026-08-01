#!/usr/bin/env node
// tools/history.mjs — per-project tab version store, so no iteration of a
// cover is ever lost and any two can be compared.
//
// A cover goes through many machine-gate + human-edit rounds, but only the
// CURRENT cover.alphatab ever survived — every earlier state was gone. This
// tool captures each state immutably (tab + the sidecar it was gated against)
// under projects/<slug>/history/, keyed by a content hash so identical states
// never pile up, and lets you list / diff (bar-aware) / restore / export them.
//
// The store lives INSIDE the gitignored project dir, so it is local by
// construction and can never reach the public repo (a cover is a derivative of
// a copyrighted source). See projects/README.md.
//
//   node tools/history.mjs check <tab> [check-args…]   THE Gate-B command: run
//        the gate (wraps tools/check.mjs) AND snapshot the result. Same args,
//        same report, same exit code as check.mjs — plus a de-duped capture.
//   node tools/history.mjs snap [--note "…"] [--project D]   checkpoint now,
//        without gating (e.g. before a hand-editing session).
//   node tools/history.mjs verdict <APPROVED|REVISE:tag> [--note "…"] [--no-log]
//        annotate the latest snapshot with the human call (+ sessions.md stub).
//   node tools/history.mjs list [--all] [--project D]
//   node tools/history.mjs diff <a> [<b>] [--bars N-M] [--project D]
//   node tools/history.mjs show <seq> [--tab] [--project D]
//   node tools/history.mjs restore <seq> [--yes] [--project D]
//   node tools/history.mjs export <seq> <path> [--project D]
//
// <a>/<b> are a version seq (1,2,…) or "current"/"cover" for the working tab;
// <b> defaults to the current working tab. A project is the cwd by default
// (locate cover.alphatab next to history/), overridable with --project <dir>.
//
// Exit: 0 ok, 1 a gate hard-failed (check only, mirrors check.mjs), 2 usage/IO.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(TOOLS_DIR, 'check.mjs');

const USAGE =
  'Usage: node tools/history.mjs <check|snap|verdict|final-review|list|diff|show|restore|export> …\n' +
  '  check <tab> [check-args…]                 gate + snapshot (the Gate-B command)\n' +
  '  snap [--note "…"] [--project D]           checkpoint without gating\n' +
  '  verdict <APPROVED|REVISE:tag> [--note …] [--recognizability A] [--playability-review A] [--no-log]\n' +
  '  final-review <tab> [--map S] [--contract C] [--policy P] [--digest D] [--json]\n' +
  '  list [--all] [--project D]\n' +
  '  diff <a> [<b>] [--bars N-M] [--project D]\n' +
  '  show <seq> [--tab] [--project D]\n' +
  '  restore <seq> [--yes] [--project D]\n' +
  '  export <seq> <path> [--project D]';

function die(code, msg) {
  if (msg) console.error(`history: ${msg}`);
  else console.error(USAGE);
  process.exit(code);
}

// ---- store helpers --------------------------------------------------------
const pad = (seq) => String(seq).padStart(4, '0');

function paths(projectDir) {
  const historyDir = path.join(projectDir, 'history');
  return {
    projectDir,
    cover: path.join(projectDir, 'cover.alphatab'),
    sidecar: path.join(projectDir, 'sidecar.json'),
    historyDir,
    log: path.join(historyDir, 'log.jsonl'),
    sessions: path.join(projectDir, 'sessions.md'),
  };
}

function loadEntries(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch { die(2, `corrupt log line ${i + 1} in ${logPath}`); }
    });
}

function writeEntries(logPath, entries) {
  fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function findEntry(entries, seqArg) {
  const seq = Number(seqArg);
  if (!Number.isInteger(seq)) die(2, `bad seq "${seqArg}"; expected an integer`);
  const e = entries.find((x) => x.seq === seq);
  if (!e) die(2, `no version with seq ${seq} (have ${entries.length ? '1-' + entries[entries.length - 1].seq : 'none'})`);
  return e;
}

/**
 * De-dup snapshot of cover + sidecar (+ any analytical artifacts in force).
 * Returns {created, entry?|seq,short}.
 *
 * The dedup key is sha256 over cover, sidecar, AND the melody contract +
 * guitar policy when supplied (0x00-separated): a contract or policy edit
 * changes WHAT A PASS MEANS, so it is a distinct iteration even when the tab
 * bytes are identical (Improve_Plan §8.1). Each snapshot stores its own copy
 * of those artifacts plus the machine gate report, and the entry records
 * `contractHash`/`policyHash` so an old PASS stays reproducible against the
 * exact contract it was graded by.
 */
function capture(p, {
  bars = null, gate = null, note = '', coverPath = null, sidecarPath = null,
  contractPath = null, policyPath = null, report = null,
}) {
  const cover = coverPath ?? p.cover;
  const sc = sidecarPath ?? p.sidecar;
  if (!fs.existsSync(cover)) die(2, `no tab at ${cover}`);
  const coverBytes = fs.readFileSync(cover);
  const hasSidecar = sc && fs.existsSync(sc);
  const sidecarBytes = hasSidecar ? fs.readFileSync(sc) : Buffer.alloc(0);
  const hasContract = contractPath && fs.existsSync(contractPath);
  const contractBytes = hasContract ? fs.readFileSync(contractPath) : Buffer.alloc(0);
  const hasPolicy = policyPath && fs.existsSync(policyPath);
  const policyBytes = hasPolicy ? fs.readFileSync(policyPath) : Buffer.alloc(0);
  const SEP = Buffer.from([0]);
  const hash = createHash('sha256')
    .update(coverBytes).update(SEP).update(sidecarBytes)
    .update(SEP).update(contractBytes).update(SEP).update(policyBytes)
    .digest('hex');

  const entries = loadEntries(p.log);
  const last = entries[entries.length - 1] ?? null;
  if (last && last.hash === hash) return { created: false, seq: last.seq, short: hash.slice(0, 8) };

  const seq = last ? last.seq + 1 : 1;
  const short = hash.slice(0, 8);
  fs.mkdirSync(p.historyDir, { recursive: true });
  const coverName = `${pad(seq)}-${short}.alphatab`;
  fs.writeFileSync(path.join(p.historyDir, coverName), coverBytes);
  let sidecarName = null;
  if (hasSidecar) {
    sidecarName = `${pad(seq)}-${short}.sidecar.json`;
    fs.writeFileSync(path.join(p.historyDir, sidecarName), sidecarBytes);
  }
  let contractName = null;
  if (hasContract) {
    contractName = `${pad(seq)}-${short}.contract.json`;
    fs.writeFileSync(path.join(p.historyDir, contractName), contractBytes);
  }
  let policyName = null;
  if (hasPolicy) {
    policyName = `${pad(seq)}-${short}.policy.json`;
    fs.writeFileSync(path.join(p.historyDir, policyName), policyBytes);
  }
  let reportName = null;
  if (report) {
    reportName = `${pad(seq)}-${short}.report.json`;
    fs.writeFileSync(path.join(p.historyDir, reportName), `${JSON.stringify(report, null, 2)}\n`);
  }
  // foreground.json is an analysis artifact of the SOURCE, not the tab, but a
  // Gate-B iteration graded while it existed should keep it inspectable.
  let foregroundName = null;
  const fg = path.join(p.projectDir, 'foreground.json');
  if (fs.existsSync(fg)) {
    foregroundName = `${pad(seq)}-${short}.foreground.json`;
    fs.writeFileSync(path.join(p.historyDir, foregroundName), fs.readFileSync(fg));
  }
  const entry = {
    seq, ts: new Date().toISOString(), hash, parent: last ? last.seq : null,
    bars, gate, verdict: null, tag: '', note,
    contractHash: hasContract ? createHash('sha256').update(contractBytes).digest('hex').slice(0, 16) : null,
    policyHash: hasPolicy ? createHash('sha256').update(policyBytes).digest('hex').slice(0, 16) : null,
    files: {
      cover: coverName, sidecar: sidecarName, contract: contractName,
      policy: policyName, report: reportName, foreground: foregroundName,
    },
  };
  fs.appendFileSync(p.log, JSON.stringify(entry) + '\n');
  return { created: true, entry };
}

// ---- bar-aware diff -------------------------------------------------------
/** Normalize a bar segment to its tokens on one line (collapse all whitespace). */
const normBar = (seg) => seg.replace(/\s+/g, ' ').trim();

/**
 * Split an AlphaTex tab into bar segments on the `|` bar delimiter. Segment i
 * is bar (i+1); bar 1 also carries the header preamble, so a header-only change
 * surfaces as a bar-1 change (rare, and worth seeing).
 */
const toBars = (text) => text.split('|').map(normBar);

function truncTokens(s, n = 14) {
  const t = s.split(' ');
  return t.length > n ? t.slice(0, n).join(' ') + ' …' : s;
}

/** Longest-common-subsequence indices over two arrays of bar strings. */
function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs; // matched index pairs; gaps between them are edits
}

// ---- generic flag parsing (non-check subcommands) -------------------------
function parseFlags(argv, valueFlags = []) {
  const vf = new Set(valueFlags);
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); }
      else if (vf.has(a.slice(2))) { flags[a.slice(2)] = argv[++i]; }
      else { flags[a.slice(2)] = true; }
    } else positional.push(a);
  }
  return { positional, flags };
}

function resolveProject(flags) {
  const dir = flags.project ? String(flags.project) : '.';
  if (!fs.existsSync(dir)) die(2, `no such --project dir "${dir}"`);
  return paths(dir);
}

// ---- subcommands ----------------------------------------------------------
function cmdCheck(argv) {
  // Split history-only flags from check.mjs passthrough. Known value-flags
  // consume their next token so a value ("1-45") is never mistaken for the tab.
  // PTG: --contract (melody contract, §5) and --policy (guitar policy, §7)
  // are value flags — without this their values would be taken for the tab.
  // PTG (Wave 3): --style joins them, and --max-fret is added at the same time —
  // it has been a value flag since Wave 1 and was missing here, so
  // `history.mjs check --max-fret 24 cover.alphatab` took "24" for the tab.
  // Any check.mjs flag that consumes a value MUST be listed here.
  const VALUE = new Set(['--bars', '--map', '--transpose', '--gain', '--digest',
    '--contract', '--policy', '--style', '--max-fret']);
  const passthrough = [];
  let note = '', bars = null, map = null, tab = null, contract = null, policy = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--note') { note = argv[++i] ?? ''; continue; }
    if (a.startsWith('--note=')) { note = a.slice('--note='.length); continue; }
    if (a === '--json') continue; // we control the json/plain runs ourselves
    if (a === '--bars') bars = argv[i + 1];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--map') map = argv[i + 1];
    else if (a.startsWith('--map=')) map = a.slice('--map='.length);
    else if (a === '--contract') contract = argv[i + 1];
    else if (a.startsWith('--contract=')) contract = a.slice('--contract='.length);
    else if (a === '--policy') policy = argv[i + 1];
    else if (a.startsWith('--policy=')) policy = a.slice('--policy='.length);
    passthrough.push(a);
    if (VALUE.has(a)) { passthrough.push(argv[++i]); continue; }
    if (!a.startsWith('--') && tab === null) tab = a;
  }
  if (!tab) die(2, 'check needs a tab file: history.mjs check <tab> [check-args…]');

  // 1) Human report — run check.mjs plainly and stream it through unchanged, so
  //    check.mjs stays the single owner of the gate report (no duplicated
  //    formatting). 2) --json run for the structured verdict we store.
  const plain = spawnSync(process.execPath, [CHECK, ...passthrough], { encoding: 'utf8' });
  if (plain.stdout) process.stdout.write(plain.stdout);
  if (plain.stderr) process.stderr.write(plain.stderr);

  const jsonRun = spawnSync(process.execPath, [CHECK, ...passthrough, '--json'], { encoding: 'utf8' });
  let machine = null;
  try { machine = JSON.parse(jsonRun.stdout); } catch { /* stays null */ }
  const gate = machine
    ? { ok: machine.ok, failReasons: machine.failReasons ?? [], soft: summarizeSoft(machine.soft) }
    : { ok: plain.status === 0, failReasons: null, soft: null };

  const projectDir = path.dirname(tab) || '.';
  const p = paths(projectDir);
  const sidecarPath = map ? map : p.sidecar;

  // PTG §8.1: resolve the analytical artifacts this gate ran under, so the
  // snapshot preserves what the PASS/FAIL actually meant. Resolution:
  // explicit flag > the sidecar's own "contract" field > co-located file.
  let contractPath = contract ?? null;
  if (!contractPath && sidecarPath && fs.existsSync(sidecarPath)) {
    try {
      const sc = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
      if (typeof sc.contract === 'string') {
        contractPath = path.resolve(path.dirname(sidecarPath), sc.contract);
      }
    } catch { /* malformed sidecar is check.mjs's problem, reported above */ }
  }
  if (!contractPath) {
    const co = path.join(projectDir, 'melody-contract.json');
    if (fs.existsSync(co)) contractPath = co;
  }
  let policyPath = policy ?? null;
  if (!policyPath) {
    const co = path.join(projectDir, 'guitar-policy.json');
    if (fs.existsSync(co)) policyPath = co;
  }

  const cap = capture(p, {
    bars: bars ?? null, gate, note, coverPath: tab, sidecarPath,
    contractPath, policyPath, report: machine,
  });
  if (cap.created) {
    console.log(`\nhistory: saved seq ${cap.entry.seq} (${cap.entry.files.cover}) — gate ${gate.ok ? 'PASS' : 'FAIL'}`);
  } else {
    console.log(`\nhistory: unchanged since seq ${cap.seq} (${cap.short}) — no snapshot`);
  }
  process.exit(plain.status ?? 0);
}

function summarizeSoft(soft) {
  if (!soft) return null;
  const play = (soft.playability ?? []).map((w) => w.type ?? w.message);
  let compare = null;
  const c = soft.compare;
  if (c) compare = { density: c.density?.percent ?? null, contour: c.contour?.r ?? null, dropped: (c.dropped ?? []).length };
  return { playability: play, compare };
}

function cmdSnap(argv) {
  const { flags } = parseFlags(argv, ['note', 'project']);
  const p = resolveProject(flags);
  const cap = capture(p, { note: flags.note ? String(flags.note) : '' });
  if (cap.created) console.log(`history: saved seq ${cap.entry.seq} (${cap.entry.files.cover}) — checkpoint`);
  else console.log(`history: unchanged since seq ${cap.seq} (${cap.short}) — no snapshot`);
  process.exit(0);
}

function cmdVerdict(argv) {
  const { positional, flags } = parseFlags(argv, ['note', 'project', 'recognizability', 'playability-review']);
  const call = positional[0];
  if (!call) die(2, 'verdict needs a call: APPROVED or REVISE:<tag>');
  if (!/^(APPROVED|REVISE(:[\w-]+)?)$/i.test(call)) {
    console.error(`history: note — "${call}" is not APPROVED/REVISE:<tag> (recorded as-is)`);
  }
  const p = resolveProject(flags);
  const entries = loadEntries(p.log);
  if (!entries.length) die(2, 'no versions yet — run `history check` or `history snap` first');
  const target = entries[entries.length - 1];
  target.verdict = call;
  target.tag = call.includes(':') ? call.split(':')[1] : '';
  if (flags.note) target.note = String(flags.note);
  // PTG §8.2: optional musical-review status, separate from the mechanical
  // gate — final-review reports chunks that never received it.
  if (flags.recognizability) target.recognizability = String(flags.recognizability).toUpperCase();
  if (flags['playability-review']) target.playabilityReview = String(flags['playability-review']).toUpperCase();
  writeEntries(p.log, entries);

  if (!flags['no-log']) {
    const date = new Date().toISOString().slice(0, 10);
    const barsStr = target.bars ? ` bars ${target.bars}` : '';
    const noteStr = target.note ? ` — ${target.note}` : '';
    const stub = `- ${date} [history seq ${target.seq}${barsStr}] ${call}${noteStr}\n`;
    fs.appendFileSync(p.sessions, stub);
  }
  console.log(`history: seq ${target.seq} verdict = ${call}${flags['no-log'] ? '' : ' (logged to sessions.md)'}`);
  process.exit(0);
}

function cmdList(argv) {
  const { flags } = parseFlags(argv, ['project']);
  const p = resolveProject(flags);
  const entries = loadEntries(p.log);
  if (!entries.length) { console.log('history: no versions yet.'); process.exit(0); }
  const all = !!flags.all;
  const rows = [];
  let hidden = 0;
  entries.forEach((e, i) => {
    const isLatest = i === entries.length - 1;
    const visible = all || e.verdict != null || e.gate == null || e.gate.ok === true || isLatest;
    if (!visible) { hidden++; return; }
    rows.push(e);
  });
  const gateStr = (e) => (e.gate == null ? 'snap' : e.gate.ok ? 'PASS' : 'FAIL');
  console.log('seq   when              bars     gate  verdict         note');
  for (const e of rows) {
    const when = e.ts.slice(0, 16).replace('T', ' ');
    const bars = (e.bars ?? '-').padEnd(7);
    const verdict = (e.verdict ?? '-').padEnd(14);
    const note = e.note ? truncTokens(e.note, 8) : '';
    console.log(`${pad(e.seq)}  ${when}  ${bars}  ${gateStr(e).padEnd(4)}  ${verdict}  ${note}`);
  }
  if (hidden) console.log(`… ${hidden} intermediate capture(s) hidden — pass --all to show`);
  process.exit(0);
}

function versionText(p, entries, operand) {
  if (/^(current|cover|head)$/i.test(operand)) {
    if (!fs.existsSync(p.cover)) die(2, `no working tab at ${p.cover}`);
    return { label: 'current', text: fs.readFileSync(p.cover, 'utf8') };
  }
  const e = findEntry(entries, operand);
  return { label: `seq ${e.seq}`, text: fs.readFileSync(path.join(p.historyDir, e.files.cover), 'utf8') };
}

function cmdDiff(argv) {
  const { positional, flags } = parseFlags(argv, ['bars', 'project']);
  if (!positional.length) die(2, 'diff needs <a> [<b>]: a version seq or "current"');
  const p = resolveProject(flags);
  const entries = loadEntries(p.log);
  const A = versionText(p, entries, positional[0]);
  const B = positional[1] ? versionText(p, entries, positional[1]) : versionText(p, entries, 'current');

  let range = null;
  if (flags.bars) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(String(flags.bars).trim());
    if (!m) die(2, `bad --bars "${flags.bars}"; expected N or N-M`);
    range = { lo: Number(m[1]), hi: m[2] ? Number(m[2]) : Number(m[1]) };
  }
  const inRange = (barNum) => !range || (barNum >= range.lo && barNum <= range.hi);

  const a = toBars(A.text), b = toBars(B.text);
  console.log(`diff ${A.label} -> ${B.label}   (bar 1 includes the header preamble)`);
  let changes = 0;
  const report = (barNum, oldTok, newTok, kind) => {
    if (!inRange(barNum)) return;
    changes++;
    if (kind === 'removed') console.log(`  bar ${barNum} removed: ${truncTokens(oldTok)}`);
    else if (kind === 'added') console.log(`  bar ${barNum} added:   ${truncTokens(newTok)}`);
    else console.log(`  bar ${barNum}: ${truncTokens(oldTok)}  ->  ${truncTokens(newTok)}`);
  };

  if (a.length === b.length) {
    // Same bar count: exact in-place comparison, numbered by position.
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) report(i + 1, a[i], b[i], 'changed');
  } else {
    // Bar count diverged: align via LCS, then walk the edit script.
    const pairs = lcs(a, b);
    let ai = 0, bi = 0;
    const emitGap = (aEnd, bEnd) => {
      // Pair up removed/added within a gap as "changed" where counts align.
      const rem = [], add = [];
      for (; ai < aEnd; ai++) rem.push(ai);
      for (; bi < bEnd; bi++) add.push(bi);
      const k = Math.max(rem.length, add.length);
      for (let t = 0; t < k; t++) {
        if (t < rem.length && t < add.length) report(add[t] + 1, a[rem[t]], b[add[t]], 'changed');
        else if (t < rem.length) report(rem[t] + 1, a[rem[t]], '', 'removed');
        else report(add[t] + 1, '', b[add[t]], 'added');
      }
    };
    for (const [pa, pb] of pairs) { emitGap(pa, pb); ai = pa + 1; bi = pb + 1; }
    emitGap(a.length, b.length);
  }
  if (!changes) console.log('  (no bar differences' + (range ? ' in range' : '') + ')');
  process.exit(0);
}

function cmdShow(argv) {
  const { positional, flags } = parseFlags(argv, ['project']);
  if (!positional.length) die(2, 'show needs <seq>');
  const p = resolveProject(flags);
  const entries = loadEntries(p.log);
  const e = findEntry(entries, positional[0]);
  console.log(JSON.stringify(e, null, 2));
  if (flags.tab) {
    console.log('\n--- tab ---');
    console.log(fs.readFileSync(path.join(p.historyDir, e.files.cover), 'utf8'));
  }
  process.exit(0);
}

function cmdRestore(argv) {
  const { positional, flags } = parseFlags(argv, ['project']);
  if (!positional.length) die(2, 'restore needs <seq>');
  const p = resolveProject(flags);
  const entries = loadEntries(p.log);
  const e = findEntry(entries, positional[0]);
  if (!flags.yes) {
    console.log(`history: would restore seq ${e.seq} (${e.files.cover})${e.files.sidecar ? ' + sidecar' : ''} over cover.alphatab.`);
    console.log('history: the current state is auto-snapshotted first. Re-run with --yes to apply.');
    process.exit(0);
  }
  // Non-destructive: snapshot the current working state before overwriting it.
  capture(p, { note: `auto-snapshot before restore of seq ${e.seq}` });
  fs.copyFileSync(path.join(p.historyDir, e.files.cover), p.cover);
  if (e.files.sidecar) fs.copyFileSync(path.join(p.historyDir, e.files.sidecar), p.sidecar);
  console.log(`history: restored seq ${e.seq} to cover.alphatab${e.files.sidecar ? ' + sidecar.json' : ''} (previous state saved first).`);
  process.exit(0);
}

function cmdExport(argv) {
  const { positional, flags } = parseFlags(argv, ['project']);
  if (positional.length < 2) die(2, 'export needs <seq> <path>');
  const p = resolveProject(flags);
  const entries = loadEntries(p.log);
  const e = findEntry(entries, positional[0]);
  const dest = positional[1];
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  fs.copyFileSync(path.join(p.historyDir, e.files.cover), dest);
  console.log(`history: exported seq ${e.seq} -> ${dest}`);
  process.exit(0);
}

// ---- dispatch -------------------------------------------------------------
const [sub, ...rest] = process.argv.slice(2);
// ---- final-review (PTG §8.3) ------------------------------------------------
// Consolidated end-of-project evidence assembly: what recurs, what relocates,
// what is fastest/longest/thickest, and which chunks never got a musical
// verdict. It ASSEMBLES evidence for the human's final audition — it never
// replaces it. Exit 0 whenever the report could be built; 2 on IO problems.
function cmdFinalReview(argv) {
  const VALUE = new Set(['--map', '--contract', '--policy', '--digest', '--transpose', '--bars']);
  let tab = null;
  const flags = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { json = true; continue; }
    if (VALUE.has(a)) { flags[a.slice(2)] = argv[++i]; continue; }
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1 && VALUE.has(a.slice(0, eq))) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    if (!a.startsWith('--') && tab === null) tab = a;
  }
  if (!tab || !fs.existsSync(tab)) die(2, 'final-review needs a tab file');
  const projectDir = path.dirname(tab) || '.';
  const p = paths(projectDir);

  const readJson = (file, label, required = false) => {
    if (!file || !fs.existsSync(file)) {
      if (required) die(2, `final-review: no ${label} at "${file}"`);
      return null;
    }
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { die(2, `final-review: unreadable ${label}: ${e.message}`); return null; }
  };

  const digest = readJson(flags.digest ?? path.join(projectDir, 'source.json'), 'digest');
  const sidecar = readJson(flags.map ?? p.sidecar, 'sidecar');
  let contractPath = flags.contract ?? null;
  if (!contractPath && sidecar && typeof sidecar.contract === 'string') {
    contractPath = path.resolve(path.dirname(flags.map ?? p.sidecar), sidecar.contract);
  }
  if (!contractPath && fs.existsSync(path.join(projectDir, 'melody-contract.json'))) {
    contractPath = path.join(projectDir, 'melody-contract.json');
  }
  const contract = readJson(contractPath, 'contract');
  const policy = readJson(flags.policy ?? path.join(projectDir, 'guitar-policy.json'), 'policy');

  // Parser-grounded tab events, via the existing inspector (one parser, reused).
  const ev = spawnSync(process.execPath,
    [path.join(TOOLS_DIR, 'tab-events.mjs'), tab, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let events = null;
  try { events = JSON.parse(ev.stdout); } catch { die(2, `final-review: tab-events failed:\n${ev.stderr || ev.stdout}`); }

  // ---- assemble ------------------------------------------------------------
  const struck = [];
  for (const b of events.bars) {
    for (const e of b.events) {
      if (!e.rest && (e.notes ?? []).some((n) => n.attack)) struck.push({ bar: b.bar, ...e });
    }
  }
  const fastest = struck.length ? Math.min(...struck.map((e) => e.duration)) : null;
  const fastestBars = [...new Set(struck.filter((e) => e.duration === fastest).map((e) => e.bar))];
  const tuplets = [...new Set(struck.filter((e) => e.tuplet).map((e) => e.bar))];
  const longArrivals = [];
  for (const b of events.bars) {
    for (const e of b.events) {
      for (const n of e.notes ?? []) {
        const sounding = n.soundingBeats ?? e.duration;
        if (n.attack && sounding >= 2) longArrivals.push({ bar: b.bar, name: n.name, beats: sounding });
      }
    }
  }
  const multiNote = struck.filter((e) => (e.notes ?? []).filter((n) => n.attack).length >= 2);
  const maxChord = multiNote.reduce((a, e) => Math.max(a, e.notes.filter((n) => n.attack).length), 0);

  const modeCounts = {};
  for (const e of sidecar?.entries ?? []) modeCounts[e.mode] = (modeCounts[e.mode] ?? 0) + 1;

  const entries = loadEntries(p.log);
  const chunks = entries.map((e) => ({
    seq: e.seq,
    bars: e.bars ?? null,
    gate: e.gate ? (e.gate.ok ? 'PASS' : 'FAIL') : null,
    verdict: e.verdict,
    recognizability: e.recognizability ?? null,
    playabilityReview: e.playabilityReview ?? null,
    contractHash: e.contractHash ?? null,
  }));
  const unreviewed = chunks.filter((c) => c.gate === 'PASS' && (!c.verdict || !c.recognizability));

  // contract drift: entries graded under a different contract than today's
  let currentContractHash = null;
  if (contractPath && fs.existsSync(contractPath)) {
    currentContractHash = createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex').slice(0, 16);
  }
  const driftedChunks = currentContractHash
    ? chunks.filter((c) => c.contractHash && c.contractHash !== currentContractHash).map((c) => c.seq)
    : [];

  const report = {
    tab,
    digest: digest ? { song: digest.song, bars: digest.bars.length } : null,
    themes: digest?.duplicateRanges ?? [],
    sections: digest?.sections ?? [],
    pickup: digest?.pickup ?? false,
    sidecarModes: modeCounts,
    relocationGroups: contract?.relocationGroups ?? [],
    policy: policy ? { maxFret: policy.maxFret ?? null, fastAttackMaxNotes: policy.fastAttackMaxNotes ?? null } : null,
    fastestEvent: fastest === null ? null : { beats: fastest, bars: fastestBars.slice(0, 8) },
    tupletBars: tuplets,
    longArrivals: longArrivals.slice(0, 24),
    multiNoteAttacks: { count: multiNote.length, maxNotes: maxChord },
    tieIntentAudit: events.tieIntentAudit,
    chunks,
    chunksLackingReview: unreviewed.map((c) => c.seq),
    contractHash: currentContractHash,
    chunksGradedUnderOlderContract: driftedChunks,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  const L = [];
  L.push(`FINAL REVIEW  ${tab}`);
  if (report.digest) L.push(`  source "${report.digest.song}" (${report.digest.bars} bars)`);
  L.push('');
  L.push(`  recurring themes     ${report.themes.length
    ? report.themes.map((d) => `${d.a[0]}-${d.a[1]}~${d.b[0]}-${d.b[1]} (${d.kind})`).join(', ') : 'none detected'}`);
  L.push(`  sections             ${report.sections.map((s) => `${s.startBar}-${s.endBar}(${s.reason})`).join(', ') || 'n/a'}`);
  L.push(`  pickup               ${report.pickup ? 'yes' : 'no'}`);
  L.push(`  sidecar modes        ${Object.entries(modeCounts).map(([k, v]) => `${k}:${v}`).join('  ') || 'no sidecar'}`);
  L.push(`  relocation groups    ${report.relocationGroups.length
    ? report.relocationGroups.map((g) => `bars ${g.sourceBars[0]}-${g.sourceBars[1]} ${g.semitones > 0 ? '+' : ''}${g.semitones}`).join(', ') : 'none'}`);
  L.push(`  fastest events       ${fastest === null ? 'n/a' : `${fastest} beats (bars ${fastestBars.slice(0, 8).join(', ')})`}`);
  L.push(`  tuplets              ${tuplets.length ? `bars ${tuplets.join(', ')}` : 'none'}`);
  L.push(`  long arrivals (>=2b) ${longArrivals.length}`);
  L.push(`  multi-note attacks   ${multiNote.length} (max ${maxChord} notes)`);
  if (events.tieIntentAudit?.dropped > 0) {
    L.push(`  !! ${events.tieIntentAudit.dropped} dropped tie intent(s) — run tab-events.mjs before shipping`);
  }
  L.push('');
  L.push('  chunk status (history):');
  if (!chunks.length) L.push('    (no history — run history.mjs check during Gate B)');
  for (const c of chunks) {
    L.push(`    seq ${String(c.seq).padStart(3)}  bars ${String(c.bars ?? '?').padEnd(9)} gate ${c.gate ?? 'n/a'}  `
      + `verdict ${c.verdict ?? '—'}  recog ${c.recognizability ?? '—'}  play ${c.playabilityReview ?? '—'}`);
  }
  if (unreviewed.length) {
    L.push('');
    L.push(`  !! ${unreviewed.length} PASS chunk(s) lack a recognizability acceptance: `
      + `seq ${unreviewed.map((c) => c.seq).join(', ')}`);
  }
  if (driftedChunks.length) {
    L.push(`  !! chunk(s) graded under an OLDER contract than today's: seq ${driftedChunks.join(', ')} — `
      + 'their PASS meant something else; regate or restore that contract from history');
  }
  L.push('');
  L.push('  This assembles the evidence; the final audition and verdict stay human.');
  console.log(L.join('\n'));
  process.exit(0);
}

switch (sub) {
  case 'check': cmdCheck(rest); break;
  case 'snap': cmdSnap(rest); break;
  case 'verdict': cmdVerdict(rest); break;
  case 'final-review': cmdFinalReview(rest); break;
  case 'list': cmdList(rest); break;
  case 'diff': cmdDiff(rest); break;
  case 'show': cmdShow(rest); break;
  case 'restore': cmdRestore(rest); break;
  case 'export': cmdExport(rest); break;
  case undefined: die(2);
  default: die(2, `unknown subcommand "${sub}"`);
}

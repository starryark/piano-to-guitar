#!/usr/bin/env node
// tools/barfill.mjs — bar-sum pre-check: report each bar's summed beat-ticks
// vs its time signature so a 3.5- or 4.25-beat bar is caught BEFORE it is
// written into cover.alphatab.
//
//   node tools/barfill.mjs <file.alphatab> [--bars N-M]              FILE mode
//   node tools/barfill.mjs --frag "<alphatex beats>" [--ts N/M]      FRAGMENT (inline)
//   echo "<alphatex beats>" | node tools/barfill.mjs --stdin [--ts N/M]  FRAGMENT (stdin)
//
// Fragment mode wraps the given beats in the minimal skeleton that parses in
// this alphaTab version (a literal `\track { \staff {…} } ` nesting raises
// "Unrecognized property 'staff'"):
//
//   \ts <N> <M>
//   <fragment verbatim>
//
// and parses it through the same loadTex() validate/compare use — one parser
// path, no importer duplication.
//
// Exit: 0 every checked bar/voice fills exactly, 1 any mismatch, 2 usage.
// See docs/specs/tooling.md §B for the full contract.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadTex, barFillOk } from './lib/score-utils.mjs';
import { emit, emitErr } from './lib/emit.mjs';

const USAGE = 'Usage: node tools/barfill.mjs <file.alphatab> [--bars N-M] | ' +
  '--frag "<alphatex beats>" [--ts N/M] | --stdin [--ts N/M]';

function fail(msg) {
  emitErr(`barfill: ${msg}`);
  process.exit(2);
}

function usageFail() {
  emitErr(USAGE);
  process.exit(2);
}

/** Parse "9-16" | "12" -> {lo, hi}, or null for "all bars". */
function parseBarRange(spec) {
  if (!spec) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(spec).trim());
  if (!m) fail(`Bad --bars "${spec}"; expected N or N-M`);
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/** Parse "4/4" | "4" "4" -> [num, den], or null (caller then usage-fails). */
function parseTs(raw) {
  if (raw === null) return [4, 4]; // default 4/4
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function parseArgs(argv) {
  let file = null;
  let bars = null;
  let frag = null;
  let stdin = false;
  let ts = null; // raw string, either "N/M" or with a following separate token
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--frag') frag = argv[++i];
    else if (a.startsWith('--frag=')) frag = a.slice('--frag='.length);
    else if (a === '--stdin') stdin = true;
    else if (a === '--ts') {
      // Accept either "--ts N/M" or "--ts N M".
      const next = argv[i + 1];
      const nextNext = argv[i + 2];
      if (next && /^\d+\/\d+$/.test(next)) {
        ts = next; i += 1;
      } else if (next && /^\d+$/.test(next) && nextNext && /^\d+$/.test(nextNext)) {
        ts = `${next}/${nextNext}`; i += 2;
      } else {
        fail(`bad --ts value near "${next}"`);
      }
    } else if (a.startsWith('--ts=')) {
      ts = a.slice('--ts='.length);
    } else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
    else usageFail();
  }
  return { file, bars, frag, stdin, ts, json };
}

const { file, bars, frag, stdin, ts: tsRaw, json } = parseArgs(process.argv.slice(2));

const modesGiven = [file, frag, stdin].filter(Boolean).length;
if (modesGiven === 0) usageFail();
if (modesGiven > 1) fail('give exactly one of <file.alphatab>, --frag, or --stdin');

const tsPair = parseTs(tsRaw);
if (!tsPair) fail(`bad --ts "${tsRaw}"; expected N/M`);
const [tsNum, tsDen] = tsPair;
if (!Number.isInteger(tsNum) || !Number.isInteger(tsDen) || tsNum < 1 || tsDen < 1) {
  fail(`bad --ts "${tsRaw}"; expected positive integers N/M`);
}

/** Load a fragment string via a temp .alphatab file + loadTex. */
function loadFragment(fragText) {
  const wrapped = `\\ts ${tsNum} ${tsDen}\n${fragText}\n`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barfill-'));
  const tmpFile = path.join(dir, 'frag.alphatab');
  fs.writeFileSync(tmpFile, wrapped, 'utf8');
  try {
    return loadTex(tmpFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let loaded;
let label;
if (file) {
  if (!fs.existsSync(file)) fail(`no such file "${file}"`);
  loaded = loadTex(file);
  label = file;
} else if (frag !== null) {
  loaded = loadFragment(frag);
  label = '(fragment)';
} else {
  const fragText = fs.readFileSync(0, 'utf8');
  loaded = loadFragment(fragText);
  label = '(stdin fragment)';
}

if (!loaded.ok) {
  emitErr(`barfill: fragment/file did not parse:`);
  for (const e of loaded.errors || []) emitErr(`  ${e.severity} ${e.message}`);
  process.exit(2);
}

const { score } = loaded;
const range = file ? parseBarRange(bars) : null;
const inRange = (barNum1) => !range || (barNum1 >= range.lo && barNum1 <= range.hi);

const rows = [];
for (const track of score.tracks) {
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      const barNum = bar.index + 1;
      if (!inRange(barNum)) continue;
      const masterBar = bar.masterBar;
      bar.voices.forEach((voice, vi) => {
        if (!voice || voice.isEmpty) return;
        const fill = barFillOk(voice.beats, masterBar);
        rows.push({
          bar: barNum,
          voice: vi,
          multiVoice: bar.voices.length > 1,
          actual: fill.actual,
          expected: fill.expected,
          delta: fill.delta,
          dir: fill.dir,
          ok: fill.ok,
          num: masterBar.timeSignatureNumerator,
          den: masterBar.timeSignatureDenominator,
        });
      });
    }
  }
}

const mismatches = rows.filter((r) => !r.ok);

if (json) {
  const out = {
    ok: mismatches.length === 0,
    ...(file ? { file } : { frag: label }),
    bars: rows.map(({ bar, voice, actual, expected, delta, dir, ok }) => ({ bar, voice, actual, expected, delta, dir, ok })),
  };
  emit(JSON.stringify(out, null, 2));
  process.exit(mismatches.length === 0 ? 0 : 1);
}

for (const r of rows) {
  const voiceSeg = r.multiVoice ? ` voice ${r.voice}:` : ':';
  const status = r.ok ? 'OK' : `MISMATCH (${r.dir} by ${Math.abs(r.delta)} ticks)`;
  emit(
    `bar ${r.bar}${voiceSeg} ${r.actual} ticks (${(r.actual / 960).toFixed(2)}) / ` +
    `expected ${r.expected} (${(r.expected / 960).toFixed(2)}) in ${r.num}/${r.den}  ${status}`
  );
}
emit(`barfill: ${rows.length} bar(s) checked, ${mismatches.length} mismatch(es)`);
process.exit(mismatches.length === 0 ? 0 : 1);

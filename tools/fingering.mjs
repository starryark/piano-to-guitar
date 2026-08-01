// tools/fingering.mjs — the phrase-level fingering analyzer, as a CLI.
// PTG-native (Wave 2). Thin wrapper: every musical decision lives in
// tools/lib/fingering.mjs; this file is argument parsing, configuration
// resolution and formatting.
//
// Usage:
//   node tools/fingering.mjs <tab.alphatab> [--bars N-M] [--max-fret N] [--json]
//
// WHAT IT ANSWERS
// ---------------
// "Given the pitches already committed to, is there a better way for a hand to
// play this phrase?" It reports; it NEVER edits the tab (contract C15). Output
// is a recommendation addressed to the arranger, who owns the decision.
//
// EXIT CONTRACT (C2) — this is a SOFT-ONLY analyzer:
//   0 = ran to completion. Advisories may be present; they are NOT failures.
//   2 = usage / unreadable or unparseable input / IO failure.
//   1 = never. There is no hard gate here to fail. `check.mjs` owns the gate,
//       and per Implement.md the fingering engine is wired into it in Wave 3.
//
// THE CAVEAT THIS TOOL MUST ALWAYS PRINT
// --------------------------------------
// reference/guitar-fretboard.md → "Where a pitch sounds best": the same pitch in
// two positions is two different voices — `12.2` is round and vocal, `7.1` is
// tense and bright. This tool costs the HAND, not the VOICE. A cheaper fingering
// is therefore a question ("did you mean the bright one?"), never a verdict, and
// the footer says so on every run that produces a suggestion.

import { loadTex } from './lib/score-utils.mjs';
import { resolveConfig } from './lib/project-config.mjs';
import { analyzeFingering } from './lib/fingering.mjs';

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let maxFret = null;      // null = "not set on the CLI" (C5 precedence)
  let json = false;
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--max-fret') maxFret = argv[++i];
    else if (a.startsWith('--max-fret=')) maxFret = a.slice('--max-fret='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
  }
  return { bars, maxFret, json, file };
}

const USAGE = 'Usage: node tools/fingering.mjs <file.alphatab> [--bars N-M] '
  + '[--max-fret N] [--json]';

const { bars, maxFret: maxFretArg, json, file } = parseArgs(process.argv.slice(2));

/** Every failure route out of this tool is exit 2 (C2). */
function fail(...messages) {
  if (json) {
    console.log(JSON.stringify({ ok: false, file: file ?? null, errors: messages }, null, 2));
  }
  for (const m of messages) console.error(m);
  if (!json) console.error(USAGE);
  process.exit(2);
}

if (!file) fail('No tab file given.');

/** Parse "9-16" | "12" -> {lo, hi}, or null for "all bars". */
function parseBarRange(spec) {
  if (!spec) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(spec).trim());
  if (!m) fail(`Bad --bars "${spec}"; expected N or N-M`);
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}
const range = parseBarRange(bars);

// ---- instrument configuration (contract C5) --------------------------------
// The SAME single precedence rule as playability.mjs and check.mjs:
//     --max-fret N  >  <dir of the tab>/…/config.json  >  built-in 22
// Resolved once, here at the CLI boundary; lib/fingering.mjs and
// lib/fretboard.mjs never read a file. A malformed config is exit 2, not a
// silently weakened search space — a fingering engine that quietly believed in
// 22 frets on a 24-fret guitar would hide every legal high-position answer.
if (maxFretArg !== null && !/^\d+$/.test(String(maxFretArg).trim())) {
  fail(`Bad --max-fret "${maxFretArg}"; expected a positive integer`);
}
const config = resolveConfig({
  anchorPath: file,
  cli: { maxFret: maxFretArg === null ? undefined : Number(maxFretArg) },
});
if (!config.ok) fail(...config.errors);

// ---- load ------------------------------------------------------------------
let loaded;
try {
  loaded = loadTex(file);
} catch (e) {
  fail(`Cannot read "${file}": ${e.message}`);
}
if (!loaded.ok) {
  // A tab that does not parse is an INPUT failure for a soft analyzer (exit 2),
  // not a musical verdict (exit 1). validate.mjs is the tool that judges syntax.
  fail(`"${file}" did not parse — run tools/validate.mjs for the diagnostics.`,
    ...loaded.errors.slice(0, 6).map((e) => `  ${(e.message ?? JSON.stringify(e)).trim()}`));
}

// ---- analyse ---------------------------------------------------------------
const result = analyzeFingering(loaded.score, {
  range,
  maxFret: config.instrument.maxFret,
  stringCount: config.instrument.stringCount,
});

const out = {
  ok: true,                     // soft-only: there is no hard gate here to fail
  file,
  bars: bars ?? null,
  instrument: config.instrument,
  configPath: config.configPath,
  configSources: config.sources,
  stats: result.stats,
  settings: result.settings,
  phrases: result.phrases,
  advisories: result.advisories,
};

if (json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ---- human-readable report (Implement.md §2.4) -----------------------------
const L = [];
const n2 = (v) => v.toFixed(2);

L.push(`FINGERING  ${file}`);
L.push(`           bars ${bars ?? 'all'}   instrument max fret ${config.instrument.maxFret}`
  + ` (${config.sources.maxFret})`
  + (config.configPath ? `   config ${config.configPath}` : ''));
L.push(`           ${result.stats.phrases} phrase(s), ${result.stats.events} attack(s), `
  + `${result.stats.notes} note(s)`);
for (const s of result.stats.skippedStaves) {
  L.push(`           ! skipped track ${s.track} staff ${s.staff}: ${s.reason}`);
}
if (result.stats.droppedNotes) {
  L.push(`           ! ${result.stats.droppedNotes} note(s) had no fretboard position and were `
    + `not analysed`);
}
if (result.stats.truncatedBeats) {
  // Never let a bounded search read as an exhaustive one.
  L.push(`           ! ${result.stats.truncatedBeats} beat(s) hit the candidate ceiling; `
    + `their alternatives were explored only in part`);
}
L.push('');

const improved = result.phrases.filter((p) => p.changes.length);
if (!result.stats.phrases) {
  // "Nothing to improve" and "nothing to look at" are completely different
  // answers, and reporting the second as the first would be a quiet lie — most
  // often it means this is a piano SOURCE, not a guitar tab.
  L.push('  Nothing was analysed: this file has no fretted (tab) staff, so none of its');
  L.push('  notes has a fingering. Point this tool at the guitar tab — a piano source');
  L.push('  written on a score staff carries pitches, not string/fret positions.');
} else if (!improved.length) {
  L.push('  No fingering change worth making. Every phrase is already at or near the');
  L.push('  cheapest hand cost for the pitches as written.');
} else {
  for (const p of improved) {
    L.push(`  bars ${p.firstBar}-${p.lastBar}` + (p.track ? `  (track ${p.track})` : '')
      + `   ${p.events} attack(s)`);
    L.push(`  difficulty: ${n2(p.current.cost)} -> suggested ${n2(p.suggested.cost)}`);
    L.push('');
    for (const c of p.changes) {
      L.push(`  bar ${c.bar} beat ${c.beat + 1}:`);
      L.push(`    current:   ${c.from.name.padEnd(4)} string ${c.from.string} fret ${c.from.fret}`);
      L.push(`    suggested: ${c.to.name.padEnd(4)} string ${c.to.string} fret ${c.to.fret}`);
    }
    L.push('');
    L.push(`  reason:`);
    L.push(`    ${p.reason}`);
    if (p.pinned.length) {
      // Saying what was NOT considered is as important as the suggestion: it is
      // the difference between "nothing better exists" and "we were not allowed
      // to look".
      const shown = p.pinned.slice(0, 6)
        .map((x) => `bar ${x.bar} ${x.note} (${x.reasons.join('+')})`);
      const more = p.pinned.length > 6 ? ` (+${p.pinned.length - 6} more)` : '';
      L.push(`  held fixed by technique:`);
      L.push(`    ${shown.join(', ')}${more}`);
    }
    L.push('');
  }
}

if (result.advisories.length) {
  L.push('SOFT ADVISORIES');
  L.push('---------------');
  L.push(`  fingering     (${result.advisories.length})`);
  for (const a of result.advisories) L.push(`    ~ [${a.code}] ${a.message}`);
  L.push('');
  L.push('NOTE  These are recommendations, never edits: nothing here rewrites the tab, and');
  L.push('      a cheaper fingering is not automatically a better one. The same pitch in two');
  L.push('      positions is two different VOICES (reference/guitar-fretboard.md — "Where a');
  L.push('      pitch sounds best"). Adopt a suggestion only if its tone is the one you want.');
}

console.log(L.join('\n'));
process.exit(0);

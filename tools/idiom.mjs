// tools/idiom.mjs — the guitar-idiom density analyzer, as a CLI.
// PTG-native (Wave 3). Thin wrapper: every musical decision lives in
// tools/lib/idiom.mjs and every stylistic opinion in reference/styles/*.json;
// this file is argument parsing, configuration resolution and formatting.
//
// Usage:
//   node tools/idiom.mjs <tab.alphatab> [--bars N-M] [--style NAME] [--json]
//
// WHAT IT ANSWERS
// ---------------
// "How much of what this passage does is recognisably guitar writing, judged by
// the style the arranger chose?" Not "is it good" — that is Gate A's question and
// it belongs to a human. The output is evidence: which idioms are present, in
// what proportion, against which style's weights.
//
// EXIT CONTRACT (C2) — this is a SOFT-ONLY analyzer:
//   0 = ran to completion. Advisories may be present; they are NOT failures.
//   2 = usage / unreadable or unparseable input / unknown or malformed style.
//   1 = never. There is no hard gate here to fail.
//
// AN UNKNOWN STYLE IS EXIT 2, NOT A FALLBACK. A run that silently grades a jazz
// arrangement against hard-rock weights while printing "style: jazz" is worse
// than a run that refuses: the number looks authoritative and is about the wrong
// music.

import { loadTex } from './lib/score-utils.mjs';
import { resolveConfig } from './lib/project-config.mjs';
import { loadStyleProfile } from './lib/style-profile.mjs';
import { analyzeIdiomDensity, FEATURE_ORDER } from './lib/idiom.mjs';

// ---- CLI ------------------------------------------------------------------
// §A1: an absent flag stays `undefined`. `resolveConfig` is the ONLY place a
// default is applied, so a project config and a style profile can still speak.
function parseArgs(argv) {
  let bars = null;
  let style;                 // undefined = "not set on the CLI"
  let json = false;
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--style') style = argv[++i];
    else if (a.startsWith('--style=')) style = a.slice('--style='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
  }
  return { bars, style, json, file };
}

const USAGE = 'Usage: node tools/idiom.mjs <file.alphatab> [--bars N-M] '
  + '[--style hard-rock|metal|blues|jazz] [--json]';

const { bars, style: styleArg, json, file } = parseArgs(process.argv.slice(2));

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

// ---- style + configuration (contracts C5/C6, addendum §A1) -----------------
// Two stages, in this order and for this reason: the profile supplies
// `defaultGain` to the config ladder, but the profile cannot be loaded until its
// NAME is resolved, and the name comes from the config. So resolve the name
// first, load the profile, then re-resolve everything with the profile in place.
const stage1 = resolveConfig({ anchorPath: file, cli: { style: styleArg } });
if (!stage1.ok) fail(...stage1.errors);

const loadedStyle = loadStyleProfile(stage1.style);
if (!loadedStyle.ok) fail(...loadedStyle.errors);
const profile = loadedStyle.profile;

const config = resolveConfig({ anchorPath: file, cli: { style: styleArg }, styleProfile: profile });
if (!config.ok) fail(...config.errors);

// ---- load ------------------------------------------------------------------
let loaded;
try {
  loaded = loadTex(file);
} catch (e) {
  fail(`Cannot read "${file}": ${e.message}`);
}
if (!loaded.ok) {
  fail(`"${file}" did not parse — run tools/validate.mjs for the diagnostics.`,
    ...loaded.errors.slice(0, 6).map((e) => `  ${(e.message ?? JSON.stringify(e)).trim()}`));
}

// ---- analyse ---------------------------------------------------------------
let result;
try {
  result = analyzeIdiomDensity(loaded.score, { range, profile });
} catch (e) {
  // A soft analyzer that crashes on malformed internal data is an OPERATIONAL
  // failure (Implement.md §3.6), never a quiet empty advisory list.
  fail(`idiom analysis failed: ${e.message}`);
}

const out = {
  ok: true,                     // soft-only: there is no hard gate here to fail
  file,
  bars: bars ?? null,
  style: profile.name,
  styleSource: config.sources.style,
  gain: config.gain,
  score: result.score,
  graded: result.graded,
  features: result.features,
  weightedScore: result.weightedScore,
  stats: result.stats,
  settings: result.settings,
  advisories: result.advisories,
};

if (json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ---- human-readable report -------------------------------------------------
const L = [];
const pct = (v) => `${Math.round(v * 100)}%`;

L.push(`IDIOM  ${file}`);
L.push(`       bars ${bars ?? 'all'}   style ${profile.name} (${config.sources.style})`
  + `   floor ${profile.idiom.warnBelow}`);
L.push(`       ${result.stats.streams} stream(s), ${result.stats.attackEvents} attack(s), `
  + `${result.stats.multiNoteAttacks} of them multi-note`);
for (const s of result.stats.skippedStaves) {
  L.push(`       ! skipped track ${s.track} staff ${s.staff}: ${s.reason}`);
}
if (result.stats.droppedNotes) {
  L.push(`       ! ${result.stats.droppedNotes} note(s) had no fretboard position and were not analysed`);
}
if (result.stats.graceSkipped) {
  L.push(`       ! ${result.stats.graceSkipped} grace note(s) skipped — an ornament is not a riff event`);
}
L.push('');

if (!result.graded) {
  // "Nothing to grade" and "graded badly" are completely different answers, and
  // printing the second for the first is the single worst thing this tool could
  // do — most often it means this is a piano SOURCE, not a guitar tab.
  L.push(`  NOT GRADED — ${result.stats.attackEvents} attack(s) is below this style's evidence`);
  L.push(`  floor of ${profile.idiom.minAttacks}, or nothing on this staff has a fingering at all.`);
  L.push('  A weighted ratio over too little evidence is not a low score; it is no score.');
} else {
  L.push(`  idiom density ${result.score} / 10   (${profile.name} floor ${profile.idiom.warnBelow})`);
}
L.push('');

L.push('  feature                 value    weight   contribution');
for (const name of FEATURE_ORDER) {
  const f = result.features[name];
  const w = profile.idiom.weights[name] ?? 0;
  const c = result.weightedScore.contributions[name] ?? 0;
  const value = f.measured
    ? `${pct(f.value).padStart(4)} (${f.numerator}/${f.denominator})`
    : 'not measured';
  L.push(`  ${name.padEnd(22)} ${value.padEnd(16)} ${String(w).padStart(5)}   ${String(c).padStart(6)}`);
}
L.push(`  ${'—'.repeat(22)}`);
L.push(`  raw ${result.weightedScore.raw} / positive weight ${result.weightedScore.positiveWeight}`);
L.push('');
L.push('  "not measured" is not zero: a single-note line has no grips to classify, so the');
L.push('  grip features are dropped from BOTH sides of the ratio rather than counted absent.');

if (result.advisories.length) {
  L.push('');
  L.push('SOFT ADVISORIES');
  L.push('---------------');
  L.push(`  idiom         (${result.advisories.length})`);
  for (const a of result.advisories) L.push(`    ~ [${a.code}] ${a.message}`);
  L.push('');
  L.push('NOTE  Style is taste, not law. This tool never gates, never rewrites the tab, and');
  L.push('      cannot fail a run. A low score against one style is a high score against');
  L.push('      another — if the advice reads wrong for this music, the style is the thing');
  L.push('      to change, and `--style` is how.');
}

console.log(L.join('\n'));
process.exit(0);

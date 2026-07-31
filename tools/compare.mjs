// Vendored from abc-to-guitar@ba7e29c — tools/compare.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// compare.mjs — the fidelity gate between a reduced guitar tab and its source.
//
// Usage:
//   node tools/compare.mjs <tab.alphatab> <digest.json> --bars N-M
//       [--transpose N] [--json] [--map <sidecar.json>]
//
// This is a rock cover: NOT every source note is played, and that is correct.
// A plain note-coverage checker would flag every good artistic reduction as a
// defect. So this tool protects only what MUST survive a reduction and reports
// everything else as information the human weighs at the gate.
//
// HARD GATES (either failure => exit 1):
//   • Melodic skeleton coverage — every structural melody note in the digest's
//     `melodySkeleton` must appear in the tab's top-sounding line for that bar,
//     OCTAVE-EQUIVALENT (the arrangement octave-folds; that is correct). We
//     compare by pitch class only, never exact octave.
//   • Harmonic root motion — the tab bar's LOWEST sounding pitch class must
//     equal the digest chord root's pitch class OR be a member of its pcset
//     (a chord tone of that harmony).
//
// SOFT SIGNALS (reported, NEVER affect the exit code):
//   • Chord quality — with the power-chord rule: root+5th with no 3rd is a
//     correct rendering of BOTH major and minor, so a missing 3rd is never a
//     miss. Quality is informational only.
//   • Reduction density — "% of source notes retained". Low is expected/good.
//   • Dropped-note list per bar — source pitches whose class is absent from the
//     tab bar, so the human can judge the losses.
//   • Contour correlation — does the tab's top-line shape track the source's.
//
// --transpose N CONVENTION (exactly this, do not reinterpret):
//   N means the TAB is written N semitones ABOVE the source. All comparison
//   happens in SOURCE pitch space — we SUBTRACT N from every tab MIDI before
//   taking its pitch class. The digest is already source pitch. Default N = 0.
//
//   Derive N, never inherit it: N = (target key pitch class − source key pitch
//   class), reduced to the nearest signed value in −6..+5. Read the source key
//   from the digest's `key`; the target key is whatever Gate A approved. Sanity
//   check it against a note you can name in both — if the tab's tonic does not
//   land N semitones above the digest's, N is wrong and every gate below it is
//   measuring the wrong thing.
//
// CORRESPONDENCE-AWARE MODE (--map <sidecar.json>):
//   A tab whose bars do not align 1:1 with the source cannot be graded by the
//   bar-aligned loop above. --map supplies a sidecar of entries, each pinning a
//   contiguous tab span to a mode:
//     • free      — composed material (intro/coda/variation); NO fidelity gate.
//     • quote     — protect the melody: in-order subsequence match of the
//                  source skeleton pcs against the tab span's per-beat top-note
//                  pc sequence, PLUS root motion per proportional slice.
//     • recompose — root motion only: slice the tab span into N proportional
//                  pieces (N = source bar count) and chord-tone-check each.
//   The map REPLACES the 1:1 alignment loop. Fail-closed on every malformed
//   map, uncovered tab bar, missing source field, or contract violation —
//   the gate never weakens to a vacuous PASS. See `loadAndValidateMap` and
//   `runMapEntry` below for the exact rules.
//
// Output: JSON to stdout, same conventions as validate.mjs / playability.mjs
//   (top-level `ok`, `file`). Default = human-readable report; --json = machine
//   JSON. A machine result object is ALWAYS built:
//     { ok, file, digest, bars, transpose,
//       hardGates:{ melodicSkeleton, harmonicRoots }, soft:{...}, failures:[...] }
//   In --map mode the shape is:
//     { ok, file, digest, bars, transpose, map,
//       mapResults:[{mode, tabBars, sourceBars?, ok, failures:[]}], failures:[...] }
//   Exit 0 iff BOTH hard gates pass for every compared bar; 1 on any hard-gate
//   failure; 2 on usage / IO error.

import * as fs from 'fs';
import path from 'path';
import { loadTex, walkBeats, midiToName, QUARTER_TICKS } from './lib/score-utils.mjs';
import { fromAlphaTabNote, STRING_COUNT } from './lib/fretboard.mjs';
// PTG: contract-backed gate (Improve_Plan §5) — melody-contract enforcement
// for sidecar modes `contract` / `contract-recompose`.
import { collectTieChains } from './lib/ties.mjs';
import {
  loadContract, validateContract, findPhrase, effectiveRelocation, pitchToMidi,
} from './lib/contract.mjs';

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let transpose = 0;
  let json = false;
  let map = null;
  let contract = null; // PTG: --contract <melody-contract.json>
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--transpose') transpose = Number(argv[++i]);
    else if (a.startsWith('--transpose=')) transpose = Number(a.slice('--transpose='.length));
    else if (a === '--map') map = argv[++i];
    else if (a.startsWith('--map=')) map = a.slice('--map='.length);
    else if (a === '--contract') contract = argv[++i];
    else if (a.startsWith('--contract=')) contract = a.slice('--contract='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  return {
    file: positional[0] ?? null, digest: positional[1] ?? null,
    bars, transpose, json, map, contract,
  };
}

/** Parse "9-16" | "5" -> {lo, hi}; exit 2 on garbage. */
function parseBarRange(spec) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(spec).trim());
  if (!m) {
    console.error(`Bad --bars "${spec}"; expected N or N-M`);
    process.exit(2);
  }
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

const {
  file, digest: digestPath, bars, transpose, json, map: mapPath, contract: contractArg,
} = parseArgs(process.argv.slice(2));
if (!file || !digestPath || !bars) {
  console.error('Usage: node tools/compare.mjs <tab.alphatab> <digest.json> --bars N-M [--transpose N] [--json] [--map <file>] [--contract <melody-contract.json>]');
  process.exit(2);
}
if (!Number.isFinite(transpose)) {
  console.error(`Bad --transpose; expected an integer semitone offset`);
  process.exit(2);
}
const range = parseBarRange(bars);

// ---- pitch-class helpers --------------------------------------------------
const pc = (midi) => (((midi % 12) + 12) % 12);
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CONTOUR_WARN_R = -0.5;   // PTG: strongly-negative Pearson => surface a recognizability warning

/** Note-name string ("Eb", "F#", "Bb", "C") -> pitch class 0..11. */
function noteNameToPc(name) {
  const s = String(name).trim();
  let p = LETTER_PC[s[0]?.toUpperCase()];
  if (p === undefined) return null;
  for (const ch of s.slice(1)) {
    if (ch === '#' || ch === '♯') p += 1;
    else if (ch === 'b' || ch === 'B' || ch === '♭') p -= 1;
  }
  return ((p % 12) + 12) % 12;
}

// ---- load inputs ----------------------------------------------------------
let digest;
try {
  digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read digest "${digestPath}": ${e.message}`);
  process.exit(2);
}

let loaded;
try {
  loaded = loadTex(file);
} catch (e) {
  console.error(`Cannot read tab "${file}": ${e.message}`);
  process.exit(2);
}
if (!loaded.ok) {
  const out = { ok: false, file, digest: digestPath, bars, transpose, errors: loaded.errors };
  console.log(JSON.stringify(out, null, 2));
  process.exit(2);
}
const { score } = loaded;

// ---- collect the tab, per bar, in SOURCE pitch space ----------------------
// For each bar we need: the top-sounding line (highest MIDI per beat), the set
// of all pitch classes present, the lowest pitch class, and an ordered top-line
// sequence for contour. Every tab MIDI is shifted DOWN by `transpose` first.
const tabBars = new Map(); // barNum -> { topPcs:Set, allPcs:Set, lowMidi, topSeq:[], noteCount }
walkBeats(score, ({ staff, bar, beat }) => {
  const barNum = bar.index + 1;
  if (barNum < range.lo || barNum > range.hi) return;
  if (beat.isRest || !beat.notes.length) return;
  const stringCount = staff.stringTuning?.tunings?.length || STRING_COUNT;

  let entry = tabBars.get(barNum);
  if (!entry) {
    entry = { topPcs: new Set(), allPcs: new Set(), lowMidi: Infinity, topSeq: [], noteCount: 0 };
    tabBars.set(barNum, entry);
  }

  let beatTop = -Infinity;
  for (const n of beat.notes) {
    const { midi } = fromAlphaTabNote(n, stringCount); // the ONE correct MIDI read
    if (!Number.isFinite(midi)) continue;
    const src = midi - transpose;                      // into source space
    entry.allPcs.add(pc(src));
    entry.noteCount++;
    if (src < entry.lowMidi) entry.lowMidi = src;
    if (src > beatTop) beatTop = src;
  }
  if (Number.isFinite(beatTop)) {
    entry.topPcs.add(pc(beatTop));
    entry.topSeq.push(beatTop);
  }
});

// PTG: parser-grounded per-beat tab events, for the contract gate (§5). Tie
// chains are read from the MODEL (never token placement): an attack is a
// non-tie-destination note, and its sounding duration is its own chain's
// merged length — the same rules tools/lib/ties.mjs pins for the source side.
const tabTies = collectTieChains(score);
const tabEvents = new Map(); // barNum -> [{onset, beats, notes:[{midi(src), attack, soundingBeats, letRing}]}]
const tabBarBeats = new Map(); // barNum -> bar capacity in quarter beats
walkBeats(score, ({ staff, bar, beat }) => {
  const barNum = bar.index + 1;
  if (barNum < range.lo || barNum > range.hi) return;
  const mb = bar.masterBar;
  if (mb && !tabBarBeats.has(barNum)) {
    tabBarBeats.set(barNum, mb.timeSignatureNumerator * (4 / mb.timeSignatureDenominator));
  }
  if (beat.isRest || !beat.notes.length) return;
  const stringCount = staff.stringTuning?.tunings?.length || STRING_COUNT;
  if (!tabEvents.has(barNum)) tabEvents.set(barNum, []);
  tabEvents.get(barNum).push({
    onset: beat.playbackStart / QUARTER_TICKS,
    beats: beat.playbackDuration / QUARTER_TICKS,
    notes: beat.notes.map((n) => {
      const { midi } = fromAlphaTabNote(n, stringCount);
      const ti = tabTies.byNote.get(n);
      return {
        midi: Number.isFinite(midi) ? midi - transpose : NaN, // source space
        attack: !n.isTieDestination,
        soundingBeats: ti ? ti.chain.soundingBeats : beat.playbackDuration / QUARTER_TICKS,
        letRing: !!n.isLetRing,
      };
    }).filter((n) => Number.isFinite(n.midi)),
  });
});
for (const evs of tabEvents.values()) evs.sort((a, b) => a.onset - b.onset);

// ---- compare, bar by bar --------------------------------------------------
const digestByBar = new Map(digest.bars.map((b) => [b.bar, b]));

// ============================================================================
// CORRESPONDENCE-AWARE MODE (--map <file>)
// ============================================================================
// When --map is supplied the sidecar REPLACES the 1:1 bar-aligned loop. Each
// entry pins a contiguous TAB span to a mode:
//   free      — no fidelity gate (composed material).
//   quote     — in-order skeleton subsequence match + proportional root motion.
//   recompose — proportional root motion only.
// Every malformed map, uncovered tab bar, missing source field, or contract
// violation exits 2 — the gate never weakens to a vacuous PASS. The legacy
// bar-aligned loop below is skipped entirely when --map is present, so its
// behavior is byte-identical when --map is absent.
function mapUsage(msg) {
  console.error(`compare: ${msg}`);
  process.exit(2);
}

/** Validate a [start, end] inclusive range; return null on malformation. */
function badRange(r) {
  if (!Array.isArray(r) || r.length !== 2) return 'not a 2-element array';
  const [s, e] = r;
  if (!Number.isInteger(s) || !Number.isInteger(e)) return 'values not integers';
  if (s < 1 || e < 1) return 'values < 1';
  if (e < s) return 'end < start';
  return null;
}

/**
 * Load + fail-closed-validate a sidecar. Returns { song?, entries:[...], contract? }.
 * Each normalized entry: { mode, tabBars:[s,e], sourceBars?:[s,e],
 * contractPhrase?, note? }. Source-bar existence in the digest is verified up
 * front so per-mode logic can index digestByBar.get() without re-checking.
 *
 * PTG (Improve_Plan §5): modes `contract` and `contract-recompose` pin a tab
 * span to a melody-contract PHRASE (entry.contractPhrase). The contract file
 * comes from --contract, or the sidecar's own top-level "contract" path
 * (relative to the sidecar). It is fully validated against the digest before
 * any gate runs — an invalid or vacuous contract is exit 2, never a PASS.
 */
function loadAndValidateMap(mapPath, range, digestByBar, contractArg, digest) {
  let raw;
  try {
    raw = fs.readFileSync(mapPath, 'utf8');
  } catch (e) {
    mapUsage(`map file unreadable: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    mapUsage(`map file unreadable: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object') mapUsage('map file unreadable: top level is not an object');
  if (!Array.isArray(parsed.entries)) mapUsage('map missing "entries" array');
  if (parsed.entries.length === 0) mapUsage('map "entries" is empty');

  // PTG: resolve + validate the melody contract when any entry needs it.
  const CONTRACT_MODES = ['contract', 'contract-recompose'];
  const needsContract = parsed.entries.some((e) => CONTRACT_MODES.includes(e?.mode));
  let contract = null;
  if (needsContract) {
    const contractPath = contractArg
      ?? (typeof parsed.contract === 'string'
        ? path.resolve(path.dirname(path.resolve(mapPath)), parsed.contract)
        : null);
    if (!contractPath) {
      mapUsage('map has contract-mode entries but no contract file: pass --contract '
        + 'or set a top-level "contract" path in the sidecar');
    }
    const loadedContract = loadContract(contractPath);
    if (!loadedContract.ok) mapUsage(loadedContract.errors[0].message);
    const validation = validateContract(loadedContract.contract, digest);
    if (!validation.ok) {
      mapUsage(`melody contract ${contractPath} is INVALID — the gate refuses to run on it:\n`
        + validation.errors.map((e) => `  ${e.where}: ${e.message}`).join('\n'));
    }
    contract = loadedContract.contract;
  }

  const seen = new Map(); // tabBar -> entryIndex, for coverage/overlap
  const entries = parsed.entries.map((entry, i) => {
    if (!entry || typeof entry !== 'object') mapUsage(`entry ${i} is not an object`);
    if (!('tabBars' in entry)) mapUsage(`entry ${i} missing "tabBars"`);
    if (!('mode' in entry)) mapUsage(`entry ${i} missing "mode"`);
    const mode = entry.mode;
    if (!['free', 'quote', 'recompose', ...CONTRACT_MODES].includes(mode)) {
      mapUsage(`entry ${i} mode "${mode}" not in {free, quote, recompose, contract, contract-recompose}`);
    }
    const tb = badRange(entry.tabBars);
    if (tb) mapUsage(`entry ${i} tabBars ${tb} (got ${JSON.stringify(entry.tabBars)})`);
    const [tS, tE] = entry.tabBars;

    let sourceBars = undefined;
    let contractPhrase = undefined;
    if (CONTRACT_MODES.includes(mode)) {
      if (typeof entry.contractPhrase !== 'string' || !entry.contractPhrase) {
        mapUsage(`entry ${i} mode "${mode}" requires "contractPhrase"`);
      }
      const phrase = findPhrase(contract, entry.contractPhrase);
      if (!phrase) mapUsage(`entry ${i} contractPhrase "${entry.contractPhrase}" not found in the contract`);
      contractPhrase = entry.contractPhrase;
      // sourceBars come from the PHRASE — a contract span is source-tied by
      // construction; the contract validator already checked bar existence.
      sourceBars = [phrase.sourceBars[0], phrase.sourceBars[1]];
      for (let b = sourceBars[0]; b <= sourceBars[1]; b++) {
        if (!digestByBar.has(b)) {
          mapUsage(`entry ${i} phrase "${contractPhrase}" references bar ${b}, absent from the digest`);
        }
      }
    } else if (mode !== 'free') {
      if (!('sourceBars' in entry)) mapUsage(`entry ${i} mode "${mode}" requires "sourceBars"`);
      const sb = badRange(entry.sourceBars);
      if (sb) mapUsage(`entry ${i} sourceBars ${sb} (got ${JSON.stringify(entry.sourceBars)})`);
      const [sS, sE] = entry.sourceBars;
      for (let b = sS; b <= sE; b++) {
        if (!digestByBar.has(b)) {
          mapUsage(`entry ${i} sourceBars references bar ${b}, absent from the digest`);
        }
      }
      sourceBars = [sS, sE];
    }

    // Overlap check across tabBars ranges (any bar in exactly two entries =>
    // covered-by-multiple, which also fails the coverage check below; this
    // explicit pass makes the message unambiguous).
    for (let b = tS; b <= tE; b++) {
      if (seen.has(b)) mapUsage(`tab bar ${b} is covered by multiple entries`);
      seen.set(b, i);
    }

    const out = { mode, tabBars: [tS, tE] };
    if (sourceBars) out.sourceBars = sourceBars;
    if (contractPhrase) out.contractPhrase = contractPhrase;
    if ('note' in entry) out.note = entry.note;
    return out;
  });

  // Coverage check: every tab bar in --bars must be covered by exactly one
  // entry. (Overlaps were rejected above, so this only catches gaps.)
  for (let b = range.lo; b <= range.hi; b++) {
    if (!seen.has(b)) mapUsage(`tab bar ${b} is uncovered`);
  }

  const out = { entries, contract };
  if (parsed.song !== undefined) out.song = parsed.song;
  return out;
}

/**
 * Proportional slice of a tab span for source bar i (0-indexed) of N.
 * Returns [startBar, endBar] inclusive. T = tab span length, N = source span
 * length. Last slice absorbs the leftover so the union always equals [S, E].
 */
function proportionalSlice(tS, tE, i, N) {
  const T = tE - tS + 1;
  const lo = tS + Math.floor((i * T) / N);
  const hi = i === N - 1 ? tE : tS + Math.floor(((i + 1) * T) / N) - 1;
  return [lo, Math.max(lo, hi)];
}

/** Lowest tab pc in [lo, hi] inclusive, or null if the span has no tab notes. */
function lowestTabPcInSpan(lo, hi, tabBars, transpose) {
  let lowMidi = Infinity;
  for (let b = lo; b <= hi; b++) {
    const tb = tabBars.get(b);
    if (tb && Number.isFinite(tb.lowMidi) && tb.lowMidi < lowMidi) lowMidi = tb.lowMidi;
  }
  if (!Number.isFinite(lowMidi)) return null;
  // PTG: lowMidi was converted to source space while tabBars was collected.
  // Applying transpose again here double-shifts every non-zero-transpose map.
  return pc(lowMidi);
}

/** Concatenate per-beat top-note pc across tab bars [lo..hi] (transpose-aware). */
function tabTopPcSeq(lo, hi, tabBars, transpose) {
  const seq = [];
  for (let b = lo; b <= hi; b++) {
    const tb = tabBars.get(b);
    if (!tb) continue;
    // PTG: topSeq already stores source-space MIDI.
    for (const m of tb.topSeq) seq.push(pc(m));
  }
  return seq;
}

// PTG: per-quote-entry contour, reusing proportionalSlice (root-motion alignment)
// and pearson. Source skeleton midis vs tab top-line midis (already source-space
// via tb.topSeq), aligned per source-bar by index — the same heuristic the
// bar-locked contour uses (compare.mjs:532-535). Returns number|null.
function entryContourR(entry, tabBars, digestByBar, transpose) {
  const [tS, tE] = entry.tabBars;
  const [sS, sE] = entry.sourceBars;
  const src = [], tab = [];
  const bars = [];
  for (let b = sS; b <= sE; b++) bars.push(digestByBar.get(b));
  const N = bars.length;
  for (let i = 0; i < N; i++) {
    const sk = (bars[i]?.melodySkeleton || []).map((n) => n.midi);
    const [lo, hi] = proportionalSlice(tS, tE, i, N);
    const tabMidi = [];
    for (let b = lo; b <= hi; b++) {
      const tb = tabBars.get(b);
      if (tb) for (const m of tb.topSeq) tabMidi.push(m); // tb.topSeq is already source-space
    }
    const k = Math.min(sk.length, tabMidi.length);
    for (let j = 0; j < k; j++) { src.push(sk[j]); tab.push(tabMidi[j]); }
  }
  return pearson(src, tab);
}

/**
 * In-order subsequence test: every element of `needle` must appear in
 * `haystack` in the same relative order (not necessarily contiguous).
 */
function isSubsequence(needle, haystack) {
  let i = 0;
  for (const h of haystack) {
    if (i < needle.length && needle[i] === h) i++;
  }
  return i === needle.length;
}

// PTG: the contract-backed gate (Improve_Plan §5.2-§5.4). Enforces a melody-
// contract PHRASE over a tab span: octave-exact pitches (after the phrase's
// relocation), phrase-order continuity, per-event minimum sounding durations
// (tie-chain merged on the tab side), required repeated attacks, required
// gaps, and forbidden textures. Never reduced to pitch-class membership.
function runContractEntry(entry, contract, digestByBar, transpose) {
  const failures = [];
  const [tS, tE] = entry.tabBars;
  const phrase = findPhrase(contract, entry.contractPhrase);
  const [sS, sE] = entry.sourceBars;
  const N = sE - sS + 1;

  const totals = {
    foregroundAttacks: { covered: 0, total: 0 },
    durationObligations: { covered: 0, total: 0 },
    requiredGaps: { covered: 0, total: 0 },
    forbiddenRules: { covered: 0, total: 0 },
  };

  const sliceEvents = (lo, hi) => {
    const evs = [];
    for (let b = lo; b <= hi; b++) for (const e of tabEvents.get(b) ?? []) evs.push({ ...e, bar: b });
    return evs;
  };

  // ---- required events, in phrase order -----------------------------------
  // Events sharing a slice AND a pitch consume attacks CUMULATIVELY: two
  // required B4 events need two distinct B4 attacks — one sustained B4 must
  // never satisfy both (repeated melody attacks are not merged, §9 test 8).
  const required = (phrase.events ?? [])
    .filter((ev) => ev.required !== false)
    .slice()
    .sort((a, b) => (a.bar - b.bar) || (a.onset - b.onset));
  const matchedPositions = [];
  const groupNeed = new Map(); // "lo-hi-midi" -> total attacks required
  const prepared = required.map((ev) => {
    const reloc = effectiveRelocation(contract, phrase, ev);
    const expected = pitchToMidi(ev.pitch) + reloc; // source space; tabEvents already source space
    const [lo, hi] = proportionalSlice(tS, tE, ev.bar - sS, N);
    const key = `${lo}-${hi}-${expected}`;
    groupNeed.set(key, (groupNeed.get(key) ?? 0) + (ev.attacks ?? 1));
    return { ev, reloc, expected, lo, hi, key };
  });
  const groupUsed = new Map();
  for (const { ev, reloc, expected, lo, hi, key } of prepared) {
    const attacks = [];
    for (const e of sliceEvents(lo, hi)) {
      for (const n of e.notes) {
        if (n.attack && n.midi === expected) attacks.push({ bar: e.bar, onset: e.onset, n });
      }
    }
    const need = ev.attacks ?? 1;
    const used = groupUsed.get(key) ?? 0;
    const label = `${ev.pitch}${reloc ? `${reloc > 0 ? '+' : ''}${reloc}` : ''}@${ev.bar}:${ev.onset}`;

    totals.foregroundAttacks.total++;
    if (attacks.length >= used + need) {
      totals.foregroundAttacks.covered++;
      matchedPositions.push({ ev, label, pos: [attacks[used].bar, attacks[used].onset] });
    } else {
      failures.push({
        gate: 'contract', entry: entry.tabBars,
        message: `contract "${entry.contractPhrase}": ${label} needs ${used + need} distinct `
          + `attack(s) of MIDI ${expected} in tab bars [${lo},${hi}], found ${attacks.length} `
          + '(octave-exact — a pitch-class match in the wrong octave does not count; '
          + 'repeated melody notes are separate attacks, never one sustain)',
      });
    }
    groupUsed.set(key, used + need);

    if (ev.duration !== undefined) {
      totals.durationObligations.total++;
      const gapAllow = ev.allowLetRingThroughGap ?? 0;
      const best = attacks.length ? Math.max(...attacks.map((a) => a.n.soundingBeats)) : 0;
      if (attacks.length && best + gapAllow >= ev.duration - 1e-6) {
        totals.durationObligations.covered++;
      } else {
        const detail = attacks.length ? `best tab sustain is ${best}` : 'no attack to sustain';
        failures.push({
          gate: 'contract', entry: entry.tabBars,
          message: `contract "${entry.contractPhrase}": ${label} must sound >= ${ev.duration} `
            + `beat(s) (gap allowance ${gapAllow}), ${detail}`,
        });
      }
    }

    // Reattack prohibition applies per pitch GROUP: extra attacks beyond the
    // group's total requirement are reattacks inside a sustain.
    if (ev.allowReattack === false && attacks.length > groupNeed.get(key)) {
      failures.push({
        gate: 'contract', entry: entry.tabBars,
        message: `contract "${entry.contractPhrase}": ${label} forbids reattacks inside the `
          + `sustain but the tab attacks it ${attacks.length}x (allowed ${groupNeed.get(key)})`,
      });
    }
  }

  // phrase-order continuity: first-match positions must be non-decreasing
  for (let i = 1; i < matchedPositions.length; i++) {
    const a = matchedPositions[i - 1];
    const b = matchedPositions[i];
    if (b.pos[0] < a.pos[0] || (b.pos[0] === a.pos[0] && b.pos[1] < a.pos[1] - 1e-6)) {
      failures.push({
        gate: 'contract', entry: entry.tabBars,
        message: `contract "${entry.contractPhrase}": phrase order broken — ${b.label} sounds `
          + `before ${a.label}`,
      });
    }
  }

  // ---- required gaps (breaths): no attack may fill them ---------------------
  for (const gap of phrase.requiredGaps ?? []) {
    totals.requiredGaps.total++;
    const srcBar = digestByBar.get(gap.bar);
    const [num, den] = (srcBar?.timeSig ?? '4/4').split('/').map(Number);
    const srcBeats = (num * 4) / den;
    const [lo, hi] = proportionalSlice(tS, tE, gap.bar - sS, N);
    // Map the source-bar window onto the slice in bar-fraction units.
    const k = hi - lo + 1;
    const f0 = (gap.fromOnset / srcBeats) * k;
    const f1 = (gap.toOnset / srcBeats) * k;
    const offenders = [];
    for (const e of sliceEvents(lo, hi)) {
      if (!e.notes.some((n) => n.attack)) continue;
      const beats = tabBarBeats.get(e.bar) ?? 4;
      const posInSlice = (e.bar - lo) + e.onset / beats;
      if (posInSlice >= f0 - 1e-6 && posInSlice < f1 - 1e-6) {
        offenders.push(`bar ${e.bar} @${e.onset}`);
      }
    }
    if (offenders.length === 0) {
      totals.requiredGaps.covered++;
    } else {
      failures.push({
        gate: 'contract', entry: entry.tabBars,
        message: `contract "${entry.contractPhrase}": required gap (source bar ${gap.bar} `
          + `beats ${gap.fromOnset}-${gap.toOnset}) is filled by attack(s) at ${offenders.slice(0, 4).join(', ')}`
          + ' — a breath cannot be plugged with gate-serving notes',
      });
    }
  }

  // ---- forbidden textures (§5.4) --------------------------------------------
  const allExpected = new Set((phrase.events ?? []).map(
    (ev) => pitchToMidi(ev.pitch) + effectiveRelocation(contract, phrase, ev)));
  const floor = allExpected.size ? Math.min(...allExpected) : null;
  for (const rule of phrase.forbidden ?? []) {
    totals.forbiddenRules.total++;
    const offenders = [];
    for (const e of sliceEvents(tS, tE)) {
      const attacking = e.notes.filter((n) => n.attack);
      if (!attacking.length) continue;
      if (rule.kind === 'added-attacks') {
        for (const n of attacking) {
          if (!allExpected.has(n.midi)) offenders.push(`MIDI ${n.midi} bar ${e.bar} @${e.onset}`);
        }
      } else if (rule.kind === 'bass-ticks') {
        if (floor === null) continue;
        for (const n of attacking) {
          if (n.midi < floor - 7) offenders.push(`MIDI ${n.midi} bar ${e.bar} @${e.onset}`);
        }
      } else if (rule.kind === 'chords-on-fast-attacks') {
        const maxDur = rule.maxDuration ?? 0.25;
        if (attacking.length >= 2 && e.beats <= maxDur + 1e-6) {
          offenders.push(`${attacking.length}-note chord bar ${e.bar} @${e.onset}`);
        }
      }
    }
    if (offenders.length === 0) {
      totals.forbiddenRules.covered++;
    } else {
      failures.push({
        gate: 'contract', entry: entry.tabBars,
        message: `contract "${entry.contractPhrase}": forbidden ${rule.kind} — `
          + `${offenders.slice(0, 4).join(', ')}${offenders.length > 4 ? ` (+${offenders.length - 4} more)` : ''}`,
      });
    }
  }

  // ---- anti-vacuity (§5.3): a span protecting nothing is a FAIL -------------
  const grandTotal = totals.foregroundAttacks.total + totals.durationObligations.total
    + totals.requiredGaps.total + totals.forbiddenRules.total;
  if (grandTotal === 0) {
    failures.push({
      gate: 'contract', entry: entry.tabBars,
      message: `contract "${entry.contractPhrase}": ZERO protected events in this span — `
        + 'a vacuous contract span must fail, not pass',
    });
  }

  // ---- root motion (contract keeps harmony; contract-recompose relaxes it) --
  if (entry.mode === 'contract') {
    for (let i = 0; i < N; i++) {
      const sb = digestByBar.get(sS + i);
      const [lo, hi] = proportionalSlice(tS, tE, i, N);
      const lowPc = lowestTabPcInSpan(lo, hi, tabBars, transpose);
      const rootPc = noteNameToPc(sb.harmony?.root);
      const pcset = new Set(sb.harmony?.pcset || []);
      const ok = lowPc !== null && (lowPc === rootPc || pcset.has(lowPc));
      if (!ok) {
        const shown = lowPc === null ? 'no tab notes' : `lowest pc ${lowPc}`;
        failures.push({
          gate: 'harmonicRoots', entry: entry.tabBars, slice: i, sourceBar: sb.bar,
          tabSlice: [lo, hi],
          message: `contract slice ${i} (tab bars [${lo},${hi}] -> source bar ${sb.bar}): `
            + `${shown} is neither root ${sb.harmony?.root} (pc ${rootPc}) `
            + `nor a chord tone (pcset [${[...pcset].join(',')}])`,
        });
      }
    }
  }

  return {
    mode: entry.mode,
    tabBars: entry.tabBars,
    sourceBars: entry.sourceBars,
    contractPhrase: entry.contractPhrase,
    totals,
    ok: failures.length === 0,
    failures,
  };
}

/** Run a single map entry's gate. Mutates `failures` (caller's) and returns
 *  { mode, tabBars, sourceBars?, ok, failures:[...] }. */
function runMapEntry(entry, tabBars, digestByBar, transpose, contract = null) {
  const failures = [];
  const [tS, tE] = entry.tabBars;

  if (entry.mode === 'free') {
    return { mode: entry.mode, tabBars: entry.tabBars, ok: true, failures };
  }

  // PTG: contract modes take their own path (§5) — never the pc-based one.
  if (entry.mode === 'contract' || entry.mode === 'contract-recompose') {
    return runContractEntry(entry, contract, digestByBar, transpose);
  }

  const [sS, sE] = entry.sourceBars;
  const sourceBarsList = [];
  for (let b = sS; b <= sE; b++) sourceBarsList.push(digestByBar.get(b));

  // Fail-open guard: each mapped source bar must carry the contract keys.
  for (let idx = 0; idx < sourceBarsList.length; idx++) {
    const sb = sourceBarsList[idx];
    if (!('melodySkeleton' in sb) || !('harmony' in sb)) {
      mapUsage(
        `source bar ${sb.bar} (referenced by tab span [${tS},${tE}]) is missing ` +
        `the melodySkeleton or harmony field — the gate would be vacuous`);
    }
  }

  if (entry.mode === 'quote') {
    // Skeleton in-order subsequence.
    const needle = [];
    for (const sb of sourceBarsList) {
      for (const n of (sb.melodySkeleton || [])) needle.push(pc(n.midi));
    }
    const hay = tabTopPcSeq(tS, tE, tabBars, transpose);
    if (!isSubsequence(needle, hay)) {
      failures.push({
        gate: 'melodicSkeleton', entry: entry.tabBars,
        message: `quote tabBars [${tS},${tE}] top-line pc sequence [${hay.join(',')}] ` +
          `does not contain source skeleton [${needle.join(',')}] in order`,
      });
    }
  }

  // Root motion (proportional slice) — runs for both quote and recompose.
  const N = sourceBarsList.length;
  for (let i = 0; i < N; i++) {
    const sb = sourceBarsList[i];
    const [lo, hi] = proportionalSlice(tS, tE, i, N);
    const lowPc = lowestTabPcInSpan(lo, hi, tabBars, transpose);
    const rootPc = noteNameToPc(sb.harmony?.root);
    const pcset = new Set(sb.harmony?.pcset || []);
    const ok = lowPc !== null && (lowPc === rootPc || pcset.has(lowPc));
    if (!ok) {
      const shown = lowPc === null ? 'no tab notes' : `lowest pc ${lowPc}`;
      failures.push({
        gate: 'harmonicRoots', entry: entry.tabBars, slice: i, sourceBar: sb.bar,
        tabSlice: [lo, hi],
        message: `recompose/quote slice ${i} (tab bars [${lo},${hi}] -> source bar ${sb.bar}): ` +
          `${shown} is neither root ${sb.harmony?.root} (pc ${rootPc}) ` +
          `nor a chord tone (pcset [${[...pcset].join(',')}])`,
      });
    }
  }

  const result = { mode: entry.mode, tabBars: entry.tabBars, sourceBars: entry.sourceBars,
    ok: failures.length === 0, failures };
  return result;
}

if (mapPath) {
  const map = loadAndValidateMap(mapPath, range, digestByBar, contractArg, digest);
  // Filter to entries whose tabBars intersect --bars. Coverage has already
  // been verified on the union of all entries for the whole --bars range;
  // entries entirely outside --bars are skipped from evaluation but their
  // tabBars still participated in the coverage/overlap checks above.
  const activeEntries = map.entries.filter((e) => {
    const [tS, tE] = e.tabBars;
    return tE >= range.lo && tS <= range.hi;
  });
  const mapResults = activeEntries.map((e) => runMapEntry(e, tabBars, digestByBar, transpose, map.contract));
  const aggregated = mapResults.flatMap((r) => r.failures.map((f) => ({
    ...f,
    mode: r.mode,
    tabBars: r.tabBars,
    sourceBars: r.sourceBars,
  })));
  const mapOk = mapResults.every((r) => r.ok);

  // PTG: contour is SOFT/advisory — computed only for `quote` entries (the
  // only mode carrying an in-order melodic obligation), never gates.
  const contourWarnings = [];
  for (const e of activeEntries) {
    if (e.mode !== 'quote') continue;
    const r = entryContourR(e, tabBars, digestByBar, transpose);
    if (r !== null && r < CONTOUR_WARN_R) {
      contourWarnings.push({ tabBars: e.tabBars, sourceBars: e.sourceBars, r: Number(r.toFixed(3)) });
    }
  }

  const mapResult = {
    ok: mapOk,
    file,
    digest: digestPath,
    bars,
    transpose,
    map: mapPath,
    mapResults,
    soft: { contourWarnings },
    failures: aggregated,
  };

  if (json) {
    console.log(JSON.stringify(mapResult, null, 2));
    process.exit(mapOk ? 0 : 1);
  }

  // Human-readable report: one line per entry.
  const tsign = transpose >= 0 ? `+${transpose}` : `${transpose}`;
  const rangeLabel = range.lo === range.hi ? `Bar ${range.lo}` : `Bars ${range.lo}-${range.hi}`;
  const lines = [];
  lines.push(`${rangeLabel} vs source (transpose ${tsign}, map ${mapPath})`);
  for (const r of mapResults) {
    const tag = r.sourceBars ? `  sourceBars=[${r.sourceBars.join(',')}]` : '';
    const ph = r.contractPhrase ? ` phrase="${r.contractPhrase}"` : '';
    const tail = r.ok ? 'PASS' : `FAIL: ${r.failures[0].message}`;
    lines.push(`  ${r.mode.padEnd(9)} tabBars=[${r.tabBars.join(',')}]${tag}${ph}  ${tail}`);
    for (const f of r.failures.slice(1)) lines.push(`                     ${f.message}`);
    // PTG §5.3: contract spans always report their NON-ZERO obligation totals.
    if (r.totals) {
      const t = r.totals;
      lines.push(`             foreground attacks   ${t.foregroundAttacks.covered}/${t.foregroundAttacks.total}`);
      if (t.durationObligations.total) lines.push(`             duration obligations  ${t.durationObligations.covered}/${t.durationObligations.total}`);
      if (t.requiredGaps.total) lines.push(`             required gaps         ${t.requiredGaps.covered}/${t.requiredGaps.total}`);
      if (t.forbiddenRules.total) lines.push(`             forbidden rules       ${t.forbiddenRules.covered}/${t.forbiddenRules.total}`);
    }
  }
  // PTG: SOFT, non-gating contour advisory — quote entries whose top line runs
  // strongly opposite the quoted source melody.
  for (const cw of contourWarnings) {
    lines.push(`  ~ contour  tabBars=[${cw.tabBars.join(',')}] r=${cw.r} — top line runs opposite ` +
      `the quoted source melody; confirm this inversion is intended (soft, non-gating).`);
  }
  console.log(lines.join('\n'));
  process.exit(mapOk ? 0 : 1);
}

const comparedBars = [];

let skelCovered = 0, skelTotal = 0;
let rootCovered = 0, rootTotal = 0;
let powerCount = 0, exactCount = 0;
let tabNoteCount = 0, sourceNoteCount = 0;
const dropped = [];       // { bar, notes:[names] }
const failures = [];      // { gate, bar, message }
const srcContour = [];    // aligned source melody skeleton pitches
const tabContour = [];    // aligned tab top-line pitches (source space)

for (let barNum = range.lo; barNum <= range.hi; barNum++) {
  const db = digestByBar.get(barNum);
  if (!db) continue; // digest has no such bar; nothing to protect here
  comparedBars.push(barNum);
  const tb = tabBars.get(barNum) || { topPcs: new Set(), allPcs: new Set(), lowMidi: Infinity, topSeq: [], noteCount: 0 };

  // --- HARD GATE 1: melodic skeleton coverage (octave-equivalent) ---------
  const skeleton = db.melodySkeleton || [];
  for (const note of skeleton) {
    skelTotal++;
    if (tb.topPcs.has(pc(note.midi))) {
      skelCovered++;
    } else {
      failures.push({
        gate: 'melodicSkeleton', bar: barNum,
        message: `bar ${barNum}: skeleton ${note.name || midiToName(note.midi)} ` +
          `(pc ${pc(note.midi)}) not in tab top line`,
      });
    }
  }

  // --- HARD GATE 2: harmonic root motion ----------------------------------
  // A bar with skeleton but no tab content can't satisfy the root gate either.
  if (skeleton.length > 0 || db.harmony) {
    rootTotal++;
    const rootPc = noteNameToPc(db.harmony?.root);
    const pcset = new Set(db.harmony?.pcset || []);
    const lowPc = Number.isFinite(tb.lowMidi) ? pc(tb.lowMidi) : null;
    if (lowPc !== null && (lowPc === rootPc || pcset.has(lowPc))) {
      rootCovered++;
    } else {
      const shown = lowPc === null ? 'no tab notes' : `lowest pc ${lowPc}`;
      failures.push({
        gate: 'harmonicRoots', bar: barNum,
        message: `bar ${barNum}: ${shown} is neither root ${db.harmony?.root} ` +
          `(pc ${rootPc}) nor a chord tone (pcset [${[...pcset].join(',')}])`,
      });
    }
  }

  // --- SOFT: chord quality (power-chord rule) -----------------------------
  if (db.harmony) {
    const rootPc = noteNameToPc(db.harmony.root);
    const hasThird = tb.allPcs.has((rootPc + 3) % 12) || tb.allPcs.has((rootPc + 4) % 12);
    if (hasThird) exactCount++; else powerCount++; // no 3rd => neutral, never a miss
  }

  // --- SOFT: density + dropped notes --------------------------------------
  tabNoteCount += tb.noteCount;
  const srcNotes = [];
  for (const v of db.voices || []) for (const n of v.notes) srcNotes.push(n);
  sourceNoteCount += srcNotes.length;

  const dropNames = [];
  const seen = new Set();
  for (const n of srcNotes) {
    if (tb.allPcs.has(pc(n.midi))) continue; // its class survived somewhere
    const nm = n.name || midiToName(n.midi);
    if (seen.has(nm)) continue;
    seen.add(nm);
    dropNames.push(nm);
  }
  if (dropNames.length) dropped.push({ bar: barNum, notes: dropNames });

  // --- SOFT: contour (align per bar by index to avoid cross-bar drift) -----
  const sk = skeleton.map((n) => n.midi);
  const k = Math.min(sk.length, tb.topSeq.length);
  for (let i = 0; i < k; i++) { srcContour.push(sk[i]); tabContour.push(tb.topSeq[i]); }
}

/** Pearson correlation of two equal-length series, or null if undefined. */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null; // a flat line has no contour to correlate
  return sxy / Math.sqrt(sxx * syy);
}
const contourR = pearson(srcContour, tabContour);

// ---- assemble the machine result ------------------------------------------
// CONTRACT CHECK — the hard gates FAIL OPEN by construction: `covered === total`
// is trivially true when total is 0, so a digest that lost its `melodySkeleton`
// or `harmony` fields would report PASS while protecting nothing. An empty
// skeleton for a given bar is legitimate (a bar of rests); a digest whose bars
// do not carry the KEY at all is contract drift, and must never read as a pass.
const barsInRange = [];
for (let b = range.lo; b <= range.hi; b++) {
  const db = digestByBar.get(b);
  if (db) barsInRange.push(db);
}
const missingSkeletonKey = barsInRange.filter((b) => !('melodySkeleton' in b));
const missingHarmonyKey = barsInRange.filter((b) => !('harmony' in b));
if (barsInRange.length && (missingSkeletonKey.length || missingHarmonyKey.length)) {
  console.error(
    `compare: digest ${digestPath} is missing required per-bar fields ` +
    `(${missingSkeletonKey.length} bar(s) without melodySkeleton, ` +
    `${missingHarmonyKey.length} without harmony). The fidelity gate cannot ` +
    'run and would otherwise report a vacuous PASS. Re-extract the digest: ' +   // PTG: was abc-extract.py
    'node tools/piano-extract.mjs <the .alphatab this tab was arranged from>');
  process.exit(2);
}

const melodicSkeleton = { covered: skelCovered, total: skelTotal, ok: skelCovered === skelTotal };
const harmonicRoots = { covered: rootCovered, total: rootTotal, ok: rootCovered === rootTotal };
const densityPercent = sourceNoteCount ? Math.round((tabNoteCount / sourceNoteCount) * 100) : null;
const ok = melodicSkeleton.ok && harmonicRoots.ok;

const result = {
  ok,
  file,
  digest: digestPath,
  bars,
  transpose,
  comparedBars,
  hardGates: { melodicSkeleton, harmonicRoots },
  soft: {
    chordQuality: { power: powerCount, exact: exactCount },
    density: { tabNotes: tabNoteCount, sourceNotes: sourceNoteCount, percent: densityPercent },
    dropped,
    contour: { r: contourR === null ? null : Number(contourR.toFixed(3)),  // PTG: + warn flag
               warn: contourR !== null && contourR < CONTOUR_WARN_R },
  },
  failures,
};

// ---- output ---------------------------------------------------------------
if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

// Human-readable report (the format the human reads at the gate).
const tsign = transpose >= 0 ? `+${transpose}` : `${transpose}`;
const rangeLabel = range.lo === range.hi ? `Bar ${range.lo}` : `Bars ${range.lo}-${range.hi}`;
const lines = [];
lines.push(`${rangeLabel} vs source (transpose ${tsign})`);
lines.push(`  melodic skeleton   ${melodicSkeleton.covered}/${melodicSkeleton.total}   ${melodicSkeleton.ok ? 'OK' : 'FAIL'}`);
lines.push(`  harmonic roots     ${harmonicRoots.covered}/${harmonicRoots.total}   ${harmonicRoots.ok ? 'OK' : 'FAIL'}`);
lines.push(`  chord quality      ${powerCount} power-chord (major/minor neutral), ${exactCount} exact`);
lines.push(`  density            ${densityPercent === null ? 'n/a' : `${densityPercent}%`} of source notes retained`);
lines.push(`  contour            ${contourR === null ? 'n/a' : contourR.toFixed(2)} correlation with source top line`);
if (contourR !== null && contourR < CONTOUR_WARN_R) {  // PTG: SOFT, non-gating contour advisory
  lines.push(`  contour WARNING    strongly negative (r < -0.5): tab top line runs opposite the source — confirm intended (soft, non-gating).`);
}
if (dropped.length) {
  const cap = 8;
  const fmt = ({ bar, notes }) => {
    const shown = notes.slice(0, cap).join(' ');
    const more = notes.length > cap ? ` (+${notes.length - cap} more)` : '';
    return `bar ${bar}: ${shown}${more}`;
  };
  lines.push(`  dropped            ${fmt(dropped[0])}`);
  for (const d of dropped.slice(1)) lines.push(`                     ${fmt(d)}`);
}
if (failures.length) {
  lines.push(`  failures           ${failures[0].message}`);
  for (const f of failures.slice(1)) lines.push(`                     ${f.message}`);
}
console.log(lines.join('\n'));
process.exit(ok ? 0 : 1);

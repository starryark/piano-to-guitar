// Vendored from abc-to-guitar@ba7e29c — tools/playability.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// playability.mjs — mechanical + gain-aware playability lints for a guitar tab.
//
// Usage:
//   node tools/playability.mjs tabs/x.alphatab [--bars 9-16] [--gain high|crunch|clean]
//        [--policy guitar-policy.json] [--max-fret N] [--warnings-as-errors]
//
// Turns reference/guitar-playability.md's prose into mechanical checks. Every
// finding is either a hard mechanical impossibility (errors) or a tone/physics
// advisory (warnings).
//
// PTG (Improve_Plan §7): --policy adds PROJECT-SPECIFIC texture constraints on
// top of the general mechanical checks — an exact fret ceiling, single-note
// limits on fast attacks, simultaneous-note caps, brush/roll/mute bans, and a
// rapid-repeated-grip check. Tie integrity (a tie-shaped token that parsed
// into a fresh attack; a linked tie that changes pitch) is checked ALWAYS —
// corrupted tie semantics are as unplayable-as-written as a 30-fret note.
// --warnings-as-errors escalates every soft advisory into errors[] so an
// automatic approval policy can require a zero-warning tab.
//
// PICK REACHABILITY IS CHECKED HERE (PTG Wave 1, contract C14): a struck beat
// with simultaneous notes on non-adjacent strings and no brush/arpeggio effect
// is graded BY NOTE COUNT, because the remedies differ in kind:
//   • exactly 2 notes -> `non-adjacent-dyad` WARNING. A flatpick cannot take it,
//     but hybrid picking (pick the low note, middle finger the high) is a
//     completely ordinary right-hand technique that needs no re-voicing and no
//     notation change. It is a thing to be AWARE of, not a thing to fix.
//   • 3+ notes -> `non-adjacent-strings` ERROR (unchanged). Three simultaneous
//     non-contiguous attacks are not a hybrid-picking grip a rock player throws
//     mid-line; the arranger must brush (`{bd}`/`{bu}`), roll (`{au}`/`{ad}`),
//     or re-voice onto adjacent strings.
// The musical doctrine is in reference/guitar-playability.md → "Pick
// reachability across strings" (rules 17–19).
//
// Output: JSON to stdout, same shape as validate.mjs
//   { ok, file, gain, bars, stats, errors, warnings }
//
// EXIT / `ok` SEMANTICS (PTG Wave 1, contract C7) — now the SAME rule the rest
// of the toolchain uses:
//   0 = ran to completion, no HARD gate failed (soft warnings may be present)
//   1 = a HARD musical gate failed (`errors[]` is non-empty)
//   2 = usage / malformed input / IO failure
//   `ok` means `errors.length === 0`. Warnings are still serialized in
//   `warnings[]` and printed; they no longer decide process success.
//
//   This CORRECTS the historical behavior, where any finding at all — warning
//   included — exited 1. That made the exit code uninformative: check.mjs had to
//   ignore it and re-derive the verdict from `errors[]`, and every other caller
//   had to know the same folklore or be silently wrong. A gain-voicing advisory
//   is not a reason to refuse a tab.
//   `--warnings-as-errors` is the deliberate, opt-in way back to strictness: it
//   MOVES warnings into `errors[]`, which then legitimately drives exit 1.
//
// String numbering: alphaTab's note.string is INTERNAL (1 = low E). Every note
// is passed through fromAlphaTabNote() exactly once, at the walk site, to get
// SOURCE numbering (1 = high e). Nothing downstream touches note.string again.

import * as at from '@coderline/alphatab';
import * as fs from 'node:fs';
import { loadTex, midiToName, QUARTER_TICKS } from './lib/score-utils.mjs';
import {
  fromAlphaTabNote,
  spanOf,
  isPlayableVoicing,
  intervalsOf,
  STRING_COUNT,
} from './lib/fretboard.mjs';
import { auditTieIntents, collectTieChains } from './lib/ties.mjs'; // PTG §7
import { resolveConfig } from './lib/project-config.mjs';           // PTG Wave 1, C5
import { advisory } from './lib/advisory.mjs';                      // PTG Wave 0, C3
import {
  classifyPickDemand, pickDemandAdvisoryCode, subdivisionOf,
} from './lib/pick-demand.mjs'; // PTG Wave 1, C12

// ---- thresholds -----------------------------------------------------------
const G3 = 55;                       // ~G3: below this a 3rd muds under gain
const SUSTAIN_TICKS = 2 * QUARTER_TICKS; // "longer than ~2 beats"
const FAST_JUMP_FRETS = 5;           // position jump > this between fast notes
const SLOW_JUMP_FRETS = 6;   // PTG: hand-station shift > this between sub-16th beats warns
const HAMMER_MAX_FRETS = 4;          // hammer/pull reach on one string
const BEND_MAX_QUARTERS = 4;         // max bend depth (a whole step)
const WOUND_STRINGS = new Set([4, 5, 6]); // where palm muting lives

// PTG (Wave 1, contract C13): natural-harmonic nodes come in two grades, not one.
// A string's harmonic series has a node wherever the string divides into equal
// parts, so frets 4, 9, 16 and 24 (the major-3rd/2-octave-and-a-3rd nodes) DO
// ring — reference/guitar-playability.md rule 13 lists only 5/7/12/19 because
// those are the ones that speak reliably on any guitar, with any touch, under
// any gain. Calling fret 9 "impossible" was wrong; calling it "free" would be
// equally wrong, because it needs an accurate touch and a hot pickup.
const RELIABLE_NAT_HARMONIC_NODES = new Set([5, 7, 12, 19]);   // rule 13, unchanged
const EXTENDED_NAT_HARMONIC_NODES = new Set([4, 9, 16, 24]);   // ring, but weakly

// alphaTab enum handles (with literal fallbacks in case of version drift).
// PTG (Wave 1): these enums live under the `model` NAMESPACE
// (`at.model.HarmonicType`), not at the package top level — `at.HarmonicType` is
// `undefined` in @coderline/alphatab 1.5, so the pre-Wave-1 code was silently
// running on its literal fallbacks alone. The fallbacks happened to be correct;
// the defence was not defending anything. Both spellings are tried before the
// literal so the guard is real again.
const enumValue = (name, member, literal) =>
  at.model?.[name]?.[member] ?? at[name]?.[member] ?? literal;

const HARMONIC_NONE = enumValue('HarmonicType', 'None', 0);
const HARMONIC_NATURAL = enumValue('HarmonicType', 'Natural', 1);
// Every harmonic type that is NOT a natural harmonic. Observed in
// @coderline/alphatab 1.5: None 0, Natural 1, Artificial 2, Pinch 3, Tap 4,
// Semi 5, Feedback 6. An artificial/pinch/tap harmonic is produced by the
// RIGHT hand at a node the player picks relative to the fretted note, so the
// fretted fret number says nothing about whether a node exists there — the
// natural-node table simply does not apply (C13).
const NON_NATURAL_HARMONIC_TYPES = new Set([
  enumValue('HarmonicType', 'Artificial', 2),
  enumValue('HarmonicType', 'Pinch', 3),
  enumValue('HarmonicType', 'Tap', 4),
  enumValue('HarmonicType', 'Semi', 5),
  enumValue('HarmonicType', 'Feedback', 6),
]);
const SLIDE_NONE = enumValue('SlideOutType', 'None', 0);
const VIBRATO_NONE = enumValue('VibratoType', 'None', 0);
// BrushType is not re-exported at the top level of @coderline/alphatab, so we
// hold the literals. alphaTab stores BOTH brush (`{bd}`/`{bu}`) AND arpeggio
// (`{au}`/`{ad}`) effects on the SAME field `beat.brushType`:
//   0 None | 1 BrushUp | 2 BrushDown | 3 ArpeggioUp | 4 ArpeggioDown
// (Arpeggio effects also use a longer `brushDuration` ~480 vs brush ~120.)
// Any non-zero value is a single right-hand gesture that legally crosses all
// intervening strings — exempt from the non-adjacent-strings check below.
const BRUSH_NONE = 0;

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let gain = null;                 // PTG: null = "not set on the CLI" (policy may supply it)
  let policy = null;               // PTG §7
  let maxFret = null;              // PTG Wave 1 (C5): null = "not set on the CLI"
  let warningsAsErrors = false;    // PTG §7.3
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--gain') gain = argv[++i];
    else if (a.startsWith('--gain=')) gain = a.slice('--gain='.length);
    else if (a === '--policy') policy = argv[++i];
    else if (a.startsWith('--policy=')) policy = a.slice('--policy='.length);
    else if (a === '--max-fret') maxFret = argv[++i];               // PTG Wave 1
    else if (a.startsWith('--max-fret=')) maxFret = a.slice('--max-fret='.length);
    else if (a === '--warnings-as-errors') warningsAsErrors = true;
    else if (!a.startsWith('--')) file = a;
  }
  return { bars, gain, policy, maxFret, warningsAsErrors, file };
}

// PTG §7.1: load + fail-closed-validate a guitar-policy.json. Unknown keys are
// exit 2 (a typo like "maxfret" must never silently weaken the gate).
const POLICY_KEYS = new Set([
  'tuning', 'maxFret', 'gain', 'fastAttackMaxNotes', 'fastAttackThreshold',
  'maxSimultaneousNotes', 'allowRolls', 'allowBrushes', 'allowMutes',
  'preferredFretSpan',
]);
function loadPolicy(policyPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (e) {
    console.error(`Cannot read policy "${policyPath}": ${e.message}`);
    process.exit(2);
  }
  for (const k of Object.keys(parsed)) {
    if (!POLICY_KEYS.has(k)) {
      console.error(`Unknown policy key "${k}" in ${policyPath} (known: ${[...POLICY_KEYS].join(', ')})`);
      process.exit(2);
    }
  }
  if (parsed.tuning !== undefined && parsed.tuning !== 'standard') {
    console.error(`policy tuning "${parsed.tuning}" unsupported — this toolchain is standard-tuning-first`);
    process.exit(2);
  }
  for (const k of ['maxFret', 'fastAttackMaxNotes', 'maxSimultaneousNotes', 'preferredFretSpan']) {
    if (parsed[k] !== undefined && (!Number.isInteger(parsed[k]) || parsed[k] < 1)) {
      console.error(`policy ${k} must be a positive integer, got ${parsed[k]}`);
      process.exit(2);
    }
  }
  if (parsed.fastAttackThreshold !== undefined
    && (!Number.isFinite(parsed.fastAttackThreshold) || parsed.fastAttackThreshold <= 0)) {
    console.error(`policy fastAttackThreshold must be > 0 beats, got ${parsed.fastAttackThreshold}`);
    process.exit(2);
  }
  return parsed;
}

/** Parse "9-16" | "12" -> {lo, hi}, or null for "all bars". */
function parseBarRange(spec) {
  if (!spec) return null;
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
  bars, gain: gainArg, policy: policyPath, maxFret: maxFretArg, warningsAsErrors, file,
} = parseArgs(process.argv.slice(2));
if (!file) {
  console.error('Usage: node tools/playability.mjs <file.alphatab> [--bars N-M] '
    + '[--gain high|crunch|clean] [--policy guitar-policy.json] [--max-fret N] '
    + '[--warnings-as-errors]');
  process.exit(2);
}
// PTG: precedence — explicit --gain > policy.gain > the historical default.
const policy = policyPath ? loadPolicy(policyPath) : null;
const gain = gainArg ?? policy?.gain ?? 'high';
if (!['high', 'crunch', 'clean'].includes(gain)) {
  console.error(`Bad --gain "${gain}"; expected high|crunch|clean`);
  process.exit(2);
}

// ---- PTG (Wave 1, contract C5): instrument configuration --------------------
// This is the CLI BOUNDARY where configuration is resolved — once, here — so
// that lib/fretboard.mjs never reads a file and every geometry call downstream
// takes plain numbers. Precedence, identical everywhere in the toolchain:
//
//     --max-fret N  >  <dir of the tab>/…/config.json  >  built-in 22
//
// `config.json` is optional; a project without one behaves exactly as before.
//
// HOW THIS RELATES TO `--policy`'s OWN `maxFret` — they are different questions
// and BOTH stay in force:
//   • the resolved instrument maxFret (here) is a PHYSICAL fact about the
//     guitar. Exceeding it is `fret-range`, a hard error, because the fret does
//     not exist. It is the number lib/fretboard.mjs is handed.
//   • `policy.maxFret` is a PROJECT TEXTURE constraint — "on this arrangement I
//     do not want to go above fret 21" — checked separately as
//     `policy-max-fret`. It is normally stricter than the instrument, and it is
//     meaningful even on a 24-fret neck.
// A note above BOTH reports both findings. That is correct, not duplication:
// one says the fret is not there, the other says the project said not to.
if (maxFretArg !== null && !/^\d+$/.test(String(maxFretArg).trim())) {
  console.error(`Bad --max-fret "${maxFretArg}"; expected a positive integer`);
  process.exit(2);
}
const config = resolveConfig({
  anchorPath: file,
  cli: { maxFret: maxFretArg === null ? undefined : Number(maxFretArg) },
});
if (!config.ok) {
  // Fail closed, exit 2 — same doctrine as loadPolicy() above: a typo in a
  // config file must never silently weaken a gate.
  for (const e of config.errors) console.error(e);
  process.exit(2);
}
// Named apart from fretboard.mjs's `MAX_FRET`/`DEFAULT_MAX_FRET` on purpose:
// this is the value RESOLVED FOR THIS RUN, not the library's fallback.
const INSTRUMENT_MAX_FRET = config.instrument.maxFret;
const INSTRUMENT_STRING_COUNT = config.instrument.stringCount;
const range = parseBarRange(bars);
const inRange = (barNum1) => !range || (barNum1 >= range.lo && barNum1 <= range.hi);

// ---- load -----------------------------------------------------------------
const loaded = loadTex(file);
if (!loaded.ok) {
  console.log(JSON.stringify({ ok: false, file, gain, bars: bars ?? null, errors: loaded.errors, warnings: [] }, null, 2));
  process.exit(1);
}
const { score } = loaded;

const errors = [];
const warnings = [];
let beatsAnalyzed = 0;
let notesAnalyzed = 0;

function add(list, type, message, loc) {
  list.push({ type, message, ...loc });
}

/**
 * PTG (Wave 1): push a contract-C3 advisory into playability's NATIVE warning
 * channel.
 *
 * C3/C4 pin playability's `warnings[]` as `{type, message, bar, …}` and forbid
 * retro-fitting it — existing tests read `w.type`. But C3 also reserves the
 * `pick-demand.*` NAMESPACE for this file, and namespaced codes are the thing
 * `advisory()` validates. So the two are merged rather than chosen between: the
 * object carries `type` (native readers, check.mjs's `a.code ?? a.type`, and
 * --warnings-as-errors escalation) AND `code`/`severity`/`data` (C3 readers).
 * `type === code` always, so the two views can never drift apart.
 */
function addAdvisory(list, code, message, opts = {}) {
  const a = advisory(code, message, opts);
  list.push({ type: a.code, ...a });
}

// ---- PTG §7.2: tie integrity (always on) ------------------------------------
// alphaTab silently parses a tie-shaped token with no resolvable origin into a
// FRESH ATTACK — on a tab staff, an attack of the open string. The tab then
// plays a pitch its author never wrote. Model-vs-text audit catches it; a
// linked chain that changes pitch mid-flight (importer drift) is also fatal.
{
  const rawText = fs.readFileSync(file, 'utf8');
  const intent = auditTieIntents(rawText, score);
  if (intent.dropped > 0) {
    add(errors, 'tie-without-origin',
      `${intent.dropped} tie-shaped token(s) have no compatible origin and parsed as fresh ` +
      `attacks (${intent.textTieTokens} tie tokens vs ${intent.parsedTieDestinations} parsed ` +
      'tie destinations) — run tools/tab-events.mjs to see which notes actually attack.', {});
  }
  const { chains } = collectTieChains(score);
  for (const c of chains) {
    if (c.pitchChanged) {
      add(errors, 'tie-pitch-changed',
        `Bar ${c.startBar}: tie chain ${c.id} changes pitch mid-chain — a tied continuation ` +
        'must keep its pitch.', { bar: c.startBar });
    }
  }
}

// ---- helpers --------------------------------------------------------------
/** Max bend depth (quarter-steps) reached over a note's bend points. */
function maxBendQuarters(rawNote) {
  const pts = rawNote.bendPoints;
  if (!pts || !pts.length) return null;
  let max = 0;
  for (const p of pts) if (Number.isFinite(p.value)) max = Math.max(max, p.value);
  return max;
}

/** Does this beat carry a sustain aid (let-ring / tremolo pick / vibrato)? */
function hasSustainAid(beat) {
  if (beat.isLetRing || beat.isTremolo) return true;
  if (beat.vibrato !== undefined && beat.vibrato !== VIBRATO_NONE) return true;
  for (const n of beat.notes) {
    if (n.isLetRing) return true;
    if (n.vibrato !== undefined && n.vibrato !== VIBRATO_NONE) return true;
  }
  return false;
}

/** Does any note in this beat slide out to the next beat? */
function beatSlidesOut(beat) {
  return beat.notes.some((n) => (n.slideOutType ?? SLIDE_NONE) !== SLIDE_NONE);
}

/**
 * PTG (Wave 1, C12): the beat's duration value ADJUSTED FOR TUPLETS, which is
 * what the pick-demand table has to see.
 *
 * A 16th triplet is `duration 16` with a 3:2 tuplet — six attacks per beat, not
 * four. Handing the raw 16 to the classifier would file the reference's hardest
 * column ("16th triplets / 32nds") under 16ths. alphaTab reports -1/-1 for
 * `tupletNumerator`/`tupletDenominator` when no tuplet is in force, hence the
 * `> 0` guards rather than a null check.
 */
function effectiveDuration(beat) {
  const d = Number(beat.duration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const n = Number(beat.tupletNumerator);
  const den = Number(beat.tupletDenominator);
  if (Number.isFinite(n) && Number.isFinite(den) && n > 0 && den > 0) return d * (n / den);
  return d;
}

/**
 * PTG (Wave 1, C12): is this beat a GENUINE pick attack?
 *
 * "Genuine" excludes everything the picking hand does not have to strike:
 *   • rests — nothing is struck;
 *   • tied continuations — the note is already ringing (`note.isTieDestination`);
 *   • tremolo beats — one notated beat, one gesture, however many strokes;
 *   • legato destinations — the PREVIOUS beat hammered/pulled or slid into this
 *     one, so the left hand sounds it.
 * Each of those also BREAKS the run: a run is a count of consecutive strokes,
 * and anything the pick did not strike is a gap in it, not a member of it.
 */
function isPickAttack(cur, prev) {
  const { beat, notes } = cur;
  if (beat.isRest || !notes.length) return false;
  if (beat.isTremolo) return false;
  if (notes.every((n) => n.raw.isTieDestination)) return false;
  if (prev && !prev.beat.isRest) {
    const legatoInto = prev.notes.some((p) =>
      p.raw.isHammerPullOrigin || (p.raw.slideOutType ?? SLIDE_NONE) !== SLIDE_NONE);
    if (legatoInto) return false;
  }
  return true;
}

// NOTE on `classifyPickDemand`'s `articulation` parameter: this consumer always
// passes `'picked'`, and that is not a shortcut. `isPickAttack` has ALREADY
// removed every tremolo beat and every legato destination from the run, so by
// construction each beat still counted is one the pick struck. Downgrading the
// level for articulation on top of that would discount the same relief twice —
// a tremolo-picked 32nd passage simply never accumulates a run at all, which is
// exactly what the reference prescribes ("sustained 16ths above 160 BPM only as
// tremolo picking or with heavy legato"). The parameter exists for callers that
// classify a passage WITHOUT doing this per-beat exclusion (Wave 3's idiom
// engine, and pick-demand.test.mjs, which pins it).

// ---- walk -----------------------------------------------------------------
// Build an ordered beat sequence PER (track, staff, voice-index) so that
// consecutive-beat relationships (position jumps, hammer/pull targets, legato,
// pick runs) are analysed within a single continuous voice line.
for (let ti = 0; ti < score.tracks.length; ti++) {
  const track = score.tracks[ti];
  const multiTrack = score.tracks.length > 1;
  for (const staff of track.staves) {
    // PTG (Wave 1, C5): the STAFF's own tuning is the physical truth for this
    // staff (it is also what `fromAlphaTabNote` inverts against, so the two must
    // agree or every string number is mirrored). The resolved config supplies
    // the value only when the staff declares no tuning — a default, not an
    // override. `STRING_COUNT` remains the final fallback.
    const stringCount = staff.stringTuning?.tunings?.length
      || INSTRUMENT_STRING_COUNT || STRING_COUNT;
    const voiceCount = staff.bars.reduce((m, b) => Math.max(m, b.voices.length), 0);
    for (let vi = 0; vi < voiceCount; vi++) {
      const multiVoice = voiceCount > 1;
      let tempo = score.tempo || 120;
      const seq = [];
      for (const bar of staff.bars) {
        const auto = bar.masterBar?.tempoAutomation;
        if (auto && Number.isFinite(auto.value) && auto.value > 0) tempo = auto.value;
        const barNum = bar.index + 1;
        if (!inRange(barNum)) continue;
        const voice = bar.voices[vi];
        if (!voice) continue;
        for (const beat of voice.beats) {
          const notes = beat.isRest
            ? []
            : beat.notes.map((n) => ({ raw: n, ...fromAlphaTabNote(n, stringCount) }));
          seq.push({ beat, barNum, notes, tempo });
        }
      }

      analyzeSequence(seq, {
        multiTrack, multiVoice, trackIndex: ti, voiceIndex: vi, stringCount,
      });
    }
  }
}

function analyzeSequence(seq, ctx) {
  let gripStreak = 0;      // PTG §7.2: consecutive identical fast multi-note grips
  let prevGripKey = null;
  // PTG (Wave 1, C12): the current run of genuine pick attacks at ONE
  // subdivision. `warned` makes the advisory fire once PER RUN rather than once
  // per beat — a bar of 16ths would otherwise emit sixteen copies of the same
  // sentence, which is how a real finding gets scrolled past.
  let pickRun = { count: 0, subdivision: null, warned: false };
  // PTG (Wave 6): one `gain-voicing` finding per distinct low-third GRIP in this
  // sequence, not one per beat. Keyed by (root, third) midi pair.
  const gainVoicingSeen = new Map();
  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i];
    const { beat, barNum, notes } = cur;
    const loc = { bar: barNum };
    if (ctx.multiTrack) loc.track = ctx.trackIndex;
    if (ctx.multiVoice) loc.voice = ctx.voiceIndex;
    if (beat.index !== undefined) loc.beat = beat.index;

    if (!beat.isRest) beatsAnalyzed++;
    notesAnalyzed += notes.length;

    // ---- PTG §7.2: project-policy texture constraints ---------------------
    if (policy && !beat.isRest && notes.length >= 1) {
      const beatLen = beat.playbackDuration / QUARTER_TICKS;
      const fastThreshold = policy.fastAttackThreshold ?? 0.25;

      if (policy.fastAttackMaxNotes !== undefined
        && beatLen <= fastThreshold + 1e-6 && notes.length > policy.fastAttackMaxNotes) {
        add(errors, 'policy-fast-attack',
          `Bar ${barNum}: ${notes.length}-note attack at ${beatLen}-beat duration — policy allows ` +
          `at most ${policy.fastAttackMaxNotes} note(s) on attacks <= ${fastThreshold} beats.`, loc);
      }
      if (policy.maxSimultaneousNotes !== undefined && notes.length > policy.maxSimultaneousNotes) {
        add(errors, 'policy-max-simultaneous',
          `Bar ${barNum}: ${notes.length} simultaneous notes — policy caps attacks at ` +
          `${policy.maxSimultaneousNotes}.`, loc);
      }
      if (policy.maxFret !== undefined) {
        for (const n of notes) {
          if (n.fret > policy.maxFret) {
            add(errors, 'policy-max-fret',
              `Bar ${barNum}: fret ${n.fret} (string ${n.string}) exceeds the player's physical ` +
              `limit of ${policy.maxFret}.`, loc);
          }
        }
      }
      const brush = beat.brushType ?? BRUSH_NONE;
      if (policy.allowBrushes === false && (brush === 1 || brush === 2)) {
        add(errors, 'policy-brush', `Bar ${barNum}: brush effect — policy forbids brushes.`, loc);
      }
      if (policy.allowRolls === false && (brush === 3 || brush === 4)) {
        add(errors, 'policy-roll', `Bar ${barNum}: arpeggio/roll effect — policy forbids rolls.`, loc);
      }
      if (policy.allowMutes === false
        && notes.some((n) => n.raw.isPalmMute || n.raw.isDead)) {
        add(errors, 'policy-mute', `Bar ${barNum}: palm-muted or dead note — policy forbids mutes.`, loc);
      }
      if (policy.preferredFretSpan !== undefined && notes.length >= 2) {
        const span = spanOf(notes.map(({ string, fret }) => ({ string, fret })));
        if (span.frettedCount >= 2 && (span.maxFret - span.minFret) > policy.preferredFretSpan) {
          add(warnings, 'policy-fret-span',
            `Bar ${barNum}: voicing spans ${span.maxFret - span.minFret} frets — over the ` +
            `preferred ${policy.preferredFretSpan}.`, loc);
        }
      }

      // Rapid repeated grip: the same multi-note shape re-struck 3+ times in a
      // row at fast-attack pace is a strum pattern pretending to be a line.
      const gripKey = notes.length >= 2 && beatLen <= fastThreshold + 1e-6
        ? notes.map((n) => `${n.string}:${n.fret}`).sort().join('|')
        : null;
      if (gripKey !== null && gripKey === prevGripKey) {
        gripStreak++;
        if (gripStreak === 3) {
          add(errors, 'policy-rapid-grip',
            `Bar ${barNum}: the same ${notes.length}-note grip re-struck ${gripStreak}+ times at ` +
            `<= ${fastThreshold}-beat pace — policy forbids rapid repeated grips.`, loc);
        }
      } else {
        gripStreak = gripKey !== null ? 1 : 0;
      }
      prevGripKey = gripKey;
    }

    // ---- per-beat: voicing geometry (span / one-note-per-string / reach) --
    if (notes.length >= 1) {
      const positions = notes.map(({ string, fret }) => ({ string, fret }));
      // PTG (Wave 1, C5): the instrument's limits, resolved once at the CLI
      // boundary, travel in as plain opts. fretboard.mjs reads no files.
      const v = isPlayableVoicing(positions, {
        maxFret: INSTRUMENT_MAX_FRET,
        stringCount: ctx.stringCount,
      });
      for (const viol of v.violations) {
        const type = viol.rule === 'duplicate-string' ? 'two-notes-one-string'
          : viol.rule === 'span' ? 'chord-span'
          : viol.rule; // 'unreachable' | 'fret-range'
        add(errors, type, `Bar ${barNum}: ${viol.message}`, loc);
      }
    }

    // ---- per-beat: pick reachability (non-adjacent struck strings) -------
    // A single flatpick stroke can only sound ADJACENT strings (a double-stop)
    // or sweep ALL intervening strings in one brush/arpeggio gesture.
    // `notes[]` is already source-numbered (1 = high e). Exempt rests and any
    // beat carrying a brush/arpeggio effect (`beat.brushType !== 0`).
    //
    // PTG (Wave 1, contract C14): the finding is graded by SIMULTANEOUS NOTE
    // COUNT, because the two cases are different problems, not two sizes of one.
    //   • A DYAD is the textbook hybrid-picking grip — pick the low note, middle
    //     finger the high one. Rule 18 itself names hybrid picking as a legal
    //     realisation. It needs no re-voicing and no notation change, so failing
    //     the gate on it was a false hard failure: it told the arranger to
    //     rewrite playable music. It is now a WARNING — a thing to be aware of
    //     and to decide deliberately.
    //   • THREE OR MORE non-contiguous simultaneous notes stay an ERROR. That is
    //     not a grip a rock player throws inside a line; it needs a brush, a
    //     roll, or a re-voicing, and C6 lists it among the hard physical gates a
    //     style profile may never relax.
    if (!beat.isRest && notes.length >= 2 && (beat.brushType ?? BRUSH_NONE) === BRUSH_NONE) {
      const strings = [...new Set(notes.map((n) => n.string))].sort((a, b) => a - b);
      const contiguous = strings.length <= 1 ||
        (strings[strings.length - 1] - strings[0] + 1 === strings.length);
      if (!contiguous && notes.length === 2) {
        add(warnings, 'non-adjacent-dyad',
          `Bar ${barNum}: beat strikes non-adjacent strings ${strings.join(',')}. ` +
          `Non-adjacent dyad: hybrid picking or a roll may be required.`, loc);
      } else if (!contiguous) {
        add(errors, 'non-adjacent-strings',
          `beat strikes non-adjacent strings ${strings.join(',')} — unplayable with a flatpick; ` +
          `arpeggiate ({au}/{ad}), brush ({bd}/{bu}), or re-voice onto adjacent strings`, loc);
      }
    }

    // ---- per-beat: sustain (a guitar decays; a piano does not) -----------
    if (!beat.isRest && beat.playbackDuration > SUSTAIN_TICKS && !hasSustainAid(beat)) {
      const beats = (beat.playbackDuration / QUARTER_TICKS).toFixed(2);
      add(warnings, 'sustain',
        `Bar ${barNum}: note held ${beats} beats with no let-ring {lr}, tremolo {tp}, ` +
        `vibrato {v} or re-attack — a guitar note decays where a piano's sustain pedal holds. ` +
        `Add sustain or re-strike it.`, loc);
    }

    // ---- per-beat: gain-aware voicing (low 3rd under high gain) ----------
    // PTG (Wave 6 calibration): deduplicated per DISTINCT GRIP, the same way
    // pick-demand is deduplicated per run. A bar of repeated low-third chords is
    // ONE arranging decision, and emitting it once per beat produced eight
    // copies of one sentence on the metal-literal scenario fixture — which is
    // how a real finding gets scrolled past. The repeat count is kept in
    // `occurrences`, because "this happens eight times" is itself information;
    // it is just not eight findings.
    if (gain === 'high' && notes.length >= 2) {
      const midis = notes.map((n) => n.midi).filter((m) => Number.isFinite(m));
      if (midis.length >= 2) {
        const root = Math.min(...midis);
        const third = midis.find((m) => m !== root && (((m - root) % 12) + 12) % 12 !== 0 &&
          ([3, 4].includes((((m - root) % 12) + 12) % 12)));
        if (root < G3 && third !== undefined) {
          const key = `${root}:${third}`;
          const prior = gainVoicingSeen.get(key);
          if (prior) {
            prior.occurrences++;
          } else {
            const quality = ((((third - root) % 12) + 12) % 12) === 4 ? 'major' : 'minor';
            add(warnings, 'gain-voicing',
              `Bar ${barNum}: ${quality} 3rd (${midiToName(root)} + ${midiToName(third)}) over a root ` +
              `below G3 under high gain. Distortion is a nonlinear transfer function: it generates ` +
              `intermodulation (sum & difference) tones. A 3rd (5:4 / 6:5) yields dense dissonant ` +
              `products that read as mud, worsening as pitch drops — this is why rock uses power chords. ` +
              `Move the 3rd up an octave or drop it (root + 5th).`, loc);
            const emitted = warnings[warnings.length - 1];
            emitted.occurrences = 1;
            gainVoicingSeen.set(key, emitted);
          }
        }
      }
    }

    // ---- per-note effects: bends / palm mute / harmonics -----------------
    for (const n of notes) {
      const raw = n.raw;

      // Bends: strings 1-3 only, fret >= 5, <= 4 quarter-steps.
      if (raw.hasBend) {
        if (n.string > 3) {
          add(errors, 'bend-string',
            `Bar ${barNum}: bend on string ${n.string} — only the plain strings 1-3 bend in tune.`, loc);
        }
        if (n.fret < 5) {
          add(errors, 'bend-fret',
            `Bar ${barNum}: bend at fret ${n.fret} (string ${n.string}) — bends want fret >= 5 for string tension.`, loc);
        }
        const depth = maxBendQuarters(raw);
        if (depth !== null && depth > BEND_MAX_QUARTERS) {
          add(errors, 'bend-depth',
            `Bar ${barNum}: bend of ${depth} quarter-steps (string ${n.string}) exceeds a whole step (4).`, loc);
        }
      }

      // Palm mute lives on the wound strings (4-6).
      if (raw.isPalmMute && !WOUND_STRINGS.has(n.string)) {
        add(errors, 'palm-mute-string',
          `Bar ${barNum}: palm mute on string ${n.string} — {pm} responds on the wound strings (4-6), not the plain strings.`, loc);
      }

      // Natural harmonics (PTG Wave 1, contract C13).
      //
      // The node table applies to NATURAL harmonics ONLY. An artificial, pinch,
      // tapped, semi or feedback harmonic is produced by the RIGHT hand, at a
      // node measured from the FRETTED note — the written fret number carries no
      // information about whether a natural node lives there, so validating it
      // against the natural-node table was simply asking the wrong question and
      // failing correct notation (`3.1{ah}` is an everyday artificial harmonic).
      // `HARMONIC_NONE` beats out early: it is by far the common case.
      const ht = raw.harmonicType ?? HARMONIC_NONE;
      if (ht !== HARMONIC_NONE && !NON_NATURAL_HARMONIC_TYPES.has(ht) && ht === HARMONIC_NATURAL) {
        if (RELIABLE_NAT_HARMONIC_NODES.has(n.fret)) {
          // Rule 13's four nodes — speak on any guitar, any touch. No finding.
        } else if (EXTENDED_NAT_HARMONIC_NODES.has(n.fret)) {
          add(warnings, 'harmonic-node-extended',
            `Bar ${barNum}: natural harmonic at fret ${n.fret} (string ${n.string}) — a real node, ` +
            `but an EXTENDED one (frets ${[...EXTENDED_NAT_HARMONIC_NODES].join(', ')}). It rings ` +
            `weakly: it needs an accurate touch and a hot pickup, and it may not speak at low gain. ` +
            `The reliable nodes are frets ${[...RELIABLE_NAT_HARMONIC_NODES].join(', ')}.`, loc);
        } else {
          add(errors, 'harmonic-node',
            `Bar ${barNum}: natural harmonic at fret ${n.fret} (string ${n.string}) — nodes exist only at frets 5, 7, 12, 19.`, loc);
        }
      }
    }

    // ---- pair checks: position jump & hammer/pull span -------------------
    const next = seq[i + 1];
    if (next) {
      // Position jump > 5 frets between consecutive fast (16th+) notes with no slide.
      const curDur = beat.duration;
      const nextDur = next.beat.duration;
      if (curDur >= 16 && nextDur >= 16 && !next.beat.isRest) {
        const a = spanOf(notes.map(({ string, fret }) => ({ string, fret })));
        const b = spanOf(next.notes.map(({ string, fret }) => ({ string, fret })));
        if (a.frettedCount > 0 && b.frettedCount > 0) {
          const jump = Math.abs(b.minFret - a.minFret);
          if (jump > FAST_JUMP_FRETS && !beatSlidesOut(beat)) {
            add(errors, 'position-jump',
              `Bar ${barNum}: position jump of ${jump} frets (fret ${a.minFret} -> ${b.minFret}) ` +
              `between consecutive 16th notes with no slide {sl} — unplayable at speed.`, loc);
          }
        }
      }

      // PTG: slow-pace hand-station jump (pedal-vs-stab). The fast check above only
      // covers 16th+; this covers eighth/quarter pace, which forces the same big
      // shift with more time but still a full hand reposition. WARNING only — never gates.
      if (beat.duration < 16 && next.beat.duration < 16 && !next.beat.isRest) {
        const a = spanOf(notes.map(({ string, fret }) => ({ string, fret })));
        const b = spanOf(next.notes.map(({ string, fret }) => ({ string, fret })));
        if (a.frettedCount > 0 && b.frettedCount > 0) {
          const jump = Math.abs(b.minFret - a.minFret);
          const legato = beatSlidesOut(beat) || notes.some((n) => n.raw.isHammerPullOrigin);
          if (jump > SLOW_JUMP_FRETS && !legato) {
            add(warnings, 'position-jump-slow',
              `Bar ${barNum}: slow position jump of ${jump} frets (fret ${a.minFret} -> ${b.minFret}) ` +
              `between consecutive beats slower than a 16th — a hand-station shift this large at ` +
              `eighth-note pace (pedal-vs-stab) forces a big reposition; anchor one hand station, ` +
              `use an open string, or slide {sl}.`, loc);
          }
        }
      }

      // Hammer/pull reach: origin -> same-string note in the next beat, <= 4 frets.
      for (const n of notes) {
        if (!n.raw.isHammerPullOrigin) continue;
        const dest = next.notes.find((d) => d.string === n.string);
        if (!dest) continue;
        const reach = Math.abs(dest.fret - n.fret);
        if (reach > HAMMER_MAX_FRETS) {
          add(errors, 'hammer-pull-span',
            `Bar ${barNum}: hammer/pull of ${reach} frets on string ${n.string} ` +
            `(fret ${n.fret} -> ${dest.fret}) — legato reach is ~4 frets.`, loc);
        }
      }
    }

    // ---- pick demand (PTG Wave 1, contract C12) ---------------------------
    // Replaces the invented `PICK_CEILING_NPS = 16` with the reference's own
    // "Tempo × subdivision ceiling" table, encoded in lib/pick-demand.mjs.
    //
    // Two independent facts decide the finding, which is why the old single
    // notes-per-second scalar could not express it:
    //   (a) STROKE RATE — tempo × subdivision, straight off the table;
    //   (b) HOW LONG IT LASTS — the reference gives a fast run a <= 2-beat
    //       budget before a breath. That is what `sustained` measures, and it is
    //       why the run counter lives here (in the sequence walk) rather than in
    //       the classifier: only the walk knows which beats the pick struck.
    //
    // PICK DEMAND NEVER FAILS THE GATE (C12). Everything below lands in
    // `warnings[]`, and `--warnings-as-errors` remains the only route to
    // errors[] — an explicit, opt-in choice by the caller.
    {
      const prev = seq[i - 1];
      const dur = effectiveDuration(beat);
      if (!isPickAttack(cur, prev) || dur <= 0) {
        // A non-attack (rest, tie continuation, tremolo, legato destination)
        // BREAKS the run — it is a gap in the picking, not a member of it.
        pickRun = { count: 0, subdivision: null, warned: false };
      } else {
        const subdivision = subdivisionOf(dur);
        if (subdivision !== pickRun.subdivision) {
          // A change of subdivision starts a new run: the table is indexed by
          // one subdivision, so a mixed count would describe no real passage.
          pickRun = { count: 1, subdivision, warned: false };
        } else {
          pickRun.count++;
        }
        const demand = classifyPickDemand({
          tempo: cur.tempo,
          duration: dur,
          consecutiveAttacks: pickRun.count,
          articulation: 'picked',   // see the note above analyzeSequence
        });
        const code = pickDemandAdvisoryCode(demand);
        if (code && !pickRun.warned) {
          pickRun.warned = true;
          const nth = demand.subdivision === '32nd' ? '32nd-note / 16th-triplet' : `${demand.subdivision}-note`;
          addAdvisory(warnings, code,
            `Bar ${barNum}: ${demand.consecutiveAttacks} consecutive picked ${nth} attacks at ` +
            `${Math.round(demand.tempo)} BPM — the tempo x subdivision table rates this ` +
            `"${demand.level}"` +
            (demand.sustained
              ? `, and the run is ${demand.runBeats.toFixed(2)} beats long, past the ~2-beat burst a `
                + `fast run gets before a breath. `
              : `. `) +
            `Break it with a rest or a longer note, or realise it as tremolo picking {tp} or legato {h}.`,
            {
              // `loc` carries bar/track/beat; advisory() copies only its known
              // location keys, so `voice` rides along in `data` instead of being
              // silently dropped.
              ...loc,
              data: {
                level: demand.level,
                tempo: demand.tempo,
                subdivision: demand.subdivision,
                consecutiveAttacks: demand.consecutiveAttacks,
                sustained: demand.sustained,
                runBeats: Number(demand.runBeats.toFixed(4)),
                ...(loc.voice !== undefined ? { voice: loc.voice } : {}),
              },
            });
        }
      }
    }
  }
}

// ---- output ---------------------------------------------------------------
// PTG §7.3: --warnings-as-errors escalates every soft advisory. check.mjs
// gates on errors[] only, so this is how an automatic approval policy demands
// a ZERO-warning tab.
if (warningsAsErrors && warnings.length) {
  for (const w of warnings) errors.push({ ...w, escalatedFromWarning: true });
  warnings.length = 0;
}
// PTG (Wave 1, contract C7): `ok` — and the exit code below — mean
// "no HARD gate failed", i.e. `errors.length === 0`. Warnings are reported, not
// fatal. Before Wave 1 this line also required `warnings.length === 0`, which
// made a tone advisory indistinguishable from a physical impossibility at the
// process boundary and forced every caller to re-derive the verdict from the
// JSON. `--warnings-as-errors` (just above) is the opt-in route back: it MOVES
// warnings into errors[], so strictness is requested rather than assumed.
const ok = errors.length === 0;
const out = {
  ok,
  file,
  gain,
  bars: bars ?? null,
  policy: policyPath ?? null,
  // PTG (Wave 1, C5): the resolved instrument + where each value came from, so
  // "why was fret 23 rejected?" is answerable from the JSON alone.
  instrument: config.instrument,
  configPath: config.configPath,
  configSources: config.sources,
  warningsAsErrors,
  stats: {
    tracks: score.tracks.length,
    bars: score.masterBars.length,
    beatsAnalyzed,
    notesAnalyzed,
    errorCount: errors.length,
    warningCount: warnings.length,
  },
  errors,
  warnings,
};
console.log(JSON.stringify(out, null, 2));
process.exit(ok ? 0 : 1);

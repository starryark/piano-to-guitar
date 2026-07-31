// Vendored from abc-to-guitar@ba7e29c — tools/playability.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// playability.mjs — mechanical + gain-aware playability lints for a guitar tab.
//
// Usage:
//   node tools/playability.mjs tabs/x.alphatab [--bars 9-16] [--gain high|crunch|clean]
//        [--policy guitar-policy.json] [--warnings-as-errors]
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
// PICK REACHABILITY IS CHECKED HERE: a struck beat with >=2 notes on
// non-adjacent strings and no brush/arpeggio effect fails with the
// `non-adjacent-strings` error. A flatpick cannot isolate two non-adjacent
// strings in a single stroke; the arranger must brush (`{bd}`/`{bu}`), roll
// (`{au}`/`{ad}`), or re-voice onto adjacent strings. The musical doctrine
// behind the check is in reference/guitar-playability.md → "Pick reachability
// across strings" (rules 17–19).
//
// Output: JSON to stdout, same shape as validate.mjs
//   { ok, file, gain, bars, stats, errors, warnings }
//
// EXIT / `ok` SEMANTICS — deliberate divergence from validate.mjs:
//   This tool is strict by nature (it is the guitar-feasibility gate). ANY
//   finding — error OR warning — fails the gate: `ok` is true only when both
//   arrays are empty, and the process exits 1 on any finding, 0 when clean.
//   That is why the low-third-high-gain fixture (a "warning") still exits 1.
//   validate.mjs, by contrast, needs --strict to make warnings fatal.
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

// ---- thresholds -----------------------------------------------------------
const G3 = 55;                       // ~G3: below this a 3rd muds under gain
const SUSTAIN_TICKS = 2 * QUARTER_TICKS; // "longer than ~2 beats"
const PICK_CEILING_NPS = 16;         // sustained single-picking ceiling, notes/sec
const FAST_JUMP_FRETS = 5;           // position jump > this between fast notes
const SLOW_JUMP_FRETS = 6;   // PTG: hand-station shift > this between sub-16th beats warns
const HAMMER_MAX_FRETS = 4;          // hammer/pull reach on one string
const BEND_MAX_QUARTERS = 4;         // max bend depth (a whole step)
const NAT_HARMONIC_NODES = new Set([5, 7, 12, 19]);
const WOUND_STRINGS = new Set([4, 5, 6]); // where palm muting lives

// alphaTab enum handles (with literal fallbacks in case of version drift).
const HARMONIC_NATURAL = at.HarmonicType?.Natural ?? 1;
const SLIDE_NONE = at.SlideOutType?.None ?? 0;
const VIBRATO_NONE = at.VibratoType?.None ?? 0;
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
    else if (a === '--warnings-as-errors') warningsAsErrors = true;
    else if (!a.startsWith('--')) file = a;
  }
  return { bars, gain, policy, warningsAsErrors, file };
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

const { bars, gain: gainArg, policy: policyPath, warningsAsErrors, file } = parseArgs(process.argv.slice(2));
if (!file) {
  console.error('Usage: node tools/playability.mjs <file.alphatab> [--bars N-M] '
    + '[--gain high|crunch|clean] [--policy guitar-policy.json] [--warnings-as-errors]');
  process.exit(2);
}
// PTG: precedence — explicit --gain > policy.gain > the historical default.
const policy = policyPath ? loadPolicy(policyPath) : null;
const gain = gainArg ?? policy?.gain ?? 'high';
if (!['high', 'crunch', 'clean'].includes(gain)) {
  console.error(`Bad --gain "${gain}"; expected high|crunch|clean`);
  process.exit(2);
}
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

/** Notes-per-second implied by one beat's subdivision at a tempo. */
function notesPerSecond(durationValue, tempoBpm) {
  // duration 4 = quarter = 1 beat; nps = (duration/4) * (tempo/60).
  return (durationValue / 4) * (tempoBpm / 60);
}

// ---- walk -----------------------------------------------------------------
// Build an ordered beat sequence PER (track, staff, voice-index) so that
// consecutive-beat relationships (position jumps, hammer/pull targets, legato,
// pick runs) are analysed within a single continuous voice line.
for (let ti = 0; ti < score.tracks.length; ti++) {
  const track = score.tracks[ti];
  const multiTrack = score.tracks.length > 1;
  for (const staff of track.staves) {
    const stringCount = staff.stringTuning?.tunings?.length || STRING_COUNT;
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

      analyzeSequence(seq, { multiTrack, multiVoice, trackIndex: ti, voiceIndex: vi });
    }
  }
}

function analyzeSequence(seq, ctx) {
  let gripStreak = 0;      // PTG §7.2: consecutive identical fast multi-note grips
  let prevGripKey = null;
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
      const v = isPlayableVoicing(positions);
      for (const viol of v.violations) {
        const type = viol.rule === 'duplicate-string' ? 'two-notes-one-string'
          : viol.rule === 'span' ? 'chord-span'
          : viol.rule; // 'unreachable' | 'fret-range'
        add(errors, type, `Bar ${barNum}: ${viol.message}`, loc);
      }
    }

    // ---- per-beat: pick reachability (non-adjacent struck strings) -------
    // A single flatpick stroke can only sound ADJACENT strings (a double-stop)
    // or sweep ALL intervening strings in one brush/arpeggio gesture. A struck
    // dyad or chord on non-adjacent strings with no brush/arpeggio effect is
    // unplayable with a plectrum — realise it as hybrid picking or a roll.
    // `notes[]` is already source-numbered (1 = high e). Exempt rests and any
    // beat carrying a brush/arpeggio effect (`beat.brushType !== 0`).
    if (!beat.isRest && notes.length >= 2 && (beat.brushType ?? BRUSH_NONE) === BRUSH_NONE) {
      const strings = [...new Set(notes.map((n) => n.string))].sort((a, b) => a - b);
      const contiguous = strings.length <= 1 ||
        (strings[strings.length - 1] - strings[0] + 1 === strings.length);
      if (!contiguous) {
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
    if (gain === 'high' && notes.length >= 2) {
      const midis = notes.map((n) => n.midi).filter((m) => Number.isFinite(m));
      if (midis.length >= 2) {
        const root = Math.min(...midis);
        const third = midis.find((m) => m !== root && (((m - root) % 12) + 12) % 12 !== 0 &&
          ([3, 4].includes((((m - root) % 12) + 12) % 12)));
        if (root < G3 && third !== undefined) {
          const quality = ((((third - root) % 12) + 12) % 12) === 4 ? 'major' : 'minor';
          add(warnings, 'gain-voicing',
            `Bar ${barNum}: ${quality} 3rd (${midiToName(root)} + ${midiToName(third)}) over a root ` +
            `below G3 under high gain. Distortion is a nonlinear transfer function: it generates ` +
            `intermodulation (sum & difference) tones. A 3rd (5:4 / 6:5) yields dense dissonant ` +
            `products that read as mud, worsening as pitch drops — this is why rock uses power chords. ` +
            `Move the 3rd up an octave or drop it (root + 5th).`, loc);
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

      // Natural harmonics only at frets 5 / 7 / 12 / 19.
      if ((raw.harmonicType ?? 0) === HARMONIC_NATURAL && !NAT_HARMONIC_NODES.has(n.fret)) {
        add(errors, 'harmonic-node',
          `Bar ${barNum}: natural harmonic at fret ${n.fret} (string ${n.string}) — nodes exist only at frets 5, 7, 12, 19.`, loc);
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

    // ---- pick-speed ceiling ----------------------------------------------
    // Only genuine pick attacks count: rests, tremolo-picked beats, and legato
    // destinations (previous beat hammered or slid into this one) are exempt.
    if (!beat.isRest && !beat.isTremolo) {
      const prev = seq[i - 1];
      const legatoInto = prev && !prev.beat.isRest &&
        prev.notes.some((p) => p.raw.isHammerPullOrigin || (p.raw.slideOutType ?? SLIDE_NONE) !== SLIDE_NONE);
      if (!legatoInto) {
        const nps = notesPerSecond(beat.duration, cur.tempo);
        if (nps > PICK_CEILING_NPS) {
          add(warnings, 'pick-speed',
            `Bar ${barNum}: ~${nps.toFixed(1)} notes/sec (1/${beat.duration}-notes at ${Math.round(cur.tempo)} BPM) ` +
            `exceeds the sustained single-picking ceiling (~${PICK_CEILING_NPS}/sec) — use legato or tremolo picking.`, loc);
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
const ok = errors.length === 0 && warnings.length === 0;
const out = {
  ok,
  file,
  gain,
  bars: bars ?? null,
  policy: policyPath ?? null,
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

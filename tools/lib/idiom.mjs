// tools/lib/idiom.mjs — does this arrangement BEHAVE like guitar music?
// PTG-native (Wave 3). Contract C3 (advisory shape) + C6 (style profile) +
// §A3 of docs/specs/wave3-6-addendum.md (the event model and every denominator)
// own this surface; this file implements it and may not redefine it.
//
// WHAT THIS ANSWERS, AND WHAT IT REFUSES TO ANSWER
// ------------------------------------------------
// It answers: "how much of what this passage does is recognisably guitar
// writing, judged by the style the arranger chose?" It does NOT answer "is this
// good", and it never gates. Implement.md §3.2 is the governing constraint and
// it is a negative one: a clean jazz ballad must not be penalised for lacking
// palm muting, a blues shuffle need not resemble metal, and block chords are
// idiomatic in the right context. So every stylistic opinion lives in the
// PROFILE, and this module only measures. A feature with weight 0 in a profile
// cannot move that style's score in either direction — that is the mechanism by
// which "metal techniques are not universal" is a fact about the code rather
// than a promise in a comment.
//
// THE THREE FAILURE MODES THIS FILE IS SHAPED AROUND
// --------------------------------------------------
// 1. NO MEASUREMENT READ AS A ZERO MEASUREMENT. A single-note lead line has no
//    multi-note attacks, so "what fraction of its grips are power chords?" has
//    no answer — not the answer "none". Every feature therefore carries an
//    explicit denominator and a `measured` flag, an unmeasured feature is
//    dropped from BOTH sides of the weighted ratio, and a span with too little
//    evidence gets `score: null` instead of a confident 0. §A3.
// 2. A SUSTAIN COUNTED AS REPETITION. A tie destination is not an attack. One
//    whole note held across four bars is one event, not four, and the palm-mute
//    / pedal / riff-cell run detectors all walk ATTACKS, never beats.
// 3. VOICES AND TRACKS SILENTLY MERGED. Runs are detected per
//    (track, staff, voice) stream. The last note of voice 0 never links to the
//    first note of voice 1, and a two-guitar score never grows a phantom riff
//    out of two independent parts.
//
// PARSED MODEL ONLY. Every feature reads the alphaTab score object — never the
// AlphaTex text (C1). Staff selection copies `fingering.mjs`'s hard-won rule: a
// staff with no `stringTuning` is a piano/score staff whose notes have no
// string or fret at all, and is skipped WITH A REASON rather than guessed at.
//
// Pure ESM, node builtins + the one runtime dependency. No side effects at import.

import { QUARTER_TICKS } from './score-utils.mjs';
import { STRING_COUNT, fromAlphaTabNote } from './fretboard.mjs';
import { advisory } from './advisory.mjs';

// ---------------------------------------------------------------------------
// Tunable structural constants (NOT style policy — these are what the WORDS
// mean, not how much a genre likes them. Style opinion lives in the profile.)
// ---------------------------------------------------------------------------

/** A palm-muted "repetition" needs at least this many consecutive muted attacks.
 *  Two muted notes are an accent; three are a texture. */
export const PALM_MUTE_RUN_MIN = 3;

/** A pedal figure needs at least this many attacks to be a figure rather than a
 *  coincidence, and the pedal must recur at least twice inside it. */
export const PEDAL_RUN_MIN_EVENTS = 4;
export const PEDAL_MIN_HITS = 2;
/** How many consecutive non-pedal attacks may sit between two pedal hits before
 *  the figure has stopped being a pedal. `E5 x E5 y y E5` still reads as one. */
export const PEDAL_MAX_GAP = 2;

/** Riff cells are compared as fixed-length windows of consecutive attacks. Four
 *  is the shortest window that carries a rhythm AND a contour; shorter windows
 *  match everything, longer ones match nothing on real writing. */
export const RIFF_CELL_EVENTS = 4;
/** Two attacks further apart than this are not in the same cell. Unlike the
 *  palm-mute and pedal detectors, riff cells do NOT break at a rest: a rest is
 *  part of a rhythmic figure, and a comping pattern of `chord, rest, chord` is
 *  one cell, not three fragments. The gap bound is what keeps a "cell" from
 *  stitching itself across four bars of silence. */
export const RIFF_CELL_MAX_GAP_BEATS = 4;

/** Attacks shorter than a quarter note count toward rhythmic fragmentation. */
export const FRAGMENT_MAX_BEATS = 1;

/** A power chord's fifth lives within two octaves of its root. Beyond that the
 *  interval is arithmetic, not a grip. */
export const POWER_CHORD_MAX_SPAN = 24;

/** The 0..10 display scale the profile's `warnBelow` is expressed in (§A3). */
export const SCORE_SCALE = 10;

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// alphaTab enum access, defensively (same idiom as fingering.mjs)
// ---------------------------------------------------------------------------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isSet = (v) => Number(v ?? 0) !== 0;

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

/**
 * One (track, staff, voice) stream of ATTACK events, in tick order.
 *
 * `items` carries rests and tie-only continuations too, because a run detector
 * needs to know where the line BREAKS: three palm-muted attacks either side of a
 * rest are two gestures, not one run of six.
 */
function emptyStream(track, staff, voice) {
  return { track, staff, voice, items: [], attacks: [] };
}

/**
 * Walk the parsed score into per-stream attack events.
 *
 * @param {object} score alphaTab Score.
 * @param {object} [opts]
 * @param {{lo:number,hi:number}|null} [opts.range] 1-based inclusive bar range.
 * @param {number[]|null} [opts.trackIndices] Restrict to these tracks (Wave 5
 *        passes declared roles here; null = every guitar track).
 * @returns {{ streams: object[], skippedStaves: object[], droppedNotes: number,
 *             graceSkipped: number, bars: {lo:number,hi:number}|null }}
 */
export function extractIdiomEvents(score, opts = {}) {
  const range = opts.range ?? null;
  const trackIndices = Array.isArray(opts.trackIndices) ? new Set(opts.trackIndices) : null;
  const inRange = (barNum) => !range || (barNum >= range.lo && barNum <= range.hi);

  const streams = [];
  const skippedStaves = [];
  let droppedNotes = 0;
  let graceSkipped = 0;
  let barLo = null;
  let barHi = null;

  for (let ti = 0; ti < score.tracks.length; ti++) {
    if (trackIndices && !trackIndices.has(ti)) continue;
    const track = score.tracks[ti];
    for (let si = 0; si < track.staves.length; si++) {
      const staff = track.staves[si];
      // THE staff gate, copied verbatim in spirit from fingering.mjs. A
      // `\staff { score }` (every piano source in this repo) reports no string
      // tuning and its notes come back `string:-1, fret:-1`. Analysing it as a
      // guitar produced confident nonsense there and would produce confident
      // nonsense here — an "idiom score" for a piano part is not a low score,
      // it is not a score.
      const tunings = staff.stringTuning?.tunings ?? [];
      if (tunings.length === 0) {
        skippedStaves.push({
          track: ti,
          staff: si,
          stringCount: 0,
          reason: 'not a fretted staff (no string tuning) — it has no grips to recognise',
        });
        continue;
      }
      if (tunings.length !== STRING_COUNT) {
        skippedStaves.push({
          track: ti, staff: si, stringCount: tunings.length, reason: 'non-standard string count',
        });
        continue;
      }
      const stringCount = tunings.length;
      const voiceCount = staff.bars.reduce((m, b) => Math.max(m, b.voices.length), 0);

      for (let vi = 0; vi < voiceCount; vi++) {
        const stream = emptyStream(ti, si, vi);
        let tempo = score.tempo || 120;
        let runningBarStart = 0;

        for (const bar of staff.bars) {
          const master = bar.masterBar;
          const auto = master?.tempoAutomation;
          if (auto && Number.isFinite(auto.value) && auto.value > 0) tempo = auto.value;
          const barNum = bar.index + 1;
          const tsNum = master?.timeSignatureNumerator ?? 4;
          const tsDen = master?.timeSignatureDenominator ?? 4;
          const barTicks = tsNum * (4 / tsDen) * QUARTER_TICKS;
          // `masterBar.start` is the absolute tick of the bar; when a build does
          // not populate it we accumulate instead. Either way `tickInBar` — the
          // only number the metrical grid needs — is exact.
          const barStart = num(master?.start) ?? runningBarStart;
          runningBarStart = barStart + barTicks;

          if (!inRange(barNum)) continue;
          barLo = barLo === null ? barNum : Math.min(barLo, barNum);
          barHi = barHi === null ? barNum : Math.max(barHi, barNum);

          const voice = bar.voices[vi];
          if (!voice) continue;

          for (const beat of voice.beats) {
            const durationBeats = beat.playbackDuration / QUARTER_TICKS;
            const absTick = num(beat.playbackStart);
            const tickInBar = absTick === null ? 0 : absTick - barStart;
            const base = {
              track: ti,
              staff: si,
              voice: vi,
              bar: barNum,
              tick: absTick ?? barStart,
              tickInBar,
              beatIndex: beat.index,
              durationBeats,
              durationValue: Number(beat.duration) || 0,
              tempo,
              beatUnitTicks: (4 / tsDen) * QUARTER_TICKS,
              barTicks,
            };

            if (beat.isRest || !beat.notes?.length) {
              stream.items.push({ ...base, kind: 'rest', notes: [] });
              continue;
            }
            // A grace note is an ornament, not a riff event (§A3): counting one
            // as a full attack would inflate fragmentation and pull every ratio
            // toward the ornament rather than the line.
            if (isSet(beat.graceType)) {
              graceSkipped++;
              continue;
            }

            const notes = [];
            let anyTieDest = false;
            for (const raw of beat.notes) {
              if (!Number.isInteger(raw.string) || raw.string < 1 || raw.string > stringCount
                || !Number.isInteger(raw.fret) || raw.fret < 0) {
                droppedNotes++;
                continue;
              }
              const pos = fromAlphaTabNote(raw, stringCount);
              if (!Number.isFinite(pos.midi)) { droppedNotes++; continue; }
              const tieDestination = !!raw.isTieDestination;
              if (tieDestination) anyTieDest = true;
              notes.push({
                string: pos.string,
                fret: pos.fret,
                midi: pos.midi,
                tieDestination,
                tieOrigin: !!raw.isTieOrigin,
                palmMute: !!raw.isPalmMute,
                bend: !!raw.hasBend,
                slide: isSet(raw.slideOutType) || isSet(raw.slideInType),
                vibrato: isSet(raw.vibrato) || isSet(beat.vibrato),
                legato: !!raw.isHammerPullOrigin || !!raw.isHammerPullDestination,
                letRing: !!raw.isLetRing || !!beat.isLetRing,
                dead: !!raw.isDead,
                harmonic: isSet(raw.harmonicType),
              });
            }
            if (!notes.length) {
              stream.items.push({ ...base, kind: 'rest', notes: [] });
              continue;
            }

            // §A3: the grip is the set of NEWLY ATTACKED notes. A beat that is
            // nothing but tie destinations is a continuation — neither an attack
            // nor a rest, and it BREAKS an attack run (the line is holding, not
            // repeating).
            const attacked = notes.filter((n) => !n.tieDestination);
            if (!attacked.length) {
              stream.items.push({ ...base, kind: 'hold', notes, attacked: [] });
              continue;
            }

            const item = {
              ...base,
              kind: 'attack',
              notes,
              attacked,
              hadTieDestination: anyTieDest,
              brushed: isSet(beat.brushType),
              midis: attacked.map((n) => n.midi).sort((a, b) => a - b),
            };
            stream.items.push(item);
            stream.attacks.push(item);
          }
        }

        if (stream.items.length) streams.push(stream);
      }
    }
  }

  // Determinism (§A6): streams by (track, staff, voice); items already in tick
  // order per stream because the walk is.
  streams.sort((a, b) => (a.track - b.track) || (a.staff - b.staff) || (a.voice - b.voice));
  for (const s of streams) {
    s.items.sort((a, b) => (a.bar - b.bar) || (a.tick - b.tick) || (a.beatIndex - b.beatIndex));
    s.attacks = s.items.filter((i) => i.kind === 'attack');
  }

  return {
    streams,
    skippedStaves,
    droppedNotes,
    graceSkipped,
    bars: barLo === null ? null : { lo: barLo, hi: barHi },
  };
}

// ---------------------------------------------------------------------------
// Grip classification
// ---------------------------------------------------------------------------

/** Intervals of a grip above its own lowest note, in semitones mod 12. */
function intervalSet(midis) {
  const low = midis[0];
  return new Set(midis.map((m) => ((m - low) % 12 + 12) % 12));
}

/**
 * Root + fifth (+ optional octave), no third — the shape that renders BOTH
 * major and minor correctly, which is why AGENTS.md insists a missing 3rd is
 * never a miss.
 *
 * The `POWER_CHORD_MAX_SPAN` guard is what separates a grip from an arithmetic
 * coincidence: a bass note and a fifth three octaves above it are not a power
 * chord, they are two notes that happen to be seven semitones apart mod 12.
 */
export function isPowerChord(midis) {
  if (midis.length < 2) return false;
  if (midis[midis.length - 1] - midis[0] > POWER_CHORD_MAX_SPAN) return false;
  const iv = intervalSet(midis);
  if (!iv.has(7)) return false;
  for (const i of iv) if (i !== 0 && i !== 7) return false;
  return true;
}

/** Every note is the same pitch class and the grip spans at least an octave. */
export function isOctaveGrip(midis) {
  if (midis.length < 2) return false;
  if (midis[midis.length - 1] - midis[0] < 12) return false;
  const iv = intervalSet(midis);
  return iv.size === 1 && iv.has(0);
}

/**
 * A shell voicing: root, a third and a seventh, with the fifth deliberately
 * absent — the jazz guitarist's three-finger chord.
 *
 * TIER 2 (§A3): extracted and reported, but shipped at weight 0 in every
 * profile until a calibrated fixture pair exists. A shape label that has never
 * been checked against real writing does not get to move a score.
 */
export function isShellVoicing(midis) {
  if (midis.length !== 3) return false;
  const iv = intervalSet(midis);
  if (iv.has(7)) return false;                       // a shell omits the 5th
  if (!iv.has(0)) return false;
  const hasThird = iv.has(3) || iv.has(4);
  const hasSeventh = iv.has(10) || iv.has(11);
  return hasThird && hasSeventh;
}

// ---------------------------------------------------------------------------
// Run detectors (all walk ATTACKS, never beats; all break at rests and holds)
// ---------------------------------------------------------------------------

/** Split a stream's items into runs of consecutive attacks, broken by any rest
 *  or tie-continuation. Returns arrays of attack items. */
function attackRuns(stream) {
  const runs = [];
  let cur = [];
  for (const it of stream.items) {
    if (it.kind === 'attack') cur.push(it);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/**
 * Attacks belonging to a palm-muted repetition (≥ PALM_MUTE_RUN_MIN consecutive
 * muted attacks with nothing between them).
 *
 * @returns {{ covered: Set<object>, longestRun: number, runs: number }}
 */
export function findPalmMuteRuns(stream) {
  const covered = new Set();
  let longestRun = 0;
  let runs = 0;
  for (const run of attackRuns(stream)) {
    let i = 0;
    while (i < run.length) {
      if (!run[i].attacked.some((n) => n.palmMute)) { i++; continue; }
      let j = i;
      while (j < run.length && run[j].attacked.some((n) => n.palmMute)) j++;
      const len = j - i;
      longestRun = Math.max(longestRun, len);
      if (len >= PALM_MUTE_RUN_MIN) {
        runs++;
        for (let k = i; k < j; k++) covered.add(run[k]);
      }
      i = j;
    }
  }
  return { covered, longestRun, runs };
}

/**
 * Attacks belonging to a pedal-tone figure.
 *
 * The shape being recognised is `E5 x E5 y E5 z` — one low pitch struck again
 * and again while the material above it changes. So the pedal pitch must be the
 * LOWEST attacked note each time it appears (that is what "under" means), it
 * must recur, the gaps between its appearances must stay short, and the
 * non-pedal attacks must actually vary. Without that last condition an
 * alternation between exactly two chords would read as a pedal, which is a
 * riff, not a pedal.
 *
 * @returns {{ covered: Set<object>, figures: number }}
 */
export function findPedalRuns(stream) {
  const covered = new Set();
  let figures = 0;

  for (const run of attackRuns(stream)) {
    if (run.length < PEDAL_RUN_MIN_EVENTS) continue;
    // Candidate pedals: pitches that are the lowest attacked note of ≥2 events.
    const lowCounts = new Map();
    for (const ev of run) {
      const low = ev.midis[0];
      lowCounts.set(low, (lowCounts.get(low) ?? 0) + 1);
    }
    const candidates = [...lowCounts.entries()]
      .filter(([, c]) => c >= PEDAL_MIN_HITS)
      .map(([p]) => p)
      .sort((a, b) => a - b);            // deterministic candidate order

    for (const pedal of candidates) {
      let i = 0;
      while (i < run.length) {
        if (run[i].midis[0] !== pedal) { i++; continue; }
        // Extend while the pedal keeps reappearing within PEDAL_MAX_GAP.
        let last = i;
        let hits = 1;
        for (let k = i + 1; k < run.length; k++) {
          if (run[k].midis[0] === pedal) { last = k; hits++; continue; }
          if (k - last > PEDAL_MAX_GAP) break;
        }
        const segment = run.slice(i, last + 1);
        const others = segment.filter((ev) => ev.midis[0] !== pedal);
        const distinctAbove = new Set(others.map((ev) => ev.midis[ev.midis.length - 1]));
        if (segment.length >= PEDAL_RUN_MIN_EVENTS && hits >= PEDAL_MIN_HITS && distinctAbove.size >= 2) {
          figures++;
          for (const ev of segment) covered.add(ev);
        }
        i = last + 1;
      }
    }
  }
  return { covered, figures };
}

/**
 * The canonical key of a riff cell: relative pitch movement plus rhythm.
 *
 * Deliberately KEY-AGNOSTIC — the same figure transposed is the same figure, and
 * an arranger who moves a riff up a fourth for the second phrase has repeated it,
 * not invented one. So the key carries the DELTAS of the top attacked pitch, the
 * INTER-ONSET intervals (which encode the rests between attacks as well as the
 * note lengths), and the grip sizes — never absolute pitch.
 */
export function riffCellKey(window) {
  const tops = window.map((ev) => ev.midis[ev.midis.length - 1]);
  const deltas = [];
  for (let i = 1; i < tops.length; i++) deltas.push(tops[i] - tops[i - 1]);
  // A cell with no movement at all is a repeated chord, not a riff. Returning
  // null keeps piano-style block-chord repetition from scoring as guitar idiom —
  // it is exactly the texture `blockChord` exists to push back on.
  if (!deltas.some((d) => d !== 0)) return null;
  const iois = [];
  for (let i = 1; i < window.length; i++) iois.push(window[i].tick - window[i - 1].tick);
  const shape = window.map((ev) => ev.midis.length);
  return `${deltas.join(',')}|${iois.join(',')}|${shape.join(',')}`;
}

/**
 * Attacks covered by a cell of RIFF_CELL_EVENTS consecutive attacks that recurs
 * at least twice anywhere in the same stream.
 *
 * @returns {{ covered: Set<object>, cells: number }}
 */
export function findRiffCells(stream) {
  const covered = new Set();
  const windows = new Map();   // key -> array of windows
  const attacks = stream.attacks;
  for (let i = 0; i + RIFF_CELL_EVENTS <= attacks.length; i++) {
    const window = attacks.slice(i, i + RIFF_CELL_EVENTS);
    let spread = false;
    for (let k = 1; k < window.length; k++) {
      if (window[k].tick - window[k - 1].tick > RIFF_CELL_MAX_GAP_BEATS * QUARTER_TICKS) spread = true;
    }
    if (spread) continue;
    const key = riffCellKey(window);
    if (key === null) continue;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key).push(window);
  }
  let cells = 0;
  for (const list of windows.values()) {
    if (list.length < 2) continue;
    cells++;
    for (const window of list) for (const ev of window) covered.add(ev);
  }
  return { covered, cells };
}

/**
 * Is this attack syncopated?
 *
 * The formula, stated exactly (§A3 requires it). Let `B` be the beat-unit in
 * ticks (`4/denominator` quarter notes) and `t` the attack's tick within its
 * bar. The attack is syncopated iff `t % B !== 0` AND either
 *
 *   (a) nothing in the same stream attacks on the grid point below it
 *       (an ANTICIPATION — the strong position is displaced, not decorated), or
 *   (b) the attack sustains strictly past the next grid point
 *       (a note TIED ACROSS a stronger beat).
 *
 * Both halves matter. Without them a plain stream of straight eighth notes
 * would read as 50% syncopated, which is the opposite of what the word means:
 * an off-beat eighth that follows an on-beat eighth and stops before the next
 * beat is ordinary subdivision, not displacement.
 */
export function isSyncopated(ev, gridTicksInBar) {
  const B = ev.beatUnitTicks;
  if (!(B > 0)) return false;
  const t = ev.tickInBar;
  if (t % B === 0) return false;
  const gridBelow = Math.floor(t / B) * B;
  const gridAbove = gridBelow + B;
  const anticipates = !gridTicksInBar.has(gridBelow);
  const sustainsOver = t + (ev.durationBeats * QUARTER_TICKS) > gridAbove + EPS;
  return anticipates || sustainsOver;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

/** The feature table, in the order it is reported. Each entry names its own
 *  denominator so no reader has to infer one (§A3). */
const FEATURE_ORDER = [
  'powerChord', 'octave', 'pedalTone', 'palmMutedRepetition', 'leadArticulation',
  'riffCell', 'syncopation', 'blockChord', 'fragmentation', 'shellVoicing',
];

const DENOMINATOR_LABEL = {
  powerChord: 'multi-note attack events',
  octave: 'multi-note attack events',
  shellVoicing: 'multi-note attack events',
  pedalTone: 'attack events',
  palmMutedRepetition: 'attack events',
  leadArticulation: 'attack events',
  riffCell: 'attack events',
  syncopation: 'attack events',
  blockChord: 'attack events',
  fragmentation: 'attack events',
};

const round = (n, places = 4) => {
  const f = 10 ** places;
  return Math.round(n * f) / f + 0;    // `+ 0` normalises -0 (§A6)
};

/**
 * Count every feature over the extracted streams.
 *
 * @param {object} score alphaTab Score.
 * @param {object} [opts] Same options as `extractIdiomEvents`.
 * @returns {{ features: object, stats: object, skippedStaves: object[],
 *             bars: {lo,hi}|null }}
 *          `features[name] = { numerator, denominator, value, measured,
 *                              denominatorOf }`
 */
export function extractIdiomFeatures(score, opts = {}) {
  const { streams, skippedStaves, droppedNotes, graceSkipped, bars } = extractIdiomEvents(score, opts);

  let attackEvents = 0;
  let multiNoteAttacks = 0;
  let restEvents = 0;
  let holdEvents = 0;
  let noteCount = 0;

  const counts = Object.fromEntries(FEATURE_ORDER.map((k) => [k, 0]));
  let longestPalmMuteRun = 0;
  let pedalFigures = 0;
  let riffCells = 0;
  let palmMuteRuns = 0;

  for (const stream of streams) {
    // The grid of on-beat attack positions per bar, needed by the syncopation
    // rule's "anticipation" half. Built per stream because voices are
    // independent: voice 1 landing on beat 3 does not make voice 0's off-beat
    // attack a decoration.
    const gridByBar = new Map();
    for (const ev of stream.attacks) {
      if (!gridByBar.has(ev.bar)) gridByBar.set(ev.bar, new Set());
      gridByBar.get(ev.bar).add(ev.tickInBar);
    }

    const palm = findPalmMuteRuns(stream);
    const pedal = findPedalRuns(stream);
    const riff = findRiffCells(stream);
    longestPalmMuteRun = Math.max(longestPalmMuteRun, palm.longestRun);
    palmMuteRuns += palm.runs;
    pedalFigures += pedal.figures;
    riffCells += riff.cells;

    for (const it of stream.items) {
      if (it.kind === 'rest') { restEvents++; continue; }
      if (it.kind === 'hold') { holdEvents++; noteCount += it.notes.length; continue; }
      attackEvents++;
      noteCount += it.notes.length;

      const midis = it.midis;
      const multi = midis.length >= 2;
      const power = multi && isPowerChord(midis);
      const octave = multi && isOctaveGrip(midis);
      const shell = multi && isShellVoicing(midis);
      if (multi) {
        multiNoteAttacks++;
        if (power) counts.powerChord++;
        if (octave) counts.octave++;
        if (shell) counts.shellVoicing++;
        // A power chord, an octave and a shell are all RECOGNISED GUITAR GRIPS.
        // Counting them as block chords as well would charge a power-chord riff
        // (or a jazz comp) the negative weight that exists to push back on
        // literal piano writing — the exact false positive Implement.md §3.2
        // forbids. `blockChord` means "a simultaneity this module cannot
        // recognise as a guitar shape", and nothing more.
        if (!power && !octave && !shell) counts.blockChord++;
      }
      if (pedal.covered.has(it)) counts.pedalTone++;
      if (palm.covered.has(it)) counts.palmMutedRepetition++;
      if (riff.covered.has(it)) counts.riffCell++;
      if (it.attacked.some((n) => n.bend || n.slide || n.vibrato || n.legato)) counts.leadArticulation++;
      if (isSyncopated(it, gridByBar.get(it.bar) ?? new Set())) counts.syncopation++;
      if (it.durationBeats < FRAGMENT_MAX_BEATS - EPS) counts.fragmentation++;
    }
  }

  const denomOf = (name) => (
    DENOMINATOR_LABEL[name] === 'multi-note attack events' ? multiNoteAttacks : attackEvents);

  const features = {};
  for (const name of FEATURE_ORDER) {
    const denominator = denomOf(name);
    const measured = denominator > 0;
    features[name] = {
      numerator: counts[name],
      denominator,
      denominatorOf: DENOMINATOR_LABEL[name],
      // An unmeasured feature is 0 for display and `measured:false` for the
      // arithmetic. Never NaN — §A3, and JSON has no NaN anyway.
      value: measured ? round(counts[name] / denominator) : 0,
      measured,
    };
  }

  return {
    features,
    bars,
    skippedStaves,
    stats: {
      streams: streams.length,
      attackEvents,
      multiNoteAttacks,
      restEvents,
      holdEvents,
      notes: noteCount,
      droppedNotes,
      graceSkipped,
      longestPalmMuteRun,
      palmMuteRuns,
      pedalFigures,
      riffCells,
    },
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The three MUTUALLY EXCLUSIVE grip classifications. One attack is at most one
 * of them, so they share a denominator slot — see `scoreFeatures`.
 */
export const GRIP_FEATURES = Object.freeze(['powerChord', 'octave', 'shellVoicing']);

/**
 * Weighted idiom score on a 0..10 scale, or `null` when nothing was measurable.
 *
 *   raw   = Σ wᵢ · vᵢ                over MEASURED features
 *   posW  = Σ max(wᵢ, 0)             over MEASURED features, with the grip
 *                                    family contributing max(w) ONCE
 *   score = clamp(raw / posW, 0, 1) · 10
 *
 * **Why the grip family is special.** `powerChord`, `octave` and `shellVoicing`
 * classify the SAME event and are mutually exclusive: no attack can be two of
 * them, so no passage can ever score on more than one per grip. Charging the SUM
 * of their weights to the denominator would make an all-octave riff structurally
 * incapable of a good score — it would be marked down for the power chords it
 * did not also play on the same beat. Charging `max(w)` once asks the right
 * question: "of this style's recognised grips, how fully is the best-weighted
 * one being used?" A hard-rock octave riff then reaches 1/3 of the family's
 * value (octave 1 against powerChord 3), which is an opinion the profile is
 * entitled to hold, rather than an artefact of the arithmetic.
 *
 * The clamp matters at both ends. A passage of nothing but piano block chords
 * produces a negative raw and lands at 0 — "as un-guitar-like as this scale
 * measures" — rather than at −2.1, a number with no meaning. And a feature with
 * weight 0 (jazz's `palmMutedRepetition`) contributes to neither side, so its
 * absence is not a deduction. That is the mechanism behind "a jazz ballad is not
 * penalised for lacking palm muting".
 */
export function scoreFeatures(features, weights) {
  let raw = 0;
  let positiveWeight = 0;
  let gripFamilyWeight = 0;
  const contributions = {};
  for (const name of FEATURE_ORDER) {
    const f = features[name];
    const w = weights[name] ?? 0;
    if (!f || !f.measured) { contributions[name] = 0; continue; }
    const c = w * f.value;
    contributions[name] = round(c);
    raw += c;
    if (w <= 0) continue;
    if (GRIP_FEATURES.includes(name)) gripFamilyWeight = Math.max(gripFamilyWeight, w);
    else positiveWeight += w;
  }
  positiveWeight += gripFamilyWeight;
  const score = positiveWeight > 0
    ? round(Math.min(1, Math.max(0, raw / positiveWeight)) * SCORE_SCALE, 2)
    : null;
  return { raw: round(raw), positiveWeight: round(positiveWeight), contributions, score };
}

/**
 * The full soft analysis: features, score, and at most one advisory.
 *
 * @param {object} score alphaTab Score.
 * @param {object} opts
 * @param {object} opts.profile A validated style profile (contract C6).
 * @param {{lo:number,hi:number}|null} [opts.range]
 * @param {number[]|null} [opts.trackIndices]
 * @returns {{ score: number|null, features: object, weightedScore: object,
 *             advisories: object[], stats: object, settings: object }}
 */
export function analyzeIdiomDensity(score, opts = {}) {
  const profile = opts.profile;
  if (!profile || typeof profile !== 'object' || !profile.idiom) {
    throw new TypeError('analyzeIdiomDensity: opts.profile must be a validated style profile');
  }
  const { features, stats, skippedStaves, bars } = extractIdiomFeatures(score, opts);
  const weighted = scoreFeatures(features, profile.idiom.weights);

  const range = opts.range ?? null;
  const barStart = bars?.lo ?? range?.lo ?? null;
  const barEnd = bars?.hi ?? range?.hi ?? null;

  const advisories = [];
  // NO VERDICT WITHOUT EVIDENCE (§A3). Two separate refusals, deliberately not
  // collapsed: `score === null` means nothing could be measured at all (a piano
  // source, an empty range), while `attackEvents < minAttacks` means the passage
  // is real but too short to grade — four notes are not a style.
  const graded = weighted.score !== null && stats.attackEvents >= profile.idiom.minAttacks;

  if (graded && weighted.score < profile.idiom.warnBelow) {
    const ranked = FEATURE_ORDER
      .filter((n) => features[n].measured)
      .map((n) => ({ name: n, weight: profile.idiom.weights[n] ?? 0, value: features[n].value,
        contribution: weighted.contributions[n] }));
    const strongest = ranked
      .filter((r) => r.contribution > 0)
      .sort((a, b) => (b.contribution - a.contribution) || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((r) => ({ feature: r.name, value: r.value, contribution: r.contribution }));
    // "Missing" means a feature this style WEIGHTS and this passage does not
    // use. A zero-weighted feature can never appear here, which is why jazz is
    // structurally incapable of asking for palm muting.
    const missing = ranked
      .filter((r) => r.weight > 0 && r.value === 0)
      .sort((a, b) => (b.weight - a.weight) || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((r) => ({ feature: r.name, weight: r.weight }));

    advisories.push(advisory(
      'idiom.low-density',
      `bars ${barStart}-${barEnd}: guitar-idiom density scores ${weighted.score} against the `
      + `${profile.name} floor of ${profile.idiom.warnBelow} over ${stats.attackEvents} attack(s)`
      + (missing.length ? ` — this style weights ${missing.map((m) => m.feature).join(', ')}, `
        + 'none of which this passage uses' : '')
      + '. This is a question about arranging, not a defect: confirm the texture is the one you '
      + 'want before changing anything.',
      {
        bar: barStart ?? undefined,
        data: {
          style: profile.name,
          score: weighted.score,
          threshold: profile.idiom.warnBelow,
          attackEvents: stats.attackEvents,
          barStart,
          barEnd,
          strongestFeatures: strongest,
          missingFeatures: missing,
        },
      },
    ));
  }

  return {
    score: graded ? weighted.score : null,
    graded,
    features,
    weightedScore: weighted,
    advisories,
    stats: { ...stats, skippedStaves, barStart, barEnd },
    settings: {
      style: profile.name,
      warnBelow: profile.idiom.warnBelow,
      minAttacks: profile.idiom.minAttacks,
      weights: { ...profile.idiom.weights },
      range: range ? { lo: range.lo, hi: range.hi } : null,
      trackIndices: Array.isArray(opts.trackIndices) ? [...opts.trackIndices].sort((a, b) => a - b) : null,
    },
  };
}

export { FEATURE_ORDER };

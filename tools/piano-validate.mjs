#!/usr/bin/env node
// piano-validate.mjs — the SOURCE-side validator.
//
// Usage: node tools/piano-validate.mjs <source.alphatab>
// Output: JSON to stdout. Exit 0 = clean, 1 = any error, 2 = usage/IO error.
//
// This is the sibling of `tools/validate.mjs`, not a replacement for it:
//
//     validate.mjs        the GUITAR-OUTPUT side — the tab you wrote
//     piano-validate.mjs  the SOURCE side        — the piano score you were given
//
// It answers the questions Step 0 has to answer before anything is planned:
// does the source parse at all, what did the normalizer have to rewrite to get
// it there, how is it laid out across tracks/staves/voices, does the meter or
// tempo move, how much of it falls outside a guitar's reach, and does its
// declared key signature actually match what it sounds like.
//
// TWO TRAPS THIS FILE IS BUILT AROUND (both measured, both silent if ignored):
//
//   1. NEVER call fretboard.mjs's `fromAlphaTabNote` on a pitched note. Pitched
//      notes carry `string === -1`, so it computes `7 - (-1) = 8`, indexes
//      `OPEN[8]` -> undefined, and returns `{string: 8, fret: -1}` without ever
//      throwing. It is the guitar-output-side boundary and stays there. Pitch on
//      the source side comes from `note.realValue`, and no string/fret is
//      reported at all.
//
//   2. Piano voice indices are STAFF-GLOBAL. In canon-in-d-hard.alphatab staff 0
//      uses voices 0-3 and staff 1 uses voices 4-7 (staff 1's voices 0-3 exist
//      and are empty). So voice numbers are only ever REPORTED here, never used
//      to decide anything. Track names are non-ASCII in this corpus (Korean),
//      so nothing keys off a track name either.
//
// Every number below is measured off the parse tree of the NORMALIZED text, and
// the normalizer's edits are printed alongside — always, including at zero.

import {
  loadPianoSource,
  parsedStaffKind,
  inferKeyFromPitchClasses,
  keyAccidentals,
  accidentalsToText,
  PITCH_CLASS_NAMES,
  STAFF_KIND,
} from './lib/piano-source.mjs';
import { midiToName, QUARTER_TICKS } from './lib/score-utils.mjs';

// The guitar's sounding window in standard tuning: low E2 (40) .. E5 (76) at
// fret 12 on the high E string. Notes outside it must be folded or dropped, and
// the arranger needs the NOTE COUNT outside, not just the extremes.
const GUITAR_LOW = 40;   // E2
const GUITAR_HIGH = 76;  // E5

// A key claim is only worth making when there is enough music to make it from.
// Measured on the corpus: every one of the six files correlates at 0.91-0.96 over
// 400+ notes, so this threshold never fires on real input — it exists so a short
// excerpt cannot produce a confident-looking "the \ks lies" verdict from noise.
const KEY_MIN_NOTES = 24;
const KEY_MIN_CORRELATION = 0.6;
function hasKeyEvidence(sounding, pitchedNoteCount) {
  return pitchedNoteCount >= KEY_MIN_NOTES && sounding.score >= KEY_MIN_CORRELATION;
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node tools/piano-validate.mjs <source.alphatab>');
  process.exit(2);
}

const args = process.argv.slice(2);
const unknown = args.find((a) => a.startsWith('--'));
if (unknown) usage(`Unknown option: ${unknown}  (this tool takes a file and nothing else; output is always JSON)`);
const file = args[0];
if (!file || args.length > 1) usage();

let loaded;
try {
  loaded = loadPianoSource(file);
} catch (e) {
  usage(`Cannot read ${file}: ${e?.message ?? e}`);
}

const norm = loaded.normalization;

// --- normalization report: ALWAYS shown, even at zero ------------------------
const normalization = {
  rule: '-1.<string>.<duration>  ->  r.<duration>   (pitched staves only)',
  rewrites: norm.counts.negativeFretRests,
  byLine: norm.rewrites.map((r) => ({
    line: r.line,
    column: r.column,
    from: r.from,
    to: r.to,
    track: r.trackIndex,
    staff: r.staffIndex,
    droppedNoteProperties: r.droppedNoteProps,
  })),
  skipped: norm.skipped,
  counts: norm.counts,
  encoding: loaded.encoding,
  bytes: norm.byteLength,
};

const flags = [];
for (const s of norm.skipped) {
  flags.push({
    type: 'normalizer-skipped',
    message: `line ${s.line}: left \`${s.text}\` alone — ${s.why}`,
  });
}
for (const n of norm.notes) flags.push({ type: 'scan', message: n });

// --- parse -------------------------------------------------------------------
const parse = {
  ok: loaded.ok,
  errors: loaded.errors,
  warnings: loaded.warnings,
  hints: loaded.hints,
};

if (!loaded.ok) {
  console.log(JSON.stringify({
    ok: false, file, encoding: loaded.encoding, normalization, parse,
    flags: [...flags, {
      type: 'parse',
      message: norm.counts.negativeFretRests
        ? 'still fails after normalization — the rewrites below were not the only problem'
        : 'fails to parse and the normalizer found nothing to rewrite',
    }],
  }, null, 2));
  process.exit(1);
}

const score = loaded.score;

// --- walk the tree once ------------------------------------------------------
// Pitch comes from note.realValue only. No string, no fret, no fretboard.mjs.
const staffRows = [];
const pcDuration = new Array(12).fill(0);
const pcCount = new Array(12).fill(0);
const bassPc = new Array(12).fill(0);
let totalNotes = 0;
let totalBeats = 0;
let restBeats = 0;
let minMidi = Infinity;
let maxMidi = -Infinity;
let belowWindow = 0;
let aboveWindow = 0;
let untunedNotes = 0;
const barLowest = new Array(score.masterBars.length).fill(null);

for (const track of score.tracks) {
  for (const staff of track.staves) {
    const voiceNotes = new Map();
    let staffNotes = 0;
    let staffBeats = 0;
    let staffMin = Infinity;
    let staffMax = -Infinity;
    for (const bar of staff.bars) {
      bar.voices.forEach((voice, vi) => {
        if (!voice) return;
        for (const beat of voice.beats) {
          totalBeats++;
          staffBeats++;
          if (beat.isRest) restBeats++;
          const quarters = (beat.playbackDuration || 0) / QUARTER_TICKS;
          for (const note of beat.notes) {
            totalNotes++;
            staffNotes++;
            voiceNotes.set(vi, (voiceNotes.get(vi) ?? 0) + 1);
            const midi = note.realValue;
            if (!Number.isFinite(midi) || midi < 0) { untunedNotes++; continue; }
            minMidi = Math.min(minMidi, midi);
            maxMidi = Math.max(maxMidi, midi);
            staffMin = Math.min(staffMin, midi);
            staffMax = Math.max(staffMax, midi);
            if (midi < GUITAR_LOW) belowWindow++;
            else if (midi > GUITAR_HIGH) aboveWindow++;
            pcDuration[midi % 12] += quarters;
            pcCount[midi % 12] += 1;
            const bi = bar.index;
            if (barLowest[bi] === null || midi < barLowest[bi]) barLowest[bi] = midi;
          }
        }
      });
    }
    const scanned = norm.staves.find(
      (s) => s.trackIndex === track.index && s.staffIndex === staff.index
    );
    const kindFromParse = parsedStaffKind(staff);
    const kindFromText = scanned?.kind ?? STAFF_KIND.UNKNOWN;
    staffRows.push({
      track: track.index,
      trackName: track.name,          // may be non-ASCII; reported, never keyed off
      staff: staff.index,
      kind: kindFromParse,
      kindFromText,
      kindFromTextReason: scanned?.kindReason ?? null,
      kindAgrees: kindFromParse === kindFromText,
      display: [
        staff.showStandardNotation ? 'score' : null,
        staff.showTablature ? 'tabs' : null,
        staff.showSlash ? 'slash' : null,
        staff.showNumbered ? 'numbered' : null,
      ].filter(Boolean),
      tuning: staff.stringTuning?.tunings?.length
        ? staff.stringTuning.tunings.map(midiToName)
        : null,
      capo: staff.capo || 0,
      displayTranspositionPitch: staff.displayTranspositionPitch || 0,
      bars: staff.bars.length,
      beats: staffBeats,
      notes: staffNotes,
      // Voice indices are STAFF-GLOBAL in piano sources — reported as found.
      voicesWithNotes: [...voiceNotes.keys()].sort((a, b) => a - b),
      notesByVoice: Object.fromEntries(
        [...voiceNotes.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => [`voice${v}`, n])
      ),
      pitchRange: staffNotes && staffMin !== Infinity
        ? `${midiToName(staffMin)}..${midiToName(staffMax)}`
        : null,
    });
    if (kindFromParse !== kindFromText) {
      flags.push({
        type: 'staff-kind-mismatch',
        message: `track ${track.index} staff ${staff.index}: text scan says "${kindFromText}" ` +
          `(${scanned?.kindReason ?? 'no evidence'}) but the parse tree says "${kindFromParse}" — ` +
          'the normalizer trusts the text scan, so check this before trusting a rewrite count',
      });
    }
  }
}

for (const lowest of barLowest) if (lowest !== null) bassPc[lowest % 12]++;

// --- meter -------------------------------------------------------------------
const meterDistribution = new Map();
const meterChanges = [];
let prevMeter = null;
for (const mb of score.masterBars) {
  const sig = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
  meterDistribution.set(sig, (meterDistribution.get(sig) ?? 0) + 1);
  if (sig !== prevMeter) {
    if (prevMeter !== null) meterChanges.push({ bar: mb.index + 1, from: prevMeter, to: sig });
    prevMeter = sig;
  }
}
const meter = {
  initial: score.masterBars.length
    ? `${score.masterBars[0].timeSignatureNumerator}/${score.masterBars[0].timeSignatureDenominator}`
    : null,
  distribution: Object.fromEntries(
    [...meterDistribution.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${v} bars`])
  ),
  changesMidTune: meterChanges.length > 0,
  changes: meterChanges,
};
if (meter.changesMidTune) {
  flags.push({
    type: 'meter-change',
    message: `meter changes ${meterChanges.length}× mid-tune (${meterChanges.map((c) => `bar ${c.bar}: ${c.from}->${c.to}`).join(', ')}) — ` +
      'an irregular grouping is a deliberate phrase length; do not normalize it to 4/4',
  });
}

// --- tempo -------------------------------------------------------------------
const tempoChanges = [];
for (const mb of score.masterBars) {
  const autos = mb.tempoAutomations ?? [];
  for (const a of autos) {
    tempoChanges.push({
      bar: mb.index + 1,
      bpm: a.value,
      ratioPosition: a.ratioPosition ?? 0,
      hidden: a.isVisible === false,
    });
  }
}
const distinctTempos = [...new Set(tempoChanges.map((t) => t.bpm))];
const declaredTempoDirectives = norm.staves.flatMap((s) =>
  s.tempoDirectives.map((t) => ({ line: t.line, value: t.value, track: s.trackIndex, staff: s.staffIndex }))
);
const tempo = {
  initial: score.tempo,
  declaredInSource: declaredTempoDirectives,
  changes: tempoChanges,
  changed: distinctTempos.length > 1,
  distinct: distinctTempos,
};
if (tempo.changed) {
  flags.push({
    type: 'tempo-change',
    message: `${tempoChanges.length} tempo marking(s), ${distinctTempos.length} distinct values ` +
      `(${distinctTempos.join(', ')}) — target tempo is a Gate A decision, never inherited`,
  });
}
// A `\tempo` directive the parse tree never received is one the exporter wrote
// and the score does not play — alphaTab keeps the LAST of a consecutive run.
if (declaredTempoDirectives.length > tempoChanges.length) {
  flags.push({
    type: 'tempo-overwritten',
    message: `the source carries ${declaredTempoDirectives.length} \\tempo directives ` +
      `(${declaredTempoDirectives.map((t) => `line ${t.line}: ${t.value}`).join(', ')}) but only ` +
      `${tempoChanges.length} survive into the score — alphaTab keeps the last of a consecutive run, ` +
      `so this score plays at ${score.tempo}. Confirm that is the tempo you meant to read.`,
  });
}

// --- range vs the guitar -----------------------------------------------------
const pitched = totalNotes - untunedNotes;
const range = {
  guitarWindow: `${midiToName(GUITAR_LOW)}..${midiToName(GUITAR_HIGH)}`,
  lowest: pitched ? midiToName(minMidi) : null,
  highest: pitched ? midiToName(maxMidi) : null,
  lowestMidi: pitched ? minMidi : null,
  highestMidi: pitched ? maxMidi : null,
  semitonesBelowWindow: pitched ? Math.max(0, GUITAR_LOW - minMidi) : 0,
  semitonesAboveWindow: pitched ? Math.max(0, maxMidi - GUITAR_HIGH) : 0,
  // The number the arranger actually needs: HOW MANY notes fall outside, not
  // how far the extremes go. One stray low D is a different problem from 400.
  notesBelowWindow: belowWindow,
  notesAboveWindow: aboveWindow,
  notesInWindow: pitched - belowWindow - aboveWindow,
  pctBelowWindow: pitched ? +(100 * belowWindow / pitched).toFixed(2) : 0,
  pctAboveWindow: pitched ? +(100 * aboveWindow / pitched).toFixed(2) : 0,
  notesWithoutPitch: untunedNotes,
};
if (belowWindow || aboveWindow) {
  flags.push({
    type: 'range-deficit',
    message: `${belowWindow} note(s) below ${range.guitarWindow.split('..')[0]} and ${aboveWindow} above ` +
      `${range.guitarWindow.split('..')[1]} (${range.pctBelowWindow}% / ${range.pctAboveWindow}% of ${pitched}) — ` +
      'these need octave folding, re-voicing or deliberate loss',
  });
}

// --- key: declared vs sounding ----------------------------------------------
// MEASURED FACT: the declared key signature lies. Canon Rock 1 declares `\ks c`
// and does not sound in C. So the key is DERIVED FROM PITCH CONTENT and the two
// are reported side by side; a disagreement is flagged, never quietly resolved.
const declaredSignatures = new Map();
for (const mb of score.masterBars) {
  const acc = mb.keySignature ?? 0;
  const type = mb.keySignatureType === 1 ? 'minor' : 'major';
  const k = `${acc}|${type}`;
  declaredSignatures.set(k, (declaredSignatures.get(k) ?? 0) + 1);
}
const declaredInitial = score.masterBars.length
  ? { accidentals: score.masterBars[0].keySignature ?? 0, type: score.masterBars[0].keySignatureType === 1 ? 'minor' : 'major' }
  : { accidentals: 0, type: 'major' };

const sounding = inferKeyFromPitchClasses(pcDuration);
const declaredTexts = [...new Set(norm.staves.flatMap((s) => s.declaredKeySignatures))];

const key = {
  declared: {
    raw: declaredTexts,                                  // the literal `\ks …` tokens
    accidentals: declaredInitial.accidentals,
    accidentalsText: accidentalsToText(declaredInitial.accidentals),
    type: declaredInitial.type,
    changesMidTune: declaredSignatures.size > 1,
  },
  sounding: sounding && {
    key: sounding.key,
    tonic: sounding.tonic,
    mode: sounding.mode,
    accidentals: sounding.accidentals,
    accidentalsText: accidentalsToText(sounding.accidentals),
    confidence: +sounding.score.toFixed(3),
    lowConfidence: !hasKeyEvidence(sounding, pitched),
    runnersUp: sounding.ranked.slice(1, 4).map((r) => `${r.key} (${r.score.toFixed(3)})`),
    method: 'Krumhansl-Kessler correlation over a duration-weighted pitch-class histogram',
  },
  pitchClassHistogram: Object.fromEntries(
    PITCH_CLASS_NAMES.map((n, i) => [n, { notes: pcCount[i], quarterBeats: +pcDuration[i].toFixed(1) }])
      .filter(([, v]) => v.notes > 0)
  ),
  bassPitchClasses: Object.fromEntries(
    PITCH_CLASS_NAMES.map((n, i) => [n, bassPc[i]]).filter(([, v]) => v > 0)
  ),
  agrees: null,
};
if (sounding) {
  key.agrees = sounding.accidentals === declaredInitial.accidentals;
  const evidence = hasKeyEvidence(sounding, pitched);
  if (!key.agrees && evidence) {
    flags.push({
      type: 'key-signature-disagrees',
      message: `declared \\ks ${declaredTexts.join('/') || '(none)'} = ${accidentalsToText(declaredInitial.accidentals)} ` +
        `${declaredInitial.type}, but the pitch content sounds like ${sounding.key} = ` +
        `${accidentalsToText(sounding.accidentals)} (confidence ${sounding.score.toFixed(3)}). ` +
        'DERIVE THE KEY FROM PITCH CONTENT, NEVER FROM \\ks.',
    });
  } else if (!evidence) {
    flags.push({
      type: 'key-inference-weak',
      message: `too little evidence to trust a sounding key (${pitched} pitched notes, ` +
        `best correlation ${sounding.score.toFixed(3)}) — the declared/sounding comparison is not decidable here`,
    });
  }
}
if (key.declared.changesMidTune) {
  flags.push({
    type: 'key-signature-change',
    message: `the declared key signature changes mid-tune (${declaredSignatures.size} distinct values)`,
  });
}

// --- report ------------------------------------------------------------------
const report = {
  ok: true,
  file,
  encoding: loaded.encoding,
  normalization,
  parse,
  score: {
    title: score.title || null,
    subtitle: score.subTitle || null,
    artist: score.artist || null,
    tracks: score.tracks.length,
    stavesPerTrack: score.tracks.map((t) => t.staves.length),
    staves: score.tracks.reduce((n, t) => n + t.staves.length, 0),
    bars: score.masterBars.length,
    beats: totalBeats,
    restBeats,
    notes: totalNotes,
  },
  staves: staffRows,
  meter,
  tempo,
  range,
  key,
  flags,
};

console.log(JSON.stringify(report, null, 2));
process.exit(0);

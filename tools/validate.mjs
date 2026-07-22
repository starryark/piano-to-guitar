// Vendored from abc-to-guitar@ba7e29c — tools/validate.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
// validate.mjs — parse an alphaTex file and report syntax errors or score stats.
// Usage: node tools/validate.mjs [--strict] <file.alphatab>
// Output: JSON to stdout. Exit 0 = valid, 1 = errors or (with --strict) warnings.
//
// Divergence from alphatex-composer's original, deliberate:
//   1. --strict makes bar-fill warnings fatal. The original always exited 0 on
//      warnings, so a CI-style wrapper silently passed malformed bars.
//      tools/check.mjs always passes --strict.
//   2. The fill check walks EVERY voice, not just bar.voices[0]. Multi-voice
//      bars were previously unvalidated past the first voice.
import { loadTex, walkBeats, midiToName, expectedBarTicks } from './lib/score-utils.mjs';
import { STRING_COUNT } from './lib/fretboard.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node tools/validate.mjs [--strict] <file.alphatab>');
  process.exit(2);
}

const result = loadTex(file);
if (!result.ok) {
  console.log(JSON.stringify({ ok: false, file, errors: result.errors }, null, 2));
  process.exit(1);
}

const { score } = result;
const warnings = [];

// Per-bar fill check: sum of beat durations vs time signature, for EVERY voice.
for (const track of score.tracks) {
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      const masterBar = bar.masterBar;
      const expected = expectedBarTicks(masterBar);
      bar.voices.forEach((voice, vi) => {
        if (!voice || voice.isEmpty) return;
        let actual = 0;
        for (const beat of voice.beats) actual += beat.playbackDuration;
        if (actual === expected) return;
        const dir = actual > expected ? 'overfull' : 'underfull';
        warnings.push({
          type: 'bar-fill',
          message: `Bar ${bar.index + 1} (track "${track.name || track.index}"` +
            `${bar.voices.length > 1 ? `, voice ${vi}` : ''}) is ${dir}: ` +
            `${actual}/${expected} ticks (${(actual / 960).toFixed(2)} vs ${(expected / 960).toFixed(2)} quarter beats in ` +
            `${masterBar.timeSignatureNumerator}/${masterBar.timeSignatureDenominator})`,
          bar: bar.index + 1,
          voice: vi,
        });
      });
    }
  }
}

// Stats: fret range per string, pitch range, note/beat counts.
// NOTE: alphaTab's `note.string` is INTERNAL-numbered (1 = low E). We invert it
// here to SOURCE/AlphaTex numbering (1 = high e) using the same formula as
// fretboard.mjs's `fromAlphaTabNote`, so `fretRangeByString` keys match what
// the arranger wrote: `string1` = high e ... `string6` = low E.
const perString = new Map();
let noteCount = 0;
let beatCount = 0;
let minMidi = Infinity;
let maxMidi = -Infinity;
walkBeats(score, ({ beat, staff }) => {
  if (!beat.isRest) beatCount++;
  const stringCount = staff.stringTuning?.tunings?.length || STRING_COUNT;
  for (const note of beat.notes) {
    noteCount++;
    const s = (stringCount + 1) - note.string; // internal -> source
    const cur = perString.get(s) ?? { minFret: Infinity, maxFret: -Infinity, notes: 0 };
    cur.minFret = Math.min(cur.minFret, note.fret);
    cur.maxFret = Math.max(cur.maxFret, note.fret);
    cur.notes++;
    perString.set(s, cur);
    if (note.realValue >= 0) {
      minMidi = Math.min(minMidi, note.realValue);
      maxMidi = Math.max(maxMidi, note.realValue);
    }
  }
});

const stats = {
  title: score.title,
  subtitle: score.subtitle,
  tempo: score.tempo,
  tracks: score.tracks.length,
  bars: score.masterBars.length,
  timeSignature: `${score.masterBars[0].timeSignatureNumerator}/${score.masterBars[0].timeSignatureDenominator}`,
  tuning: score.tracks[0].staves[0].stringTuning?.tunings?.map(midiToName),
  beats: beatCount,
  notes: noteCount,
  pitchRange: noteCount ? `${midiToName(minMidi)}..${midiToName(maxMidi)}` : null,
  fretRangeByString: Object.fromEntries(
    [...perString.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, v]) => [`string${s}`, `fret ${v.minFret}-${v.maxFret} (${v.notes} notes)`])
  ),
};

const ok = warnings.length === 0 || !strict;
console.log(JSON.stringify({ ok, file, stats, warnings }, null, 2));
process.exit(ok ? 0 : 1);

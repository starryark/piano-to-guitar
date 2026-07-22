// Vendored from abc-to-guitar@ba7e29c — tools/lib/score-utils.mjs.
// Local edits are marked `// PTG:`. Re-pull deliberately; do not auto-sync.
import * as alphaTab from '@coderline/alphatab';
import * as fs from 'fs';

const SEVERITY = { 0: 'hint', 1: 'warning', 2: 'error' };

function collectDiagnostics(iterable) {
  const out = [];
  if (!iterable) return out;
  for (const d of iterable) {
    out.push({
      code: d.code,
      severity: SEVERITY[d.severity] ?? String(d.severity),
      message: d.message,
      line: d.start?.line,
      col: d.start?.col,
      endLine: d.end?.line,
      endCol: d.end?.col,
    });
  }
  return out;
}

/**
 * Parse an alphaTex file into an alphaTab Score.
 * Returns { ok: true, score, settings } or { ok: false, errors: [...] }.
 */
export function loadTex(path) {
  const tex = fs.readFileSync(path, 'utf8');
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, settings);
  try {
    const score = importer.readScore();
    return { ok: true, score, settings };
  } catch (e) {
    // The importer throws either AlphaTexErrorWithDiagnostics directly or an
    // UnsupportedFormatError wrapping it in .inner/.cause.
    const source = typeof e.iterateDiagnostics === 'function' ? e
      : (e.inner && typeof e.inner.iterateDiagnostics === 'function') ? e.inner
      : (e.cause && typeof e.cause.iterateDiagnostics === 'function') ? e.cause
      : null;
    let errors = source ? collectDiagnostics(source.iterateDiagnostics()) : [];
    if (errors.length === 0) {
      for (const bag of [importer.lexerDiagnostics, importer.parserDiagnostics]) {
        if (bag?.items) errors.push(...collectDiagnostics(bag.items));
      }
    }
    if (errors.length === 0) {
      errors = [{ severity: 'error', message: String(e.message ?? e) }];
    }
    return { ok: false, errors };
  }
}

/** Iterate every beat: cb({ track, staff, bar, voice, beat, barIndex, trackIndex }) */
export function walkBeats(score, cb) {
  for (let t = 0; t < score.tracks.length; t++) {
    const track = score.tracks[t];
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            cb({ track, staff, bar, voice, beat, barIndex: bar.index, trackIndex: t });
          }
        }
      }
    }
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number -> scientific pitch name, e.g. 62 -> "D4" (C4 = 60). */
export function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/** Ticks for one quarter note in alphaTab's MIDI model. */
export const QUARTER_TICKS = 960;

/** Expected tick length of a master bar from its time signature. */
export function expectedBarTicks(masterBar) {
  return masterBar.timeSignatureNumerator * (4 / masterBar.timeSignatureDenominator) * QUARTER_TICKS;
}

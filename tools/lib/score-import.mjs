// tools/lib/score-import.mjs — the MusicXML import boundary (PTG-native).
//
// The toolchain's source format is AlphaTex, and it stays that way: every
// source tool (piano-validate, piano-extract, source-profile, foreground, the
// gates) still reads AlphaTex and nothing else. This module is the ONE place a
// foreign score enters, and it converts with alphaTab itself — the same parser
// the rest of the toolchain uses — so there is still exactly one dependency and
// one parser. It does not interpret music; it moves notes across a format
// boundary and PROVES nothing was lost on the way:
//
//   MusicXML (.mxl/.musicxml/.xml)
//     -> alphaTab ScoreLoader            (the MusicXML importer alphaTab ships)
//     -> repairExportHazards()           (model fixes the AlphaTex exporter needs)
//     -> alphaTab AlphaTexExporter
//     -> roundTripAudit()                (re-parse; every attack must match)
//
// Two hazards, both found on a real MuseScore export, both silent:
//
//  1. FORWARD-GAP PLACEHOLDERS. A MusicXML voice that starts mid-bar is written
//     as <backup>/<forward>. alphaTab's importer fills the gap with ONE empty
//     placeholder beat (duration 256th, playback stretched to the gap), which is
//     correct in the model — but the AlphaTex exporter writes it as `r.256`, so
//     the re-parsed voice starts 15 ticks into the bar instead of on beat 3. A
//     whole counter-line then sounds two beats early, with no error anywhere.
//     The repair replaces each placeholder with real rests that sum to the gap.
//     (The older song-named AlphaTex files in this repo were converted without
//     it: look for `r.256` and a voice displaced by 1/64 beat.)
//
//  2. NOTES DROPPED BY THE IMPORTER. alphaTab's MusicXML support is broad but
//     not total. musicXmlNoteAudit() counts pitched/unpitched <note> elements
//     per part straight from the XML text and compares them with the model.
//     It is a COUNT, deliberately — not a second parser: no pitch, rhythm or
//     harmony is ever read from the XML outside alphaTab.
//
//  3. TIES ON TRANSPOSING PARTS. MusicXML writes a B-flat clarinet, an F horn
//     or a guitar (octave-change -1) at WRITTEN pitch plus <transpose>.
//     alphaTab's _parseNote resolves <notations><tied> BEFORE it applies the
//     transposition, so a tie-stop's written pitch is matched against tie-starts
//     already stored at sounding pitch. It links to a stale start of the "same"
//     value (or to none), and Note.finish() then copies that stale origin's
//     pitch onto the note: a wrong pitch, a lost tie, or both. On the first real
//     score imported, 66 of 469 ties were affected. concertPitchNormalize()
//     therefore rewrites every pitch of a transposing part to CONCERT pitch in
//     the XML text and removes the <transpose> element before alphaTab sees it
//     — a text normalizer at the boundary, like the AT218 one, touching only
//     <pitch>, <accidental>, <key> and <transpose> inside those parts. The
//     source.alphatab therefore shows every part at concert pitch, which is what
//     a guitarist arranging from it wants anyway.
//
// transpositionCheck() is the cheap sanity test that the concert reading is
// right: a transposing part should be MORE consonant with the rest of the
// ensemble at concert pitch than at its written pitch.
//
// Track roles: analyzeTracks() and proposeMelodySpans() describe each part
// (register, monophony, stepwise motion) and propose which track carries the
// melody in each section. That proposal is written to source-roles.json for a
// human to review at Gate A; tools/lib/analysis.mjs applies it. It is a
// proposal, never a silent decision — the reason and the runner-up are kept.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as alphaTab from '@coderline/alphatab';

export const IMPORT_EXTENSIONS = ['.mxl', '.musicxml', '.xml'];
export const QUARTER_TICKS = 960;

const Duration = alphaTab.model.Duration;
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const midiName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
// alphaTab stores part names with non-breaking spaces; reports and roles files
// use ordinary ones so they read and grep normally.
const trackName = (track) => (track.name || '').replace(/ /g, ' ');
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Error carrying the CLI exit code it maps to (1 = content, 2 = usage/IO). */
export class ImportError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

// --------------------------------------------------------------------------- //
// reading the container
// --------------------------------------------------------------------------- //

/** Minimal ZIP reader for .mxl (stored + deflate). Returns Map(name -> reader). */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError('not a ZIP container (a .mxl must be compressed MusicXML)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ImportError('corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    entries.set(name, () => {
      const n = buf.readUInt16LE(lho + 26);
      const x = buf.readUInt16LE(lho + 28);
      const data = buf.subarray(lho + 30 + n + x, lho + 30 + n + x + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new ImportError(`unsupported ZIP compression method ${method} for ${name}`);
    });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

function decodeXml(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return Buffer.from(bytes).toString('utf16le').slice(1);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes);
    swapped.swap16();
    return swapped.toString('utf16le').slice(1);
  }
  const text = Buffer.from(bytes).toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The MusicXML text inside a .mxl / .musicxml / .xml file. */
export function readMusicXmlText(bytes, ext) {
  if (ext === '.mxl') {
    const entries = zipEntries(Buffer.from(bytes));
    let root = null;
    const container = entries.get('META-INF/container.xml');
    if (container) root = /full-path="([^"]+)"/.exec(decodeXml(container()))?.[1] ?? null;
    if (!root || !entries.has(root)) {
      root = [...entries.keys()].find((n) => !n.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(n)) ?? null;
    }
    if (!root) throw new ImportError('.mxl container holds no MusicXML root file');
    return decodeXml(entries.get(root)());
  }
  return decodeXml(bytes);
}

// --------------------------------------------------------------------------- //
// concert-pitch normalizer (hazard 3)
// --------------------------------------------------------------------------- //

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_SPELL = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELL = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

const tagInt = (block, tag) => {
  const m = new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`).exec(block);
  return m ? Number(m[1]) : 0;
};

function readTranspose(block) {
  const octaveChange = tagInt(block, 'octave-change');
  const head = /<transpose\b[^>]*>/.exec(block)[0];
  const staff = /number="(\d+)"/.exec(head)?.[1];
  return {
    semitones: tagInt(block, 'chromatic') + 12 * octaveChange,
    diatonic: tagInt(block, 'diatonic') + 7 * octaveChange,
    staff: staff ? Number(staff) : null,
  };
}

/** Respell one <pitch> block `semitones` higher, keeping the diatonic letter
 *  motion the <transpose> element declares. Returns null if unreadable. */
function transposePitchBlock(block, t, preferFlat) {
  const step = /<step>\s*([A-G])\s*<\/step>/.exec(block)?.[1];
  const octaveM = /<octave>\s*(-?\d+)\s*<\/octave>/.exec(block);
  if (!step || !octaveM) return null;
  const alter = Math.trunc(Number(/<alter>\s*(-?[\d.]+)\s*<\/alter>/.exec(block)?.[1] ?? 0)) || 0;
  const octave = Number(octaveM[1]);
  const target = (octave + 1) * 12 + STEP_PC[step] + alter + t.semitones;
  const li = LETTERS.indexOf(step) + octave * 7 + t.diatonic;
  let newStep = LETTERS[((li % 7) + 7) % 7];
  let newOct = Math.floor(li / 7);
  let newAlter = target - ((newOct + 1) * 12 + STEP_PC[newStep]);
  if (Math.abs(newAlter) > 2) {
    [newStep, newAlter] = (preferFlat ? FLAT_SPELL : SHARP_SPELL)[((target % 12) + 12) % 12];
    newOct = Math.floor((target - STEP_PC[newStep] - newAlter) / 12) - 1;
  }
  return `<pitch><step>${newStep}</step>${newAlter ? `<alter>${newAlter}</alter>` : ''}<octave>${newOct}</octave></pitch>`;
}

const normFifths = (f) => ((((f + 6) % 12) + 12) % 12) - 6;

/**
 * Rewrite every transposing part to concert pitch. Parts without <transpose>
 * are byte-identical. Returns { xml, parts: [{ part, transposes, pitches,
 * accidentalsDropped, keys }] } — one record per rewritten part.
 */
export function concertPitchNormalize(xml) {
  const parts = [];
  // The concert key the untransposed parts agree on, used to tell a written
  // key signature (needs transposing) from one an exporter already wrote at
  // concert pitch (MuseScore 3 does this) — which must be left alone.
  const keyVotes = new Map();
  for (const m of xml.matchAll(/<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g)) {
    if (/<transpose\b/.test(m[2])) continue;
    const f = /<fifths>\s*(-?\d+)\s*<\/fifths>/.exec(m[2]);
    if (f) keyVotes.set(Number(f[1]), (keyVotes.get(Number(f[1])) ?? 0) + 1);
  }
  const concertKey = [...keyVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const out = xml.replace(/(<part\s+id="([^"]+)"[^>]*>)([\s\S]*?)(<\/part>)/g, (whole, open, id, body, close) => {
    if (!/<transpose\b/.test(body)) return whole;
    const rec = { part: id, transposes: [], pitches: 0, accidentalsDropped: 0, keys: [] };
    let partWide = { semitones: 0, diatonic: 0 };
    const perStaff = new Map();
    const rewriteKey = (el) => {
      const t = partWide;
      if (!t.semitones) return el;
      const f = /<fifths>\s*(-?\d+)\s*<\/fifths>/.exec(el);
      if (!f) return el;
      const written = Number(f[1]);
      const concert = normFifths(written + 7 * t.semitones);
      if (concertKey !== null && written === concertKey) {
        rec.keys.push({ written, concert: written, note: 'already at concert pitch' });
        return el;
      }
      rec.keys.push({ written, concert });
      return el.replace(/<fifths>\s*-?\d+\s*<\/fifths>/, `<fifths>${concert}</fifths>`);
    };
    const rewritten = body.replace(/<attributes\b[\s\S]*?<\/attributes>|<note\b[\s\S]*?<\/note>/g, (el) => {
      if (el.startsWith('<attributes')) {
        // A <transpose> governs the <key> of its own <attributes> block even
        // when it is written after it, so read the transposition first.
        for (const m of el.matchAll(/<transpose\b[\s\S]*?<\/transpose>/g)) {
          const t = readTranspose(m[0]);
          rec.transposes.push(t);
          if (t.staff === null) {
            partWide = t;
            perStaff.clear();
          } else perStaff.set(t.staff, t);
        }
        return el.replace(/<transpose\b[\s\S]*?<\/transpose>/g, '').replace(/<key\b[\s\S]*?<\/key>/g, rewriteKey);
      }
      const t = partWide;
      // a <note>
      if (!/<pitch>/.test(el)) return el;
      const staff = Number(/<staff>\s*(\d+)\s*<\/staff>/.exec(el)?.[1] ?? 1);
      const nt = perStaff.get(staff) ?? t;
      if (!nt.semitones && !nt.diatonic) return el;
      let changed = el.replace(/<pitch>[\s\S]*?<\/pitch>/, (p) => {
        const np = transposePitchBlock(p, nt, (concertKey ?? 0) < 0);
        return np ?? p;
      });
      if (changed !== el) rec.pitches++;
      changed = changed.replace(/<accidental\b[^>]*\/>|<accidental\b[^>]*>[\s\S]*?<\/accidental>/g, () => {
        rec.accidentalsDropped++;
        return '';
      });
      return changed;
    });
    parts.push(rec);
    return open + rewritten + close;
  });
  return { xml: out, parts };
}

/** Map(track index -> written-to-concert semitones) for the parts the
 *  normalizer rewrote. Track index = position in <part-list>, which is the
 *  order alphaTab builds tracks in. */
export function concertOffsets(xml, concertParts) {
  const order = [...xml.matchAll(/<score-part\s+id="([^"]+)"/g)].map((m) => m[1]);
  const out = new Map();
  for (const p of concertParts) {
    const i = order.indexOf(p.part);
    const t = p.transposes.find((x) => x.semitones);
    if (i >= 0 && t) out.set(i, t.semitones);
  }
  return out;
}

/**
 * Load a MusicXML file into an alphaTab Score. Refuses anything that is not
 * MusicXML by extension AND by content — a .xml that is not a score must not
 * be handed to whichever importer happens to accept it. Transposing parts are
 * normalized to concert pitch first (hazard 3).
 */
export function loadMusicXml(file) {
  const ext = path.extname(file).toLowerCase();
  if (!IMPORT_EXTENSIONS.includes(ext)) {
    throw new ImportError(`unsupported input "${ext}": score-import reads MusicXML (${IMPORT_EXTENSIONS.join(', ')}). `
      + 'An AlphaTex source needs no import — put it at projects/<slug>/source.alphatab.', 2);
  }
  if (!fs.existsSync(file)) throw new ImportError(`not found: ${file}`, 2);
  const bytes = fs.readFileSync(file);
  const original = readMusicXmlText(bytes, ext);
  if (!/<score-(partwise|timewise)[\s>]/.test(original)) {
    throw new ImportError(`${path.basename(file)} is not a MusicXML score (no <score-partwise>/<score-timewise>)`);
  }
  if (/<score-timewise[\s>]/.test(original)) {
    throw new ImportError('score-timewise MusicXML is not supported; re-export as partwise (the default in every notation program)');
  }
  const concert = concertPitchNormalize(original);
  const settings = new alphaTab.Settings();
  let score;
  try {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(Buffer.from(concert.xml, 'utf8')), settings);
  } catch (e) {
    throw new ImportError(`alphaTab could not import ${path.basename(file)}: ${e.message ?? e}`);
  }
  if (!score || !score.tracks.length || !score.masterBars.length) {
    throw new ImportError(`${path.basename(file)} imported as an empty score`);
  }
  return { score, settings, xml: concert.xml, concertParts: concert.parts };
}

// --------------------------------------------------------------------------- //
// independent note-count audit (count only — never a second parser)
// --------------------------------------------------------------------------- //

/** Per-part note counts read from the MusicXML text, in part-list order. */
export function musicXmlNoteAudit(xml) {
  const order = [...xml.matchAll(/<score-part\s+id="([^"]+)"/g)].map((m) => m[1]);
  const parts = new Map();
  for (const m of xml.matchAll(/<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g)) {
    let pitched = 0;
    let unpitched = 0;
    let cue = 0;
    for (const n of m[2].matchAll(/<note\b[\s\S]*?<\/note>/g)) {
      const body = n[0];
      if (/<cue\s*\/>/.test(body)) { cue++; continue; }
      if (/<pitch>/.test(body)) pitched++;
      else if (/<unpitched>/.test(body)) unpitched++;
    }
    parts.set(m[1], { id: m[1], pitched, unpitched, cue });
  }
  return order.map((id) => parts.get(id) ?? { id, pitched: 0, unpitched: 0, cue: 0 });
}

function modelNoteCount(track) {
  let n = 0;
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) if (!beat.isEmpty) n += beat.notes.length;
      }
    }
  }
  return n;
}

/** Compare the XML counts with what alphaTab built. Returns rows + problems. */
export function compareNoteAudit(score, xmlAudit) {
  const rows = [];
  const problems = [];
  if (xmlAudit.length !== score.tracks.length) {
    problems.push(`MusicXML lists ${xmlAudit.length} part(s) but alphaTab built ${score.tracks.length} track(s)`);
  }
  score.tracks.forEach((track, i) => {
    const part = xmlAudit[i];
    const model = modelNoteCount(track);
    const expected = part ? part.pitched + part.unpitched : null;
    rows.push({ track: i, part: part?.id ?? null, xmlNotes: expected, modelNotes: model, cueSkipped: part?.cue ?? 0 });
    if (expected !== null && expected !== model) {
      problems.push(`track ${i} (${trackName(track)}): MusicXML part ${part.id} has ${expected} note(s), alphaTab built ${model}`);
    }
  });
  return { rows, problems };
}

// --------------------------------------------------------------------------- //
// export hazards
// --------------------------------------------------------------------------- //

// Largest-first rest decomposition, dotted values included so a 3/4-bar gap is
// one dotted half rather than three quarters.
const REST_VALUES = [
  [3840, Duration.Whole, 0], [2880, Duration.Half, 1], [1920, Duration.Half, 0],
  [1440, Duration.Quarter, 1], [960, Duration.Quarter, 0], [720, Duration.Eighth, 1],
  [480, Duration.Eighth, 0], [360, Duration.Sixteenth, 1], [240, Duration.Sixteenth, 0],
  [120, Duration.ThirtySecond, 0], [60, Duration.SixtyFourth, 0],
];

function restsFor(ticks) {
  const out = [];
  let left = ticks;
  for (const [t, duration, dots] of REST_VALUES) {
    while (left >= t) {
      out.push({ ticks: t, duration, dots });
      left -= t;
    }
  }
  return { rests: out, remainder: left };
}

/**
 * Replace alphaTab's forward-gap placeholder beats with real rests, so the
 * exported AlphaTex keeps every voice on its written beat. Mutates `score`
 * and re-finishes it. Returns one record per repaired placeholder.
 */
export function repairExportHazards(score, settings) {
  const repairs = [];
  score.tracks.forEach((track, t) => {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          if (!voice.beats.some((b) => b.isEmpty && b.duration === Duration.TwoHundredFiftySixth)) continue;
          if (voice.beats.every((b) => b.isEmpty)) continue; // an untouched empty voice is fine
          const rebuilt = [];
          for (const beat of voice.beats) {
            if (!(beat.isEmpty && beat.duration === Duration.TwoHundredFiftySixth)) {
              rebuilt.push(beat);
              continue;
            }
            const gap = beat.playbackDuration;
            const { rests, remainder } = restsFor(gap);
            for (const r of rests) {
              const rest = new alphaTab.model.Beat();
              rest.isEmpty = false;
              rest.duration = r.duration;
              rest.dots = r.dots;
              rest.dynamics = beat.dynamics;
              rebuilt.push(rest);
            }
            repairs.push({
              track: t, trackName: trackName(track), staff: staff.index, bar: bar.index + 1, voice: voice.index,
              gapTicks: gap, rests: rests.map((r) => r.ticks), droppedTicks: remainder,
            });
          }
          voice.beats = [];
          for (const b of rebuilt) voice.addBeat(b);
        }
      }
    }
  });
  if (repairs.length) score.finish(settings);
  return repairs;
}

/**
 * MusicXML drum parts define their own kit (one articulation per instrument,
 * each with a GM output note). The AlphaTex exporter cannot write a custom kit
 * and names every hit "Snare (hit)", so the re-parsed drums collapse to one
 * sound. Re-index each hit to alphaTab's default GM articulation with the same
 * output note — which the exporter CAN name — so the source audition keeps its
 * groove. Only when every custom articulation has a GM note; otherwise the kit
 * is left alone and the round trip reports what would be lost.
 */
export function normalizeDrumKit(score, settings) {
  const out = [];
  score.tracks.forEach((track, t) => {
    const arts = track.percussionArticulations ?? [];
    if (!arts.length || !arts.every((a) => Number.isInteger(a.outputMidiNumber) && a.outputMidiNumber >= 27 && a.outputMidiNumber <= 87)) return;
    let hits = 0;
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const n of beat.notes) {
              if (n.percussionArticulation >= 0 && arts[n.percussionArticulation]) {
                n.percussionArticulation = arts[n.percussionArticulation].outputMidiNumber;
                hits++;
              }
            }
          }
        }
      }
    }
    track.percussionArticulations = [];
    out.push({ track: t, trackName: trackName(track), instruments: arts.map((a) => a.outputMidiNumber), hits });
  });
  if (out.length) score.finish(settings);
  return out;
}

// --------------------------------------------------------------------------- //
// round trip
// --------------------------------------------------------------------------- //

const drumNote = (track, n) => track.percussionArticulations?.[n.percussionArticulation]?.outputMidiNumber
  ?? n.percussionArticulation;

/** Per (track, staff, bar, voice): the attack list a listener would hear. */
function attackSignature(score) {
  const sig = new Map();
  score.tracks.forEach((track, t) => {
    track.staves.forEach((staff, s) => {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          const events = [];
          for (const beat of voice.beats) {
            if (beat.isEmpty || beat.isRest) continue;
            const pitches = beat.notes
              .map((n) => `${staff.isPercussion ? `p${drumNote(track, n)}` : n.realValue}${n.isTieDestination ? '~' : ''}`)
              .sort();
            events.push({ start: beat.playbackStart, dur: beat.playbackDuration, pitches: pitches.join(',') });
          }
          if (events.length) sig.set(`${t}/${s}/${bar.index + 1}/${voice.index}`, events);
        }
      }
    });
  });
  return sig;
}

// Tuplet durations are integer ticks; the importer and the AlphaTex parser
// round a 7:4 sixteenth (137.14 ticks) differently, and the difference
// accumulates by about a tick per tuplet note. Ten ticks (~6 ms at 100 bpm)
// absorbs that; real corruption moves a note by at least a 128th (30 ticks).
const TICK_TOLERANCE = 10;
const sameEvent = (x, y) => x && y && x.pitches === y.pitches
  && Math.abs(x.start - y.start) <= TICK_TOLERANCE && Math.abs(x.dur - y.dur) <= TICK_TOLERANCE;
const showEvent = (e) => (e ? `${e.start}+${e.dur}:${e.pitches}` : '(none)');

export function exportAlphaTex(score, settings) {
  return new alphaTab.exporter.AlphaTexExporter().exportToString(score, settings);
}

/**
 * Re-parse the exported AlphaTex and compare every attack (onset, duration,
 * sounding pitch, tie) against the model it was exported from. Any difference
 * is a fidelity loss at the format boundary and fails the import.
 */
export function roundTripAudit(score, text) {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(text, settings);
  let reparsed;
  try {
    reparsed = importer.readScore();
  } catch (e) {
    return { ok: false, mismatches: [`exported AlphaTex does not parse: ${e.message ?? e}`], compared: 0 };
  }
  const mismatches = [];
  if (reparsed.masterBars.length !== score.masterBars.length) {
    mismatches.push(`bar count ${score.masterBars.length} -> ${reparsed.masterBars.length}`);
  }
  if (reparsed.tracks.length !== score.tracks.length) {
    mismatches.push(`track count ${score.tracks.length} -> ${reparsed.tracks.length}`);
  }
  const a = attackSignature(score);
  const b = attackSignature(reparsed);
  let compared = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? [];
    const y = b.get(key) ?? [];
    compared += x.length;
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) {
      if (sameEvent(x[i], y[i])) continue;
      mismatches.push(`track/staff/bar/voice ${key}: first difference at event ${i}: ${showEvent(x[i])} -> ${showEvent(y[i])}`);
      break;
    }
  }
  for (let i = 0; i < Math.min(score.masterBars.length, reparsed.masterBars.length); i++) {
    const m = score.masterBars[i];
    const r = reparsed.masterBars[i];
    if (m.timeSignatureNumerator !== r.timeSignatureNumerator || m.timeSignatureDenominator !== r.timeSignatureDenominator) {
      mismatches.push(`bar ${i + 1}: meter ${m.timeSignatureNumerator}/${m.timeSignatureDenominator} -> ${r.timeSignatureNumerator}/${r.timeSignatureDenominator}`);
    }
    const tm = (m.tempoAutomations ?? []).map((x) => x.value).join(',');
    const tr = (r.tempoAutomations ?? []).map((x) => x.value).join(',');
    if (tm !== tr) mismatches.push(`bar ${i + 1}: tempo ${tm || '-'} -> ${tr || '-'}`);
  }
  return { ok: mismatches.length === 0, mismatches, compared };
}

// --------------------------------------------------------------------------- //
// track selection
// --------------------------------------------------------------------------- //

/** Keep only `indices` (in that order). Mutates and re-finishes the score. */
export function selectTracks(score, settings, indices) {
  const keep = indices.map((i) => {
    if (!Number.isInteger(i) || i < 0 || i >= score.tracks.length) {
      throw new ImportError(`--tracks: no track ${i} (score has 0..${score.tracks.length - 1})`, 2);
    }
    return score.tracks[i];
  });
  score.tracks = keep;
  keep.forEach((t, i) => { t.index = i; });
  score.finish(settings);
}

// --------------------------------------------------------------------------- //
// track analysis and melody-carrier proposal
// --------------------------------------------------------------------------- //

const GM_FAMILIES = [
  'piano', 'chromatic percussion', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass',
  'reed', 'pipe', 'synth lead', 'synth pad', 'synth effects', 'ethnic', 'percussive', 'sound effects',
];

export function isPercussionTrack(track) {
  return track.staves.some((s) => s.isPercussion)
    || track.playbackInfo?.primaryChannel === 9
    || track.staves.some((s) => (s.percussionArticulations?.length ?? 0) > 0);
}

/** Top-line attacks of one track over bar range [a, b] (0-based, inclusive). */
function lineStats(track, a, b) {
  const onsets = new Map();  // absolute tick -> { top, count, dur }
  let notes = 0;
  let pitchSum = 0;
  let durSum = 0;
  const activeBars = new Set();
  let lo = Infinity;
  let hi = -Infinity;
  for (const staff of track.staves) {
    for (let bi = a; bi <= b; bi++) {
      const bar = staff.bars[bi];
      if (!bar) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.isEmpty || beat.isRest) continue;
          for (const n of beat.notes) {
            if (n.isTieDestination) continue;
            const midi = n.realValue;
            activeBars.add(bi);
            notes++;
            pitchSum += midi;
            durSum += beat.playbackDuration / QUARTER_TICKS;
            lo = Math.min(lo, midi);
            hi = Math.max(hi, midi);
            const key = beat.absolutePlaybackStart;
            const o = onsets.get(key);
            if (!o) onsets.set(key, { top: midi, count: 1 });
            else {
              o.count++;
              o.top = Math.max(o.top, midi);
            }
          }
        }
      }
    }
  }
  const keys = [...onsets.keys()].sort((x, y) => x - y);
  let steps = 0;
  let leaps = 0;
  let repeats = 0;
  for (let i = 1; i < keys.length; i++) {
    const d = Math.abs(onsets.get(keys[i]).top - onsets.get(keys[i - 1]).top);
    if (d === 0) repeats++;
    else if (d <= 2) steps++;
    else leaps++;
  }
  const single = [...onsets.values()].filter((o) => o.count === 1).length;
  return {
    notes,
    attacks: keys.length,
    activeBars: activeBars.size,
    meanPitch: notes ? pitchSum / notes : null,
    meanDuration: notes ? durSum / notes : null,
    lo: notes ? lo : null,
    hi: notes ? hi : null,
    monophony: keys.length ? single / keys.length : 0,
    stepwise: steps + leaps ? steps / (steps + leaps) : 0,
    repetition: keys.length > 1 ? repeats / (keys.length - 1) : 0,
  };
}

/**
 * How melodic a line is, 0..1: present for the span, one note at a time,
 * moving mostly by step. An arpeggio (monophonic but leaping), a pad (sparse,
 * polyphonic) and a comping part (chords) all score low; a sung line scores
 * high. Bass-register lines are not melody candidates.
 */
export function melodicScore(stats, spanBars) {
  if (!stats.attacks || stats.meanPitch === null || stats.meanPitch < 52) return 0;
  if (stats.attacks < 2 * Math.max(1, stats.activeBars) * 0.5) return 0;
  const coverage = Math.min(1, stats.activeBars / Math.max(1, spanBars));
  return round(coverage * stats.monophony * stats.stepwise * (1 - 0.5 * stats.repetition), 3);
}

function describeRole(stats, percussion) {
  if (percussion) return 'percussion';
  if (!stats.notes) return 'empty';
  if (stats.meanPitch < 50 && stats.monophony >= 0.7) return 'bass';
  if (stats.monophony < 0.5) return stats.meanDuration >= 2 ? 'pad' : 'chords';
  if (stats.monophony >= 0.75 && stats.stepwise >= 0.45) return 'melodic line';
  if (stats.monophony >= 0.75 && stats.stepwise < 0.3) return 'arpeggio/figure';
  return 'mixed';
}

/** Section spans [a, b] (0-based) from the score's own section marks. */
export function scoreSections(score) {
  const n = score.masterBars.length;
  const starts = [0];
  for (const mb of score.masterBars) if (mb.section && mb.index > 0) starts.push(mb.index);
  if (starts.length === 1 && n > 8) for (let i = 8; i < n; i += 8) starts.push(i);
  starts.push(n);
  const out = [];
  for (let i = 0; i < starts.length - 1; i++) {
    if (starts[i + 1] > starts[i]) {
      const mb = score.masterBars[starts[i]];
      out.push({ a: starts[i], b: starts[i + 1] - 1, marker: mb.section ? (mb.section.marker || mb.section.text || '') : '' });
    }
  }
  return out;
}

/** `offsets`: Map(track -> semitones the written part was moved to reach concert pitch). */
export function analyzeTracks(score, offsets = new Map()) {
  const n = score.masterBars.length;
  return score.tracks.map((track, i) => {
    const percussion = isPercussionTrack(track);
    const stats = percussion ? { notes: modelNoteCount(track) } : lineStats(track, 0, n - 1);
    const program = track.playbackInfo?.program ?? null;
    return {
      track: i,
      name: trackName(track) || `Track ${i + 1}`,
      shortName: track.shortName || null,
      program,
      family: percussion ? 'percussion' : (program === null ? null : GM_FAMILIES[Math.floor(program / 8)] ?? null),
      channel: (track.playbackInfo?.primaryChannel ?? -1) + 1,
      staves: track.staves.length,
      percussion,
      // Written-to-concert offset the normalizer applied (B-flat clarinet -2,
      // F horn -7, guitar -12). Every pitch below is CONCERT pitch.
      concertOffset: offsets.get(i) ?? 0,
      notes: stats.notes,
      attacks: stats.attacks ?? null,
      activeBars: stats.activeBars ?? null,
      range: stats.lo === undefined || stats.lo === null ? null
        : { lo: stats.lo, hi: stats.hi, loName: midiName(stats.lo), hiName: midiName(stats.hi) },
      meanPitch: stats.meanPitch == null ? null : round(stats.meanPitch, 1),
      monophony: stats.monophony == null ? null : round(stats.monophony),
      stepwise: stats.stepwise == null ? null : round(stats.stepwise),
      role: describeRole(stats, percussion),
    };
  });
}

/**
 * Propose, per section, which track carries the melody. Adjacent sections
 * with the same carrier merge into one span. Each span keeps the runner-up and
 * both scores so a reviewer can see how close the call was.
 */
export function proposeMelodySpans(score, trackInfo) {
  const candidates = trackInfo.filter((t) => !t.percussion && t.notes > 0).map((t) => t.track);
  const spans = [];
  for (const sec of scoreSections(score)) {
    const len = sec.b - sec.a + 1;
    const ranked = candidates
      .map((t) => ({ track: t, score: melodicScore(lineStats(score.tracks[t], sec.a, sec.b), len) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score || x.track - y.track);
    const best = ranked[0] ?? null;
    const runnerUp = ranked[1] ?? null;
    const tracks = best ? [best.track] : [];
    const evidence = {
      section: sec.marker || null,
      best: best ? { track: best.track, name: trackInfo[best.track].name, score: best.score } : null,
      runnerUp: runnerUp ? { track: runnerUp.track, name: trackInfo[runnerUp.track].name, score: runnerUp.score } : null,
      margin: best ? round(best.score - (runnerUp?.score ?? 0), 3) : null,
    };
    const prev = spans[spans.length - 1];
    if (prev && prev.tracks.join(',') === tracks.join(',')) {
      prev.bars[1] = sec.b + 1;
      prev.evidence.push(evidence);
    } else {
      spans.push({ bars: [sec.a + 1, sec.b + 1], tracks, evidence: [evidence] });
    }
  }
  // Rehearsal marks sit on downbeats, but phrases start with pickups: the
  // clarinet's two-note lead-in to a verse lives in the last bar of the synth
  // interlude. Move a span edge across any bar where the span's own carrier
  // is silent and the neighbouring carrier plays, so the pickup stays with
  // its phrase instead of leaving a bar whose designated melody "rests".
  const active = (tracks, bar) => tracks.some((t) => {
    for (const staff of score.tracks[t].staves) {
      const b = staff.bars[bar - 1];
      if (b && b.voices.some((v) => v.beats.some((x) => !x.isEmpty && !x.isRest))) return true;
    }
    return false;
  });
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i];
    const b = spans[i + 1];
    while (a.bars[1] > a.bars[0] && !active(a.tracks, a.bars[1]) && active(b.tracks, a.bars[1])) {
      a.bars[1]--;
      b.bars[0]--;
      b.movedEdge = true;
    }
    while (b.bars[0] < b.bars[1] && !active(b.tracks, b.bars[0]) && active(a.tracks, b.bars[0])) {
      b.bars[0]++;
      a.bars[1]++;
      a.movedEdge = true;
    }
  }
  for (const s of spans) {
    const names = s.tracks.map((t) => trackInfo[t].name).join(' + ');
    const close = s.evidence.some((e) => e.margin !== null && e.margin < 0.1);
    s.note = `${names} carries the line${close ? ' — CLOSE CALL, audition the runner-up' : ''}`
      + `${s.movedEdge ? ' (span edge moved to keep a pickup with its phrase)' : ''}`;
    delete s.movedEdge;
  }
  // A section where no track reads as a melodic line (a chordal intro, a drum
  // break) gets NO span: those bars keep the register heuristic, marked `reg:`
  // in the map, so the lead sheet still shows their top line. Declaring
  // `tracks: []` (the melody rests) is a human decision, never a proposal.
  return spans.filter((s) => s.tracks.length);
}

/** Bar ranges [a, b] (1-based) that no span covers — the register-heuristic bars. */
export function uncoveredBars(spans, barCount) {
  const out = [];
  let next = 1;
  for (const s of [...spans].sort((x, y) => x.bars[0] - y.bars[0])) {
    if (s.bars[0] > next) out.push([next, s.bars[0] - 1]);
    next = Math.max(next, s.bars[1] + 1);
  }
  if (next <= barCount) out.push([next, barCount]);
  return out;
}

/**
 * A tie joins two ADJACENT notes of one pitch on one staff. A tie whose origin
 * ends before the destination starts (other notes or silence between) cannot
 * sound as one note; alphaTab's player would silence the destination. Such a
 * tie is cleared — the destination becomes the fresh attack the ear expects —
 * and reported. Mutates and re-finishes the score.
 */
export function repairDetachedTies(score, settings) {
  const repairs = [];
  score.tracks.forEach((track, t) => {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              if (!note.isTieDestination) continue;
              const o = note.tieOrigin;
              const attached = o
                && o.beat.voice.bar.staff === staff
                && o.realValue === note.realValue
                && o.beat.absolutePlaybackStart + o.beat.playbackDuration === beat.absolutePlaybackStart;
              if (attached) continue;
              repairs.push({
                track: t, trackName: trackName(track), staff: staff.index, bar: bar.index + 1, voice: voice.index,
                beatTick: beat.playbackStart, pitch: midiName(note.realValue),
                origin: o ? { bar: o.beat.voice.bar.index + 1, tick: o.beat.playbackStart } : null,
              });
              if (o && o.tieDestination === note) o.tieDestination = null;
              note.tieOrigin = null;
              note.isTieDestination = false;
            }
          }
        }
      }
    }
  });
  if (repairs.length) score.finish(settings);
  return repairs;
}

/**
 * Consonance of each transposed part against the rest of the ensemble, at
 * concert pitch versus its written pitch. If the written reading is clearly
 * more consonant, the exporting program probably wrote concert pitch AND a
 * <transpose> element — stop and check before trusting the digest.
 * `offsets`: Map(track index -> written-to-sounding semitones), from the
 * concert-pitch normalizer.
 */
export function transpositionCheck(score, offsets) {
  const events = score.tracks.map((track) => {
    if (isPercussionTrack(track)) return [];
    const out = [];
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isEmpty || beat.isRest) continue;
            const s = beat.absolutePlaybackStart;
            for (const n of beat.notes) out.push([s, s + beat.playbackDuration, n.realValue]);
          }
        }
      }
    }
    return out;
  });
  const results = [];
  score.tracks.forEach((track, t) => {
    const offset = offsets.get(t) ?? 0;
    if (!offset || !events[t].length) return;
    const others = events.filter((_, k) => k !== t).flat();
    if (!others.length) return;
    others.sort((x, y) => x[0] - y[0]);
    const consonance = (shift) => {
      let hit = 0;
      let total = 0;
      let lo = 0;
      for (const [s, e, m] of events[t]) {
        while (lo < others.length && others[lo][0] < s - 4 * 3840) lo++;
        const pcs = new Set();
        for (let k = lo; k < others.length && others[k][0] < e; k++) {
          if (others[k][1] > s) pcs.add(((others[k][2] % 12) + 12) % 12);
        }
        if (!pcs.size) continue;
        total++;
        if (pcs.has((((m + shift) % 12) + 12) % 12)) hit++;
      }
      return total ? hit / total : null;
    };
    const sounding = consonance(0);
    const written = consonance(-offset);
    if (sounding === null || written === null) return;
    results.push({
      track: t,
      name: trackName(track),
      soundsSemitones: offset,
      soundingConsonance: round(sounding, 3),
      writtenConsonance: round(written, 3),
      suspicious: written > sounding + 0.1,
    });
  });
  return results;
}

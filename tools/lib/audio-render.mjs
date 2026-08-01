// tools/lib/audio-render.mjs — offline PCM synthesis, and the WAV container.
// PTG-native (Wave 5). OPTIONAL tooling: nothing in the gate path imports this.
// Contract C1 (one runtime dependency) and C15 (never claim SoundFont playback
// simulates amp tone) govern it.
//
// WHAT THIS IS AND IS NOT
// -----------------------
// It renders the NOTES to audio so you can hear the arrangement away from a
// screen. It is not a tone reference and cannot be one: a General MIDI clean
// guitar sample says nothing about gain staging, cabinet response, pickup
// choice or pick attack, which are most of what a rock arrangement lives or
// dies by. C15 forbids claiming otherwise and the CLI says so on every run. For
// tone, export MIDI and route it through an amp sim.
//
// THE FEASIBILITY RESULT THIS FILE ENCODES
// ----------------------------------------
// `docs/specs/audio-rendering-decision.md` has the full record. The short form,
// measured against the pinned `@coderline/alphatab@1.8.4`:
//
//   • `AlphaTabApi` — which owns the DOCUMENTED `exportAudio` — refuses to
//     construct outside a browser, by design: "Usage of AlphaTabApi is only
//     possible in browser environments. For usage in node use the Low Level
//     APIs". So the documented path is genuinely unavailable here.
//   • The low-level path IS available. `AlphaSynth` accepts any object shaped
//     like its output sink, and none of the sink's methods are called during an
//     offline export — so a stub of no-ops is enough, and no Web Audio, no
//     AudioContext and no worklet is involved.
//   • A SoundFont ships INSIDE the package (`dist/soundfont/sonivox.sf2`), so
//     this needs no new dependency and no new repository asset.
//
// One trap worth recording because it cost a false negative during the spike:
// an output stub that ACCUMULATES the samples handed to it will exhaust memory
// or the stack on a long render. The offline exporter returns its audio from
// `render()`; the sink is a formality. Keep it a no-op.

import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';

/** The SoundFont bundled with the pinned alphaTab — no new asset needed. */
export const BUNDLED_SOUNDFONT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
  'node_modules', '@coderline', 'alphatab', 'dist', 'soundfont', 'sonivox.sf2');

export const DEFAULT_SAMPLE_RATE = 44100;
/** Frames per `render()` call. The exporter returns as much as it has, so this
 *  is a floor on chunk size rather than a cap. */
const RENDER_FRAMES = 4096;
/** Backstop against a renderer that never reports the end of the stream. At
 *  4096 frames a chunk this is hours of audio — it can only fire on a bug. */
const MAX_CHUNKS = 20000;

/** A no-op sink. AlphaSynth requires one; an offline export never feeds it. */
function silentOutput(sampleRate) {
  const noop = () => {};
  const ev = { on: noop, off: noop, trigger: noop };
  return {
    sampleRate,
    open: noop,
    play: noop,
    pause: noop,
    destroy: noop,
    activate: noop,
    resetSamples: noop,
    addSamples: noop,
    sequencerFinished: noop,
    ready: ev,
    samplesPlayed: ev,
    sampleRequest: ev,
  };
}

/**
 * Render a parsed score to interleaved stereo float samples.
 *
 * @param {object} score alphaTab Score.
 * @param {object} [opts]
 * @param {string} [opts.soundFont] Path to a `.sf2`. Defaults to the bundled one.
 * @param {number} [opts.sampleRate]
 * @returns {Promise<{ samples: Float32Array, sampleRate: number, channels: number,
 *                     seconds: number, soundFont: string }>}
 */
export async function renderScoreToPcm(score, opts = {}) {
  if (!score || !Array.isArray(score.tracks)) {
    throw new TypeError('renderScoreToPcm: expected a parsed alphaTab Score');
  }
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const soundFontPath = opts.soundFont ?? BUNDLED_SOUNDFONT;
  if (!fs.existsSync(soundFontPath)) {
    throw new Error(`No SoundFont at "${soundFontPath}". Pass --soundfont <file.sf2>.`);
  }
  const sf = fs.readFileSync(soundFontPath);

  const midiFile = new alphaTab.midi.MidiFile();
  // SingleTrackMultiChannel, and NOT MultiTrack — this is a workaround for an
  // upstream defect, recorded here so nobody "fixes" it back.
  //
  // `MidiFile.events` in alphaTab 1.8.4 reads:
  //
  //     get events() {
  //       if (this.tracks.length === 1) return this.tracks[0].events;
  //       const events = [];
  //       for (const t of this.tracks) this.events.push(...t.events);   // <-- bug
  //       ...
  //
  // `this.events.push` re-enters the getter instead of pushing into the local
  // `events`, so reading `.events` on any MULTI-track file recurses until the
  // stack dies. The offline audio exporter reads `.events`; `toBinary()` walks
  // `tracks` directly and is unaffected, which is why tools/export-midi.mjs
  // keeps MultiTrack and only this path steps around it.
  //
  // Nothing is lost here: the synthesiser is channel-based, and
  // SingleTrackMultiChannel preserves every channel — only the SMF track
  // grouping differs, and no audio comes out of that.
  midiFile.format = alphaTab.midi.MidiFileFormat.SingleTrackMultiChannel;
  const generator = new alphaTab.midi.MidiFileGenerator(
    score, new alphaTab.Settings(),
    // smf1Mode — see lib/midi-export.mjs's header for why this is not optional.
    new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, true));
  generator.generate();

  const options = new alphaTab.synth.AudioExportOptions();
  options.sampleRate = sampleRate;
  options.soundFonts = [new Uint8Array(sf.buffer, sf.byteOffset, sf.byteLength)];

  const synth = new alphaTab.synth.AlphaSynth(silentOutput(sampleRate), 200);
  const exporter = await synth.exportAudio(
    options, midiFile, generator.syncPoints, generator.transpositionPitches);

  const chunks = [];
  let total = 0;
  try {
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const chunk = await exporter.render(RENDER_FRAMES);
      if (!chunk?.samples?.length) break;   // the stream's own end-of-audio signal
      chunks.push(chunk.samples);
      total += chunk.samples.length;
    }
  } finally {
    exporter.destroy?.();
  }

  const samples = new Float32Array(total);
  let at = 0;
  for (const c of chunks) { samples.set(c, at); at += c.length; }

  const channels = 2;   // the exporter is interleaved stereo
  return {
    samples,
    sampleRate,
    channels,
    seconds: total / channels / sampleRate,
    soundFont: soundFontPath,
  };
}

/**
 * Wrap interleaved float samples in a 16-bit PCM WAV container.
 *
 * Hand-written because a WAV header is 44 bytes of well-specified struct, and
 * contract C1 does not spend its one-dependency budget on that. This is NOT the
 * "manual serialization" C1 warns about — that clause is about MIDI, where
 * alphaTab already has the API and reimplementing it would fork the semantics.
 * There is no WAV writer in alphaTab to fork.
 */
export function pcmToWav({ samples, sampleRate, channels }) {
  const frames = samples.length / channels;
  const dataBytes = samples.length * 2;              // 16-bit
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);                      // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20);                       // format 1 = PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buffer.writeUInt16LE(channels * 2, 32);            // block align
  buffer.writeUInt16LE(16, 34);                      // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a float above 1.0 would wrap to a loud click, which
    // is the one artefact guaranteed to be blamed on the arrangement.
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return { buffer, frames, seconds: frames / sampleRate };
}

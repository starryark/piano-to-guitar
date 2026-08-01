// tools/lib/midi-export.mjs — turn a parsed score into Standard MIDI bytes.
// PTG-native (Wave 5). Contract C1 (one runtime dependency, no second parser and
// no second MIDI library) governs this file.
//
// WHY MIDI AT ALL
// ---------------
// The gate can tell you a tab is legal. It cannot tell you it is any good — that
// is the human's job at Gate B, and doing it means HEARING the thing. AlphaTab's
// VS Code preview covers the audition, but a MIDI file is what gets the
// arrangement into a DAW, in front of an amp sim, and next to the source. This
// is the low-risk half of Implement.md §5.5/§5.6: export the notes, and let real
// tone tooling do tone. See docs/specs/audio-rendering-decision.md for why the
// synthesis half stayed a spike.
//
// THE API, MEASURED RATHER THAN ASSUMED (Plan §9.3's mandatory feasibility spike)
// ------------------------------------------------------------------------------
// Against the pinned `@coderline/alphatab@1.8.4` the working sequence is:
//
//     const mf = new alphaTab.midi.MidiFile();
//     mf.format = alphaTab.midi.MidiFileFormat.MultiTrack;
//     const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(mf, true);
//     new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
//     const bytes = mf.toBinary();       // Uint8Array beginning "MThd"
//
// THE SECOND CONSTRUCTOR ARGUMENT IS NOT OPTIONAL, and finding that out is the
// whole reason the spike was mandatory. `AlphaSynthMidiFileHandler(mf)` without
// `smf1Mode = true` makes the generator emit MIDI 2.0 per-note pitch-bend
// events, and `toBinary()` then throws
//
//     "Note Bend (Midi2.0) events cannot be exported to SMF1.0"
//
// — on EVERY score, including one with no bend anywhere in it. The failure looks
// like a problem with the music and is nothing of the kind. A version of this
// file written from the documentation rather than from the installed package
// would have shipped broken for every input.
//
// `MidiFileFormat.MultiTrack` is chosen over `SingleTrackMultiChannel` so a
// dual-guitar arrangement arrives in a DAW as two tracks the way it was written,
// rather than as two channels of one.
//
// Pure ESM. This module does no file IO — it returns bytes, and the CLI owns
// where they go.

import * as alphaTab from '@coderline/alphatab';

/** The four bytes every Standard MIDI File begins with. */
export const MIDI_HEADER = 'MThd';

/**
 * Render a parsed alphaTab Score to Standard MIDI File bytes.
 *
 * @param {object} score alphaTab Score (from `loadTex`).
 * @param {object} [opts]
 * @param {boolean} [opts.multiTrack=true] One MIDI track per score track.
 * @returns {{ bytes: Uint8Array, tracks: number, format: string }}
 * @throws {Error} with a message naming the alphaTab failure, never a partial
 *         result. A caller turns that into exit 2.
 */
export function scoreToMidi(score, opts = {}) {
  if (!score || !Array.isArray(score.tracks)) {
    throw new TypeError('scoreToMidi: expected a parsed alphaTab Score');
  }
  const multiTrack = opts.multiTrack !== false;

  const midiFile = new alphaTab.midi.MidiFile();
  midiFile.format = multiTrack
    ? alphaTab.midi.MidiFileFormat.MultiTrack
    : alphaTab.midi.MidiFileFormat.SingleTrackMultiChannel;

  // `true` = SMF 1.0 mode. See the header — without it this throws on every
  // score, bends or no bends.
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, true);
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), handler);
  generator.generate();

  const bytes = midiFile.toBinary();
  if (!(bytes instanceof Uint8Array) || bytes.length < 14) {
    throw new Error(`alphaTab produced ${bytes?.length ?? 0} byte(s) of MIDI — too short to be a file`);
  }
  const header = String.fromCharCode(...bytes.slice(0, 4));
  if (header !== MIDI_HEADER) {
    // A defensive check, not a theoretical one: silently writing a file that is
    // not MIDI is worse than refusing, because it fails later in a DAW where
    // nobody will connect it back to this tool.
    throw new Error(`alphaTab produced bytes beginning "${header}", not "${MIDI_HEADER}"`);
  }

  return {
    bytes,
    tracks: midiFile.tracks.length,
    format: multiTrack ? 'MultiTrack' : 'SingleTrackMultiChannel',
  };
}

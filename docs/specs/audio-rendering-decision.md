# Audio rendering — feasibility record and decision (Wave 5C)

**Disposition: FEASIBLE, shipped as OPTIONAL tooling.**
Measured against the pinned `@coderline/alphatab@1.8.4` on Node v24.14.0 / Windows.
This is a record of what was actually run, not of what the documentation promises.

```
Feasible now / feasible with optional tooling / deferred
    -> feasible now, shipped as OPTIONAL tooling (tools/render-audio.mjs)
Required dependencies:  none — @coderline/alphatab remains the only one (C1)
Required assets:        none — a SoundFont ships INSIDE the package
Environment constraints: Node only via the LOW-LEVEL API; the documented
                        high-level path is browser-only by design
Prototype results:      9.60 s of 44.1 kHz stereo PCM from a 4-bar fixture,
                        rendered in ~0.26 s wall clock
Recommendation:         ship it, and never let it be mistaken for a tone reference
```

---

## The six questions, answered

### 1. Can the installed AlphaTab synthesize audio in Node?

**Yes — through the low-level API only.** The documented entry point does not exist
here:

```
new alphaTab.AlphaTabApi({}, {})
  -> "Usage of AlphaTabApi is only possible in browser environments.
      For usage in node use the Low Level APIs"
```

`exportAudio` is a method of `AlphaTabApiBase`, so following the documentation
leads straight into that refusal. But `alphaTab.synth.AlphaSynth` carries its own
`exportAudio(options, midiFile, syncPoints, transpositionPitches)`, and it works.

### 2. Does it require a SoundFont, Web Audio, worklets, or an external backend?

* **SoundFont: yes, and one is already here.** `@coderline/alphatab` ships
  `dist/soundfont/sonivox.sf2` (1.35 MB). No download, no repository asset, no
  licensing question of our own to answer.
* **Web Audio / worklets / an output backend: no.** `AlphaSynth`'s constructor
  wants an output sink, but an offline export never calls it — a stub of no-ops
  is sufficient, and `AudioContext` never enters the picture. Of the three output
  implementations alphaTab ships, only `AlphaSynthWebAudioOutputBase` mentions
  `AudioContext`, and the offline path uses none of them.

  **Trap:** an output stub that *accumulates* the samples handed to it will
  exhaust memory on a long render. It should stay a no-op — the audio comes back
  from `render()`, and the sink is a formality. This produced a false negative
  during the spike.

### 3. Can it render offline to PCM/WAV without a new dependency?

**Yes.** The working sequence:

```js
const midiFile = new alphaTab.midi.MidiFile();
midiFile.format = alphaTab.midi.MidiFileFormat.SingleTrackMultiChannel;   // see below
const gen = new alphaTab.midi.MidiFileGenerator(
  score, new alphaTab.Settings(),
  new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, /* smf1Mode */ true));
gen.generate();

const options = new alphaTab.synth.AudioExportOptions();
options.sampleRate = 44100;
options.soundFonts = [bundledSoundFontBytes];

const synth = new alphaTab.synth.AlphaSynth(silentOutput, 200);
const exporter = await synth.exportAudio(options, midiFile, gen.syncPoints, gen.transpositionPitches);
for (;;) {
  const chunk = await exporter.render(4096);
  if (!chunk?.samples?.length) break;
  // interleaved stereo Float32
}
```

WAV containment is 44 bytes of well-specified struct, written by hand in
`tools/lib/audio-render.mjs`. That is **not** the "manual serialization" C1 warns
against — that clause is about MIDI, where alphaTab already owns the API and a
second implementation would fork the semantics. There is no WAV writer in
alphaTab to fork.

### 4. Can the result sound guitar-like?

**No — and this is the finding that matters most.** It sounds like a General MIDI
sampled instrument. It carries pitch, rhythm, phrasing and form faithfully, and
it carries **nothing** about gain staging, cabinet response, pickup choice or
pick attack — which is most of what makes a rock arrangement work.

So the tool is useful for exactly one class of question ("does this phrase
breathe, does the return actually vary, does the riff sit at tempo") and useless
for the other ("is this the right amount of gain for this register"). Contract
C15 forbids claiming otherwise; `tools/render-audio.mjs` prints the disclaimer on
every human-readable run, and a test asserts that it does.

For tone: `tools/export-midi.mjs` → DAW → amp sim / guitar VST.

### 5. Licensing and repository size

**No impact.** The SoundFont is inside `node_modules`, not the repository, and it
arrives with the dependency the project already declares. Nothing new is
committed, nothing new is downloaded, and `npm ci` on a clean clone is unchanged.
A user-supplied `--soundfont` is supported for anyone who wants a better one.

### 6. Does this conflict with the no-new-runtime-dependency policy?

**No.** `@coderline/alphatab` remains the only runtime dependency (C1).

---

## Two upstream defects found, and how each is handled

Both look like bugs in *this* repository if you meet them cold, so they are
recorded here and pinned by tests in `tools/lib/midi-export.test.mjs`.

### D1 — `smf1Mode` is required, on every score

`new AlphaSynthMidiFileHandler(midiFile)` — the obvious call — makes the
generator emit MIDI 2.0 per-note pitch-bend events, and `toBinary()` then throws:

```
Note Bend (Midi2.0) events cannot be exported to SMF1.0
```

This fires on **every** score, including ones with no bend anywhere, and in both
`MidiFileFormat` values. The failure reads like a problem with the music and is
nothing of the kind. Passing `true` as the second constructor argument fixes it.

*Handled:* both `lib/midi-export.mjs` and `lib/audio-render.mjs` pass `true`, with
the reason in a comment at the call site. Tested against a fixture that really
does contain bends, slides, vibrato, harmonics and palm mutes.

### D2 — `MidiFile.events` recurses infinitely on multi-track files

```js
get events() {
  if (this.tracks.length === 1) return this.tracks[0].events;
  const events = [];
  for (const t of this.tracks) this.events.push(...t.events);   // <-- `this.events`
  ...
```

`this.events.push` re-enters the getter instead of pushing into the local
`events`, so reading `.events` on any file with more than one track recurses
until the stack dies. The offline audio exporter reads `.events`.

*Handled:* the AUDIO path uses `SingleTrackMultiChannel`, which takes the
one-track early-return branch. Nothing is lost — the synthesiser is
channel-based, and only the SMF *track grouping* differs. **MIDI export is
unaffected** and keeps `MultiTrack`, because `toBinary()` walks `tracks` directly
and never touches `.events`; a dual-guitar arrangement therefore still arrives in
a DAW as two tracks. A test renders the two-track fixture, so a regression to
`MultiTrack` on the audio path blows the stack rather than passing quietly.

---

## What shipped

| Tool | Status | Purpose |
|---|---|---|
| `tools/export-midi.mjs` | **production** | the reliable path into a DAW / amp sim |
| `tools/render-audio.mjs` | **optional** | a quick listen to phrasing, form and tempo |

Neither is on the gate path; nothing in `check.mjs` imports either. Both refuse
to write over their source, never create parent directories, make overwriting
opt-in, and write atomically through a temp file in the destination directory —
so a crash leaves the previous file or no file, never a truncated one a DAW will
cheerfully open.

**The recommended tone workflow remains, unchanged and unglamorous:**

```
AlphaTex  ->  MIDI export  ->  DAW / VST / amp sim
```

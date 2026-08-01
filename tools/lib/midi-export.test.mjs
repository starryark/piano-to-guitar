// midi-export.test.mjs — self-test for tools/lib/midi-export.mjs,
// tools/export-midi.mjs, tools/lib/audio-render.mjs and tools/render-audio.mjs
// (Implement.md §5.5/§5.6, Plan §9.3/§9.4, contracts C1/C2/C15).
// Run: node tools/lib/midi-export.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// An exporter has one job and two ways to fail badly: writing something that is
// not what it claims to be, and leaving a HALF-written file behind when it
// fails. A truncated .mid or .wav is worse than none, because a DAW opens it and
// the arranger blames the arrangement. So the suite checks the magic bytes, and
// it checks that a failed write leaves nothing behind.
//
// It also pins the two upstream quirks the feasibility spike found, because both
// look like defects in this repo's code if you meet them cold:
//   • `AlphaSynthMidiFileHandler` needs `smf1Mode = true` or every export throws
//     about MIDI 2.0 bend events — on scores with no bends;
//   • `MidiFile.events` recurses infinitely on multi-track files in 1.8.4, which
//     is why the AUDIO path uses SingleTrackMultiChannel while MIDI export does
//     not have to.
// See docs/specs/audio-rendering-decision.md.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTex } from './score-utils.mjs';
import { MIDI_HEADER, scoreToMidi } from './midi-export.mjs';
import { BUNDLED_SOUNDFONT, pcmToWav, renderScoreToPcm } from './audio-render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'tools', 'fixtures');
const SCRATCH = path.join(ROOT, 'out', 'midi-export-test');
const EXPORT_CLI = path.join(ROOT, 'tools', 'export-midi.mjs');
const AUDIO_CLI = path.join(ROOT, 'tools', 'render-audio.mjs');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
const scoreOf = (rel) => {
  const loaded = loadTex(path.join(FIX, rel));
  assert.equal(loaded.ok, true, `${rel} did not parse`);
  return loaded.score;
};
const out = (name) => path.join(SCRATCH, name);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

test('a generated file begins with MThd and is longer than a bare header', () => {
  const midi = scoreToMidi(scoreOf('dual/cover.alphatab'));
  assert.equal(String.fromCharCode(...midi.bytes.slice(0, 4)), MIDI_HEADER);
  assert.ok(midi.bytes.length > 14, `only ${midi.bytes.length} bytes — that is header and nothing else`);
  assert.ok(midi.bytes instanceof Uint8Array);
});

test('a multi-track score keeps its tracks', () => {
  const score = scoreOf('dual/cover.alphatab');
  assert.equal(score.tracks.length, 2, 'the fixture really is two tracks');
  const midi = scoreToMidi(score);
  assert.equal(midi.tracks, 2, 'a dual arrangement must arrive in a DAW as two tracks');
  assert.equal(midi.format, 'MultiTrack');
});

test('--single-track collapses to one track, deliberately', () => {
  const midi = scoreToMidi(scoreOf('dual/cover.alphatab'), { multiTrack: false });
  assert.equal(midi.tracks, 1);
  assert.equal(midi.format, 'SingleTrackMultiChannel');
});

test('a score full of effects exports — the smf1Mode quirk is handled', () => {
  // THE spike finding. Without `smf1Mode = true` the generator emits MIDI 2.0
  // per-note bend events and toBinary() throws "Note Bend (Midi2.0) events
  // cannot be exported to SMF1.0" — on EVERY score, bends or not. This fixture
  // actually has bends, slides, vibrato, harmonics and palm mutes.
  const midi = scoreToMidi(scoreOf('fingering-effects.alphatab'));
  assert.equal(String.fromCharCode(...midi.bytes.slice(0, 4)), MIDI_HEADER);
  assert.ok(midi.bytes.length > 50);
});

test('export is deterministic', () => {
  const a = scoreToMidi(scoreOf('dual/cover.alphatab')).bytes;
  const b = scoreToMidi(scoreOf('dual/cover.alphatab')).bytes;
  assert.ok(Buffer.from(a).equals(Buffer.from(b)), 'two exports of one score must be byte-identical');
});

test('a non-score argument throws rather than writing nonsense', () => {
  assert.throws(() => scoreToMidi(null), TypeError);
  assert.throws(() => scoreToMidi({}), TypeError);
});

// ---------------------------------------------------------------------------
// The MIDI CLI (contract C2 + the three declared write policies)
// ---------------------------------------------------------------------------

test('C2: a successful export exits 0 and writes a real file', () => {
  const dest = out('ok.mid');
  const r = node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dest, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.tracks, 2);
  assert.equal(fs.readFileSync(dest).subarray(0, 4).toString('ascii'), MIDI_HEADER);
  assert.equal(fs.statSync(dest).size, json.bytes);
});

test('policy: overwrite is opt-in', () => {
  const dest = out('overwrite.mid');
  assert.equal(node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dest]).status, 0);
  const refused = node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dest]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /already exists\. Pass --force/);
  assert.equal(node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dest, '--force']).status, 0);
});

test('policy: parent directories are never created', () => {
  const dest = path.join(SCRATCH, 'no', 'such', 'dir', 'x.mid');
  const r = node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dest]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not exist/);
  assert.equal(fs.existsSync(path.dirname(dest)), false, 'and nothing was created on the way');
});

test('policy: never write over the source tab, even with --force', () => {
  const tab = out('selfish.alphatab');
  fs.copyFileSync(path.join(FIX, 'dual/cover.alphatab'), tab);
  const before = fs.readFileSync(tab);
  const r = node([EXPORT_CLI, tab, '--out', tab, '--force']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Refusing to write MIDI over the source tab/);
  assert.ok(before.equals(fs.readFileSync(tab)), 'the tab must be untouched');
});

test('C2: an unparseable tab exits 2 and writes nothing', () => {
  const dest = out('never.mid');
  const r = node([EXPORT_CLI, path.join(FIX, 'broken-syntax.alphatab'), '--out', dest]);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(dest), false);
});

test('C2: a missing file, a missing --out and a missing tab all exit 2', () => {
  assert.equal(node([EXPORT_CLI]).status, 2);
  assert.equal(node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab')]).status, 2);
  assert.equal(node([EXPORT_CLI, out('nope.alphatab'), '--out', out('x.mid')]).status, 2);
});

test('an unwritable destination exits 2 and leaves NO partial file', () => {
  // The destination is an existing DIRECTORY, so the write fails after the tab
  // has parsed and the bytes exist — the exact moment a non-atomic writer would
  // have left a truncated file behind.
  const dir = out('a-directory.mid');
  fs.mkdirSync(dir, { recursive: true });
  const r = node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dir, '--force']);
  assert.equal(r.status, 2);
  assert.ok(fs.statSync(dir).isDirectory(), 'the directory is intact');
  const leftovers = fs.readdirSync(SCRATCH).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'the temporary file must be cleaned up');
});

test('the CLI is deterministic: two exports of one tab are byte-identical', () => {
  const a = out('det-a.mid');
  const b = out('det-b.mid');
  node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', a, '--force']);
  node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', b, '--force']);
  assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)));
});

test('C15: the human report never claims this is a tone reference', () => {
  const r = node([EXPORT_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', out('tone.mid'), '--force']);
  assert.match(r.stdout, /NOTES, not TONE/);
  assert.match(r.stdout, /amp sim|guitar VST/);
});

// ---------------------------------------------------------------------------
// Offline audio (OPTIONAL tooling — the Wave 5C disposition, as code)
// ---------------------------------------------------------------------------

test('offline synthesis works in Node with no new dependency', () => {
  // The Wave 5C answer, pinned. If this ever stops holding, the decision record
  // in docs/specs/audio-rendering-decision.md is out of date and this fails
  // first.
  assert.ok(fs.existsSync(BUNDLED_SOUNDFONT),
    'the SoundFont ships INSIDE alphaTab — no repository asset, no new dependency');
});

test('a short tab renders to stereo PCM of the right LENGTH', async () => {
  // 4 bars of 4/4 at 100 BPM = 9.6 seconds. A renderer that silently produced
  // an empty or truncated buffer would still "work"; the duration is what shows
  // it actually rendered the music.
  const pcm = await renderScoreToPcm(scoreOf('dual/cover.alphatab'));
  assert.equal(pcm.channels, 2);
  assert.equal(pcm.sampleRate, 44100);
  assert.ok(pcm.samples.length > 0);
  assert.ok(Math.abs(pcm.seconds - 9.6) < 1.0, `expected ~9.6s of audio, got ${pcm.seconds}`);
  assert.ok(pcm.samples.some((v) => v !== 0), 'and it must not be silence');
});

test('the multi-track MidiFile.events recursion is stepped around, not met', async () => {
  // alphaTab 1.8.4's `MidiFile.events` getter recurses forever when
  // tracks.length > 1 (`this.events.push` where `events.push` was meant), and
  // the offline exporter reads it. The audio path therefore uses
  // SingleTrackMultiChannel. This fixture has TWO tracks, so a regression to
  // MultiTrack here would blow the stack rather than fail an assertion.
  const pcm = await renderScoreToPcm(scoreOf('dual/cover.alphatab'));
  assert.ok(pcm.samples.length > 0);
});

test('pcmToWav produces a RIFF/WAVE container whose data length agrees', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2, 0]);
  const { buffer, frames } = pcmToWav({ samples, sampleRate: 44100, channels: 2 });
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(buffer.readUInt16LE(22), 2, 'channels');
  assert.equal(buffer.readUInt32LE(24), 44100, 'sample rate');
  assert.equal(buffer.readUInt16LE(34), 16, 'bit depth');
  assert.equal(buffer.readUInt32LE(40), samples.length * 2, 'data chunk length');
  assert.equal(buffer.length, 44 + samples.length * 2);
  assert.equal(frames, 4);
  // Out-of-range floats are CLAMPED, never wrapped: a wrap is a loud click that
  // gets blamed on the arrangement.
  assert.equal(buffer.readInt16LE(44 + 5 * 2), 32767, '+2.0 clamps to full scale');
  assert.equal(buffer.readInt16LE(44 + 6 * 2), -32767, '-2.0 clamps to full scale');
});

test('the audio CLI writes a playable WAV and reports honestly', () => {
  const dest = out('render.wav');
  const r = node([AUDIO_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', dest, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.bundledSoundFont, true);
  assert.ok(json.seconds > 5);
  const bytes = fs.readFileSync(dest);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.length, json.bytes);
});

test('C15: the audio CLI refuses to be a tone reference, in its own output', () => {
  const r = node([AUDIO_CLI, path.join(FIX, 'dual/cover.alphatab'), '--out', out('tone.wav'), '--force']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NOT a tone reference/);
  assert.match(r.stdout, /gain/);
});

test('the audio CLI obeys the same three write policies', () => {
  const tab = path.join(FIX, 'dual/cover.alphatab');
  const dest = out('policies.wav');
  assert.equal(node([AUDIO_CLI, tab, '--out', dest]).status, 0);
  assert.equal(node([AUDIO_CLI, tab, '--out', dest]).status, 2, 'overwrite is opt-in');
  assert.equal(node([AUDIO_CLI, tab, '--out', path.join(SCRATCH, 'nope', 'x.wav')]).status, 2);
  assert.equal(node([AUDIO_CLI, tab, '--out', tab, '--force']).status, 2);
});

test('C2: a missing SoundFont and a bad sample rate exit 2', () => {
  const tab = path.join(FIX, 'dual/cover.alphatab');
  assert.equal(node([AUDIO_CLI, tab, '--out', out('sf.wav'), '--soundfont', out('nope.sf2')]).status, 2);
  assert.equal(node([AUDIO_CLI, tab, '--out', out('sr.wav'), '--sample-rate', '10']).status, 2);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${err.stack ?? err.message}\n\n`);
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

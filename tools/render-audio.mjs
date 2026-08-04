// tools/render-audio.mjs — render a tab to a WAV file, offline.
// PTG-native (Wave 5). OPTIONAL: no gate imports this, and nothing depends on
// it. The synthesis sequence lives in lib/audio-render.mjs.
//
// Usage:
//   node tools/render-audio.mjs <tab.alphatab> --out <file.wav>
//        [--soundfont <file.sf2>] [--sample-rate N] [--force] [--json]
//
// WHAT THIS IS FOR — AND THE CLAIM IT REFUSES TO MAKE
// ---------------------------------------------------
// It renders the NOTES so you can hear the shape of an arrangement away from a
// screen: is the phrase too long to breathe, does the return actually vary, does
// the riff sit right at tempo. Those are answerable from a General MIDI render.
//
// TONE IS NOT. Contract C15 is explicit and this tool obeys it: a SoundFont
// guitar sample says nothing about gain staging, cabinet response, pickup choice
// or pick attack, and those are most of what a rock arrangement lives or dies
// by. Do not audition gain decisions here. Export MIDI (tools/export-midi.mjs)
// and route it through an amp sim for that.
//
// EXIT CONTRACT (C2): 0 = a WAV was written; 2 = usage / parse / IO failure;
// 1 = never.

import * as fs from 'node:fs';
import path from 'node:path';
import { loadTex } from './lib/score-utils.mjs';
import { BUNDLED_SOUNDFONT, DEFAULT_SAMPLE_RATE, pcmToWav, renderScoreToPcm } from './lib/audio-render.mjs';
import { emit, emitErr } from './lib/emit.mjs';

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  let out = null;
  let soundFont = null;
  let sampleRate = null;
  let force = false;
  let json = false;
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a.startsWith('--out=')) out = a.slice('--out='.length);
    else if (a === '--soundfont') soundFont = argv[++i];
    else if (a.startsWith('--soundfont=')) soundFont = a.slice('--soundfont='.length);
    else if (a === '--sample-rate') sampleRate = argv[++i];
    else if (a.startsWith('--sample-rate=')) sampleRate = a.slice('--sample-rate='.length);
    else if (a === '--force') force = true;
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) file = file ?? a;
  }
  return { file, out, soundFont, sampleRate, force, json };
}

const USAGE = 'Usage: node tools/render-audio.mjs <tab.alphatab> --out <file.wav> '
  + '[--soundfont <file.sf2>] [--sample-rate N] [--force] [--json]';

const { file, out: outArg, soundFont, sampleRate: rateArg, force, json } = parseArgs(process.argv.slice(2));

function fail(...messages) {
  if (json) emit(JSON.stringify({ ok: false, file: file ?? null, errors: messages }, null, 2));
  for (const m of messages) emitErr(m);
  if (!json) emitErr(USAGE);
  process.exit(2);
}

if (!file) fail('No tab file given.');
if (!outArg) fail('No output path given (--out <file.wav>).');
if (!fs.existsSync(file)) fail(`No tab at "${file}".`);

const sampleRate = rateArg === null ? DEFAULT_SAMPLE_RATE : Number(rateArg);
if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
  fail(`Bad --sample-rate "${rateArg}"; expected an integer 8000..192000.`);
}

// Same three write policies as tools/export-midi.mjs, for the same reasons:
// never over the source, never create parent directories, overwrite is opt-in.
const outPath = path.resolve(outArg);
if (outPath === path.resolve(file)) fail(`Refusing to write audio over the source tab "${file}".`);
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fail(`Output directory "${outDir}" does not exist. Create it first, or fix --out.`);
if (fs.existsSync(outPath) && !force) fail(`"${outPath}" already exists. Pass --force to overwrite it.`);

// ---- parse -----------------------------------------------------------------
let loaded;
try {
  loaded = loadTex(file);
} catch (e) {
  fail(`Cannot read "${file}": ${e.message}`);
}
if (!loaded.ok) {
  fail(`"${file}" did not parse — run tools/validate.mjs for the diagnostics.`,
    ...loaded.errors.slice(0, 6).map((e) => `  ${(e.message ?? JSON.stringify(e)).trim()}`));
}

// ---- render ----------------------------------------------------------------
let pcm;
try {
  pcm = await renderScoreToPcm(loaded.score, { soundFont: soundFont ?? undefined, sampleRate });
} catch (e) {
  fail(`Audio render failed: ${e.message}`);
}
if (!pcm.samples.length) {
  fail('The renderer produced no audio at all — check that the tab has sounding notes.');
}

const wav = pcmToWav(pcm);

// Atomic write, same rationale as export-midi.mjs: a crash leaves the old file
// or no file, never a truncated WAV that plays as a burst of noise.
const tmpPath = path.join(outDir, `.${path.basename(outPath)}.${process.pid}.tmp`);
try {
  fs.writeFileSync(tmpPath, wav.buffer);
  fs.renameSync(tmpPath, outPath);
} catch (e) {
  try { fs.rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
  fail(`Cannot write "${outPath}": ${e.message}`);
}

const result = {
  ok: true,
  file,
  out: outPath,
  bytes: wav.buffer.length,
  seconds: Number(wav.seconds.toFixed(3)),
  sampleRate: pcm.sampleRate,
  channels: pcm.channels,
  soundFont: pcm.soundFont,
  bundledSoundFont: pcm.soundFont === BUNDLED_SOUNDFONT,
};

if (json) {
  emit(JSON.stringify(result, null, 2));
  process.exit(0);
}

emit(`AUDIO RENDER  ${file}`);
emit(`              -> ${outPath}`);
emit(`              ${wav.seconds.toFixed(2)}s, ${pcm.sampleRate} Hz, `
  + `${pcm.channels} channel(s), ${wav.buffer.length} bytes`);
emit(`              soundfont ${pcm.soundFont}${result.bundledSoundFont ? ' (bundled)' : ''}`);
emit('');
emit('NOTE  This is a General MIDI render of the NOTES. It is useful for phrasing, form');
emit('      and tempo, and it is NOT a tone reference: it says nothing about gain,');
emit('      cabinet response, pickup choice or pick attack. Judge those through an amp');
emit('      sim fed by tools/export-midi.mjs, or by playing it.');
process.exit(0);

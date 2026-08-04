// generate.mjs — regenerates the scale fixture in this directory.
// Run: node tools/fixtures/scale/generate.mjs
//
// WHY A GENERATOR AND NOT THREE HAND-WRITTEN FILES
// ------------------------------------------------
// Plan.md §10.4 asks for "at least one longer multi-track score" to expose
// excessive event retention, large canonical riff keys, recursive traversal
// problems and advisory explosions. Those failure modes only appear at a length
// nobody wants to hand-write or hand-review: 192 source bars and 200 tab bars.
//
// So the fixture is DERIVED, and this file is the derivation. A reviewer reads
// ~150 lines of intent instead of diffing 400 bars of AlphaTex, and
// tools/scale.test.mjs re-runs this generator in memory and byte-compares it
// against the checked-in files — a hand-edit to the .alphatab is therefore a
// test failure, not a silent divergence between the fixture and its story.
//
// SONG-NEUTRAL BY CONSTRUCTION
// ----------------------------
// This repo ships no example arrangement (AGENTS.md). Nothing here is quoted
// from CanonRock or from any real piece: it is a four-bar i–VI–III–VII loop in A
// minor with a fixed arpeggio, repeated. Its only job is to be long and to be
// analysable.
//
// EVERYTHING IS DETERMINISTIC. No Date, no Math.random — two runs on two
// machines must produce identical bytes or the byte-compare test is worthless.

import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The material
// ---------------------------------------------------------------------------
// One four-bar loop, repeated. Periodicity is deliberate: it means a recomposed
// span and the source bars under it agree on root motion by construction, and it
// gives findRiffCells() genuinely recurring windows to canonicalise — which is
// the point of the "large canonical riff keys" hazard.
//
// Melody sits inside frets 5–12 of the high E string so the lead line never
// crosses a string and never jumps position. That keeps the fixture's advisories
// about SCALE (does one finding stay one finding over 200 bars?) rather than
// about a mechanical defect this fixture was never meant to carry.
//
// The loop's fourth bar ends in a rest, and that rest is load-bearing. A phrase
// ends at a rest or after a note ≥ 2 beats (fingering.mjs), so a 200-bar line
// with neither is ONE phrase — the phrase DP then reports a single finding whose
// evidence enumerates all 200 bars, which is a scale problem disguised as a
// deduplicated one. Breathing every four bars is both the more credible melody
// and the version that actually exercises the dedup contract: the same problem
// recurs in ~16 phrases and has to collapse.
//
// `null` in a melody array is a rest of that slot's duration.

const LOOP = [
  {
    name: 'Am',
    bass: 'A2',                                  // MIDI 45
    power: '(0.5 2.4)',                          // A2 + E3
    quote: ['A4', 'C5', 'E5', 'C5'],             // frets 5 8 12 8 on string 1
    run: ['A4', 'B4', 'C5', 'D5', 'E5', 'D5', 'C5', 'B4'],
  },
  {
    name: 'F',
    bass: 'F2',                                  // MIDI 41
    power: '(1.6 3.5)',                          // F2 + C3
    quote: ['A4', 'C5', 'D5', 'C5'],
    run: ['C5', 'D5', 'C5', 'B4', 'A4', 'B4', 'C5', 'D5'],
  },
  {
    name: 'C',
    bass: 'C3',                                  // MIDI 48
    power: '(3.5 5.4)',                          // C3 + G3
    quote: ['E5', 'C5', 'A4', 'C5'],
    run: ['E5', 'D5', 'C5', 'B4', 'A4', 'B4', 'C5', 'D5'],
  },
  {
    name: 'G',
    bass: 'G2',                                  // MIDI 43
    power: '(3.6 5.5)',                          // G2 + D3
    quote: ['D5', 'B4', 'D5', null],             // the phrase breathes here
    run: ['D5', 'C5', 'B4', 'A4', 'B4', 'C5', null, null],
  },
];

// Fret on string 1 (open high E = MIDI 64) for every pitch the melody uses.
// A literal table rather than a computed one: the fixture must not depend on
// fretboard.mjs, or a change there would silently rewrite the fixture.
const FRET_ON_E = {
  A4: 5, B4: 7, C5: 8, D5: 10, E5: 12,
};

const SOURCE_BARS = 192;   // 48 passes over the loop
const TAB_BARS = 200;      // 192 mapped + an 8-bar free outro

// ---------------------------------------------------------------------------
// The piano source
// ---------------------------------------------------------------------------

// `bars` is a parameter, not a constant, for one reason: tools/scale.test.mjs
// asks whether the digest grows LINEARLY, and that question needs the same
// material at several lengths. The checked-in fixture is always the default.
export function buildSource(bars = SOURCE_BARS) {
  const melody = [];
  const bass = [];
  for (let i = 0; i < bars; i++) {
    const chord = LOOP[i % LOOP.length];
    melody.push(`${chord.quote.map((p) => `${p ?? 'r'}.4`).join(' ')} |`);
    bass.push(`${chord.bass}.1 |`);
  }
  return [
    `\\title "Scale fixture source — a ${bars / LOOP.length}-pass i-VI-III-VII loop in A minor"`,
    '\\tempo 100',
    '.',
    '\\staff { score }',
    '\\ks c',
    '\\voice',
    ...melody,
    '\\voice',
    ...bass,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The dual-guitar cover
// ---------------------------------------------------------------------------
// Bars 1–64 and 129–192 quote the source melody exactly (four quarters, same
// pitches, same order) so the quote spans have a real skeleton to satisfy.
// Bars 65–128 recompose it as an eighth-note run around the same chord tones —
// root motion still holds, the melodic skeleton deliberately does not, which is
// exactly what `recompose` means. Bars 193–200 are free: added material with no
// source bars behind it.

const isRecomposed = (bar) => bar >= 65 && bar <= 128;

function leadBar(bar) {
  const chord = LOOP[(bar - 1) % LOOP.length];
  const pitches = isRecomposed(bar) || bar > SOURCE_BARS ? chord.run : chord.quote;
  const dur = pitches.length === 8 ? 8 : 4;
  return `${pitches.map((p) => (p === null ? `r.${dur}` : `${FRET_ON_E[p]}.1.${dur}`)).join(' ')} |`;
}

function rhythmBar(bar) {
  const chord = LOOP[(bar - 1) % LOOP.length];
  return `${`${chord.power}.4 `.repeat(4).trim()} |`;
}

export function buildCover(bars = TAB_BARS) {
  const lead = [];
  const rhythm = [];
  for (let bar = 1; bar <= bars; bar++) {
    lead.push(leadBar(bar));
    rhythm.push(rhythmBar(bar));
  }
  return [
    '\\title "Scale fixture cover — 200 bars, lead and rhythm tracks"',
    '\\tempo 100',
    '.',
    '\\track "Lead"',
    '\\ts 4 4',
    ...lead,
    '\\track "Rhythm"',
    '\\ts 4 4',
    ...rhythm,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The correspondence map
// ---------------------------------------------------------------------------

export function buildSidecar() {
  return `${JSON.stringify({
    song: 'scale fixture — quote, recompose and free spans over 200 tab bars',
    entries: [
      { mode: 'quote', tabBars: [1, 64], sourceBars: [1, 64] },
      { mode: 'recompose', tabBars: [65, 128], sourceBars: [65, 128] },
      { mode: 'quote', tabBars: [129, 192], sourceBars: [129, 192] },
      { mode: 'free', tabBars: [193, 200] },
    ],
  }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------

export const FILES = {
  'source.alphatab': () => buildSource(),
  'cover.alphatab': () => buildCover(),
  'sidecar.json': buildSidecar,
};

export const SIZES = { sourceBars: SOURCE_BARS, tabBars: TAB_BARS };

/** The fixture as {filename: contents}, without touching the filesystem. */
export function generate() {
  return Object.fromEntries(Object.entries(FILES).map(([name, fn]) => [name, fn()]));
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  for (const [name, contents] of Object.entries(generate())) {
    fs.writeFileSync(path.join(HERE, name), contents, 'utf8');
    process.stdout.write(`wrote ${name} (${contents.length} bytes)\n`);
  }
}

#!/usr/bin/env node
// tools/tab-events.mjs — parser-grounded event inspection (PTG-native).
//
//   node tools/tab-events.mjs <file.alphatab> [--bars N-M] [--json]
//
// Purpose (Improve_Plan §6): show what alphaTab ACTUALLY PARSED, not what the
// AlphaTex text appears to mean. The two are not the same: a tie-shaped token
// whose origin cannot be resolved parses SILENTLY into a fresh attack (on a
// tab staff, an attack of the OPEN STRING — a pitch the text never states).
// This tool is mandatory reading whenever ties, cross-bar sustains, or unusual
// effects are introduced into a tab.
//
// Reports, per bar and onset:
//   * parsed MIDI and pitch name (realValue — correct on BOTH pitched and
//     fretted staves; never fromAlphaTabNote on a pitched note),
//   * fret and string (fretted staves only),
//   * playback duration in quarter-note beats,
//   * tie origin/destination + ATTACK vs CONTINUATION (from the model's tie
//     links, never from token placement), chain sounding duration on heads,
//   * brush/arpeggio, hammer/pull, slides, vibrato, let-ring, palm mute,
//     dead/ghost notes, tuplet ratio, grace type, rests.
//
// Plus a text-vs-model tie-intent audit: `!! N tie-shaped token(s) parsed as
// fresh attacks` means alphaTab dropped that many tie intents — inspect those
// bars before trusting the tab.
//
// Exit: 0 ok, 1 parse error, 2 usage.

import * as fs from 'node:fs';
import { loadTex, midiToName, QUARTER_TICKS } from './lib/score-utils.mjs';
import { collectTieChains, auditTieIntents } from './lib/ties.mjs';

// ---- CLI --------------------------------------------------------------------
function parseArgs(argv) {
  let bars = null;
  let json = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bars') bars = argv[++i];
    else if (a.startsWith('--bars=')) bars = a.slice('--bars='.length);
    else if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  return { file: positional[0] ?? null, bars, json };
}

const { file, bars, json } = parseArgs(process.argv.slice(2));
if (!file) {
  console.error('Usage: node tools/tab-events.mjs <file.alphatab> [--bars N-M] [--json]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`No file at "${file}"`);
  process.exit(2);
}

let range = null;
if (bars !== null) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(bars).trim());
  if (!m) {
    console.error(`Bad --bars "${bars}"; expected N or N-M`);
    process.exit(2);
  }
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  range = { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

// ---- load -------------------------------------------------------------------
// Raw parse first (tabs, clean sources). If that fails, retry through the
// piano-source normalizer (an AT218-style source is still inspectable).
const rawText = fs.readFileSync(file, 'utf8');
let loaded = loadTex(file);
let normalized = false;
if (!loaded.ok) {
  try {
    const { normalizePianoSource } = await import('./lib/piano-source.mjs');
    const res = normalizePianoSource(rawText);
    const text = typeof res === 'string' ? res : (res.text ?? rawText);
    const { parseTex } = await import('./lib/analysis.mjs');
    const reparsed = parseTex(text);
    if (reparsed.ok) {
      loaded = reparsed;
      normalized = true;
    }
  } catch { /* fall through to the error report below */ }
}
if (!loaded.ok) {
  console.error(`Cannot parse "${file}":`);
  for (const e of (loaded.errors ?? []).slice(0, 8)) {
    console.error(`  ${e.severity ?? 'error'} line ${e.line ?? '?'}: ${e.message}`);
  }
  process.exit(1);
}
const { score } = loaded;

// ---- enum spellings ----------------------------------------------------------
const VIBRATO = { 1: 'slight', 2: 'wide' };
const BRUSH = { 1: 'brushUp', 2: 'brushDown', 3: 'arpeggioUp', 4: 'arpeggioDown' };
const GRACE = { 1: 'onBeat', 2: 'beforeBeat', 3: 'bendGrace' };
const SLIDE_IN = { 1: 'intoFromBelow', 2: 'intoFromAbove' };
const SLIDE_OUT = {
  1: 'shift', 2: 'legato', 3: 'outUp', 4: 'outDown', 5: 'pickSlideDown', 6: 'pickSlideUp',
};

const round = (x) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;

// ---- collect events ----------------------------------------------------------
const tieInfo = collectTieChains(score);
const multiStream = score.tracks.length > 1
  || score.tracks.some((t) => t.staves.length > 1
    || t.staves.some((s) => s.bars.some((b) => b.voices.filter(
      (v) => v.beats.some((bt) => !bt.isEmpty)).length > 1)));

const barsOut = new Map(); // barNum -> [event]
for (let t = 0; t < score.tracks.length; t++) {
  const track = score.tracks[t];
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      const barNum = bar.index + 1;
      if (range && (barNum < range.lo || barNum > range.hi)) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.isEmpty) continue;
          const ev = {
            onset: round(beat.playbackStart / QUARTER_TICKS),
            duration: round(beat.playbackDuration / QUARTER_TICKS),
            track: t,
            staff: staff.index,
            voice: voice.index,
          };
          if (staff.isPercussion || track.isPercussion) ev.percussion = true;
          if (beat.isRest) ev.rest = true;
          if (beat.tupletDenominator > 1 || beat.hasTuplet) {
            ev.tuplet = `${beat.tupletNumerator}:${beat.tupletDenominator}`;
          }
          if (BRUSH[beat.brushType]) ev.brush = BRUSH[beat.brushType];
          if (GRACE[beat.graceType]) ev.grace = GRACE[beat.graceType];
          if (!beat.isRest) {
            ev.notes = beat.notes.map((n) => {
              const midi = n.realValue;
              const ti = tieInfo.byNote.get(n);
              const note = {
                midi,
                name: Number.isFinite(midi) ? midiToName(midi) : null,
                tieOrigin: !!n.isTieOrigin,
                tieDestination: !!n.isTieDestination,
                attack: !n.isTieDestination,
              };
              if (n.string > 0) {
                note.string = n.string;
                note.fret = n.fret;
              }
              if (ti && ti.chain.fragments > 1) {
                note.tieChainId = ti.chain.id;
                if (ti.attack) {
                  note.soundingBeats = ti.chain.soundingBeats;
                  note.notatedFragments = ti.chain.fragments;
                }
              }
              if (ti && ti.chain.orphanContinuation) note.orphanContinuation = true;
              if (n.isLetRing) note.letRing = true;
              if (VIBRATO[n.vibrato]) note.vibrato = VIBRATO[n.vibrato];
              if (n.isHammerPullOrigin) note.hammerPullOrigin = true;
              if (n.isHammerPullDestination) note.hammerPullDestination = true;
              if (SLIDE_IN[n.slideInType]) note.slideIn = SLIDE_IN[n.slideInType];
              if (SLIDE_OUT[n.slideOutType]) note.slideOut = SLIDE_OUT[n.slideOutType];
              if (n.isDead) note.dead = true;
              if (n.isGhost) note.ghost = true;
              if (n.isPalmMute) note.palmMute = true;
              return note;
            });
          }
          if (!barsOut.has(barNum)) barsOut.set(barNum, []);
          barsOut.get(barNum).push(ev);
        }
      }
    }
  }
}
for (const evs of barsOut.values()) {
  evs.sort((a, b) => (a.onset - b.onset) || (a.track - b.track)
    || (a.staff - b.staff) || (a.voice - b.voice));
}

const intent = auditTieIntents(rawText, score);

// ---- output ------------------------------------------------------------------
const orderedBars = [...barsOut.keys()].sort((a, b) => a - b);

if (json) {
  const out = {
    file,
    normalized,
    bars: orderedBars.map((b) => ({ bar: b, events: barsOut.get(b) })),
    tieIntentAudit: intent,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const fmt2 = (x) => x.toFixed(2);
for (const b of orderedBars) {
  for (const ev of barsOut.get(b)) {
    const loc = multiStream ? ` [t${ev.track} s${ev.staff} v${ev.voice}]` : '';
    const beatBits = [];
    if (ev.tuplet) beatBits.push(`tuplet=${ev.tuplet}`);
    if (ev.brush) beatBits.push(ev.brush);
    if (ev.grace) beatBits.push(`grace=${ev.grace}`);
    if (ev.percussion) beatBits.push('PERCUSSION');
    const beatTail = beatBits.length ? `  ${beatBits.join(' ')}` : '';
    console.log(`bar ${b} onset ${fmt2(ev.onset)}${loc}${beatTail}`);
    if (ev.rest) {
      console.log(`  REST duration ${fmt2(ev.duration)}`);
      continue;
    }
    for (const n of ev.notes) {
      const bits = [];
      bits.push(`${n.name ?? '?'} duration ${fmt2(ev.duration)}`);
      if (n.string) bits.push(`string=${n.string} fret=${n.fret}`);
      bits.push(`tieOrigin=${n.tieOrigin} tieDestination=${n.tieDestination}`);
      bits.push(n.attack ? 'ATTACK' : 'CONTINUATION');
      if (n.soundingBeats !== undefined) {
        bits.push(`sounding=${n.soundingBeats} over ${n.notatedFragments} fragments (${n.tieChainId})`);
      } else if (n.tieChainId) {
        bits.push(`chain=${n.tieChainId}`);
      }
      if (n.orphanContinuation) bits.push('ORPHAN-CONTINUATION');
      for (const k of ['letRing', 'vibrato', 'hammerPullOrigin', 'hammerPullDestination',
        'slideIn', 'slideOut', 'dead', 'ghost', 'palmMute']) {
        if (n[k] !== undefined) bits.push(n[k] === true ? k : `${k}=${n[k]}`);
      }
      console.log(`  ${bits.join(' ')}`);
    }
  }
}
if (normalized) {
  console.log('\n(note: file needed piano-source normalization before it parsed)');
}
if (intent.dropped > 0) {
  console.log(`\n!! ${intent.dropped} tie-shaped token(s) in the text parsed as fresh attacks ` +
    `(${intent.textTieTokens} tie tokens vs ${intent.parsedTieDestinations} parsed tie ` +
    'destinations). Each is a reattack — or an open-string attack — the author never wrote. ' +
    'Find them: every note above shows ATTACK vs CONTINUATION.');
}
process.exit(0);

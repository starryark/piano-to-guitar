// tools/lib/ties.mjs — parser-grounded tie-chain analysis (PTG-native).
//
// WHY THIS MODULE EXISTS (Improve_Plan §2.2 / §6)
// -----------------------------------------------
// Automatic transcriptions (Basic Pitch) notate one sustained piano note as a
// dust cloud of tied fragments (`E5.16 E5{t}.64 E5{t}.64 (E5{t} A4).32 …`), and
// alphaTab SILENTLY normalizes malformed tie notation into things the author
// did not write:
//
//   * a pitched `X{t}` whose pitch matches no earlier note in the voice parses
//     as a PLAIN REATTACK — the tie intent is dropped without a diagnostic;
//   * a tab-staff `-.<str>.<dur>` with no attack to continue parses as a fresh
//     attack of the OPEN STRING — a pitch the tab never states;
//   * a `{t}` after an intervening rest DOES link, silently merging a sustain
//     across a gap of silence.
//
// All three were measured against @coderline/alphatab 1.5 (see
// tools/lib/ties.test.mjs — the behaviours are pinned there so an alphaTab
// upgrade that changes them is caught). Because the corruption leaves no trace
// in the parsed model, tie behaviour must be read from the MODEL's tie links
// (never inferred from AlphaTex token placement) and the model must be
// cross-checked against the raw text's tie-shaped tokens to expose what the
// parser swallowed.
//
// VOCABULARY
//   fragment — one parsed alphaTab Note.
//   chain    — a maximal run of fragments linked by the model's tie pointers.
//              The head (isTieDestination === false) is the ATTACK; every
//              other fragment is a CONTINUATION of that attack.
//   sounding duration — the sum of the chain's fragment durations: the length
//              the pitch actually sounds. THE ONE RULE this module enforces
//              downstream: a note's duration comes from its OWN tie chain,
//              never from the longest simultaneous note in its group.

import { QUARTER_TICKS } from './score-utils.mjs';

const round4 = (x) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;

const PC_SLUG = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];

/** Chain id, e.g. "b64-t0s1v0-fs5" (+ "-2" disambiguator when one bar/voice
 *  attacks the same pitch more than once). Deterministic across runs. */
function chainId(headBar, track, staffIdx, voiceIdx, midi, taken) {
  const pc = PC_SLUG[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const base = `b${headBar}-t${track}s${staffIdx}v${voiceIdx}-${pc}${octave}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/**
 * Walk every note of a parsed Score and group tie-linked fragments into
 * chains, reading ONLY the model's tie pointers.
 *
 * Returns {
 *   chains: [{ id, midi, track, staff, voice, startBar, endBar, onset,
 *              soundingBeats, fragments, gapBeats, gaps:[…], pitchChanged }],
 *   byNote: WeakMap<Note, { chain, index, attack }>,
 * }
 *
 * `gaps` records every fragment that does not begin where the previous one
 * ended (alphaTab links `{t}` across rests): { bar, atBeats, gapBeats }.
 * `pitchChanged` records a linked fragment whose realValue differs from the
 * head's — no AlphaTex input produces one today (mismatched `{t}` is DROPPED,
 * not linked), so its presence means a new importer behaviour: surface loudly.
 */
export function collectTieChains(score) {
  const chains = [];
  const byNote = new WeakMap();
  const taken = new Set();

  for (let t = 0; t < score.tracks.length; t++) {
    const track = score.tracks[t];
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isRest) continue;
            for (const note of beat.notes) {
              if (note.isTieDestination) continue;      // not a head
              if (byNote.has(note)) continue;           // already chained
              const fragments = [];
              let cur = note;
              const seen = new Set();
              while (cur && !seen.has(cur)) {
                seen.add(cur);
                fragments.push(cur);
                cur = cur.isTieOrigin ? cur.tieDestination : null;
              }
              const frag = (n) => {
                const b = n.beat;
                const abs = b.absolutePlaybackStart ?? b.playbackStart;
                return {
                  note: n,
                  bar: b.voice.bar.index + 1,
                  absStart: abs,
                  absEnd: abs + b.playbackDuration,
                  onset: round4(b.playbackStart / QUARTER_TICKS),
                  beats: round4(b.playbackDuration / QUARTER_TICKS),
                };
              };
              const fr = fragments.map(frag);
              const head = fr[0];
              const gaps = [];
              let soundingTicks = 0;
              let pitchChanged = false;
              for (let i = 0; i < fr.length; i++) {
                soundingTicks += fr[i].absEnd - fr[i].absStart;
                if (fr[i].note.realValue !== head.note.realValue) pitchChanged = true;
                if (i > 0) {
                  const gap = fr[i].absStart - fr[i - 1].absEnd;
                  if (Math.abs(gap) > 1) {   // 1 tick of slack for rounding
                    gaps.push({
                      bar: fr[i].bar,
                      atBeats: fr[i].onset,
                      gapBeats: round4(gap / QUARTER_TICKS),
                    });
                  }
                }
              }
              const chain = {
                id: chainId(head.bar, t, staff.index, voice.index,
                  head.note.realValue, taken),
                midi: head.note.realValue,
                track: t,
                staff: staff.index,
                voice: voice.index,
                startBar: head.bar,
                endBar: fr[fr.length - 1].bar,
                onset: head.onset,
                soundingBeats: round4(soundingTicks / QUARTER_TICKS),
                fragments: fr.length,
                gaps,
                pitchChanged,
              };
              chains.push(chain);
              fr.forEach((f, i) => byNote.set(f.note, { chain, index: i, attack: i === 0 }));
            }
          }
        }
      }
    }
  }

  // Orphan continuations: isTieDestination === true but no head reaches them
  // (their tieOrigin link is missing/broken). Give each its own single-fragment
  // chain so nothing is silently unaccounted for, and mark it.
  for (let t = 0; t < score.tracks.length; t++) {
    for (const staff of score.tracks[t].staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isRest) continue;
            for (const note of beat.notes) {
              if (byNote.has(note)) continue;
              const chain = {
                id: chainId(bar.index + 1, t, staff.index, voice.index,
                  note.realValue, taken),
                midi: note.realValue,
                track: t,
                staff: staff.index,
                voice: voice.index,
                startBar: bar.index + 1,
                endBar: bar.index + 1,
                onset: round4(beat.playbackStart / QUARTER_TICKS),
                soundingBeats: round4(beat.playbackDuration / QUARTER_TICKS),
                fragments: 1,
                gaps: [],
                pitchChanged: false,
                orphanContinuation: true,
              };
              chains.push(chain);
              byNote.set(note, { chain, index: 0, attack: false, orphan: true });
              void abs;
            }
          }
        }
      }
    }
  }

  return { chains, byNote };
}

// --------------------------------------------------------------------------- //
// Text-vs-model tie-intent audit
// --------------------------------------------------------------------------- //
// The parsed model shows NO trace of a dropped tie intent (the note is just a
// plain attack), so the only way to expose one is to count tie-shaped tokens
// in the raw AlphaTex and compare against the model's tie-destination count.
// Two shapes exist:
//   * `{ … t … }` — a note-effect brace whose token list contains a bare `t`
//     (the MuseScore/Basic Pitch pitched-staff tie).
//   * `-.<str>.<dur>` / `-.<dur>` — the tab-staff dash tie.
// The audit is a LOWER bound on corruption: it can under-count (a `t` inside a
// beat-effect brace is indistinguishable from a note effect without a full
// parse) but a `dropped > 0` is always real.

/** Count tie-shaped tokens in raw AlphaTex text. */
export function countTieTokens(text) {
  let braceTies = 0;
  for (const m of String(text).matchAll(/\{([^}]*)\}/g)) {
    const tokens = m[1].trim().split(/\s+/);
    if (tokens.includes('t') || tokens.includes('-')) braceTies++;
  }
  // Dash ties: `-` in note position — start of line/whitespace/`(`, then `-.`,
  // then a digit (duration or string). A negative fret like `-1.1.4` does NOT
  // match (the char after `-` is a digit, not `.`).
  const dashTies = [...String(text).matchAll(/(?:^|[\s(])-\.\d/gm)].length;
  return { braceTies, dashTies, total: braceTies + dashTies };
}

/** Count the model's actual tie destinations. */
export function countTieDestinations(score) {
  let n = 0;
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isRest) continue;
            for (const note of beat.notes) if (note.isTieDestination) n++;
          }
        }
      }
    }
  }
  return n;
}

/**
 * Cross-check the text's tie-shaped tokens against the model.
 * dropped > 0 means the parser swallowed that many tie intents — each one is
 * now a reattack (or an open-string attack) the author never wrote.
 */
export function auditTieIntents(text, score) {
  const tokens = countTieTokens(text);
  const parsedTieDestinations = countTieDestinations(score);
  return {
    textTieTokens: tokens.total,
    parsedTieDestinations,
    dropped: Math.max(0, tokens.total - parsedTieDestinations),
  };
}

/**
 * Digest-level tie audit: chains + anomalies, additive contract surface.
 * `text` is optional; without it the intent audit is null (model-only view).
 * `precollected` lets a caller that already ran collectTieChains skip the
 * second walk (buildDigest does).
 */
export function buildTieAudit(score, text = null, precollected = null) {
  const chains = precollected ?? collectTieChains(score).chains;
  const multi = chains.filter((c) => c.fragments > 1);
  // A chain whose MEAN fragment is shorter than a sixteenth is transcription
  // dust. The mean (not per-fragment precision) is enough: this is a noise
  // SIGNAL for the source profile, not a gate.
  const MICRO_BEATS = 0.25;
  const gapTies = multi.filter((c) => c.gaps.length > 0);
  const pitchChanged = chains.filter((c) => c.pitchChanged);
  const orphans = chains.filter((c) => c.orphanContinuation);
  const anomalies = [];
  for (const c of gapTies.slice(0, 20)) {
    anomalies.push({
      kind: 'tie-across-gap', chain: c.id, bar: c.startBar,
      detail: `tie chain ${c.id} continues across ${c.gaps.length} gap(s) of silence`,
    });
  }
  for (const c of pitchChanged.slice(0, 20)) {
    anomalies.push({
      kind: 'tie-pitch-changed', chain: c.id, bar: c.startBar,
      detail: `tie chain ${c.id} changes pitch mid-chain — importer behaviour changed, audit the source`,
    });
  }
  for (const c of orphans.slice(0, 20)) {
    anomalies.push({
      kind: 'orphan-continuation', chain: c.id, bar: c.startBar,
      detail: `bar ${c.startBar}: a tie destination has no reachable origin`,
    });
  }
  const intent = text === null ? null : auditTieIntents(text, score);
  if (intent && intent.dropped > 0) {
    anomalies.push({
      kind: 'dropped-tie-intents',
      detail: `${intent.dropped} tie-shaped token(s) in the text did not become `
        + 'tie destinations in the parsed model — each is now a reattack (or an '
        + 'open-string attack) the author never wrote',
    });
  }
  return {
    chains: chains.length,
    multiFragmentChains: multi.length,
    longestChainFragments: chains.reduce((a, c) => Math.max(a, c.fragments), 0),
    microFragmentChains: multi.filter((c) => c.soundingBeats / c.fragments < MICRO_BEATS).length,
    tieAcrossGap: gapTies.length,
    pitchChangedChains: pitchChanged.length,
    orphanContinuations: orphans.length,
    intent,
    anomalies,
  };
}

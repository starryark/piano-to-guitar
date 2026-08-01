// fingering.test.mjs — self-test for tools/lib/fingering.mjs and tools/fingering.mjs.
// Run: node tools/lib/fingering.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// A fingering recommender is trusted or it is useless, and "trusted" decomposes
// into a short list of things it must never do. Every Wave-2 acceptance
// criterion in Implement.md §2 is one of them, and each has a test here:
//
//   deterministic .................. `analyzeFingering` twice, byte-identical
//   preserves pitch ................ `assertPitchPreserved` over every fixture
//   no illegal candidate ........... every generated grip re-checked against
//                                    isPlayableVoicing + the pick-reachability
//                                    and fret-range rules playability enforces
//   effects protected .............. harmonic/let-ring pinned; bend, palm mute
//                                    and legato pairs only move where the
//                                    technique survives
//   global beats greedy ............ DP vs `greedyFingering` on the trap fixture
//   difficulty decreases ........... on the synthetic optimisation fixtures
//   exits 0 with advisories ........ the CLI's C2 contract
//   never rewrites the tab ......... file bytes compared before and after (C15)
//
// C11 invariant 6 requires BOTH halves for every new advisory, so each of the
// three `fingering.*` codes has a fixture that fires it AND
// `fingering-clean.alphatab` — ordinary rock writing — proving it stays silent.
//
// Tests assert advisory CODES, never prose (C3): message wording is free to
// improve, a code is a promise.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTex } from './score-utils.mjs';
import { isPlayableVoicing, spanOf, positionsFor } from './fretboard.mjs';
import { hasAdvisory } from './advisory.mjs';
import {
  analyzeFingering,
  buildPhrases,
  candidatesForBeat,
  optimizePhrase,
  greedyFingering,
  currentPathCost,
  assertPitchPreserved,
  noteRules,
  positionOf,
  maxShiftOf,
  timePressure,
  staticCost,
  transitionCost,
  DEFAULT_WEIGHTS,
  COMFORT_SPAN,
  FREE_SHIFT_FRETS,
} from './fingering.mjs';

const LIB = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.dirname(LIB);
const ROOT = path.dirname(TOOLS);
const CLI = path.join(TOOLS, 'fingering.mjs');
const fix = (n) => path.join(TOOLS, 'fixtures', n);

const TRAP = fix('fingering-greedy-trap.alphatab');
const CLEAN = fix('fingering-clean.alphatab');
const EFFECTS = fix('fingering-effects.alphatab');
const STRETCH = fix('fingering-stretch.alphatab');
const ALL_FIXTURES = [TRAP, CLEAN, EFFECTS, STRETCH];

function runCli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stays null */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function scoreOf(file) {
  const loaded = loadTex(file);
  assert.ok(loaded.ok, `fixture ${path.basename(file)} must parse`);
  return loaded.score;
}

const codesOf = (list) => list.map((a) => a.code);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Cost-model units — the pieces every downstream claim is built out of
// ---------------------------------------------------------------------------

test('timePressure makes travel expensive at speed and cheap after a breath', () => {
  // Implement.md §2.2: "large movement + long rest = relatively cheap;
  // large movement + 16th note = expensive."
  assert.equal(timePressure(0.25), 2, '16th');
  assert.equal(timePressure(0.5), 1, '8th');
  assert.equal(timePressure(1), 0.5, 'quarter');
  assert.equal(timePressure(2), 0.25, 'half');
  // Clamped at both ends: no unbounded cost, and no free travel over a fermata.
  assert.equal(timePressure(0.001), 4);
  assert.equal(timePressure(100), 0.25);
  assert.equal(timePressure(0), 4, 'a zero/absent gap is treated as maximally tight');
});

test('positionOf: an all-open grip has NO hand station (null, not 0)', () => {
  // Load-bearing: null means "the hand is free", which is why an open beat
  // costs no shift on either side and earns the open bonus.
  assert.equal(positionOf([{ string: 6, fret: 3 }, { string: 5, fret: 5 }]), 3);
  assert.equal(positionOf([{ string: 3, fret: 0 }, { string: 2, fret: 0 }]), null);
  assert.equal(positionOf([]), null);
  // An open string inside a fretted grip does not drag the station to 0.
  assert.equal(positionOf([{ string: 6, fret: 0 }, { string: 4, fret: 7 }]), 7);
});

test('a shift inside the hand window is free; beyond it, priced by speed', () => {
  const w = DEFAULT_WEIGHTS;
  const one = [{ string: 1, fret: 5, midi: 69 }];
  const at7 = [{ string: 1, fret: 7, midi: 71 }];
  const at12 = [{ string: 1, fret: 12, midi: 76 }];
  const ctx8 = { gapBeats: 0.5, link: null, fastPair: false, slidesOut: false };
  // 2 frets == FREE_SHIFT_FRETS: a finger reach, not a hand shift.
  assert.equal(transitionCost(one, at7, ctx8, w).cost, 0);
  // 7 frets at eighth pace: (7 - 2) * 1.0 * 1.0
  assert.equal(transitionCost(one, at12, ctx8, w).cost, 5 - 0 + 0 - 0);
  // The same move after a half note is a quarter of the price.
  const ctxSlow = { ...ctx8, gapBeats: 2 };
  assert.equal(transitionCost(one, at12, ctxSlow, w).cost, 5 * 0.25);
  assert.equal(FREE_SHIFT_FRETS, 2);
});

test('staticCost prices a stretch past the 4-fret CAGED window, and only then', () => {
  const w = DEFAULT_WEIGHTS;
  const comfortable = [{ string: 4, fret: 5 }, { string: 3, fret: 8 }];   // span 3
  const stretched = [{ string: 4, fret: 5 }, { string: 3, fret: 9 }];     // span 4
  assert.equal(spanOf(comfortable).span, COMFORT_SPAN);
  assert.equal(staticCost(comfortable, w), 0);
  assert.equal(staticCost(stretched, w), w.stretch);
  // A fully open beat frees the hand — the plan's "useful open string".
  assert.equal(staticCost([{ string: 3, fret: 0 }], w), -w.openString);
  // A partly-open grip earns nothing: the hand is holding it either way.
  assert.equal(staticCost([{ string: 5, fret: 0 }, { string: 4, fret: 7 }], w), 0);
  // A non-adjacent DYAD is legal but needs hybrid picking (C14) — priced, not banned.
  assert.equal(staticCost([{ string: 6, fret: 0 }, { string: 4, fret: 7 }], w), w.stringSkip);
});

// ---------------------------------------------------------------------------
// Candidate legality — "no candidate violates hard fretboard constraints"
// ---------------------------------------------------------------------------

test('every generated candidate is a legal voicing, on every fixture', () => {
  for (const file of ALL_FIXTURES) {
    const { phrases } = buildPhrases(scoreOf(file), { maxFret: 22, stringCount: 6 });
    let checked = 0;
    for (const phrase of phrases) {
      for (const ev of phrase.events) {
        assert.ok(ev.candidates.length >= 1,
          `${path.basename(file)} bar ${ev.barNum}: every beat needs at least the written grip`);
        for (const c of ev.candidates) {
          const v = isPlayableVoicing(c.positions, { maxFret: 22, stringCount: 6 });
          assert.ok(v.ok,
            `${path.basename(file)} bar ${ev.barNum}: illegal candidate ${c.key} `
            + `(${v.violations.map((x) => x.rule).join(', ')})`);
          // One note per string, in range — restated independently of the helper.
          const strings = c.positions.map((p) => p.string);
          assert.equal(new Set(strings).size, strings.length, `duplicate string in ${c.key}`);
          for (const p of c.positions) {
            assert.ok(p.fret >= 0 && p.fret <= 22, `fret ${p.fret} out of range in ${c.key}`);
            assert.ok(p.string >= 1 && p.string <= 6, `string ${p.string} out of range in ${c.key}`);
          }
          // playability C14: 3+ simultaneous notes on non-contiguous strings is a
          // HARD error. A recommender must never propose a gate failure.
          if (c.positions.length >= 3 && !ev.brushed) {
            const sorted = [...new Set(strings)].sort((a, b) => a - b);
            assert.equal(sorted[sorted.length - 1] - sorted[0] + 1, sorted.length,
              `${path.basename(file)} bar ${ev.barNum}: candidate ${c.key} strikes `
              + '3+ non-adjacent strings — playability would hard-fail it');
          }
          checked++;
        }
      }
    }
    assert.ok(checked > 0, `${path.basename(file)} produced no candidates at all`);
  }
});

test('the WRITTEN grip is always among the candidates ("change nothing" is reachable)', () => {
  for (const file of ALL_FIXTURES) {
    const { phrases } = buildPhrases(scoreOf(file), { maxFret: 22, stringCount: 6 });
    for (const phrase of phrases) {
      for (const ev of phrase.events) {
        assert.ok(ev.candidates.some((c) => c.isCurrent),
          `${path.basename(file)} bar ${ev.barNum}: the written fingering must stay on the table`);
      }
    }
  }
});

test('C5: the resolved max fret bounds the search, and widening it opens positions', () => {
  // B5 lives at 19.1 on any neck and at 24.2 only on a 24-fret one.
  const B5 = 83;
  assert.deepEqual(positionsFor(B5, { maxFret: 22 }).map((p) => `${p.string}:${p.fret}`), ['1:19']);
  assert.deepEqual(positionsFor(B5, { maxFret: 24 }).map((p) => `${p.string}:${p.fret}`),
    ['1:19', '2:24']);

  const ev = synthEvent([{ string: 1, fret: 19, midi: B5 }]);
  const at22 = candidatesForBeat(ev, { maxFret: 22, stringCount: 6 });
  const at24 = candidatesForBeat(synthEvent([{ string: 1, fret: 19, midi: B5 }]),
    { maxFret: 24, stringCount: 6 });
  assert.deepEqual(at22.map((c) => c.key), ['1:19']);
  assert.deepEqual(at24.map((c) => c.key), ['1:19', '2:24']);
  for (const c of at22) {
    for (const p of c.positions) assert.ok(p.fret <= 22, 'nothing above the resolved limit');
  }
});

/** A bare event, for unit tests that should not need a fixture on disk. */
function synthEvent(notes, extra = {}) {
  const withRaw = notes.map((n) => ({ ...n, raw: extra.raw ?? {}, durationBeats: 0.5 }));
  for (const n of withRaw) n.rules = noteRules(n, null);
  return {
    beat: {}, barNum: 1, beatIndex: 0, tempo: 120,
    durationBeats: 0.5, durationValue: 8,
    notes: withRaw,
    brushed: false, slidesOut: false, link: null, pinned: false, pinsNext: false,
    currentPositions: notes.map((n) => ({ string: n.string, fret: n.fret, midi: n.midi })),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Pitch preservation — the invariant a fingering tool may never break
// ---------------------------------------------------------------------------

test('every suggested fingering sounds exactly the pitches that were written', () => {
  for (const file of ALL_FIXTURES) {
    const { phrases } = buildPhrases(scoreOf(file), { maxFret: 22, stringCount: 6 });
    for (const phrase of phrases) {
      const best = optimizePhrase(phrase.events, {});
      assert.equal(best.path.length, phrase.events.length,
        `${path.basename(file)}: the optimiser must return one grip per attack`);
      assertPitchPreserved(phrase.events, best.path);
      // And restated from the note's own point of view: string+fret must still
      // produce the MIDI number it claims to.
      const OPEN = [null, 64, 59, 55, 50, 45, 40];
      for (const c of best.path) {
        for (const p of c.positions) {
          assert.equal(OPEN[p.string] + p.fret, p.midi,
            `${path.basename(file)}: ${p.string}:${p.fret} does not sound MIDI ${p.midi}`);
        }
      }
    }
  }
});

test('assertPitchPreserved actually catches a changed pitch', () => {
  // A guard nothing can trip is not a guard. Prove it fires.
  const events = [synthEvent([{ string: 1, fret: 5, midi: 69 }])];
  const wrong = [{ positions: [{ string: 1, fret: 7, midi: 71 }], key: '1:7' }];
  assert.throws(() => assertPitchPreserved(events, wrong), /changed pitch 69 -> 71/);
});

// ---------------------------------------------------------------------------
// Global optimisation beats a greedy local choice
// ---------------------------------------------------------------------------

test('global DP beats the greedy local choice on the trap fixture', () => {
  const { phrases } = buildPhrases(scoreOf(TRAP), { maxFret: 22, stringCount: 6 });
  assert.equal(phrases.length, 1, 'the trap is one unbroken phrase');
  const events = phrases[0].events;
  assert.equal(events.length, 8);

  const dp = optimizePhrase(events, {});
  const greedy = greedyFingering(events, {});

  assert.ok(dp.cost < greedy.cost - 1e-9,
    `DP (${dp.cost}) must beat greedy (${greedy.cost})`);

  // Not just a cheaper number — a structurally different, better answer. Greedy
  // takes the locally free first note at fret 3 and is then dragged up the neck;
  // the DP starts at fret 12 and never leaves the position.
  const greedyShift = maxShiftOf(greedy.path.map((c) => c.positions));
  const dpShift = maxShiftOf(dp.path.map((c) => c.positions));
  assert.ok(dpShift < greedyShift,
    `DP worst shift ${dpShift} must be smaller than greedy's ${greedyShift}`);
  assert.equal(positionOf(greedy.path[0].positions), 3, 'greedy takes the cheap low first note');
  assert.equal(positionOf(dp.path[0].positions), 12, 'the DP pays for position and keeps it');

  // Greedy is a straw man ONLY because it cannot look ahead: it is fed the same
  // candidates and the same cost function.
  assertPitchPreserved(events, greedy.path);
});

test('difficulty decreases on the synthetic optimisation fixtures', () => {
  for (const file of [TRAP, STRETCH]) {
    const result = analyzeFingering(scoreOf(file), { maxFret: 22, stringCount: 6 });
    const improved = result.phrases.filter((p) => p.changes.length);
    assert.ok(improved.length >= 1, `${path.basename(file)}: expected a suggestion`);
    for (const p of improved) {
      assert.ok(p.suggested.cost < p.current.cost,
        `${path.basename(file)} bars ${p.firstBar}-${p.lastBar}: `
        + `suggested ${p.suggested.cost} must be below current ${p.current.cost}`);
      assert.ok(p.improvement > 0);
      assert.ok(p.material, 'a reported change must have cleared the materiality floors');
      assert.ok(typeof p.reason === 'string' && p.reason.length > 0,
        'every suggestion must explain itself (Implement.md §2.4)');
    }
  }
});

test('the current-path cost is measured with the same ruler as the suggestion', () => {
  // If these two used different cost functions the reported improvement would be
  // meaningless. Pin the trap fixture's two numbers exactly.
  const { phrases } = buildPhrases(scoreOf(TRAP), { maxFret: 22, stringCount: 6 });
  const events = phrases[0].events;
  const cur = currentPathCost(events, {});
  const best = optimizePhrase(events, {});
  assert.deepEqual(cur.violations, [], 'the trap fixture is legal as written');
  assert.ok(Math.abs(cur.cost - 12.45) < 1e-9, `current cost ${cur.cost}, expected 12.45`);
  assert.ok(Math.abs(best.cost - 3.85) < 1e-9, `suggested cost ${best.cost}, expected 3.85`);
});

test('re-striking an IDENTICAL grip is free — no anchored-finger bonus to farm', () => {
  // The bug this pins was musically backwards: the common-tone bonus fired on a
  // repeated FRETTED note but never on a repeated OPEN one, so the optimiser
  // could "improve" an open-string riff by fretting it — harder to play, and a
  // different sound. An unchanged grip is not an anchored finger; it is no hand
  // movement at all, and must score exactly 0 either way.
  const ctx = { gapBeats: 0.5, link: null, fastPair: false, slidesOut: false };
  const fretted = [{ string: 5, fret: 5, midi: 50 }];
  const open = [{ string: 4, fret: 0, midi: 50 }];
  assert.equal(transitionCost(fretted, fretted, ctx).cost, 0, 'repeated fretted note');
  assert.equal(transitionCost(open, open, ctx).cost, 0, 'repeated open string');
  // Across a real change, an anchored finger IS still worth something.
  const chordA = [{ string: 5, fret: 5, midi: 50 }, { string: 4, fret: 7, midi: 57 }];
  const chordB = [{ string: 5, fret: 5, midi: 50 }, { string: 4, fret: 5, midi: 55 }];
  assert.ok(transitionCost(chordA, chordB, ctx).cost < 0, 'a held finger earns its bonus');
});

test('a written open string is never traded for a fretted position', () => {
  // reference/guitar-fretboard.md: an open string rings and cannot be vibratoed,
  // bent or damped — it is a different note in kind, not a cheaper way to play
  // the same one. One-directional: fretted -> open stays available.
  const ev = synthEvent([{ string: 4, fret: 0, midi: 50 }]);
  const cands = candidatesForBeat(ev, { maxFret: 22, stringCount: 6 });
  assert.deepEqual(cands.map((c) => c.key), ['4:0'],
    'D3 has 5.5 and 6.10 available, and neither may be proposed for a written open D');
  assert.equal(noteRules({ string: 4, fret: 0, midi: 50, raw: {} }).pin, true);
  assert.deepEqual(noteRules({ string: 4, fret: 0, midi: 50, raw: {} }).reasons, ['open-string']);

  // End to end: the open-string riff fixture draws no suggestion at all.
  const r = runCli([fix('e2e-tab.alphatab'), '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.advisories, [],
    'an open-string rock riff must not be "improved" into a fretted one');
  assert.ok(r.json.stats.events >= 30, 'and it really was analysed');
});

test('a DP window seam is costed, never a free teleport', () => {
  // The failure mode this guards is silent and flattering: if a window boundary
  // restarted the search cold, the hand could jump the neck once per window for
  // nothing, and the reported cost would come out BELOW the true optimum — the
  // optimiser would look better the more windows you gave it. So the invariant
  // is one-sided: a narrower window may only ever cost MORE.
  const { phrases } = buildPhrases(scoreOf(TRAP), { maxFret: 22, stringCount: 6 });
  const events = phrases[0].events;
  const optimum = optimizePhrase(events, {}).cost;

  for (const maxPhraseEvents of [2, 3, 4, 5, 8]) {
    const r = optimizePhrase(events, { maxPhraseEvents });
    assert.equal(r.path.length, events.length,
      `window ${maxPhraseEvents}: every attack still needs exactly one grip`);
    assertPitchPreserved(events, r.path);
    assert.ok(r.cost >= optimum - 1e-9,
      `window ${maxPhraseEvents} produced ${r.cost}, below the true optimum ${optimum} — `
      + 'the seam is not being charged');
  }
  // And a window wide enough to see the whole phrase finds the true optimum.
  assert.ok(Math.abs(optimizePhrase(events, { maxPhraseEvents: 8 }).cost - optimum) < 1e-9);
});

// ---------------------------------------------------------------------------
// Technique protection (Implement.md §2.3)
// ---------------------------------------------------------------------------

test('a natural harmonic and a let-ring open string are PINNED, never relocated', () => {
  const result = analyzeFingering(scoreOf(EFFECTS), { maxFret: 22, stringCount: 6 });
  const phrase = result.phrases[0];
  const pinnedReasons = new Map(phrase.pinned.map((p) => [p.note, p.reasons]));
  assert.deepEqual(pinnedReasons.get('E5'), ['harmonic'],
    'the 12th-fret natural harmonic must pin — its pitch is a partial, not open+fret');
  // The ringing open G is pinned twice over: it let-rings, AND it is an open
  // string. Both reasons are reported; either alone would be enough.
  assert.deepEqual(pinnedReasons.get('G3'), ['let-ring', 'open-string']);
  // And nothing pinned appears in the change list.
  const movedNotes = new Set(phrase.changes.map((c) => `${c.bar}:${c.beat}:${c.from.name}`));
  for (const p of phrase.pinned) {
    assert.ok(!movedNotes.has(`${p.bar}:${p.beat}:${p.note}`),
      `pinned ${p.note} in bar ${p.bar} must not be moved`);
  }
});

test('a bend may move only where a bend is still possible (strings 1-3, fret >= 5)', () => {
  const bent = { string: 1, fret: 7, midi: 71, raw: { hasBend: true }, durationBeats: 0.5 };
  bent.rules = noteRules(bent, null);
  assert.equal(bent.rules.pin, false, 'a bend travels — it is a filter, not a pin');
  const ev = synthEvent([{ string: 1, fret: 7, midi: 71 }], { raw: { hasBend: true } });
  for (const c of candidatesForBeat(ev, { maxFret: 22, stringCount: 6 })) {
    for (const p of c.positions) {
      assert.ok(p.string <= 3, `bend proposed on string ${p.string} — only 1-3 bend in tune`);
      assert.ok(p.fret >= 5, `bend proposed at fret ${p.fret} — bends want fret >= 5`);
    }
  }
  // On the real fixture the bend does move, and stays bendable.
  const result = analyzeFingering(scoreOf(EFFECTS), { maxFret: 22, stringCount: 6 });
  const moved = result.phrases[0].changes.find((c) => c.from.name === 'B4' && c.from.fret === 7);
  assert.ok(moved, 'expected the bent B4 to be re-fingered');
  assert.ok(moved.to.string <= 3 && moved.to.fret >= 5,
    `bend relocated to ${moved.to.string}:${moved.to.fret}, which cannot bend in tune`);
});

test('a palm mute may move only onto the wound strings (4-6)', () => {
  const ev = synthEvent([{ string: 4, fret: 5, midi: 55 }], { raw: { isPalmMute: true } });
  const cands = candidatesForBeat(ev, { maxFret: 22, stringCount: 6 });
  assert.ok(cands.length >= 2, 'the muted note has somewhere else to go');
  for (const c of cands) {
    for (const p of c.positions) {
      assert.ok(p.string >= 4, `palm mute proposed on plain string ${p.string} — {pm} wants 4-6`);
    }
  }
});

test('vibrato is never relocated onto an open string', () => {
  const ev = synthEvent([{ string: 2, fret: 5, midi: 64 }], { raw: { vibrato: 1 } });
  for (const c of candidatesForBeat(ev, { maxFret: 22, stringCount: 6 })) {
    for (const p of c.positions) {
      assert.ok(p.fret > 0, 'an open string cannot be vibratoed — the hand is not on it');
    }
  }
});

test('a hammer/pull pair moves TOGETHER on one string, or not at all', () => {
  const result = analyzeFingering(scoreOf(EFFECTS), { maxFret: 22, stringCount: 6 });
  const { phrases } = buildPhrases(scoreOf(EFFECTS), { maxFret: 22, stringCount: 6 });
  const events = phrases[0].events;
  const best = optimizePhrase(events, {});

  // Beat 4 hammers into beat 5 (G4 -> A4); beat 6 slides into beat 7 (B4 -> C#5).
  for (const [i, kind] of [[4, 'hammer'], [6, 'slide']]) {
    const from = best.path[i].positions;
    const to = best.path[i + 1].positions;
    assert.equal(from.length, 1);
    assert.equal(to.length, 1);
    assert.equal(from[0].string, to[0].string,
      `the ${kind} pair came apart onto strings ${from[0].string} and ${to[0].string}`);
    if (kind === 'hammer') {
      assert.ok(Math.abs(to[0].fret - from[0].fret) <= 4,
        'legato reach on one string is ~4 frets');
    }
  }
  // The hammer pair DID relocate — proving the constraint permits motion rather
  // than freezing everything it touches.
  const hammerMoves = result.phrases[0].changes.filter((c) => ['G4', 'A4'].includes(c.from.name));
  assert.equal(hammerMoves.length, 2, 'both ends of the hammer moved, together');
  assert.equal(hammerMoves[0].to.string, hammerMoves[1].to.string);
});

test('a legato link across strings is rejected outright by the transition', () => {
  const ctx = { gapBeats: 0.5, link: { type: 'hammer', maxReach: 4 }, fastPair: false };
  const same = transitionCost([{ string: 1, fret: 3, midi: 67 }],
    [{ string: 1, fret: 5, midi: 69 }], ctx);
  assert.equal(same.legal, true);
  const crossed = transitionCost([{ string: 1, fret: 3, midi: 67 }],
    [{ string: 2, fret: 10, midi: 69 }], ctx);
  assert.equal(crossed.legal, false);
  assert.match(crossed.reason, /crosses-string/);
  const tooFar = transitionCost([{ string: 1, fret: 3, midi: 67 }],
    [{ string: 1, fret: 12, midi: 76 }], ctx);
  assert.equal(tooFar.legal, false);
  assert.match(tooFar.reason, /reach/);
});

test('a suggestion never creates playability\'s hard 16th-note position jump', () => {
  const ctx = { gapBeats: 0.25, link: null, fastPair: true, slidesOut: false };
  const ok5 = transitionCost([{ string: 1, fret: 5, midi: 69 }],
    [{ string: 1, fret: 10, midi: 74 }], ctx);
  assert.equal(ok5.legal, true, '5 frets is the limit, not past it');
  const bad6 = transitionCost([{ string: 1, fret: 5, midi: 69 }],
    [{ string: 1, fret: 11, midi: 75 }], ctx);
  assert.equal(bad6.legal, false);
  assert.equal(bad6.reason, 'fast-position-jump');
  // A slide out legalises it — exactly as playability's own rule does.
  const slid = transitionCost([{ string: 1, fret: 5, midi: 69 }],
    [{ string: 1, fret: 11, midi: 75 }], { ...ctx, slidesOut: true });
  assert.equal(slid.legal, true);
});

// ---------------------------------------------------------------------------
// Advisories — trigger and non-trigger halves (C11 invariant 6)
// ---------------------------------------------------------------------------

test('the trap fixture fires better-fingering AND the located position-jump', () => {
  const { advisories } = analyzeFingering(scoreOf(TRAP), { maxFret: 22, stringCount: 6 });
  assert.ok(hasAdvisory(advisories, 'fingering.better-fingering'));
  assert.ok(hasAdvisory(advisories, 'fingering.position-jump'));
  const jump = advisories.find((a) => a.code === 'fingering.position-jump');
  // C3's own example shape: located, with from/to positions in `data`.
  assert.equal(jump.severity, 'warning');
  assert.equal(typeof jump.bar, 'number');
  assert.equal(jump.data.fromPosition, 7);
  assert.equal(jump.data.toPosition, 12);
  assert.ok(jump.data.suggestedTo - jump.data.suggestedFrom === 0,
    'the advisory only fires because the suggestion removes the shift');
});

test('the stretch fixture fires fingering.stretch', () => {
  const { advisories } = analyzeFingering(scoreOf(STRETCH), { maxFret: 22, stringCount: 6 });
  assert.ok(hasAdvisory(advisories, 'fingering.stretch'));
  const s = advisories.find((a) => a.code === 'fingering.stretch');
  assert.equal(s.data.span, 4, 'the written dyad spans 4 frets — past the hand window');
  assert.ok(s.data.suggestedSpan < s.data.span);
});

test('ordinary rock writing draws NO advisory at all (the non-trigger half)', () => {
  const result = analyzeFingering(scoreOf(CLEAN), { maxFret: 22, stringCount: 6 });
  assert.deepEqual(codesOf(result.advisories), [],
    'a power-chord riff and a one-position lead line are already well fingered — '
    + 'an analyzer that "improves" them is noise');
  assert.equal(result.stats.phrasesImproved, 0);
  for (const p of result.phrases) assert.deepEqual(p.changes, []);
  // It still ANALYSED them — silence must mean "looked and found nothing".
  assert.equal(result.stats.phrases, 2);
  assert.ok(result.stats.events >= 15);
});

test('every advisory this module emits lives in its reserved namespace (C3)', () => {
  for (const file of ALL_FIXTURES) {
    const { advisories } = analyzeFingering(scoreOf(file), { maxFret: 22, stringCount: 6 });
    for (const a of advisories) {
      assert.match(a.code, /^fingering\./,
        `${a.code} is outside the fingering.* namespace Wave 2 owns`);
      assert.equal(typeof a.message, 'string');
      assert.ok(['info', 'warning'].includes(a.severity));
    }
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('the analysis is byte-for-byte reproducible', () => {
  for (const file of ALL_FIXTURES) {
    const a = analyzeFingering(scoreOf(file), { maxFret: 22, stringCount: 6 });
    const b = analyzeFingering(scoreOf(file), { maxFret: 22, stringCount: 6 });
    assert.equal(JSON.stringify(a), JSON.stringify(b),
      `${path.basename(file)}: two runs disagreed`);
  }
});

test('the CLI is reproducible across processes too', () => {
  const a = runCli([TRAP, '--json']);
  const b = runCli([TRAP, '--json']);
  assert.equal(a.stdout, b.stdout, 'two CLI runs must produce identical bytes');
});

// ---------------------------------------------------------------------------
// CLI contracts (C2, C5, C15)
// ---------------------------------------------------------------------------

test('C2: the CLI exits 0 even when it emits advisories', () => {
  const r = runCli([TRAP, '--json']);
  assert.equal(r.code, 0, 'a soft-only analyzer never returns 1');
  assert.equal(r.json.ok, true);
  assert.ok(r.json.advisories.length > 0, 'this fixture is supposed to have findings');
});

test('C2: the CLI exits 0 on a clean tab, with no advisories', () => {
  const r = runCli([CLEAN, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.advisories, []);
});

test('C2: usage, missing file and unparseable input are all exit 2', () => {
  assert.equal(runCli([]).code, 2, 'no file given');
  assert.equal(runCli(['does-not-exist.alphatab']).code, 2, 'missing file');
  assert.equal(runCli([TRAP, '--bars', 'nonsense']).code, 2, 'bad --bars');
  assert.equal(runCli([TRAP, '--max-fret', 'x']).code, 2, 'bad --max-fret');
  const broken = runCli([fix('broken-syntax.alphatab')]);
  assert.equal(broken.code, 2, 'an unparseable tab is an INPUT failure, not a musical verdict');
  assert.match(broken.stderr, /did not parse/);
});

test('C5: --max-fret reaches the analyzer and is reported with its provenance', () => {
  const dflt = runCli([TRAP, '--json']);
  assert.equal(dflt.json.instrument.maxFret, 22);
  assert.equal(dflt.json.settings.maxFret, 22);
  assert.equal(dflt.json.configSources.maxFret, 'default');

  const wide = runCli([TRAP, '--max-fret', '24', '--json']);
  assert.equal(wide.json.instrument.maxFret, 24);
  assert.equal(wide.json.settings.maxFret, 24);
  assert.equal(wide.json.configSources.maxFret, 'cli');
});

test('C5: a co-located config.json is honoured, and --max-fret outranks it', () => {
  // Reuses the Wave-1 fixture project, whose config.json declares maxFret 24 and
  // whose tab holds a single note at fret 23. NO existence guard on purpose: if
  // the fixture is ever moved or renamed this test must FAIL, not quietly pass.
  // (A skip-if-missing guard here already made this assertion vacuous once.)
  const proj = fix(path.join('maxfret-project', 'fret23.alphatab'));
  assert.ok(fs.existsSync(proj), `the Wave-1 max-fret fixture must exist at ${proj}`);

  const viaConfig = runCli([proj, '--json']);
  assert.equal(viaConfig.code, 0);
  assert.equal(viaConfig.json.instrument.maxFret, 24);
  assert.equal(viaConfig.json.configSources.maxFret, 'config',
    'the project config must be found from the tab it sits next to');
  assert.equal(viaConfig.json.settings.maxFret, 24, 'and must reach the analyzer itself');
  assert.equal(viaConfig.json.stats.events, 1, 'the fret-23 note was analysed, not skipped');

  const viaCli = runCli([proj, '--max-fret', '22', '--json']);
  assert.equal(viaCli.json.instrument.maxFret, 22);
  assert.equal(viaCli.json.configSources.maxFret, 'cli', 'CLI outranks config (C5)');
  assert.equal(viaCli.json.settings.maxFret, 22);
});

test('--bars scopes the analysis to the requested range', () => {
  const all = runCli([CLEAN, '--json']);
  assert.equal(all.json.stats.phrases, 2);
  const one = runCli([CLEAN, '--bars', '2', '--json']);
  assert.equal(one.json.stats.phrases, 1);
  assert.deepEqual(one.json.phrases[0].bars, [2]);
});

test('C15: the tool NEVER rewrites the tab it is given', () => {
  // The single most important promise this wave makes. Bytes in, bytes out.
  const before = ALL_FIXTURES.map((f) => fs.readFileSync(f));
  for (const f of ALL_FIXTURES) {
    assert.equal(runCli([f, '--json']).code, 0);
    assert.equal(runCli([f]).code, 0);
  }
  ALL_FIXTURES.forEach((f, i) => {
    assert.ok(before[i].equals(fs.readFileSync(f)),
      `${path.basename(f)} was modified — no optimizer may ever rewrite a tab`);
  });
});

test('the human report carries the tone caveat whenever it suggests anything', () => {
  // Not prose-pinning a finding: pinning that the CALLER is told positions are
  // not interchangeable in tone. Dropping this line would turn a question into a
  // verdict the module is not entitled to make.
  const r = runCli([TRAP]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /VOICES/);
  assert.match(r.stdout, /guitar-fretboard\.md/);
  assert.match(r.stdout, /difficulty:/, 'the §2.4 report shape');
  assert.match(r.stdout, /reason:/);
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test('a piano SOURCE has no fingering, and is refused rather than invented', () => {
  // The worst bug this module had: `\staff { score }` (every piano source in
  // projects/<slug>/) reports no string tuning, and alphaTab gives its notes
  // string -1 / fret -1. Assuming "6 strings" turned that into string 8 / fret
  // -1 — an impossible grip that scored as a hard violation, so EVERY note of a
  // piano source came back with a confident 100-unit "improvement". Silence is
  // the only correct answer here.
  for (const name of ['chaconne-excerpt.alphatab', 'foreground-over-chord-bed.alphatab']) {
    const r = runCli([fix(name), '--json']);
    assert.equal(r.code, 0, `${name}: a source file is not an ERROR, it is just not a tab`);
    assert.equal(r.json.stats.phrases, 0, `${name}: nothing on a score staff has a fingering`);
    assert.deepEqual(r.json.advisories, [], `${name}: and therefore nothing to advise`);
    assert.equal(r.json.stats.skippedStaves.length, 1);
    assert.match(r.json.stats.skippedStaves[0].reason, /not a fretted staff/);
  }
  // The human report must say WHY it is silent — "no change worth making" would
  // be a quiet lie about a file that was never analysable.
  const human = runCli([fix('chaconne-excerpt.alphatab')]);
  assert.match(human.stdout, /no fretted \(tab\) staff/);
  assert.doesNotMatch(human.stdout, /No fingering change worth making/);
});

test('repeated identical findings collapse to one, with an occurrence count', () => {
  // A riff that alternates a low pedal with a high stab poses the same question
  // every eighth note. Fourteen copies of one sentence is how a real finding
  // gets scrolled past (playability.mjs settled this for pick-demand).
  const r = runCli([fix('position-jump-slow.alphatab'), '--json']);
  assert.equal(r.code, 0);
  const jumps = r.json.advisories.filter((a) => a.code === 'fingering.position-jump');
  assert.equal(jumps.length, 2, 'two distinct jumps (3->13 and 13->3), not fourteen copies');
  assert.deepEqual(jumps.map((a) => `${a.data.fromPosition}->${a.data.toPosition}`),
    ['3->13', '13->3']);
  // The repetition itself is still reported — it is information, just not 14 findings.
  for (const a of jumps) assert.equal(a.data.occurrences, 7);
});

test('a non-standard string count is SKIPPED, loudly, not analysed wrongly', () => {
  // The STAFF's own tuning is the only evidence trusted here — an `opts`
  // stringCount cannot talk this module into misreading a 6-string staff...
  const { phrases, skippedStaves } = buildPhrases(scoreOf(TRAP), { stringCount: 7 });
  assert.equal(skippedStaves.length, 0, 'the fixture staff really is a 6-string guitar');
  assert.equal(phrases.length, 1);
  // ...and a staff that genuinely is not one is refused, because `positionsFor`
  // would otherwise answer against the standard tuning and be confidently wrong.
  const sevenString = {
    tracks: [{ staves: [{ stringTuning: { tunings: [64, 59, 55, 50, 45, 40, 35] }, bars: [] }] }],
  };
  const r = buildPhrases(sevenString, {});
  assert.equal(r.phrases.length, 0);
  assert.equal(r.skippedStaves.length, 1);
  assert.equal(r.skippedStaves[0].stringCount, 7);
  assert.match(r.skippedStaves[0].reason, /non-standard string count/);
});

test('an empty score analyses to nothing rather than throwing', () => {
  const result = analyzeFingering({ tracks: [] }, {});
  assert.deepEqual(result.phrases, []);
  assert.deepEqual(result.advisories, []);
  assert.equal(result.stats.events, 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${err.stack ?? err.message}\n\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

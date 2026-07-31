// ties.test.mjs — pins the tie-chain pass AND alphaTab's measured tie
// behaviours (tools/lib/ties.mjs).
// Run: node tools/lib/ties.test.mjs   (exit 0 = all green, 1 = failure)
//
// WHY THESE TESTS EXIST
// ---------------------
// The corruption modes this module detects leave NO trace in the parsed model:
// a dropped tie intent is a plain note, a no-origin dash tie is an open-string
// attack. If an @coderline/alphatab upgrade changes any of the measured
// behaviours below, the detection logic silently mis-counts — so the measured
// behaviours themselves are pinned here alongside the module's own logic.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTex, buildDigest } from './analysis.mjs';
import {
  collectTieChains,
  countTieTokens,
  auditTieIntents,
  buildTieAudit,
} from './ties.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
void REPO;

function parse(text) {
  const parsed = parseTex(text);
  assert.equal(parsed.ok, true, `fixture text must parse: ${JSON.stringify(parsed.errors ?? [])}`);
  return parsed.score;
}

const PIANO_HEADER = String.raw`
\tempo 120
.
\track "Piano" { instrument acousticgrandpiano }
\staff { score }
\voice
\ts (4 4)
`;

// --------------------------------------------------------------------------- //
// measured alphaTab behaviours (the ground the detectors stand on)
// --------------------------------------------------------------------------- //

test('MEASURED: {t} chain links same-pitch fragments, incl. chord members', () => {
  const score = parse(PIANO_HEADER
    + 'E5.16 E5{t}.16 E5{t}.8 (E5{t} A4).4 (A4{t} E4).4 A4{t}.4 |');
  const { chains } = collectTieChains(score);
  const multi = chains.filter((c) => c.fragments > 1);
  assert.equal(multi.length, 2, 'E5 chain + A4 chain');
  const e5 = multi.find((c) => c.midi === 76);
  assert.equal(e5.fragments, 4);
  assert.equal(e5.soundingBeats, 2, '0.25+0.25+0.5+1 — the chain\'s own duration');
  const a4 = multi.find((c) => c.midi === 69);
  assert.equal(a4.fragments, 3);
  assert.equal(a4.soundingBeats, 3);
  // E4 (single, in the chord with a tied A4) keeps ITS OWN duration: never
  // inherits the group envelope.
  const e4 = chains.find((c) => c.midi === 64);
  assert.equal(e4.fragments, 1);
  assert.equal(e4.soundingBeats, 1);
});

test('MEASURED: a {t} whose pitch never sounded is DROPPED into a plain attack', () => {
  const score = parse(PIANO_HEADER + 'F#4.2 A4{t}.2 | G4.1 |');
  const { chains } = collectTieChains(score);
  assert.equal(chains.filter((c) => c.fragments > 1).length, 0, 'nothing linked');
  assert.equal(chains.filter((c) => c.orphanContinuation).length, 0,
    'the model shows a PLAIN note — no trace of the tie intent');
  const audit = auditTieIntents('F#4.2 A4{t}.2 | G4.1 |', score);
  assert.equal(audit.textTieTokens, 1);
  assert.equal(audit.parsedTieDestinations, 0);
  assert.equal(audit.dropped, 1, 'only the text-vs-model audit exposes it');
});

test('MEASURED: {t} links ACROSS a gap (rest or other pitches) — recorded as gap', () => {
  const score = parse(PIANO_HEADER + 'A4.4 r.4 A4{t}.4 r.4 |');
  const { chains } = collectTieChains(score);
  const a4 = chains.find((c) => c.midi === 69 && c.fragments > 1);
  assert.ok(a4, 'the tie DID link across the rest');
  assert.equal(a4.gaps.length, 1);
  assert.equal(a4.gaps[0].gapBeats, 1, 'one beat of silence inside a "sustain"');
  assert.equal(a4.soundingBeats, 2, 'sounding excludes the gap');
});

test('MEASURED: tab dash tie with no origin = OPEN-STRING attack (corruption)', () => {
  const score = parse('\\tempo 120\n.\n\\ts 4 4\n2.3.4 r.4 r.2 |\n-.5.2 r.2 |');
  const { chains } = collectTieChains(score);
  assert.equal(chains.filter((c) => c.fragments > 1).length, 0);
  const bar2 = chains.find((c) => c.startBar === 2);
  assert.equal(bar2.midi, 45, 'A2 — the open 5th string, a pitch the text never states');
  const audit = auditTieIntents('2.3.4 r.4 r.2 |\n-.5.2 r.2 |', score);
  assert.equal(audit.dropped, 1);
});

test('MEASURED: cross-bar chain — the continuation lives in the next bar', () => {
  const score = parse(PIANO_HEADER + 'r.2 F#4.2 | F#4{t}.2 F#4{t}.4 F#4.4 |');
  const { chains } = collectTieChains(score);
  const chain = chains.find((c) => c.fragments === 3);
  assert.ok(chain, 'head + two continuations');
  assert.equal(chain.startBar, 1);
  assert.equal(chain.endBar, 2);
  assert.equal(chain.soundingBeats, 5, '2+2+1 across the barline');
  assert.equal(chain.gaps.length, 0);
  // the bar-2 F#4.4 at beat 3 is a FRESH attack, not part of the chain
  const fresh = chains.find((c) => c.startBar === 2 && c.fragments === 1);
  assert.ok(fresh);
});

// --------------------------------------------------------------------------- //
// token counting
// --------------------------------------------------------------------------- //

test('countTieTokens: {t} in note effects, dash ties; -1.N is NOT a tie', () => {
  const t1 = countTieTokens('E5.16 E5{t}.16 (E5{t} A4).4 |');
  assert.equal(t1.braceTies, 2);
  assert.equal(t1.dashTies, 0);
  const t2 = countTieTokens('2.3.2 -.3.2 | -.5.2 r.2 |');
  assert.equal(t2.dashTies, 2);
  const t3 = countTieTokens('-1.1.4{beam Up} r.4 |'); // AT218 pitched-rest token
  assert.equal(t3.total, 0, 'a negative fret is an exporter artifact, not a tie');
  const t4 = countTieTokens('3.3.4{tu 3} 3.3.4{tr (16 16)} |');
  assert.equal(t4.total, 0, 'tuplet/trill braces are not tie tokens');
});

// --------------------------------------------------------------------------- //
// digest integration (analysis.mjs)
// --------------------------------------------------------------------------- //

const MICROFRAG = PIANO_HEADER
  + 'E5.16 E5{t}.16 E5{t}.8 (E5{t} A4).4 (A4{t} E4).4 A4{t}.4 |\n'
  + 'F#4.2 A4{t}.2 |\n'
  + 'D6{t}.2 r.2 |\n';

test('digest: tie continuations are NOT melody attacks; heads carry merged duration', () => {
  const digest = buildDigest(parse(MICROFRAG), { song: 'microfrag', sourceText: MICROFRAG });
  const b1 = digest.bars[0];
  // Raw evidence layer keeps every fragment…
  assert.equal(b1.voices[0].notes.length, 8,
    'all 8 parsed fragments preserved (E5 x4, A4 x3, E4 x1)');
  // …but the interpreted melody is coalesced to the three real attacks.
  assert.deepEqual(b1.melody.map((n) => [n.name, n.onset]), [['E5', 0], ['A4', 1], ['E4', 2]]);
  const e5 = b1.melody[0];
  assert.equal(e5.beats, 2, 'head carries the CHAIN sounding duration');
  const e4 = b1.melody[2];
  assert.equal(e4.beats, 1, 'a chord-mate keeps its own duration — never the group envelope');
  // Skeleton also sees only real attacks.
  assert.equal(b1.melodySkeleton.length, 3);
  // Bar 2: the A4{t} linked back across a 2-beat gap — a continuation, so the
  // only bar-2 melody attacks are F#4 (bar 3's D6 dropped-intent is separate).
  const b2 = digest.bars[1];
  assert.deepEqual(b2.melody.map((n) => n.name), ['F#4']);
  assert.ok(b2.flags.includes('tieAnomaly'), 'gap tie flagged on the bar it lands in');
});

test('digest: tieAudit reports chains, gaps, and dropped intents', () => {
  const digest = buildDigest(parse(MICROFRAG), { song: 'microfrag', sourceText: MICROFRAG });
  const ta = digest.tieAudit;
  assert.equal(ta.multiFragmentChains, 2, 'E5 chain + A4 chain');
  assert.equal(ta.longestChainFragments, 4);
  assert.equal(ta.tieAcrossGap, 1, 'the bar-2 A4{t} linked across silence');
  assert.equal(ta.pitchChangedChains, 0);
  assert.equal(ta.intent.dropped, 1, 'the D6{t} intent was swallowed by the parser');
  assert.ok(ta.anomalies.some((a) => a.kind === 'tie-across-gap'));
  assert.ok(ta.anomalies.some((a) => a.kind === 'dropped-tie-intents'));
});

test('digest: tie-free sources are unchanged (no chains, no flags, empty audit)', () => {
  const text = PIANO_HEADER + 'D5.4 E5.4 F#5.4 G5.4 |\nA4.1 |\n';
  const digest = buildDigest(parse(text), { song: 'clean', sourceText: text });
  assert.equal(digest.tieAudit.multiFragmentChains, 0);
  assert.equal(digest.tieAudit.intent.dropped, 0);
  assert.ok(digest.bars.every((b) => !b.flags.includes('tieAnomaly')));
  assert.ok(digest.bars.every((b) => b.voices.every(
    (v) => v.notes.every((n) => n.tieChainId === undefined))),
  'no tie fields on tie-free notes — the additive contract stays quiet');
});

test('digest: harmonic stratum sees a fragment cloud as ONE long note', () => {
  // Whole-note D4 shattered into four tied quarters + eighth-note C#5/D5
  // chatter above. Without within-bar chain merging every D4 fragment is
  // 1 beat (>= 1.0 passes trivially here), so use eighths: 8x 0.5-beat
  // fragments. The merged chain (4 beats) must enter the >= 1 beat stratum.
  const text = PIANO_HEADER
    + 'D4.8 D4{t}.8 D4{t}.8 D4{t}.8 D4{t}.8 D4{t}.8 D4{t}.8 D4{t}.8 |\n'
    + '\\voice\n'
    + 'A4.8 B4.8 A4.8 B4.8 A4.8 B4.8 A4.8 B4.8 |\n';
  const digest = buildDigest(parse(text), { song: 'stratum', sourceText: text });
  const h = digest.bars[0].harmony;
  assert.equal(h.root, 'D');
  // The stratum keeps only the merged D4 (the eighth-note chatter is short),
  // so the pcset stays narrow: just the root's pc.
  assert.deepEqual(h.pcset, [2]);
});

// --------------------------------------------------------------------------- //
// runner
// --------------------------------------------------------------------------- //
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

// foreground.test.mjs — the perceptual-foreground scorer (tools/lib/foreground.mjs).
// Run: node tools/lib/foreground.test.mjs   (exit 0 = all green, 1 = failure)
//
// These are the Improve_Plan §9 acceptance behaviours, pinned:
//   1. artifact-split voices recombine into ONE foreground line;
//   2. the highest note LOSES to a recurring lower melody;
//   6. agreement between two independent transcriptions raises confidence;
//   plus the §3.3 overlap classifications (punctuation / bed / doubling).
// Fixtures are the synthetic noisy-transcription corpus in tools/fixtures/.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDigest } from './analysis.mjs';
import { buildForeground, renderForegroundMap } from './foreground.mjs';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fix = (n) => path.join(FIX, n);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const digestCache = new Map();
async function digestOf(fixture) {
  if (!digestCache.has(fixture)) {
    const { digest } = await extractDigest(fix(fixture));
    digestCache.set(fixture, digest);
  }
  return digestCache.get(fixture);
}

test('a recurring lower melody outranks the isolated high octave artifact', async () => {
  const doc = buildForeground(await digestOf('false-high-octave.alphatab'));
  const b3 = doc.bars.find((b) => b.bar === 3);
  const [winner, runnerUp] = b3.foregroundCandidates;
  assert.deepEqual(winner.line, ['D5', 'E5', 'F#5', 'E5'],
    'the recurring line wins, not the D6-topped one');
  assert.ok(winner.evidence.includes('return agreement'),
    'recurrence across bars 1/2/4 is the decisive evidence');
  assert.ok(runnerUp.line.includes('D6'), 'the artifact line stays VISIBLE as an alternative');
  assert.ok(runnerUp.confidence < winner.confidence);
  assert.ok(runnerUp.warnings.includes('isolated highest-note overlaps'));
  const d6 = b3.classifications.find((c) => c.name === 'D6');
  assert.equal(d6.class, 'octave-doubling');
});

test('voice-fragmented attacks recombine into one cross-voice foreground', async () => {
  const doc = buildForeground(await digestOf('noisy-basic-pitch-voices.alphatab'));
  const b1 = doc.bars[0];
  const winner = b1.foregroundCandidates[0];
  const voices = new Set(winner.notes.map((n) => n.voice));
  assert.ok(voices.size >= 2, `the line must draw from >= 2 voices, got ${[...voices]}`);
  assert.ok(winner.evidence.includes('continuation across voice handoffs'));
  assert.ok(!winner.line.includes('A5'), 'the octave artifact stays out of the line');
  assert.equal(b1.classifications.find((c) => c.name === 'A5')?.class, 'octave-doubling');
  assert.equal(b1.classifications.find((c) => c.name === 'E2')?.class, 'harmonic-bed');
});

test('short punctuations over a sustained pad classify per §3.3', async () => {
  const doc = buildForeground(await digestOf('foreground-over-chord-bed.alphatab'));
  const b1 = doc.bars[0];
  const byName = (n) => b1.classifications.filter((c) => c.name === n).map((c) => c.class);
  assert.deepEqual(byName('C#5'), ['foreground-punctuation']);
  assert.deepEqual(byName('E5'), ['foreground-punctuation']);
  assert.deepEqual(byName('B4'), ['foreground'], 'the 1-beat arrival is plain foreground');
  assert.deepEqual(byName('A3'), ['harmonic-bed']);
  assert.deepEqual(byName('E4'), ['harmonic-bed']);
});

test('cross-source agreement raises confidence; disagreement stays visible', async () => {
  const a = await digestOf('noisy-two-source-a.alphatab');
  const b = await digestOf('noisy-two-source-b.alphatab');
  const single = buildForeground(a).bars[0];
  const cross = buildForeground(a, { others: [b] }).bars[0];
  const sw = single.foregroundCandidates[0];
  const cw = cross.foregroundCandidates[0];
  assert.deepEqual(cw.line, ['B4', 'A4', 'B4', 'C#5']);
  assert.ok(cw.confidence > sw.confidence,
    `cross-source consensus must RAISE confidence (${cw.confidence} vs ${sw.confidence})`);
  assert.ok(cw.evidence.includes('cross-source consensus'));
  const artifactCand = cross.foregroundCandidates.find((c) => c.line.includes('B5'));
  assert.ok(artifactCand, 'the artifact-topped alternative is still reported');
  assert.ok(artifactCand.warnings.includes('isolated highest-note overlaps'));
  assert.ok(artifactCand.confidence < cw.confidence);
});

test('ambiguity is reported, never silently resolved', async () => {
  const doc = buildForeground(await digestOf('noisy-basic-pitch-voices.alphatab'));
  // The synthetic bar genuinely supports two readings (C#5 vs B4 at beat 1);
  // whichever wins, the loser must remain visible with a close-enough score
  // that the bar surfaces for human review at Gate A.
  assert.ok(doc.bars[0].foregroundCandidates.length >= 2);
  const map = renderForegroundMap(doc);
  assert.match(map, /Ambiguous bars|AMBIGUOUS|ambiguous: \*\*[1-9]/);
});

// --------------------------------------------------------------------------- //
// runner (async-aware)
// --------------------------------------------------------------------------- //
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

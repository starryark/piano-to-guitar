#!/usr/bin/env node
// tools/source-profile.mjs — source-reliability report for Gate A (PTG-native).
//
//   node tools/source-profile.mjs <source.alphatab> [--json]
//
// Answers the Gate A source-reliability questions (Improve_Plan §1) from
// STRUCTURE, never from track names:
//   * clean notation or noisy automatic transcription?
//   * which tracks/voices are fragments of ONE performance?
//   * which tracks are percussion (and on what structural evidence)?
//   * how bad is the noise — fragmentation, octave artifacts, tie dust,
//     off-grid onsets?
//
// This is a REPORT, not a gate: exit 0 whenever the source parses, 1 when it
// does not, 2 on usage errors. The verdict its numbers support (digest
// skeleton vs reviewed foreground contract) is a human decision at Gate A.

import * as fs from 'node:fs';
import { extractDigest } from './lib/analysis.mjs';
import { emit, emitErr } from './lib/emit.mjs';

function parseArgs(argv) {
  let json = false;
  const positional = [];
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      emitErr(`Unknown flag: ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  return { file: positional[0] ?? null, json };
}

const { file, json } = parseArgs(process.argv.slice(2));
if (!file) {
  emitErr('Usage: node tools/source-profile.mjs <source.alphatab> [--json]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  emitErr(`No file at "${file}"`);
  process.exit(2);
}

let digest;
try {
  ({ digest } = await extractDigest(file));
} catch (e) {
  emitErr(`Cannot parse "${file}": ${e.message}`);
  for (const d of (e.diagnostics || []).slice(0, 8)) {
    emitErr(`  ${d.severity} line ${d.line ?? '?'}: ${d.message}`);
  }
  process.exit(1);
}

const profile = digest.sourceProfile;
const ta = digest.tieAudit;

if (json) {
  emit(JSON.stringify({
    ok: true,
    file,
    song: digest.song,
    bars: digest.bars.length,
    sourceProfile: profile,
    tieAudit: ta,
  }, null, 2));
  process.exit(0);
}

const L = [];
L.push(`SOURCE PROFILE  ${file}`);
L.push(`  song "${digest.song}"  |  ${digest.bars.length} bars  |  key ${digest.key}`);
L.push('');
L.push(`  kind                 ${profile.kind.toUpperCase()}`);
L.push('');
L.push('  pitched-performance groups:');
for (const g of profile.pitchedPerformanceGroups) {
  L.push(`    ${g.id}  tracks [${g.tracks.join(', ')}]  voices [${g.voices.join(', ')}]  — ${g.reason}`);
}
if (!profile.pitchedPerformanceGroups.length) L.push('    (none — no pitched material)');
L.push('');
L.push('  excluded tracks:');
for (const e of profile.excludedTracks) {
  L.push(`    track ${e.track}${e.name ? ` "${e.name}"` : ''}  role=${e.role}  confidence=${e.confidence}`);
  L.push(`      evidence: ${e.evidence.join('; ')}`);
}
if (!profile.excludedTracks.length) L.push('    (none)');
L.push('');
const ns = profile.noiseSignals;
L.push('  noise signals:');
L.push(`    voice fragmentation          ${ns.voiceFragmentation} (${ns.fragmentedGestures} fragmented gesture(s))`);
L.push(`    isolated octave artifacts    ${ns.isolatedOctaveArtifacts}`);
L.push(`    microfragment tie chains     ${ns.microTieFragments}`);
L.push(`    near-simultaneous splits     ${ns.nearSimultaneousSplits}`);
L.push(`    off-grid onsets              ${ns.offGridOnsets} (mean normalization confidence ${ns.meanNormalizationConfidence})`);
L.push(`    mixed-duration gestures      ${ns.mixedDurationGestures}`);
if (ta) {
  L.push(`    tie chains                   ${ta.chains} (${ta.multiFragmentChains} multi-fragment, longest ${ta.longestChainFragments})`);
  if (ta.intent && ta.intent.dropped > 0) {
    L.push(`    DROPPED tie intents          ${ta.intent.dropped} — reattacks the author never wrote`);
  }
}
L.push('');
if (profile.kind === 'noisy-transcription') {
  L.push('  VERDICT: treat this source as a NOISY TRANSCRIPTION.');
  L.push('    - The highest sounding voice is a melody CANDIDATE, not perceptual truth.');
  L.push('    - Review the per-bar foregroundEvidence (and a foreground contract) before drafting.');
  L.push('    - Never declare a source-tied span `free` because the extractor disagrees.');
} else {
  L.push('  VERDICT: clean notation — the digest skeleton is a trustworthy fidelity authority.');
}
emit(L.join('\n'));
process.exit(0);

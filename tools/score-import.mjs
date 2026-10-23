#!/usr/bin/env node
// tools/score-import.mjs — MusicXML score -> project source.alphatab (PTG-native).
//
//   node tools/score-import.mjs <score.mxl|.musicxml|.xml> --project <slug> [options]
//   node tools/score-import.mjs <score> --out <dir> [options]
//
// The ONE door a non-AlphaTex score comes through. Everything downstream
// (piano-validate, piano-extract, source-profile, the gates) is unchanged and
// still reads only AlphaTex; this tool produces that AlphaTex with alphaTab's
// own MusicXML importer + AlphaTex exporter and proves the conversion lost
// nothing (tools/lib/score-import.mjs has the hazards and why they matter).
//
// Writes into the project folder:
//   source.alphatab     every selected part at CONCERT pitch (drums keep a GM kit)
//   source-roles.json   PROPOSED melody carrier per section — Gate A reviews it;
//                       piano-extract applies it (never written over without --force)
//   import-report.md    track inventory, roles evidence, repairs, audits, next steps
//   import-report.json  the same, machine-readable
//   original.<ext>      a byte copy of the input, for re-import and provenance
//   sidecar.json        { song, entries: [] } if absent (Step 0 initializes it)
//
// Options:
//   --tracks 0,2,7   keep only these tracks (score order), in this order
//   --title "Name"   score title when the file carries none
//   --force          overwrite an existing source.alphatab / source-roles.json
//   --json           print the report as JSON
//
// Exit: 0 imported and verified; 1 the conversion could not be verified
// (round trip or note-count audit failed — nothing is written); 2 usage/IO.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emit, emitErr } from './lib/emit.mjs';
import {
  ImportError, loadMusicXml, musicXmlNoteAudit, compareNoteAudit, concertOffsets,
  repairExportHazards, repairDetachedTies, normalizeDrumKit, exportAlphaTex, roundTripAudit,
  selectTracks, analyzeTracks, proposeMelodySpans, uncoveredBars, transpositionCheck, scoreSections,
} from './lib/score-import.mjs';
import { ROLES_SCHEMA_VERSION, validateRoles } from './lib/source-roles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node tools/score-import.mjs <score.mxl|.musicxml|.xml> (--project <slug> | --out <dir>)\n'
  + '       [--tracks 0,2,7] [--title "Name"] [--force] [--json]';

function parseArgs(argv) {
  const o = { input: null, project: null, out: null, tracks: null, title: null, force: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ImportError(`${a} requires a value\n${USAGE}`, 2);
      return v;
    };
    if (a === '--project') o.project = value();
    else if (a === '--out') o.out = value();
    else if (a === '--title') o.title = value();
    else if (a === '--tracks') {
      const v = value();
      o.tracks = v.split(',').map((s) => Number(s.trim()));
      if (!o.tracks.length || o.tracks.some((t) => !Number.isInteger(t) || t < 0)) {
        throw new ImportError(`--tracks takes comma-separated track indices, got "${v}"`, 2);
      }
      if (new Set(o.tracks).size !== o.tracks.length) throw new ImportError('--tracks lists a track twice', 2);
    } else if (a === '--force') o.force = true;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) throw new ImportError(`unknown flag ${a}\n${USAGE}`, 2);
    else if (!o.input) o.input = a;
    else throw new ImportError(`unexpected argument ${a}\n${USAGE}`, 2);
  }
  if (!o.input) throw new ImportError(USAGE, 2);
  if (Boolean(o.project) === Boolean(o.out)) throw new ImportError(`give exactly one of --project or --out\n${USAGE}`, 2);
  if (o.project && !/^[a-z0-9][a-z0-9._-]*$/i.test(o.project)) {
    throw new ImportError(`--project must be a folder-safe slug (letters, digits, . _ -), got "${o.project}"`, 2);
  }
  return o;
}

const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return (r.startsWith('..') ? p : r).split(path.sep).join('/');
};

function renderReport(r) {
  const L = [];
  L.push(`# Import report -- ${r.title}`, '');
  L.push(`- Input: \`${r.input.file}\` (sha256 \`${r.input.sha256.slice(0, 16)}…\`)`);
  L.push(`- Imported: **${r.bars}** bars, **${r.tracks.length}** track(s) in the score`
    + `${r.selectedTracks ? `, **${r.selectedTracks.length}** kept in source.alphatab (\`--tracks ${r.selectedTracks.join(',')}\`)` : ', all kept in source.alphatab'}`);
  L.push(`- Meter(s): ${r.meters.map(([m, n]) => `${m} x${n}`).join(', ')}  |  first tempo ${r.tempo ?? '?'} BPM`);
  L.push(`- Conversion verified: note counts ${r.audit.problems.length ? '**MISMATCH**' : 'match the MusicXML in every part'}; `
    + `round trip ${r.roundTrip.ok ? `exact over ${r.roundTrip.compared} attack(s)` : '**FAILED**'}`);
  L.push('- **Pitch is CONCERT pitch everywhere** — transposing parts were rewritten before import (see Repairs).');
  L.push('');
  L.push('## Tracks', '');
  L.push('Indices are the score\'s own track order'
    + `${r.selectedTracks ? '; `src` is the index inside source.alphatab (what source-roles.json uses)' : ' — the same indices source.alphatab and source-roles.json use'}.`, '');
  L.push(`| # |${r.selectedTracks ? ' src |' : ''} name | GM program | notes | bars | range | mono | step | role | concert offset |`);
  L.push(`|---|${r.selectedTracks ? '---|' : ''}---|---|---|---|---|---|---|---|---|`);
  for (const t of r.tracks) {
    const src = r.selectedTracks ? ` ${r.selectedTracks.indexOf(t.track) >= 0 ? r.selectedTracks.indexOf(t.track) : '—'} |` : '';
    L.push(`| ${t.track} |${src} ${t.name} | ${t.program ?? '?'} (${t.family ?? '?'}) | ${t.notes} | ${t.activeBars ?? '-'} | `
      + `${t.range ? `${t.range.loName}–${t.range.hiName}` : '-'} | ${t.monophony ?? '-'} | ${t.stepwise ?? '-'} | ${t.role} | `
      + `${t.concertOffset ? `${t.concertOffset > 0 ? '+' : ''}${t.concertOffset}` : '0'} |`);
  }
  L.push('', '`mono` = share of attacks that are single notes; `step` = share of moves of a tone or less. '
    + 'A sung line is high on both; an arpeggio is mono but leaps; comping and pads are polyphonic.', '');
  L.push('## Melody carriers (source-roles.json)', '');
  if (!r.roles) {
    L.push('**Single pitched part — no `source-roles.json` written.** The melody is that part\'s top voice '
      + '(the register heuristic), which is the right reading for a solo piano score; there is no other '
      + 'part it could be confused with.', '');
  } else {
    L.push(`Status: **${r.roles.status}**. This is a PROPOSAL from line statistics, not a decision. At Gate A, `
      + 'audition each named track solo (VS Code alphaTab extension: solo the track in source.alphatab) and '
      + 'confirm or edit `source-roles.json`, then set `"status": "reviewed"` and re-run piano-extract.', '');
    L.push('| source bars | melody track(s) | per-section evidence (best / runner-up) | note |');
    L.push('|---|---|---|---|');
    for (const s of r.roles.melody) {
      const names = s.tracks.map((t) => `${t} ${r.sourceTrackNames[t]}`).join(' + ');
      const ev = s.evidence.map((e) => `${e.section ? `[${e.section}] ` : ''}${e.best ? `${e.best.track}=${e.best.score}` : '-'}`
        + ` / ${e.runnerUp ? `${e.runnerUp.track}=${e.runnerUp.score}` : '-'}`).join('; ');
      L.push(`| ${s.bars[0]}-${s.bars[1]} | ${names} | ${ev} | ${s.note} |`);
    }
    if (r.uncovered.length) {
      L.push('', `No melodic line detected in bars ${r.uncovered.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}: `
        + 'no span covers them, so they keep the register heuristic (`reg:` in the bar map). If the melody '
        + 'really rests there, add a span with `"tracks": []`.');
    }
    L.push('', 'Harmony (`"harmony": "accompaniment"`) is read from every other pitched track in each bar, so the '
      + 'melody\'s own long notes never widen the chord the gate protects.', '');
  }
  if (r.transposition.length) {
    L.push('## Transposition check', '');
    L.push('| track | written -> concert | consonance at concert | at written | verdict |');
    L.push('|---|---|---|---|---|');
    for (const t of r.transposition) {
      L.push(`| ${t.track} ${t.name} | ${t.soundsSemitones > 0 ? '+' : ''}${t.soundsSemitones} | ${t.soundingConsonance} | ${t.writtenConsonance} | `
        + `${t.suspicious ? '**SUSPICIOUS — the written reading fits the ensemble better; check the export**' : 'ok'} |`);
    }
    L.push('');
  }
  L.push('## Repairs at the format boundary', '');
  if (!r.repairs.concert.length && !r.repairs.placeholders.length && !r.repairs.ties.length && !r.repairs.drums.length) {
    L.push('None needed.');
  }
  for (const c of r.repairs.concert) {
    L.push(`- **Concert pitch:** part ${c.part} rewritten ${c.transposes.map((t) => `${t.semitones > 0 ? '+' : ''}${t.semitones}`).join(', ')} semitones `
      + `(${c.pitches} pitch(es), ${c.accidentalsDropped} written accidental(s) dropped${c.keys.length ? `, key ${c.keys.map((k) => `${k.written}->${k.concert}${k.note ? ` (${k.note})` : ''}`).join(', ')}` : ''}).`);
  }
  if (r.repairs.placeholders.length) {
    L.push(`- **Forward-gap placeholders → rests:** ${r.repairs.placeholders.length} voice gap(s) that would otherwise `
      + 'export as `r.256` and shift the voice: '
      + r.repairs.placeholders.map((p) => `t${p.track} bar ${p.bar} v${p.voice} (${p.gapTicks} ticks${p.droppedTicks ? `, ${p.droppedTicks} sub-64th tick(s) dropped` : ''})`).join('; ') + '.');
  }
  if (r.repairs.ties.length) {
    L.push(`- **Detached ties cleared:** ${r.repairs.ties.length} tie(s) whose origin is not the adjacent note — now fresh attacks: `
      + r.repairs.ties.slice(0, 12).map((t) => `t${t.track} bar ${t.bar} ${t.pitch}`).join('; ') + (r.repairs.ties.length > 12 ? '; …' : '') + '.');
  }
  for (const d of r.repairs.drums) {
    L.push(`- **Drum kit → GM defaults:** track ${d.track} ${d.trackName}, ${d.hits} hit(s) over GM notes ${d.instruments.join(', ')}.`);
  }
  L.push('');
  L.push('## Sections (from the score\'s rehearsal marks)', '');
  L.push(r.sections.map((s) => `${s.marker || '(start)'} ${s.a + 1}-${s.b + 1}`).join('  |  '), '');
  L.push('## Next steps (Step 0 continues unchanged)', '');
  L.push('```');
  for (const c of r.nextSteps) L.push(c);
  L.push('```');
  return `${L.join('\n')}\n`;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const input = path.resolve(o.input);
  const outDir = o.project ? path.join(ROOT, 'projects', o.project) : path.resolve(o.out);

  const { score, settings, xml, concertParts } = loadMusicXml(input);
  const offsets = concertOffsets(xml, concertParts);
  const audit = compareNoteAudit(score, musicXmlNoteAudit(xml));
  if (audit.problems.length) {
    throw new ImportError(`alphaTab did not import every note:\n  ${audit.problems.join('\n  ')}\nNothing written.`, 1);
  }
  const placeholders = repairExportHazards(score, settings);
  const ties = repairDetachedTies(score, settings);
  const drums = normalizeDrumKit(score, settings);
  const tracks = analyzeTracks(score, offsets);

  if (o.tracks) {
    selectTracks(score, settings, o.tracks);
    const kept = new Map();
    o.tracks.forEach((t, i) => { if (offsets.has(t)) kept.set(i, offsets.get(t)); });
    offsets.clear();
    for (const [k, v] of kept) offsets.set(k, v);
  }
  const title = o.title || score.title || (o.project ?? path.basename(input).replace(/\.[^.]+$/, ''));
  score.title = title;

  const text = exportAlphaTex(score, settings);
  const roundTrip = roundTripAudit(score, text);
  if (!roundTrip.ok) {
    throw new ImportError('the exported AlphaTex does not reproduce the imported score:\n  '
      + `${roundTrip.mismatches.slice(0, 12).join('\n  ')}${roundTrip.mismatches.length > 12 ? `\n  … ${roundTrip.mismatches.length - 12} more` : ''}\nNothing written.`, 1);
  }

  // Roles are proposed on the score AS WRITTEN to source.alphatab, so the
  // indices in source-roles.json are the ones piano-extract will see. A score
  // with one pitched part (solo piano) gets NO roles file: its melody is its
  // top voice, which the register heuristic already reads — a proposal could
  // only make that worse (a chordal intro scores as "no melodic line").
  const sourceTracks = o.tracks ? analyzeTracks(score, offsets) : tracks;
  const pitchedParts = sourceTracks.filter((t) => !t.percussion && t.notes > 0).length;
  const melody = pitchedParts > 1 ? proposeMelodySpans(score, sourceTracks) : [];
  const roles = pitchedParts > 1 ? {
    schemaVersion: ROLES_SCHEMA_VERSION,
    status: 'proposed',
    note: 'Proposed by score-import.mjs from per-section line statistics. Review at Gate A: audition the named '
      + 'tracks solo, edit spans/tracks as needed, then set status to "reviewed" and re-run piano-extract.',
    trackNames: sourceTracks.map((t) => t.name),
    melody,
    harmony: 'accompaniment',
    excludeTracks: [],
  } : null;
  // The proposal must satisfy the same contract piano-extract will enforce.
  if (roles) validateRoles(roles, { trackCount: score.tracks.length, barCount: score.masterBars.length });
  const uncovered = roles ? uncoveredBars(melody, score.masterBars.length) : [];
  const meters = new Map();
  for (const mb of score.masterBars) {
    const k = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    meters.set(k, (meters.get(k) ?? 0) + 1);
  }
  const bytes = fs.readFileSync(input);
  const ext = path.extname(input).toLowerCase();
  const report = {
    title,
    input: { file: path.basename(input), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    bars: score.masterBars.length,
    meters: [...meters.entries()],
    tempo: score.masterBars[0]?.tempoAutomations?.[0]?.value ?? score.tempo ?? null,
    selectedTracks: o.tracks,
    tracks,
    sourceTrackNames: sourceTracks.map((t) => t.name),
    sections: scoreSections(score),
    audit,
    roundTrip: { ok: roundTrip.ok, compared: roundTrip.compared },
    transposition: transpositionCheck(score, offsets),
    repairs: { concert: concertParts, placeholders, ties, drums },
    roles,
    uncovered,
    nextSteps: [],
  };
  const where = o.project ? `projects/${o.project}` : rel(outDir);
  report.nextSteps = [
    `node tools/piano-validate.mjs ${where}/source.alphatab`,
    `node tools/piano-extract.mjs ${where}/source.alphatab --out ${where}`
      + `${roles ? `   # applies ${where}/source-roles.json` : ''}`,
    `node tools/source-profile.mjs ${where}/source.alphatab`,
    `# then read ${where}/source-map.md${roles ? ' and review source-roles.json at Gate A' : ''}`,
  ];

  // ---- write (refuse to clobber a source or a reviewed roles file) ---------
  fs.mkdirSync(outDir, { recursive: true });
  const target = (name) => path.join(outDir, name);
  for (const name of ['source.alphatab', 'source-roles.json']) {
    if (fs.existsSync(target(name)) && !o.force) {
      throw new ImportError(`${rel(target(name))} exists; pass --force to replace it (a reviewed source-roles.json is your Gate A work)`, 2);
    }
  }
  const writes = [
    ['source.alphatab', text],
    ...(roles ? [['source-roles.json', `${JSON.stringify(roles, null, 2)}\n`]] : []),
    ['import-report.json', `${JSON.stringify(report, null, 2)}\n`],
    ['import-report.md', renderReport(report)],
  ];
  for (const [name, content] of writes) {
    const tmp = `${target(name)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target(name));
  }
  // A roles file left by an earlier import of a DIFFERENT (multi-part) source
  // would be applied to this one by piano-extract. Only reachable with --force.
  let staleRolesRemoved = false;
  if (!roles && fs.existsSync(target('source-roles.json'))) {
    fs.rmSync(target('source-roles.json'));
    staleRolesRemoved = true;
  }
  if (path.resolve(target(`original${ext}`)) !== input) fs.copyFileSync(input, target(`original${ext}`));
  if (!fs.existsSync(target('sidecar.json'))) {
    fs.writeFileSync(target('sidecar.json'), `${JSON.stringify({ song: title, entries: [] }, null, 2)}\n`, 'utf8');
  }

  if (o.json) {
    emit(JSON.stringify(report, null, 2));
    return;
  }
  emit(`${path.basename(input)} -> ${rel(target('source.alphatab'))}`);
  emit(`   ${report.bars} bars, ${score.tracks.length} track(s) | meters ${report.meters.map(([m, n]) => `${m}x${n}`).join(' ')} | tempo ${report.tempo}`);
  emit(`   verified: note counts match MusicXML; round trip exact over ${roundTrip.compared} attack(s)`);
  emit(`   repairs: ${concertParts.length} part(s) to concert pitch, ${placeholders.length} gap placeholder(s), `
    + `${ties.length} detached tie(s), ${drums.length} drum kit(s) mapped to GM`);
  for (const t of report.transposition) {
    if (t.suspicious) emitErr(`!! track ${t.track} ${t.name}: written pitch fits the ensemble better than concert — check the export before trusting the digest`);
  }
  if (!roles) {
    emit(`   melody: single pitched part — no source-roles.json; the top voice is the melody (register heuristic)`
      + `${staleRolesRemoved ? ' [removed a source-roles.json left by an earlier import]' : ''}`);
  } else {
    emit('   proposed melody carriers (source-roles.json — REVIEW AT GATE A):');
    for (const s of melody) {
      emit(`     bars ${String(s.bars[0]).padStart(3)}-${String(s.bars[1]).padEnd(3)} ${s.tracks.map((t) => `${t} ${sourceTracks[t].name}`).join(' + ')}`
        + `${s.note.includes('CLOSE CALL') ? '   <- close call' : ''}`);
    }
    for (const [a, b] of uncovered) {
      emit(`     bars ${String(a).padStart(3)}-${String(b).padEnd(3)} (no melodic line detected — register heuristic)`);
    }
  }
  emit(`   report: ${rel(target('import-report.md'))}`);
  emit('next:');
  for (const c of report.nextSteps) emit(`   ${c}`);
}

try {
  main();
} catch (e) {
  if (e instanceof ImportError || Number.isInteger(e?.exitCode)) {
    emitErr(`!! ${e.message}`);
    process.exit(e.exitCode);
  }
  emitErr(`!! ${e.stack ?? e}`);
  process.exit(2);
}

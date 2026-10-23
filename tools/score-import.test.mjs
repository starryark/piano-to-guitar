// score-import.test.mjs — the MusicXML import boundary, end to end.
// Run: node tools/score-import.test.mjs   (exit 0 = all green, 1 = failure)
//
// tools/fixtures/musicxml/ensemble.musicxml is built to trip every hazard the
// importer exists for (its header says which part trips which). Each hazard is
// tested in BOTH halves: the raw alphaTab path reproduces the defect, and the
// import path removes it. If a "raw path" test ever fails, alphaTab has fixed
// that defect upstream — re-evaluate the repair before deleting either half.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';
import {
  loadMusicXml, concertPitchNormalize, concertOffsets, musicXmlNoteAudit, compareNoteAudit,
  repairExportHazards, repairDetachedTies, normalizeDrumKit, exportAlphaTex, roundTripAudit,
  analyzeTracks, proposeMelodySpans, uncoveredBars, transpositionCheck, readMusicXmlText,
} from './lib/score-import.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(TOOLS, 'fixtures', 'musicxml', 'ensemble.musicxml');
const IMPORT = path.join(TOOLS, 'score-import.mjs');
const EXTRACT = path.join(TOOLS, 'piano-extract.mjs');
const PROFILE = path.join(TOOLS, 'source-profile.mjs');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const run = (tool, args) => {
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'score-import-test-'));
const beatsOf = (score, t, bar, v = 0) => score.tracks[t].staves[0].bars[bar - 1].voices[v].beats;
const line = (beats) => beats.map((b) => (b.isRest ? 'r'
  : b.notes.map((n) => `${n.realValue}${n.isTieDestination ? '~' : ''}`).join(','))).join(' ');

/** Raw alphaTab, no normalizer, no repairs — the path the old corpus files took. */
function rawImport() {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(FIXTURE)), settings);
  return { score, settings };
}

/** The importer's own pipeline, in order. */
function fullImport() {
  const loaded = loadMusicXml(FIXTURE);
  const { score, settings } = loaded;
  const placeholders = repairExportHazards(score, settings);
  const ties = repairDetachedTies(score, settings);
  const drums = normalizeDrumKit(score, settings);
  return { ...loaded, placeholders, ties, drums, text: exportAlphaTex(score, settings) };
}

// Minimal ZIP writer (deflate) so the .mxl container path is tested without a
// binary fixture. CRC-32 is computed properly so the archive is valid anywhere.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const packed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// --------------------------------------------------------------------------- //
// hazard 3: ties on transposing parts
// --------------------------------------------------------------------------- //

test('hazard 3, raw path: alphaTab loses the tie on a transposed part (upstream defect)', () => {
  const { score } = rawImport();
  // clarinet bar 2: G4 half TIED to G4 quarter, then F4 (concert)
  assert.equal(line(beatsOf(score, 0, 2)), '67 67 65', 'raw alphaTab drops the clarinet tie');
  assert.equal(line(beatsOf(score, 3, 2)), '55 55', 'raw alphaTab drops the guitar (octave-change) tie');
});

test('hazard 3, import path: concert-pitch normalization keeps every tie and pitch', () => {
  const { score } = fullImport();
  assert.equal(line(beatsOf(score, 0, 1)), '64 65 67 69', 'clarinet bar 1 sounds E4 F4 G4 A4');
  assert.equal(line(beatsOf(score, 0, 2)), '67 67~ 65', 'clarinet tie restored');
  assert.equal(line(beatsOf(score, 3, 2)), '55 55~', 'guitar tie restored, an octave below written');
  assert.equal(line(beatsOf(score, 3, 4)), '48~', 'cross-barline guitar tie restored');
  assert.equal(score.tracks[0].staves[0].displayTranspositionPitch, 0, 'source is displayed at concert pitch');
});

test('concert normalizer: untransposed parts are byte-identical; keys follow the transposition', () => {
  const xml = fs.readFileSync(FIXTURE, 'utf8');
  const { xml: out, parts } = concertPitchNormalize(xml);
  const part = (s, id) => new RegExp(`<part\\s+id="${id}"[^>]*>[\\s\\S]*?</part>`).exec(s)[0];
  for (const id of ['P2', 'P3', 'P5']) assert.equal(part(out, id), part(xml, id), `${id} untouched`);
  assert.deepEqual(parts.map((p) => p.part), ['P1', 'P4']);
  const clar = parts.find((p) => p.part === 'P1');
  assert.equal(clar.pitches, 12);
  assert.deepEqual(clar.keys, [{ written: 2, concert: 0 }], 'written D major -> concert C major');
  assert.equal(clar.accidentalsDropped, 1);
  assert.ok(!/<transpose\b/.test(out.replace(/<!--[\s\S]*?-->/g, '')), 'no <transpose> element survives');
  // spelling follows the declared diatonic step: written F#4 -> E4, not Fb4
  assert.match(part(out, 'P1'), /<pitch><step>E<\/step><octave>4<\/octave><\/pitch>/);
  const offsets = concertOffsets(xml, parts);
  assert.deepEqual([...offsets], [[0, -2], [3, -12]]);
});

test('concert normalizer: a key already written at concert pitch is left alone', () => {
  // MuseScore 3 can write a transposing part's key at concert pitch while its
  // notes are written pitch; re-transposing that key would be wrong.
  const xml = fs.readFileSync(FIXTURE, 'utf8').replace('<key><fifths>2</fifths></key>', '<key><fifths>0</fifths></key>');
  const clar = concertPitchNormalize(xml).parts.find((p) => p.part === 'P1');
  assert.deepEqual(clar.keys, [{ written: 0, concert: 0, note: 'already at concert pitch' }]);
});

test('transposition check: concert reading fits the ensemble better than written', () => {
  const { score, xml, concertParts } = fullImport();
  const rows = transpositionCheck(score, concertOffsets(xml, concertParts));
  const clar = rows.find((r) => r.track === 0);
  assert.ok(clar, 'the clarinet is checked');
  assert.equal(clar.suspicious, false);
  assert.ok(clar.soundingConsonance > clar.writtenConsonance);
});

// --------------------------------------------------------------------------- //
// hazards 1 and drums: the AlphaTex exporter
// --------------------------------------------------------------------------- //

test('hazard 1, raw path: the forward-gap placeholder exports as r.256 and shifts the voice', () => {
  const { score, settings } = rawImport();
  const rt = roundTripAudit(score, exportAlphaTex(score, settings));
  assert.equal(rt.ok, false);
  assert.ok(rt.mismatches.some((m) => /^track\/staff\/bar\/voice 0\/0\/2\/1: .*1920\+960:\d+ -> 15\+960/.test(m)),
    `expected the bar-2 voice-2 shift, got:\n${rt.mismatches.join('\n')}`);
  assert.ok(rt.mismatches.some((m) => /4\/0\/1\/0: .*p36 -> .*p38/.test(m)), 'raw drums collapse to one sound');
});

test('import path: placeholders become rests, drums keep a GM kit, the round trip is exact', () => {
  const { score, placeholders, ties, drums, text } = fullImport();
  assert.equal(placeholders.length, 1);
  assert.deepEqual(placeholders[0], {
    track: 0, trackName: 'Clarinet in Bb', staff: 0, bar: 2, voice: 1, gapTicks: 1920, rests: [1920], droppedTicks: 0,
  });
  assert.equal(ties.length, 0, 'no detached tie once pitches are concert');
  assert.equal(drums.length, 1);
  assert.deepEqual(drums[0].instruments, [36, 38]);
  assert.ok(!/r\.256/.test(text), 'no placeholder survives into the AlphaTex');
  const rt = roundTripAudit(score, text);
  assert.equal(rt.ok, true, rt.mismatches.join('\n'));
  assert.ok(rt.compared > 0, 'the round trip compared real attacks (never 0/0)');
});

test('note-count audit: XML and model agree; a dropped note is reported', () => {
  const { score, xml } = loadMusicXml(FIXTURE);
  const counts = musicXmlNoteAudit(xml);
  assert.deepEqual(counts.map((c) => c.pitched + c.unpitched), [12, 7, 24, 14, 24]);
  assert.deepEqual(compareNoteAudit(score, counts).problems, []);
  const short = counts.map((c, i) => (i === 1 ? { ...c, pitched: c.pitched + 1 } : c));
  assert.equal(compareNoteAudit(score, short).problems.length, 1);
});

// --------------------------------------------------------------------------- //
// roles proposal
// --------------------------------------------------------------------------- //

test('track analysis: roles from line statistics, not names', () => {
  const { score, xml, concertParts } = fullImport();
  const info = analyzeTracks(score, concertOffsets(xml, concertParts));
  assert.deepEqual(info.map((t) => t.role), ['melodic line', 'melodic line', 'pad', 'arpeggio/figure', 'percussion']);
  assert.equal(info[0].concertOffset, -2);
  assert.equal(info[3].concertOffset, -12);
});

test('melody proposal: clarinet then flute, the flute pickup moved into its own span', () => {
  const { score, xml, concertParts } = fullImport();
  const spans = proposeMelodySpans(score, analyzeTracks(score, concertOffsets(xml, concertParts)));
  assert.deepEqual(spans.map((s) => [s.bars, s.tracks]), [[[1, 3], [0]], [[4, 6], [1]]]);
  assert.match(spans[1].note, /pickup/);
  assert.ok(spans[0].evidence[0].best.score > spans[0].evidence[0].runnerUp.score);
});

// --------------------------------------------------------------------------- //
// the CLI, and the rest of Step 0 on its output
// --------------------------------------------------------------------------- //

test('CLI: imports, writes the project files, refuses to clobber without --force', () => {
  const dir = tmp();
  const r = run(IMPORT, [FIXTURE, '--out', dir]);
  assert.equal(r.code, 0, r.err);
  for (const f of ['source.alphatab', 'source-roles.json', 'import-report.md', 'import-report.json', 'original.musicxml', 'sidecar.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} written`);
  }
  const roles = JSON.parse(fs.readFileSync(path.join(dir, 'source-roles.json'), 'utf8'));
  assert.equal(roles.status, 'proposed');
  assert.deepEqual(roles.melody.map((s) => s.tracks), [[0], [1]]);
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir]).code, 2, 'second run without --force is refused');
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir, '--force']).code, 0);
});

test('CLI: refuses non-MusicXML input and bad flags (exit 2 usage, exit 1 content)', () => {
  const dir = tmp();
  assert.equal(run(IMPORT, [path.join(TOOLS, 'fixtures', 'chaconne-excerpt.alphatab'), '--out', dir]).code, 2);
  const notScore = path.join(dir, 'not-a-score.xml');
  fs.writeFileSync(notScore, '<?xml version="1.0"?><html/>');
  assert.equal(run(IMPORT, [notScore, '--out', path.join(dir, 'o')]).code, 1);
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir, '--tracks', '0,9']).code, 2, 'nonexistent track');
  assert.equal(run(IMPORT, [FIXTURE]).code, 2, 'no destination');
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir, '--bogus']).code, 2);
});

test('CLI: a compressed .mxl container imports identically', () => {
  const dir = tmp();
  const xml = fs.readFileSync(FIXTURE);
  const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>';
  const mxl = path.join(dir, 'ensemble.mxl');
  fs.writeFileSync(mxl, zip([['META-INF/container.xml', container], ['score.xml', xml]]));
  assert.equal(readMusicXmlText(fs.readFileSync(mxl), '.mxl'), xml.toString('utf8'));
  const a = run(IMPORT, [mxl, '--out', path.join(dir, 'a')]);
  const b = run(IMPORT, [FIXTURE, '--out', path.join(dir, 'b')]);
  assert.equal(a.code, 0, a.err);
  assert.equal(b.code, 0, b.err);
  assert.equal(fs.readFileSync(path.join(dir, 'a', 'source.alphatab'), 'utf8'),
    fs.readFileSync(path.join(dir, 'b', 'source.alphatab'), 'utf8'));
});

test('CLI --tracks: keeps a subset, re-indexes roles to the written source', () => {
  const dir = tmp();
  const r = run(IMPORT, [FIXTURE, '--out', dir, '--tracks', '2,1,0']);
  assert.equal(r.code, 0, r.err);
  const roles = JSON.parse(fs.readFileSync(path.join(dir, 'source-roles.json'), 'utf8'));
  assert.deepEqual(roles.trackNames, ['Piano', 'Flute', 'Clarinet in Bb']);
  assert.deepEqual(roles.melody.map((s) => s.tracks), [[2], [1]], 'clarinet is index 2 in the written source');
});

test('Step 0 on an import: roles steer the melody, --no-roles shows why they are needed', () => {
  const dir = tmp();
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir]).code, 0);
  const src = path.join(dir, 'source.alphatab');
  const withRoles = run(EXTRACT, [src, '--out', dir]);
  assert.equal(withRoles.code, 0, withRoles.err);
  assert.match(withRoles.out, /melody roles: .*source-roles\.json \(proposed\)/);
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
  assert.equal(d.key, 'C');
  assert.equal(d.sourceRoles.melody.length, 2);
  assert.deepEqual(d.bars[0].melody.map((n) => n.name), ['E4', 'F4', 'G4', 'A4'], 'bar 1 = the clarinet');
  assert.deepEqual(d.bars[4].melody.map((n) => n.name), ['E5', 'D5', 'C5', 'D5'], 'bar 5 = the flute');
  assert.deepEqual(d.bars[3].melody.map((n) => n.name), ['C5', 'D5'], 'bar 4 = the flute pickup');
  assert.ok(d.bars.every((b) => b.melodySource === 'designated'));
  assert.equal(d.bars[0].harmony.root, 'C');
  const map = fs.readFileSync(path.join(dir, 'source-map.md'), 'utf8');
  assert.match(map, /## Melody carriers/);
  assert.match(map, /\| 2 \| C \| C · – \| t0: G4\.2d F4\.4 \|/, 'lead sheet carries the tie-merged rhythm');

  const noRoles = run(EXTRACT, [src, '--out', path.join(dir, 'plain'), '--no-roles']);
  assert.equal(noRoles.code, 0, noRoles.err);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'plain', 'source.json'), 'utf8'));
  assert.equal(p.bars[0].melody[0].name, 'G5', 'register heuristic picks the piano chord top');
  assert.ok(!('sourceRoles' in p) && p.bars.every((b) => !('melodySource' in b)), 'roles-free digest carries no roles fields');

  const prof = run(PROFILE, [src, '--json']);
  assert.equal(prof.code, 0, prof.err);
  assert.equal(JSON.parse(prof.out).sourceProfile.kind, 'clean-notation', 'clean ensemble notation is not "noisy"');
});

test('Step 0 on an import: a malformed roles file fails closed (exit 2)', () => {
  const dir = tmp();
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir]).code, 0);
  const src = path.join(dir, 'source.alphatab');
  const rolesPath = path.join(dir, 'source-roles.json');
  const good = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
  const cases = [
    { ...good, melodyTracks: [0] },
    { ...good, melody: [{ bars: [1, 4], tracks: [0] }, { bars: [4, 6], tracks: [1] }] },
    { ...good, melody: [{ bars: [1, 6], tracks: [7] }] },
    { ...good, harmony: 'melody' },
  ];
  for (const bad of cases) {
    fs.writeFileSync(rolesPath, JSON.stringify(bad));
    const r = run(EXTRACT, [src, '--out', dir]);
    assert.equal(r.code, 2, `expected exit 2 for ${JSON.stringify(bad).slice(0, 80)}; got ${r.code}\n${r.err}`);
  }
  assert.equal(run(EXTRACT, [src, '--out', dir, '--roles', path.join(dir, 'missing.json')]).code, 2);
});

// --------------------------------------------------------------------------- //
// solo piano: no roles file — the top voice IS the melody
// --------------------------------------------------------------------------- //

const PIANO = path.join(TOOLS, 'fixtures', 'musicxml', 'piano.musicxml');

test('solo piano: no source-roles.json; the chordal intro keeps its top line', () => {
  const dir = tmp();
  const r = run(IMPORT, [PIANO, '--out', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /single pitched part — no source-roles\.json/);
  assert.ok(!fs.existsSync(path.join(dir, 'source-roles.json')), 'a one-part score gets no roles file');
  const ex = run(EXTRACT, [path.join(dir, 'source.alphatab'), '--out', dir]);
  assert.equal(ex.code, 0, ex.err);
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
  assert.equal(d.key, 'G');
  assert.equal(d.tempoInitial, 90);
  assert.equal(d.bars.filter((b) => b.melodySkeleton.length).length, 4, 'every bar protected (never 0/0)');
  assert.deepEqual(d.bars[0].melody.map((n) => n.name), ['D5', 'E5'], 'bar 1 = the chord tops, not "rests"');
  assert.deepEqual(d.bars[1].melody.map((n) => n.name), ['D5', 'C5', 'B4', 'A4']);
  assert.ok(!('sourceRoles' in d));
  const prof = run(PROFILE, [path.join(dir, 'source.alphatab'), '--json']);
  assert.equal(JSON.parse(prof.out).sourceProfile.kind, 'clean-notation', 'overlapping hands are notation');
});

test('solo piano: a compressed .mxl imports through --project', () => {
  const slug = `zz-score-import-test-${process.pid}`;
  const projectDir = path.join(TOOLS, '..', 'projects', slug);
  const dir = tmp();
  const mxl = path.join(dir, 'piano.mxl');
  const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="piano.xml"/></rootfiles></container>';
  fs.writeFileSync(mxl, zip([['META-INF/container.xml', container], ['piano.xml', fs.readFileSync(PIANO)]]));
  try {
    const r = run(IMPORT, [mxl, '--project', slug]);
    assert.equal(r.code, 0, r.err);
    for (const f of ['source.alphatab', 'import-report.md', 'original.mxl', 'sidecar.json']) {
      assert.ok(fs.existsSync(path.join(projectDir, f)), `${f} in projects/${slug}`);
    }
    assert.equal(run(EXTRACT, [path.join(projectDir, 'source.alphatab'), '--out', projectDir]).code, 0);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('--force over an earlier band import removes its now-stale roles file', () => {
  const dir = tmp();
  assert.equal(run(IMPORT, [FIXTURE, '--out', dir]).code, 0);
  assert.ok(fs.existsSync(path.join(dir, 'source-roles.json')));
  const r = run(IMPORT, [PIANO, '--out', dir, '--force']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /removed a source-roles\.json left by an earlier import/);
  assert.ok(!fs.existsSync(path.join(dir, 'source-roles.json')));
});

test('band score with no melodic carrier: no span, so the register heuristic applies (not "rests")', () => {
  const dir = tmp();
  const r = run(IMPORT, [FIXTURE, '--out', dir, '--tracks', '2,3']); // piano pad + guitar arpeggio
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /bars {3}1-6 {3}\(no melodic line detected — register heuristic\)/);
  const roles = JSON.parse(fs.readFileSync(path.join(dir, 'source-roles.json'), 'utf8'));
  assert.deepEqual(roles.melody, []);
  assert.equal(run(EXTRACT, [path.join(dir, 'source.alphatab'), '--out', dir]).code, 0);
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
  assert.ok(d.bars.every((b) => b.melodySource === 'register'));
  assert.equal(d.bars[0].melody[0].name, 'G5', 'the top line is kept for the arranger');
});

test('uncoveredBars: gaps between spans, before the first and after the last', () => {
  assert.deepEqual(uncoveredBars([], 6), [[1, 6]]);
  assert.deepEqual(uncoveredBars([{ bars: [3, 4] }], 6), [[1, 2], [5, 6]]);
  assert.deepEqual(uncoveredBars([{ bars: [1, 2] }, { bars: [3, 6] }], 6), []);
});

// --------------------------------------------------------------------------- //
// detached ties — both halves (the ensemble fixture and the real score need 0)
// --------------------------------------------------------------------------- //

test('detached tie: a tie-stop whose start sits before a rest becomes a fresh attack', () => {
  const dir = tmp();
  const file = path.join(dir, 'detached.musicxml');
  const attrs = (clef) => '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>'
    + `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${clef}</sign><line>${clef === 'G' ? 2 : 4}</line></clef></attributes>`;
  const q = (step, oct, tied) => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>1</duration>`
    + `<voice>1</voice><type>quarter</type>${tied ? `<notations><tied type="${tied}"/></notations>` : ''}</note>`;
  fs.writeFileSync(file, '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>'
    + '<score-part id="P1"><part-name>Line</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part></part-list>'
    + `<part id="P1"><measure number="1">${attrs('G')}${q('C', 5, 'start')}`
    + '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>'
    + `${q('C', 5, 'stop')}${q('D', 5)}</measure></part>`
    + `<part id="P2"><measure number="1">${attrs('F')}<note><pitch><step>C</step><octave>3</octave></pitch>`
    + '<duration>4</duration><voice>1</voice><type>whole</type></note></measure></part></score-partwise>');
  const { score, settings } = loadMusicXml(file);
  assert.equal(line(beatsOf(score, 0, 1)), '72 r 72~ 74', 'alphaTab links the tie across the rest');
  const repairs = repairDetachedTies(score, settings);
  assert.equal(repairs.length, 1);
  assert.deepEqual({ bar: repairs[0].bar, beatTick: repairs[0].beatTick, pitch: repairs[0].pitch, origin: repairs[0].origin },
    { bar: 1, beatTick: 1920, pitch: 'C5', origin: { bar: 1, tick: 0 } });
  assert.equal(line(beatsOf(score, 0, 1)), '72 r 72 74', 'the destination is attacked again');
  const rt = roundTripAudit(score, exportAlphaTex(score, settings));
  assert.equal(rt.ok, true, rt.mismatches.join('\n'));
});

// --- runner --------------------------------------------------------------

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
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

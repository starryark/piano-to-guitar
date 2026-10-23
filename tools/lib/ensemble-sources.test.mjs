// ensemble-sources.test.mjs — what multi-instrument sources changed in the
// analysis layer: source-roles (designated melody, accompaniment harmony),
// the source-profile fragmentation rule, and key inference with drums.
// Run: node tools/lib/ensemble-sources.test.mjs   (exit 0 = all green)
//
// Every rule is tested in both halves (C11.6): the case it must speak on and
// the case it must stay quiet on.

import assert from 'node:assert/strict';
import * as alphaTab from '@coderline/alphatab';
import { parseTex, buildDigest, renderMap } from './analysis.mjs';
import { validateRoles, spanForBar, RolesError } from './source-roles.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const parse = (text) => {
  const p = parseTex(text);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  return p.score;
};

// Track 0: a mid-register line (the tune). Track 1: a pad ABOVE it. Track 2:
// bass. Bar 2: the line rests while the band plays on.
const BAND = String.raw`
\tempo 100
.
\track "Line" { instrument clarinet }
\staff { score }
\voice
\ts (4 4)
E4.4 F4.4 G4.4 A4.4 | r.1 |
\track "Pad" { instrument pad1newage }
\staff { score }
\voice
(C5 E5 G5).1 | (C5 F5 A5).1 |
\track "Bass" { instrument electricbassfinger }
\staff { score }
\voice
C3.1 | F2.1 |
`;
const ROLES = { schemaVersion: 1, status: 'reviewed', melody: [{ bars: [1, 2], tracks: [0] }] };

// --------------------------------------------------------------------------- //
// source-roles: schema
// --------------------------------------------------------------------------- //

test('roles schema: valid file normalizes; defaults are explicit', () => {
  const r = validateRoles(ROLES, { trackCount: 3, barCount: 2 });
  assert.deepEqual(r, {
    status: 'reviewed', harmony: 'accompaniment', excludeTracks: [], melody: [{ bars: [1, 2], tracks: [0], note: null }],
  });
  assert.equal(spanForBar(r, 2).tracks[0], 0);
  assert.equal(spanForBar(r, 3), null);
});

test('roles schema: fails closed on every malformed shape', () => {
  const dims = { trackCount: 3, barCount: 2 };
  const bad = [
    { ...ROLES, extra: 1 },
    { ...ROLES, schemaVersion: 2 },
    { ...ROLES, status: 'approved' },
    { ...ROLES, harmony: 'melody' },
    { ...ROLES, excludeTracks: [3] },
    { ...ROLES, excludeTracks: [0] }, // excludes the melody track
    { ...ROLES, melody: [{ bars: [0, 2], tracks: [0] }] },
    { ...ROLES, melody: [{ bars: [1, 3], tracks: [0] }] },
    { ...ROLES, melody: [{ bars: [2, 1], tracks: [0] }] },
    { ...ROLES, melody: [{ bars: [1, 2], tracks: [0, 0] }] },
    { ...ROLES, melody: [{ bars: [1, 2], tracks: [0], voice: 1 }] },
    { ...ROLES, melody: [{ bars: [1, 1], tracks: [0] }, { bars: [1, 2], tracks: [1] }] },
    { ...ROLES, melody: 'track 0' },
  ];
  for (const r of bad) {
    assert.throws(() => validateRoles(r, dims), RolesError, JSON.stringify(r));
  }
});

// --------------------------------------------------------------------------- //
// source-roles: applied by the digest
// --------------------------------------------------------------------------- //

test('roles: without them the register heuristic takes the pad (the defect they fix)', () => {
  const d = buildDigest(parse(BAND), { song: 'band' });
  assert.equal(d.bars[0].melody[0].name, 'G5');
  assert.ok(!('sourceRoles' in d), 'no roles field without roles');
  assert.ok(d.bars.every((b) => !('melodySource' in b)), 'no per-bar roles field without roles');
  assert.equal(JSON.stringify(d), JSON.stringify(buildDigest(parse(BAND), { song: 'band', roles: null })),
    'roles: null is byte-identical to no roles');
});

test('roles: the designated line is the melody; where it rests, the melody rests', () => {
  const d = buildDigest(parse(BAND), { song: 'band', roles: ROLES, rolesFile: 'source-roles.json' });
  assert.deepEqual(d.bars[0].melody.map((n) => n.name), ['E4', 'F4', 'G4', 'A4']);
  assert.ok(d.bars[0].melodySkeleton.length > 0, 'the line is protected by the gate');
  assert.equal(d.bars[0].melodySource, 'designated');
  assert.equal(d.bars[1].melodySource, 'designated-rest');
  assert.deepEqual(d.bars[1].melody, [], 'never fall back to the pad when the line rests');
  assert.ok(d.bars[1].flags.includes('melodyRests'));
  assert.deepEqual(d.sourceRoles, {
    file: 'source-roles.json', status: 'reviewed', harmony: 'accompaniment', excludeTracks: [],
    melody: [{ bars: [1, 2], tracks: [0], trackNames: ['Line'] }],
  });
  const map = renderMap(d, false);
  assert.match(map, /## Melody carriers/);
  assert.match(map, /\| 1 \| 4\/4 \| 100 \| C \| t0: /);
  assert.match(map, /\| 2 \| F \| F · – \| \(rests\) — \|/);
});

test('roles: accompaniment harmony keeps the line\'s own notes out of the pcset', () => {
  const acc = buildDigest(parse(BAND), { roles: ROLES });
  assert.equal(acc.bars[0].harmony.root, 'C');
  assert.deepEqual(acc.bars[0].harmony.pcset, [0, 4, 7], 'C E G from pad + bass only');
  const all = buildDigest(parse(BAND), { roles: { ...ROLES, harmony: 'all' } });
  assert.ok(all.bars[0].harmony.pcset.length > 3, `"all" lets the line's quarter notes in: ${all.bars[0].harmony.pcset}`);
});

test('roles: an excluded track is invisible to melody, harmony and evidence', () => {
  const d = buildDigest(parse(BAND), { roles: { ...ROLES, excludeTracks: [1] } });
  assert.ok(d.bars.every((b) => b.voices.every((v) => v.track !== 1)));
  assert.ok(d.bars.every((b) => (b.foregroundEvidence || []).every((g) => g.notes.every((n) => n.track !== 1))));
  assert.deepEqual(d.bars[0].harmony.pcset, [0], 'only the bass is left to define bar 1');
});

// --------------------------------------------------------------------------- //
// source profile: fragmentation is a same-staff phenomenon
// --------------------------------------------------------------------------- //

/** A one-part MusicXML piano: `upper` and `lower` as two voices, either on two
 *  staves (a pianist's hands) or on one staff (transcription fragmentation). */
function pianoXml(sameStaff) {
  const note = (step, staff, voice) => `<note><pitch><step>${step}</step><octave>4</octave></pitch>`
    + `<duration>1</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff></note>`;
  const lowerStaff = sameStaff ? 1 : 2;
  const lowerVoice = sameStaff ? 2 : 5;
  const bar = (n) => `<measure number="${n}">${n === 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key>`
    + `<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>`
    + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : ''}`
    + ['E', 'F', 'G', 'A'].map((s) => note(s, 1, 1)).join('')
    + '<backup><duration>4</duration></backup>'
    + ['C', 'D', 'E', 'F'].map((s) => note(s, lowerStaff, lowerVoice)).join('')
    + '</measure>';
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>`
    + '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
    + `<part id="P1">${bar(1)}${bar(2)}</part></score-partwise>`;
}
const loadXml = (xml) => alphaTab.importer.ScoreLoader.loadScoreFromBytes(
  new Uint8Array(Buffer.from(xml, 'utf8')), new alphaTab.Settings());

test('profile: two hands in one register are notation, not fragmentation', () => {
  const sp = buildDigest(loadXml(pianoXml(false)), { song: 'hands' }).sourceProfile;
  assert.equal(sp.noiseSignals.fragmentedGestures, 0);
  assert.equal(sp.kind, 'clean-notation');
});

test('profile: the same notes as two voices of ONE staff still read as fragmentation', () => {
  const sp = buildDigest(loadXml(pianoXml(true)), { song: 'one staff' }).sourceProfile;
  assert.equal(sp.noiseSignals.fragmentedGestures, 8);
  assert.equal(sp.noiseSignals.voiceFragmentation, 'high');
  assert.equal(sp.kind, 'noisy-transcription');
});

test('profile: different instruments attacking together are ensemble writing', () => {
  const sp = buildDigest(parse(String.raw`
\tempo 100
.
\track "Line" { instrument clarinet }
\staff { score }
\voice
\ts (4 4)
E4.4 F4.4 G4.4 A4.4 | E4.4 F4.4 G4.4 A4.4 |
\track "Keys" { instrument acousticgrandpiano }
\staff { score }
\voice
C4.4 D4.4 E4.4 F4.4 | C4.4 D4.4 E4.4 F4.4 |
`), { song: 'duo' }).sourceProfile;
  assert.equal(sp.noiseSignals.fragmentedGestures, 0);
  assert.equal(sp.kind, 'clean-notation');
});

// --------------------------------------------------------------------------- //
// key inference ignores drums
// --------------------------------------------------------------------------- //

test('key: adding a drum track never changes the inferred key', () => {
  const tune = String.raw`
\tempo 100
.
\track "Keys" { instrument acousticgrandpiano }
\staff { score }
\voice
\ts (4 4)
A3.4 C4.4 E4.4 A4.4 | D4.4 F4.4 A4.4 E4.4 | A3.1 |
`;
  const drums = String.raw`
\track "Kit" { instrument percussion }
\staff { score }
\articulation defaults
\voice
\clef neutral
"Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 |
"Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 |
"Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 "Hi-Hat (closed)".8 |
`;
  const plain = buildDigest(parse(tune), { song: 'k' });
  const withKit = buildDigest(parse(tune + drums), { song: 'k' });
  assert.ok(withKit.sourceProfile.excludedTracks.length === 1, 'the kit is structurally percussion');
  assert.equal(withKit.key, plain.key);
  assert.equal(withKit.keyConfidence, plain.keyConfidence);
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

// piano-source.mjs — normalize an AlphaTex PIANO source before the parser sees it.
//
// WHY THIS EXISTS (read before touching it)
// -----------------------------------------
// This project's input is "AlphaTex with pitched staves" — a piano score written
// in AlphaTex, whatever instrument its header claims. Exporters that write those
// files occasionally emit a FRETTED token inside a PITCHED staff:
//
//     D4.4{beam Up}          <- pitched note, fine
//     -1.1.4{beam Up}        <- fret -1 on string 1, in a `\staff { score }`
//
// alphaTab locks a staff's note kind to the first note it sees, so every one of
// those tokens raises
//
//     AT218: Wrong note kind 'Fretted' for staff with note kind 'Pitched'.
//            Do not mix incompatible staves and notes.
//
// and the whole file fails to parse. Measured on CanonRock/Canon in D/
// canon-in-d-easy.alphatab: 11 such tokens, 11 AT218 errors, 0 bars readable.
//
// Every one of them occupies exactly one beat and sits exactly where a REST
// belongs. Fret -1 is not a playable fret; it is an exporter artifact — a rest
// written as a note. So the fix is a rest:
//
//     -1.<string>.<duration>   ->   r.<duration>
//
// THE MODULE HAS EXACTLY ONE JOB. It performs that one rewrite and nothing else.
// It does not tidy, reformat, strip engraving, or "fix" any other defect. If you
// find another defect in a source, report it to the human — do not encode it here.
//
// DOCTRINE (inherited from abc-to-guitar/tools/lib/abc-source.mjs):
//   * Normalize the text BEFORE the parser ever sees it. Never patch the tree.
//   * REPORT COUNTS — NEVER HIDE EDITS. Every rewrite is returned with its line,
//     its before-text and its after-text, and callers are expected to print them
//     even when the count is zero.
//   * Sources are read-only on disk. Normalization happens in memory, always.
//
// SAFETY RULE. The rewrite fires only inside a staff this module is CONFIDENT is
// pitched. A fretted staff legitimately contains `<fret>.<string>` tokens and is
// left completely alone; anything ambiguous is left alone and reported.
//
// This module is a library: no printing, no process.exit. `piano-validate.mjs`
// and the digest engine are its callers.

import * as fs from 'node:fs';
import * as alphaTab from '@coderline/alphatab';

// ---------------------------------------------------------------------------
// 1. Reading
// ---------------------------------------------------------------------------

/**
 * Read an .alphatab source without assuming its encoding.
 *
 * Track names in real exports are not ASCII — the CanonRock corpus carries
 * Korean track names ("일렉 기타") — so the encoding is reported, never assumed,
 * and every caller is expected to surface it.
 *
 * @returns {{ text: string, encoding: 'utf-8'|'utf-8-bom'|'latin-1', byteLength: number }}
 */
export function readPianoSource(filePath) {
  const raw = fs.readFileSync(filePath);
  const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const body = hasBom ? raw.subarray(3) : raw;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return { text, encoding: hasBom ? 'utf-8-bom' : 'utf-8', byteLength: raw.length };
  } catch {
    return { text: body.toString('latin1'), encoding: 'latin-1', byteLength: raw.length };
  }
}

// ---------------------------------------------------------------------------
// 2. Staff-kind detection
// ---------------------------------------------------------------------------

/** The note kinds alphaTab locks a staff to. `unknown` = not enough evidence. */
export const STAFF_KIND = Object.freeze({
  PITCHED: 'pitched',
  FRETTED: 'fretted',
  PERCUSSION: 'percussion',
  UNKNOWN: 'unknown',
});

/** A pitched note token: letter, optional accidental, octave. `Gb5`, `B3`, `C#4`. */
const PITCHED_NOTE_RE = /^[A-Ga-g](?:#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?-?\d+$/;
/** An integer head atom — a fret number, in `<fret>.<string>`. */
const INT_RE = /^-?\d+$/;
/** `\tuning piano|none|voice` — alphaTab's explicit "this staff is pitched" spelling. */
const PITCHED_TUNING_WORDS = new Set(['piano', 'none', 'voice']);

/** True if `staff` (from `scanSource`) is one the normalizer may rewrite inside. */
export function isPitchedStaff(staff) {
  return staff?.kind === STAFF_KIND.PITCHED;
}

/** True if `staff` (from `scanSource`) holds real fret/string notation. */
export function isFrettedStaff(staff) {
  return staff?.kind === STAFF_KIND.FRETTED;
}

/**
 * Staff kind straight off a parsed alphaTab `Staff`. Cross-checks the textual
 * scan; a disagreement between the two is worth reporting.
 */
export function parsedStaffKind(staff) {
  if (staff?.isPercussion) return STAFF_KIND.PERCUSSION;
  const strings = staff?.stringTuning?.tunings?.length ?? 0;
  return strings > 0 ? STAFF_KIND.FRETTED : STAFF_KIND.PITCHED;
}

/**
 * Decide a staff's note kind from the evidence the scan collected.
 *
 * Priority — declarative signals first, note evidence only as a fallback:
 *   1. `\tuning piano|none|voice`             -> pitched (alphaTab says so outright)
 *   2. `\tuning (E4 B3 …)` with real strings  -> fretted
 *   3. `\staff { … tabs … }`                  -> fretted (a tab staff is fretted)
 *   4. note evidence, and only when it is UNANIMOUS
 *
 * Fret -1 tokens are counted separately and deliberately excluded from the
 * fretted evidence: -1 is not a playable fret, so a `-1.N` token is never proof
 * of a fretted staff. That is what lets `canon-in-d-easy` — hundreds of pitched
 * tokens plus 11 `-1.1.N` artifacts — resolve cleanly to `pitched`.
 */
function classifyStaff(staff) {
  if (staff.tuning.pitchedKeyword) {
    return { kind: STAFF_KIND.PITCHED, reason: `\\tuning ${staff.tuning.pitchedKeyword}` };
  }
  if (staff.tuning.stringCount > 0) {
    return { kind: STAFF_KIND.FRETTED, reason: `\\tuning with ${staff.tuning.stringCount} strings` };
  }
  if (staff.display.includes('tabs')) {
    return { kind: STAFF_KIND.FRETTED, reason: '\\staff { … tabs … }' };
  }
  const c = staff.tokens;
  if (c.pitched > 0 && c.fretted === 0) {
    return { kind: STAFF_KIND.PITCHED, reason: `${c.pitched} pitched note tokens, no fret/string tokens` };
  }
  if (c.fretted > 0 && c.pitched === 0) {
    return { kind: STAFF_KIND.FRETTED, reason: `${c.fretted} fret/string tokens, no pitched tokens` };
  }
  if (c.pitched > 0 && c.fretted > 0) {
    return {
      kind: STAFF_KIND.UNKNOWN,
      reason: `ambiguous: ${c.pitched} pitched and ${c.fretted} fret/string tokens, no \\tuning and no tabs staff`,
    };
  }
  if (c.articulation > 0) {
    return { kind: STAFF_KIND.PERCUSSION, reason: `${c.articulation} articulation tokens` };
  }
  return { kind: STAFF_KIND.UNKNOWN, reason: 'no notes' };
}

// ---------------------------------------------------------------------------
// 3. The scanner
// ---------------------------------------------------------------------------
//
// AlphaTex written by an exporter is line-oriented: metadata directives start a
// line with `\tag`, and every other non-blank line is exactly one beat. That is
// the disambiguator this scanner leans on, because `\ks d` followed by a newline
// and `D4.4` cannot otherwise be told apart from a two-argument directive.
//
// The one wrinkle is multi-line directives — `\track (…) { … }`, `\staff { … }`,
// `\tuning (…) { … }`. Those are folded into a single LOGICAL line first, so
// their bodies (`volume 12`, `score`, `label "…"`) are never mistaken for music.

/** Bracket depth of a fragment, ignoring anything inside a double-quoted string. */
function bracketDelta(s) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
  }
  return depth;
}

/** Fold physical lines into logical ones, keeping absolute offsets intact. */
function logicalLines(text) {
  const lines = text.split('\n');
  const starts = new Array(lines.length);
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = off;
    off += lines[i].length + 1;
  }
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const startLine = i;
    let buf = lines[i];
    let depth = bracketDelta(buf);
    while (depth > 0 && i + 1 < lines.length) {
      i++;
      buf += '\n' + lines[i];
      depth += bracketDelta(lines[i]);
    }
    out.push({ text: buf, startLine: startLine + 1, offset: starts[startLine] });
    i++;
  }
  return out;
}

/** Split a logical line into top-level whitespace-separated chunks with offsets. */
function topLevelChunks(s) {
  const out = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; if (start < 0) start = i; continue; }
    if (ch === '{' || ch === '(' || ch === '[') { if (start < 0) start = i; depth++; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; continue; }
    if (depth === 0 && /\s/.test(ch)) {
      if (start >= 0) { out.push({ text: s.slice(start, i), offset: start }); start = -1; }
      continue;
    }
    if (start < 0) start = i;
  }
  if (start >= 0) out.push({ text: s.slice(start), offset: start });
  return out;
}

/** Index of the bracket closing the one at `open`, or -1. */
function matchBracket(s, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const close = pairs[s[open]];
  if (!close) return -1;
  let depth = 0;
  let inString = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === s[open]) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The leading atom of a beat token: everything before the first `.`, `{` or `(`. */
function headAtom(chunk) {
  let i = 0;
  while (i < chunk.length && chunk[i] !== '.' && chunk[i] !== '{' && chunk[i] !== '(') i++;
  return chunk.slice(0, i);
}

/**
 * Classify one note token (a whole beat's head, or one member of a chord).
 * Returns 'pitched' | 'fretted' | 'negativeFret' | 'rest' | 'articulation' | 'unknown'.
 */
function classifyNoteToken(token) {
  const head = headAtom(token);
  if (head === '') return 'unknown';
  if (head === 'r' || head === 'R') return 'rest';
  if (PITCHED_NOTE_RE.test(head)) return 'pitched';
  const rest = token.slice(head.length);
  const hasString = /^\.\d+/.test(rest);
  if (INT_RE.test(head)) {
    if (!hasString) return 'unknown';
    return Number(head) < 0 ? 'negativeFret' : 'fretted';
  }
  if (head === 'x' || head === 'X' || head === '-') return hasString ? 'fretted' : 'unknown';
  return 'articulation';
}

/** Members of a chord beat `(A B C).4{…}`, with offsets relative to the chunk. */
function chordMembers(chunk) {
  const end = matchBracket(chunk, 0);
  if (end < 0) return null;
  const inner = chunk.slice(1, end);
  return topLevelChunks(inner).map((m) => ({ text: m.text, offset: m.offset + 1 }));
}

function newStaff(trackIndex, staffInTrack, globalIndex, startLine, implicit) {
  return {
    index: globalIndex,
    trackIndex,
    staffIndex: staffInTrack,
    trackName: null,
    startLine,
    endLine: startLine,
    implicit,
    display: [],
    tuning: { stringCount: 0, values: [], pitchedKeyword: null, line: null },
    keySignatures: [],
    clefs: [],
    tempoDirectives: [],
    voiceCount: 0,
    beats: 0,
    tokens: { pitched: 0, fretted: 0, negativeFret: 0, rest: 0, articulation: 0, unknown: 0 },
    kind: STAFF_KIND.UNKNOWN,
    kindReason: 'no notes',
  };
}

/**
 * Scan an AlphaTex source into its track/staff structure, classifying each staff
 * as pitched or fretted and recording every `-1.<string>` token found.
 *
 * Nothing here mutates the text. `normalizePianoSource` builds on it.
 *
 * @returns {{ staves: object[], tracks: object[], negativeFretTokens: object[], notes: string[] }}
 */
export function scanSource(text) {
  const staves = [];
  const tracks = [];
  const negativeFretTokens = [];
  const notes = [];

  let track = null;
  let staff = null;

  const openTrack = (name, line, implicit) => {
    track = { index: tracks.length, name, startLine: line, implicit, staffCount: 0 };
    tracks.push(track);
    staff = null;
    return track;
  };
  const openStaff = (line, implicit) => {
    if (!track) openTrack(null, line, true);
    staff = newStaff(track.index, track.staffCount++, staves.length, line, implicit);
    staff.trackName = track.name;
    staves.push(staff);
    return staff;
  };
  const currentStaff = (line) => staff ?? openStaff(line, true);

  for (const ll of logicalLines(text)) {
    const trimmed = ll.text.trim();
    if (trimmed === '') continue;

    // ---- metadata directive --------------------------------------------
    if (trimmed.startsWith('\\')) {
      const m = /^\\([A-Za-z][A-Za-z0-9_]*)/.exec(trimmed);
      if (!m) continue;
      const tag = m[1].toLowerCase();
      const argsText = trimmed.slice(m[0].length);

      if (tag === 'track') {
        const nameMatch = /"((?:[^"\\]|\\.)*)"/.exec(argsText.split('{')[0] ?? '');
        openTrack(nameMatch ? nameMatch[1] : null, ll.startLine, false);
      } else if (tag === 'staff') {
        const s = openStaff(ll.startLine, false);
        const braceAt = trimmed.indexOf('{');
        if (braceAt >= 0) {
          const close = matchBracket(trimmed, braceAt);
          const body = close > braceAt ? trimmed.slice(braceAt + 1, close) : trimmed.slice(braceAt + 1);
          s.display = topLevelChunks(body).map((c) => c.text.toLowerCase()).filter(Boolean);
        }
      } else if (tag === 'tuning') {
        const s = currentStaff(ll.startLine);
        s.tuning.line = ll.startLine;
        const parenAt = argsText.indexOf('(');
        const braceAt = argsText.indexOf('{');
        let argList;
        if (parenAt >= 0 && (braceAt < 0 || parenAt < braceAt)) {
          const close = matchBracket(argsText, parenAt);
          argList = topLevelChunks(argsText.slice(parenAt + 1, close < 0 ? undefined : close));
        } else {
          argList = topLevelChunks(braceAt >= 0 ? argsText.slice(0, braceAt) : argsText);
        }
        for (const a of argList) {
          const word = a.text.replace(/^"|"$/g, '').toLowerCase();
          if (PITCHED_TUNING_WORDS.has(word)) { s.tuning.pitchedKeyword = word; break; }
          if (/^[A-Ga-g](?:#{1,2}|b{1,2})?-?\d+$/.test(a.text)) {
            s.tuning.values.push(a.text);
            s.tuning.stringCount++;
          }
        }
      } else if (tag === 'voice') {
        currentStaff(ll.startLine).voiceCount++;
      } else if (tag === 'ks') {
        const s = currentStaff(ll.startLine);
        const v = topLevelChunks(argsText)[0]?.text ?? null;
        if (v) s.keySignatures.push({ line: ll.startLine, value: v });
      } else if (tag === 'clef') {
        const s = currentStaff(ll.startLine);
        const v = topLevelChunks(argsText)[0]?.text ?? null;
        if (v) s.clefs.push({ line: ll.startLine, value: v });
      } else if (tag === 'tempo') {
        // Recorded, not interpreted. Consecutive `\tempo` directives are a real
        // exporter artifact — alphaTab keeps the LAST one, so a source can
        // declare 100 and play at 25. The validator compares this list against
        // the automations that survived into the parse tree.
        const s = currentStaff(ll.startLine);
        const v = topLevelChunks(argsText)[0]?.text ?? null;
        if (v) s.tempoDirectives.push({ line: ll.startLine, value: v.replace(/^\(|\)$/g, '') });
      }
      if (staff) staff.endLine = ll.startLine + (ll.text.split('\n').length - 1);
      continue;
    }

    // ---- music ----------------------------------------------------------
    const s = currentStaff(ll.startLine);
    for (const chunk of topLevelChunks(ll.text)) {
      const t = chunk.text;
      if (t.startsWith('|') || t === ':|' || t === '|:') continue; // barline
      const absOffset = ll.offset + chunk.offset;
      const line = ll.startLine + countNewlines(ll.text, chunk.offset);
      s.beats++;
      s.endLine = Math.max(s.endLine, line);

      if (t.startsWith('(')) {
        const members = chordMembers(t);
        if (!members) { s.tokens.unknown++; continue; }
        for (const member of members) {
          const kind = classifyNoteToken(member.text);
          s.tokens[kind]++;
          if (kind === 'negativeFret') {
            negativeFretTokens.push({
              staff: s, line, absStart: absOffset + member.offset,
              absEnd: absOffset + member.offset + member.text.length,
              text: member.text, inChord: true,
            });
          }
        }
        continue;
      }

      const kind = classifyNoteToken(t);
      s.tokens[kind]++;
      if (kind === 'negativeFret') {
        negativeFretTokens.push({
          staff: s, line, absStart: absOffset, absEnd: absOffset + t.length, text: t, inChord: false,
        });
      }
    }
  }

  for (const s of staves) {
    const { kind, reason } = classifyStaff(s);
    s.kind = kind;
    s.kindReason = reason;
  }
  if (staves.length === 0) notes.push('no staves found — the source contains no music');

  return { staves, tracks, negativeFretTokens, notes };
}

function countNewlines(s, upto) {
  let n = 0;
  for (let i = 0; i < upto && i < s.length; i++) if (s[i] === '\n') n++;
  return n;
}

// ---------------------------------------------------------------------------
// 4. The one rewrite
// ---------------------------------------------------------------------------

/**
 * Rewrite one `-1.<string>[{noteProps}].<duration><tail>` beat as `r.<duration><tail>`.
 * Returns null if the token is not that shape.
 */
function negativeFretToRest(chunk) {
  if (!chunk.startsWith('-1.')) return null;
  let i = 3;
  let str = '';
  while (i < chunk.length && /\d/.test(chunk[i])) str += chunk[i++];
  if (!str) return null;
  let noteProps = '';
  if (chunk[i] === '{') {
    const close = matchBracket(chunk, i);
    if (close < 0) return null;
    noteProps = chunk.slice(i, close + 1);
    i = close + 1;
  }
  if (chunk[i] !== '.') return null;
  i++;
  let dur = '';
  while (i < chunk.length && /\d/.test(chunk[i])) dur += chunk[i++];
  if (!dur) return null;
  const tail = chunk.slice(i); // beat properties, e.g. `{beam Up}` — preserved verbatim
  return { text: `r.${dur}${tail}`, string: Number(str), duration: Number(dur), droppedNoteProps: noteProps || null };
}

/**
 * Normalize an AlphaTex piano source.
 *
 * THE ONE JOB: inside a staff confidently identified as PITCHED, rewrite every
 * `-1.<string>.<duration>` beat as `r.<duration>`. Nothing else is touched — the
 * returned text is byte-identical to the input outside the reported spans.
 *
 * @param {string} text
 * @returns {{
 *   text: string,
 *   changed: boolean,
 *   rewrites: Array<{ line, column, from, to, trackIndex, staffIndex, staffGlobalIndex, staffKind, string, duration, droppedNoteProps }>,
 *   skipped: Array<{ line, column, text, trackIndex, staffIndex, staffGlobalIndex, staffKind, why }>,
 *   counts: object,
 *   staves: object[],
 *   tracks: object[],
 *   notes: string[]
 * }}
 */
export function normalizePianoSource(text) {
  const scan = scanSource(text);
  const rewrites = [];
  const skipped = [];
  const edits = [];

  for (const tok of scan.negativeFretTokens) {
    const staff = tok.staff;
    // Index naming matches the staff records exactly: `staffIndex` is the staff's
    // index WITHIN ITS TRACK (what alphaTab's `staff.index` reports), and
    // `staffGlobalIndex` is its position in the flat `staves[]` list.
    const base = {
      line: tok.line,
      column: columnOf(text, tok.absStart),
      text: tok.text,
      trackIndex: staff.trackIndex,
      staffIndex: staff.staffIndex,
      staffGlobalIndex: staff.index,
      staffKind: staff.kind,
    };
    if (!isPitchedStaff(staff)) {
      skipped.push({ ...base, why: `staff is ${staff.kind} (${staff.kindReason}) — fret tokens are legitimate there` });
      continue;
    }
    if (tok.inChord) {
      skipped.push({ ...base, why: 'inside a chord — a chord member cannot become a rest; report this, do not guess' });
      continue;
    }
    const rewritten = negativeFretToRest(tok.text);
    if (!rewritten) {
      skipped.push({ ...base, why: 'not the `-1.<string>.<duration>` shape this module rewrites' });
      continue;
    }
    edits.push({ start: tok.absStart, end: tok.absEnd, to: rewritten.text });
    rewrites.push({
      line: base.line,
      column: base.column,
      from: tok.text,
      to: rewritten.text,
      trackIndex: base.trackIndex,
      staffIndex: base.staffIndex,
      staffGlobalIndex: base.staffGlobalIndex,
      staffKind: base.staffKind,
      string: rewritten.string,
      duration: rewritten.duration,
      droppedNoteProps: rewritten.droppedNoteProps,
      rule: 'negative-fret-rest',
    });
  }

  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    out += text.slice(cursor, e.start) + e.to;
    cursor = e.end;
  }
  out += text.slice(cursor);

  const byKind = { pitched: 0, fretted: 0, percussion: 0, unknown: 0 };
  for (const s of scan.staves) byKind[s.kind]++;

  return {
    text: out,
    changed: edits.length > 0,
    rewrites,
    skipped,
    counts: {
      negativeFretRests: rewrites.length,
      negativeFretSkipped: skipped.length,
      negativeFretFound: scan.negativeFretTokens.length,
      tracks: scan.tracks.length,
      staves: scan.staves.length,
      pitchedStaves: byKind.pitched,
      frettedStaves: byKind.fretted,
      percussionStaves: byKind.percussion,
      unknownStaves: byKind.unknown,
    },
    staves: scan.staves.map(publicStaff),
    tracks: scan.tracks,
    notes: scan.notes,
  };
}

/** A staff record without the internal back-references, safe to serialize. */
function publicStaff(s) {
  return {
    index: s.index,
    trackIndex: s.trackIndex,
    staffIndex: s.staffIndex,
    trackName: s.trackName,
    kind: s.kind,
    kindReason: s.kindReason,
    implicit: s.implicit,
    startLine: s.startLine,
    endLine: s.endLine,
    display: s.display,
    tuning: s.tuning.stringCount ? s.tuning.values : (s.tuning.pitchedKeyword ?? null),
    declaredKeySignatures: [...new Set(s.keySignatures.map((k) => k.value))],
    clefs: [...new Set(s.clefs.map((c) => c.value))],
    tempoDirectives: s.tempoDirectives,
    voiceDirectives: s.voiceCount,
    beats: s.beats,
    tokens: s.tokens,
  };
}

function columnOf(text, absOffset) {
  const nl = text.lastIndexOf('\n', absOffset - 1);
  return absOffset - nl;
}

/**
 * Read a file and normalize it. The file on disk is NEVER modified — corpus
 * sources are read-only and normalization is an in-memory step.
 */
export function normalizePianoFile(filePath) {
  const { text, encoding, byteLength } = readPianoSource(filePath);
  return { file: filePath, encoding, byteLength, raw: text, ...normalizePianoSource(text) };
}

// ---------------------------------------------------------------------------
// 5. Parsing the normalized text
// ---------------------------------------------------------------------------

const SEVERITY = { 0: 'hint', 1: 'warning', 2: 'error' };

function collectDiagnostics(iterable) {
  const out = [];
  if (!iterable) return out;
  for (const d of iterable) {
    out.push({
      code: d.code,
      severity: SEVERITY[d.severity] ?? String(d.severity),
      message: d.message,
      line: d.start?.line,
      col: d.start?.col,
      endLine: d.end?.line,
      endCol: d.end?.col,
    });
  }
  return out;
}

/**
 * Parse AlphaTex from a STRING (score-utils' `loadTex` only takes a path, and
 * the whole point here is that the text on disk is not the text we parse).
 *
 * Unlike `loadTex` this also returns the diagnostics of a SUCCESSFUL parse —
 * warnings and hints are the signal the source-side validator exists to show.
 *
 * @returns {{ ok, score, errors, warnings, hints, diagnostics }}
 */
export function parseAlphaTex(text) {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(text, settings);
  let score = null;
  let diagnostics = [];
  let ok = true;
  try {
    score = importer.readScore();
  } catch (e) {
    ok = false;
    const source = typeof e.iterateDiagnostics === 'function' ? e
      : (e.inner && typeof e.inner.iterateDiagnostics === 'function') ? e.inner
      : (e.cause && typeof e.cause.iterateDiagnostics === 'function') ? e.cause
      : null;
    diagnostics = source ? collectDiagnostics(source.iterateDiagnostics()) : [];
    if (diagnostics.length === 0) {
      for (const bag of [importer.lexerDiagnostics, importer.parserDiagnostics, importer.semanticDiagnostics]) {
        if (bag?.items) diagnostics.push(...collectDiagnostics(bag.items));
      }
    }
    if (diagnostics.length === 0) {
      diagnostics = [{ severity: 'error', message: String(e?.message ?? e) }];
    }
  }
  if (ok) {
    for (const bag of [importer.lexerDiagnostics, importer.parserDiagnostics, importer.semanticDiagnostics]) {
      if (bag?.items) diagnostics.push(...collectDiagnostics(bag.items));
    }
  }
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const hints = diagnostics.filter((d) => d.severity === 'hint');
  return { ok: ok && errors.length === 0, score, errors, warnings, hints, diagnostics };
}

/**
 * The one call most consumers want: read a piano source, normalize it in memory,
 * parse the normalized text, and hand back both the score and the full record of
 * what was rewritten. The normalization report is ALWAYS present — callers are
 * expected to show it even when the rewrite count is zero.
 */
export function loadPianoSource(filePath) {
  const normalization = normalizePianoFile(filePath);
  const parsed = parseAlphaTex(normalization.text);
  return { ...parsed, normalization, file: filePath, encoding: normalization.encoding };
}

// ---------------------------------------------------------------------------
// 6. Sounding-key inference  (NOT part of the normalizer's one job)
// ---------------------------------------------------------------------------
//
// Measured fact from the corpus: the declared key signature lies. `Canon Rock 1`
// declares `\ks c` and sounds in E. So the key is derived from pitch content,
// never read off `\ks` — and the two are reported side by side so a disagreement
// is visible rather than silently resolved.
//
// Krumhansl-Kessler profiles, correlated against a duration-weighted pitch-class
// histogram. Pure function: give it 12 weights, get a ranked key list back.

export const PITCH_CLASS_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

// Index = semitones above the tonic. These are the published Krumhansl-Kessler
// values; miscopying one silently biases the whole result toward the relative
// minor, so they are asserted in piano-source.test.mjs.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Sharps (+) or flats (−) in the key signature of each major tonic pitch class. */
const MAJOR_ACCIDENTALS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/**
 * Infer the sounding key from a duration-weighted pitch-class histogram.
 *
 * @param {number[]} weights  12 non-negative weights, index 0 = C
 * @returns {{ key, tonic, tonicPc, mode, accidentals, score, ranked: object[] } | null}
 */
export function inferKeyFromPitchClasses(weights) {
  if (!weights || weights.length !== 12) return null;
  if (weights.reduce((s, v) => s + v, 0) <= 0) return null;
  const ranked = [];
  for (let pc = 0; pc < 12; pc++) {
    const rotated = weights.map((_, i) => weights[(i + pc) % 12]);
    for (const [mode, profile] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
      ranked.push({
        tonicPc: pc,
        tonic: PITCH_CLASS_NAMES[pc],
        mode,
        key: `${PITCH_CLASS_NAMES[pc]} ${mode}`,
        accidentals: keyAccidentals(pc, mode),
        score: pearson(rotated, profile),
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return { ...ranked[0], ranked: ranked.slice(0, 5) };
}

/** Key-signature accidental count for a tonic pitch class and mode (minor = relative major). */
export function keyAccidentals(tonicPc, mode) {
  const relativeMajorPc = mode === 'minor' ? (tonicPc + 3) % 12 : tonicPc;
  return MAJOR_ACCIDENTALS[relativeMajorPc];
}

/** Human spelling of an accidental count: 4 -> "4#", -2 -> "2b", 0 -> "none". */
export function accidentalsToText(n) {
  if (n === 0) return 'none';
  return n > 0 ? `${n}#` : `${-n}b`;
}

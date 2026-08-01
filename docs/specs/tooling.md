# Tooling spec — pre-write guards for the arranging loop

Status: **implementation-ready**. This spec is the contract for the *implementation* agent
(builds it) and the *evaluation* agent (grades it). It covers Part 2 of the approved plan:
`tools/fret.mjs`, `tools/barfill.mjs` + a shared `score-utils` extraction, the
`position-jump-slow` playability advisory, and the `compare.mjs` contour warning (code half of
3c only).

Every acceptance value below was computed against the real libraries and re-verified with a
throwaway `node` run before this spec was written — they are facts, not guesses.

## 0. Ground rules that apply to every tool here

- **No new pitch/fret/tick math.** All arithmetic already exists as exports. New code is CLI
  glue + argument parsing + output formatting. The reuse map:

  | Need | Export | File |
  |---|---|---|
  | open-string MIDI array (`OPEN[1]=64=E4 … OPEN[6]=40=E2`) | `OPEN`, `STRING_COUNT`, `DEFAULT_MAX_FRET` (alias `MAX_FRET`) | `tools/lib/fretboard.mjs` |
  | resolved project configuration (`--max-fret` > `config.json` > built-in) | `resolveConfig`, `findProjectConfig`, `loadProjectConfig` | `tools/lib/project-config.mjs` |
  | all `{string,fret}` positions for a MIDI, `{maxFret,tuning}` opts | `positionsFor(midi, opts)` | `tools/lib/fretboard.mjs` |
  | MIDI → scientific name (sharps only), e.g. `50→"D3"` | `midiToName(midi)` | `tools/lib/score-utils.mjs` |
  | expected tick length of a bar from its time sig | `expectedBarTicks(masterBar)` | `tools/lib/score-utils.mjs` |
  | quarter-note ticks (`960`) | `QUARTER_TICKS` | `tools/lib/score-utils.mjs` |
  | parse an `.alphatab` file → `{ok, score}` (the validate/compare parser) | `loadTex(path)` | `tools/lib/score-utils.mjs` |
  | walk every beat | `walkBeats(score, cb)` | `tools/lib/score-utils.mjs` |
  | note-name (sharp **or** flat) → pitch class, e.g. `"Ab"→8`, `"G#"→8`, `"Bb"→10`; `null` if unknown | `nameToPc(name)` | `tools/lib/analysis.mjs` |
  | pitch-class name | `pcName(midi, preferFlat)` | `tools/lib/analysis.mjs` |
  | Pearson correlation of two equal-length series → `number\|null` | `pearson(xs,ys)` (module-local **function declaration**, hoisted, callable earlier in file) | `tools/compare.mjs:539` |
  | per-source-bar → tab-bar proportional mapping | `proportionalSlice(tS,tE,i,N)` | `tools/compare.mjs:300` |

- **Invocation.** Tools run as `node tools/<tool>.mjs …` from the repo root, or
  `node ../../tools/<tool>.mjs …` from inside a `projects/<slug>/` directory. Nothing here
  depends on cwd beyond the file path arguments it is given.

- **Pure ESM, node builtins + `@coderline/alphatab` only.** No new dependency. `"type":"module"`.

- **String numbering is SOURCE/AlphaTex throughout** (string 1 = high e, string 6 = low E) —
  this is what `OPEN` and `positionsFor` already speak, and what the arranger writes as
  `fret.string`. Never invert here; the one inversion boundary is `fromAlphaTabNote` and these
  tools never touch it (they read `OPEN`/`positionsFor`, not raw alphaTab notes) except
  barfill/playability which already go through the shared parser.

---

## A. `tools/fret.mjs` — pitch ↔ fret CLI

**Purpose (1 line):** answer "what pitch is `fret.string`?" / "where does note X live?" /
"is my bar's lowest note in the chord?" so an agent never hand-computes a `fret.string` token
again (the session bug: `21.1` mistaken for D6 when it is C#6; `1.6` thought Eb3 when it is F2).

### A.1 Argument grammar

```
node tools/fret.mjs <fret>.<string> [--maxfret N]                 # FORWARD  (one f.s token)
node tools/fret.mjs <NoteName>       [--maxfret N]                # REVERSE  (a pitch name)
node tools/fret.mjs <fret>.<string> [<fret>.<string> …] --pcset <tok> [<tok> …] --root <name>   # PCSET-CHECK
```

- A **positional** is any argument not beginning with `--`. All positionals must appear
  **before** any flag (this disambiguates the variadic `--pcset`).
- `<fret>.<string>` = two non-negative integers separated by a dot, e.g. `10.6` (fret 10 on
  string 6). `string` must be `1..6`; `fret` must be `0..DEFAULT_MAX_FRET` (22) unless a wider
  `--maxfret` says otherwise (see A.4). Parse with `/^(\d+)\.(\d+)$/`.
- `<NoteName>` = scientific pitch, `/^([A-Ga-g])([#b]?)(-?\d+)$/`: letter (upper- or lower-cased
  → uppercased), optional `#` or `b`, signed integer octave, e.g. `Ab3`, `C#6`, `F2`, `d5`.

### A.2 Mode selection (deterministic, in this order)

1. `--pcset` present anywhere → **PCSET-CHECK** mode.
2. else the single positional matches `/^\d+\.\d+$/` → **FORWARD** mode.
3. else the single positional matches the NoteName regex → **REVERSE** mode.
4. else → usage error, exit 2.

### A.3 FORWARD mode

`fret.string → MIDI` via the only formula this tool needs: **`midi = OPEN[string] + fret`**.
Then name via `midiToName(midi)` and pitch class via `midi % 12` (equivalently `nameToPc(pcName(midi,false))`).

**Exact stdout (one line, no trailing spaces):**
```
<fret>.<string> = <midiToName(midi)> (pc <midi%12>)
```

**Pinned acceptance cases — these EXACT strings are required (all verified against `OPEN`+`midiToName`):**

| Command | Required stdout | Exit |
|---|---|---|
| `node tools/fret.mjs 10.6` | `10.6 = D3 (pc 2)` | 0 |
| `node tools/fret.mjs 21.1` | `21.1 = C#6 (pc 1)` | 0 |
| `node tools/fret.mjs 1.6`  | `1.6 = F2 (pc 5)`  | 0 |
| `node tools/fret.mjs 22.1` | `22.1 = D6 (pc 2)` | 0 |

(Derivations: `OPEN[6]+10 = 40+10 = 50 → D3`; `OPEN[1]+21 = 64+21 = 85 → C#6`;
`OPEN[6]+1 = 41 → F2`; `OPEN[1]+22 = 86 → D6`.)

Reject `string` outside `1..6` (`OPEN[string]` would be `null`/`undefined`) with a usage error,
exit 2: `fret.mjs: string must be 1..6 (got <string>)`.

### A.4 REVERSE mode

Note name → MIDI, then all playable positions.
- pitch class: `pc = nameToPc(letter+accidental)` (reuses `nameToPc`, which accepts sharps AND
  flats; `null` → usage error exit 2: `fret.mjs: unknown note name '<token>'`).
- MIDI (inverse of `analysis.mjs`'s `midiName`): **`midi = pc + 12 * (octave + 1)`**.
- positions: `positionsFor(midi, { maxFret })` (default `maxFret = DEFAULT_MAX_FRET = 22`,
  overridable by `--maxfret`). Returns `{string,fret,midi}[]` already sorted by string ascending.

**Exact stdout:** header line then a space-joined position list rendered as `fret.string`
tokens (so they are copy-paste ready as AlphaTex the arranger writes):
```
<NoteName> (midi <midi>, pc <pc>): <fret>.<string> <fret>.<string> …
```

**Pinned acceptance (verified: `positionsFor(56)` = `[{s3,f1},{s4,f6},{s5,f11},{s6,f16}]`):**
```
node tools/fret.mjs Ab3
Ab3 (midi 56, pc 8): 1.3 6.4 11.5 16.6
```
- With `--maxfret 12`: `Ab3 (midi 56, pc 8): 1.3 6.4 11.5` (fret-16 position dropped). Exit 0.
- If `positionsFor` returns `[]` (pitch below low E, or above `maxFret` on every string): print
  `<NoteName> (midi <midi>, pc <pc>): no playable position (out of range on a 6-string standard-tuned guitar, maxfret <N>)` and **exit 1**.

### A.5 `--maxfret <N>` semantics (both non-pcset modes)

- FORWARD: if `fret > N`, still print the pitch line, then append ` [OUT OF RANGE: fret <fret> > maxfret <N>]`
  to the same line and **exit 1**. (If `fret <= N`, normal exit 0.)
- REVERSE: passed straight into `positionsFor(midi,{maxFret:N})`; positions above `N` are simply
  absent from the list. Empty list → exit 1 (as A.4).
- `N` must be a non-negative integer; otherwise usage error exit 2.

### A.6 PCSET-CHECK mode

**Purpose:** the compare harmonic-root gate, usable on a single draft note before it is written —
"is the lowest note of this bar a chord tone?" Mirrors `compare.mjs:389/496`: pass iff
`lowPc === rootPc || pcset.has(lowPc)`.

- Positionals are the bar's notes as `fret.string` tokens (≥1). Each → `midi = OPEN[string]+fret`.
- `lowMidi = min(midis)`, `lowPc = lowMidi % 12`.
- `--root <name>`: a single note name (via `nameToPc`) **or** a bare integer `0..11`. Required.
- `--pcset <tok> …`: one or more tokens, each a note name (via `nameToPc`) **or** a bare integer
  `0..11`. `--pcset` greedily consumes every following token until end-of-args or the next
  `--`-prefixed flag. Build `pcset = Set<number>`.
- Unknown note name / out-of-range int in either flag → usage error exit 2.

**Exact stdout:**
```
lowest <fret>.<string> = <midiToName(lowMidi)> (pc <lowPc>); root <rootArg> (pc <rootPc>), pcset {<sorted pcs>} -> <IN SET (OK) | NOT IN SET (FAIL)>
```

**Example (verified semantics):** for a bar whose lowest note is `8.6` (`OPEN[6]+8 = 48 = C3`,
pc 0) with `--root A --pcset A C# E` (root pc 9, pcset `{1,4,9}`): `0 ≠ 9` and `0 ∉ {1,4,9}` →
`NOT IN SET (FAIL)`, exit 1. With `--root C --pcset C E G` (root pc 0): `0 === 0` → `IN SET (OK)`, exit 0.

### A.7 Exit contract (all modes)

| Exit | Meaning |
|---|---|
| 0 | forward/reverse printed a valid result; pcset check passed |
| 1 | out of range (forward fret > maxfret; reverse pitch unplayable / empty list); pcset check FAILED |
| 2 | usage error (no positional, bad token, unknown note name, string∉1..6, bad `--maxfret`/`--root`, missing `--root` in pcset mode) — message to **stderr**, prefixed `fret.mjs: ` |

Usage banner (stderr, on exit 2 with no/garbled args):
`Usage: node tools/fret.mjs <fret>.<string> | <NoteName> [--maxfret N] | <fret>.<string>… --pcset <n>… --root <name>`

---

## B. Shared bar-fill helper + `tools/barfill.mjs`

### B.1 Extraction into `tools/lib/score-utils.mjs` (new exports, mark `// PTG:`)

Extract the inline sum-and-compare currently at `validate.mjs:41-54`. Note the sum is over
`beat.playbackDuration` (alphaTab has already converted each beat's duration to **ticks** — the
helper does no duration→tick math itself).

```js
// PTG: shared bar-fill math, extracted from validate.mjs so barfill.mjs reuses it.
export function barTickSum(beats) {
  let sum = 0;
  for (const beat of beats || []) sum += beat.playbackDuration;   // raw, matches validate exactly
  return sum;
}

export function barFillOk(beats, masterBar) {
  const actual = barTickSum(beats);
  const expected = expectedBarTicks(masterBar);
  const dir = actual === expected ? 'exact' : actual > expected ? 'overfull' : 'underfull';
  return { ok: actual === expected, actual, expected, delta: actual - expected, dir };
}
```

- **Signatures / return shape:** `barTickSum(beats: Iterable<Beat>) → number`;
  `barFillOk(beats: Iterable<Beat>, masterBar) → { ok:boolean, actual:number, expected:number, delta:number, dir:'exact'|'overfull'|'underfull' }`.
- **Do NOT add `|| 0` guards to the sum** — validate currently sums `beat.playbackDuration`
  raw; preserving that keeps behavior byte-identical.

**Refactor `validate.mjs` to call `barFillOk`, with NO behavior change.** The empty-voice skip
stays in the caller (it is a validate concern, not the helper's):
```js
bar.voices.forEach((voice, vi) => {
  if (!voice || voice.isEmpty) return;               // unchanged guard, stays in validate
  const fill = barFillOk(voice.beats, masterBar);
  if (fill.ok) return;
  warnings.push({
    type: 'bar-fill',
    message: `Bar ${bar.index + 1} (track "${track.name || track.index}"` +
      `${bar.voices.length > 1 ? `, voice ${vi}` : ''}) is ${fill.dir}: ` +
      `${fill.actual}/${fill.expected} ticks (${(fill.actual / 960).toFixed(2)} vs ${(fill.expected / 960).toFixed(2)} quarter beats in ` +
      `${masterBar.timeSignatureNumerator}/${masterBar.timeSignatureDenominator})`,
    bar: bar.index + 1,
    voice: vi,
  });
});
```
The `const expected = expectedBarTicks(masterBar)` line above the loop becomes unused and is
removed (it now lives inside `barFillOk`). The emitted `actual`, `expected`, and `dir` are
identical, so every warning string is byte-for-byte unchanged.

**Confirm no behavior change (the evaluator runs these):**
- `node tools/validate.mjs --strict tools/fixtures/overfull-voice.alphatab` → exit 1, same
  `overfull` warning message as before the refactor.
- `npm run smoke` — checks #4 and #5 (validate broken-syntax, validate overfull-voice) stay green.
- `npm test` stays green.

### B.2 `tools/barfill.mjs` CLI

**Purpose (1 line):** report each bar's summed beat-ticks vs its time signature so a 3.5- or
4.25-beat bar is caught **before** it is written into `cover.alphatab` (the session bug: bars
summing to 3.5/4.25 only surfaced after writing the whole file).

**Parser path — reuse `loadTex` (the exact parser validate/compare use).** File mode reads the
path directly. Fragment mode writes the wrapped fragment to a temp file
(`fs.mkdtempSync(path.join(os.tmpdir(),'barfill-'))` + `writeFileSync`), calls `loadTex`, and
unlinks in a `finally`. One parser path, no importer duplication.

#### Modes

```
node tools/barfill.mjs <file.alphatab> [--bars N-M]     # FILE mode
node tools/barfill.mjs --frag "<alphatex beats>" [--ts N/M]   # FRAGMENT mode (inline)
echo "<alphatex beats>" | node tools/barfill.mjs --stdin [--ts N/M]   # FRAGMENT mode (stdin)
```

- `--bars N-M` (file mode): restrict the report to bars `N..M` inclusive (1-based, positional
  bar index = `bar.index + 1`). Same `N` / `N-M` grammar as playability's `parseBarRange`.
  Omitted → all bars.
- `--ts N/M` or `--ts N M` (fragment mode only): time signature for the wrapper; **default 4/4**.
  Bad value → usage exit 2.

#### Fragment wrapper (VERIFIED — use this exact skeleton)

The plan's suggested literal `\track { \staff { … } }` nesting **does not parse** in this
alphaTab version (it raises `Unrecognized property 'staff'`). The minimal skeleton that parses
(default single track/staff/tempo is implicit) is:

```
\ts <N> <M>
<fragment verbatim, including its | bar separators>
```

Verified: wrapping `3.6.4 5.6.4 7.6.4 8.6.8 |` (three quarters + one eighth) in `\ts 4 4` +
newline yields exactly one bar reported `3360/3840 ticks (3.50 vs 4.00)` — the underfull case
this tool exists to catch. If the fragment omits a trailing `|`, alphaTab still closes the final
bar, so a single incomplete bar is reported.

#### Per-bar output (one line per non-empty voice)

```
bar <barNum> voice <vi>: <actual> ticks (<actual/960 .toFixed(2)>) / expected <expected> (<expected/960 .toFixed(2)>) in <num>/<den>  <OK | MISMATCH (<dir> by <|delta|> ticks)>
```
Example (the verified fragment above):
```
bar 1 voice 0: 3360 ticks (3.50) / expected 3840 (4.00) in 4/4  MISMATCH (underfull by 480)
```
Skip empty voices (same `!voice || voice.isEmpty` guard as validate). Omit the `voice <vi>`
segment when the bar has a single voice (optional cosmetic; the evaluator keys only on
`OK`/`MISMATCH`). After the per-bar lines, print a summary:
`barfill: <k> bar(s) checked, <m> mismatch(es)`.

Support `--json` for programmatic use: `{ ok, file|frag, bars:[{bar,voice,actual,expected,delta,dir,ok}] }`.

#### Exit contract

| Exit | Meaning |
|---|---|
| 0 | every checked bar/voice fills exactly (`barFillOk(...).ok` for all) |
| 1 | at least one bar/voice mismatches (over- or underfull) |
| 2 | usage error (no input; both file and `--frag`/`--stdin` given; unreadable file; bad `--bars`/`--ts`) — stderr, prefixed `barfill: ` |

**Acceptance:**
- A hand-made 3.5-beat 4/4 fragment (`node tools/barfill.mjs --frag "3.6.4 5.6.4 7.6.4 8.6.8 |"`)
  prints the `MISMATCH (underfull by 480)` line and exits 1.
- A full bar (`--frag "3.6.4 5.6.4 7.6.4 8.6.4 |"`) prints `OK` and exits 0.
- File mode on any shipped fixture that fills (e.g. `tools/fixtures/chaconne-excerpt.alphatab`)
  exits 0; on `tools/fixtures/overfull-voice.alphatab` exits 1 with an `overfull` line.

---

## C. `position-jump-slow` advisory in `tools/playability.mjs`

**Purpose (1 line):** surface the eighth-pace pedal-vs-stab hand jump that the existing
position-jump check misses because it only fires on 16th-or-faster notes (the session bug:
big fret-3↔fret-13 hand jumps at eighth pace recurred at bars 31, 38, 39, 42, 43, invisibly).

### C.1 New constant (with the existing thresholds, ~line 48)

```js
const SLOW_JUMP_FRETS = 6;   // PTG: hand-station shift > this between sub-16th beats warns
```
**Justification for 6:** The existing fast check uses `FAST_JUMP_FRETS = 5` at 16th pace — at
speed even 5 frets is unplayable. At eighth pace the hand has ~twice the time, so the slow
threshold is deliberately *more lenient* (6). This keeps ordinary position playing quiet — an
open-position riff (frets 0–5), or a one-position shift (e.g. 5↔10, gap 5) — while flagging a
true hand-station relocation. The recurring failure was fret **3 vs fret 13** (gap **10**),
comfortably over 6; a false-negative-free, false-positive-shy cut. It is a WARNING, so a rare
borderline case costs a human glance, never a gate failure.

### C.2 Trigger (add inside the existing `if (next) { … }` pair block, right after the fast
`position-jump` check at ~line 312, so `beat`, `notes`, `next` are already in scope)

Fire a **warning** when ALL hold:
1. `!next.beat.isRest` (cur is already non-rest here) — two consecutive **non-rest** beats.
2. **Both** beats are slower than a 16th: `beat.duration < 16 && next.beat.duration < 16`
   (in alphaTab `duration` is the denominator: 8 = eighth, 4 = quarter; the fast check's
   `>= 16` therefore does NOT already cover these).
3. Both beats have fretted content: `a.frettedCount > 0 && b.frettedCount > 0` where
   `a = spanOf(notes.map(({string,fret})=>({string,fret})))`, `b = spanOf(next.notes.…)`.
4. `jump = Math.abs(b.minFret - a.minFret) > SLOW_JUMP_FRETS`.
5. **Neither beat carries slide/hammer legato out of `cur`** — i.e. NOT
   (`beatSlidesOut(beat)` OR `notes.some(n => n.raw.isHammerPullOrigin)`). (`beatSlidesOut` is
   the existing helper at line 147; `n.raw.isHammerPullOrigin` is the alphaTab flag the
   hammer/pull and pick-speed checks already read. A slid/hammered connection is a deliberate
   legato move, not a re-picked jump, so it is exempt — same spirit as the fast check's
   `!beatSlidesOut(beat)`.)

```js
// PTG: slow-pace hand-station jump (pedal-vs-stab). The fast check above only
// covers 16th+; this covers eighth/quarter pace, which forces the same big shift
// with more time but still a full hand reposition. WARNING only — never gates.
if (beat.duration < 16 && next.beat.duration < 16 && !next.beat.isRest) {
  const a = spanOf(notes.map(({ string, fret }) => ({ string, fret })));
  const b = spanOf(next.notes.map(({ string, fret }) => ({ string, fret })));
  if (a.frettedCount > 0 && b.frettedCount > 0) {
    const jump = Math.abs(b.minFret - a.minFret);
    const legato = beatSlidesOut(beat) || notes.some((n) => n.raw.isHammerPullOrigin);
    if (jump > SLOW_JUMP_FRETS && !legato) {
      add(warnings, 'position-jump-slow',
        `Bar ${barNum}: slow position jump of ${jump} frets (fret ${a.minFret} -> ${b.minFret}) ` +
        `between consecutive beats slower than a 16th — a hand-station shift this large at ` +
        `eighth-note pace (pedal-vs-stab) forces a big reposition; anchor one hand station, ` +
        `use an open string, or slide {sl}.`, loc);
    }
  }
}
```

**It MUST push to `warnings[]`, never `errors[]`.** `check.mjs` keys its hard fail on
playability's `errors[]` only, so this surfaces to the human but never fails the gate.
(`playability.mjs` itself still exits 1 on any finding incl. warnings — unchanged, and irrelevant
to the gate per the exit-code caveat.)

### C.3 Fixture — `tools/fixtures/position-jump-slow.alphatab` (VERIFIED to parse clean and
trigger nothing today)

```
\title "position-jump-slow: pedal-vs-stab (fires) then adjacent riff (benign)"
\tempo 120
.
\ts 4 4
3.6{pm}.8 13.2.8 3.6{pm}.8 13.2.8 3.6{pm}.8 13.2.8 3.6{pm}.8 13.2.8 |
13.2.8 3.6{pm}.8 13.2.8 3.6{pm}.8 13.2.8 3.6{pm}.8 13.2.8 3.6{pm}.8 |
3.6.8 5.6.8 3.6.8 5.6.8 3.6.8 5.6.8 3.6.8 5.6.8 |
```
- Bars 1–2: low palm-muted pedal `3.6` (G2) alternating at eighth pace with high stab `13.2`
  (C5), `minFret` alternating 3↔13 → gap 10 > 6, no slide/hammer → **fires**.
- Bar 3: benign `3.6`↔`5.6` eighths, gap 2 ≤ 6 → **does not fire**; also otherwise silent.
- Palm mute is on string 6 (a wound string, 4–6) so `palm-mute-string` does not fire. All beats
  are single notes (no `non-adjacent-strings`, no `gain-voicing`), eighths at 120 BPM (nps 4 <
  16, no `pick-speed`; 0.5 beat < 2, no `sustain`), and `duration 8 < 16` (no fast
  `position-jump`).

**Verified now (pre-implementation):** `validate --strict` → `ok:true`, 0 warnings;
`playability --bars 1-2` and `--bars 3` → 0 errors, 0 warnings (the check does not exist yet).
Therefore, post-implementation, bars 1–2 emit exactly the new `position-jump-slow` warnings and
nothing else, and bar 3 stays silent — a clean, unambiguous test target.

### C.4 Unit test — new file `tools/playability.test.mjs`, wired into `npm test`

`playability.mjs` is a CLI with top-level side effects (parses argv, exits on import), so it
**cannot be imported** — the test must drive it as a subprocess, exactly as `smoke.mjs` does.
Model on smoke's `spawnSync(process.execPath, [tool, …], {encoding:'utf8', cwd: ROOT})` +
`JSON.parse(stdout)` pattern; use `node:assert/strict`. Resolve paths from `import.meta.url`.

Assertions (exact):
1. **Fires on the jump section** — run `[playability.mjs, fixture, '--bars','1-2','--json']`:
   - `json.errors` is empty (no hard finding).
   - `json.warnings.some(w => w.type === 'position-jump-slow')` is true.
   - at least one such warning has `/of 10 frets/` and both `/3 -> 13/` and `/13 -> 3/` appear
     across the warnings (the alternation).
2. **Silent on the benign section (negative case)** — run `[…, '--bars','3','--json']`:
   - `json.warnings.every(w => w.type !== 'position-jump-slow')` is true (ideally
     `json.warnings.length === 0`).
3. **Does not misfire as the fast check** — in the `--bars 1-2` run,
   `json.errors.every(e => e.type !== 'position-jump')` (the beats are eighths).

Wire into `package.json`:
```
"test": "node tools/lib/fretboard.test.mjs && node tools/lib/analysis.test.mjs && node tools/lib/piano-source.test.mjs && node tools/playability.test.mjs"
```
Exit 0 all-green / 1 with a readable assertion message on stderr (match the existing test
files' style). `npm test` and `npm run smoke` MUST stay green (smoke references fixtures by
name, so the new fixture is inert to it).

---

## D. `compare.mjs` contour warning (code half of Part 3c only)

**Purpose (1 line):** promote the already-computed contour correlation from a silent soft number
to a **surfaced, non-gating warning** when the tab's top line runs strongly *opposite* to the
quoted source melody — an early signal that a `quote` span may be unrecognizable.

**Threshold constant** (near the other compare constants):
```js
const CONTOUR_WARN_R = -0.5;   // PTG: strongly-negative Pearson => surface a recognizability warning
```
`-0.5` is a moderate-to-strong anticorrelation: the top line broadly moves against the source
melody rather than merely diverging. SOFT and advisory, so err toward not crying wolf.

**Placement — decided explicitly (the plan authorizes choosing the simplest correct spot):**
Compare has two paths. The bar-locked path (no `--map`) already computes `contourR`
(`compare.mjs:552`) and emits `soft.contour = { r }` (`:594`). The map path (`--map`, the mode a
real cover uses) `process.exit()`s at `:439/:454` **before** any contour is computed and its
result object has **no `soft` field at all**. To make the warning fire in *both* modes:

### D.1 Map mode (primary — this is where covers run)

Add a small module-local helper (function declaration, hoisted — so it may be defined anywhere
in the file and still be callable from the map block):
```js
// PTG: per-quote-entry contour, reusing proportionalSlice (root-motion alignment)
// and pearson. Source skeleton midis vs tab top-line midis (already source-space
// via tb.topSeq), aligned per source-bar by index — the same heuristic the
// bar-locked contour uses (compare.mjs:532-535). Returns number|null.
function entryContourR(entry, tabBars, digestByBar, transpose) {
  const [tS, tE] = entry.tabBars;
  const [sS, sE] = entry.sourceBars;
  const src = [], tab = [];
  const bars = [];
  for (let b = sS; b <= sE; b++) bars.push(digestByBar.get(b));
  const N = bars.length;
  for (let i = 0; i < N; i++) {
    const sk = (bars[i]?.melodySkeleton || []).map((n) => n.midi);
    const [lo, hi] = proportionalSlice(tS, tE, i, N);
    const tabMidi = [];
    for (let b = lo; b <= hi; b++) {
      const tb = tabBars.get(b);
      if (tb) for (const m of tb.topSeq) tabMidi.push(m); // tb.topSeq is already source-space
    }
    const k = Math.min(sk.length, tabMidi.length);
    for (let j = 0; j < k; j++) { src.push(sk[j]); tab.push(tabMidi[j]); }
  }
  return pearson(src, tab);
}
```
Note: `tb.topSeq` MIDIs are stored already shifted into source space (`compare.mjs:178,186`), and
`melodySkeleton[].midi` is source space, so no extra transpose adjustment is applied here — this
matches the bar-locked contour, which also correlates `skeleton[].midi` against `tb.topSeq`
directly. The per-source-bar index alignment is the same heuristic the bar-locked path already
uses; on a `quote` span the tab region may hold ornament notes between skeleton notes, so this
is an approximate contour — acceptable because the output is a non-gating advisory.

In the map block, after `const mapResults = …` (`:417`) and before assembling `mapResult`:
```js
const contourWarnings = [];
for (const e of activeEntries) {
  if (e.mode !== 'quote') continue;
  const r = entryContourR(e, tabBars, digestByBar, transpose);
  if (r !== null && r < CONTOUR_WARN_R) {
    contourWarnings.push({ tabBars: e.tabBars, sourceBars: e.sourceBars, r: Number(r.toFixed(3)) });
  }
}
```
Add a `soft` field to the map result object (new, additive — does **not** touch `ok`/exit):
```js
const mapResult = { ok: mapOk, file, digest: digestPath, bars, transpose, map: mapPath,
  mapResults, soft: { contourWarnings }, failures: aggregated };
```
Human-readable: after the per-entry lines, for each `contourWarnings` item print an advisory
(clearly marked non-gating):
```
  ~ contour  tabBars=[<s,e>] r=<r> — top line runs opposite the quoted source melody; confirm this inversion is intended (soft, non-gating).
```

### D.2 Bar-locked mode (secondary — keep the two modes consistent, one-line change)

Extend the existing `soft.contour` (`:594`) from `{ r }` to `{ r, warn }`:
```js
contour: { r: contourR === null ? null : Number(contourR.toFixed(3)),
           warn: contourR !== null && contourR < CONTOUR_WARN_R },
```
And, when `warn`, append one line to the human report after the existing `contour` line
(`:614`):
```
  contour WARNING    strongly negative (r < -0.5): tab top line runs opposite the source — confirm intended (soft, non-gating).
```

### D.3 Contract guarantees

- **No hard gate changes.** `ok` in both modes is unchanged (bar-locked: `melodicSkeleton.ok &&
  harmonicRoots.ok`; map: `mapResults.every(r => r.ok)`). Exit codes unchanged.
- **Additive JSON only.** Bar-locked `soft.contour` gains a boolean `warn`; map `mapResult`
  gains a `soft.contourWarnings[]`. The smoke end-to-end check (#7) asserts `mapResults.length`,
  `mapResults.every(r=>r.ok)`, and the three hard sub-gates — all untouched, so it stays green.
- **`free`/`recompose` entries never contour-warn** (only `quote`, which carries an in-order
  melodic obligation worth guarding).

---

## Acceptance checklist (evaluator runs top-to-bottom)

fret.mjs:
- [ ] `node tools/fret.mjs 10.6` → `10.6 = D3 (pc 2)` (exit 0)
- [ ] `node tools/fret.mjs 21.1` → `21.1 = C#6 (pc 1)` (exit 0)
- [ ] `node tools/fret.mjs 1.6`  → `1.6 = F2 (pc 5)` (exit 0)
- [ ] `node tools/fret.mjs 22.1` → `22.1 = D6 (pc 2)` (exit 0)
- [ ] `node tools/fret.mjs Ab3` → `Ab3 (midi 56, pc 8): 1.3 6.4 11.5 16.6` (exit 0)
- [ ] `node tools/fret.mjs Ab3 --maxfret 12` → `… 1.3 6.4 11.5` (exit 0)
- [ ] `node tools/fret.mjs 21.1 --maxfret 12` → pitch line + `[OUT OF RANGE: fret 21 > maxfret 12]` (exit 1)
- [ ] pcset FAIL: lowest note pc ∉ pcset and ≠ root → `NOT IN SET (FAIL)` (exit 1); pcset PASS → `IN SET (OK)` (exit 0)
- [ ] bad string / unknown note / missing `--root` → exit 2, `fret.mjs: …` on stderr

barfill + helper:
- [ ] `score-utils.mjs` exports `barTickSum`, `barFillOk` with the specified shapes
- [ ] `node tools/validate.mjs --strict tools/fixtures/overfull-voice.alphatab` → exit 1, warning byte-identical to pre-refactor
- [ ] `node tools/barfill.mjs --frag "3.6.4 5.6.4 7.6.4 8.6.8 |"` → `MISMATCH (underfull by 480)` (exit 1)
- [ ] `node tools/barfill.mjs --frag "3.6.4 5.6.4 7.6.4 8.6.4 |"` → `OK` (exit 0)
- [ ] `node tools/barfill.mjs tools/fixtures/overfull-voice.alphatab` → exit 1

playability position-jump-slow:
- [ ] `SLOW_JUMP_FRETS === 6`, warning pushed to `warnings[]` (never `errors[]`)
- [ ] `tools/fixtures/position-jump-slow.alphatab` exists, `validate --strict` clean
- [ ] `node tools/playability.mjs tools/fixtures/position-jump-slow.alphatab --bars 1-2 --json` → ≥1 `position-jump-slow` warning (`of 10 frets`, `3 -> 13` and `13 -> 3`), 0 errors
- [ ] `… --bars 3 --json` → 0 `position-jump-slow` warnings
- [ ] `tools/playability.test.mjs` exists and is in `package.json` `test`

compare contour:
- [ ] `CONTOUR_WARN_R === -0.5`
- [ ] map mode: `mapResult.soft.contourWarnings[]` present; a strongly-inverted `quote` entry appears there; `ok`/exit unchanged
- [ ] bar-locked mode: `soft.contour` has `{ r, warn }`; `warn` true iff `r < -0.5`
- [ ] hard gates + exit codes unchanged in both modes

green suites:
- [ ] `npm test` passes (incl. the new `playability.test.mjs`)
- [ ] `npm run smoke` passes (all 7 checks)

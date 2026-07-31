# Chunk-authoring cheatsheet

The one file to keep open **while writing a bar**. It synthesizes the rules spread across
`alphatex-language.md`, `guitar-fretboard.md`, `guitar-playability.md`, the gate docs, and
the tool specs into scannable tables. When something here is ambiguous, the deeper reference
is named in the row. Every tool output below is real (captured from the shipped CLIs).

---

## 1. Pre-write safety nets (run these BEFORE the bar reaches `cover.alphatab`)

Two CLIs answer the two questions that cost the most rework. Use them per bar, not after.

**`tools/fret.mjs` — verify every `fret.string` token; never hand-compute a pitch.**

| Command | Real output | Exit |
|---|---|---|
| `node tools/fret.mjs 10.6` | `10.6 = D3 (pc 2)` | 0 |
| `node tools/fret.mjs Ab3` | `Ab3 (midi 56, pc 8): 1.3 6.4 11.5 16.6` | 0 |
| `node tools/fret.mjs Ab3 --maxfret 12` | `Ab3 (midi 56, pc 8): 1.3 6.4 11.5  (1 position(s) above maxfret 12 hidden)` | 0 |
| `node tools/fret.mjs 21.1 --maxfret 12` | `21.1 = C#6 (pc 1) [OUT OF RANGE: fret 21 > maxfret 12]` | 1 |
| `node tools/fret.mjs 8.6 --root C --pcset C E G` | `lowest 8.6 = C3 (pc 0); root C (pc 0), pcset {0,4,7} -> IN SET (OK)` | 0 |

- **Forward** `<fret>.<string>` → pitch (string 1 = high e, 6 = low E). Reverse `<NoteName>`
  → every playable `fret.string` position, low to high.
- `--maxfret <N>` = the project's declared fret count (Gate-A *Instrument / physical* row).
  A forward token past the limit still prints the pitch but appends `[OUT OF RANGE …]` and
  exits 1; a reverse note simply drops positions above the ceiling.
- `--pcset … --root …` is the harmonic-root gate on one draft note: does this bar's lowest
  note sit in the chord? `NOT IN SET (FAIL)` (exit 1) means the root/skeleton gate will fail.

**`tools/barfill.mjs` — confirm the bar sums to its meter before you commit it.**

| Command | Real output | Exit |
|---|---|---|
| `node tools/barfill.mjs --frag "3.6.4 5.6.4 7.6.4 8.6.8 \|"` | `bar 1: 3360 ticks (3.50) / expected 3840 (4.00) in 4/4  MISMATCH (underfull by 480 ticks)` | 1 |
| `node tools/barfill.mjs --frag "3.6.4 5.6.4 7.6.4 8.6.4 \|"` | `bar 1: 3840 ticks (4.00) / expected 3840 (4.00) in 4/4  OK` | 0 |

- **Fragment mode** wraps the beats in `\ts N M` (default 4/4; set with `--ts 6/8`) — the
  skeleton is **just `\ts` + the beats**, NOT `\track{\staff{}}`. `--frag "…"` inline or
  `--stdin`.
- **File mode** `node tools/barfill.mjs cover.alphatab --bars N-M` checks a written range.
- Exit 1 = at least one bar over/underfull. Tuplets are the usual culprit (three `{tu 3}`
  eighths fill ONE beat, not 1.5).

**`tools/tab-events.mjs` — confirm what the parser ACTUALLY built (mandatory for ties).**

```
node ../../tools/tab-events.mjs cover.alphatab --bars 14-16
```

Every note prints as **ATTACK or CONTINUATION** with its tie links and the
chain's merged sounding duration — read from the parsed model, never from how
the text looks. The trap it exists for: a dash tie (`-.5.2`) whose origin
cannot be resolved parses SILENTLY as a fresh attack of the **open string** — a
pitch you never wrote — and a `{t}` on a pitch that never sounded parses as a
plain reattack. The footer audit (`!! N tie-shaped token(s) parsed as fresh
attacks`) counts what the parser swallowed; `playability.mjs` fails the same
defect as `tie-without-origin`. Run tab-events whenever a chunk introduces
ties, cross-bar sustains, or unusual effects — before the gate, not after it
fails.

**Versioning the loop — never lose a take.** The Gate-B command is
`node ../../tools/history.mjs check cover.alphatab --map sidecar.json --bars 1-N`: it runs the
`check.mjs` gate (same report + exit code) **and** snapshots each gated iteration into
`projects/<slug>/history/` (de-duped by content). `history.mjs list` shows the lineage,
`history.mjs diff <a> <b>` names what changed bar-by-bar, `history.mjs restore <seq>` reverts
non-destructively, and `history.mjs verdict <APPROVED|REVISE:tag>` records the human's call.
Checkpoint a tab you are about to hand-edit with `history.mjs snap` first.

---

## 2. AlphaTex gotchas (verified with `validate.mjs`)

Full language: `reference/alphatex-language.md`. The traps that actually bite while writing:

| Rule | Right | Wrong (why) |
|---|---|---|
| **Note effects on a chord go per-note, INSIDE the parens** | `(0.6{pm} 0.5{pm})` | `(0.6 0.5){pm}` → AT205 `Unrecognized property 'pm'`. Braces after `)` accept **beat** effects only. |
| Note effect vs. beat effect placement | note effect attaches right after `fret.string`: `17.1{b (0 4)}`, `12.3{v lr}`, `9.5{sib}` | a note effect placed after `)` (`(0.4 2.3){lr}`) does not parse — put it per-note: `(0.4{lr} 2.3{lr})` |
| Beat effects go **after the duration** | `14.2.4{d}` (dotted), `5.5.8{dy ff}`, `(…){bd}` | — |
| **`\staff` requires an open `\track`** first | `\track "Lead" \staff {tabs} …` | a bare `\staff {…}` → AT205, then the parser falls back to percussion and every later token mis-parses |
| Legal durations only | `1 2 4 8 16 32 64 128 256` | `9` → AT209 |
| Multi-arg metadata wants parens | `\ts (4 4)`, `{tr (16 16)}` | space-separated parses but warns AT301/AT303 |
| Bend / whammy values are **quarter-steps** | `{b (0 4)}` = whole-step bend up; `{b (0 4 4 0)}` = bend, hold, release | 4 ≠ a half step |
| Rest / tie / dead / repeat | `r.4` rest · `-.4` tie · `x.5.8` dead · `3.3*4` repeat-beat | — |

**Playability-relevant technique limits** (from `guitar-playability.md`):

| Effect | Where it is legal |
|---|---|
| Bend `{b …}` | strings 1–3 (4 rarely), frets ≥ 5; max whole-step standard |
| Palm mute `{pm}` | strings 4–6 (near the bridge); on 1–2 is unusual — justify |
| Hammer/pull `{h}` | between notes ≤ 4 frets apart on the **same** string |
| Natural harmonic `{nh}` | rings only at frets 5, 7, 12, 19 |
| Sustain `{lr}`/`{tp}`/`{v}` | required on any note held ≥ 2 beats (a bare long note decays to silence) |

---

## 3. Fret → note grid (capped at the project's declared fret limit)

**`midi = OPEN[string] + fret`.** The grid extends only to the **fret count declared in the
Gate-A *Instrument / physical* row** — a 22-fret neck tops at G5 (`22.1`); a 24-fret neck
reaches A5. `tools/fret.mjs --maxfret <count>` enforces that ceiling mechanically. Full
0–15 table: `reference/guitar-fretboard.md`. Open strings (source numbering):

| String | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Open note | E4 | B3 | G3 | D3 | A2 | E2 |
| MIDI | 64 | 59 | 55 | 50 | 45 | 40 |

Same-pitch offset: **+5 frets on the next-lower string** reproduces the pitch, **except
across strings 2→3 (+4)**. Verify any token you are unsure of with `node tools/fret.mjs
<fret>.<string>` rather than counting by hand (the session bug was `21.1` read as D6 when it
is C#6).

---

## 4. The gate: hard vs. soft (mirrors `docs/workflow.md` + `docs/gate-templates.md`)

`check.mjs` runs `validate --strict` → `playability` → `compare`. It exits non-zero **only**
on a HARD fail. Soft signals are information for the human's verdict — weigh them, do not
chase them.

| Signal | Gate | Notes |
|---|---|---|
| Parse / bar-fill (`validate --strict`) | **HARD** | over/underfull bar fails; pre-check with `barfill.mjs` |
| Playability **errors[]** | **HARD** | `non-adjacent-strings`, one-note-per-string, span, gain over-budget, fast `position-jump` |
| Melodic **skeleton** coverage (per `quote` span) | **HARD** | in-order structural melody; `recompose`/`free` do not gate it |
| Harmonic **root** motion (per `quote` and `recompose` span) | **HARD** | `free` gates nothing |
| Playability **warnings[]** | soft | `position-jump-slow`, `sustain`, tone/physics advisories — surfaced, never fatal |
| Chord quality | soft | a power chord (no 3rd) correctly renders **both** major and minor — a missing 3rd is never a miss |
| Density % of source notes retained | soft | low is **expected** for a rock cover |
| Dropped notes | soft | name the losses; do not chase 100% |
| Contour correlation | soft | strongly-negative (`r < -0.5`) on a `quote` span raises a warning — see §6 |

**Per-span mode** (the sidecar contract): `quote` = skeleton + roots protected · `recompose`
= roots only · `free` = nothing (added material, named at the gate). A 0/0 covered/total is a
trivial fail-open PASS — always confirm the totals are non-zero.

---

## 5. Dominant playability rules (the ones that fail or warn most)

Full list: `reference/guitar-playability.md`. The high-frequency ones:

- **Pick reachability (HARD).** A struck beat with ≥ 2 notes on **non-adjacent** strings
  (e.g. `(0.6 5.2)`) fails `non-adjacent-strings` — a flatpick cannot isolate them. Legal
  simultaneities: adjacent double-stops, a full **brush** `{bd}`/`{bu}`, or an **arpeggio**
  roll `{au}`/`{ad}`. Everything else must be arpeggiated into single-string attacks.
- **A strum crosses every intervening string.** Any string between the outer two sounds —
  it must be a chord tone, fretted in, or muted (`x.n`).
- **Fast `position-jump` (HARD error).** Between 16th-or-faster beats, no shift **> 5 frets**
  on one string without a slide (`sl`/`ss`) or intervening rest/open string.
- **`position-jump-slow` (SOFT warning — new).** Two consecutive beats **slower than a 16th**
  whose `minFret` gap is **> 6** with no slide/hammer legato → a warning, never a gate fail.
  This is the **eighth-pace pedal-vs-stab hand-jump** the fast check missed. Real output:
  ```
  Bar 1: slow position jump of 10 frets (fret 3 -> 13) between consecutive beats slower than
  a 16th — a hand-station shift this large at eighth-note pace (pedal-vs-stab) forces a big
  reposition; anchor one hand station, use an open string, or slide {sl}.
  ```
  Fix: keep the low pedal **inside the stab's fret position** (a string-cross within one hand
  station, not a hand-jump), anchor a station, use an open string, or slide the move.
- **No low 3rd under high gain.** A voicing whose root sounds below ~G3 (MIDI 55) may hold
  only 5ths, octaves, 4ths — move the 3rd up an octave or omit it.
- **Vertical note ceiling by gain:** clean 4–6 · crunch 3–4 · high-gain 2–3 simultaneous.

---

## 6. `--transpose N` sign convention (and its off-by-one trap)

**N = the tab is written N semitones ABOVE the source.** Comparison happens in source pitch
space, so `check.mjs`/`compare.mjs` need to know how far you shifted.

- **Derive it from your Gate-A key choice:** `N = (target pc − source pc)`, reduced into
  `−6..+5`. Example: a source in E♭ played on a guitar in E is `--transpose 1`.
- **Zero is legitimate** — a source already in a guitar key (the whole CanonRock corpus
  stayed in D) is `--transpose 0`. Do not move a key that already sits well.
- **The trap is the sign.** N is *tab minus source*, not source minus tab. Invert it and the
  gate compares against the wrong pitch space: the skeleton and roots will look like they
  miss everywhere even though the notes are right. Sanity-check against **one note you can
  name in both** the source map and your tab before trusting a run.

---

## 7. Recognizability (name it at the gate)

A contour inversion — your line broadly moving **opposite** the source phrase — inside a
`quote` or `recompose` span is a legitimate reimagining, but it must be **named** in the
chunk presentation (e.g. "ascending reimagining of the descending cascade — deliberate").
An *unexplained* inversion is a defect (`wrong-contour` / `unrecognizable` in the REVISE
taxonomy). `check.mjs` surfaces a soft, non-gating **contour warning** when the Pearson
correlation is strongly negative (`r < −0.5`) — mechanically on `quote` spans; on a
`recompose` span the tool stays silent, so **self-report** the flip. Pre-explain it in the
sidecar entry's `note` field so the warning arrives already accounted for.

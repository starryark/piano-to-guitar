# Piano-to-guitar — orientation for a fresh session

You are a **guitarist-arranger**, not a transcriber. This project turns a piano **AlphaTex**
source into a **playable solo electric-guitar rock cover** also written in **AlphaTex**,
built **chunk by chunk under human supervision**. The job is **recomposition with a
protected skeleton**: quoted spans protect melody, recomposed spans protect root motion,
and additions are first-class and named at the gate. A fidelity gate enforces exactly
that skeleton; every other departure from the source is *reported as information*, never
a failure.

The human auditions each chunk (open the `.alphatab` in VS Code with the alphaTab
extension and play it, A/B against the source opened the same way) and decides. No tab
is shown to the human until `check.mjs` passes. Follow the **`piano-to-guitar` skill**
(`.claude/skills/piano-to-guitar/SKILL.md`) for the gated workflow; this file is the
orientation you read first.

**This repo is a toolchain, not a piece of music.** It ships no example arrangement on
purpose. Everything below is a rule you apply to *the source in front of you* — where a
number appears, it is the magnitude to expect, not a value to reuse. Derive every
musical decision from `analysis/<name>-map.md`; never inherit one from a previous
arrangement.

**The band decision, stated honestly.** The guitar tab is the product. The source piano
is the *implied backing* — what the listener mentally fills in against the guitar — not a
part the guitar has to double. There is no separate backing render in this project: the
shipped artefact is the guitar tab plus the human's verdict on it. To hear the source for
an A/B, open its `.alphatab` in VS Code (alphaTab extension) and play it.

Environment: Windows, PowerShell + Bash both available. Node ESM (`"type":"module"`).
**One runtime (Node) and one dependency (`@coderline/alphatab`).** No Python, no second
parser, no source-format conversion layer — they were deleted on purpose when this project
forked (see "Vendoring provenance" below). The source format is AlphaTex throughout;
input in any other format is rejected at every tool boundary.

---

## ⚠ §A — Two hazards, both RESOLVED (with caveats you must not undo)

### A.1 The AT218 pitched-rest hazard — normalizer fixes it; validate to confirm

A MuseScore/piano AlphaTex exporter sometimes emits `-1.<string>.<dur>` tokens (e.g.
`-1.1.4{beam Up}`) inside a **pitched** staff where a **rest** belongs — the exporter
reusing a fret-hole convention on a staff that carries no frets. Left raw, this is the
AlphaTex error **AT218** and the source will not parse.

The fix is shipped in **`tools/lib/piano-source.mjs`**: `normalizePianoSource` rewrites
`-1.<string>.<dur>` → `r.<dur>` in pitched staves only (a fret-hole inside a real fretted
chord is *not* rewritten — it is reported as `skipped`, since a chord member cannot become
a rest). Measured on the corpus this fires **11 times on `canon-in-d-easy`** (lines 64, 74,
77, 95, 116, 121, 144, 152, 249, 263, 295) and is a byte-identical no-op on the other five
files. The digest pipeline always normalizes **in memory** before parsing, so `piano-extract`
is unaffected even on a raw file.

**One-line check on any source you ingest:**
```
node tools/piano-validate.mjs <file.alphatab>
```
Exit `0` with `rewrites: 11` (or whatever the count is for your file) means the normalizer
handled it. If it still reports errors *after* normalization, stop — that is a different
defect, not AT218.

### A.2 The vacuous-gate hazard — FIXED by WP2b; pinned by a test that FAILS if it re-widens

This was the project's blocking defect and it is now closed. Documenting the **fix**, not
the open defect, because the trap is the temptation to "improve" it back.

**What was wrong.** `tools/compare.mjs` gates harmony with
`lowPc === rootPc || pcset.has(lowPc)`. The digest originally emitted one `harmony` per bar,
but the corpus's harmonic rhythm is **two chords per bar** (the chaconne is
`D | A Bm | F#m G | D G | A` at half-bar resolution). Merging two chords plus the
sixteenth-note passing-tone runs into one per-bar label blew `harmony.pcset` wide open:
mean width **6.33 of 12 pitch classes**, **32 of 57 bars sitting on the full 7-note D
major scale**. A random tab note passed the harmonic-roots gate ~53% of the time — the gate
had degraded from "does this bar sit on the right chord?" to "is this note diatonic?" It
reported PASS while protecting almost nothing. (`harmony.root` itself was always correct;
the defect was *width*, not accuracy.)

**The fix (in `tools/lib/analysis.mjs`, `readBar`).**
- `harmony.root` stays the **whole-bar lowest sounding pitch class** — unchanged. This
  preserves the root invariant ("`root === lowest sounding pc` in every bar, 0 violations
  across all bars of all six files") and the measured chaconne bass line
  (`A F# D G A F# D G …`) exactly.
- `harmony.pcset` is narrowed to the **primary half-bar's harmonic stratum**: notes of
  duration ≥ 1 beat (quarter note or longer) in the half-bar that sounds the bar's lowest
  note — the bass plus sustained chord tones, **not** the sixteenth-note passing-tone runs.
  Fallback to all primary-half-bar notes when no long notes exist (lead-line cover bars).
  "Primary" = the half-bar sounding the lowest note, so the root lives in the pcset's own
  chord. **The chord table and scoring formula are UNTOUCHED — only the pcset INPUT is
  stratified, by duration, inside the analysis window.**
- **NEW additive field `harmonySpans[]`** carries both half-bar chords, for the bar map and
  any future finer gate. `compare.mjs` does NOT read it (the narrowed `harmony` already
  fixes the defect); it is contract surface for humans and future use.

**Verified result on `canon-in-d-hard`:** mean width **6.33 → 2.65**, **0 bars at 7 pitch
classes** (max 4), roots `A F# D G A F# D G …` reproduced exactly, coverage 57/57. Pinned by
the **width-bound test in `tools/lib/analysis.test.mjs`** (it FAILS if the gate re-widens)
and by smoke check #2 (the bound asserted at the tool level).

**Guidance — do NOT undo this:**
- **Do NOT widen the pcset back** to a whole-bar or whole-scale set. If you are tempted to
  "make the gate more forgiving," point yourself at the width-bound test and the §A.2
  anti-acceptance clause (just below).
- **Do NOT re-tune the chord table.** The table was never the problem; the *window* was.
  Half-bar windows resolved all 57 bars cleanly with zero weight tuning.
- The fix is the status quo, not a TODO. A "suspiciously clean PASS on a wide pcset" is the
  live anti-acceptance signal — treat it as a failure even at exit 0.

---

## The workflow (one heartbeat: `check.mjs`)

1. **Step 0 — Ingest** a `source/*.alphatab`: `piano-validate.mjs` → `piano-extract.mjs` →
   audition the source (open its `.alphatab` in VS Code, alphaTab extension). Read the
   generated `analysis/<name>-map.md`, never the raw AlphaTex. Establish the source's
   properties (below) before planning anything.
2. **Gate A — Plan** the arrangement — register, gain, key/transpose, **target tempo,
   groove, and form** — and get the human's sign-off. Tempo, groove and form are Gate A
   *decisions* (proposed, then locked on approval), not inheritances from the source.
3. **Gate B — Per chunk**, declare the span's sidecar entry (mode + source-bar tie-in),
   write the tab bars, then run **`check.mjs --map <sidecar> --bars 1-<last>`** until it
   passes, then present to the human for the A/B audition and verdict. Loop.
4. **Final — Assemble** the approved chunks into the full tab and give it one last
   full-length `check.mjs` + audition.

**`check.mjs` is the gate.** It runs `validate --strict` → `playability` → `compare`,
prints one report, and exits nonzero iff any **HARD** gate fails. Never hand-run the
sub-tools as the verdict; run `check.mjs`.

---

## Step 0 — establish these about YOUR source

Fill every row from `analysis/<name>-map.md` and the digest. Nothing here has a default
worth assuming; a wrong answer here silently mis-shapes everything downstream.

| Establish | Where it comes from |
|---|---|
| Bar count, key, initial meter and tempo | map header (`key`, `meterInitial`, `tempoInitial`) |
| **Does the meter change mid-tune?** | map's meter distribution + per-bar `timeSig`. If it does, the irregular grouping is a deliberate phrase length — read the recurring cycle off the map and **never normalize it to 4/4** |
| Tempo changes | per-bar `tempoChanged`. A mid-song `\tempo` needs approval at Gate A. **Never trust the first `\tempo` directive** — corpus files declare a second `\tempo` that silently overwrites the first (e.g. `\tempo 100` then `\tempo 25`; 25 is what plays) |
| Pitch range vs the guitar's, and what falls outside | `pitchRange`, `guitarRange`, `rangeDeficit` (**note counts** above/below the window, not semitones) |
| Which voice is the melody | `melodyVoice` / `bassVoice` per bar — derived from sounding register. **Piano voice indices are staff-global** (staff 0 uses voices 0–3, staff 1 uses voices 4–7 in `canon-in-d-hard`); never key logic off a voice or staff index, use sounding register. If melody/bass looks wrong, stop: everything downstream is graded against it |
| Pickup bar? | `pickup`. Bar ids are positional; `sourceBarNumber` is the score's own numbering |
| Repeated material | `duplicateRanges[]` — arrange once, then *vary* the return |
| Sections | `sections[]` |
| Source encoding | reported by the readers; never assume UTF-8 |
| The declared `\ks` | `keyDeclared` / `keyDisagrees`. **Derive key from pitch content, never from `\ks`** — `Canon Rock 1` declares `\ks c` while sounding in D |

Then check the **AlphaTex piano-export hazards** in
`reference/piano-to-guitar-arranging.md` → "AlphaTex piano-export hazards" — each is a
one-line check on your own file, and each one costs real effort to rediscover.

---

## Tools (real CLIs + exit contracts)

The vendored gate tools are a snapshot from `abc-to-guitar@ba7e29c` (local edits marked
`// PTG:`); the piano-side tools are native to this project — see "Vendoring provenance"
below for detail.

| Tool | Command | Exit contract |
|---|---|---|
| **piano-validate** | `node tools/piano-validate.mjs <source.alphatab>` | Source-side validator. Normalizes in memory, parses, reports rewrites/skips, flags a `\ks` that disagrees with the sounding key. `0` clean, `1` any error (incl. "still fails after normalization"), `2` usage. **The AT218 check (§A.1):** exit `0` with `rewrites: N` means the normalizer handled the `-1.<str>.<dur>` tokens. |
| **piano-extract** | `node tools/piano-extract.mjs <source.alphatab>` | Writes `analysis/<name>.json` (the **digest** — the contract `compare` consumes) + `analysis/<name>-map.md` (human-readable bar map). |
| **validate** | `node tools/validate.mjs [--strict] <tab.alphatab>` | AlphaTex syntax + per-voice bar-fill. `1` on error; `--strict` makes fill warnings fatal (`check.mjs` always uses `--strict`). |
| **playability** | `node tools/playability.mjs <tab> [--bars N-M] [--gain high\|crunch\|clean]` | Mechanical + gain/tonal check. Emits `errors[]` (hard) **and** `warnings[]` (soft) — but **EXITS 1 on EITHER**. Default gain `high`. See the exit-code caveat below. |
| **compare** | `node tools/compare.mjs <tab> <digest.json> --bars N-M [--transpose N] [--json] [--map <sidecar.json>]` | **The fidelity gate.** `--bars N-M` is always required (scopes the tab range). Without `--map`: bar-locked 1:1 — HARD on melodic-skeleton + harmonic-root coverage. With `--map <sidecar.json>`: per-entry, mode-aware — `quote` enforces in-order skeleton + root motion, `recompose` enforces root motion only, `free` enforces nothing (added material). SOFT in both modes: chord quality, density %, dropped notes, contour. `0` all hard gates pass, `1` any hard-fail, `2` IO/usage or a digest missing required fields. |
| **check** | `node tools/check.mjs <tab> --bars N-M [--map <sidecar.json>] [--transpose N] [--gain …] [--digest …] [--json]` | **The one consolidated gate.** Runs validate --strict → playability → compare (bar-locked or sidecar-mode-aware), prints one report. Exits nonzero iff any HARD gate fails. **`--bars N-M` is required on every run** (it scopes the tab range); **`--map <sidecar>` selects correspondence-aware MODE and is mandatory for a cover** — a cover expands 2–4× (57 source bars → 210 tab bars in the corpus), so source and tab bar numbers do not line up and a bar-locked 1:1 gate (`--bars` without `--map`) is a debugging fallback only. |
| **smoke** | `npm run smoke` | End-to-end toolchain health check (7 checks) over `tools/fixtures/`. Run after a clone or any change to `tools/`. `npm test` runs the fretboard + analysis + piano-source unit suites. |

**`--transpose N` convention:** N = the tab is written N semitones **above** the source
(a source in E♭ played on a guitar in E is `--transpose 1`). Comparison happens in source
pitch space. **Derive N** from your Gate A key choice — `N = (target pc − source pc)`,
reduced into −6..+5 — and sanity-check it against a note you can name in both. **Note: this
corpus gives no transposition precedent — all six files are D major / B minor, none
transposes.** If you propose a transposition, argue it from the fretboard, not from CanonRock.

---

## Non-obvious facts to hold

- **playability exit-code caveat (critical):** playability exits `1` on *either*
  `errors[]` or `warnings[]`, so its **exit code is not trustworthy as a gate.**
  `check.mjs` parses playability's JSON and keys the hard fail on **`errors[]` only**;
  `warnings[]` are surfaced but never gate. (validate's and compare's exit codes ARE
  trustworthy and used directly.)
- **playability checks pick reachability.** A struck beat with ≥2 notes on
  **non-adjacent strings** and no brush (`{bd}`/`{bu}`) or arpeggio (`{au}`/`{ad}`)
  effect fails with `non-adjacent-strings` — a flatpick cannot isolate two non-adjacent
  strings in a single stroke. Adjacent double-stops and 3-string power chords pass;
  brushed/rolled beats pass by construction. **Playability is a hard constraint** the real
  corpus tabs obey (74 multi-note attacks across both covers, max 4 notes, zero
  non-adjacent string pairs). The arranger still owns the *musical* decision of which
  remedy (brush, roll, hybrid picking, re-voice) fits the texture.
- **The hard gates fail open by construction — 0/0 is a PASS, so always assert non-zero
  totals** (`compare.mjs` refuses a digest missing `melodySkeleton`/`harmony`; `smoke.mjs`
  asserts non-zero totals). See `.claude/skills/piano-to-guitar/gate-templates.md` (the
  "0/0 covered/total is a trivial PASS" block) — §A.2 was the subtler form of this disease
  and is now fixed and pinned.
- **The recomposition doctrine (what the gate actually enforces):** the gate does not
  enforce "play every note." With `--bars` it protects `melodySkeleton` (structural
  melody) and harmonic **roots** over the span. With `--map <sidecar>` it enforces
  *per-entry mode* — `quote` (in-order skeleton + root motion), `recompose` (root motion
  only), `free` (nothing — added material). **Reduction and addition are both first-class
  and named at the gate.** Additions are not losses to apologize for; a power chord
  (root+5th, no 3rd) correctly renders BOTH major and minor — **a missing 3rd is never a
  miss.** Low density is expected and good.
- **Harmony is baked into the analysis layer.** `compare.mjs` reads `harmony` straight
  from the digest JSON produced by `tools/lib/analysis.mjs` (the ported musical analysis).
  There is no separate harmony module to call.
- **The digest JSON is a contract — field names are stable.**
  Top-level: `{ song, sourceFile, key, keyFifths, keyMode, keyConfidence, keyDeclared,
  keyDeclaredFifths, keyDisagrees, meterInitial, tempoInitial, guitarRange, pitchRange,
  rangeDeficit, partCount, pickup, sections[], duplicateRanges[], bars[], harmonicLoop }`.
  `harmonicLoop` is `{length, firstBar, passes[], coverage, cycle[]} | null` — when present
  it is a strong planning signal (plan one texture per pass, escalating toward the climax —
  see `reference/rock-riff-construction.md` → "Passes over a loop"); when null, the
  arranger reads the chord progression off the `-map.md` bar table by hand. It is a
  detector, not a guarantee.
  Per-bar: `{ bar, sourceBarNumber, timeSig, tempo, tempoChanged, voices[], melodyVoice,
  bassVoice, melody[], melodySkeleton[], bass[], bassFolded[],
  harmony{root,quality,symbol,pcset}, harmonySpans[], flags[] }` (plus `pickup` on an
  anacrusis). `harmonySpans[]` is the additive WP2b field carrying **both** half-bar chords
  (`{root,quality,symbol,pcset}` each) — `compare.mjs` does not read it; it is contract
  surface for the bar map and any future finer gate. Durations are in **quarter-note
  beats**. `melodySkeleton` = structural notes only (strong beat OR ≥1 beat OR a contour
  turning point) — this is what the gate protects, and its strong beats are derived from
  the meter, not by halving the bar.

---

## Vendoring provenance

The gate tools are **vendored from `abc-to-guitar@ba7e29c`** — a snapshot, not a live
dependency. The sibling repo may be absent at runtime and everything here still passes
(verified by `npm test && npm run smoke` with the sibling renamed away). Upstream fixes are
pulled **deliberately**, never auto-synced. Every vendored file carries the header
`// Vendored from abc-to-guitar@ba7e29c — tools/<name>.`; **local edits are marked `// PTG:`**
so a future reader can see at a glance what diverges from upstream. The source-format
machinery of the predecessor (a second parser, MusicXML converters, a Python runtime, a
MuseScore normalizer) was **deleted, not ported** — a piano score lives natively in
AlphaTex here, so none of it was needed.

---

## Directory layout

```
Piano-to-guitar/
├─ CLAUDE.md        this file — auto-loaded every session
├─ README.md        human quickstart
├─ HANDOFF.md       the build plan + measured corpus facts (pinned by tests; see §A below)
├─ package.json     deps: @coderline/alphatab ONLY
├─ .claude/skills/piano-to-guitar/   SKILL.md — the gated workflow
├─ reference/       the craft library you read to do the work
│   ├─ alphatex-language.md         the AlphaTex you write (source + tab)
│   ├─ alphatex-piano-reading.md    reading a piano source in AlphaTex
│   ├─ electric-guitar-voice.md     signal chain, gain, pickups, register
│   ├─ rock-riff-construction.md    how riffs are built
│   ├─ piano-to-guitar-arranging.md the reduction craft + export hazards
│   ├─ guitar-fretboard.md          where a pitch lives
│   ├─ guitar-playability.md        hard mechanical constraints
│   ├─ theory-composition.md        minor/modal-slanted theory
│   ├─ tunings.md                   standard-tuning-first
│   └─ case-canon-rock.md           the corpus study (READ-ONLY reference)
├─ CanonRock/       the corpus — READ-ONLY, never write to it
├─ tools/           the gate tools (table above)
│   ├─ lib/         score-utils.mjs, fretboard.mjs (vendored);
│   │               piano-source.mjs (AT218 normalizer), analysis.mjs (the digest)
│   ├─ fixtures/    song-neutral regression corpus (see tools/smoke.mjs)
│   └─ smoke.mjs    end-to-end health check
├─ source/          you drop .alphatab files here (gitignored; yours)
├─ analysis/        generated digests (.json) + bar maps (-map.md) (gitignored)
├─ tabs/            the growing .alphatab arrangement
├─ logs/            per-song verdict history
└─ out/             scratch dir for smoke.mjs (gitignored)
```

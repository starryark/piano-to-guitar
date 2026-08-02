# Piano-to-guitar — orientation for a fresh session

**This is the canonical, vendor-neutral entry point. Any coding-agent CLI should read this
file first.** It orients you; the step-by-step gated procedure lives in **`docs/workflow.md`**
and its copy-paste presentation templates in **`docs/gate-templates.md`**. Read those before
you touch a tab.

You are a **guitarist-arranger**, not a transcriber. This project turns a piano **AlphaTex**
source into a **playable solo electric-guitar rock cover** also written in **AlphaTex**,
built **chunk by chunk under human supervision**. The job is **recomposition with a
protected skeleton**: quoted spans protect melody, recomposed spans protect root motion,
and additions are first-class and named at the gate. A fidelity gate enforces exactly
that skeleton; every other departure from the source is *reported as information*, never
a failure.

The human auditions each chunk (open the `.alphatab` in VS Code with the alphaTab
extension and play it, A/B against the source opened the same way) and decides. No tab
is shown to the human until `check.mjs` passes. Follow **`docs/workflow.md`** for the gated
workflow (templates in **`docs/gate-templates.md`**); this file is the orientation you read
first.

**This repo is a toolchain, not a piece of music.** It ships no example arrangement on
purpose. Everything below is a rule you apply to *the source in front of you* — where a
number appears, it is the magnitude to expect, not a value to reuse. Derive every
musical decision from `projects/<slug>/source-map.md`; never inherit one from a previous
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

1. **Step 0 — Ingest** a `projects/<slug>/source.alphatab`: `piano-validate.mjs` →
   `piano-extract.mjs` → `source-profile.mjs` → audition the source (open its `.alphatab`
   in VS Code, alphaTab extension). Read the generated `projects/<slug>/source-map.md`,
   never the raw AlphaTex. Establish the source's properties (below) before planning
   anything. **If the profile says noisy transcription**: run `foreground.mjs`, review
   the ambiguous bars, and lock a `melody-contract.json` before drafting.
2. **Gate A — Plan** the arrangement — register, gain, key/transpose, **target tempo,
   groove, and form** — and get the human's sign-off. Tempo, groove and form are Gate A
   *decisions* (proposed, then locked on approval), not inheritances from the source.
3. **Gate B — Per chunk**, declare the span's sidecar entry (mode + source-bar tie-in) in
   `projects/<slug>/sidecar.json`, write the tab bars into `projects/<slug>/cover.alphatab`,
   then run the gate — **`history.mjs check cover.alphatab --map sidecar.json --bars 1-<last>`**
   — until it passes, present to the human for the A/B audition and verdict, and record that
   verdict with **`history.mjs verdict <call>`**. Loop.
4. **Final — Assemble** the approved chunks into the full tab and give it one last
   full-length gate + audition.

**`check.mjs` is the gate engine; `history.mjs check` is the Gate-B command.** check.mjs runs
`validate --strict` → `playability` → `compare`, prints one report, and exits nonzero iff any
**HARD** gate fails. `history.mjs check` **wraps** it (identical report, args, and exit code)
and additionally snapshots each gated iteration into `projects/<slug>/history/`, so no tab
version is ever lost and any two can be compared (`history.mjs diff`) or recovered
(`history.mjs restore`). Never hand-run the sub-tools as the verdict.

---

## Step 0 — establish these about YOUR source

Fill every row from `projects/<slug>/source-map.md` and the digest. Nothing here has a
default worth assuming; a wrong answer here silently mis-shapes everything downstream.

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
| **piano-extract** | `node tools/piano-extract.mjs projects/<slug>/source.alphatab --out projects/<slug>` | Writes `projects/<slug>/source.json` (the **digest** — the contract `compare` consumes) + `projects/<slug>/source-map.md` (human-readable bar map). The `--out <dir>` flag targets the project folder; because the source stem is `source`, the outputs land as `source.json` / `source-map.md` automatically. **Multi-source ingest:** `--manifest <source-set.json>` extracts several independent transcriptions of the same piece (`{ sources: [{file, role, weight}] }`) and writes a `source-set.report.json` alongside the digests. |
| **source-profile** | `node tools/source-profile.mjs <source.alphatab> [--json]` | **Gate A source-reliability report** (PTG-native). Classifies the source as clean notation vs noisy automatic transcription from STRUCTURE (voice fragmentation, isolated octave artifacts, tied microfragments, off-grid onsets), groups tracks/voices that are fragments of ONE performance, and excludes percussion on structural evidence (unpitched staff / channel 10 / articulation map) — never the track name. Exit `0` when parsed, `1` parse fail, `2` usage. A report, not a gate. |
| **foreground** | `node tools/foreground.mjs <digest.json> [more-digests…] [--out <dir>] [--bars N-M]` | **Perceptual-foreground candidates** (PTG-native). Scores candidate melody lines per bar from the digest's attack graph — continuity, recurrence across returning bars, cross-source agreement, rhythm, contour — and writes `foreground.json` + `foreground-map.md` with ALTERNATIVES and confidence, never a silent decision. Extra digests = independent transcriptions of the same piece; agreement raises confidence, disagreement stays visible. Ambiguous bars are listed for Gate A. Exit `0` ok, `1` unusable digest, `2` usage. |
| **contract-validate** | `node tools/contract-validate.mjs <melody-contract.json> [--digest <source.json>] [--json]` | **Melody-contract validator** (PTG-native; schema in `tools/lib/contract.mjs`). Fails closed on contradictions, nonexistent bars, impossible relocated pitches, invalid duration policies, relocation groups cutting a phrase without justification, required events whose only evidence is a tied continuation, and vacuous contracts. `0` valid, `1` invalid, `2` usage/IO. |
| **tab-events** | `node tools/tab-events.mjs <file.alphatab> [--bars N-M] [--json]` | **Parser-grounded event inspector** (PTG-native): what alphaTab ACTUALLY parsed, not what the AlphaTex text appears to mean. Per bar/onset: MIDI+name, string/fret, duration, tie origin/destination, ATTACK vs CONTINUATION (chain sounding duration on heads), brush/arpeggio, hammer/pull/slide, vibrato/let-ring, tuplet ratio — plus a text-vs-model tie audit (`!! N tie-shaped token(s) parsed as fresh attacks`). **Mandatory whenever ties, cross-bar sustains, or unusual effects are introduced.** `0` ok, `1` parse fail, `2` usage. |
| **validate** | `node tools/validate.mjs [--strict] <tab.alphatab>` | AlphaTex syntax + per-voice bar-fill. `1` on error; `--strict` makes fill warnings fatal (`check.mjs` always uses `--strict`). |
| **playability** | `node tools/playability.mjs <tab> [--bars N-M] [--gain high\|crunch\|clean] [--policy <guitar-policy.json>] [--max-fret N] [--warnings-as-errors]` | Mechanical + gain/tonal check. Emits `errors[]` (hard) **and** `warnings[]` (soft). **Exit `0` when `errors[]` is empty (warnings do NOT fail it), `1` on any hard error, `2` on usage/IO.** Default gain `high` (a policy's `gain` applies when `--gain` is absent). **`--max-fret N`** sets the instrument's fret count (`--max-fret` > nearest `config.json` > 22); exceeding it is a hard `fret-range` error. **`--policy`** adds project texture constraints — a *separate*, usually stricter ceiling (`policy-max-fret`), `fastAttackMaxNotes` at/below `fastAttackThreshold` beats, `maxSimultaneousNotes`, brush/roll/mute bans, rapid-repeated-grip, preferred fret span (soft). **Tie integrity is always on**: a tie-shaped token that parsed into a fresh attack (`tie-without-origin`) or a pitch-changing chain is an error. Soft advisories include `non-adjacent-dyad` (hybrid picking), `harmonic-node-extended` (frets 4/9/16/24), `pick-demand.hard\|expert\|avoid` (the reference's tempo × subdivision table, never gating), `sustain`, `gain-voicing`, `position-jump-slow`. **`--warnings-as-errors`** escalates soft advisories into `errors[]` for zero-warning approval policies. |
| **fingering** | `node tools/fingering.mjs <tab> [--bars N-M] [--max-fret N] [--arrangement-mode solo\|dual-guitar] [--lead 0,2] [--rhythm 1,3] [--json]` | **Phrase-level fingering analyzer** (PTG-native, Wave 2). Asks what the per-beat checks cannot: *given the pitches already committed to, is there a better way for a HAND to play this phrase?* Beam-limited Viterbi DP over phrase windows (a phrase ends at a rest or after a note ≥ 2 beats), costing hand-station shifts **time-aware** (the same shift costs 8× between 16ths as after a half note), string crossings/skips, stretch past the 4-fret CAGED window and high positions, minus anchored common tones and genuinely useful open strings. **It never rewrites the tab** — the output is a recommendation with a stated reason. Technique is protected: harmonics / ties / let-ring / dead notes are **pinned**; bends, palm mutes and vibrato are **filtered** to positions that still permit the technique; a hammer/pull or slide pair may move only **together, on one string**. A **written open string is never traded for a fretted position** (one-directional — fretted → open stays available, since that is the useful-open-string case). Emits `fingering.better-fingering`, `fingering.position-jump`, `fingering.stretch` — each *only* where a cheaper legal alternative actually exists, and repeated identical findings collapse into one carrying `data.occurrences`, so an already-idiomatic riff draws silence. Soft-only: exit `0` always, `2` on usage/IO/parse. **Point it at the TAB, not the source:** a staff with no string tuning (every piano `\staff { score }`) has no fingering at all, and is skipped with a reason rather than guessed at. Standard tuning only (a non-6-string staff is likewise skipped). |
| **idiom** | `node tools/idiom.mjs <tab> [--bars N-M] [--style NAME] [--json]` | **Guitar-idiom density** (PTG-native, Wave 3). Asks whether a passage BEHAVES like guitar music, judged by the chosen style's weights — power chords, octaves, shell voicings, pedal tones, palm-muted runs, lead articulation, recurring riff cells, syncopation, fragmentation, and literal block-chord density as negative pressure. Every stylistic opinion lives in `reference/styles/*.json`; this tool only measures, which is why a zero-weighted feature (jazz's palm muting) cannot move a score in either direction. Emits `idiom.low-density`, at most once per run. **"Not measured" is never "measured zero"**: a single-note line has no grips to classify, so grip features drop out of BOTH sides of the ratio, and a passage below the style's `minAttacks` reports `score: null` rather than a confident 0. Soft-only: exit `0` always, `2` on usage/parse/unknown style. |
| **sidecar-audit** | `node tools/sidecar-audit.mjs --digest <source.json> --map <sidecar.json> [--bars N-M] [--style NAME] [--contract <melody-contract.json>] [--json]` | **Reads the correspondence map as a whole** (PTG-native, Wave 4). Uses the GATE's own sidecar validator, so it can never report on a map `compare.mjs` would refuse. Reports TWO DISJOINT SPACES (contract C10): tab space (quote/recompose/contract/free bars, free share) and source space (bars protected by quote/contract, bars only under recompose, never referenced, referenced more than once) plus melody-skeleton coverage. **`free` exists in tab space and NOWHERE else** — a free span has no `sourceBars` by construction, so "what share of the source is free" is ill-formed and is not computed. Every source figure is a SET: a bar quoted three times is ONE bar of coverage. Emits `sidecar.high-free-share`. Soft-only: `0` / `2`. |
| **export-midi** | `node tools/export-midi.mjs <tab> --out <file.mid> [--force] [--single-track] [--json]` | **Standard MIDI export** (PTG-native, Wave 5) — the path into a DAW or amp sim. A dual-guitar arrangement arrives as two MIDI tracks. Refuses to write over the source (even with `--force`), never creates parent directories, makes overwrite opt-in, and writes atomically via a temp file in the destination dir — a crash leaves the old file or no file, never a truncated one a DAW will cheerfully open. `0` ok, `2` usage/parse/IO. **Exports NOTES, not TONE.** |
| **render-audio** | `node tools/render-audio.mjs <tab> --out <file.wav> [--soundfont <f.sf2>] [--sample-rate N] [--force] [--json]` | **OPTIONAL** offline audio (PTG-native, Wave 5). Renders to WAV in Node with no new dependency — alphaTab ships its own SoundFont. Useful for phrasing, form and tempo; **useless for tone**, and it says so on every run (C15). See `docs/specs/audio-rendering-decision.md`. `0` / `2`. |
| **compare** | `node tools/compare.mjs <tab> <digest.json> --bars N-M [--transpose N] [--json] [--map <sidecar.json>] [--contract <melody-contract.json>] [--style NAME] [--gain …] [--arrangement-mode …] [--lead …] [--rhythm …]` | **The fidelity gate.** `--bars N-M` is always required (scopes the tab range). Without `--map`: bar-locked 1:1 — HARD on melodic-skeleton + harmonic-root coverage. With `--map <sidecar.json>`: per-entry, mode-aware — `quote` enforces in-order skeleton + root motion, `recompose` enforces root motion only, `free` enforces nothing (added material), **`contract`** enforces a melody-contract phrase (octave-exact pitches under relocation, phrase order, minimum sounding durations, DISTINCT repeated attacks, required gaps, forbidden textures) plus root motion, **`contract-recompose`** the same with harmony relaxed. The contract file comes from `--contract` or the sidecar's top-level `"contract"` path and is fully validated before any gate runs — invalid/vacuous = exit 2, and a contract span reports non-zero obligation totals or FAILS (anti-vacuity). SOFT in all modes: chord quality, density %, dropped notes, contour. `0` all hard gates pass, `1` any hard-fail, `2` IO/usage or a digest missing required fields. |
| **check** | `node tools/check.mjs <tab> --bars N-M [--map <sidecar.json>] [--transpose N] [--gain …] [--style …] [--arrangement-mode …] [--lead 0,2] [--rhythm 1,3] [--digest …] [--contract <melody-contract.json>] [--policy <guitar-policy.json>] [--max-fret N] [--warnings-as-errors] [--json]` | **The one consolidated gate.** Runs validate --strict → playability → compare (bar-locked or sidecar-mode-aware), prints one report. Exits nonzero iff any HARD gate fails. **`--bars N-M` is required on every run** (it scopes the tab range); **`--map <sidecar>` selects correspondence-aware MODE and is mandatory for a cover** — a cover expands 2–4× (57 source bars → 210 tab bars in the corpus), so source and tab bar numbers do not line up and a bar-locked 1:1 gate (`--bars` without `--map`) is a debugging fallback only. **Digest resolution:** the co-located `projects/<slug>/source.json` auto-resolves when you run from inside the project dir (`node ../../tools/check.mjs cover.alphatab --map sidecar.json --bars 1-N`); pass `--digest projects/<slug>/source.json` explicitly when running from repo root. |
| **history** | `node tools/history.mjs <check\|snap\|verdict\|final-review\|list\|diff\|show\|restore\|export> …` | **The per-project tab version store** (PTG-native). `history.mjs check <tab> [check-args…]` is the Gate-B command: it wraps `check.mjs` (same report + exit code) and de-dup-snapshots each gated iteration of `cover.alphatab`+`sidecar.json` — **plus the melody contract, guitar policy, machine gate report, and foreground.json in force** — into `projects/<slug>/history/`, recording `contractHash`/`policyHash` so an old PASS stays reproducible after a contract edit (an edit is a distinct iteration by construction). `snap` checkpoints without gating; `verdict <APPROVED\|REVISE:tag> [--recognizability A] [--playability-review A]` annotates the latest version (+ a `sessions.md` stub); **`final-review <tab>`** assembles the end-of-project evidence (themes, sections, relocations, fastest events, tuplets, long arrivals, multi-note attacks, tie audit, per-chunk gate/verdict status, contract drift) without replacing the human audition; `list` / `diff <a> [b]` (bar-aware) / `show` / `restore <seq>` (non-destructive) / `export` manage the store. Exit `0`/`1` (mirrors check) / `2` usage. The store lives inside the gitignored project dir — local by construction. |
| **smoke** | `npm run smoke` | End-to-end toolchain health check over `tools/fixtures/` — every style profile, both arrangement modes, MIDI validity, and a repeated full-gate run diffed byte for byte. Run after a clone or any change to `tools/`. **`npm test`** runs every unit and integration suite in `tools/` and `tools/lib/`, including the paired **scenario corpus** (`tools/lib/scenarios.test.mjs`) and the **regression lock** (`tools/regression-lock.test.mjs`). Both commands print their own totals; this table deliberately does not restate a count that would go stale. |

**`--transpose N` convention:** N = the tab is written N semitones **above** the source
(a source in E♭ played on a guitar in E is `--transpose 1`). Comparison happens in source
pitch space. **Derive N** from your Gate A key choice — `N = (target pc − source pc)`,
reduced into −6..+5 — and sanity-check it against a note you can name in both. **Note: this
corpus gives no transposition precedent — all six files are D major / B minor, none
transposes.** If you propose a transposition, argue it from the fretboard, not from CanonRock.

---

## Non-obvious facts to hold

- **playability exit-code semantics (Wave 1 correction):** playability now exits `0` when
  `errors[]` is empty — **warnings no longer fail the process** — `1` on any hard error,
  `2` on usage/IO. Its exit code is therefore trustworthy, like validate's and compare's.
  (It used to exit `1` on *either* array, which is why older notes call it untrustworthy.)
  `check.mjs` still keys the hard fail on the parsed **`errors[]` only**, deliberately: it
  needs that list to print anyway, so verdict and report are derived from the same datum
  and cannot disagree. `warnings[]` are surfaced but **never gate**. `--warnings-as-errors`
  is the opt-in route back to strictness — it *moves* warnings into `errors[]`.
- **playability checks pick reachability, graded by note count.** A struck beat on
  **non-adjacent strings** with no brush (`{bd}`/`{bu}`) or arpeggio (`{au}`/`{ad}`) effect
  is judged by how many notes sound at once: a **dyad** is a `non-adjacent-dyad` **warning**
  (hybrid picking — pick + a finger — is an ordinary technique, so this is a thing to
  decide, not a defect); **3+ notes** stay a `non-adjacent-strings` **error**, because a
  flatpick cannot isolate them and no hybrid grip absorbs them mid-line. Adjacent
  double-stops and 3-string power chords pass; brushed/rolled beats pass by construction.
  The 3+ case **is a hard constraint** the real corpus tabs obey (74 multi-note attacks
  across both covers, max 4 notes, zero non-adjacent string pairs). The arranger still owns
  the *musical* decision of which remedy (brush, roll, hybrid picking, re-voice) fits.
- **the instrument is configurable (Wave 1, contract C5).** 22 frets / 6 strings is a
  DEFAULT, not a law. One precedence rule everywhere: **`--max-fret N` > the nearest
  `config.json` at or above the tab (e.g. `projects/<slug>/config.json`) > built-in 22.**
  `tools/lib/project-config.mjs` owns it, fails closed on unknown keys and bad types
  (exit 2), and reports a `sources` provenance map so `--json` can say *why* a limit is
  what it is. `tools/lib/fretboard.mjs` **never reads the filesystem** — resolved limits
  travel in as `opts`. Note `--policy`'s `maxFret` is a *different* question and both stay
  in force: the instrument limit says the fret does not exist (`fret-range`, hard); the
  policy limit says the project chose not to go there (`policy-max-fret`, hard).
- **fingering is a recommender, and "cheaper" is never automatically "better" (Wave 2).**
  `tools/lib/fingering.mjs` costs the **hand**; it does not model the **voice**.
  `reference/guitar-fretboard.md` → "Where a pitch sounds best" is explicit that the same
  pitch in two positions is two instruments — B4 at `12.2` is round and vocal, at `7.1` it is
  tense and bright — so a suggestion is a *question addressed to the arranger*, and the tool
  prints that caveat on every run that suggests anything. Two consequences worth holding:
  (a) **nothing is ever rewritten** (contract C15) — `cover.alphatab` is byte-identical after
  a run, and a test pins that; (b) the analyzer **only speaks when the win clears both an
  absolute and a relative floor**, so ties and rounding wins produce no advisory at all and an
  already well-fingered riff draws total silence. A suggestion also never proposes something a
  hard gate would reject: candidates are re-checked against `isPlayableVoicing`, against the
  3+-non-adjacent-string pick-reachability error, and against playability's >5-fret/16th
  `position-jump`. The engine **is** wired into the gate pipeline: `soft.fingering` in
  `check.mjs --json` carries `fingering.*` and `lead.*` findings on every run.
  **Two traps found while building it, both now pinned by tests.** (1) A staff carries a
  `stringTuning` only when it is a FRETTED staff; a piano `\staff { score }` reports none and
  its notes come back `string:-1, fret:-1`. Defaulting that to "6 strings" produced an
  impossible grip that scored as a hard violation, so every note of a piano *source* came back
  with a confident 100-unit "improvement". A staff with no tuning is not a guitar — refuse it.
  (2) An "anchored finger" bonus must NOT be paid for re-striking an *identical* grip: it fired
  on a repeated fretted note but never on a repeated open one, so the optimizer wanted to
  **fret an open-string riff** — cheaper by the numbers, wrong by the ear. Both are the same
  failure mode: a cost model answering confidently about something it was never looking at.
- **The hard gates fail open by construction — 0/0 is a PASS, so always assert non-zero
  totals** (`compare.mjs` refuses a digest missing `melodySkeleton`/`harmony`; `smoke.mjs`
  asserts non-zero totals). See `docs/gate-templates.md` (the "0/0 covered/total is a
  trivial PASS" block) — §A.2 was the subtler form of this disease and is now fixed and
  pinned.
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
  rangeDeficit, partCount, pickup, sections[], duplicateRanges[], bars[], harmonicLoop,
  tieAudit, sourceProfile }`. `tieAudit` counts tie chains and their anomalies
  (microfragment chains, ties across silence, orphan continuations, and
  `intent.dropped` — tie-shaped tokens the parser silently turned into
  reattacks). `sourceProfile` is `{ kind: 'clean-notation'|'noisy-transcription',
  pitchedPerformanceGroups[], excludedTracks[], noiseSignals{} }` — the Gate A
  source-reliability evidence, computed structurally (never from track names).
  `harmonicLoop` is `{length, firstBar, passes[], coverage, cycle[]} | null` — when present
  it is a strong planning signal (plan one texture per pass, escalating toward the climax —
  see `reference/rock-riff-construction.md` → "Passes over a loop"); when null, the
  arranger reads the chord progression off the `source-map.md` bar table by hand. It is a
  detector, not a guarantee.
  Per-bar: `{ bar, sourceBarNumber, timeSig, tempo, tempoChanged, voices[], melodyVoice,
  bassVoice, melody[], melodySkeleton[], bass[], bassFolded[],
  harmony{root,quality,symbol,pcset}, harmonySpans[], foregroundEvidence[], flags[] }`
  (plus `pickup` on an anacrusis). `harmonySpans[]` is the additive WP2b field carrying
  **both** half-bar chords (`{root,quality,symbol,pcset}` each) — `compare.mjs` does not
  read it; it is contract surface for the bar map and any future finer gate. Durations
  are in **quarter-note beats**. `melodySkeleton` = structural notes only (strong beat
  OR ≥1 beat OR a contour turning point) — this is what the gate protects, and its
  strong beats are derived from the meter, not by halving the bar.
- **Melody/bass/skeleton are TIE-COALESCED; `voices[].notes` is the raw evidence.**
  A tie continuation is not an attack: it never becomes a melody/bass/skeleton event,
  and a chain head carries the chain's merged **sounding duration** (its own pitch's
  duration, never the group envelope). The raw fragments — every parsed note, with
  `tied`, `attack:false` on continuations, `tieChainId`, and `soundingBeats` +
  `notatedFragments` on heads — stay in `voices[].notes` untouched. Tie-free sources
  are byte-identical through both paths.
- **`foregroundEvidence[]` is the per-bar attack graph** (one gesture per raw onset,
  across every pitched voice): each gesture carries raw `onset` + `normalizedOnset`
  (sixteenth grid) + `displacement` + `normalizationConfidence`, its `notes[]` (each
  with its OWN tie-merged `duration`, track, voice), `maxEnvelopeDuration` (recorded
  separately so nothing assigns it to a pitch), `sounding[]` (pitches held over the
  onset), and `tuplet` only from real parsed tuplet metadata — an irregular offset is
  never classified as a tuplet. This is what `foreground.mjs` scores and what the
  melody contract's evidence checks read.
- **Noisy-transcription doctrine (Improve_Plan):** on a `sourceProfile.kind =
  noisy-transcription` source, `melodyVoice`/`melodySkeleton` are diagnostics, not
  perceptual truth — review `foreground-map.md`, lock a `melody-contract.json`
  (validated by `contract-validate.mjs`), and gate those spans with sidecar mode
  `contract`. `free` means added material, never "the extractor disagrees." The
  doctrine list lives in `docs/workflow.md` → "Doctrine for noisy transcriptions".

---

## The soft channel, and the rules for adding to it

`check.mjs --json` always emits **five** soft arrays (C4), in this order, whether
or not anything ran: `playability`, `compare`, `fingering`, `idiom`, `sidecar`.
An empty array means *the stage produced nothing*. A stage that could not run is
an operational failure — exit `2` — never an empty array.

* `soft.playability` keeps playability's **native** `{type, message, bar, …}`
  shape; it predates the advisory contract and C3 forbids retro-fitting it.
* The other four are C3 advisories: `{code, severity, message, track?, staff?,
  bar?, beat?, data?}`.
* `lead.*` rides in `soft.fingering` by design (addendum §A4) — same question,
  same hand, same CLI. A sixth soft key would break every consumer that
  feature-detects on the five.

Every code, its evidence fields, and what it is sensitive to lives in
**`docs/specs/advisory-reference.md`**. The ledger of which fixture proves each
one lives in **`docs/specs/wave6-advisory-coverage.md`**.

**Which knobs move which findings.** Style moves `idiom.low-density`,
`harmonic-flattening`, `sidecar.high-free-share` and `pick-demand.*`. Gain moves
`gain-voicing` and `harmonic-flattening`. Roles move `lead.string-leap`,
`compare.contour` and the **hard** melodic-skeleton gate. `--map` decides whether
you get the map-only advisories (`harmonic-flattening`, `sidecar.*`) or the
bar-locked-only ones (`compare.dropped-notes`, `compare.low-density`,
`compare.chord-quality`). **Nothing but roles ever moves a hard gate.**

### If you add or change a soft rule

1. **Both halves, always.** A triggering fixture *and* a non-triggering one. A
   corpus of positives proves only that the tools are loud. This is C11.6 and it
   is not negotiable.
2. **Assert the code, never the prose.** Wording is free to improve; a `code` is
   a promise. There is no prose assertion anywhere in the scenario corpus.
3. **Carry evidence.** Every C3 advisory needs a non-empty `data` object, and the
   scenario corpus can demand named fields inside it.
4. **Deduplicate to a region.** One root problem is one finding with an
   `occurrences` count, not fourteen lines. The corpus caps any one code at 4 per
   run; `sustain` and `compare.dropped-notes` are exempt because their repetition
   is per-bar *by contract* — a reader wants to know which bars.
5. **Prove it analysed something.** `0/0` is a PASS by construction, so a scenario
   states a `requiredStats` floor (`analyzers.idiom.stats.attackEvents`,
   `hard.playability.stats.notesAnalyzed`, …). A verdict over zero events is not
   evidence.
6. **Fixtures adapt to analyzers, not the reverse.** Never tune a threshold to
   make a corpus test pass. Changing one requires a musically credible false
   positive or negative, a minimal reproduction, a counterfixture proving the
   correction does not overgeneralize, and unchanged hard behaviour.

### The paired scenario corpus

`tools/fixtures/scenarios/manifest.json` drives real `check.mjs` runs through
`tools/lib/scenarios.test.mjs`. Every scenario belongs to exactly one **pair**,
and the pair declares the **one** dimension it varies:

| `variantAxis` | members share | members vary |
|---|---|---|
| `target` | source, map, style, gain, mode, roles, bars | the target tab |
| `style` | source, target, map, mode, roles, bars | the style profile |
| `map` | source, target, style, gain, mode, roles, bars | the sidecar |
| `roles` | source, target, map, style, gain, bars | lead / rhythm |
| `configuration` | source, target, map, style, bars | any other run flag |

The runner enforces that before `check.mjs` runs once. A pair that varies two
things at a time cannot attribute its own result, so it is a schema error rather
than a confusing advisory diff. `polarity` says what a member claims —
`positive` (stay quiet), `negative` (speak), `comparison` (neither; exists to be
diffed) — and every pair needs at least one positive and one non-positive.

`map: null` means bar-locked and must be **written**. An omitted key is a schema
error, so "I forgot the map" can never read as "I meant bar-locked".

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
├─ AGENTS.md        this file — the canonical, vendor-neutral orientation (read first)
├─ CLAUDE.md        thin pointer → AGENTS.md (Claude Code auto-loads it)
├─ README.md        human quickstart
├─ package.json     deps: @coderline/alphatab ONLY
├─ docs/            the vendor-neutral instruction set (any CLI reads these)
│   ├─ workflow.md          the gated procedure (Step 0 / Gate A / Gate B / Final)
│   ├─ gate-templates.md    copy-paste gate presentation templates
│   └─ specs/               the frozen contracts and the evidence behind them
│       ├─ upgrade-contracts.md        C1–C15, authoritative
│       ├─ wave3-6-addendum.md         A1–A6, what C1–C15 left open
│       ├─ advisory-reference.md       every soft finding, what it means
│       ├─ style-profile-reference.md  the four styles and what they weight
│       ├─ tooling.md                  per-tool detail
│       ├─ audio-rendering-decision.md why render-audio is optional
│       ├─ wave6-baseline.md           the state validation started from
│       ├─ wave6-advisory-coverage.md  the coverage ledger (every code, both halves)
│       └─ wave6-regression-lock.md    what may never change without a decision
├─ .claude/skills/piano-to-guitar/   SKILL.md — thin pointer → docs/workflow.md
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
│   │               piano-source.mjs (AT218 normalizer), analysis.mjs (the digest),
│   │               ties.mjs (tie chains), foreground.mjs (candidate scoring),
│   │               contract.mjs (melody-contract schema + validator),
│   │               advisory.mjs (the C3 soft-finding shape), sidecar.mjs (C8),
│   │               project-config.mjs (C5 precedence), pick-demand.mjs (C12),
│   │               fingering.mjs (phrase-level fingering DP + lead motion),
│   │               style-profile.mjs (C6 loader), idiom.mjs (idiom density),
│   │               harmonic-color.mjs (colour preservation),
│   │               sidecar-audit.mjs (C10 map metrics),
│   │               track-roles.mjs (A5 lead/rhythm views),
│   │               midi-export.mjs + audio-render.mjs (the audition path)
│   ├─ history.mjs  the per-project tab version store (PTG-native; wraps check.mjs)
│   ├─ fixtures/    song-neutral regression corpus (see tools/smoke.mjs)
│   │   └─ scenarios/manifest.json   the paired calibration corpus
│   ├─ regression-lock.test.mjs   the compatibility floor (see docs/specs/)
│   └─ smoke.mjs    end-to-end health check
├─ projects/        one folder per song — you work inside these. ALL song content is
│   │               LOCAL: everything under a <slug>/ is gitignored; only this README ships.
│   ├─ README.md               how a project folder is laid out (the only tracked file here)
│   └─ <slug>/                 one project folder per song (local; never committed)
│       ├─ source.alphatab        the piano source being arranged (often copyrighted; yours)
│       ├─ source.json            generated digest
│       ├─ source-map.md          generated bar map
│       ├─ cover.alphatab         the growing guitar tab (a derivative work; stays local)
│       ├─ sidecar.json           per-span mode map the gate reads (--map)
│       ├─ sessions.md            per-song verdict history (prose ledger)
│       ├─ history/               the local tab version store (log.jsonl + snapshots)
│       ├─ reference-*.alphatab   optional reference renders (audition aids)
│       └─ scratch/               scratch space for in-progress work
└─ out/             scratch dir for smoke.mjs (gitignored)
```

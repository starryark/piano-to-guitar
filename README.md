# Piano-to-guitar

Arrange a piano **AlphaTex** score into a **playable solo electric-guitar rock cover** in
**AlphaTex** — built chunk by chunk, with a human judging every chunk.

## The philosophy

The assistant is a **guitarist-arranger, not a transcriber.** The job is
**recomposition with a protected skeleton**: quoted spans protect the melody,
recomposed spans protect the root motion, and additions are first-class and named at the
gate — the cover adds material of its own, not just subtracts the source. Piano writing
that a single guitar physically cannot voice gets re-voiced as what a great cover keeps
— the singing melody and the harmonic bones — and re-metered into a guitar tempo and
groove. A **fidelity gate** enforces exactly that skeleton; every other departure is
*reported to you as information*, never treated as a defect. **You**, the human, audition
each chunk against a reference recording and decide whether it's good. No arrangement is
ever finalized without your ear on it.

This repo is a **toolchain, not a piece of music**. It ships no example arrangement on
purpose: every musical decision is derived from the source in front of you, never
inherited from a previous one.

**One language, one parser, one dependency.** The source piano score is stored in
AlphaTex directly — the same format the guitar tab is written in — so the whole
source-format machinery of the predecessor project (a second parser, MusicXML converters,
a Python runtime, a MuseScore normalizer) is gone. Node ESM plus `@coderline/alphatab`,
nothing else. The vendored gate tools are a snapshot from `abc-to-guitar@ba7e29c` (not a
live dependency); local edits are marked `// PTG:`. See `AGENTS.md` → "Vendoring
provenance" for detail.

**The band decision, stated honestly.** The guitar tab is the product. The source piano
is the *implied backing* — what the listener mentally fills in against the guitar — not a
part the guitar has to double. There is no separate backing render; the shipped artefact
is the guitar tab plus your verdict on it.

## Requirements

- **Node.js** (ESM) with the one dependency installed — `npm install`
  (`@coderline/alphatab` is the only entry in `dependencies`)
- Works on Windows (PowerShell or Bash), macOS, Linux
- **No Python.** Unlike the predecessor, there is no Python runtime in this project.

Verify the toolchain is healthy after cloning or changing anything in `tools/`:

```
npm ci        # clean install from the lockfile
npm test      # every unit + integration suite, including the paired scenario
              # corpus, the regression lock and the 200-bar scale suite —
              # each prints its own totals
npm run smoke # end-to-end run over tools/fixtures/ — expects SMOKE: PASS
```

`npm run perf` is a fourth, optional command: stage-by-stage timings over the
scale fixture. It is a **report and asserts nothing** — a wall-clock threshold
passes on a quiet laptop and fails on a busy CI runner, so the scaling claims
that are actually enforced are counts and bytes in `tools/scale.test.mjs`.
Observed numbers and what they mean: `docs/specs/wave6-performance.md`.

## Arranging a piece

Each song lives in its own folder under `projects/<slug>/`, with standardized filenames so
every command is identical across projects. Create `projects/<slug>/` and drop your piano
AlphaTex export in as `source.alphatab`, then:

**Step 0 — Ingest.** Validate the source, extract the digest, audition the source.
```
node tools/piano-validate.mjs projects/<slug>/source.alphatab                    # exit 0; reports AT218 rewrites, flags a lying \ks
node tools/piano-extract.mjs  projects/<slug>/source.alphatab --out projects/<slug>   # writes source.json + source-map.md
# Audition: open projects/<slug>/source.alphatab in VS Code (alphaTab extension) and play it
```
Read `projects/<slug>/source-map.md` (the human-readable bar map), not the raw AlphaTex file,
and establish the source's properties from it — key, meter changes, range, which voice
carries the melody, repeats, encoding, and whether the declared `\ks` agrees with the
sounding key. `AGENTS.md` has the checklist; `reference/piano-to-guitar-arranging.md` →
"AlphaTex piano-export hazards" has the one-line checks worth running on every new file.

**Gate A — Plan.** The assistant proposes the arrangement plan — register, gain, tuning /
transpose, **style**, **solo or dual guitar**, **target tempo, groove, and form** (the
section sequence with per-span mode `free` / `quote` / `recompose`) — and you sign off
before any tab is written. Tempo, groove and form are *decisions* at this gate, not
inheritances from the source.

**Style** picks the weights the soft advisories grade against — `hard-rock` (the default),
`metal`, `blues`, `jazz`. It is **soft policy only**: a style can change the advice you
get and can never change a hard gate result. Jazz is not penalised for lacking metal
techniques, and metal is not penalised for omitting low-register thirds, because each
style weights what it actually values. See `docs/specs/style-profile-reference.md`.

**Solo is the default.** A second guitar is opt-in: pass
`--arrangement-mode dual-guitar --lead 0 --rhythm 1` and the gate grades the melodic
skeleton against the **lead** track only, root motion against both, and mechanics against
each part independently. Roles are never inferred — declaring nothing keeps you in solo,
so a two-track score does not silently become a duet.

**Gate B — Per chunk (the loop).** For each chunk the assistant declares the span's map
entry (mode + source-bar tie-in), writes the tab bars into `projects/<slug>/cover.alphatab`,
then runs the one gate command until it passes (from inside the project folder):
```
cd projects/<slug>
# THE gate command (recomposition-aware, with a span sidecar):
node ../../tools/history.mjs check cover.alphatab --map sidecar.json --bars 1-<last>
# debugging fallback only (bar-locked 1:1, no sidecar):
node ../../tools/check.mjs cover.alphatab --bars 9-16
```
`history.mjs check` **wraps** `check.mjs` (the gate engine) — same report, same exit code —
and additionally snapshots every gated iteration of the tab into `projects/<slug>/history/`,
so no version is ever lost. Compare any two takes with `history.mjs diff`, and revert
non-destructively with `history.mjs restore`. Record each human verdict with
`history.mjs verdict <APPROVED|REVISE:tag>`.
`check.mjs` is the **heartbeat**: it runs syntax + bar-fill validation, the playability
check, and the fidelity gate, prints one report, and exits nonzero if any **hard** gate
fails. Only after it passes does the assistant present the chunk — you open
`projects/<slug>/cover.alphatab` in VS Code (alphaTab extension), A/B it against the source
opened the same way, and give a verdict. Repeat until the chunk is approved, then move
to the next.

The span sidecar is **mandatory, not optional**: a cover expands 2–4× (the corpus's
57-bar source became a 210-bar tab), so source and tab bar numbers do not line up and a
bar-locked 1:1 gate is useless for real work. `--bars N-M` is required on every run (it
scopes the tab range); `--map <sidecar>` selects correspondence-aware MODE and is what
makes the gate work for a cover. Dropping `--map` drops you into the bar-locked debugging
fallback.

The digest (`source.json`) sits next to the tab, so `check.mjs` resolves it automatically —
no `--digest` needed when you run from inside the project folder.

**Audition beyond the editor.** Export the tab to MIDI for a DAW or amp sim — this is the
path to hearing it with a real guitar tone, because MIDI carries **notes, not tone**:
```
node tools/export-midi.mjs projects/<slug>/cover.alphatab --out cover.mid
```
It refuses to write over the source even with `--force`, makes overwrite opt-in, and
writes atomically, so a crash leaves the old file or no file — never a truncated one a DAW
will cheerfully open. A dual-guitar arrangement arrives as two MIDI tracks. There is also
an optional offline WAV render (`tools/render-audio.mjs`) that is useful for phrasing,
form and tempo and **useless for tone**; it says so on every run.

**Final — Assemble.** The approved chunks are stitched into the complete tab and given
one last full-length `check.mjs` + audition.

### The one command to remember
```
cd projects/<slug> && node ../../tools/history.mjs check cover.alphatab --map sidecar.json --bars 1-<last> [--transpose N] [--gain high|crunch|clean] [--style hard-rock|metal|blues|jazz]
```
(`history.mjs check` runs the `check.mjs` gate and versions the result; run bare `check.mjs`
only for the `--bars`-only debugging fallback.)
(`source.json` auto-resolves next to `cover.alphatab`; pass `--digest <path>` only to override.)

**Exit `0`** = no hard failure, **`1`** = a hard gate failed, **`2`** = malformed input,
bad configuration or an operational failure. `--map` switches the gate into per-span mode:
`quote` spans enforce in-order skeleton + root motion, `recompose` spans enforce root
motion only, `free` spans (added material) enforce nothing. `--transpose N` means the tab
is written N semitones above the source — derive N from the key you chose at Gate A.

### Hard versus soft

**Hard** findings fail the gate and exit `1`: syntax and bar-fill errors, mechanical
impossibilities (an unreachable grip, a 3-note non-adjacent attack, a fret that does not
exist, a broken tie), and the fidelity gate's melodic-skeleton / harmonic-root / melody-
contract obligations.

**Soft** findings never fail anything. They are questions addressed to the arranger, and
the arranger owns the answer — fingering suggestions, guitar-idiom density, harmonic
colour loss, sidecar proportion, pick demand, gain-aware voicing, reduction density,
dropped notes, chord quality, contour. `check.mjs --json` groups them under five keys
(`playability`, `compare`, `fingering`, `idiom`, `sidecar`), always present, always arrays.

A passing arrangement should produce **few enough findings to read** — the calibration
corpus enforces at most 12, and at most 4 of any one code. If you see more, something is
miscalibrated; say so rather than working around it. Every code is documented in
`docs/specs/advisory-reference.md`. `--warnings-as-errors` is the opt-in route to a
zero-warning policy.

### Project configuration

Drop a `config.json` next to the tab (`projects/<slug>/config.json`) to state the
instrument and the defaults for that song — fret count, string count, style, gain. One
precedence rule everywhere: **CLI flag > nearest `config.json` > built-in default**
(22 frets, 6 strings, `hard-rock`, `high` gain, `solo`). `check.mjs --json` reports a
`provenance` map saying *why* each resolved value is what it is. A `--policy
guitar-policy.json` is a different question and both stay in force: the instrument limit
says the fret does not exist; the project policy says you chose not to go there.

## What lives where

```
projects/<slug>/   one folder per song — ALL of it local/gitignored (a source is often
                   copyrighted and a cover is a derivative of it). Holds source.alphatab,
                   source.json, source-map.md, cover.alphatab, sidecar.json, sessions.md,
                   history/ (the local tab version store), scratch/. Only projects/README.md
                   (the layout scaffold) is tracked.
AGENTS.md    the canonical, vendor-neutral orientation every coding-agent CLI reads first
docs/        the vendor-neutral workflow (workflow.md) + gate templates (gate-templates.md)
reference/   the craft library the assistant reads to arrange
tools/       the gate tools + history.mjs (tab version store) + tools/lib helpers + fixtures + smoke.mjs
out/         scratch dir for smoke.mjs (gitignored)
CanonRock/   the corpus — READ-ONLY, never write to it
.claude/skills/piano-to-guitar/   a thin Claude Code skill that points at docs/workflow.md
```

## Hard-won learnings (read before arranging)

These are seeded from the measured corpus facts (pinned by passing tests in
`tools/lib/analysis.test.mjs` and `tools/smoke.mjs`) — measured three times by
independent parties, not asserted.

- **No transposition in this corpus.** All six files are **D major / B minor** — none
  transposes. Do not inherit a key change from a previous arrangement; derive the key from
  the source's own pitch content. If you propose a transposition, argue it from the
  fretboard, not from CanonRock. `reference/piano-to-guitar-arranging.md` → "Transposition
  procedure" is general craft, not corpus-derived.
- **The declared `\ks` lies.** `Canon Rock 1` declares `\ks c` while sounding in D. Always
  derive the key from pitch content (`key` / `keyConfidence` in the digest), never from the
  declared `keyDeclared`. The extractor reports the disagreement as `keyDisagrees`.
- **Two chords per bar.** The source is a strict chaconne — a 4-bar loop
  (`D | A Bm | F#m G | D G | A`) with **two chords per bar** at half-bar resolution. The
  digest's `harmony` reflects the *primary* half-bar chord and `harmonySpans[]` carries
  both; read the bar map, not your intuition about one-chord-per-bar.
- **Playability is a hard constraint.** A struck dyad on *non-adjacent* strings is
  unplayable with a pick; `playability.mjs` catches it (`non-adjacent-strings` fires
  unless the beat carries a brush `{bd}`/`{bu}` or arpeggio `{au}`/`{ad}`). The real corpus
  tabs obey this (74 multi-note attacks, max 4 notes, zero non-adjacent pairs). Arpeggiate
  rolls as single notes and keep fast runs at full resolution.
  `reference/guitar-playability.md` → "What the tools check, and what they do not".
- **The fidelity gate was once vacuous — now fixed.** WP2b narrowed per-bar `harmony.pcset`
  to the primary half-bar's harmonic stratum (mean width **6.33 → 2.65**, 0 bars at 7 pcs)
  and pinned the bound with a test that fails if it re-widens; a suspiciously clean PASS on
  a wide pcset is a failure, not a pass. `AGENTS.md` §A.2.
- **The hard gates fail open — 0/0 is a PASS, so always assert non-zero totals** (a
  suspiciously clean `0/0` means the digest lost a field, not that the tab is perfect). See
  `docs/gate-templates.md`.
- **Not every note is played** — the job is recomposition with a protected skeleton:
  `quote` spans protect melody, `recompose` spans protect root motion, `free` spans are
  added material named at the gate. Name every deliberate loss *and* every deliberate
  addition at the gate; chase none of the soft numbers.

## For the details

- **`AGENTS.md`** — the canonical, vendor-neutral orientation every coding-agent CLI reads
  first: the two resolved hazards (AT218, the vacuous-gate fix), the measured corpus facts,
  the Step 0 checklist, the full tool table with exit contracts, and the digest-JSON contract.
  (`CLAUDE.md` is a thin pointer to it, so Claude Code loads the same instructions.)
- **`docs/workflow.md`** — the step-by-step gated arrangement workflow (Step 0 → Gate A →
  Gate B → Final), with copy-paste presentation blocks in **`docs/gate-templates.md`**.
- **`reference/`** — the craft library: AlphaTex language and piano reading,
  electric-guitar voice, rock-riff construction, piano-to-guitar arranging, fretboard,
  playability, theory, tunings, and the Canon Rock case study.
- **`docs/specs/`** — the frozen contracts and the evidence behind them:
  `advisory-reference.md` (every soft finding, what it means, what it is sensitive to),
  `style-profile-reference.md` (the four styles and what each weights),
  `upgrade-contracts.md` + `wave3-6-addendum.md` (C1–C15 and A1–A6),
  `wave6-advisory-coverage.md` (which fixture proves each code, both halves),
  `wave6-regression-lock.md` (what may never change without a decision).
- **`tools/fixtures/` + `tools/smoke.mjs`** — the regression corpus. Every fixture is named
  for what it tests and its contract is enforced by the smoke runner, not by a comment.
  `tools/fixtures/scenarios/manifest.json` is the **paired calibration corpus**: each
  scenario belongs to a pair that declares the one dimension it varies, so a difference in
  the advice can only come from that dimension.

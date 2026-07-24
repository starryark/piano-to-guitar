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
npm test      # fretboard + analysis + piano-source unit suites
npm run smoke # end-to-end run over tools/fixtures/ — expects SMOKE: PASS
```

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
transpose, **target tempo, groove, and form** (the section sequence with per-span mode
`free` / `quote` / `recompose`) — and you sign off before any tab is written. Tempo,
groove and form are *decisions* at this gate, not inheritances from the source.

**Gate B — Per chunk (the loop).** For each chunk the assistant declares the span's map
entry (mode + source-bar tie-in), writes the tab bars into `projects/<slug>/cover.alphatab`,
then runs the one gate command until it passes (from inside the project folder):
```
cd projects/<slug>
# THE gate command (recomposition-aware, with a span sidecar):
node ../../tools/check.mjs cover.alphatab --map sidecar.json --bars 1-<last>
# debugging fallback only (bar-locked 1:1, no sidecar):
node ../../tools/check.mjs cover.alphatab --bars 9-16
```
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

**Final — Assemble.** The approved chunks are stitched into the complete tab and given
one last full-length `check.mjs` + audition.

### The one command to remember
```
cd projects/<slug> && node ../../tools/check.mjs cover.alphatab --map sidecar.json --bars 1-<last> [--transpose N] [--gain high|crunch|clean]
```
(`source.json` auto-resolves next to `cover.alphatab`; pass `--digest <path>` only to override.)
Exit `0` = no hard failure, `1` = a hard gate failed, `2` = usage / IO error. Soft
findings (tone advisories, reduction density, dropped notes, chord quality, contour) are
printed but never fail the gate. `--map` switches the gate into per-span mode: `quote`
spans enforce in-order skeleton + root motion, `recompose` spans enforce root motion
only, `free` spans (added material) enforce nothing. `--transpose N` means the tab is
written N semitones above the source — derive N from the key you chose at Gate A.

## What lives where

```
projects/<slug>/   one folder per song — ALL of it local/gitignored (a source is often
                   copyrighted and a cover is a derivative of it). Holds source.alphatab,
                   source.json, source-map.md, cover.alphatab, sidecar.json, sessions.md,
                   scratch/. Only projects/README.md (the layout scaffold) is tracked.
AGENTS.md    the canonical, vendor-neutral orientation every coding-agent CLI reads first
docs/        the vendor-neutral workflow (workflow.md) + gate templates (gate-templates.md)
reference/   the craft library the assistant reads to arrange
tools/       the gate tools + tools/lib helpers + tools/fixtures + smoke.mjs
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
- **`tools/fixtures/` + `tools/smoke.mjs`** — the regression corpus. Every fixture is named
  for what it tests and its contract is enforced by the smoke runner, not by a comment.

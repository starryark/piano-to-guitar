# Wave 6 regression lock — what may never change without a decision

The behaviours below are **compatibility-sensitive**: an existing project, an
existing gate report, or an existing habit depends on each one. They are not
frozen because they are optimal; they are frozen because changing one silently
would move somebody's music without telling them.

`tools/regression-lock.test.mjs` is this document executed. If you intend to
change a row here, change the test in the same commit and say why in the message.

---

## Exit-code semantics (C7)

One code, one meaning. The historical defect this guards: `playability.mjs` used
to exit `1` on **either** `errors[]` or `warnings[]`, which made its exit code
useless for automation — a run could not distinguish "your tab is unplayable"
from "here is something to think about".

| Exit | Means | Pinned by |
|---|---|---|
| `0` | The run succeeded. Advisories may be present; they never gate. | mapped cover passes; a warning-only playability run |
| `1` | A **hard** musical or mechanical gate failed. | bar-locked 1:1 against a cover; a non-adjacent 3-note grip; a tab that fails `validate --strict` |
| `2` | Malformed input, invalid configuration, parser failure, operational failure. | no args; missing `--bars`; unparseable `--bars`; missing tab; missing digest; unknown `--style`; `--arrangement-mode dual-guitar` with no roles; a track claimed as both lead and rhythm |

A soft-only run of `fingering`, `idiom` and `sidecar-audit` exits `0` and still
serialises its advisories.

## Defaults (C5 / C6 / A1 / A5)

| Behaviour | Value | Why it is sensitive |
|---|---|---|
| Style, with nothing configured | `hard-rock` | C6 binds it: hard-rock must reproduce today's behavior for every existing fixture |
| Gain, with nothing configured | `high` | A1.1 — `gain-voicing` fires only at `high`, so a different default would silently delete a finding on every default run |
| Arrangement mode | `solo` | Dual-guitar is opt-in. Absence of role flags must never select dual mode |
| Rhythm tracks in solo | `[]` | A5 |
| Instrument | 22 frets, 6 strings | C5's built-in floor, below `config.json`, below `--max-fret` |
| `--style hard-rock` vs no `--style` | bit-identical `hard` **and** `soft` | if these diverge, "hard-rock is the default" has stopped being true |
| Any `--style` | bit-identical `hard` | a style profile is soft policy and may never move a hard gate |

`configuration.provenance` is *expected* to differ between an implicit and an
explicit default — recording where a value came from is its entire job.

## Anti-vacuity — a PASS must have graded something

The hard gates **fail open by construction**: 0 of 0 covered is a PASS. So every
assertion that a gate passed is paired with an assertion that it had something to
grade. `0/0` is not evidence, and a suite that accepts it is testing nothing.

| Path | Non-zero datum required |
|---|---|
| Bar-locked compare | `hardGates.melodicSkeleton.total`, `hardGates.harmonicRoots.total` |
| Map-mode compare | `mapResults.length`, `melodySkeletonSpace.total`, `tabSpace.totalTabBars` |
| Contract span | at least one `contract`/`contract-recompose` entry, all `ok` |
| Playability, any run | `stats.notesAnalyzed`, `stats.beatsAnalyzed` |
| Every scenario in the corpus | the same two playability stats (`tools/lib/scenarios.test.mjs`) |

## The §A.2 pitch-class-set narrowing

The project's blocking defect was a `harmony.pcset` merged across the whole bar:
mean width **6.33 of 12**, 32 of 57 bars sitting on the full D-major scale, so a
random diatonic note satisfied the harmonic gate about **53%** of the time. The
gate reported PASS while protecting almost nothing.

**Frozen:**

* mean `harmony.pcset` width **≤ 4.0**;
* **zero** bars at 7 or more pitch classes;
* `harmony.root` remains the whole-bar lowest sounding pitch class, serialized as
  a note name — the defect was *width*, never root accuracy;
* the chaconne bass line is exactly `A F# D G A F# D G …`;
* `harmonySpans[]` still carries **both** half-bar chords. The narrowing moved the
  detail; it did not delete it. A `harmonySpans` that vanished would turn a
  re-windowing into a loss of information.

**The live anti-acceptance signal:** a suspiciously clean PASS over a wide pcset
is a failure even at exit `0`. Do not widen the pcset back, and do not re-tune the
chord table — the table was never the problem, the window was.

## No analysis command writes to what it reads (C15)

Analysis reads; it does not write. A tool that starts rewriting the score is the
most destructive regression this project could ship, and the arranger would
discover it by losing work.

Every one of these is run against real inputs, and every input file — tabs,
sources, sidecars, contracts, policies **and** digests — is compared byte for byte
afterwards:

`validate`, `playability`, `compare`, `check` (bar-locked, map, contract and
dual-guitar modes), `fingering`, `idiom`, `sidecar-audit`, `tab-events`,
`piano-validate`, `source-profile`, `contract-validate`, `foreground`,
`export-midi`.

Separately: **`export-midi` refuses to write over the source with or without
`--force`**, and exits `2` when asked to. Overwriting a score with its own MIDI
render is unrecoverable, so `--force` must not reach that path.

## Deterministic output (A6)

Two runs of the same command produce byte-identical stdout. Pinned across a
matrix rather than one command, because determinism is a property of the whole
emission path and each analyzer sorts its own arrays:

`check` bar-locked · `check` map-mode · `check` dual-guitar · `check` jazz ·
`playability` · `fingering` · `idiom` · `sidecar-audit` · `compare`.

Every scenario in the corpus is additionally run twice and diffed
(`tools/lib/scenarios.test.mjs`), and `tools/smoke.mjs` compares two full-gate
runs.

---

## Where each guarantee lives

| Guarantee | File |
|---|---|
| Exit codes, defaults, anti-vacuity, §A.2, determinism matrix, C15 sweep | `tools/regression-lock.test.mjs` |
| Behaviour at length: linear retention, bounded riff keys, advisory dedup across the whole run, determinism at 200 bars | `tools/scale.test.mjs` (see `docs/specs/wave6-performance.md`) |
| Per-scenario expectations, pair invariants, advisory budgets | `tools/lib/scenarios.test.mjs` |
| Configuration resolution and provenance, soft-key shape (C4) | `tools/check.test.mjs` |
| Hard mechanical findings, gain/policy advisories, exit semantics per finding | `tools/playability.test.mjs` |
| pcset width bound at the library level | `tools/lib/analysis.test.mjs` |
| End-to-end toolchain health, 21 checks | `tools/smoke.mjs` |

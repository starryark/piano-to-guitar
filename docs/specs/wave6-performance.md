# Wave 6 §10.4 — performance and scale, observed

Plan.md §10.4 asks for four things. Two of them — the full command matrix and
the determinism checks — shipped with the rest of Wave 6 and live in
`tools/regression-lock.test.mjs` and `docs/specs/wave6-regression-lock.md`.
The other two, **performance measurement** and a **memory-and-scale fixture**,
are this document.

Everything below was run, not predicted.

| | |
|---|---|
| Environment | Windows 11 Pro 10.0.26200, Node v24.14.0, npm 11.12.1 |
| Fixture | `tools/fixtures/scale/` — 192 source bars → 200 tab bars, 2 tracks |
| Harness | `npm run perf` (report), `tools/scale.test.mjs` (gate) |

---

## The fixture, and why it is generated

`tools/fixtures/scale/` is the only fixture in this repo that cannot be read.
Everything else here is a handful of bars, because a handful of bars is what it
takes to prove a rule; the four failure modes §10.4 names — excessive event
retention, large canonical riff keys, recursive traversal problems, advisory
explosions — cannot appear at that size.

So it is **derived**, and `tools/fixtures/scale/generate.mjs` is the derivation:
a four-bar i–VI–III–VII loop in A minor, repeated, quoted for 128 bars,
recomposed for 64, plus an 8-bar free outro. A reviewer reads ~150 lines of
intent instead of 400 bars of AlphaTex, and `scale.test.mjs` re-runs the
generator in memory and byte-compares it against the checked-in files — so a
hand-edit to the `.alphatab` is a test failure rather than a silent divergence
between a fixture and its story.

Nothing in it is quoted from CanonRock or any real piece. It is song-neutral by
construction, and its only jobs are to be long and to be analysable.

**One detail is load-bearing.** The loop's fourth bar ends in a rest. A phrase
ends at a rest or after a note ≥ 2 beats, so a 200-bar line with neither is
*one* phrase — and the first draft of this fixture had neither. See "What the
scale fixture found" below; that draft is how the defect surfaced.

## Stage timings

`npm run perf`, 5 runs per stage, min / median / max in milliseconds:

| Stage | min | median | max |
|---|---|---|---|
| node startup (baseline) | 36.4 | 38.1 | 39.9 |
| `piano-extract` (parse + digest) | 193.5 | 205.7 | 207.5 |
| `validate --strict` | 143.8 | 144.3 | 146.7 |
| `playability` | 186.6 | 192.8 | 202.7 |
| `compare` (map mode) | 180.4 | 184.7 | 190.1 |
| `fingering` | 222.4 | 223.2 | 224.6 |
| `idiom` | 167.9 | 171.0 | 175.9 |
| `sidecar-audit` | 116.5 | 119.2 | 120.5 |
| **`check.mjs` (the full gate)** | **1094.7** | 1103.0 | 1112.4 |

Read the baseline row first: every other row contains it. `sidecar-audit` does
its whole job in ~80 ms of actual work; the rest is an interpreter starting.

**Nothing here is a threshold, and none of it is asserted.** A wall-clock
assertion inside `npm test` fails on a loaded CI runner and passes on a quiet
laptop, which trains a reader to ignore red. The scaling claims that *are*
asserted are counts and bytes (below), and they are identical on every machine.

### The one number worth acting on, and the reason not to yet

The gate's six stages sum to **1017.6 ms** run individually; `check.mjs` takes
**1094.7 ms**. The gate is therefore almost entirely six interpreter starts and
six re-parses of the same tab — the analysis itself is close to free.

Plan.md §10.4 anticipated exactly this and set the condition: *"A later
optimization may introduce an in-process shared parsed score, but only after
behavior is stable and subprocess compatibility tests exist."* The second half
is not met — the subprocess boundary is not an implementation detail here, it is
what the tests exercise. `regression-lock.test.mjs` asserts exit codes at the
process boundary, `scale.test.mjs` and `smoke.mjs` diff stdout byte for byte,
and the scenario corpus deliberately runs `check.mjs` the way a human types it
(`docs/specs/wave6-acceptance.md`). Collapsing the stages in-process would
delete the thing under test to save 900 ms on a command a human runs a few times
per chunk.

The cost is also **bounded and flat**: it is paid per *stage*, never per bar.
Widening the analysis window 8× (`--bars 1-25` → `1-200`) moved the full gate
from 1043 ms to 1241 ms — under 20% for eight times the material.

### The other hazards §10.4 named

* **Repeated profile file reads.** `loadStyleProfile` reads its JSON once per
  process. With six subprocesses that is six reads of a small file, inside the
  startup cost already accounted for above. Nothing re-reads within a process.
* **Accidental quadratic comparison of long event lists.** Not observed — see
  the digest-growth table, and the `--bars` scaling above.
* **Unbounded riff-cell combinations.** `findRiffCells` slides a fixed
  `RIFF_CELL_EVENTS`-wide window, so the number of windows is linear in attacks
  and each canonical key is bounded by the window, not the score. Measured:
  1820 attacks → 44 cells. Asserted in `scale.test.mjs`.

## Retention, measured in bytes

The digest keeps every parsed note as raw evidence (`voices[].notes`) *plus* the
derived melody/bass/skeleton views. That is a deliberate contract, and it is
also the shape that hides a quadratic: one bar retaining something about every
other bar costs nothing at 8 bars and megabytes at 200.

Bytes per bar is the tell — flat is linear, climbing is quadratic:

| source bars | notes | bytes | per bar | per note |
|---|---|---|---|---|
| 24 | 114 | 125,984 | 5,249 | 1,105 |
| 48 | 228 | 249,338 | 5,195 | 1,094 |
| 96 | 456 | 496,046 | 5,167 | 1,088 |
| 192 | 912 | 989,700 | 5,155 | 1,085 |

Across an 8× length range, per-bar cost moves **1.8%**, and it moves *downward*
(the fixed header amortising). `scale.test.mjs` fails if that ratio exceeds
1.15; a quadratic would arrive at 8×, not 1.02×.

**~1.1 kB per note is heavy in absolute terms** and is recorded here as a
measured fact rather than a defect: it buys the raw-evidence contract the
noisy-transcription workflow depends on (`foregroundEvidence[]`, tie chains,
per-fragment provenance). A 200-bar piano source produces a ~1 MB digest, which
is a file, not a problem. It is worth revisiting only if a source arrives an
order of magnitude longer than anything this toolchain has seen.

## What the scale fixture found

Two things, neither visible at eight bars.

### 1. `fingering.better-fingering` did not deduplicate across phrases — FIXED

`tools/lib/fingering.mjs` states the doctrine twice in its own comments, and
AGENTS.md states it as a rule: *one root problem is one finding with an
`occurrences` count, not fourteen lines.* `locatedAdvisories` implemented it —
**within a phrase**. The headline advisory never did, because no fixture had
ever contained two phrases with the same problem in them.

At 200 bars the lead line segments into ~50 four-bar phrases posing the
identical question. The analyzer emitted **32 advisories** identical in every
field but `phrase` and `bars`: same reason, same 7.5 → 5.4 hand cost, same 7
notes moved.

Fixed by `collapseAcrossPhrases` in `tools/lib/fingering.mjs`: a problem's
identity is its `data` minus where it happened, matching advisories collapse
into the first, and `data.occurrences` carries the count. **32 → 1.** No
threshold moved, no hard result changed, and the whole suite plus smoke stayed
green.

The payload deliberately stays O(1). Collapsing 32 advisories into one that
carries a 32-element `bars` array would be the same growth wearing a better hat
— at 2000 bars it is a 300-element array inside a "deduplicated" finding.
`occurrences` is a number, and a number does not grow. `scale.test.mjs` asserts
no advisory's `data` carries an array longer than 16.

### 2. Playability's native warnings scale per place — pinned, not changed

The same run produced 17 `position-jump-slow` warnings over 2,620 notes. Those
are **not** C3 advisories: `soft.playability` keeps playability's native shape
and C3 forbids retro-fitting it, so the dedup rule above does not reach them.

The rule that does apply is that their growth tracks *places*, not notes, and it
holds: 17 warnings, 17 distinct bars, no bar named twice. `scale.test.mjs` pins
that shape — distinct bars, count bounded by bar count, and at least 20 notes
analysed per warning emitted — so a change here has to be a decision.

Whether a reader wants 17 lines or one line carrying `occurrences: 17` is a real
question about playability's native shape. It is deliberately not answered here:
it would change the shape of a soft channel that predates the advisory contract,
and that is a contract decision, not a validation one.

## What `scale.test.mjs` asserts

Eleven claims, none of them timed:

| Claim | Guards |
|---|---|
| the checked-in fixture is exactly `generate.mjs`'s output | the fixture and its documented intent cannot diverge |
| the fixture is 200 bars, 2 tracks, > 2000 notes | a "scale" fixture that is not at scale tests nothing |
| digest bytes per bar stay flat across 24→192 bars | excessive event retention |
| riff keys bounded by the window; recurrence collapses | large canonical riff keys |
| no C3 advisory code exceeds 4 per run at 200 bars | advisory explosions |
| a repeated problem is ONE finding with `occurrences`, and no `data` array exceeds 16 entries | advisory explosions, in both forms |
| native playability warnings name distinct bars | per-place growth, not per-note |
| the gate exits 0 with all 4 spans graded and no runtime error on stderr | recursive traversal |
| a 1-64 window is a strict subset of the 1-200 window | `--bars` still scopes at length |
| two full-length runs are byte-identical | determinism (A6) survives length |
| MIDI export writes ≥ 2 tracks and leaves no temp file | the export path at length |

Cost: **4.5 s**, one full extraction and three gate runs. It is the cheapest
suite in `npm test` after the meta-tests.

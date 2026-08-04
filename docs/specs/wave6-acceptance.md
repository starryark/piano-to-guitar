# Wave 6 acceptance — observed results

Everything below was run, not predicted. Compare against
`docs/specs/wave6-baseline.md` for the state Wave 6 started from.

| | |
|---|---|
| Starting commit | `d5cfd36` |
| Branch | `agent/w6-completion` |
| Environment | Windows 11 Pro 10.0.26200, Node v24.14.0, npm 11.12.1 |

## Clean install

| Command | Exit | Wall clock |
|---|---|---|
| `npm ci` (after deleting `node_modules/`) | 0 | 1.1 s |
| `npm test` | 0 | 121.8 s, **23 suites** |
| `npm run smoke` | 0 | `SMOKE: PASS (21 checks)` |
| `npm run smoke` again | 0 | stdout **byte-identical** to the first run |
| `git status --short` | clean apart from the intended new files | — |
| `git diff --check` vs `d5cfd36` | clean | — |

`npm test` is **faster than the baseline** — 121.8 s for 23 suites against
163 s for 21 — because the scenario runner's execution cache freed more time than
the two new suites cost.

## Representative direct commands

Each was run and its exit code checked against the documented contract.

| Command | Expected | Observed |
|---|---|---|
| default solo check (no flags) | 0 | 0 |
| explicit `--style hard-rock` | 0 | 0 |
| `--style jazz` | 0 | 0 |
| `--style metal` | 0 | 0 |
| `--style blues` | 0 | 0 |
| map mode | 0 | 0 |
| bar-locked, shell tab 1:1 | 0 | 0 |
| bar-locked, flattened tab | 1 | 1 |
| dual-guitar, correct roles | 0 | 0 |
| dual-guitar, roles swapped | 1 | 1 |
| `fingering.mjs` | 0 | 0 |
| `idiom.mjs` | 0 | 0 |
| `sidecar-audit.mjs` | 0 | 0 |
| `export-midi.mjs` | 0 | 0 (535-byte `.mid`) |

## Dependencies

`git diff d5cfd36 -- package.json package-lock.json` touches **only** the `test`
script. `npm ls --depth=0` reports exactly one dependency:

```
piano-to-guitar@1.0.0
`-- @coderline/alphatab@1.8.4
```

No runtime dependency added, no development dependency added, no second parser,
no second MIDI implementation, `package-lock.json` unchanged.

## Adversarial verification

**32 manifest mutations**, all rejected (`tools/scenario-harness.test.mjs`, 208 ms) —
19 schema cases and 13 pair-invariant cases, plus a control asserting the real
manifest passes both so a blanket failure cannot masquerade as 32 rejections.

**9 mutations against real fixtures and profiles**, all caught by the corpus:

| Mutation | Caught by |
|---|---|
| removed a required advisory expectation | `jazz-flattened-negative` |
| forbade an advisory that legitimately fires | `metal-literal-negative` |
| swapped the roles on the *correct* scenario | both role scenarios + the solo-compatibility invariant |
| changed a calibrated style (metal → jazz) | both metal scenarios |
| swapped a sidecar map | pair invariant **and** `sidecar-responsible` |
| raised `freeSpanWarnShare` to 0.99 | `sidecar-excessively-free` |
| disabled `harmonicColor` for hard-rock | `flattened-under-hard-rock` |
| dropped metal's `warnBelow` to 9.9 | `metal-riff-positive` |
| overwrote the blues positive fixture with the negative | `blues-lead-positive` |

Working tree restored after every case. These are a review log, not a suite —
re-running them costs ~8 minutes and re-proves what the 208 ms meta-test already
covers structurally.

## Corpus and coverage

| | |
|---|---|
| Scenarios | 14 (was 11) |
| Pairs | 7 |
| Variant axes represented | `target`, `style`, `map`, `roles` |
| Styles represented | hard-rock, metal, blues, jazz |
| Advisory codes inventoried | 20 (14 C3 advisories + 6 native playability warnings) |
| Codes with positive coverage | 20 |
| Codes with negative coverage | 20 |
| Codes with **no** coverage at the Wave 6 baseline | 5 — now all covered |

## §10.4 performance and scale — added after the table above

The matrix and determinism halves of Plan.md §10.4 shipped with the rest of
Wave 6. The **performance measurement** and **memory-and-scale fixture** halves
did not, and were completed afterwards on this branch:
`tools/fixtures/scale/` (192 source bars → 200 tab bars, 2 tracks, generated),
`tools/scale.test.mjs` (11 claims, 4.5 s, no wall-clock assertions) and
`npm run perf` (a report). Full detail, including the two things the fixture
found, is in **`docs/specs/wave6-performance.md`**.

Re-measured with it in place: `npm test` exits `0` in **116.9 s across 24
suites**, `npm run smoke` still `SMOKE: PASS (21 checks)`. Still one
dependency, `package-lock.json` still untouched.

One defect was fixed as a result — `fingering.better-fingering` emitted 32
identical advisories over 200 bars because its dedup was per-phrase rather than
per-run. This is not a threshold change: no threshold moved, no hard result
changed, and the fix implements a rule AGENTS.md and `fingering.mjs`'s own
comments already stated.

## Platform verification

**Verified:** Windows 11 / Node 24.14.0, the environment above.

**Not yet verified:** macOS and Linux, and Node 22. The README has claimed
"Windows, macOS, Linux" throughout, and until Wave 6 that was an assertion rather
than a result. `.github/workflows/ci.yml` was added to test exactly that claim —
3 operating systems × Node 22 and 24, plus a cross-process smoke-determinism diff
and a working-tree-clean check.

**That workflow has never executed.** It runs on first push to the remote. If a
row fails, the honest fix is to narrow the README's claim, not to delete the row.

## Deferred, and why

* **No `configuration`-axis pair.** The two claims it would have carried — "solo
  is the default" and "declaring correct dual roles changes nothing" — are
  runner-level invariants instead, because expressing them as a pair required a
  scenario byte-identical to another with a different `id`. A copy is not a
  comparison.
* **`techniqueBias` stays reserved and empty.** No subshape was frozen in Wave 6
  either, and accepting keys into an unspecified object is how an unspecified
  object acquires semantics by accident.
* **No threshold was changed.** The Wave 3 idiom calibration (hard-rock 2.5,
  metal 3.0, blues 2.5, jazz 2.5) was re-run against the paired corpus and held.

## Known limitations

* `gain-voicing` classifies by **pitch class**, so a major *tenth* over a low root
  fires the same warning as a low major *third*. A tenth is far less muddy than a
  third, so this is a plausible false positive. It is left alone deliberately:
  fixtures adapt to analyzers, and changing it needs a musically credible
  reproduction and a counterfixture, which is analyzer work rather than
  validation work.
* `blues-lead-positive` draws a `fingering.better-fingering` advisory. It is
  advisory-only and documented as "not automatically a defect" — the analyzer
  costs the hand, not the voice — so the scenario permits it rather than
  forbidding it.
* The scenario corpus is the slowest part of `npm test` (~53 s of 122 s). The
  execution cache already removed the easy waste; going further would mean
  running check.mjs in-process, which would stop testing the thing a human
  actually types.

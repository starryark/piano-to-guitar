# Wave 6 baseline — the state the validation phase started from

Recorded before any Wave 6 pickup edit, so a later failure can be classified as a
**regression** rather than rediscovered as a mystery. Nothing in this file is a
target; it is an observation.

## Commit

| | |
|---|---|
| Baseline commit | `d5cfd36` ("wave 1-5 completed") |
| Preceding Wave 6 batch | `352d999` ("w6: add paired scenario fixtures, calibration tests and expanded smoke coverage") |
| Working tree at baseline | clean (`git status --short` empty) |

## Environment

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| Shell | PowerShell 7 (Bash also available) |
| Node | v24.14.0 |
| npm | 11.12.1 |

## Commands and observed results

| Command | Exit | Wall clock | Notes |
|---|---|---|---|
| `npm ci` | 0 | 3.1 s | "added 1 package, audited 2 packages", 0 vulnerabilities |
| `npm test` | 0 | 163 s | 21 suites, every one green |
| `npm run smoke` | 0 | 23 s | `SMOKE: PASS (21 checks)` |
| `npm run smoke` (2nd run) | 0 | — | stdout **identical** to the first run, line for line |
| `git status --short` after all of the above | clean | — | no tracked file mutated, no artefact left behind |

Per-suite counts at baseline (`npm test`, in run order): 30, 82, (piano-source
ok), 27, 10, 5, 11, 19, 14, 9, 40, (style-profile ok), 34, 44, 21,
(sidecar-audit ok), 32, 37, 24, 23, 19, 31, 20, 11.

## Known pre-existing failures

**None.** Every registered suite passed and both smoke runs passed. Any failure
observed after this point is a regression introduced by Wave 6 pickup work.

## Corrections to the pickup plan's stated paths

The pickup plan names files that do not exist at these paths in this repository.
The real layout is:

| Plan says | Actually |
|---|---|
| `test/fixtures/scenarios/manifest.json` | `tools/fixtures/scenarios/manifest.json` |
| `test/*.test.mjs` | `tools/*.test.mjs` and `tools/lib/*.test.mjs` |
| `docs/specs/wave3-6-contract-addendum.md` | `docs/specs/wave3-6-addendum.md` |
| `test/analysis.test.mjs`, `test/check.test.mjs`, … | `tools/lib/analysis.test.mjs`, `tools/check.test.mjs`, … |
| `test/history.test.mjs` | `tools/history.test.mjs` |
| `Implement.md` | not present in the tree; roadmap history lives in the git log |

There is no `test/` directory. All tests live beside the code they test, which is
the convention the repository already follows and which Wave 6 keeps.

# Decisions: piece-generalization + alphatab-only

This record captures two related decisions that reshape the toolchain from
"built around the Canon Rock corpus, with a MIDI render path" to
"piece-general, with `.alphatab` as the only music artifact."

## A. Decouple the Canon Rock corpus (skip-when-absent)

**Doctrine.** The toolchain is piece-general; the Canon Rock corpus
(`CanonRock/`, gitignored) is a *worked example and an optional test corpus*,
not a build dependency. Everything in `tools/` runs on any piano source; the
Canon-specific material lives in `reference/case-canon-rock.md` (the worked
example) and in the `CORPUS:` / `E2E:` tests.

**Mechanism — skip-when-absent.** The corpus-touching tests use a
`corpusTest(name, fn)` helper instead of `test(...)`. When `CanonRock/` is
present, `corpusTest` behaves exactly like `test` — every test registers and
runs, zero behavior change. When `CanonRock/` is absent, the test is
**recorded by name in a `skipped[]` list and does not run**; the runner prints
a `SKIP:` notice naming every skipped test, then exits 0. No test is silently
skipped — each is named in the output.

| Suite                     | Portable | Corpus | Corpus-absent exit |
|----------------------------|---------:|-------:|-------------------|
| `fretboard.test.mjs`       |       30 |      0 | 0 (30/30)         |
| `analysis.test.mjs`        |       59 |     17 | 0 (59/59, 17 skip)|
| `piano-source.test.mjs`    |       21 |      6 | 0 (21/21, 6 skip) |
| **Total**                  |     **110** | **23** | **0 (110/110, 23 skip)** |

Corpus-present: 133/133, zero skips.

## B. Remove the MIDI render path (alphatab-only)

**Decision.** Music files live entirely as `.alphatab`; `tools/midi.mjs` and
the "render MIDI to A/B" audition doctrine are removed. `package.json`'s
`@coderline/alphatab` dependency **stays** — four other files import it
(`analysis.mjs`, `piano-source.mjs`, `score-utils.mjs`, `playability.mjs`);
only `midi.mjs`'s usage goes away.

**Rationale.** The VS Code alphaTab extension renders and plays `.alphatab`
directly, so the MIDI render path was vestigial for auditioning. More
importantly, **MIDI was never part of the fidelity gate** — `check.mjs`'s
verdict is built solely from `validate → playability → compare`; the MIDI block
was a side-effect convenience render (its header comment read "MIDI (convenience,
never a gate)"). Removing it touches three code surfaces and cannot weaken any
gate.

**What changed in code:**
- `tools/midi.mjs` — **deleted** (98 lines).
- `tools/check.mjs` — removed the MIDI spawn block, the `midi` field of the
  machine result, the `midi` report lines, the now-dead `OUT_DIR` constant
  (its only consumer was the midi path), and the header comments describing
  MIDI as a convenience render. The verdict logic is untouched.
- `tools/smoke.mjs` — check #7 renamed from
  *"…passes and writes MIDI to out/"* to
  *"…passes (validate → playability → compare)"*; the two MIDI assertions and
  the `.mid` file-existence check were dropped. The check retains its core
  value: the only end-to-end validate→playability→compare→verdict run.

**What changed in the audition doctrine.** The dual path
("open in VS Code alphaTab, **or** play `out/*.mid`") collapses to the single
VS Code alphaTab path throughout the orientation and skill docs (CLAUDE.md,
README.md, HANDOFF.md, SKILL.md, `gate-templates.md`). The `out/` directory
stays gitignored — still used by `out/smoke/` scratch.

## C. What stayed Canon-specific and optional

- The `CanonRock/` corpus (gitignored) — supply your own source for other pieces.
- `reference/case-canon-rock.md` — the worked example (filename unchanged;
  cross-linked from sibling docs). Canon-in-D is the **running illustration**
  throughout the craft docs, with a top note making that explicit and the
  general rules parenthesizing the canon-specific measurements
  (e.g. "a pitched source can carry N such tokens (canon-in-d-easy: 11)").

## How to re-supply the corpus

Drop `CanonRock/` at the repo root (matching the layout in
`reference/case-canon-rock.md`). The 23 corpus tests register and run
automatically; `npm test` goes from 110 → 133.

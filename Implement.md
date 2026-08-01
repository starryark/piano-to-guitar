# Implementation Plan: Piano-to-Guitar Pro Ceiling Upgrade

## Revised, Repo-Aware Execution Plan

### Objective

Raise `piano-to-guitar` from a mechanically playable solo-reduction toolchain to a system capable of producing more idiomatic, professional electric-guitar arrangements while preserving its core philosophy:

* the agent is an **arranger, not a literal transcriber**;
* melody/root-motion fidelity remains protected by hard gates;
* musical taste, idiom, fingering quality, tone, and reduction quality remain primarily **soft advisory signals**;
* Node.js ESM and `@coderline/alphatab` remain the only runtime stack;
* AlphaTex remains the sole score representation;
* the existing human Gate A / Gate B workflow remains authoritative;
* existing projects continue to behave the same unless new features are explicitly enabled.

The upgrade should improve the toolchain's **ceiling**, not destabilize its floor.

---

# 1. Repo-Verified Design Corrections

These corrections supersede assumptions in the earlier plan.

## 1.1 Do not rebuild generic multi-track iteration

`validate.mjs` and `playability.mjs` already traverse multiple tracks, and `compare.mjs` already aggregates notes encountered across the score.

The missing capability is therefore **role-aware multi-track analysis**, not generic multi-track parsing.

For a dual-guitar arrangement:

* melody/skeleton fidelity should normally follow the declared **Lead** track;
* harmonic/root/color coverage may use the **union of Lead + Rhythm**;
* mechanical playability remains evaluated independently per track.

Do not modify traversal merely to claim "multi-track support."

---

## 1.2 Preserve intentional power-chord reduction

The current repo intentionally treats omission of the third as a valid electric-guitar reduction, especially under gain. A source major/minor chord becoming a root-fifth grip is not intrinsically a fidelity failure.

Therefore the proposed harmonic-color metric must be:

* soft only;
* register-aware;
* style-aware;
* gain-aware;
* persistent-pattern based rather than triggered by a single power chord.

It must never effectively turn "missing third" into a new hard fidelity rule.

---

## 1.3 Extend the existing max-fret abstraction

`positionsFor()` already supports an `opts.maxFret` override. The remaining problem is inconsistent propagation and other code paths that still assume the global `MAX_FRET`.

Do not put project-file reading inside `tools/lib/fretboard.mjs`.

Instead:

1. keep fretboard calculations pure;
2. introduce a shared configuration resolver;
3. propagate the resolved instrument limits into all consumers.

---

## 1.4 Use AlphaTab's existing harmonic model

Do not invent a new `{ah}` annotation.

AlphaTab already supports natural, artificial, pinch, tapped, semi, and feedback harmonics, including `{nh}`, `{ah}`, `{ph}`, `{th}`, `{sh}`, and `{fh}`.

Playability should inspect the parsed harmonic type instead of treating every harmonic as a natural harmonic.

---

## 1.5 Do not convert the tempo/subdivision guidance into fake precision

The existing guitar-playability reference describes pick difficulty categorically by tempo and subdivision. A single numeric NPS ceiling loses that information.

Replace it with a classifier such as:

```js
classifyPickDemand({
  tempo,
  subdivision,
  beatsInRun,
  articulation
})
```

returning something like:

```text
easy | moderate | hard | expert | avoid
```

rather than manufacturing arbitrary NPS thresholds.

---

## 1.6 Fix sidecar-audit semantics

A `free` sidecar span intentionally has no `sourceBars`, so asking "what percentage of the source melody is under free spans" is not well-defined.

Audit these separately:

* percentage of **tab bars** classified `free`;
* percentage of source bars represented by `quote`;
* percentage represented by `recompose`;
* percentage of source melody-skeleton notes represented by at least one quote;
* source bars never referenced;
* repeated source references.

---

# 2. Cross-Cutting Contracts

These contracts apply to every wave.

## Runtime

* Node.js ESM only.
* No Python.
* No second parser.
* No new required runtime dependency without explicit architectural approval.
* AlphaTab remains the score parser/model.

## Exit codes

Standardize all new tools:

```text
0 = analysis completed; no hard failure
1 = hard musical/toolchain gate failed
2 = usage / malformed input / IO / operational failure
```

Soft-only analyzers such as fingering and idiom must never return `1`.

## Advisory schema

New advisories should use a shared structured representation rather than each tool inventing a format.

Example:

```json
{
  "code": "fingering.position-jump",
  "severity": "warning",
  "message": "Large position shift in a fast phrase",
  "track": 0,
  "bar": 14,
  "beat": 3,
  "data": {
    "fromPosition": 3,
    "toPosition": 10
  }
}
```

Recommended fields:

* `code`
* `severity`
* `message`
* `track`
* `staff`
* `bar`
* `beat`
* `data`

`track`, `staff`, `bar`, `beat`, and `data` may be omitted when irrelevant.

## Configuration precedence

Use one explicit precedence everywhere:

```text
CLI argument
    >
projects/<slug>/config.json
    >
style-profile default
    >
built-in default
```

Example project configuration:

```json
{
  "schemaVersion": 1,
  "style": "hard-rock",
  "instrument": {
    "maxFret": 24
  },
  "arrangementMode": "solo",
  "tracks": {
    "lead": [0],
    "rhythm": []
  }
}
```

Do not require `config.json`; existing projects without one must retain current behavior.

## Compatibility rules

Unless explicitly changed in this plan:

* current hard-gate pass/fail behavior stays unchanged;
* current sidecar semantics stay unchanged;
* `harmony.pcset` narrowing remains intact;
* solo-guitar mode remains the default;
* style profiles influence advisories before they influence hard limits;
* no optimizer automatically rewrites `cover.alphatab`.

Every new advisory needs:

1. a positive fixture that triggers it;
2. a negative fixture that proves it does not spam normal writing.

---

# Wave 0 — Baseline, Contracts & Advisory Plumbing

### Goal

Make the existing soft-advisory path trustworthy before adding additional soft analyzers.

### Subagent

`GateInfrastructureAgent`

### Minimum Context

* `AGENTS.md`
* `docs/workflow.md`
* `tools/check.mjs`
* `tools/compare.mjs`
* sidecar parsing logic
* relevant existing tests

The context list is a minimum, not an artificial sandbox. The orchestrator may provide additional dependency files required to understand an existing interface.

## Tasks

### 0.1 Record the baseline

Before modifications:

```bash
npm test
npm run smoke
```

Record:

* exit status;
* fixture count;
* existing hard failures expected by tests;
* current JSON shape emitted by `check.mjs`.

Do not begin feature implementation on a failing baseline.

### 0.2 Normalize soft-advisory propagation

Ensure `check.mjs` exposes soft findings consistently in both:

* bar-locked comparison mode;
* `--map` sidecar mode.

The machine-readable result should always permit:

```json
{
  "soft": {
    "playability": [],
    "compare": [],
    "fingering": [],
    "idiom": [],
    "sidecar": []
  }
}
```

Empty arrays are preferable to mode-dependent `null` values where practical.

### 0.3 Add a unified human report

Add one final section:

```text
SOFT ADVISORIES
---------------
...
```

Group by subsystem but do not let soft output influence the gate result.

### 0.4 Share sidecar parsing

If `compare.mjs` currently owns sidecar schema/validation logic internally, extract the reusable pieces into:

```text
tools/lib/sidecar.mjs
```

Only do this with regression tests protecting current behavior.

Potential exports:

```js
loadSidecar(path)
validateSidecar(data)
resolveMappedSpans(...)
```

`compare.mjs` and the future audit tool must consume the same sidecar semantics.

## Acceptance Criteria

* `npm test` passes.
* `npm run smoke` passes.
* Existing hard pass/fail results are unchanged.
* A map-mode compare advisory is visible in human output.
* The same advisory appears under `soft.compare` in JSON.
* Sidecar validation behavior is unchanged.

---

# Wave 1 — Mechanical Semantics & Instrument Configuration

### Goal

Remove misleading CLI behavior and hardcoded mechanical assumptions without introducing musical heuristics yet.

### Subagent

`MechanicalFixAgent`

### Minimum Context

* `tools/playability.mjs`
* `tools/check.mjs`
* `tools/lib/fretboard.mjs`
* `reference/guitar-playability.md`
* relevant playability fixtures/tests

## Tasks

### 1.1 Correct warning/error exit semantics

In `playability.mjs`:

```js
const ok = errors.length === 0;
process.exit(ok ? 0 : 1);
```

Warnings remain serialized and printed but no longer determine process success.

Then simplify `check.mjs`'s workaround/reporting so the architecture is internally consistent.

Keep defensive JSON parsing in `check.mjs`; simply stop relying on an intentionally incorrect child exit code.

### 1.2 Centralize project configuration

Create:

```text
tools/lib/project-config.mjs
```

Responsibilities:

* locate optional `projects/<slug>/config.json`;
* validate known fields;
* resolve defaults;
* apply CLI overrides;
* return one normalized configuration object.

No musical analysis belongs here.

### 1.3 Finish configurable max-fret support

In `tools/lib/fretboard.mjs`:

```js
export const DEFAULT_MAX_FRET = 22;
```

Retain a compatibility alias for `MAX_FRET` if current callers/tests require it.

Make every relevant function honor an explicit limit:

```js
positionsFor(midi, { maxFret })
isPlayableVoicing(positions, { maxFret, maxSpan })
```

Add:

```text
--max-fret N
```

to:

* `playability.mjs`;
* `check.mjs`;
* later fingering tools.

Do not make the fretboard library read the filesystem.

### 1.4 Correct harmonic-node handling

Split natural harmonic locations conceptually into:

```js
RELIABLE_NAT_HARMONIC_NODES
EXTENDED_NAT_HARMONIC_NODES
```

At minimum preserve current reliable locations and recognize fret `4` as an extended location if desired by the reference policy.

Behavior:

* standard reliable `{nh}` node → no finding;
* extended/nonstandard `{nh}` node → soft warning;
* artificial/pinch/tap/semi/feedback harmonic → do not apply natural-node validation;
* impossible malformed effect data → operational/validation finding as appropriate.

Do not invent AlphaTex syntax; use AlphaTab's parsed harmonic type. AlphaTab already models these effects directly.

### 1.5 Add hybrid-picking semantics

For simultaneous non-contiguous strings without brush/arpeggio:

```text
2 notes  -> soft warning
3+ notes -> hard error
```

The dyad warning should explicitly say:

```text
Non-adjacent dyad: hybrid picking or a roll may be required.
```

Existing legal brush/arpeggio treatment remains unchanged.

### 1.6 Replace `PICK_CEILING_NPS`

Implement:

```js
classifyPickDemand({
  tempo,
  duration,
  consecutiveAttacks,
  articulation
})
```

Derive subdivision from duration.

Use the reference's tempo × subdivision categories.

Also model phrase duration:

* distinguish one short burst from sustained picking;
* track genuine pick attacks rather than tied/legato notes;
* warn more strongly when difficult picking persists beyond the reference's recommended burst length.

The classifier should return structured data, e.g.:

```json
{
  "level": "hard",
  "tempo": 168,
  "subdivision": "16th",
  "consecutiveAttacks": 10
}
```

Do not fail the gate solely for pick demand.

## Acceptance Criteria

Add tests proving:

* warning-only `playability.mjs` exits `0`;
* any hard playability error exits `1`;
* usage failure exits `2`;
* fret 23 is rejected at max fret 22;
* fret 23 is accepted at max fret 24;
* CLI max fret overrides project configuration;
* an artificial harmonic is not treated as an invalid natural harmonic;
* a non-adjacent dyad produces a warning only;
* a non-adjacent 3-note simultaneous grip remains a hard error;
* pick-demand classification matches the documented table at boundary tempos.

Then:

```bash
npm test
npm run smoke
```

---

# Wave 2 — Fingering Optimizer

### Goal

Analyze phrases as a guitarist would finger them rather than evaluating isolated frets.

### Subagent

`FretboardTheoryAgent`

### Minimum Context

* `tools/lib/fretboard.mjs`
* score traversal helpers
* `reference/guitar-fretboard.md`
* `reference/electric-guitar-voice.md`
* Wave 1 configuration contracts
* representative fixtures

## Tasks

### 2.1 Create `tools/lib/fingering.mjs`

The first release is an **analyzer and recommender**, not an automatic tab rewriter.

Input should be derived directly from the parsed AlphaTab score rather than introducing a second independent beat representation.

For each phrase:

1. identify its pitches and existing string/fret assignments;
2. generate legal alternative positions using `positionsFor()`;
3. eliminate candidates that:

   * duplicate strings within simultaneous grips;
   * exceed `maxFret`;
   * exceed hard hand-span limits;
   * violate effect constraints;
4. optimize the resulting candidate sequence globally.

### 2.2 Use windowed dynamic programming

Do not greedily choose the cheapest fingering beat by beat.

Use dynamic programming/Viterbi-style search over phrase windows with a beam limit to prevent combinatorial explosion.

Suggested transition cost:

```text
cost =
    w_pos     * position_shift_cost
  + w_str     * string_crossing_cost
  + w_skip    * string_skip_cost
  + w_stretch * stretch_cost
  + w_high    * high_fret_cost
  - w_common  * anchored_common_tones
  - w_open    * useful_open_string_bonus
```

Position movement should be **time-aware**:

```text
large movement + long rest  = relatively cheap
large movement + 16th note  = expensive
```

### 2.3 Protect expressive semantics

Do not freely relocate notes whose current position participates in:

* slides;
* bends;
* hammer-on/pull-off relations;
* natural harmonics;
* let-ring/open-string effects;
* position-dependent techniques.

A candidate may move such a note only if the alternative explicitly preserves the technique.

### 2.4 Produce explainable output

Per phrase/beat report:

* current fingering score;
* suggested score;
* proposed string/fret assignment;
* primary reason for improvement.

Example:

```text
bars 12-13
difficulty: 7.1 -> suggested 4.3

beat 12.3:
  current: E5 string 1 fret 12
  suggested: E5 string 2 fret 17

reason:
  avoids immediate 8-fret position collapse on next beat
```

Do not silently mutate the source file.

### 2.5 CLI wrapper

Create:

```bash
node tools/fingering.mjs cover.alphatab \
  --bars 12-20 \
  --max-fret 24 \
  --json
```

Soft musical findings:

```text
exit 0
```

Usage/parser/IO failure:

```text
exit 2
```

## Acceptance Criteria

Tests must prove:

* output is deterministic;
* suggested fingerings preserve pitch;
* no candidate violates hard fretboard constraints;
* effect-constrained notes stay protected;
* a known phrase demonstrates a globally better solution than a greedy local choice;
* difficulty decreases on the synthetic optimization fixture;
* the tool exits `0` even when advisories are emitted.

---

# Wave 3 — Idiom Engine & Style Profiles

### Goal

Measure whether an arrangement behaves like guitar music without turning stylistic taste into hard legality.

### Subagent

`StyleIdiomAgent`

### Minimum Context

* `tools/lib/fingering.mjs`
* `reference/electric-guitar-voice.md`
* `reference/guitar-fretboard.md`
* `tools/check.mjs`
* Wave 0 advisory contract
* Wave 1 configuration resolver

## Tasks

### 3.1 Create `tools/lib/idiom.mjs`

Represent recognizable guitar idioms as explicit features.

Initial feature families:

* power-chord grips;
* octave grips;
* shell voicings;
* CAGED-derived grip families;
* pedal tones;
* open-string pedals;
* repeated riff cells;
* syncopated chord attacks;
* palm-muted repetition;
* slides;
* bends;
* vibrato;
* rhythmic fragmentation;
* literal block-chord density;
* repeated identical chord-rhythm density.

Expose feature values first:

```json
{
  "powerChordHits": 8,
  "octaveGrips": 2,
  "shellVoicings": 0,
  "palmMutedAttacks": 12,
  "literalBlockChordRatio": 0.18
}
```

Then derive:

```js
analyzeIdiomDensity(...)
```

returning:

```json
{
  "score": 7.8,
  "features": {...},
  "advisories": [...]
}
```

### 3.2 Do not universalize rock techniques

A clean jazz ballad must not be penalized because it lacks palm muting.

Likewise:

* a blues shuffle need not resemble metal;
* a metal rhythm section need not preserve jazz color tones;
* block chords can be idiomatic in the right context.

All stylistic weighting belongs in profiles.

### 3.3 Add versioned style profiles

Create:

```text
reference/styles/
  hard-rock.json
  metal.json
  blues.json
  jazz.json
```

Every profile:

```json
{
  "schemaVersion": 1,
  "name": "hard-rock",
  "defaultGain": "crunch",
  "idiom": {
    "warnBelow": 4.5,
    "weights": {}
  },
  "harmonicColor": {},
  "pickDemand": {},
  "techniqueBias": {},
  "freeSpanWarnShare": 0.4
}
```

Treat style settings as soft musical policy.

Do **not** allow style profiles to redefine fundamental physical rules such as:

* one simultaneous fretted note per string;
* instrument fret count;
* malformed bar duration.

### 3.4 Create profile loader

Create:

```text
tools/lib/style-profile.mjs
```

Responsibilities:

* resolve known profile names;
* validate schema version;
* merge project overrides;
* expose one normalized object.

### 3.5 Add CLI style selection

Add:

```text
--style hard-rock|metal|blues|jazz
```

to `check.mjs`.

Default:

```text
hard-rock
```

or whatever profile exactly reproduces current behavior most closely.

Explicit `--gain` should override the profile's default gain.

### 3.6 Integrate soft engines into `check.mjs`

Pipeline:

```text
validate       HARD
   ↓
playability    HARD + SOFT
   ↓
compare        HARD + SOFT
   ↓
fingering      SOFT
   ↓
idiom          SOFT
```

A soft analyzer crashing because of malformed internal data is an operational error, not a hidden success.

Its musical score, however, never changes the hard gate exit code.

## Acceptance Criteria

```bash
node tools/check.mjs ... --style metal
node tools/check.mjs ... --style jazz
```

must both run.

Tests prove:

* changing style changes relevant soft advice;
* changing style does not alter unchanged hard-gate results;
* jazz does not receive "missing palm mute" spam;
* metal power-chord writing does not receive automatic "missing thirds" criticism;
* JSON includes `soft.fingering` and `soft.idiom`.

Then:

```bash
npm test
npm run smoke
```

---

# Wave 4 — Harmonic Color, Sidecar Audit & Lead Singability

### Goal

Detect prolonged musical flattening and awkward lead motion without contradicting the existing reduction philosophy.

### Subagent

`HarmonicLogicAgent`

### Minimum Context

* `tools/compare.mjs`
* `tools/lib/analysis.mjs`
* `tools/lib/sidecar.mjs`
* `tools/lib/fingering.mjs`
* style-profile schema
* `AGENTS.md` section governing pcset narrowing

## Tasks

### 4.1 Add harmonic-color retention analysis

Add soft signal:

```text
harmonic-flattening
```

Do **not** modify the existing meaning of `harmony.pcset`.

Where available, use the finer `harmonySpans[]` information to understand source color while preserving the existing pcset narrowing fix.

For each mapped non-free source slice:

1. determine the source root;
2. determine whether source harmony includes meaningful color:

   * minor/major 3rd;
   * minor/major 7th;
   * 9th;
3. determine whether the target span preserves any of those color functions;
4. consider target register and gain;
5. accumulate consecutive flattening only across semantically corresponding source material.

Trigger only after sustained flattening, initially something like:

```text
>= 4 consecutive source harmonic slices
```

but keep this threshold configurable by style.

Suggested advisory:

```text
Sustained harmonic neutralization: several source harmonies containing
3rd/7th/9th color are rendered only as root-fifth material. Consider an
upper-register color tone, or confirm that the sustained power-chord
reduction is intentional.
```

Important:

Under high gain, never suggest simply adding a low-register third.

### 4.2 Make harmonic-color policy style-aware

Example direction:

```text
metal:
    high tolerance for prolonged root-fifth neutralization

hard-rock:
    moderate tolerance

blues:
    preserve characteristic dominant color when practical

jazz:
    low tolerance for losing 3rd/7th identity repeatedly
```

These are advisory policies only.

### 4.3 Create `tools/sidecar-audit.mjs`

Use the shared sidecar library.

Report:

#### Tab-space metrics

```text
quote tab bars
recompose tab bars
free tab bars
free-tab-bar share
```

#### Source-space metrics

```text
source bars referenced by quote
source bars referenced by recompose
source bars never referenced
source bars referenced multiple times
```

#### Melody-skeleton metrics

For every source skeleton note, classify the source bar as:

```text
covered by quote
covered only by recompose
unreferenced
```

Do not classify source notes as "free", because free spans deliberately lack source correspondence.

Potential advisory:

```text
High free-span share: 46% of tab bars are declared free.
Verify that the amount of added material is intentional.
```

Avoid accusatory wording such as "the fidelity gate may be evaded" unless a genuinely suspicious structural condition is detected.

### 4.4 Move string-leap logic into fingering/lead analysis

Do not make physical string navigation a fidelity responsibility of `compare.mjs`.

Add to fingering analysis:

```text
lead.string-leap
```

Track the continuous lead voice using actual string assignments.

Warn when:

* a melodic transition skips more than two strings;
* the temporal gap is short enough for the skip to matter;
* no slide/legato/rest makes the movement musically natural.

Make the warning speed-aware.

Example:

```text
Fast lead skip from string 1 to string 4 across adjacent 16ths.
Consider re-fingering the line in one position.
```

### 4.5 Prepare the metric for future track roles

For current solo mode:

```text
lead = existing primary guitar material
```

Once Wave 5 role configuration exists:

```text
lead analysis = declared lead track(s)
```

## Acceptance Criteria

Tests prove:

* one intentional power chord does not trigger flattening;
* a high-gain metal power-chord fixture does not produce noisy color warnings;
* sustained flattening of a jazz dominant/extended progression does;
* an upper-register 3rd or 7th prevents the warning where appropriate;
* existing pcset-narrowing regression stays unchanged;
* free tab share is computed from tab spans, not fabricated source mapping;
* repeated source references are not double-counted as unique coverage;
* fast 1→4 string melody movement warns;
* the same movement separated by a sufficient rest does not.

---

# Wave 5 — Opt-In Dual-Guitar Architecture & Audition Export

### Goal

Permit richer arrangements while preserving the existing solo-guitar product by default.

### Subagent

`ArchitectureAgent`

### Minimum Context

* `README.md`
* `AGENTS.md`
* `docs/workflow.md`
* `tools/check.mjs`
* `tools/compare.mjs`
* score traversal utilities
* configuration/style contracts
* `package.json`

## Tasks

### 5.1 Introduce arrangement mode

Configuration:

```json
{
  "arrangementMode": "solo"
}
```

or:

```json
{
  "arrangementMode": "dual-guitar",
  "tracks": {
    "lead": [0],
    "rhythm": [1]
  }
}
```

Default remains:

```text
solo
```

This preserves the repository's current "guitar tab is the product" workflow unless the arranger explicitly opts into a larger guitar arrangement. The current public README describes the product as a solo electric-guitar cover with piano as implied backing, so changing that silently would be an architectural break.

### 5.2 Make comparison role-aware

In dual-guitar mode:

#### Melody fidelity

Use:

```text
declared Lead track(s)
```

for:

* melody skeleton;
* top-line contour;
* melodic ordering.

#### Harmonic fidelity

Use:

```text
union(Lead, Rhythm)
```

for:

* root support;
* pitch-class color;
* harmonic retention.

This prevents a high note in a rhythm voicing from becoming the accidental "melody."

### 5.3 Leave mechanical traversal alone where already correct

Do not rewrite `validate.mjs` or `playability.mjs` simply because there are now multiple roles.

Only add:

* role labels in diagnostics where useful;
* regression fixtures;
* configuration propagation.

### 5.4 Update Gate A

Gate A should explicitly declare:

```text
Arrangement mode: solo | dual-guitar

If dual-guitar:
- Lead role
- Rhythm role
- register separation
- gain/tone relationship
```

Both tracks can remain inside the same growing `cover.alphatab` score rather than introducing parallel score formats.

### 5.5 Add MIDI export before promising audio rendering

Create a guaranteed low-risk tool:

```text
tools/export-midi.mjs
```

Example:

```bash
node tools/export-midi.mjs \
  projects/foo/cover.alphatab \
  --out projects/foo/cover.mid
```

Use AlphaTab's existing MIDI facilities.

Do not add another npm dependency.

### 5.6 Treat direct Node audio rendering as a feasibility spike

Do not make "realistic electric-guitar audio renderer" a hard Wave 5 deliverable.

Investigate whether the installed AlphaTab version can cleanly produce audio in the repo's Node environment with a user-supplied SoundFont.

If viable, add an optional tool such as:

```bash
node tools/render-audio.mjs cover.alphatab \
  --soundfont /path/to/user.sf2
```

If not viable, document:

```text
AlphaTex
  -> MIDI export
  -> DAW/VST/amp sim
```

for actual tone evaluation.

Do not claim General MIDI/SoundFont playback simulates amp gain, cabinet response, or professional guitar tone.

The repository currently promises only AlphaTab as its sole dependency, so audio work should not quietly expand the dependency footprint.

## Acceptance Criteria

* existing solo fixture behavior is unchanged;
* dual-guitar fixture validates;
* each guitar track is checked independently for playability;
* a rhythm note above the lead note does not hijack melody fidelity;
* rhythm-track harmonic color can satisfy harmonic coverage;
* MIDI export produces a non-empty valid output;
* no new required npm dependency is introduced;
* any direct-audio functionality is marked optional unless demonstrated reliably.

---

# Wave 6 — Corpus Diversification, Calibration & Regression

### Goal

Demonstrate that the new heuristics generalize beyond one rock arrangement and remain quiet when they should.

### Subagent

`TestEngineerAgent`

### Minimum Context

* `tools/fixtures/`
* `tools/smoke.mjs`
* all new test files/APIs
* original Canon Rock regression fixtures/tests
* style profiles

## Tasks

### 6.1 Build paired synthetic style fixtures

Do not create source-only fixtures.

Each scenario should include enough artifacts to exercise the complete pipeline:

```text
source AlphaTex
source digest or extraction step
target tab
sidecar
style
expected hard outcome
expected soft advisory codes
```

### Jazz fixture

Exercise:

* major/minor 7ths;
* extensions;
* shell voicings;
* sparse clean texture.

Include both:

1. idiomatic shell-voicing target;
2. deliberately flattened root-fifth target.

Expected:

```text
flattened version -> harmonic-flattening advisory
shell version      -> no flattening advisory
```

### Metal fixture

Exercise:

* sustained 16ths;
* palm-muted pedal riffs;
* power chords;
* high gain;
* short fast lead burst.

Expected:

* strong idiom score;
* appropriate pick-demand advisory where warranted;
* no inappropriate "restore the third" spam.

### Blues fixture

Exercise:

* shuffle/triplet rhythm;
* dominant seventh color;
* bends/slides;
* riff repetition.

Expected:

* blues idiom features detected;
* dominant-color preservation treated sensibly.

### 6.2 Add focused mechanical fixtures

Add:

* 24-fret-valid / 22-fret-invalid note;
* warning-only playability case;
* non-adjacent hybrid-picking dyad;
* non-adjacent three-note hard-error grip;
* natural harmonic on extended node;
* artificial/pinch/tapped harmonic fixture;
* global-vs-greedy fingering phrase;
* fast lead string-skip phrase;
* role-aware dual-guitar melody fixture;
* high-free-span sidecar fixture.

### 6.3 Pin advisory behavior

Tests should assert advisory **codes**, not entire prose strings.

Prefer:

```js
assert(hasAdvisory(result, "harmonic-flattening"));
```

over snapshotting punctuation-heavy output.

This allows message wording to improve without breaking the suite.

### 6.4 Preserve critical historic regressions

The existing half-bar `pcset` narrowing behavior is a locked invariant.

Do not "improve" harmonic color by widening `harmony.pcset` and reintroducing the historical false-pass condition.

Harmonic-color logic must consume separate/finer evidence.

### 6.5 Add new unit suites to `npm test`

Suggested:

```text
project-config.test.mjs
fingering.test.mjs
idiom.test.mjs
style-profile.test.mjs
sidecar.test.mjs
sidecar-audit.test.mjs
```

### 6.6 Expand smoke coverage

`npm run smoke` should demonstrate:

* all hard stages;
* all soft analyzers;
* all supported styles;
* map mode;
* solo mode;
* dual-guitar mode.

Avoid requiring every fixture to emit warnings merely to prove the analyzer ran.

## Acceptance Criteria

```bash
npm test
npm run smoke
```

both pass.

Every new soft rule has at least:

* one trigger case;
* one non-trigger case.

Original hard-gate expectations remain pinned.

---

# 3. Revised Orchestrator Strategy

The orchestrator owns shared contracts.

Subagents may implement against those contracts but must not independently redefine:

* project config schema;
* advisory schema;
* style schema;
* sidecar semantics;
* exit codes;
* track-role semantics.

## Execution Order

### Phase 0 — Establish baseline

* [ ] Read `AGENTS.md`.
* [ ] Read `docs/workflow.md`.
* [ ] Read the relevant guitar references.
* [ ] Run `npm test`.
* [ ] Run `npm run smoke`.
* [ ] Record baseline hard/soft behavior.

### Phase 1 — Infrastructure

* [ ] Execute Wave 0.
* [ ] Verify map-mode soft advisories survive `check.mjs`.
* [ ] Run full tests.

### Phase 2 — Mechanical foundation

* [ ] Execute Wave 1.
* [ ] Verify warning-only `playability.mjs` exits `0`.
* [ ] Verify 22/24-fret configuration.
* [ ] Verify hybrid-picking behavior.
* [ ] Verify harmonic-type handling.
* [ ] Run full tests.

### Phase 3 — Fingering intelligence

* [ ] Execute Wave 2.
* [ ] Run fingering CLI against fixture.
* [ ] Verify optimizer recommendations preserve pitch/effects.
* [ ] Verify global optimization beats the pinned greedy example.
* [ ] Run full tests.

### Phase 4 — Style/idiom intelligence

* [ ] Execute Wave 3.
* [ ] Run `check.mjs --style metal`.
* [ ] Run `check.mjs --style jazz`.
* [ ] Confirm hard result stays unchanged across styles.
* [ ] Run full tests.

### Phase 5 — Harmonic and melodic quality

* [ ] Execute Wave 4.
* [ ] Confirm jazz flattening fixture warns.
* [ ] Confirm metal power-chord fixture does not spam.
* [ ] Confirm sidecar-audit metrics distinguish tab-space from source-space.
* [ ] Confirm fast melody string leap warns.
* [ ] Run full tests.

### Phase 6 — Architecture expansion

* [ ] Execute Wave 5.
* [ ] Verify solo mode remains unchanged.
* [ ] Verify role-aware dual-guitar comparison.
* [ ] Verify MIDI export.
* [ ] Document audio-rendering feasibility result.
* [ ] Run full tests.

### Phase 7 — Calibration and regression

* [ ] Execute Wave 6.
* [ ] Run every style fixture.
* [ ] Run `npm test`.
* [ ] Run `npm run smoke`.
* [ ] Check original Canon regression tests.
* [ ] Inspect advisory volume for obvious spam.

### Phase 8 — Documentation and final review

Update:

* [ ] `AGENTS.md`
* [ ] `docs/workflow.md`
* [ ] `reference/guitar-playability.md`
* [ ] `reference/electric-guitar-voice.md`
* [ ] CLI usage/help
* [ ] style-profile documentation
* [ ] project-config documentation

Document new soft categories:

```text
fingering.*
idiom.*
harmonic-flattening
lead.string-leap
sidecar.*
pick-demand.*
```

Document:

```text
--style
--max-fret
config.json
arrangementMode
track roles
```

Then:

```bash
npm test
npm run smoke
```

Finally inspect `git diff` and commit only if the execution environment/repository workflow authorizes the coding agent to create commits.

---

# 4. Definition of Done

The upgrade is complete only when all of the following are true.

## Hard-gate integrity

* syntax/bar-fill failures still fail;
* genuine mechanical impossibilities still fail;
* fidelity skeleton/root-motion failures still fail;
* warnings never accidentally fail the gate.

## Fingering intelligence

* phrase-level alternatives are generated;
* suggestions honor technique constraints;
* recommendations are deterministic and explainable;
* no automatic rewriting occurs.

## Idiom intelligence

* guitar idioms are represented as inspectable features;
* scores are style-conditioned;
* advice does not assume every genre should sound like hard rock.

## Harmonic intelligence

* prolonged color flattening can be detected;
* intentional power chords remain legitimate;
* high-gain advice respects register;
* historical pcset narrowing remains intact.

## Multi-track intelligence

* solo remains the default;
* dual-guitar mode is opt-in;
* melody fidelity follows the Lead role;
* harmonic coverage can use Lead + Rhythm;
* both tracks remain independently playable.

## Audition workflow

* MIDI export works;
* no second required runtime/dependency is introduced;
* realistic amp/VST rendering is documented rather than falsely approximated if AlphaTab cannot provide it cleanly.

## Quality

* every new advisory has trigger/non-trigger tests;
* `npm test` passes;
* `npm run smoke` passes;
* human and JSON reports expose the same soft systems;
* documentation reflects implemented behavior rather than aspirational behavior.

---

# 5. Explicit Non-Goals for This Upgrade

To keep scope controlled, do **not** include in this implementation:

* automatic rewriting of `cover.alphatab` from fingering suggestions;
* machine-learned fingering;
* a second notation parser;
* Python tooling;
* bundled DAW/VST/amp simulation;
* style-dependent weakening of core physical hard gates;
* automatic inference of Lead/Rhythm roles when explicit configuration exists;
* replacing human Gate A or Gate B judgment with an aggregate "quality score";
* making harmonic completeness a hard requirement.

Those are potential later projects once the advisory signals have been calibrated on a sufficiently diverse corpus.

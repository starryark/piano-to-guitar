# Piano-to-Guitar: Coding-Agent Plan for Waves 3–6

## 1. Purpose

This document is the execution reference for implementing the remaining roadmap stages in `piano-to-guitar`.

It is intended for an orchestrating coding agent that delegates bounded work to subagents while retaining ownership of:

* architectural contracts;
* shared integration files;
* test-gate decisions;
* conflict resolution;
* final acceptance.

The objective is not merely to add analyzers. The objective is to extend the existing arranger pipeline without changing the repository’s fundamental behavior:

1. Hard gates continue to protect mechanical playability and mapped musical obligations.
2. New style, idiom, harmonic-color, sidecar, and role-aware diagnostics remain advisory unless the existing contract explicitly says otherwise.
3. Existing solo workflows remain compatible.
4. The installed AlphaTab parser remains the single source of parsed musical truth.
5. The system continues to arrange rather than mechanically transcribe.

---

# 2. Repository State: Do Not Rediscover

## 2.1 Completed foundations

Waves 1 and 2 have already established the following reusable components:

* `tools/lib/project-config.mjs`

  * configuration loading and validation;
  * precedence handling;
  * defaults including `style: "hard-rock"`;
  * instrument configuration;
  * future-facing `arrangementMode` and track-role fields.

* Pick-demand analysis and tests.

* `tools/lib/fingering.mjs`

  * deterministic fingering analysis;
  * exported `DEFAULT_WEIGHTS`;
  * exported analysis functions, including `analyzeFingering`;
  * AlphaTab-model traversal;
  * contract-compliant advisory objects;
  * no automatic score mutation.

* `tools/fingering.mjs`

  * standalone command-line interface;
  * JSON output support;
  * operational-failure handling.

* Wave 0 advisory and sidecar utility libraries.

The project remains Node ESM, uses AlphaTab as its runtime music-model dependency, and includes Wave 1 and Wave 2 tests in the `npm test` sequence.

## 2.2 Important current integration gap

`check.mjs` currently:

* invokes the existing hard-stage tools;
* parses their JSON output;
* resolves only part of the project configuration for its own use;
* initializes the soft result sections with empty arrays, including:

  * `soft.fingering`;
  * `soft.idiom`;
  * `soft.sidecar`.

Therefore, Wave 3—not Wave 2—owns the first integrated soft-analysis pipeline. Do not redesign the fingering optimizer to solve this gap. Wire the existing implementation into the orchestrator.

## 2.3 Planned files not yet present

The Wave 3 and later planned modules, including the idiom engine, style-profile loader, initial style profiles, sidecar audit, and MIDI exporter, are not present on current `main`. They should be introduced incrementally rather than assumed to exist.

## 2.4 Existing parsing and score-model utilities

Reuse the repository’s current score utilities:

* `loadTex`;
* `walkBeats`;
* `QUARTER_TICKS`;
* existing note/string conversion helpers;
* existing bar-range semantics.

The current playability and fingering code already demonstrates how to read AlphaTab properties for bends, slides, vibrato, palm muting, ties, harmonics, let-ring behavior, brush direction, and fretted-string assignments. New analyzers should follow those examples rather than introduce text-level AlphaTex parsing.

## 2.5 Existing sidecar and comparison semantics

The repository already has shared sidecar functions for loading, validating, and resolving mapped spans. Map-mode comparison uses source digest harmony information and proportional source-to-target slices.

Do not create a second interpretation of sidecar ranges. Harmonic-color and audit work must consume the shared sidecar resolver.

## 2.6 Baseline execution disclaimer

This plan is based on inspection of current repository sources. The test suite was not executed as part of preparing this document. The orchestrator’s first implementation action must be to run and record the baseline locally.

---

# 3. Frozen Cross-Cutting Contracts

Before assigning implementation work, every agent must read:

1. `AGENTS.md`;
2. `Implement.md`;
3. `tools/lib/upgrade-contracts.mjs`;
4. `package.json`;
5. the relevant current libraries and tests.

The contract module already defines or documents:

* runtime dependency policy;
* command exit semantics;
* advisory namespaces and object shape;
* `check.mjs` soft-output structure;
* configuration behavior;
* style-profile schema;
* sidecar and track-role concepts;
* sidecar metrics;
* pick-demand behavior;
* prohibited architectural changes.

Treat these as frozen unless the orchestrator explicitly approves a small contract addendum before coding.

## 3.1 Non-negotiable rules

All subagents must follow these constraints:

1. **Node ESM only.**

2. **No Python implementation.**

3. **No second music parser.**
   Feature extraction must use the AlphaTab score model.

4. **No new required runtime dependency without explicit approval.**

5. **Exit codes remain:**

   * `0`: successful execution, including advisory findings;
   * `1`: hard musical or mechanical failure where already defined;
   * `2`: malformed input, configuration error, parser error, or operational failure.

6. **Soft findings never cause a hard-gate failure.**

7. **Every new advisory requires:**

   * a positive fixture that triggers it;
   * a negative fixture that does not trigger it;
   * stable advisory-code assertions.

8. **No automatic tab rewriting.**
   Analyzers may recommend changes or propose alternate positions but must not mutate the user’s score.

9. **Existing default behavior must be preserved.**

   * no configuration file;
   * hard-rock default profile;
   * solo arrangement;
   * six strings;
   * current maximum-fret default;
   * current gain behavior.

10. **Do not widen `harmony.pcset`.**
    The current narrowed meaning is intentional. Future harmonic detail belongs in `harmonySpans[]`.

---

# 4. Orchestration Model

## 4.1 Shared-file ownership

The orchestrator or a designated integration subagent exclusively owns:

* `tools/check.mjs`;
* `package.json`;
* `package-lock.json`;
* `tools/lib/upgrade-contracts.mjs`;
* global documentation indexes;
* any shared fixture manifest.

Feature subagents must not edit these files concurrently.

This prevents three common failures:

* conflicting CLI parsers;
* incompatible JSON shapes;
* tests silently disappearing during merges.

## 4.2 Branching model

Give each subagent a separate branch or worktree.

Recommended naming:

```text
agent/w3-style-profile
agent/w3-idiom
agent/w3-integration
agent/w4-harmonic-color
agent/w4-sidecar-audit
agent/w4-lead-motion
agent/w5-track-roles
agent/w5-midi-export
agent/w6-fixtures
agent/final-regression
```

The orchestrator should cherry-pick cohesive commits rather than merge broad branches blindly.

## 4.3 Required subagent handoff format

Every subagent must return:

```text
Objective completed:
Files changed:
Public APIs added or changed:
Contracts relied upon:
Contract deviations:
Tests added:
Commands executed:
Observed results:
Known edge cases:
Known risks:
Assumptions made for the next agent:
```

“Contract deviations” must say `None` or identify an orchestrator-approved change.

## 4.4 Context packet template

Each assignment should contain:

1. exact objective;
2. owned files;
3. files that must be read;
4. frozen contracts;
5. known existing APIs;
6. explicit non-goals;
7. expected public API;
8. expected fixtures;
9. acceptance commands;
10. handoff format.

Never issue a vague instruction such as “implement the idiom analyzer.” Include the event model, expected output, and integration boundary.

---

# 5. Required Agent Skills

The orchestrator should select subagents with the following capabilities.

## 5.1 Music-model and AlphaTab skill

Needed for:

* AlphaTab score traversal;
* note attack versus tie-destination handling;
* string and fret interpretation;
* beat duration and timing;
* chord-grip recognition;
* articulations and effects;
* MIDI generation.

The agent should understand that AlphaTab’s model, rather than AlphaTex source text, is authoritative after parsing.

## 5.2 Guitar-arrangement skill

Needed for:

* power-chord recognition;
* octave shapes;
* pedal-tone riffs;
* palm-muted repetition;
* shell voicings;
* lead-string continuity;
* gain-sensitive harmony;
* register-sensitive chord-color decisions.

The repository’s electric-guitar reference material should be supplied to these agents as domain context. It already explains high-gain voicing, power chords, palm muting, octave shapes, register, and idiomatic guitar behavior.

## 5.3 Static-analysis and contract-design skill

Needed for:

* deterministic feature extraction;
* stable advisory codes;
* fail-closed schemas;
* compatibility;
* precise range semantics;
* machine-readable output.

## 5.4 Test-engineering skill

Needed for:

* positive and negative fixtures;
* adversarial fixtures;
* CLI exit tests;
* deterministic JSON snapshots or structural assertions;
* regression checks across configuration precedence.

## 5.5 Integration skill

Needed for:

* subprocess orchestration;
* JSON parsing and failure propagation;
* preserving hard versus soft semantics;
* configuration provenance;
* role-aware score views.

---

# 6. Stage 0: Baseline and Contract Ledger

## Subagent Wave 0

### Agent: Repository Cartographer and Contract Auditor

**Purpose:** Produce a baseline manifest before feature coding.

**Read:**

* `AGENTS.md`;
* `Implement.md`;
* `tools/lib/upgrade-contracts.mjs`;
* `package.json`;
* all Wave 0–2 libraries;
* existing tests;
* `tools/check.mjs`;
* `tools/compare.mjs`;
* `tools/playability.mjs`.

**Do not change production code.**

### Steps

1. Run:

```bash
npm ci
npm test
npm run smoke
```

2. Record:

   * Node version;
   * npm version;
   * AlphaTab version;
   * all passing test files;
   * smoke-test commands;
   * execution time.

3. Capture representative current JSON from:

   * `check.mjs` in bar-locked mode;
   * `check.mjs` in map mode;
   * `fingering.mjs --json`;
   * `compare.mjs --json`.

4. Produce a current API manifest:

   * exported function names;
   * CLI flags;
   * result-object fields;
   * advisory codes;
   * exit behavior.

5. Identify shared files that later branches must not edit concurrently.

6. Verify that the working tree is clean.

### Deliverable

Commit no production changes unless a baseline test is broken. Return a written manifest to the orchestrator.

---

# 7. Wave 3: Style Profiles, Idiom Analysis, and Soft Integration

## Wave 3 outcome

After Wave 3:

* style profiles load deterministically;
* hard-rock remains the default;
* idiom density is calculated from the parsed score;
* existing fingering advisories appear in `check.mjs`;
* idiom advisories appear in `check.mjs`;
* style changes may alter advisory results but not existing hard-gate semantics.

The roadmap specifies the style-profile schema, idiom weights and thresholds, hard-rock profile, `--style` support, and integrated soft output.

---

## 7.1 Freeze one Wave 3 contract addendum

The orchestrator should write a short contract note before parallel work starts.

Freeze:

### Style resolution

```text
CLI style
  > project config style
  > "hard-rock"
```

### Gain resolution

```text
CLI gain
  > project config gain
  > selected profile defaultGain
  > legacy hard-coded default
```

### Critical implementation warning

`check.mjs` currently initializes gain to a concrete high-gain value. That destroys the distinction between “the user supplied high gain” and “no CLI value was supplied.”

Change CLI parsing so absent values remain `undefined` until `resolveConfig` applies precedence. The same principle applies to style and future role arguments.

### Recommended two-stage resolution

1. Parse CLI values without filling defaults.
2. Load project configuration.
3. Resolve the style name.
4. Load and validate the style profile.
5. Resolve the full configuration using that profile’s defaults.
6. Preserve provenance for diagnostic output.

### Idiom event model

Freeze these definitions:

* An **attack event** is a non-rest beat with at least one newly attacked note.
* Tie destinations are not new attacks.
* Events are keyed by track, staff, voice, bar, and absolute tick.
* A grip is the set of simultaneously attacked notes after normalization.
* String numbers use the repository’s existing source-number convention.
* All ratios must define their denominator explicitly.
* Empty denominators produce neutral values rather than `NaN`.

---

## 7.2 Subagent Wave 3A: Style Profile Agent

### Owned files

Suggested ownership:

```text
tools/lib/style-profile.mjs
reference/styles/hard-rock.json
test/style-profile.test.mjs
test/fixtures/styles/*
```

### Read-only context

* `tools/lib/project-config.mjs`;
* `tools/lib/upgrade-contracts.mjs`;
* configuration tests;
* `Implement.md` Wave 3;
* `package.json`.

### Required public API

```js
loadStyleProfile(name, options?)
validateStyleProfile(profile, options?)
mergeStyleProfile(base, overrides)
```

The precise names may differ only if the contract already fixes them.

### Loader behavior

1. Resolve built-in profiles only from `reference/styles`.
2. Reject path traversal.
3. Parse JSON with actionable error messages.
4. Require the declared schema version.
5. Reject unknown top-level keys.
6. Reject unknown nested keys where the schema is closed.
7. Validate:

   * numeric ranges;
   * booleans;
   * enum values;
   * weight names;
   * threshold values.
8. Deep-merge approved override objects.
9. Do not merge arrays by index.
10. Return a normalized, immutable profile or a safely cloned object.
11. Unknown profile names and malformed profiles are operational errors.

### Hard-rock compatibility

The built-in `hard-rock` profile must reproduce legacy default behavior. Selecting it explicitly and omitting `--style` should lead to equivalent hard results and equivalent default soft thresholds.

### Tests

Include:

* valid hard-rock load;
* missing profile;
* malformed JSON;
* wrong schema version;
* unknown top-level field;
* unknown nested field;
* invalid weight type;
* invalid threshold;
* safe override merge;
* rejected traversal-like profile name;
* immutability or clone-safety;
* default profile compatibility.

### Non-goals

* Do not implement idiom extraction.
* Do not modify `check.mjs`.
* Do not invent profiles for every genre yet.
* Do not add a generic plugin architecture.

---

## 7.3 Subagent Wave 3B: Idiom Engine Agent

### Owned files

```text
tools/lib/idiom.mjs
tools/idiom.mjs
test/idiom.test.mjs
test/fixtures/idiom/*
```

### Read-only context

* `tools/lib/score-utils.mjs`;
* `tools/lib/fingering.mjs`;
* pick-demand library;
* playability traversal;
* electric-guitar reference documents;
* style-profile contract;
* advisory contract;
* relevant AlphaTab model fields.

### Recommended public API

```js
extractIdiomFeatures(score, options)
analyzeIdiomDensity(score, options)
```

Recommended result:

```js
{
  score,
  features,
  weightedScore,
  advisories,
  stats,
  settings
}
```

Do not expose AlphaTab objects in JSON output.

### Feature implementation order

Implement robust, explainable features first.

#### Tier 1: reliable structural features

1. **Power-chord attacks**

   * root plus fifth;
   * optional octave;
   * no required third;
   * distinguish from arbitrary perfect-fifth intervals.

2. **Octave grips**

   * same pitch class one or more octaves apart;
   * playable guitar-string geometry where available.

3. **Pedal-tone recurrence**

   * repeated low or open-string pitch under changing upper material;
   * count attacks, not sustained tie destinations.

4. **Palm-muted repetition**

   * repeated attacked events with palm-mute articulation;
   * measure run length and rhythmic regularity.

5. **Lead articulation**

   * bends;
   * slides;
   * vibrato;
   * legato indicators that AlphaTab exposes reliably.

6. **Repeated riff cells**

   * canonicalize short event windows;
   * include relative pitch movement and rhythmic pattern;
   * avoid key-specific matching when possible.

7. **Syncopated attacks**

   * define the metrical grid;
   * count attacked events on weak subdivisions or tied across stronger beats;
   * document exact formula.

8. **Literal block-chord density**

   * ratio of multi-note, same-onset attacks to all attack events;
   * useful as a negative feature when piano-like chord repetition dominates.

9. **Rhythmic fragmentation**

   * ratio or distribution of short attack durations;
   * avoid treating ornamental grace behavior as a full riff event.

#### Tier 2: cautious features

These may be recorded diagnostically before receiving nonzero profile weights:

* shell-voicing recognition;
* CAGED-shape approximation;
* drop voicing labels;
* stylistic chord-extension classification.

Do not award confidence to shape labels without calibrated fixtures.

### Scoring

1. Extract raw feature counts.
2. Normalize each feature against a declared denominator.
3. Apply profile weights.
4. Produce a deterministic aggregate.
5. Compare with `profile.idiom.warnBelow`.
6. Emit a stable low-density advisory code.
7. Include contributing features in `data`, not in the advisory prose alone.

Suggested advisory shape:

```js
{
  code: "idiom.low-density",
  severity: "warning",
  message: "The selected passage has low guitar-idiom density.",
  location: {
    barStart: 1,
    barEnd: 8
  },
  data: {
    style: "hard-rock",
    score: 0.31,
    threshold: 0.45,
    strongestFeatures: [],
    missingFeatures: []
  }
}
```

Use the repository’s exact advisory contract rather than copying this blindly.

### CLI behavior

Recommended interface:

```bash
node tools/idiom.mjs arrangement.tex \
  --bars 1-8 \
  --style hard-rock \
  --json
```

Behavior:

* `0` for successful analysis, whether warnings exist or not;
* `2` for parsing, configuration, range, or profile errors;
* deterministic JSON;
* useful human output without `--json`;
* no automatic modification.

### Tests

For each weighted feature, provide:

* one positive fixture;
* one negative fixture.

Also test:

* tie destinations not double-counted;
* rests break appropriate runs;
* multiple voices do not merge accidentally;
* multiple tracks remain distinguishable;
* empty range;
* invalid range;
* deterministic output;
* changed style threshold changes advisory behavior;
* changed style does not alter parsed notes or hard-stage data;
* no NaN or infinity in JSON.

### False-positive priorities

Explicitly test:

* jazz-like shell chords are not criticized merely for lacking palm muting;
* metal-like power-chord passages are not criticized for lacking thirds;
* a long sustained note is not counted as repeated idiom;
* piano-like repeated block chords trigger the intended negative pressure;
* free spans are not automatically judged as mapped obligations.

---

## 7.4 Subagent Wave 3C: Soft Integration Agent

Start only after the profile and idiom APIs are stable.

### Exclusive owned files

```text
tools/check.mjs
package.json
integration tests for check
possibly tools/fingering.mjs CLI flag parsing
```

### Integration architecture

Preserve the current subprocess-oriented design unless a concrete defect requires changing it.

Recommended flow:

1. Parse CLI arguments without premature defaults.
2. Load project configuration.
3. resolve style;
4. load profile;
5. resolve final configuration;
6. run existing hard-stage commands;
7. parse hard-stage JSON;
8. if hard-stage execution was operationally successful:

   * run fingering analysis;
   * run idiom analysis;
9. normalize their advisory arrays;
10. populate:

    * `soft.fingering`;
    * `soft.idiom`;
11. preserve `soft.sidecar` for Wave 4;
12. calculate final exit from hard results only;
13. propagate analyzer operational failures as exit `2`.

### Fingering integration

The Wave 2 CLI and library already exist. Avoid duplicating its logic inside `check.mjs`.

Pass:

* the same tab file;
* the same bar range;
* applicable instrument configuration;
* JSON mode.

Initially use its existing weights. Do not invent style-specific fingering-weight semantics unless the Wave 3 contract addendum explicitly defines the `techniqueBias` subshape.

### Style and hard-result invariant

Add an integration test:

```text
same source
same target
same map
different style profile
```

Expected:

* validation result unchanged;
* playability hard result unchanged;
* comparison hard result unchanged;
* advisories may differ.

### JSON compatibility

Do not remove or rename historical hard-result fields. Add profile metadata only in an additive manner.

Recommended metadata:

```js
configuration: {
  style: "hard-rock",
  gain: "high",
  arrangementMode: "solo",
  provenance: {
    style: "default",
    gain: "profile"
  }
}
```

Only add provenance if it can be implemented without exposing unstable internal objects.

### Integration tests

Test:

* no configuration file;
* explicit `--style hard-rock`;
* config-selected style;
* CLI style overrides config;
* profile gain default;
* CLI gain overrides profile;
* fingering advisory appears in `soft.fingering`;
* idiom advisory appears in `soft.idiom`;
* soft-only findings exit `0`;
* malformed style exits `2`;
* malformed analyzer JSON exits `2`;
* missing child command or simulated child failure exits `2`;
* hard failure remains exit `1`;
* default hard output remains compatible.

---

## 7.5 Subagent Wave 3D: Adversarial Reviewer

The reviewer must not begin by editing code.

Review:

1. schema fail-closed behavior;
2. accidental CLI-default precedence;
3. hard versus soft exit semantics;
4. deterministic ordering;
5. unknown style behavior;
6. stale test snapshots;
7. analyzer crashes on empty or multi-voice passages;
8. duplicate parsing or text-level music parsing;
9. accidental score mutation.

The reviewer should add regression tests for discovered defects and return minimal corrective commits.

---

# 8. Wave 4: Harmonic Color, Sidecar Audit, and Lead Continuity

Run the three feature agents in parallel after Wave 3 is stable. Reserve shared integrations for a fourth agent.

The roadmap places harmonic flattening, sidecar-quality advisories, and excessive lead-string movement in Wave 4. These remain advisory.

---

## 8.1 Subagent Wave 4A: Harmonic Color Agent

### Suggested files

```text
tools/lib/harmonic-color.mjs
test/harmonic-color.test.mjs
test/fixtures/harmonic-color/*
```

A pure library is preferable to embedding all logic in `compare.mjs`.

### Context

Read:

* `compare.mjs`;
* digest schema;
* `harmony` and `harmonySpans[]` documentation;
* shared sidecar resolver;
* style profile;
* gain and register references.

### Scope

Detect sustained flattening of meaningful source harmonic color into root–fifth-only guitar content.

### Required semantic boundaries

1. Analyze only mapped, non-free sidecar spans.
2. Prefer `harmonySpans[]`.
3. Use coarse `harmony` only as a conservative fallback.
4. Suppress analysis where source harmonic evidence is insufficient.
5. Do not turn every omitted third into a warning.
6. Consider gain and register.
7. Reset consecutive-warning state across:

   * free spans;
   * unmapped regions;
   * source spans with no meaningful color;
   * insufficient source evidence.

### Recommended harmonic-function model

For each source harmonic slice:

1. determine root pitch class;
2. calculate pitch-class intervals relative to root;
3. classify meaningful color:

   * minor third;
   * major third;
   * minor seventh;
   * major seventh;
   * ninth where reliably represented;
4. record whether the source itself is effectively root–fifth-only.

For the proportional target slice:

1. collect target attacked and sustained pitch classes as appropriate;
2. account for transposition;
3. collect register information;
4. determine whether at least one source color function is represented;
5. distinguish:

   * literal pitch-class preservation;
   * functional interval preservation;
   * upper-register preservation.

### Gain-sensitive policy

Examples to encode in tests:

* Under high gain in a low register, omission of a third may be idiomatic and should not trigger immediately.
* A third or seventh moved to an upper-register melody note can satisfy preservation.
* Repeated flattening across the configured number of eligible slices should trigger.
* A source that contains no meaningful third, seventh, or extension should not create a color obligation.

### Profile control

Use:

```text
profile.harmonicColor.enabled
profile.harmonicColor.consecutiveSlicesBeforeWarn
```

Do not hard-code genre-specific thresholds in the analyzer.

### Output

Emit a contract-compliant advisory such as:

```text
harmony.flattened-color
```

Include:

* mapped source range;
* target range;
* consecutive eligible slices;
* source functions omitted;
* gain;
* relevant register information.

### Integration shape

Have `compare.mjs` add an advisory array to its soft map-mode output without removing existing contour-warning fields.

Preferred additive shape:

```js
soft: {
  contourWarnings: [],
  advisories: []
}
```

The `check.mjs` integration layer can then merge relevant advisory objects into its soft result.

---

## 8.2 Subagent Wave 4B: Sidecar Audit Agent

### Suggested files

```text
tools/lib/sidecar-audit.mjs
tools/sidecar-audit.mjs
test/sidecar-audit.test.mjs
test/fixtures/sidecar-audit/*
```

### Context

Read:

* sidecar contract;
* shared sidecar loader;
* digest schema;
* map-mode compare behavior;
* style profile’s free-span threshold.

### Required metrics

Implement the metrics defined by the contract module, including sorted, deterministic representations of sets and ranges.

At minimum calculate:

* mapped target bars;
* quoted or contract-preserving target bars;
* recomposed target bars;
* free target bars;
* referenced source bars;
* repeated source references;
* uncovered target bars where applicable;
* free-share ratio;
* overlap or conflict findings already prohibited by validation.

### Counting policy

Freeze and document exact category membership.

Recommended interpretation:

* quote-like category:

  * `quote`;
  * compatible contract-preserving modes.

* recompose category:

  * `recompose`;
  * contract-recompose modes.

* free category:

  * `free`.

A target bar must not be silently counted in multiple mutually exclusive summary categories unless the sidecar contract explicitly permits overlapping entries.

Repeated source references should be represented as a sorted set of source bars or ranges, accompanied by counts where useful.

### Advisory

Emit:

```text
sidecar.high-free-share
```

when the selected target range’s free share exceeds:

```text
profile.freeSpanWarnShare
```

The advisory remains soft. A fully valid map may still have a high free share.

### CLI

Recommended:

```bash
node tools/sidecar-audit.mjs \
  --digest source.digest.json \
  --map arrangement.map.json \
  --bars 1-16 \
  --style hard-rock \
  --json
```

Use shared range parsing.

### Tests

Include:

* all quoted;
* mixed quote/recompose/free;
* free share exactly at threshold;
* free share just above threshold;
* repeated source references;
* gaps;
* malformed sidecar;
* invalid source references;
* deterministic set ordering;
* no advisory for a map without excessive free share.

---

## 8.3 Subagent Wave 4C: Lead-Motion Agent

### Primary file

Extend the existing fingering library rather than creating an unrelated parser.

Suggested API:

```js
analyzeLeadStringLeaps(score, options)
```

### Detection rule

Warn when successive lead events:

* belong to the same continuous track/staff/voice stream;
* occur within a short configured time gap;
* jump more than two source-numbered strings;
* lack an articulation or rest that makes the leap intentional.

### Event policy

1. Ignore rest events.
2. Ignore tie destinations as new attacks.
3. For chords, use the lead-defining note according to a frozen rule:

   * normally highest attacked pitch;
   * do not change this dynamically by style.
4. Compare actual assigned strings, not the optimizer’s proposed strings.
5. Track each voice independently.
6. Do not connect the last note of one voice to the first note of another.
7. Use absolute timing rather than array adjacency alone.

### Suppression policy

Suppress or lower confidence for:

* a sufficiently long rest;
* slide linkage;
* hammer-on or pull-off linkage;
* explicit legato;
* phrase boundary where exposed reliably;
* tied continuation.

Emit:

```text
lead.string-leap
```

Include:

* from/to bars and beats;
* from/to strings;
* pitch movement;
* time gap;
* suppression factors considered.

### Wave 5 preparation

Accept `trackIndices` now, even though the default remains all relevant or lead-like tracks. Wave 5 will pass explicit declared lead tracks.

### Tests

Include:

* three-string leap over a short gap triggers;
* two-string leap does not;
* long rest suppresses;
* slide suppresses;
* separate voices do not interact;
* tie destination does not trigger;
* chord-to-note lead selection is deterministic.

---

## 8.4 Subagent Wave 4D: Integration Agent

Owned shared files:

* `tools/check.mjs`;
* `tools/compare.mjs`;
* `package.json`;
* integration tests.

### Integration steps

1. Add harmonic-color analysis to map-mode comparison.
2. Preserve all existing hard root-motion logic.
3. Run sidecar audit only when a map is supplied.
4. Add sidecar advisories to `soft.sidecar`.
5. Add lead-string-leap findings to `soft.fingering` or another contract-approved soft namespace.
6. Preserve exit behavior:

   * advisory-only: `0`;
   * existing hard failure: `1`;
   * operational error: `2`.
7. Ensure all arrays use stable ordering:

   * file/range order;
   * track;
   * staff;
   * voice;
   * tick;
   * advisory code.

### Wave 4 acceptance scenarios

* root motion passes but repeated harmonic flattening warns;
* high-gain low-register third omission is appropriately suppressed;
* an upper-register color tone prevents a false warning;
* a high-free-share valid sidecar warns;
* a short excessive string leap warns;
* a long rest or slide avoids that warning;
* all prior hard-gate fixtures remain unchanged.

---

# 9. Wave 5: Dual-Guitar Roles and MIDI Export

The configuration module already contains future-facing arrangement-mode and track-role fields. Build on that structure rather than creating a second configuration system. Wave 5 adds dual-guitar role semantics, role-aware checks, MIDI export, and an audio-rendering feasibility investigation.

---

## 9.1 Freeze the track-role contract

Before coding, define:

### Solo mode

* Default mode.
* Existing behavior must remain unchanged.
* Lead defaults to the historical track view.
* No rhythm track is required.

### Dual mode

* At least one lead track is required.
* At least one rhythm track is required.
* Lead and rhythm sets must be disjoint.
* Every supplied index must exist.
* Duplicate indices are normalized or rejected according to one declared policy.
* Explicit roles are never silently re-inferred.

### Role-sensitive ownership

* Melody and lead-continuity checks: lead tracks.
* Rhythm and harmonic-support checks: rhythm tracks, or lead-plus-rhythm where the contract specifies total harmony.
* Mechanical playability: every relevant guitar track.
* Sidecar target coverage: whole arrangement unless mappings become role-specific in a future contract.

---

## 9.2 Subagent Wave 5A: Track-Role Architecture Agent

### Suggested files

```text
tools/lib/track-roles.mjs
test/track-roles.test.mjs
```

Then an integration commit may modify `compare.mjs` and `check.mjs`.

### Recommended API

```js
resolveTrackRoles(score, config)
validateTrackRoles(score, roles)
```

Return a normalized object:

```js
{
  arrangementMode: "solo",
  lead: [0],
  rhythm: [],
  allGuitar: [0]
}
```

### CLI parsing

Support contract-approved flags such as:

```text
--arrangement-mode solo|dual
--lead 0,2
--rhythm 1,3
```

Absent values must remain undefined until configuration resolution.

### Refactor comparison views

The current comparison path aggregates target score data. Refactor it to construct explicit views:

```text
lead view
rhythm view
harmonic-union view
all-guitar view
```

Use:

* lead view for melodic contour;
* harmonic union or rhythm view for harmonic support;
* all-guitar view only where aggregate behavior is intended.

### Compatibility gate

In default solo mode, role-aware collection must yield equivalent comparison results to the pre-Wave-5 implementation.

Create fixture-based or structural equivalence tests before altering dual behavior.

### Tests

* solo default;
* solo explicit lead;
* valid dual roles;
* missing lead;
* missing rhythm;
* overlap;
* out-of-range index;
* duplicate index;
* CLI overrides config;
* role order normalization;
* melody present only in lead passes;
* melody present only in rhythm does not satisfy lead obligation;
* harmonic support in rhythm can satisfy the intended aggregate obligation;
* default solo outputs remain compatible.

---

## 9.3 Subagent Wave 5B: MIDI Export Agent

### Suggested files

```text
tools/export-midi.mjs
tools/lib/midi-export.mjs
test/midi-export.test.mjs
```

### Mandatory feasibility spike

Before implementing the production CLI:

1. Install dependencies with the repository lockfile.
2. Inspect the actual exports of installed `@coderline/alphatab`.
3. Identify the exact MIDI-generation API available in version 1.8.4.
4. Generate a minimal MIDI object from a parsed fixture.
5. verify that its binary API produces a `Uint8Array`.
6. Record the exact imports and API sequence in the handoff.

Official AlphaTab documentation confirms that its low-level API exposes MIDI data whose `toBinary()` method returns MIDI bytes, but the production code must be based on the concrete exports of the repository’s pinned package rather than assumptions from another release.

### CLI behavior

Recommended:

```bash
node tools/export-midi.mjs arrangement.tex \
  --out arrangement.mid
```

Optional range export should be added only if the installed API and roadmap clearly support it without manual score reconstruction.

### Implementation requirements

1. Parse via the existing `loadTex`.
2. Generate MIDI with the installed AlphaTab API.
3. Convert using the supported binary method.
4. Write atomically:

   * temporary file in destination directory;
   * rename after successful write.
5. Reject accidental source/output path collision.
6. Create parent directories only according to a declared CLI policy.
7. Do not add a second MIDI library.
8. Do not manually serialize MIDI unless AlphaTab lacks the required API.

### Tests

* generated file begins with the MIDI `MThd` signature;
* output is longer than the header alone;
* deterministic fixture export where AlphaTab output is deterministic;
* invalid input exits `2`;
* unwritable destination exits `2`;
* no partial final output after failure;
* overwrite policy is explicit and tested;
* multi-track fixture retains multiple musical tracks where supported.

---

## 9.4 Subagent Wave 5C: Audio Feasibility Agent

This is a research spike, not a production promise.

### Questions to answer

1. Can installed AlphaTab synthesize audio in the supported Node environment?
2. Does it require:

   * a SoundFont;
   * Web Audio APIs;
   * browser worklets;
   * an external output backend?
3. Can audio be rendered offline to PCM or WAV without a new required dependency?
4. Can the result sound meaningfully guitar-like, or only like a generic SoundFont instrument?
5. What are licensing and repository-size implications for any SoundFont asset?
6. Does adding this capability conflict with the no-new-runtime-dependency policy?

AlphaTab’s playback documentation depends on synthesis and SoundFont infrastructure, so feasibility must be proven locally before being placed on the production path.

### Deliverable

A short decision record:

```text
Feasible now / feasible with optional tooling / deferred
Required dependencies:
Required assets:
Environment constraints:
Prototype results:
Recommendation:
```

Do not merge placeholder production code if the result is “deferred.”

---

## 9.5 Subagent Wave 5D: Integration and Documentation Agent

### Integration steps

1. Pass normalized role information through `check.mjs`.
2. Pass lead indices into:

   * fingering analysis;
   * lead-string-leap analysis;
   * melody comparison.
3. Pass rhythm or harmonic-union indices into appropriate harmonic checks.
4. Include role labels in human-readable output.
5. Add role metadata additively to JSON.
6. Add MIDI-export documentation.
7. Update Gate A guidance for solo and dual-guitar review.

### Gate A additions

For dual arrangements, the human review should explicitly confirm:

* lead remains perceptually primary;
* rhythm guitar does not mask the lead;
* both parts are independently playable;
* register separation is sensible;
* doubled material is intentional;
* the two parts work as one arrangement rather than unrelated tabs.

---

# 10. Wave 6: Paired Fixtures, Calibration, and Final Hardening

Wave 6 is not a miscellaneous cleanup stage. It establishes whether the advisory system is useful across styles and whether the expanded orchestrator remains trustworthy. The roadmap calls for paired fixtures, cross-style calibration, full-path smoke coverage, and final documentation.

---

## 10.1 Subagent Wave 6A: Fixture and Calibration Agent

### Build paired scenario fixtures

Each scenario should contain:

```text
source AlphaTex
source digest or extraction command
target guitar AlphaTex
sidecar map where applicable
style profile
project configuration where applicable
expected hard result
expected advisory codes
notes explaining musical intent
```

Recommended scenarios:

### Jazz-oriented pair

Positive target:

* shell voicings;
* selective extensions;
* smooth upper voices;
* low reliance on palm muting;
* restrained gain.

Negative target:

* literal dense piano block chords;
* mechanically awkward grips;
* no register adaptation.

Expected calibration principle:

* absence of metal techniques is not itself a defect.

### Metal-oriented pair

Positive target:

* power chords;
* pedal tone;
* palm-muted repetition;
* controlled register;
* idiomatic riff cells.

Negative target:

* repeated full thirds in muddy low high-gain voicings;
* piano-like sustained block harmony;
* weak rhythmic identity.

Expected calibration principle:

* omitted thirds are not automatically harmonic flattening.

### Blues-oriented pair

Positive target:

* bends;
* slides;
* vibrato;
* call-and-response phrasing;
* partial chord shapes.

Negative target:

* rigid literal pitch transcription;
* no expressive articulation;
* excessive position or string discontinuity.

### Role-aware pair

* separate lead and rhythm tracks;
* melody exists only in lead;
* harmonic support exists mainly in rhythm;
* both mechanically playable.

### Sidecar pair

* one responsibly mapped arrangement;
* one valid but excessively free arrangement;
* repeated source references represented intentionally.

---

## 10.2 Fixture manifest

Create a machine-readable manifest rather than embedding every expectation in test code.

Example:

```json
{
  "name": "metal-pedal-riff-positive",
  "style": "hard-rock",
  "arrangementMode": "solo",
  "source": "source.tex",
  "target": "target.tex",
  "map": "arrangement.map.json",
  "expect": {
    "exit": 0,
    "hardPass": true,
    "advisoriesPresent": [],
    "advisoriesAbsent": [
      "idiom.low-density",
      "harmony.flattened-color"
    ]
  }
}
```

Tests should assert codes and structured fields, not complete prose messages.

---

## 10.3 Subagent Wave 6B: Calibration Reviewer

The reviewer should inspect advisory usefulness rather than merely test pass rates.

### Calibration questions

For each style and fixture:

1. Is the warning musically actionable?
2. Is it caused by the intended feature?
3. Does one root problem create excessive duplicate warnings?
4. Does changing the style remove irrelevant advice?
5. Does the analyzer remain neutral when evidence is insufficient?
6. Are thresholds stable under small harmless edits?
7. Are advisories ordered deterministically?
8. Does the result explain why it warned?

### Advisory budget

Define a practical budget for a representative valid arrangement.

A good target is not “zero warnings.” It is:

* no known false hard failure;
* few enough warnings for a human to review;
* no repeated warning for every note when one range-level warning suffices;
* clear location and evidence.

### Deduplication policy

Prefer one advisory per coherent region when:

* the same condition persists;
* intervening events do not reset the condition;
* individual-event warnings would be noisy.

Preserve event-level detail in the advisory’s data object.

---

## 10.4 Subagent Wave 6C: Regression and Performance Agent

### Full matrix

Run at least:

```text
default hard-rock / solo / bar-locked
default hard-rock / solo / map mode
explicit style / solo
project config / solo
dual-guitar / map mode
all supported style profiles
fingering CLI
idiom CLI
sidecar-audit CLI
MIDI export
```

### Determinism checks

Run representative commands twice and compare normalized JSON.

Investigate differences in:

* array ordering;
* temporary paths;
* object-key insertion order where snapshots depend on it;
* floating-point formatting;
* profile-loading order.

### Performance checks

Measure:

* parse time;
* fingering time;
* idiom extraction time;
* map comparison time;
* sidecar audit time;
* complete `check.mjs` time.

Avoid premature micro-optimization. Address:

* repeated parsing of the same score;
* accidental quadratic comparison of long event lists;
* unbounded riff-cell combinations;
* repeated profile file reads.

A later optimization may introduce an in-process shared parsed score, but only after behavior is stable and subprocess compatibility tests exist.

### Memory and scale fixtures

Include at least one longer multi-track score to expose:

* excessive event retention;
* large canonical riff keys;
* recursive traversal problems;
* advisory explosions.

---

## 10.5 Subagent Wave 6D: Documentation Agent

Update:

* `README.md`;
* `AGENTS.md`;
* CLI reference;
* configuration examples;
* style-profile reference;
* advisory-code reference;
* sidecar guidance;
* solo versus dual examples;
* MIDI-export instructions;
* troubleshooting.

Document:

1. hard versus soft semantics;
2. exit codes;
3. default profile;
4. configuration precedence;
5. every profile field;
6. every advisory code;
7. examples of interpreting analyzer evidence;
8. the fact that advisories do not rewrite scores;
9. audio-rendering feasibility decision.

---

# 11. Recommended Commit Sequence

Keep commits narrow enough to review and revert.

## Wave 3

```text
w3: freeze style and idiom contracts
w3: add fail-closed style profile loader
w3: add hard-rock profile and loader tests
w3: add idiom event extraction
w3: add idiom scoring and advisories
w3: add idiom CLI
w3: integrate fingering and idiom into check
w3: add precedence and soft-exit integration tests
w3: document style and idiom behavior
```

## Wave 4

```text
w4: add lead string-leap analyzer
w4: add harmonic-color analysis library
w4: integrate harmonic advisories into map compare
w4: add sidecar audit library and CLI
w4: integrate Wave 4 advisories into check
w4: add positive and negative fixtures
```

## Wave 5

```text
w5: add normalized track-role resolver
w5: make compare views role-aware
w5: pass roles through check and analyzers
w5: add AlphaTab MIDI export
w5: record audio-rendering feasibility
w5: document dual-guitar workflow
```

## Wave 6

```text
w6: add paired fixture manifest
w6: add jazz, metal, and blues fixture pairs
w6: add role-aware and sidecar fixture pairs
w6: calibrate thresholds and deduplicate advisories
w6: add full-path regression matrix
w6: finalize CLI and advisory documentation
```

---

# 12. Test-Gate Policy

After every subagent merge:

```bash
npm test
```

At the end of each implementation wave:

```bash
npm ci
npm test
npm run smoke
git status --short
```

Also run direct CLI tests for all newly added tools.

The orchestrator must reject a wave when:

* an old fixture changes without a written reason;
* a soft warning changes exit `0` to exit `1`;
* an operational failure is hidden as an empty advisory array;
* a profile accepts unknown keys;
* absent CLI arguments overwrite config or profile values;
* a new analyzer parses AlphaTex text independently;
* a new runtime package appears without approval;
* JSON output contains nondeterministic ordering;
* an advisory lacks both positive and negative coverage.

---

# 13. Final Definition of Done

The next stages are complete when all of the following are true:

1. Default no-config behavior remains compatible.
2. Hard-rock loads as the default profile.
3. Profile selection obeys CLI-over-config-over-default precedence.
4. Profile defaults do not override explicit gain or instrument values.
5. Fingering advisories appear in `check.mjs`.
6. Idiom advisories appear in `check.mjs`.
7. Style changes can alter soft advice without altering hard results.
8. Harmonic-color warnings use mapped harmonic evidence and account for gain and register.
9. Sidecar audit reports deterministic metrics and high-free-share advice.
10. Lead string-leap warnings respect timing, voices, rests, ties, and articulations.
11. Solo behavior remains compatible.
12. Dual mode validates explicit, disjoint lead and rhythm tracks.
13. Melody checks use lead tracks.
14. Harmonic support uses the contract-approved rhythm or union view.
15. MIDI export uses the pinned AlphaTab API and produces valid binary output.
16. Audio rendering has a documented evidence-based disposition.
17. Jazz, metal, and blues paired fixtures cover positive and negative behavior.
18. Every new advisory has a stable code and positive/negative test pair.
19. Soft findings do not cause exit `1`.
20. Operational failures cause exit `2`.
21. All output is deterministic.
22. `npm test` and smoke tests pass from a clean install.
23. Documentation describes every new CLI, configuration field, profile field, role rule, and advisory.
24. No second parser, automatic tab rewriter, or unapproved runtime dependency has been introduced.

---

# 14. Orchestrator’s Final Review Checklist

Before marking the roadmap complete, the orchestrator should personally inspect:

* configuration precedence;
* the distinction between absent and explicit CLI values;
* advisory code stability;
* hard/soft exit calculation;
* sidecar range semantics;
* source-numbered versus internal string numbering;
* tie-destination handling;
* track-role disjointness;
* solo-mode compatibility;
* profile schema closure;
* JSON determinism;
* all new package scripts;
* all documentation examples.

The final review should compare code against the contract ledger, not merely against the newest tests. Tests can encode an accidental design mistake; the contracts determine whether that test is valid.

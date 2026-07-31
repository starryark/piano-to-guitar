# Improvement Plan: Robust Arrangement from Noisy Transcribed Tabs

## Objective

Add a general noisy-transcription workflow that separates raw note evidence from the
perceptual melody contract.

The existing highest-register `melodyVoice` remains useful as a diagnostic, but it must
not automatically become the fidelity authority when an automatic transcription system
such as Basic Pitch has fragmented one performance across tracks or voices.

The improved repository should explicitly represent three layers:

| Layer | Purpose | Output |
|---|---|---|
| Raw evidence | Preserve everything parsed from every relevant voice | Existing `source.json`, extended additively |
| Perceptual foreground | Recombine fragmented voices into the recognizable musical line | `foreground.json` and `foreground-map.md` |
| Guitar contract | Define what the arrangement must preserve or intentionally relocate | `melody-contract.json` |

Existing digest fields should remain stable for backward compatibility.

---

## 1. Detect and describe transcription noise

### 1.1 Add a source-profile stage

Add:

- `tools/source-profile.mjs`
- Supporting functions in `tools/lib/analysis.mjs`

It should identify:

- Multiple pitched tracks that appear to be fragments of one instrument.
- Dedicated percussion tracks.
- Voice fragmentation caused by overlapping or rapidly alternating Basic Pitch
  allocations.
- Nearly simultaneous attacks distributed across voices.
- Short isolated octave doublings.
- Tiny tied continuation fragments.
- Suspicious group-duration envelopes.
- Cross-source agreement when multiple transcriptions are supplied.

Suggested additive digest fields:

```json
{
  "sourceProfile": {
    "kind": "noisy-transcription",
    "pitchedPerformanceGroups": [
      {
        "id": "piano-1",
        "tracks": [0],
        "voices": [0, 1, 2, 3, 4, 5],
        "reason": "shared attacks, register overlap, and motif handoffs"
      }
    ],
    "excludedTracks": [
      {
        "track": 1,
        "role": "percussion",
        "confidence": 1
      }
    ],
    "noiseSignals": {
      "voiceFragmentation": "high",
      "isolatedOctaveArtifacts": 17,
      "microTieFragments": 23,
      "overlappingForegroundCandidates": 41
    }
  }
}
```

### 1.2 Classify percussion structurally

Do not depend only on track names such as `"Drums"`.

Use:

- Percussion channel and instrument metadata.
- Unpitched staff properties.
- Drum articulation mapping.
- Lack of stable melodic pitch behavior.

Track names may remain supporting evidence, but never the sole classifier.

### 1.3 Add optional multi-source ingest

Support a project manifest:

```json
{
  "sources": [
    {
      "file": "Piano_only.alphatab",
      "role": "pitched-reference",
      "weight": 1
    },
    {
      "file": "Piano_and_Drum.alphatab",
      "role": "full-mix-reference",
      "weight": 1
    }
  ]
}
```

Proposed command:

```text
node tools/piano-extract.mjs --manifest projects/<slug>/source-set.json --out projects/<slug>
```

Cross-source agreement should increase confidence. Disagreement should remain visible
rather than being silently resolved.

---

## 2. Build an attack graph instead of selecting one voice

The present extraction:

```js
melody = topLine(notesByVoice.get(trebleV) || [], true)
```

is useful for conventional notation, but fails when Basic Pitch splits one piano
performance across voices.

### 2.1 Add `foregroundEvidence[]`

For every bar, construct an onset-oriented attack graph across every voice in the same
pitched-performance group.

Each gesture should retain:

```json
{
  "onset": 1.3125,
  "normalizedOnset": 1.25,
  "notes": [
    {
      "midi": 73,
      "name": "C#5",
      "duration": 0.25,
      "track": 0,
      "voice": 0,
      "tied": false
    },
    {
      "midi": 69,
      "name": "A4",
      "duration": 1,
      "track": 0,
      "voice": 1,
      "tied": false
    }
  ],
  "maxEnvelopeDuration": 2,
  "normalizationConfidence": 0.93
}
```

The crucial rule is that `maxEnvelopeDuration` must never be assigned automatically to
the selected upper note. A selected note's duration must come from that pitch's parsed
event or tie chain.

### 2.2 Coalesce ties before interpreting attacks

Add a parser-level tie-chain pass:

- Tie destinations are continuations, not attacks.
- Merge duration across a valid pitch-consistent tie chain.
- Record malformed or ambiguous ties.
- Never infer tie behavior solely from AlphaTex token placement.

Add fields such as:

```json
{
  "attack": true,
  "tieChainId": "b64-v4-fs5",
  "soundingDuration": 2.875,
  "notatedFragments": 4
}
```

This prevents visually plausible tie notation from silently parsing into corrupted
pitches or unintended reattacks.

### 2.3 Keep raw and normalized timing

Automatic transcription regularly produces onsets such as `0.4375`, `0.875`, and
`1.3125`.

Store:

- Raw onset.
- Normalized onset.
- Timing displacement.
- Normalization confidence.
- Whether the event belongs to a real parsed tuplet.

Do not classify every irregular offset as a tuplet. Tuplets must come from parsed tuplet
metadata or strong repeated-ratio evidence.

---

## 3. Derive perceptual foreground candidates

Add:

```text
tools/lib/foreground.mjs
```

It should score candidate lines using musical evidence rather than register alone.

### 3.1 Candidate features

Use:

- Phrase continuity.
- Repeated motif membership.
- Agreement across duplicate and returning sections.
- Agreement across multiple source transcriptions.
- Rhythmic prominence.
- Strong-beat placement.
- Pitch-specific duration.
- Singable contour.
- Continuation across voice handoffs.
- Cadential arrival behavior.
- Whether a high note is an isolated octave doubling.
- Whether a lower note continues a recurring phrase.
- Whether an event belongs to a sustained chord bed or ostinato.

### 3.2 Produce alternatives rather than pretending certainty

Example:

```json
{
  "bar": 41,
  "foregroundCandidates": [
    {
      "line": ["B4", "A4", "B4", "B4", "C#5", "A4"],
      "confidence": 0.88,
      "evidence": [
        "motif continuity",
        "return agreement",
        "cross-source consensus"
      ]
    },
    {
      "line": ["B4", "C#5", "G#4", "D#5", "C#5", "A4"],
      "confidence": 0.31,
      "warnings": [
        "isolated highest-note overlaps",
        "angular contour",
        "no recurrence support"
      ]
    }
  ]
}
```

The tool should make the evidence inspectable at Gate A instead of making irreversible
artistic decisions.

### 3.3 Detect foreground-over-accompaniment overlaps

Explicitly classify cases such as:

- A short upper punctuation over a sustained chord bed.
- A tied foreground note above later accompaniment attacks.
- A genuine upper handoff versus a lower support attack.
- An octave artifact above a coherent lower melody.

Recommended classifications:

```text
foreground
foreground-punctuation
foreground-handoff
harmonic-bed
bass-punctuation
octave-doubling
ornament
uncertain
```

---

## 4. Formalize the melody contract

The repository needs a standard schema and gate support for a project-specific
`melody-contract.json`.

### 4.1 Define a stable contract schema

Suggested form:

```json
{
  "version": 1,
  "song": "Example",
  "phrases": [
    {
      "id": "theme-a-1",
      "sourceBars": [17, 24],
      "events": [
        {
          "bar": 17,
          "onset": 0,
          "pitch": "A4",
          "duration": 0.5,
          "required": true,
          "role": "foreground"
        }
      ],
      "allowedReductions": {
        "omitConcurrentSupport": true,
        "octaveRelocation": null
      }
    }
  ],
  "relocationGroups": [
    {
      "sourceBars": [57, 64],
      "semitones": -12,
      "reason": "complete solo phrase exceeds the physical fret limit"
    }
  ]
}
```

### 4.2 Represent duration policy explicitly

Each event should distinguish:

- Exact source duration.
- Minimum sounding duration.
- Acceptable guitar sustain treatment.
- Whether a reattack is permitted.
- Whether a concurrent lower tone may replace it.

Example:

```json
{
  "pitch": "F#4",
  "onset": 1.5,
  "sourceDuration": 1.75,
  "minimumNotatedDuration": 1.5,
  "allowLetRingThroughGap": 0.25,
  "allowReattack": false
}
```

### 4.3 Add contract validation

Add:

```text
tools/contract-validate.mjs
```

It should fail on:

- Overlapping contradictory obligations.
- Nonexistent source bars.
- Impossible pitches under the declared relocation.
- Invalid duration policies.
- Relocation groups that begin or end mid-phrase without justification.
- A required event whose evidence is only a tied continuation.

---

## 5. Extend the fidelity gate

Most noisy-transcription bars currently have to be declared `free` when the digest
disagrees with the perceptual foreground. That makes the machine PASS honest but
musically under-enforced.

### 5.1 Add a contract-backed sidecar mode

Extend the sidecar with:

```json
{
  "tabBars": [55, 64],
  "mode": "contract",
  "contractPhrase": "solo-1"
}
```

Proposed meanings:

- `free`: genuinely added material.
- `quote`: existing digest skeleton and harmony behavior.
- `recompose`: existing root-motion behavior.
- `contract`: enforce project-specific perceptual events.
- Optional `contract-recompose`: contract melody with relaxed harmony.

This removes the need to use `free` for “source-tied but extractor-disagrees.”

### 5.2 Contract gate requirements

For each required event, verify:

- Pitch or permitted relocated pitch.
- Onset tolerance.
- Minimum sounding duration.
- Required repeated attacks.
- Phrase-order continuity.
- Required rests or breaths.
- Relocation-group consistency.
- Absence of forbidden accompaniment attacks.

Do not reduce this to pitch-class membership. Exact octave matters inside a relocation
group.

### 5.3 Add anti-vacuity rules

A contract span must report nonzero totals:

```text
foreground attacks   17/17
duration obligations  6/6
required gaps          4/4
relocation groups      1/1
```

A contract span with zero protected events must fail.

### 5.4 Add forbidden-event assertions

The contract should optionally prohibit:

- Bass or root ticks.
- Chords on sixteenth-note attacks.
- False-high octave artifacts.
- Reattacks inside a sustain.
- Accompaniment pitches that obscure a melody onset.

Absence of accompaniment can itself be a fidelity obligation.

---

## 6. Add parser-grounded tab inspection

Create:

```text
tools/tab-events.mjs
```

Purpose: show what alphaTab actually parsed, rather than what the AlphaTex text appears
to mean.

Example output:

```text
bar 14 onset 1.00
  C#4 duration 1.00 tieOrigin=false tieDestination=false letRing=true
  F#4 duration 1.00 tieOrigin=false tieDestination=false vibrato=true
bar 14 onset 2.00
  REST duration 0.25
```

Options:

```text
node tools/tab-events.mjs cover.alphatab --bars 14
node tools/tab-events.mjs cover.alphatab --bars 55-64 --json
```

Report:

- Parsed MIDI and pitch.
- Fret and string.
- Onset and playback duration.
- Tie origin and destination.
- Brush or arpeggio.
- Hammer, pull, and slide.
- Vibrato and let-ring.
- Tuplet ratio.
- Attack versus continuation.

This should be mandatory whenever ties, cross-bar sustains, or unusual effects are
introduced.

---

## 7. Strengthen playability policy

Noisy piano reductions need project-specific texture constraints beyond the current
general mechanical checks.

### 7.1 Add policy input

Example `guitar-policy.json`:

```json
{
  "tuning": "standard",
  "maxFret": 21,
  "gain": "crunch",
  "fastAttackMaxNotes": 1,
  "fastAttackThreshold": 0.25,
  "maxSimultaneousNotes": 2,
  "allowRolls": false,
  "allowBrushes": false,
  "allowMutes": false,
  "preferredFretSpan": 4
}
```

Pass it through:

```text
history.mjs check ... --policy guitar-policy.json
```

### 7.2 Add policy checks

Add:

- No multi-note attack at or below the configured fast duration.
- Exact physical fret limit instead of only the repository default.
- No tie destination without a compatible origin.
- No tied continuation that changes pitch.
- No rapid repeated grip.
- Optional warning when a long arrival lacks sustain treatment.
- Section-boundary register-reset audit.
- Relocation-group fret and range audit.
- Repeated-note identity checks where the contract requires distinct attacks.

### 7.3 Preserve warning cleanliness

Add:

```text
--warnings-as-errors
```

This supports automatic approval policies that require zero soft warnings.

---

## 8. Improve history and chunk workflow

### 8.1 Store analytical artifacts in history

Each snapshot should optionally include:

- `melody-contract.json`.
- `foreground.json`.
- `guitar-policy.json`.
- Gate report JSON.
- Independent-review record.

This prevents a later contract edit from silently changing what an older PASS meant.

### 8.2 Add chunk status metadata

Example:

```json
{
  "seq": 36,
  "bars": [105, 108],
  "gate": "PASS",
  "recognizability": "ACCEPT",
  "playabilityReview": "ACCEPT",
  "humanVerdict": "AUTO-APPROVED",
  "contractHash": "..."
}
```

### 8.3 Add a final-review command

```text
node tools/history.mjs final-review cover.alphatab \
  --map sidecar.json \
  --contract melody-contract.json \
  --policy guitar-policy.json
```

It should report:

- All recurring theme statements.
- Section transitions and pickups.
- Relocation groups.
- Fastest events.
- Tuplets.
- Long arrivals.
- Multi-note attacks.
- Artificial root or accompaniment events.
- Chunks lacking recognizability acceptance.

It should assemble the evidence consistently, not replace human or independent musical
review.

---

## 9. Add regression fixtures

Do not add copyrighted song material as a tracked fixture. Build small synthetic AlphaTex
fixtures reproducing each failure mode.

Suggested fixtures:

```text
tools/fixtures/noisy-basic-pitch-voices.alphatab
tools/fixtures/noisy-two-source-a.alphatab
tools/fixtures/noisy-two-source-b.alphatab
tools/fixtures/false-high-octave.alphatab
tools/fixtures/foreground-over-chord-bed.alphatab
tools/fixtures/tied-microfragments.alphatab
tools/fixtures/tie-semantics-corruption.alphatab
tools/fixtures/phrase-relocation.alphatab
tools/fixtures/repeated-note-melody.alphatab
tools/fixtures/percussion-plus-piano.alphatab
```

Required tests:

1. Artifact-split voices recombine into one foreground.
2. The highest note loses to a recurring lower melody.
3. A pitch uses its own duration, not the longest simultaneous note.
4. Tied fragments do not become attacks.
5. A malformed guitar tie is visible in `tab-events`.
6. Multiple transcriptions increase confidence for shared events.
7. A complete out-of-range phrase relocates together.
8. Repeated melody attacks are not merged.
9. Required phrase gaps cannot be filled by gate-serving roots.
10. A `contract` span with zero obligations fails.
11. Percussion is excluded structurally.
12. Existing CanonRock extraction and gates remain compatible.

---

## 10. Update documentation

Update:

- `AGENTS.md`
- `docs/workflow.md`
- `docs/gate-templates.md`
- `reference/alphatex-piano-reading.md`
- `reference/piano-to-guitar-arranging.md`
- `reference/chunk-authoring-cheatsheet.md`

Key doctrine changes:

- “Highest sounding voice” is a candidate, not perceptual truth.
- Multiple Basic Pitch voices may be one instrument.
- Track boundaries do not necessarily imply instrument boundaries.
- A note's duration comes from its own parsed event or tie chain, never the group
  envelope.
- Repeated pitches can be essential rhythmic events.
- Absence of accompaniment may be a fidelity obligation.
- Out-of-range notes are relocated by phrase group.
- Tie behavior must be confirmed from the parsed score model.
- `free` means added material, not “extractor disagreement.”
- Noisy sources require a reviewed foreground contract before drafting.

Gate A should gain a source-reliability block:

| Item | Decision |
|---|---|
| Transcription type | Clean notation or noisy automatic transcription |
| Pitched-performance groups | Tracks and voices treated as one performance |
| Excluded tracks | Percussion or unrelated material |
| Foreground authority | Digest skeleton or reviewed foreground contract |
| Ambiguous bars | Bars requiring human decision |
| Relocation groups | Complete phrases moved coherently |

---

## 11. Recommended implementation order

### Milestone 1 — Parser evidence and fixtures

- Add tie-chain extraction.
- Add `tab-events.mjs`.
- Add synthetic noisy-transcription fixtures.

Acceptance:

- Parsed attacks and continuations are inspectable.
- Malformed or pitch-changing ties are detected.
- Existing validation and smoke tests remain green.

### Milestone 2 — Attack graph

- Add `foregroundEvidence[]` without changing existing digest fields.
- Preserve raw and normalized timing.
- Preserve pitch-specific duration and tie-chain duration.

Acceptance:

- A simultaneous short upper note and long lower bed retain separate durations.
- Voice-fragmented attacks appear together in one gesture.

### Milestone 3 — Foreground analysis

- Add candidate scoring.
- Add recurrence and cross-source evidence.
- Generate `foreground.json` and `foreground-map.md`.

Acceptance:

- A recurring lower melody can outrank an isolated highest ornament.
- Competing candidates and confidence remain visible.

### Milestone 4 — Formal melody contract

- Define the schema.
- Add the validator.
- Add relocation groups and sustain policies.

Acceptance:

- Contradictory or vacuous contracts fail.
- Complete-phrase octave relocation is represented explicitly.

### Milestone 5 — Contract-backed gate

- Add the new sidecar mode.
- Enforce required attacks, gaps, durations, and forbidden events.
- Add non-vacuity enforcement.

Acceptance:

- Source-bound noisy-transcription spans no longer need `free`.
- A mechanically valid but unrecognizable line fails its contract.

### Milestone 6 — Playability policy

- Add configurable fret and texture constraints.
- Add warning escalation.
- Add fast multi-note and tie-integrity checks.

Acceptance:

- A sixteenth-note chord fails under a single-note policy.
- A tab exceeding the player's physical fret limit fails.

### Milestone 7 — History and final review

- Snapshot contracts, policies, and reports.
- Add a consolidated final-review command.

Acceptance:

- An old PASS remains reproducible against its original contract hash.
- Every chunk's mechanical and musical-review status is visible.

### Milestone 8 — Documentation and compatibility

- Update the workflow after the corresponding tools exist.
- Run all unit, smoke, and corpus tests.

Acceptance:

- Legacy clean-score projects behave as before.
- Noisy-transcription projects use the new foreground-contract path.

---

## Highest-value initial release

The most valuable first release is milestones 1–5:

1. Parser-grounded event evidence.
2. Cross-voice attack graph.
3. Perceptual foreground candidates.
4. Formal melody contract.
5. Contract-backed fidelity gate.

Together, these prevent the two central failure modes:

- Selecting the wrong melody from fragmented Basic Pitch voices.
- Declaring genuinely source-bound bars `free` because the digest cannot represent the
  perceptual foreground.

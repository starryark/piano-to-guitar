# Implementation Plan: Piano-to-Guitar Pro Ceiling Upgrade

This document is a step-by-step implementation guide for a coding agent orchestrator. It is designed to be executed in waves using specialized subagents to manage context and ensure high-quality, modular implementation. 

## Project Context & Philosophy (Do Not Rediscover)
*   **Tech Stack:** Node.js (ESM), single dependency `@coderline/alphatab`. No Python, no second parser.
*   **Architecture:** A gated toolchain. `check.mjs` runs `validate.mjs` (syntax/bar-fill) → `playability.mjs` (mechanical limits) → `compare.mjs` (fidelity to source digest). 
*   **Data Flow:** Source piano AlphaTex → `piano-extract.mjs` → `source.json` (digest) + `source-map.md`. The agent writes `cover.alphatab` and a `sidecar.json` (mapping source bars to tab spans with modes: `quote`, `recompose`, `free`).
*   **Goal:** Elevate output from "mechanically playable solo reduction" to "idiomatic, professional electric guitar tab" by adding fingering optimization, idiom detection, harmonic color tracking, and multi-track/style support.

## Subagent Strategy
The orchestrator will dispatch specialized subagents for each wave. Context payloads are strictly limited to prevent cross-contamination and context bloat. The orchestrator is responsible for running `npm test` and `npm run smoke` between waves to ensure no regressions.

---

### Wave 1: Foundations & Mechanical Fixes
**Goal:** Fix existing structural inconsistencies and hardcoded limits that restrict professional tablature.
**Subagent:** `MechanicalFixAgent`
**Context Payload:**
*   `tools/playability.mjs`
*   `tools/lib/fretboard.mjs`
*   `reference/guitar-playability.md`

**Tasks:**
1.  **Fix Warning/Error Semantics:** In `playability.mjs`, warnings (sustain, gain-voicing, position-jump-slow, pick-speed) must NOT trigger `process.exit(1)`. Only `errors[]` should fail the gate. Update the exit logic at the end of the file: `process.exit(errors.length > 0 ? 1 : 0)`.
2.  **Configurable Max Fret:** In `tools/lib/fretboard.mjs`, export a `getMaxFret(opts)` function. Update `MAX_FRET` usage to allow project-level overrides (e.g., 24-fret guitars). Read from an optional `projects/<slug>/config.json` or CLI arg `--max-fret`.
3.  **Expand Harmonic Nodes:** In `playability.mjs`, update `NAT_HARMONIC_NODES` to include `4` (and pinches/taps if a new AlphaTex annotation is added, e.g., `{ah}` for artificial). For now, include fret `4` and warn rather than error on non-standard nodes.
4.  **Hybrid Picking Model:** In `playability.mjs`, modify the `non-adjacent-strings` check. If a beat has exactly 2 notes on non-adjacent strings, downgrade from `error` to `warning` and suggest hybrid picking. If >2 notes, keep as `error`.
5.  **Pick-Speed Table:** Replace the single `PICK_CEILING_NPS` threshold with the tempo×subdivision table from `reference/guitar-playability.md` (Lines 66-73). Implement as a function `getPickSpeedLimit(tempo, duration)`.

---

### Wave 2: Fingering & Idiom Engine (The "Pro Ceiling")
**Goal:** Build the intelligence that distinguishes a pianist's voicing from a guitarist's voicing.
**Subagent:** `FretboardTheoryAgent`
**Context Payload:**
*   `tools/lib/fretboard.mjs` (specifically `positionsFor`, `spanOf`)
*   `reference/electric-guitar-voice.md`
*   `reference/guitar-fretboard.md`
*   `tools/check.mjs`

**Tasks:**
1.  **Create `tools/lib/fingering.mjs`:** 
    *   Implement a phrase-windowed position optimizer. 
    *   Input: An array of beats from `cover.alphatab`, each containing pitch sets.
    *   Output: A "fingering difficulty score" per beat and suggested string/fret reassignments.
    *   Cost function: `cost = w_pos * |position_t - position_{t-1}| + w_str * string_crosses + w_stretch * max(0, span - 3) - w_common * common_tones`.
    *   Provide a CLI wrapper `tools/fingering.mjs` that acts as a soft gate (prints advisories, never exits 1).
2.  **Create `tools/lib/idiom.mjs`:**
    *   Encode CAGED shapes, power chords, octave grips, and shell voicings as data structures.
    *   Implement `analyzeIdiomDensity(bar)`: Returns a score 0-10 on how "guitar-like" a bar is. Penalize literal block chords with no rhythmic subdivision, palm-muting, or riff-ification.
3.  **Integrate into `check.mjs`:** Add `fingering` and `idiom` as soft gates in the `check.mjs` pipeline. Their output should be printed under a "SOFT ADVISORIES" section but not affect the exit code.

---

### Wave 3: Harmonic Color & Voice Leading Metrics
**Goal:** Prevent the fidelity gate from rewarding harmonic flattening (root-fifth mush) and unmusical string leaps.
**Subagent:** `HarmonicLogicAgent`
**Context Payload:**
*   `tools/compare.mjs`
*   `tools/lib/analysis.mjs` (from `abc-to-guitar` origin)
*   `AGENTS.md` (Section A.2 regarding pcset narrowing)

**Tasks:**
1.  **Harmonic-Color Flattening Advisory:** In `compare.mjs`, add a soft signal `harmonic-flattening`. 
    *   Logic: If the source `harmony.pcset` contains a 3rd, 7th, or 9th, but the tab bar only contains root and 5th (and gain is high/crunch), track this. If it occurs for ≥4 consecutive bars, emit a soft advisory: "Sustained harmonic flattening: consider voicing color tones (3rd/7th) up the neck."
2.  **Sidecar Audit Tool:** Create `tools/sidecar-audit.mjs`.
    *   Reads `sidecar.json` and `source.json`.
    *   Calculates what percentage of the source's `melodySkeleton` falls under `quote` spans vs. `free` spans.
    *   If `free` span percentage is > 40%, warn: "High reliance on 'free' spans; fidelity gate may be evaded."
3.  **Voice-Leading/Singability Metric:** In `compare.mjs`, add a soft signal `string-leap`.
    *   Logic: Track the top-note melody line in the tab. If consecutive melody notes jump > 2 strings without a slide (`sl`), emit a soft warning: "Melody string leap > 2; consider re-voicing for singability."

---

### Wave 4: Multi-Track, Groove & Tone (Scope Expansion)
**Goal:** Break the single-solo-guitar ceiling and make the tonal doctrine audible.
**Subagent:** `ArchitectureAgent`
**Context Payload:**
*   `docs/workflow.md`
*   `tools/playability.mjs` (track iteration logic)
*   `reference/electric-guitar-voice.md`
*   `package.json`

**Tasks:**
1.  **Multi-Track Support Framework:**
    *   Update `docs/workflow.md` Gate A to allow declaring a "Rhythm" and "Lead" track.
    *   Update `tools/validate.mjs` and `tools/playability.mjs` to gracefully handle 2+ tracks (the `score.tracks` iteration already exists, but ensure `compare.mjs` checks the *union* of tracks for skeleton coverage).
    *   Update `AGENTS.md` to reflect that the "band decision" now optionally includes a rhythm track.
2.  **Style Profiles:**
    *   Create `reference/styles/` directory with JSON profiles: `hard-rock.json`, `metal.json`, `blues.json`, `jazz.json`.
    *   Each profile defines: default gain, idiom thresholds, tempo ceilings, and reduction priorities.
    *   Add `--style <name>` CLI arg to `check.mjs` to load these profiles.
3.  **Tone Playback Integration:**
    *   Add a mock `tools/render.mjs` that leverages `@coderline/alphatab`'s audio engine.
    *   Configure basic gain/tone profiles in the render config so the VS Code A/B audition sounds closer to an electric guitar. (If full amp-sim is unfeasible, document how to route MIDI to a DAW/VST for proper ear-checks).

---

### Wave 5: Corpus Diversification & Testing
**Goal:** Prove generality beyond Pachelbel's Canon.
**Subagent:** `TestEngineerAgent`
**Context Payload:**
*   `tools/fixtures/`
*   `tools/smoke.mjs`
*   `tools/lib/analysis.test.mjs`

**Tasks:**
1.  **Generate Diverse Fixtures:** Create 3 new synthetic AlphaTex piano sources representing different styles:
    *   `fixtures/jazz-ballad.source.alphatab` (extended chords, rubato).
    *   `fixtures/metal-chug.source.alphatab` (fast 16ths, power chord hits).
    *   `fixtures/blues-shuffle.source.alphatab` (triplet feel, dominant 7ths).
2.  **Update Smoke Tests:** Add these fixtures to `tools/smoke.mjs`. Ensure the new `fingering`, `idiom`, and `harmonic-color` soft gates run without crashing and produce expected advisory outputs.
3.  **Regression Pinning:** Update `tools/lib/analysis.test.mjs` to ensure the half-bar pcset narrowing fix (§A.2) still holds on the *original* Canon Rock corpus, while verifying the new harmonic-color advisory triggers correctly on the jazz fixture.

---

## Orchestrator Execution Checklist

1.  [ ] **Initialize:** Read `AGENTS.md` and `docs/workflow.md`.
2.  [ ] **Execute Wave 1:** Dispatch `MechanicalFixAgent`. Run `npm test`. Ensure `playability.mjs` exits 0 on warnings.
3.  [ ] **Execute Wave 2:** Dispatch `FretboardTheoryAgent`. Verify `tools/fingering.mjs` runs on a fixture and outputs a difficulty score.
4.  [ ] **Execute Wave 3:** Dispatch `HarmonicLogicAgent`. Verify `compare.mjs` now outputs `harmonic-flattening` and `string-leap` soft signals.
5.  [ ] **Execute Wave 4:** Dispatch `ArchitectureAgent`. Verify `check.mjs --style metal` runs. Update `docs/workflow.md` to reflect multi-track options.
6.  [ ] **Execute Wave 5:** Dispatch `TestEngineerAgent`. Run `npm run smoke`. Ensure all fixtures pass hard gates and correctly trigger the new soft advisories.
7.  [ ] **Final Review:** Commit changes. Ensure `AGENTS.md` is updated to reflect the new soft gates (Fingering, Idiom, Harmonic-Color, String-Leap) and the `--style` flag.
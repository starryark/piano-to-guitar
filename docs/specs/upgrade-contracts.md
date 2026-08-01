# Ceiling-upgrade shared contracts (orchestrator-owned)

These contracts are **owned by the orchestrator**. Any wave may *implement* against them;
no wave may unilaterally redefine them. If a contract is wrong, stop and say so — do not
fork it.

Companion to `Implement.md` (the execution plan). Read `AGENTS.md` first for orientation.

---

## C1 — Runtime

* Node.js ESM only (`"type":"module"`). No Python. No second parser.
* `@coderline/alphatab` stays the **only** runtime dependency. Adding another is
  an architectural break — refuse and report instead.
* AlphaTex remains the sole score representation. No new AlphaTex syntax may be invented;
  use what alphaTab already parses.

---

## C2 — Exit codes (all tools, new and existing)

```
0 = ran to completion; no HARD gate failed  (soft advisories may be present)
1 = a HARD musical/toolchain gate failed
2 = usage / malformed input / IO / operational failure
```

**Soft-only analyzers must never return `1`.** `fingering.mjs`, `sidecar-audit.mjs`, and
any future advisory-only tool return `0` even when they emit advisories, and `2` only for
usage/IO/parse failure.

Pre-existing trustworthy exit codes (`validate.mjs`, `compare.mjs`) are unchanged.
`playability.mjs`'s historical "exit 1 on warnings too" behavior is corrected in Wave 1
(see C7).

---

## C3 — Advisory schema (the single soft-finding shape)

Every **new** soft finding is an object of this shape. Existing `playability.warnings[]`
and `compare.soft` shapes are NOT retro-fitted (that would break pinned tests); they are
adapted at the `check.mjs` boundary instead (see C4).

```json
{
  "code": "fingering.position-jump",
  "severity": "info" | "warning",
  "message": "Large position shift in a fast phrase",
  "track": 0,
  "staff": 0,
  "bar": 14,
  "beat": 3,
  "data": { "fromPosition": 3, "toPosition": 10 }
}
```

* `code` and `message` are **required**. `severity` defaults to `"warning"`.
* `track` / `staff` / `bar` / `beat` / `data` are optional — omit when irrelevant.
* **Tests assert `code`, never prose.** Message wording is free to improve.

### Reserved code namespaces

| Namespace | Owner |
|---|---|
| `fingering.*` | Wave 2 — `tools/lib/fingering.mjs` |
| `lead.*` | Wave 4 — lead-voice analysis (lives in fingering) |
| `idiom.*` | Wave 3 — `tools/lib/idiom.mjs` |
| `pick-demand.*` | Wave 1 — `tools/playability.mjs` |
| `harmonic-flattening` | Wave 4 — `tools/compare.mjs` |
| `sidecar.*` | Wave 4 — `tools/sidecar-audit.mjs` |

A helper lives in `tools/lib/advisory.mjs` (Wave 0):

```js
export function advisory(code, message, opts = {})   // -> normalized advisory object
export function hasAdvisory(list, code)              // -> boolean (test helper)
export function groupByPrefix(list)                  // -> { fingering: [...], idiom: [...] }
```

---

## C4 — `check.mjs` soft block (stable machine shape)

`check.mjs --json` **always** emits all five keys, in every mode (bar-locked and `--map`).
Arrays, never `null`. An analyzer that did not run contributes `[]`.

```json
{
  "soft": {
    "playability": [],
    "compare":     [],
    "fingering":   [],
    "idiom":       [],
    "sidecar":     []
  }
}
```

* `soft.playability` keeps playability's native `{type, message, bar, ...}` warning shape
  (pinned by existing tests) — do not rewrite it.
* `soft.compare` is an **array of advisories** in BOTH modes. In bar-locked mode the
  existing `cmpHard.soft` object (chordQuality/density/dropped/contour) is *additionally*
  preserved verbatim under `machine.hard.compare.soft` so nothing regresses; the array is
  the derived advisory view. In map mode contour warnings and any Wave 4 findings populate it.
  Previously this key was `null` in map mode — that was the Wave 0 defect.
* Human report gains ONE trailing section (Wave 0), grouped by subsystem:

```
SOFT ADVISORIES
---------------
  playability   (2)
    ~ [sustain] Bar 4: note held 4.00 beats with no let-ring …
  compare       (1)
    ~ [harmonic-flattening] Sustained harmonic neutralization across bars 9-14 …
```

**Soft output never influences the gate result.** `GATE: PASS/FAIL` is computed from HARD
signals only, exactly as today.

---

## C5 — Configuration precedence (one rule, everywhere)

```
CLI argument  >  projects/<slug>/config.json  >  style-profile default  >  built-in default
```

`config.json` is **optional**. A project without one behaves exactly as it does today.

### `tools/lib/project-config.mjs` (Wave 1)

```js
export const CONFIG_SCHEMA_VERSION = 1;
export function findProjectConfig(anchorPath)          // -> path | null (dir of the tab, then its parents up to repo root)
export function loadProjectConfig(path)                // -> { ok, config, errors[] }
export function resolveConfig({ anchorPath, cli, styleProfile })  // -> ResolvedConfig
```

Fail closed on **unknown keys** (a typo must not silently weaken anything) — that is an
exit-2 condition at the CLI boundary, mirroring `loadPolicy()` in `playability.mjs`.

### `projects/<slug>/config.json`

```json
{
  "schemaVersion": 1,
  "style": "hard-rock",
  "gain": "crunch",
  "instrument": { "maxFret": 24, "stringCount": 6 },
  "arrangementMode": "solo",
  "tracks": { "lead": [0], "rhythm": [] }
}
```

Every field optional. Defaults:

| Field | Default |
|---|---|
| `style` | `"hard-rock"` |
| `gain` | style profile's `defaultGain`, else `"high"` |
| `instrument.maxFret` | `22` (`DEFAULT_MAX_FRET`) |
| `instrument.stringCount` | `6` |
| `arrangementMode` | `"solo"` |
| `tracks.lead` | `[0]` |
| `tracks.rhythm` | `[]` |

`gain` is a real config key and takes the full ladder — `--gain` > `config.json` >
`styleProfile.defaultGain` > `"high"`. The profile's `defaultGain` (C6) is the *genre's*
usual voice; the config's `gain` is *this arrangement's* Gate A decision and must outrank it
without the arranger retyping `--gain` on every command. Per-section changes stay `--gain`.

### `ResolvedConfig` (the normalized object every consumer reads)

```js
{
  schemaVersion: 1,
  style: 'hard-rock',
  instrument: { maxFret: 22, stringCount: 6 },
  arrangementMode: 'solo',
  tracks: { lead: [0], rhythm: [] },
  gain: 'high',
  sources: { style: 'default'|'config'|'cli', maxFret: …, … }   // provenance, for diagnostics
}
```

`sources` records where each resolved value came from — used by `--json` diagnostics and by
the "CLI overrides project config" test.

**`tools/lib/fretboard.mjs` must never read the filesystem.** Config resolution happens at
the CLI boundary; resolved limits are passed down as `opts`.

---

## C6 — Style-profile schema (Wave 3)

Files: `reference/styles/{hard-rock,metal,blues,jazz}.json`. Loader:
`tools/lib/style-profile.mjs`.

```json
{
  "schemaVersion": 1,
  "name": "hard-rock",
  "defaultGain": "crunch",
  "idiom":         { "warnBelow": 4.5, "weights": {} },
  "harmonicColor": { "consecutiveSlicesBeforeWarn": 4, "enabled": true },
  "pickDemand":    { "warnAtLevel": "hard", "maxBurstBeats": 2 },
  "techniqueBias": {},
  "freeSpanWarnShare": 0.4
}
```

```js
export const STYLE_SCHEMA_VERSION = 1;
export const KNOWN_STYLES = ['hard-rock', 'metal', 'blues', 'jazz'];
export function loadStyleProfile(name, { overrides } = {})   // -> { ok, profile, errors[] }
```

**Hard constraints style may NOT touch** (physical/structural law, not taste):

* one simultaneous fretted note per string;
* instrument fret count / fret-range legality;
* bar-fill / malformed bar duration;
* melodic-skeleton and harmonic-root fidelity gates;
* pick reachability (`non-adjacent-strings` 3+ note error);
* tie integrity.

Style profiles are **soft musical policy only**. `hard-rock` is the default and MUST
reproduce today's behavior for every existing fixture.

---

## C7 — `playability.mjs` exit semantics (Wave 1 correction)

```js
const ok = errors.length === 0;
process.exit(ok ? 0 : 1);
```

Warnings are still serialized in `warnings[]` and printed; they no longer determine process
success. The `ok` field in the JSON now means `errors.length === 0`.

`--warnings-as-errors` is unchanged: it *moves* warnings into `errors[]`, which then
legitimately drives exit 1.

`check.mjs` keeps its defensive JSON parsing and keeps gating on `errors[]`, but the
comment block and the `(exit N ignored)` report text are updated — the exit code is now
trustworthy and consistent.

**Smoke check #6 asserts the old behavior in its message text** ("exit code 1 (ignored by
check.mjs …)") — it must be updated in the same commit as this change.

---

## C8 — Sidecar semantics (UNCHANGED — extracted, not redesigned)

Wave 0 extracts `loadAndValidateMap` and friends out of `tools/compare.mjs` into
`tools/lib/sidecar.mjs` **behavior-preserving**. Every `mapUsage()` message string, every
validation order, every exit-2 condition stays byte-identical.

```js
export const SIDECAR_MODES = ['free', 'quote', 'recompose', 'contract', 'contract-recompose'];
export const CONTRACT_MODES = ['contract', 'contract-recompose'];
export function loadSidecar(path)                 // -> { ok, data, errors[] }  (parse only)
export function validateSidecar(data, ctx)        // -> { ok, entries[], contract, errors[] }
export function resolveMappedSpans(entries, range) // -> entries intersecting [lo,hi]
```

`compare.mjs` must consume these and keep its exact current error text and exit codes.
`sidecar-audit.mjs` (Wave 4) consumes the same module — one sidecar semantics, one place.

The **`free` mode has no `sourceBars` by construction.** Any metric that asks "what share of
the SOURCE is free" is ill-defined and must not be computed. See C10.

---

## C9 — Track roles (Wave 5)

```js
{ arrangementMode: 'solo',        tracks: { lead: [0], rhythm: [] } }
{ arrangementMode: 'dual-guitar', tracks: { lead: [0], rhythm: [1] } }
```

* `solo` is the **default** and its behavior is bit-for-bit what ships today.
* Roles are **track indices** into `score.tracks` (0-based), never names.
* **Never infer roles** when explicit configuration exists (explicit non-goal).
* In `dual-guitar`:
  * melodic skeleton / top-line contour / melodic ordering read the **lead** track(s) only;
  * harmonic root + pitch-class coverage read **union(lead, rhythm)**;
  * playability is evaluated **per track, independently** (traversal already does this —
    do not rewrite it; only add role labels to diagnostics).

---

## C10 — Sidecar-audit metric definitions (Wave 4)

Two disjoint spaces. Never mix them, never fabricate a source mapping for `free`.

**Tab space** (denominator = tab bars covered by the sidecar):

* `quoteTabBars`, `recomposeTabBars`, `contractTabBars`, `freeTabBars`
* `freeTabBarShare = freeTabBars / totalTabBars`

**Source space** (denominator = digest bars):

* `sourceBarsByQuote` — set of source bars referenced by ≥1 `quote`/`contract` entry
* `sourceBarsByRecompose` — referenced only by `recompose`/`contract-recompose`
* `sourceBarsUnreferenced` — referenced by no entry
* `sourceBarsMultiplyReferenced` — referenced by ≥2 entries (**a set, not a sum** — never
  double-count a repeat as extra unique coverage)

**Melody-skeleton space** (denominator = digest skeleton notes):

* each skeleton note is classified by its source bar as `covered-by-quote`,
  `covered-only-by-recompose`, or `unreferenced`.
* There is **no `free` bucket** — free spans deliberately have no source correspondence.

Advisory `sidecar.high-free-share` fires when `freeTabBarShare > profile.freeSpanWarnShare`.
Wording is informational ("verify this is intentional"), never accusatory.

---

## C11 — Compatibility invariants (any wave that breaks one has failed)

1. Current HARD pass/fail results are unchanged on every existing fixture.
2. `harmony.pcset` narrowing (`AGENTS.md` §A.2) is untouched. Harmonic-color logic reads
   `harmonySpans[]` — the additive field — and NEVER widens `harmony.pcset`.
   The width-bound test in `tools/lib/analysis.test.mjs` must keep passing unmodified.
3. Solo-guitar mode is the default.
4. A missing 3rd is **never** a fidelity failure. Harmonic-color findings are soft,
   register-aware, gain-aware, style-aware, and require *sustained* flattening.
5. No optimizer ever rewrites `cover.alphatab`. Fingering output is a recommendation.
6. Every new advisory ships with **both** a positive fixture (it fires) and a negative
   fixture (it stays quiet on normal writing).
7. `npm test` and `npm run smoke` pass at the end of every wave.

---

## C12 — Pick-demand classifier (Wave 1)

Replaces the invented `PICK_CEILING_NPS = 16` with the reference's own table
(`reference/guitar-playability.md` → "Tempo × subdivision ceiling").

```js
export function classifyPickDemand({ tempo, duration, consecutiveAttacks, articulation })
// -> { level, tempo, subdivision, consecutiveAttacks, sustained }
```

* `duration` is alphaTab's duration value (4=quarter, 8=eighth, 16=16th, 32=32nd).
  `subdivision` is derived from it: `'8th' | '16th' | '32nd' | 'other'`.
* `level ∈ 'easy' | 'moderate' | 'hard' | 'expert' | 'avoid'`.
* Table. Tempo bands are **upper-inclusive `(lo, hi]`**, boundaries 100 / 140 / 180 —
  so **100 BPM is in the first band and 180 in the third**. This reads the reference's own
  row headers literally: its first row is written "≤ 100 BPM" and its last "> 180", and
  upper-inclusive is the only resolution that gives every tempo exactly one cell while
  honouring the two rows that are unambiguous. (An earlier draft of this contract said
  `[lo, hi)`, which contradicted "≤ 100"; corrected.)

| Tempo | 8ths | 16ths | 16th-triplet / 32nds |
|---|---|---|---|
| ≤ 100 | easy | easy | expert |
| 100–140 | easy | moderate | expert |
| 140–180 | easy | hard | avoid |
| > 180 | moderate | expert | avoid |

  A `duration` of a quarter note or slower falls in an `'other'` column that is `easy` in
  every band — the table is about picking speed, and below an eighth there is no speed
  question.
* Warning threshold: `avoid` always warns; `hard` and `expert` warn only when `sustained`.
  The reference's own expert cell reads "expert, **short bursts only**" and explicitly
  sanctions runs ≤ 2 beats, so warning on every four-note flourish would bury the real cases.

  (The reference's "advanced" / "expert, short bursts only" / "no" cells map to
  `expert`/`expert`/`avoid` respectively — the burst nuance is carried by `sustained`.)
* `consecutiveAttacks` counts **genuine pick attacks** — tied continuations, tremolo beats,
  and legato destinations (hammer/pull/slide into) do not count.
* `sustained = true` when the run exceeds the reference's ≤ 2-beat burst budget
  (`profile.pickDemand.maxBurstBeats`).
* `articulation` ∈ `'picked' | 'legato' | 'tremolo'`; non-`picked` downgrades the level.

Emits `pick-demand.hard` / `pick-demand.expert` / `pick-demand.avoid` as **warnings**.
**Pick demand never fails the gate.**

---

## C13 — Harmonic-node classification (Wave 1)

```js
const RELIABLE_NAT_HARMONIC_NODES = new Set([5, 7, 12, 19]);   // today's behavior
const EXTENDED_NAT_HARMONIC_NODES = new Set([4, 9, 16, 24]);   // ring, but weakly
```

* `{nh}` on a reliable node → no finding.
* `{nh}` on an extended node → **warning** (`harmonic-node-extended`).
* `{nh}` anywhere else → **error** (`harmonic-node`, today's message).
* Artificial / pinch / tapped / semi / feedback harmonic (`at.HarmonicType.Artificial`,
  `Pinch`, `Tap`, `Semi`, `Feedback`) → natural-node validation does **not** apply.
* Read the parsed `note.harmonicType`. Do not invent AlphaTex syntax.

---

## C14 — Hybrid picking (Wave 1)

For a struck beat with simultaneous notes on **non-contiguous** strings and no
brush/arpeggio effect:

| Simultaneous notes | Outcome |
|---|---|
| 2 (a dyad) | **warning** `non-adjacent-dyad` — "Non-adjacent dyad: hybrid picking or a roll may be required." |
| 3+ | **error** `non-adjacent-strings` (today's behavior, unchanged) |

Brushed/arpeggiated beats stay exempt by construction.

**Note:** this reclassifies the existing `tools/fixtures/non-adjacent-dyad.alphatab` from
error → warning. Smoke check #6 and any test pinning that fixture must be updated in the
same commit, and a new 3-note non-adjacent fixture must take over the hard-error assertion.

---

## C15 — What no wave may do

* Automatically rewrite `cover.alphatab`.
* Introduce machine-learned fingering.
* Add a second notation parser, Python tooling, or any npm dependency.
* Weaken a core physical hard gate via a style profile.
* Infer Lead/Rhythm roles when explicit configuration exists.
* Replace human Gate A / Gate B judgment with an aggregate quality score.
* Make harmonic completeness a hard requirement.
* Claim that SoundFont/General-MIDI playback simulates amp gain or professional guitar tone.

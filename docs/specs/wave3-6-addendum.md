# Waves 3–6 contract addendum (orchestrator-frozen)

Companion to `docs/specs/upgrade-contracts.md` (C1–C15), which stays authoritative.
This file records the decisions C1–C15 left open and that Waves 3–6 need frozen
*before* code was written. Where it differs from an **example value** in the base
contract, the difference is stated and justified — never silently.

Read `AGENTS.md` first. Nothing here weakens a hard gate; everything here is soft
policy, resolution order, or event definition.

---

## A1 — Resolution order (absent ≠ default)

```
style :  --style  >  config.json "style"  >  "hard-rock"
gain  :  --gain   >  config.json "gain"   >  profile.defaultGain  >  "high"
```

**The trap this closes.** `check.mjs` used to initialise `gain` to the concrete
string `'high'` during argument parsing. That erases the difference between "the
user asked for high gain" and "the user said nothing", so a project config or a
style profile could never supply a gain — the CLI had already spoken for the user.
The same defect was latent for every future flag.

**Rule.** A CLI parser sets a value to `undefined` when the flag is absent, and
`resolveConfig` (C5) is the only place a default is applied. Validation of the
*shape* of a supplied value still happens at the CLI boundary (exit 2).

Two-stage resolution, in this order:

1. parse CLI, leaving absent values `undefined`;
2. resolve style name (CLI > config > `"hard-rock"`) — this needs a
   config read that does **not** yet consult a profile;
3. load + validate that style profile (unknown/malformed = exit 2);
4. re-resolve the full configuration *with* the profile, so `defaultGain` sits in
   the ladder;
5. keep `sources` provenance for `--json`.

Step 2 reads the config file twice in the worst case. That is deliberate: a
profile cannot be loaded before its name is known, and a name cannot be known
without the config. Reading a small JSON file twice is cheaper than a cache whose
staleness nobody can see.

### A1.1 — `hard-rock.defaultGain` is `"high"`, not `"crunch"`

C6's schema example shows `"defaultGain": "crunch"`. The **binding** sentence in
the same contract is *"`hard-rock` is the default and MUST reproduce today's
behavior for every existing fixture"*, and today's default gain is `high` —
`playability.mjs`'s `gain-voicing` advisory fires only under `high`, so shipping
`crunch` as the hard-rock default would silently delete an existing soft finding
on every default run. The example value loses to the invariant. The other three
profiles carry the gain their genre actually uses.

---

## A2 — Style-profile schema (closes C6)

```jsonc
{
  "schemaVersion": 1,
  "name": "hard-rock",
  "defaultGain": "high",                       // high | crunch | clean
  "idiom": {
    "warnBelow": 4.5,                          // 0..10, the weighted-score floor
    "minAttacks": 8,                           // below this, no verdict is issued
    "weights": { /* closed set, see A3 */ }
  },
  "harmonicColor": {
    "enabled": true,
    "consecutiveSlicesBeforeWarn": 4
  },
  "pickDemand": { "warnAtLevel": "hard", "maxBurstBeats": 2 },
  "techniqueBias": {},                         // RESERVED — see below
  "freeSpanWarnShare": 0.4
}
```

* **Every** top-level and nested key above is required, and **no other key is
  accepted** at any level. A profile is a policy document; a typo in one must not
  read as "use the default".
* `idiom.minAttacks` is an addendum field, not in C6's example. It exists because
  a weighted ratio over zero events is not a low score, it is *no measurement*,
  and a tool that cannot tell those apart will warn about an empty bar. See A3.
* `techniqueBias` is **reserved**: it must be present and must be an empty
  object. Wave 3's §7.4 forbids inventing style-specific fingering-weight
  semantics without a frozen subshape, and no subshape is frozen. Accepting keys
  into an unspecified object is how an unspecified object acquires semantics by
  accident.
* Loader: `tools/lib/style-profile.mjs`. Built-ins resolve **only** from
  `reference/styles/<name>.json`, and `name` must match `^[a-z][a-z0-9-]*$` and be
  a member of `KNOWN_STYLES`. Anything else — including anything containing a path
  separator or `..` — is an operational error (exit 2 at a CLI boundary).
* The returned profile is **deep-frozen**. Overrides are applied by
  `mergeStyleProfile(base, overrides)`, which deep-merges plain objects only,
  never merges arrays by index, and re-validates the result.

---

## A3 — Idiom event model (closes the Wave 3 §7.1 freeze)

**Attack event.** A non-rest beat carrying ≥ 1 newly attacked note. A tie
*destination* is not an attack; a tie *origin* is. Events are keyed by
`(track, staff, voice, bar, tick)` and sorted by that tuple, so output ordering is
independent of traversal order.

**Grip.** The set of simultaneously attacked notes of one event, after dropping
tie destinations, expressed as `{string, fret, midi}` in the repository's
**source string numbering** (1 = high e), the same convention `fingering.mjs`
established. Only fretted staves with standard 6-string tuning are analysed; a
`\staff { score }` (a piano source) has no grips and is skipped with a reason,
exactly as the fingering engine does.

**Denominators are explicit.** Every feature is a ratio with a named denominator:

| Feature | Numerator | Denominator |
|---|---|---|
| `powerChord` | attack events whose grip is root+5th (+opt. octave), no 3rd | multi-note attack events |
| `octave` | attack events whose grip is a pure octave dyad | multi-note attack events |
| `pedalTone` | attacks belonging to a detected pedal run | all attack events |
| `palmMutedRepetition` | attacks inside a palm-muted run of ≥ 3 | all attack events |
| `leadArticulation` | attacks carrying bend / slide / vibrato / hammer-pull | all attack events |
| `riffCell` | attacks inside a cell that recurs ≥ 2× | all attack events |
| `syncopation` | attacks landing off the beat-level grid | all attack events |
| `blockChord` | multi-note attacks that are **no recognised guitar grip** | all attack events |
| `fragmentation` | attacks shorter than a quarter note | all attack events |
| `shellVoicing` | 3-note grips with root + 3rd + 7th and no 5th | multi-note attack events |

`blockChord` subtracts *only* where the simultaneity is not a power chord, an
octave or a shell. Charging a power-chord riff — or a jazz comp — the
piano-writing penalty is precisely the false positive Implement.md §3.2 forbids.

Run detectors (palm mute, pedal) break at a rest **and** at a tie continuation:
a held note is not a repetition. `riffCell` deliberately does *not* break at a
rest — a rest is part of a rhythmic figure — and instead carries the inter-onset
intervals in its key and refuses to span a gap longer than 4 beats.

**An empty denominator yields `0` and sets `measured: false` for that feature.**
A feature that was not measured contributes nothing to the numerator *and nothing
to the denominator* of the weighted score, so "we could not look" never reads as
"we looked and found none".

**Weighted score.**

```
raw   = Σ  wᵢ · vᵢ            over measured features
posW  = Σ  max(wᵢ, 0)         over measured features, with the GRIP FAMILY
                              {powerChord, octave, shellVoicing} contributing
                              max(w) ONCE rather than its sum
score = posW > 0 ? clamp(raw / posW, 0, 1) · 10 : null
```

`score === null` means *not measured*; it is never coerced to 0. Negative weights
(`blockChord`) subtract, which is what "negative pressure" means, and the clamp
keeps a heavily piano-like passage at 0 rather than at a meaningless −3.

**Why the grip family shares one denominator slot.** The three grip features
classify the *same* event and are mutually exclusive. Summing their weights into
the denominator would mark an all-octave riff down for the power chords it did
not simultaneously play — an artefact of the arithmetic, not an opinion any
profile holds. `max(w)` asks the question that has an answer: *of this style's
recognised grips, how fully is the best-weighted one used?*

**No verdict without evidence.** `idiom.low-density` is emitted only when
`score !== null` **and** the analysed span has ≥ `profile.idiom.minAttacks`
attack events. Below that the result still reports its features; it simply
declines to grade them.

**Tier-2 discipline, in its strong form.** A shape label gets a weight only once
a calibrated fixture *pair* exists. `shellVoicing` graduated —
`tools/fixtures/idiom/jazz-shell.alphatab` fires it, `piano-block.alphatab` and
`metal-riff.alphatab` do not — and only `jazz` weights it. CAGED shapes, drop
voicings and stylistic chord-extension labels have no fixtures, so they have **no
implementation and no weight name**; a profile that tries to set one is refused
(`UNCALIBRATED_SHAPE_LABELS`, pinned by a test). Not offering the key is a
stronger guarantee than shipping a zero.

**Calibrated thresholds.** `warnBelow` is not a guess: it was measured against
`tools/fixtures/idiom/*` and set so the piano-literal fixture warns in every
style while idiomatic writing stays quiet in the style that claims it.
hard-rock 2.5, metal 3.0, blues 2.5, jazz 2.5. Wave 6 re-runs this calibration
against the paired scenario fixtures.

---

## A4 — Advisory codes added by Waves 3–5

| Code | Owner | Fires when |
|---|---|---|
| `idiom.low-density` | `tools/lib/idiom.mjs` | weighted score below `profile.idiom.warnBelow`, with enough evidence to grade |
| `harmonic-flattening` | `tools/lib/harmonic-color.mjs` | ≥ `consecutiveSlicesBeforeWarn` consecutive mapped slices whose source color (3rd/7th/9th) survives nowhere in the target |
| `sidecar.high-free-share` | `tools/lib/sidecar-audit.mjs` | `freeTabBarShare > profile.freeSpanWarnShare` |
| `lead.string-leap` | `tools/lib/fingering.mjs` | consecutive lead attacks > 2 strings apart within a short gap, with no rest/slide/legato to explain it |

`harmonic-flattening` keeps the un-namespaced code C3's table reserves for it —
`groupByPrefix` treats a dot-less code as its own namespace by design.

Every one of these ships with a positive and a negative fixture (C11.6).

---

## A5 — Track roles (closes C9 for Wave 5)

* `solo` (default): `lead = config.tracks.lead` (default `[0]`), `rhythm = []`.
  Role-aware collection **must** produce results identical to the pre-Wave-5
  aggregate path; a fixture test pins that equality.
* `dual-guitar`: `lead` and `rhythm` must both be non-empty, must be disjoint,
  and every index must exist in `score.tracks`. Duplicate indices inside one list
  are **normalized** (de-duplicated, ascending) rather than rejected — a repeated
  index states no contradiction. An index in both lists **is** a contradiction and
  is rejected.
* Views: `lead` for melodic skeleton / contour / ordering; `union(lead, rhythm)`
  for root motion and pitch-class coverage; `allGuitar` for mechanical checks.
* Roles are never inferred when configuration is explicit (C15).

---

## A6 — Determinism rules

Every array that reaches JSON is sorted by an explicit key before emission:
`(file/range, track, staff, voice, bar, tick, code)`. Sets are emitted as sorted
arrays. Floats that reach JSON are rounded at the boundary with a stated number of
places, and `-0` is normalized to `0`. Two runs of the same command produce
byte-identical JSON; a regression test in Wave 6 runs a representative matrix
twice and diffs it.

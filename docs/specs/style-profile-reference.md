# Style-profile reference — every field, and what it can and cannot do

A style profile is **soft musical policy**: how demanding a genre is about guitar
idiom, how much sustained root-fifth writing it tolerates, how long a picking
burst it considers normal, how much added material is unremarkable.

**A profile cannot touch a single physical or structural law.** Contract C6 lists
them and none of the code below is reachable from any of them:

* one simultaneous fretted note per string;
* instrument fret count and fret-range legality;
* bar fill / malformed bar duration;
* melodic-skeleton and harmonic-root fidelity;
* pick reachability (the 3+-note non-adjacent-strings error);
* tie integrity.

That is enforced structurally, not promised: a test runs the same tab and map
under all four profiles and asserts the `hard` block is bit-identical
(`tools/check.test.mjs`, `tools/smoke.mjs` check 17).

---

## Choosing one

```
--style  >  projects/<slug>/config.json "style"  >  "hard-rock"
```

An unknown or malformed style is an **operational error** (exit 2), never a
fallback. A run that grades a jazz arrangement against rock weights while
printing "jazz" is worse than a run that refuses.

```bash
node tools/check.mjs cover.alphatab --bars 1-16 --map sidecar.json --style blues
node tools/idiom.mjs cover.alphatab --style jazz
```

---

## The schema

Files live in `reference/styles/<name>.json`; the loader is
`tools/lib/style-profile.mjs`. **Every key is required and no other key is
accepted, at any level.** A profile is short, hand-written, and read by a human
deciding whether to trust a warning — "what does blues.json say about pick
demand?" must be answerable by reading blues.json, not by reading it and then
applying an inheritance chain from a module.

```jsonc
{
  "schemaVersion": 1,
  "name": "hard-rock",           // must match the filename
  "defaultGain": "high",         // high | crunch | clean

  "idiom": {
    "warnBelow": 2.5,            // 0..10 — the weighted-score floor
    "minAttacks": 8,             // below this, no verdict is issued at all
    "weights": { /* see below */ }
  },

  "harmonicColor": {
    "enabled": true,
    "consecutiveSlicesBeforeWarn": 4
  },

  "pickDemand": { "warnAtLevel": "hard", "maxBurstBeats": 2 },
  "techniqueBias": {},           // RESERVED — must be present and EMPTY
  "freeSpanWarnShare": 0.4       // 0..1
}
```

| Field | Range | Meaning |
|---|---|---|
| `defaultGain` | `high`\|`crunch`\|`clean` | the genre's usual voice. Sits *below* `config.json`'s `gain` and *below* `--gain` in the ladder. |
| `idiom.warnBelow` | 0–10 | floor for `idiom.low-density`. **Calibrated, not guessed** — see below. |
| `idiom.minAttacks` | integer | evidence floor. Below it the analysis reports its features and declines to grade them. |
| `idiom.weights.*` | −10…10 | per-feature weight. Negative = negative pressure. **Zero means the feature cannot move this style's score in either direction.** |
| `harmonicColor.enabled` | boolean | `false` skips the analysis entirely (metal: sustained root-fifth writing *is* the genre). |
| `harmonicColor.consecutiveSlicesBeforeWarn` | 1–64 | how much sustained colour loss is too much. |
| `pickDemand.warnAtLevel` | `hard`\|`expert`\|`avoid` | the reference's difficulty ceiling this genre accepts. |
| `pickDemand.maxBurstBeats` | 0–32 | how long a fast run may be before it stops being a burst. |
| `techniqueBias` | `{}` | **reserved.** Must be present and empty until a contract addendum defines its subshape. An object that accepts arbitrary keys acquires semantics by accident. |
| `freeSpanWarnShare` | 0–1 | free-tab-bar share above which `sidecar.high-free-share` fires. |

---

## The idiom weights

The closed set (`IDIOM_WEIGHTS`). A profile must state **every** one — a feature
that silently scores 0 in three genres is a calibration bug nobody sees.

| Weight | Measures | Denominator |
|---|---|---|
| `powerChord` | root+5th grips, no 3rd | multi-note attacks |
| `octave` | pure octave dyads | multi-note attacks |
| `shellVoicing` | root + 3rd + 7th, no 5th | multi-note attacks |
| `pedalTone` | a low pitch struck under changing material | all attacks |
| `palmMutedRepetition` | runs of ≥ 3 muted attacks | all attacks |
| `leadArticulation` | bends, slides, vibrato, legato | all attacks |
| `riffCell` | a 4-attack figure recurring ≥ 2× | all attacks |
| `syncopation` | off-grid attacks that anticipate or tie over | all attacks |
| `blockChord` | simultaneities that are **no** recognised guitar grip | all attacks |
| `fragmentation` | attacks shorter than a quarter | all attacks |

`powerChord`, `octave` and `shellVoicing` are **mutually exclusive** — one attack
is at most one of them — so they share a single denominator slot (`max(w)`, once).
Summing them would mark an all-octave riff down for the power chords it did not
also play on the same beat. See addendum §A3.

**Shape labels with no calibrated fixture pair have no weight name at all.**
CAGED shapes, drop voicings and stylistic extension labels are not implemented
and cannot be set; a profile that tries is refused. `shellVoicing` graduated only
once `tools/fixtures/idiom/jazz-shell.alphatab` fired it and `piano-block` /
`metal-riff` did not.

---

## The four shipped profiles

Thresholds were **measured** against `tools/fixtures/idiom/*` and re-checked
against `tools/fixtures/scenarios/manifest.json`, not chosen by feel. The
calibration target: the piano-literal fixture warns in every style, and
idiomatic writing stays quiet in the style that claims it.

| | hard-rock | metal | blues | jazz |
|---|---|---|---|---|
| `defaultGain` | high | high | crunch | clean |
| `idiom.warnBelow` | 2.5 | 3.0 | 2.5 | 2.5 |
| strongest weights | powerChord 3, riffCell 2.5 | powerChord 3.5, pedalTone 3, palmMute 3 | leadArticulation 3.5, riffCell 2.5 | shellVoicing 3, syncopation 2.5 |
| `palmMutedRepetition` | 2 | 3 | 0.5 | **0** |
| `blockChord` | −2 | −3 | −1 | −0.5 |
| `harmonicColor` | on, 4 slices | **off** | on, 3 slices | on, 2 slices |
| `pickDemand` | hard / 2 beats | expert / 4 beats | hard / 2 beats | hard / 2 beats |
| `freeSpanWarnShare` | 0.4 | 0.4 | 0.5 | 0.4 |

**`hard-rock` is the default and reproduces pre-Wave-3 behaviour exactly**,
including `defaultGain: "high"` — C6's schema example shows `"crunch"`, but
today's default gain is high and playability's `gain-voicing` advisory fires only
under high, so shipping crunch would silently delete an existing finding from
every default run. Recorded in addendum §A1.1.

Two deliberate asymmetries worth reading as intent:

* **jazz weights `palmMutedRepetition` at 0.** That is the mechanism behind "a
  clean jazz ballad is not penalised for lacking palm muting" — a zero-weighted
  feature contributes to neither the numerator nor the denominator, so its
  absence is not a deduction and it can never appear in `missingFeatures`.
* **metal disables `harmonicColor`.** A metal riff *is* sustained root-fifth
  writing. Turning the analysis off is more honest than computing it and
  suppressing the result: a reader of the JSON sees no slices, not silent ones.

---

## Overrides

`mergeStyleProfile(base, overrides)` deep-merges objects, replaces every other
value, refuses arrays outright (the schema has none, and index-merging is the
most surprising rule a merger can have), and **re-validates the result in full**
— an override cannot smuggle an unknown key or an out-of-range value past the
loader.

Returned profiles are **deep-frozen**. A consumer that mutated a shared profile
would poison every later analyzer in the same process; freezing makes that a
`TypeError` at the write rather than a wrong number three stages later.

---

## Adding a style

1. Write `reference/styles/<name>.json` with **every** field.
2. Add the name to `KNOWN_STYLES` in `tools/lib/style-profile.mjs`.
3. Add a **paired** scenario to `tools/fixtures/scenarios/manifest.json` — one
   target the style should be quiet on, one it should speak about.
4. Calibrate `warnBelow` against that pair rather than guessing it.
5. `npm test && npm run smoke`. `style-profile.test.mjs` asserts that
   `KNOWN_STYLES` and `reference/styles/` agree in both directions, so a file
   nobody can name and a name with no file both fail.

# Wave 6 advisory coverage ledger

Every finding the toolchain can produce, where it is owned, and what proves it
both **fires** and **stays quiet**. This is an inventory first and a work-list
second: the "Status" column is what was observed, not what was hoped for.

Companion documents: `docs/specs/advisory-reference.md` (what each code *means*),
`docs/specs/upgrade-contracts.md` (C1–C15), `docs/specs/wave3-6-addendum.md`
(A1–A6). Where this ledger and those disagree, they are authoritative and this
file is the bug.

---

## How coverage is tiered

**Tier A — scenario-level coverage required.** The code's correctness depends on
an *interaction*: style resolution, gain resolution, source↔target comparison,
sidecar mapping, or track roles. A unit test can prove the analyzer computes
something; only a full `check.mjs` run proves the right thing reaches the human.

**Tier B — paired unit coverage is sufficient.** The code is a narrow mechanical
judgement about one beat or one grip. A full arrangement around it adds cost and
no evidence. Tier B still requires **both** a triggering and a non-triggering
fixture (C11.6); it only declines to build a song around them.

Every code, in either tier, must have a **negative** — an input that is the same
*kind* of music and does not fire it. A corpus of positives proves only that the
tools are loud.

---

## Soft findings — C3 advisories (`code`)

| Code | Owner | Tier | Positive | Negative | Style | Gain | Role | Map | Required `data` | Dedup scope | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `fingering.better-fingering` | `lib/fingering.mjs` | B | `fingering.test.mjs` (greedy-trap) | `fingering.test.mjs` (fingering-clean) | – | – | – | – | `phrase, bars, currentCost, suggestedCost, improvement, changes, reason` | per phrase | **covered** |
| `fingering.position-jump` | `lib/fingering.mjs` | B | `fingering.test.mjs` | `fingering.test.mjs` | – | – | – | – | `fromPosition, toPosition, suggestedFrom, suggestedTo, gapBeats, occurrences` | identical jump collapses to `occurrences` | **covered** |
| `fingering.stretch` | `lib/fingering.mjs` | B | `fingering.test.mjs` (fingering-stretch) | `fingering.test.mjs` | – | – | – | – | `span, suggestedSpan, minFret, maxFret, occurrences` | identical stretch collapses | **covered** |
| `lead.string-leap` | `lib/fingering.mjs` | A | `lead-motion.test.mjs`, `check.test.mjs` | `lead-motion.test.mjs` (rest/slide/tie/let-ring/legato), scenario `blues-lead-positive` forbids it | – | – | **yes** (lead view) | – | `fromString, toString, strings, fromBar, toBar, fromNote, toNote, semitones, gapBeats, voice, considered, occurrences` | identical leap collapses | **covered** |
| `idiom.low-density` | `lib/idiom.mjs` | A | `idiom.test.mjs`, scenarios `metal-literal-negative`, `blues-literal-negative`, `jazz-flattened-negative` | `idiom.test.mjs`, scenarios `metal-riff-positive`, `blues-lead-positive` | **yes** | – | – | – | `style, score, threshold, attackEvents, barStart, barEnd, strongestFeatures, missingFeatures` | at most once per run | **covered** |
| `harmonic-flattening` | `lib/harmonic-color.mjs` | A | `harmonic-color.test.mjs`, scenario `jazz-flattened-negative` | `harmonic-color.test.mjs`, scenarios `jazz-shell-positive`, `jazz-flattened-under-metal`, `metal-riff-positive` | **yes** (metal disables) | **yes** (low 3rd under high gain exempt) | – | **yes** (map mode only) | `style, gain, consecutiveSlices, threshold, tabBars, sourceBars, omittedFunctions, evidence, slices` | one per region | **covered** |
| `sidecar.high-free-share` | `lib/sidecar-audit.mjs` | A | `sidecar-audit.test.mjs`, `smoke.mjs`, scenario `sidecar-excessively-free` | `sidecar-audit.test.mjs` (at-threshold), scenario `sidecar-responsible` | **yes** (`freeSpanWarnShare`) | – | – | **yes** | `style, freeTabBars, totalTabBars, freeTabBarShare, threshold, range` | once per run | **covered** |
| `compare.contour` | `check.mjs` (adapts compare) | A | scenario `barlocked-literal-negative`; also fires in `role-aware-swapped` | scenarios `barlocked-shell-positive`, `sidecar-responsible` | – | – | **yes** (lead view feeds the top line) | – | `r` (+ `tabBars`, `sourceBars` in map mode) | one per quote span / one per run bar-locked | **covered (Wave 6)** |
| `compare.dropped-notes` | `check.mjs` (adapts compare) | A | scenario `barlocked-literal-negative` | scenario `barlocked-shell-positive` | – | – | – | **yes** (bar-locked only) | `bar, notes` | **intentionally one per bar** | **covered (Wave 6)** |
| `compare.low-density` | `check.mjs` (adapts compare) | A | scenario `barlocked-literal-negative` | scenario `barlocked-shell-positive` | – | – | – | **yes** (bar-locked only) | `percent` | once per run | **covered (Wave 6)** |
| `compare.chord-quality` | `check.mjs` (adapts compare) | A | scenario `barlocked-shell-positive` | scenario `sidecar-responsible` (map mode never emits it) | – | – | – | **yes** (bar-locked only) | `power, exact` | once per run | **covered (Wave 6)** |
| `pick-demand.hard` | `playability.mjs` (`lib/pick-demand.mjs`) | B | `pick-demand.test.mjs`, `playability.test.mjs` | `pick-demand.test.mjs` (short burst) | **yes** (`warnAtLevel`, `maxBurstBeats`) | – | – | – | C3 advisory `data` | once per run of attacks | **covered** |
| `pick-demand.expert` | as above | B | `pick-demand.test.mjs` | `pick-demand.test.mjs` | **yes** | – | – | – | as above | as above | **covered** |
| `pick-demand.avoid` | as above | B | `pick-demand.test.mjs` | `pick-demand.test.mjs` | – (always warns) | – | – | – | as above | as above | **covered** |

## Soft findings — playability's native shape (`type`, no `code`)

C3 pins these as `{type, message, bar, …}` and forbids retro-fitting them; they
are adapted at the `check.mjs` boundary (C4). They are still soft, and they still
need both halves of a pair.

| Type | Tier | Positive | Negative | Style | Gain | Map | Dedup scope | Status |
|---|---|---|---|---|---|---|---|---|
| `non-adjacent-dyad` | B | `playability.test.mjs`, `smoke.mjs` | `playability.test.mjs` (adjacent double-stop) | – | – | – | per beat | **covered** |
| `sustain` | B | `playability.test.mjs`, every jazz scenario | `playability.test.mjs` (let-ring / re-attack) | – | – | – | **intentionally per bar** | **covered** |
| `gain-voicing` | A | `playability.test.mjs` (Wave 6), scenario `metal-literal-negative` | `playability.test.mjs` (Wave 6: clean gain, high 3rd), scenario `metal-riff-positive` | indirect (via `defaultGain`) | **yes** (`high` only) | – | per distinct low-third grip, `occurrences` | **covered (Wave 6)** |
| `harmonic-node-extended` | B | `playability.test.mjs` | `playability.test.mjs` (natural node) | – | – | – | per beat | **covered** |
| `position-jump-slow` | B | `playability.test.mjs`, scenario `role-aware-correct` | `playability.test.mjs` | – | – | – | per beat | **covered** |
| `policy-fret-span` | B | `playability.test.mjs` (Wave 6) | `playability.test.mjs` (Wave 6: within span, and no `--policy` at all) | – | – | – | per beat | **covered (Wave 6)** |

## Hard findings (`errors[]` — these exit `1`)

Not advisories; listed so the ledger is a complete inventory and so the
regression lock has a checklist. Every one is exercised by
`tools/playability.test.mjs` and pinned again by `docs/specs/wave6-regression-lock.md`.

`tie-without-origin`, `tie-pitch-changed`, `non-adjacent-strings`,
`harmonic-node`, `position-jump`, `hammer-pull-span`, `bend-string`,
`bend-fret`, `bend-depth`, `palm-mute-string`, `two-notes-one-string`,
`chord-span`, `unreachable`, `fret-range`, and the policy family
(`policy-fast-attack`, `policy-max-simultaneous`, `policy-max-fret`,
`policy-brush`, `policy-roll`, `policy-mute`, `policy-rapid-grip`).

Compare's hard gates surface as fail reasons, not typed errors:
`compare melodic skeleton`, `compare harmonic roots`, `compare melody contract`.

---

## Orphan audit

Run against `d5cfd36` (the Wave 6 pickup baseline).

**Documented but never emitted:** none.

**Emitted but undocumented:** `policy-fret-span` — emitted at
`tools/playability.mjs:507`, absent from `docs/specs/advisory-reference.md`'s
"Native playability warnings" list. *Fixed in Wave 6* (documented, and given a
fixture pair).

**Codes with no coverage at all at baseline:** `compare.dropped-notes`,
`compare.low-density`, `compare.chord-quality`, `compare.contour`,
`policy-fret-span`. The four `compare.*` codes were structurally unreachable from
the scenario corpus because **every scenario used `--map`**, and three of the
four are emitted only in bar-locked mode. *Fixed in Wave 6* by the
`barlocked-quality` pair, which is the corpus's only bar-locked pair and exists
precisely to reach them.

**Codes asserted only incidentally:** `gain-voicing` was named in the manifest
but never asserted by any unit test — the only occurrence of the string in a test
file was a *comment* in `style-profile.test.mjs`. *Fixed in Wave 6.*

**Analyzer branches unreachable through `check.mjs`:** none found.
`policy-fret-span` needs `--policy`, which `check.mjs` accepts and forwards.

**Codes with only positive or only negative tests:** none remain.

**Codes asserted by message text:** none. Every scenario expectation is a code
(C3), and `tools/lib/scenarios.test.mjs` has no prose assertion.

---

## Sensitivity summary

Read this as "if you change X, re-run the codes in that row".

| Change | Codes that may move |
|---|---|
| `--style` | `idiom.low-density`, `harmonic-flattening`, `sidecar.high-free-share`, `pick-demand.*`, and `gain-voicing` indirectly (a profile's `defaultGain`) |
| `--gain` | `gain-voicing`, `harmonic-flattening` |
| `--lead` / `--rhythm` | `lead.string-leap`, `compare.contour`, and the **hard** melodic-skeleton gate |
| `--map` present vs absent | `compare.dropped-notes`, `compare.low-density`, `compare.chord-quality` (bar-locked only); `harmonic-flattening`, `sidecar.high-free-share` (map only) |
| `--policy` | `policy-fret-span` and the six hard `policy-*` errors |
| **Nothing above** | any hard gate result. Style, gain and policy never move `ok`; roles move it only through the lead view, which is the documented point of roles. |

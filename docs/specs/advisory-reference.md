# Advisory reference — every soft finding the toolchain can produce

Soft findings never fail a gate. `GATE: PASS/FAIL` is computed from HARD signals
only (contract C4), and every tool below exits `0` whether or not it found
something. An advisory is a **question addressed to the arranger**, and the
arranger owns the answer.

If an advisory reads wrong for your music, that is usually a *style* problem, not
a *tab* problem — see `--style` and `docs/specs/style-profile-reference.md`.

**Tests assert codes, never prose** (C3). Wording here may improve; a code is a
promise.

---

## Where they appear

`check.mjs --json` always emits five soft arrays (C4), in this order, whether or
not anything ran:

```json
"soft": {
  "playability": [],   "compare": [],   "fingering": [],   "idiom": [],   "sidecar": []
}
```

* `soft.playability` keeps playability's **native** `{type, message, bar, …}`
  shape — it predates the advisory contract and C3 forbids retro-fitting it.
* The other four are C3 advisories: `{code, severity, message, track?, staff?,
  bar?, beat?, data?}`.
* An empty array means **the stage produced nothing**. A stage that could not run
  is an operational failure — exit `2` — never an empty array.
* `lead.*` rides in `soft.fingering` by design (addendum §A4): it is the same
  question about the same hand, through the same CLI.

---

## The codes

### `fingering.better-fingering` — *tools/lib/fingering.mjs*

A cheaper fingering of the **same pitches** exists. Fires only when the win
clears both an absolute and a relative floor, so ties and rounding wins are
silent.

`data`: `phrase`, `bars`, `currentCost`, `suggestedCost`, `improvement`,
`changes`, `reason`.

**Not automatically a defect.** The same pitch in two positions is two different
voices (`reference/guitar-fretboard.md` → "Where a pitch sounds best"). This
costs the *hand*, not the *voice*.

### `fingering.position-jump` — *tools/lib/fingering.mjs*

The written fingering shifts the hand more than 4 frets under time pressure, and
a cheaper path exists. Fires only inside a phrase that already has a material
suggestion — a shift with no alternative is playability's finding, not this one's.

`data`: `fromPosition`, `toPosition`, `suggestedFrom`, `suggestedTo`, `gapBeats`,
`occurrences`.

### `fingering.stretch` — *tools/lib/fingering.mjs*

A grip spans past the 4-fret window the hand covers without moving, and a
narrower voicing of the same pitches exists.

`data`: `span`, `suggestedSpan`, `minFret`, `maxFret`, `occurrences`.

### `lead.string-leap` — *tools/lib/fingering.mjs*

Consecutive lead attacks in one voice jump **more than two strings** within a
short gap, with nothing in the writing to explain it. The lead note of a chord is
frozen as the **highest attacked pitch** and never varies by style.

Suppressed by any of: a rest of ≥ 2 beats, a slide, a hammer/pull link, a tie, or
let-ring. Every suppressor is reported in `data.considered` **even when it did
not fire**, so you can see what was checked.

`data`: `fromString`, `toString`, `strings`, `fromBar`, `toBar`, `fromNote`,
`toNote`, `semitones`, `gapBeats`, `voice`, `considered`, `occurrences`.

### `idiom.low-density` — *tools/lib/idiom.mjs*

The weighted guitar-idiom score for the span is below the chosen style's
`idiom.warnBelow`. Emitted **at most once per run**.

`data`: `style`, `score`, `threshold`, `attackEvents`, `barStart`, `barEnd`,
`strongestFeatures`, `missingFeatures`.

Never emitted when the passage has too little evidence to grade — below
`profile.idiom.minAttacks` attacks the result reports `score: null` and stays
quiet. A weighted ratio over four notes is not a low score; it is no score.

`missingFeatures` only ever lists features the style **weights above zero**,
which is the structural reason jazz can never ask for palm muting.

### `harmonic-flattening` — *tools/lib/harmonic-color.mjs* (via `compare.mjs`)

`profile.harmonicColor.consecutiveSlicesBeforeWarn` or more **consecutive**
mapped source harmonies carrying real colour (3rd / 7th) are rendered as
root-and-fifth, with none of that colour anywhere in the target. One advisory per
region; the per-slice evidence is in `data.slices`.

`data`: `style`, `gain`, `consecutiveSlices`, `threshold`, `tabBars`,
`sourceBars`, `omittedFunctions`, `evidence`, `slices`.

**A missing 3rd is never a miss** (C11.4), and this code does not contradict
that. It needs *sustained* loss, and it resets at a free span, at unmapped
ground, at a source slice with no colour to lose, and at insufficient evidence.
Under **high gain in a low register** a slice that lost only a third is EXEMPT —
a low third under distortion is mud, so advising one would be wrong advice. A
lost **seventh** is never gain-excused. `metal` disables this analysis entirely.

The un-namespaced code is deliberate: C3's table reserves it that way, and
`groupByPrefix` treats a dot-less code as its own namespace.

### `sidecar.high-free-share` — *tools/lib/sidecar-audit.mjs*

More than `profile.freeSpanWarnShare` of the mapped tab bars in range are
declared `free`. Strictly greater-than: a map landing exactly on the guide is
within it.

`data`: `style`, `freeTabBars`, `totalTabBars`, `freeTabBarShare`, `threshold`,
`range`.

**Informational, never accusatory.** The map has already passed the gate; a cover
that adds an intro, a solo and an outro is supposed to have a high free share.

### `compare.contour` — *tools/check.mjs* (adapted from compare)

The tab's top line correlates negatively with the source melody — the shapes run
opposite. Inverting a line is a legitimate arranging choice; the advisory asks
for confirmation. `data.r` carries the magnitude.

### `compare.dropped-notes`, `compare.low-density`, `compare.chord-quality`

Bar-locked mode only, all **informational**. A rock reduction is supposed to be
sparse (`AGENTS.md`: "Low density is expected and good"), and a power chord
renders both major and minor correctly.

### `pick-demand.hard` / `.expert` / `.avoid` — *tools/playability.mjs*

The reference's tempo × subdivision ceiling. `avoid` always warns; `hard` and
`expert` warn only when the run exceeds the burst budget. Fires **once per run**
of attacks, not once per beat. Never gates.

### Native playability warnings (`type`, not `code`)

`sustain`, `gain-voicing`, `non-adjacent-dyad`, `harmonic-node-extended`,
`position-jump-slow`. These predate the advisory contract and keep their native
shape. `gain-voicing` is deduplicated per distinct low-third grip and carries
`occurrences`.

---

## Reading a run

A representative passing arrangement should produce **few enough findings to
read** — the scenario corpus enforces at most 12, and at most 4 of any one code
(`tools/lib/scenarios.test.mjs`). If you are seeing more than that, something is
miscalibrated; say so rather than working around it.

Ask, in order:

1. **Is it actionable?** If the advisory does not suggest a change you could
   make, it is a bug in the advisory.
2. **Is the style right?** Most false-feeling advice comes from grading blues
   writing against hard-rock weights. `--style` is one flag.
3. **Is the evidence there?** Every advisory carries a `data` object. If it
   cannot show its work, do not act on it.
4. **Is it the same finding twice?** One root problem should be one advisory with
   an `occurrences` count, not fourteen lines.

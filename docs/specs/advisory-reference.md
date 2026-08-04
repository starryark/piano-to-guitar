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
`changes`, `reason`, `occurrences`.

**Not automatically a defect.** The same pitch in two positions is two different
voices (`reference/guitar-fretboard.md` → "Where a pitch sounds best"). This
costs the *hand*, not the *voice*.

**One finding per distinct problem, across the whole run.** A cover built from a
repeated riff poses the identical question in every phrase — same reason, same
costs, same number of notes moved. Those collapse into the FIRST phrase's
finding, and `data.occurrences` carries the count; `phrase` and `bars` therefore
locate the first occurrence, not all of them. Until the 200-bar scale fixture
existed this collapse only happened *within* a phrase, and a long tab drew 32
copies of one sentence (`tools/scale.test.mjs`, `docs/specs/wave6-performance.md`).

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

**Bar-locked mode only** — with `--map`, compare speaks per entry and these three
are not computed at all. All **informational**. A rock reduction is supposed to be
sparse (`AGENTS.md`: "Low density is expected and good"), and a power chord
renders both major and minor correctly.

`compare.dropped-notes` is emitted **once per bar**, so a consumer can locate the
losses; `data.notes` keeps every pitch-class name even when the prose truncates
the list at eight. It is exempt from the corpus's per-code deduplication ceiling
for that reason. `compare.low-density` carries `data.percent` (source notes
retained) and only fires below 100%. `compare.chord-quality` carries
`data.power` / `data.exact`.

### `pick-demand.hard` / `.expert` / `.avoid` — *tools/playability.mjs*

The reference's tempo × subdivision ceiling. `avoid` always warns; `hard` and
`expert` warn only when the run exceeds the burst budget. Fires **once per run**
of attacks, not once per beat. Never gates.

### Native playability warnings (`type`, not `code`)

These predate the advisory contract and keep their native `{type, message, bar, …}`
shape (C3 forbids retro-fitting them). All six are soft.

| `type` | Fires when | Notes |
|---|---|---|
| `sustain` | a note is held past the guitar's decay with no `{lr}`, `{tp}`, `{v}` or re-attack | **per bar by contract** — a reader wants to know which bars |
| `gain-voicing` | a 3rd sounds over a root **below G3** under **high** gain | deduplicated per distinct low-third grip, carries `occurrences` |
| `non-adjacent-dyad` | two struck notes on non-adjacent strings, no brush/arpeggio | hybrid picking is an ordinary technique, so this is a decision, not a defect. **Three or more** is a hard error |
| `harmonic-node-extended` | a natural harmonic at fret 4 / 9 / 16 / 24 | the reliable nodes (5/7/12/19) are silent; anywhere else is a hard error |
| `position-jump-slow` | the hand shifts more than 5 frets, but with time to do it | the same shift under time pressure is playability's hard `position-jump` |
| `policy-fret-span` | a grip spans more than the project policy's `preferredFretSpan` | needs `--policy` to exist at all; **strictly greater-than**, so a span landing exactly on the preference is within it |

`policy-fret-span` is the only soft member of the `policy-*` family — the other
six (`policy-fast-attack`, `policy-max-simultaneous`, `policy-max-fret`,
`policy-brush`, `policy-roll`, `policy-mute`, `policy-rapid-grip`) are hard errors
that exit `1`. A *preferred* span is a preference; a policy **maximum** is a rule.

---

## What each code is sensitive to

If a finding reads wrong, this table says which knob to reach for. **Nothing here
moves a hard gate except roles**, and roles move it only through the lead view,
which is the documented point of roles.

| Code | Style | Gain | Roles | `--map` | `--policy` | Safe to ignore deliberately? |
|---|---|---|---|---|---|---|
| `fingering.better-fingering` | – | – | – | – | – | **Often.** It costs the *hand*, not the *voice*: the same pitch in two positions is two instruments |
| `fingering.position-jump` | – | – | – | – | – | Yes, if the shift is the phrasing you want |
| `fingering.stretch` | – | – | – | – | – | Yes, if your hand covers it |
| `lead.string-leap` | – | – | **yes** | – | – | Yes, if the leap is the gesture. Check `data.considered` first — it lists every suppressor that was tested |
| `idiom.low-density` | **yes** | – | – | – | – | Only after checking the style is right. Grading blues against hard-rock weights is where most false-feeling advice comes from |
| `harmonic-flattening` | **yes** (metal disables it) | **yes** (a low 3rd under high gain is exempt; a lost 7th never is) | – | **map only** | – | Yes for a deliberate power-chord reduction — but it needs *sustained* loss to fire at all |
| `sidecar.high-free-share` | **yes** | – | – | **map only** | – | **Usually.** A cover with an intro, a solo and an outro is supposed to have a high free share |
| `compare.contour` | – | – | **yes** | – | – | Yes — inverting a line is a legitimate arranging choice; it asks for confirmation |
| `compare.dropped-notes` | – | – | – | **bar-locked only** | – | Yes. Reduction is the job |
| `compare.low-density` | – | – | – | **bar-locked only** | – | Yes — informational. "Low density is expected and good" |
| `compare.chord-quality` | – | – | – | **bar-locked only** | – | Yes — informational, and a missing 3rd is never a miss |
| `pick-demand.*` | **yes** | – | – | – | – | Your call; it is the reference's table, not a verdict on you |
| `sustain` | – | – | – | – | – | Yes for a deliberately decaying note |
| `gain-voicing` | indirect (via a profile's `defaultGain`) | **yes** (`high` only) | – | – | – | Yes if you want the mud. The remedy is to move the 3rd up an octave or drop it |
| `non-adjacent-dyad` | – | – | – | – | – | Yes if you are hybrid picking |
| `harmonic-node-extended` | – | – | – | – | – | Yes if your instrument speaks there |
| `position-jump-slow` | – | – | – | – | – | Yes |
| `policy-fret-span` | – | – | – | – | **yes** | Yes — it is *your* policy |

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

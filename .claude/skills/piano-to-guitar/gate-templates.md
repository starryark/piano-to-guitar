# Gate presentation templates

Copy-paste these; fill the brackets. Nothing here is optional decoration — each
block maps to a Critical Rule in `SKILL.md`.

## Gate A — Arrangement Plan (before any tab is written; HARD STOP for approval)

```
## Arrangement Plan: <song>

| Parameter | Choice | Why |
|---|---|---|
| Key | <source key> → <target key> (<±N>) | <what the target key puts on open strings; cite the candidate table you filled> |
| Tuning | <Standard E, unless justified> | <why standard cannot reach a required low root, if proposing otherwise> |
| Tempo | <proposed target BPM; the source tempo is the reference point, not a lock> | <the musical reason for any move; a mid-song \tempo dip is its own decision — carry it only if the arrangement keeps that ritardando as an event> |
| Gain / tone | <high \| crunch \| clean> | <what the material needs — definition, weight, or clarity> |
| Section map | <section (bars N-M) → guitar role> · … | roles derived from analysis/<name>-map.md sections[] |
| Right-hand identity | <which remedy from the remedy set, and why this texture> | per piano-to-guitar-arranging.md → "The remedy set" |
| Technique palette | <the devices this piece actually needs> | per piano-to-guitar-arranging.md + electric-guitar-voice.md |
| Deliberate losses | <what the reduction drops, per section> | <why one guitar cannot hold it; what is kept instead> |

Every cell must be derived from this source's map — a value carried over from
another arrangement is not a plan. `<±N>` in the Key row is the `--transpose`
value for check.mjs; zero is a legitimate answer.

**Tempo, groove, and form are Gate A decisions, not inheritances from the
source.** You propose a target tempo, a feel, and a section form; they are
locked only once the human approves them. After approval, Critical Rule 2
applies — any change to an approved key/tuning/tempo/layout requires a
`PROPOSAL:`. Mid-song tempo changes still need their own approval (see the
Tempo row). Fill the **Form plan** and **Groove plan** tables below alongside
this one.

⚠️ **HARD STOP.** Do not write any tab, present any chunk, or run check.mjs on
a draft until the human explicitly approves this plan. "Looks reasonable, go
ahead" is approval; silence is not — if you have heard nothing, you are still
waiting at this gate.

Approve to start drafting chunk 1 (bars <N>-<M>)?
```

### Transposition candidate table (general guitar craft)

> ⚠️ **This table is general craft, NOT derived from the CanonRock corpus — every
> file in this corpus stayed in D (six files, all D major / B minor, none
> transposed).** Fill it when the source is *not* already in a guitar-friendly
> key. When the source is already in D (or another open-string key), the
> legitimate answer is ±0 — do not move a key that already sits well.

Fill one row per candidate target key, then pick:

```
| Candidate key | ±N from source | Tonic open string? | Dominant open string? | Lowest bass after fold | Verdict |
|---|---|---|---|---|---|
| <key, e.g. E> | <+N> | <E low/open, yes/no> | <B open, yes/no> | <pitch, must be ≥ E2> | <keep / reject + why> |
| <key, e.g. D> | <0> | <D open 4th-string, yes> | <A open 5th, yes> | <D2> | <keep — open-string tonic+dominant> |
| … | | | | | |
```

Pick the candidate that puts tonic **and** dominant on open strings while
keeping the octave-folded bass at or above E2. If none beats ±0, transpose by
zero. The signed `±N` becomes `check.mjs --transpose N`.

## Gate A — Form plan (table to fill alongside the arrangement plan)

```
## Form plan: <song>

| Section | Bars (tab) | Source bars? | Mode | Texture |
|---|---|---|---|---|
| <intro / theme / verse / chorus / breakdown / solo / outro> | <tab bar range> | <source bar range, or "—" for added> | <free \| quote \| recompose> | <riff / lead / reinforced / arpeggiated / pedal / climax> |
```

The **Mode** column is the sidecar contract: `free` = no fidelity gate on that
span (added material — the guitar's own contribution); `quote` = in-order
skeleton + root motion protected; `recompose` = root motion only protected.
Each span becomes one entry in the sidecar you later pass to
`check.mjs --map`. Additions are first-class — `free` spans are named here at
the gate, not smuggled in later.

When `analysis/<name>-map.md` reports a Harmonic loop (`harmonicLoop`), plan
pass-by-pass texture escalation — one texture per pass, escalating toward the
climax. See `reference/rock-riff-construction.md` → "Passes over a loop".

## Gate A — Groove plan (table to fill alongside the arrangement plan)

```
## Groove plan: <song>

| Parameter | Choice | Why |
|---|---|---|
| Target BPM | <N> | <musical reason; the source tempo is a reference, not a lock> |
| Harmonic rhythm | <source's chords per bar vs. the tab's> | <a slow source chord may own a full bar of riff at doubled tempo — see piano-to-guitar-arranging.md → "Re-metering the groove"> |
| Feel | <straight \| shuffle \| gallop> | <what the material wants> |
```

Harmonic rhythm is a Gate A decision, not inherited from the source: a piano
half-note or whole-note harmony can legitimately become a full bar of guitar
riff at doubled tempo. See `reference/piano-to-guitar-arranging.md` →
"Re-metering the groove".

## Gate B — Chunk presentation (only after check.mjs --map passes)

```
## Bars <N>-<M> of tabs/<name>.alphatab   (check.mjs --map: PASS)

Intent: <one sentence tying this chunk to its section role from the plan>

<the alphatex snippet>

--- check.mjs fidelity report ---
Bars <N>-<M> vs source (transpose <±N>, mode <free|quote|recompose>)
  melodic skeleton   <X>/<Y>   OK
  harmonic roots     <X>/<Y>   OK
  chord quality      <n> power-chord (major/minor neutral), <m> exact
  density            <P>% of source notes retained
  contour            <r> correlation with source top line
  dropped            bar <N>: <pitch names>
                     bar <M>: <pitch names>

What I dropped and why: <name the losses; tie to the plan's deliberate-losses row>
Listen for:
- <pointer 1>
- <pointer 2>

Audition: open tabs/<name>.alphatab in VS Code (alphaTab extension), or play
out/<name>.mid against out/<source>.mid.
Verdict? APPROVED / REVISE (tag + why) / PROPOSAL (param change)
```

This block is presented **only after** `check.mjs --map <sidecar>` has passed.
No tab is shown to the human until check.mjs passes (Critical Rule 1).

## PROPOSAL — change to an approved param (key / tuning / tempo / track layout)

```
PROPOSAL: <param> <current> → <proposed>.
Reason: <musical reason tied to the material — what specifically improves and why
it cannot be achieved without this change>.
Impact: <what must be re-arranged as a consequence — bars affected, re-transpose>.
Approve?
```

A wish for "variety," "heaviness," or an easier fingering is not a reason.

## Fidelity report block (mirrors compare.mjs; hard gates vs soft signals)

```
Bars <N>-<M> vs source (transpose <±N>, mode <free|quote|recompose>)
  melodic skeleton   <covered>/<total>   OK|FAIL   ← HARD GATE (must be OK)
  harmonic roots     <covered>/<total>   OK|FAIL   ← HARD GATE (must be OK)
  chord quality      <n> power-chord (major/minor neutral), <m> exact   ← soft
  density            <P>% of source notes retained                      ← soft (low is expected)
  contour            <r> correlation with source top line               ← soft
  dropped            bar <N>: <names>   ← soft: the reduction's losses, per bar
                     bar <M>: <names>
```

Both hard gates must read OK before you present — check.mjs exits non-zero
otherwise. The soft signals are information for the human's verdict: a low
density or a long dropped list is normal for a rock cover, not a defect. Name
the losses; do not chase 100%.

A 0/0 covered/total is a trivial PASS (the fail-open trap): always assert the
totals are non-zero before trusting a row. An empty span or a lost digest
field will otherwise report success while protecting nothing.

## Log entry format (`logs/<song>-sessions.md`)

```
## <date> session
- Gate A: approved (<source key>→<target key> <±N>, <tuning>, <N> BPM, <gain>, <k> sections)
- Bars <N>-<M> (<section role>): APPROVED
- Bars <N>-<M> (<section role>): REVISE (<tag>: "<what the human heard>") → <what changed> → APPROVED
- Bars <N>-<M> (<section role>): REVISE (lost-the-melody: skeleton <x>/<y> in bar <N>) → <fix> → APPROVED
- PROPOSAL <param> <current>→<proposed>: REJECTED (<reason>)

Record what the human decided and why. A machine-gate PASS is not a verdict —
note explicitly where a chunk passed check.mjs but has no human sign-off yet.
```

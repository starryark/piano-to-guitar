# Piano to Guitar Arranging

The reduction craft: how to get from a two-staff piano AlphaTex source to a single electric
guitar part that sounds like it was written for the instrument. Read this before writing
any bar of an arrangement, and re-read [The translation table](#the-translation-table)
whenever a specific piano gesture has you stuck. For *why* the guitar behaves this way see
[electric-guitar-voice.md](electric-guitar-voice.md); for what to build out of the reduced
material see [rock-riff-construction.md](rock-riff-construction.md). For the worked example
on this corpus see [case-canon-rock.md](case-canon-rock.md); for how to read the piano
source itself see [alphatex-piano-reading.md](alphatex-piano-reading.md).

## Range reality

**A piano score does not fit the guitar.** This is the governing constraint of the whole
project and it is not negotiable by cleverness.

| | Written range | Sounding |
|---|---|---|
| Guitar, standard tuning | E3–E6 (D7 at fret 22) | **E2–E5** (D6) — guitar sounds an octave below written |
| Your source | read `pitchRange` from the digest | read `rangeDeficit` — **note counts** outside the window, not semitones |

A piano piece typically spans **five to six octaves**. The guitar covers **three**. Expect
a deficit of around two and a half octaves of music that has to go somewhere else or not
exist — and confirm the real figure from your own map before planning around it. An
`\ottava` (8va) passage sits even higher than the written range suggests.

So every output of this project is an **arrangement with deliberate losses**. Making those
losses musical rather than mechanical is the project's entire job. An arrangement that
mechanically octave-folds everything into range is a failure even when every pitch is
present; an arrangement that throws away half the notes and sounds like a guitar part is a
success.

**Octave-folding policy**, applied in this order:

| Situation | Policy |
|---|---|
| Bass below E2 (`E,,` and lower) | Fold **up** one octave. Deep pedal notes (`F,,,`, `E,,,`, `B,,,`) all become string-6 territory. |
| Material between E2 and E5 | Leave it. This is the guitar's home and where the arrangement actually lives. |
| Melody above E5, no `8va` | Drop an octave, **or** move to strings 1–2 at frets 12–19 where the neck humbucker sings — see [pickups and register](electric-guitar-voice.md#pickups-and-register). |
| `8va` material | Do **not** reproduce. Re-conceive as *the climax* — a bend-and-hold with vibrato at the top of string 1 is a bigger event than a literal C7 the guitar cannot play. |

```alphatex
:1 17.1{v b (0 4)} |
```

That is A5 bent a whole step to B5, held a full bar with vibrato — the highest structural
pitch in the arrangement, arrived at once. An `\ottava` block chord like `(1.2 2.1 3.1 4.1).8`
becomes *this*, not a transposition of it.

**Corollary:** never let octave-folding collide the bass into the melody. If folding the
root up puts it inside the melody's register, you have lost the texture; drop the melody an
octave instead, or thin the chord to a fifth so the collision reads as a power chord.

## The reduction ladder

Apply in order until the material fits the hand **and sounds native**. Stop at the first
rung that satisfies both — the ladder is not a checklist to run to the bottom.

1. **Identify the melody.** Usually the top voice of staff 1 (the RH). **It is the product.**
   Everything below is service. If you are unsure which line is the melody, you are not
   ready to arrange the passage.
2. **Identify the bass root.** The lowest note of staff 2 (the LH), octave-folded into range
   per [Range reality](#range-reality). Roots, not bass *lines* — the source's LH figuration
   is usually one chord spelled across eight sixteenths.
3. **Everything between is negotiable.** Keep at most **one** colour tone (the 3rd or the
   7th, not both). Under high gain, drop the 3rd as well —
   [why distortion forbids low thirds](electric-guitar-voice.md#why-distortion-forbids-low-thirds).
4. **Drop in this order:** octave doublings → 5ths → 9ths and inner voices. Octave
   doublings are free to delete; the piano used them for weight, and gain supplies weight
   on the guitar for nothing.
5. **If the result is still a five-note stack, it is not a guitar part.** Re-voice as
   melody + power chord, or melody + octave. Do not proceed with the stack.

Rung 5 is the one that gets skipped. A six-note chord that is *technically fingerable* is
still wrong if the piece is at 76 BPM with gain on it.

Role assignment comes *before* the ladder at section scale: decide what the guitar **is**
in this section (riff, lead line, reinforced chorus, breakdown) per
[the single-guitar section form](rock-riff-construction.md#the-single-guitar-section-form),
then reduce within that decision. Reducing without a role produces mush.

## Re-metering the groove

The source's harmonic rhythm is **not** inherited — it is a Gate A decision. A piano
half-note or whole-note harmony is a *sustain* decision on the piano, made because a
piano's sound decays. On a guitar under gain, that same harmony can legitimately own a
**full bar of riff at doubled tempo**: the palm-muted pedal point supplies the sustain,
and the rhythm section supplies the motion the piano never had. A 76 BPM source with one
chord per bar can become a 152 BPM guitar part with eight palm-muted eighths of the same
root per bar — same harmony, different feel, and the *reason* a "Canon in D" can become
"Canon Rock" without losing the progression.

Concretely: when the digest shows a slow chord (one `harmony` entry spanning a whole or
half bar in the source), ask at Gate A whether that bar should become (a) a sustained
dyad at the source tempo, (b) a palm-muted ostinato at the source tempo, or (c) a
re-metered riff at 2× the source tempo. The choice is musical and goes in the **Groove
plan** row "Harmonic rhythm" (source's chords per bar vs. the tab's).

This is also where the **two-bar cell** earns its keep: a re-metered groove wants the
A A A A′ phrasing in [the two-bar cell](rock-riff-construction.md#the-two-bar-cell), and a
source whose digest reports a `harmonicLoop` wants the per-pass escalation in
[Passes over a loop](rock-riff-construction.md#passes-over-a-loop). Re-metering is what
turns a bar-locked reduction into a Canon-Rock-shaped cover.

## The translation table

The operational heart of the project. Look up the piano gesture, write the guitar
rendering. Effect codes are AlphaTex; note effects (`pm`, `lr`, `h`, `b`) go **inside**
chord parens, beat effects (`bd`, `bu`, `au`, `tp`) go after the closing paren.

| Piano source | Native electric guitar rendering |
|---|---|
| Rolled/arpeggiated chord | strum `{bd}`/`{bu}`, or `{au}` arpeggio, or picked let-ring `{lr}` |
| LH alberti / broken chord | palm-muted 8th ostinato on the root, or open-string pedal point |
| Sustain pedal | `{lr}` + high-gain sustain + vibrato; **do not** re-strike every beat |
| Long held chord | tremolo pick `{tp}`, or let-ring, or bend-and-hold with vibrato |
| Block chord under melody | melody note + power chord below, or octave shape |
| Dense inner voices | **delete them** — root, melody, one color tone |
| Wide leap | tapping `{tt}`, octave displacement, or omit |
| RH octave doubling | octave shape (root + octave, muted string between) |
| Piano dyad (3rd/6th) | double stop on adjacent strings — the Chuck Berry / Hendrix device |
| `8va` climax above range | play an octave lower, or re-voice as a bend/whammy peak |
| Rapid 16th run | legato `{h}`/`{sl}` fragment, or thin to the structural notes |

Four rows worked. The source fragments are ordinary piano idioms; the guitar
renderings are one good answer each, not the answer — re-derive yours in your key.

**Rolled chord + block chord under melody.** A bar like a rolled `(0.6 2.5 2.4 1.3 0.2).4`
followed by the melody `16.2.4{v} 15.2.4{v} 16.2.4{v}`, rendered in a key whose tonic
sits on an open string:

```alphatex
(0.6 2.5 2.4 1.3 0.2).4{bd} 16.2.4{v} 15.2.4{v} 16.2.4{v} |
```

The roll becomes a downstroke brush; the melody moves to string 2 at frets 15–16, in the
neck-humbucker singing register, with vibrato on every held note.

**LH broken chord.** A left hand like `(0.1 2.0 2.2 3.0 3.2 4.0 3.0 3.2 2.2 2.0).16` — one
chord spelled across sixteenths, spanning two and a half octaves — reduced to root and fifth:

```alphatex
:8 4.6{pm} 4.6{pm} 6.5{pm} 4.6{pm} 4.6{pm} 4.6{pm} 6.5{pm} 4.6{pm} |
```

Two pitches replace sixteen. The piano's figuration was *how a piano sustains a chord*;
palm muting is how a guitar does the same job, and it supplies rhythm the piano version
did not have. See [the pick](electric-guitar-voice.md#the-pick).

**Piano dyad.** A vamp that is already a chain of parallel thirds — `(8.2 7.1) (6.2 5.1)
(5.2 3.1) (3.2 1.1) (8.2 7.1) (6.2 5.1) (10.2 10.1)`, here in 7/4 — can land on adjacent
strings 1–2 in standard tuning with no transposition at all. Check whether yours does
before transposing anything:

```alphatex
\ts (7 4) :4 (8.2 7.1) (6.2 5.1) (5.2 3.1) (3.2 1.1) (8.2 7.1) (6.2 5.1) (10.2 10.1) |
```

**RH octave doubling.** The octave shape needs the intervening string muted, because a
strum crosses everything between —
[what the pick makes hard](electric-guitar-voice.md#what-the-pick-makes-hard):

```alphatex
:8 (10.5 12.3) r.8 (10.5 12.3) r.8 (12.5 14.3).4 r.4 |
```

**Sustain pedal.** A pedal-heavy source can carry hundreds of sustain-pedal on/off pairs —
count yours (`grep -ci "pedal\|sustain" <source>.alphatab` on the raw file; none of the six
CanonRock sources carry any, so this is craft for future sources, not a corpus case). When
pedal is that dense it is the piece's dominant texture, not an ornament.
The wrong answer is to re-strike a chord on every beat to "keep it ringing"; the amp
already does that. See
[sustain answers the sustain pedal](electric-guitar-voice.md#sustain-answers-the-sustain-pedal).

```alphatex
:1 (0.6{lr} 2.5{lr} 2.4{lr}) |
16.2.1{v} |
```

## Arpeggio ballads & flatpick playability (hard-won)

For a piece whose texture *is* a rolling broken chord under a sung melody (a rolled-chord
/ alberti ballad), **do not flatten each bar into a struck two-note dyad.**
Two failures recur and a human ear rejects both:

1. **A struck dyad on non-adjacent strings is unplayable with a flatpick.** `(0.6 5.2)`
   (6th + 2nd string) or `(2.6 2.1)` (6th + 1st) cannot be sounded cleanly with a pick —
   the pick crosses and rings the strings in between. **`playability.mjs` catches this as
   of WP7** (the `non-adjacent-strings` error fires on any struck beat with ≥2 notes on
   non-adjacent strings and no brush/arpeggio effect), so the gate now rejects it — but
   you still must design the right hand yourself. Only a *brush across all the strings*
   (`{bd}`/`{bu}`), an *arpeggio roll* (`{au}`/`{ad}`), or an *adjacent* double-stop is a
   legal simultaneous pick attack.
2. **Merging the roll and the fast runs throws away the melody.** Collapsing a rolled
   chord like `(0.3 2.2 1.0)` (open G-B-e) into one dyad, or a descending 16th run like
   `(18.1 17.1 16.1 15.1).16` into a single quarter, deletes exactly the notes a listener
   hums. Keep runs at their real resolution.

### The remedy set

There is no single right answer here, and picking one before you have looked at the
texture is how an arrangement ends up generic. **Choose deliberately, and put the choice
to the human at Gate A** — it defines the whole piece.

| Remedy | What it is | Choose it when |
|---|---|---|
| **Monophonic rolled arpeggio** | one note per subdivision, no simultaneous strikes: root lowest, inner tones rolling up the strings, melody on string 1, `{lr}` underneath so the low notes bloom | the texture really is a continuous broken chord and the melody is sparse enough to sit on top of it |
| **Sustained dyad + melody** | hold a root/fifth (or root/octave) and articulate the melody above it | the harmony changes slowly and the melody is the busy element |
| **Palm-muted ostinato + melody** | drive the root as muted 8ths, melody in the gaps | the piece wants rhythmic propulsion more than bloom; higher gain |
| **Hybrid thumb-and-fingers** | deep open-string bass under a high melody, pick + fingers | you want the fullest, most piano-like result and the player is comfortable with hybrid picking |
| **Thin to the structural line** | play the melody alone, with the harmony implied | the passage is a climax or a lull where texture would clutter it |

Selection criteria, in the order that usually decides it:

1. **Does the melody compete with the accompaniment for a string?** If yes, the
   arpeggio and ostinato options fight you — go sustained or hybrid.
2. **How fast is the subdivision?** Above roughly 16ths at a moderate tempo, a rolled
   arpeggio stops being pickable; thin it or mute it.
3. **How much does the harmony move?** Fast changes reward sustained dyads; a static
   pedal rewards an ostinato.
4. **What is the section's role?** A climax and a verse should not get the same texture,
   even where the piano writing is identical.

Whichever you pick, two properties are non-negotiable: **every simultaneous attack must
be pick-legal** (single string, adjacent double-stop, or a full brush), and **fast runs
keep their real resolution**.

Here is the arpeggio remedy written out, as a shape reference only — the frets are for a
maj7 whose root falls at fret 7 of string 5, not a pattern to transplant:

```alphatex
:8 7.5{lr} 12.1 9.4{lr} 11.1 9.3{lr} 10.1 9.2{lr} 11.1 |
```

The root is the lowest note; inner chord tones roll up strings 4→2; the melody sings on
string 1 on the off-beats. Rake low→high with the pick — every attack is one string.

Two mechanical tripwires when writing runs: keep any **16th→16th fret jump ≤ 5**
(`playability.mjs` `FAST_JUMP_FRETS`) or add a slide `{sl}`; and mind the transpose —
at `+1`, a source `D5` is **D♯5 = fret 11**, not fret 10. Off-by-one there is the single
most common cause of a skeleton miss.

## Density budget

**A guitar articulates one melodic line plus one accompaniment texture. That is the whole
budget.** A piano manages three or four independent voices; two hands, ten fingers, and a
pedal that sustains everything already struck.

Treat this as a **hard budget checked per bar**, not a guideline consulted when a bar feels
crowded. Reduction is then a plan you executed, not an apology you make afterwards.

| | Piano source | Guitar output |
|---|---|---|
| Simultaneous voices | 3–4 | **2** (line + texture) |
| Simultaneous pitches | 5–8 under pedal | 2–4, gain-dependent |
| Sustain mechanism | pedal, indiscriminate | `{lr}`, per-note, deliberate |

The simultaneous-pitch ceiling comes from gain, not from finger count — see the table in
[gain and its consequences](electric-guitar-voice.md#gain-and-its-consequences). Under high
gain the budget is 2–3 notes and no low thirds, which is stricter than anything the hand
imposes.

The budget is what buys space, and space is what makes the result a riff rather than a
reduction — [space defines riffs](rock-riff-construction.md#space-defines-riffs). Piano
writing is continuous; you are not obliged to be. A bar where the guitar rests is a bar
spent, not wasted.

## Transposition procedure

> **This procedure is general craft, NOT derived from the CanonRock corpus — every file
> in this corpus stayed in D.** All six corpus files are D major / B minor; none
> transposes. Keep the craft, but do not treat it as a precedent the corpus sets.

**Standard tuning is the priority.** The point of transposing is to find a key whose tonic
and dominant fall on **open strings in standard tuning** — that is what makes open-string
pedal points available, and pedal points are how a single guitar sounds full
([open-string pedal point](rock-riff-construction.md#open-string-pedal-point)).

1. Find the **lowest structural bass note** after octave folding.
2. Find which key puts **tonic and dominant on open strings** — E, A, D, G major; Em, Am,
   Bm, Dm minor. Those are the guitar's native keys and the reason rock lives in them.
3. **Prefer the transposition that achieves both in standard tuning.** Semitone-count is
   not the tiebreaker; open strings are.
4. Only if standard tuning genuinely cannot reach the required low root, propose **Drop D** —
   and justify it **at the planning gate**, in writing, before any tab exists. Alternate
   tunings are a last resort, not a convenience. They cost every open-string shape above
   the sixth string's relationship to the rest of the neck, and they are not reversible
   halfway through an arrangement. See [tunings.md](tunings.md).

### Derive it: fill this table for your source

Do the comparison explicitly. Take your source key and the two or three candidate
transpositions nearest it (including **zero** — a source already in a guitar key needs no
move at all), and fill a row for each:

| | Source key | Candidate A | Candidate B |
|---|---|---|---|
| Tonic — open string, or which barre? | | | |
| Dominant — open string, or which barre? | | | |
| Subdominant | | | |
| The piece's actual chord family, respelled | | | |
| Open-string pedal available on the tonic? | | | |
| Lowest structural bass note after octave-folding — still ≥ E2? | | | |

**The winner is the candidate with tonic *and* dominant on open strings whose folded bass
still fits.** Semitone distance is not a tiebreaker; open strings are. A single semitone
can flip every chord in a piece from a barre to an open shape — so check the small moves
first, and do not assume a large one is needed.

Once a key puts the tonic on an open string, the whole piece can be driven over a droning
tonic pedal:

```alphatex
:8 0.6{pm} 0.6{pm} 0.6{pm} 0.6{pm} (2.5 2.4).8 r.8 0.6{pm} 0.6{pm} |
```

On non-tonic bars the fretted root moves while the open strings keep ringing against it;
that friction is the point, and it is only available because of the key.

**If the source is already in a guitar-friendly key, transpose nothing** and say so at
Gate A. Moving a piece that was already sitting well is a net loss. When a passage feels
awkward in a good key, the problem is the voicing or the register — fix it with the
ladder, not with the key.

The Drop-D question is decided by the folded bass line, not by taste: if the lowest
structural note fits above E2 after octave-folding, **standard tuning wins** — see
[tunings.md](tunings.md) for the full test.

## What to deliberately discard

These carry no arrangement content. They are AlphaTex **engraving directives** the
exporter emits — pure layout/notation metadata — and the ingest path
(`tools/piano-validate.mjs` → `tools/piano-extract.mjs`) **strips every one of them** at
read time. You will never see them in the extractor's bar map. They are listed here so you
do not waste a planning decision on them.

| Directive | What it is | Treatment |
|---|---|---|
| `{beam Down}` / `{beam …}` | beam-grouping hint telling the engraver which notes to slur under one beam | stripped at ingest; re-beam the tab yourself |
| `{lf N}` | "layout force" — a line/framing hint that forces a system break | stripped at ingest |
| `\systemsLayout` | score-wide system count / layout directive | stripped at ingest |
| `\bracketExtendMode` | how a bracket across grouped staves is drawn | stripped at ingest |
| `\hideDynamics` | suppress dynamic marking display | stripped at ingest; dynamics are re-decided for the guitar from scratch |
| `\otherSystemsTrackNameOrientation` | orientation (horizontal/vertical) of track names on non-primary systems | stripped at ingest |
| `\copyright "…"` | copyright string in the score header | stripped at ingest |
| `\simile` | "simile" repeat-marking text | stripped at ingest; repetition is a riff decision, not a marking |
| `\ottava` | an 8va/8vb ottava line | stripped at ingest; superseded by the octave-folding policy in [Range reality](#range-reality) |

**These are two separate concerns and must not be conflated.** The ingest path strips them
for **parser/engraver-compatibility** — they are display metadata that has no fretted-note
meaning, and carrying them into analysis would corrupt pitch and rhythm statistics. That
says nothing about what belongs in the tab. This section governs the **arrangement**
decision (what the guitar plays), which is yours.

## AlphaTex piano-export hazards — check these on every new source

Every one of these cost real effort to find, and each is silent: nothing errors, the
arrangement just comes out wrong. Run the check on **your** file at ingest — they take
about a minute together.

**1. AT218 — pitched/fretted note mix.** Exporters emit `-1.<str>.<dur>` tokens (a
fretted-style note with fret −1) inside a pitched (`score`) staff where a rest belongs.
A source can carry any number of them (`canon-in-d-easy` has 11); the normalizer in
`tools/lib/piano-source.mjs` rewrites them to rests in memory before analysis.
> **Check:** `node tools/piano-validate.mjs <file>` — expect exit 0 and a report of
> `"rewrites": N` (11 for canon-in-d-easy). Non-zero rewrites are expected and benign;
> a non-zero exit or rewrites the normalizer cannot resolve is a real defect.

**2. Non-ASCII track names with U+00A0 NO-BREAK SPACE.** Track names can contain a
NO-BREAK SPACE (U+00A0), not a normal U+0020 space — e.g. `일렉<NBSP>기타`. A hand-typed
equality match (`name === "일렉 기타"`) silently fails because the bytes differ.
> **Check:** never key logic off a track name. The extractor keys off the **sounding
> register and staff kind**, not the name.

**3. A declared `\ks` that contradicts the sounding key.** Canon Rock 1 declares `\ks c`
(C major) while every bar sounds D major. The header key signature is an exporter artifact,
not musical truth.
> **Check:** the extractor reports `keyDeclared` and `keyDisagrees` in the digest. **Trust
> the sounding key**, not the directive.

**4. Track name and MIDI program that claim an instrument the notation is not.**
`cannon-rock-Piano` is named "piano" but its track name is `일렉 기타` (electric guitar)
and its program is an electric-guitar program — the notation is guitar-shaped, not piano.
> **Check:** treat the input format as **"AlphaTex with pitched staves"**, regardless of
> what the header claims. Decide staff roles from the notation, not the track metadata.

**5. Staff-global voice numbering.** Voice indices are numbered **across the whole score,
not per staff** — staff 0 uses voices 0–3, staff 1 of canon-in-d-hard uses voices 4–7.
Keying logic off a voice index produces silently wrong results.
> **Check:** never key logic off a voice index. Use the sounding register and the
> extractor's bar map.

**6. A second `\tempo` silently overwriting the first.** canon-in-d-easy declares
`\tempo 100` then a second `\tempo 25` — **25 is what plays**; the first directive is
discarded by alphaTab. Reading "the tempo" off the first directive gives a 4× error.
> **Check:** never trust the first `\tempo` directive. The extractor reports the effective
> tempo; read that.

**7. Bars that overrun their own meter.** canon-in-d-hard bar 45 carries 6 beats in a 4/4
bar. An overfull bar is silent — nothing errors — but it breaks bar-aligned analysis.
> **Check:** `node tools/piano-validate.mjs <file>` reports overfull voices with the bar
> index. An overfull **final** bar is usually benign (fermata padding); anywhere else it
> is a real defect to investigate before arranging over it.

**8. Empty bars that produce no skeleton.** A 2-note melody has no interior contour turn,
so the extractor's `melodySkeleton` legitimately returns empty for some bars. This is not
a coverage failure.
> **Check:** read the extractor's `melodySkeleton` coverage figure; an empty skeleton on
> some bars is expected. A *whole-section* empty skeleton is the signal to investigate.

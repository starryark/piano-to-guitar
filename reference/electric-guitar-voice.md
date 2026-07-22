# Electric Guitar Voice

Why the instrument sounds the way it does, and what that permits you to write. Read this
before choosing a register, a gain level, or a voicing — it is the file that decides whether
a set of pitches is *guitar music* or *piano music typed into a tab*. The other two reference
files assume its conclusions: [rock-riff-construction.md](rock-riff-construction.md) builds
riffs on top of them, [piano-to-guitar-arranging.md](piano-to-guitar-arranging.md) reduces
piano textures against them.

Hard playability limits (span, speed, bend reach) live in
[guitar-playability.md](guitar-playability.md); fret-to-pitch lookup lives in
[guitar-fretboard.md](guitar-fretboard.md). This file is about *timbre and idiom* — the
decisions those two files cannot make for you.

---

## Pickups and register

An electric guitar has two or three magnetic pickups sampling the string at different points
along its length. A pickup under the neck sits near the string's midpoint, where the
fundamental and low harmonics are strongest; a pickup at the bridge sits near a node, where
the string barely moves at low frequencies but still swings at high ones. That single fact of
geometry is the entire tonal palette.

| Pickup | Physical position | Character | Idiomatic use |
|---|---|---|---|
| Neck humbucker | Near string midpoint | Round, thick, vocal, strong fundamental | Singing lead at frets 12+ on strings 1–3; clean arpeggios |
| Bridge humbucker | Near a high-order node | Bright, aggressive, cutting, harmonic-rich | Riffs, palm mutes, anything that must survive distortion |
| Single-coil | Either position | Thinner, glassier, faster transient, more upper detail | Clean textures, funk, chime; loses body under high gain |
| Humbucker | Either position | Two coils in series: fatter, louder, less top | Rock default; drives the amp harder |

**The point: the same written notes sound like a different instrument depending on where on
the neck you put them.** This is not a nuance. It is a compositional variable equal to pitch.

A melody sitting at fret 12 on string 2 is played on thick, slack, low-tension wire near the
neck pickup — it is warm, it bends easily, vibrato is wide and lazy, and it sounds like a
voice. The identical pitches at frets 5–8 on string 1 sit on thin, tight wire — bright,
tense, fast-speaking, and much closer to a horn than a voice. **They are not
interchangeable.** Choosing between them is an arranging decision, and you must make it
deliberately.

```alphatex
:4 12.2{v} 14.2{v} 15.2{v} 17.2{v} |
:4 7.1{v} 9.1{v} 10.1{v} 12.1{v} |
```

Both bars are B4–C#5–D5–E5. The first is the singing voice. The second is the bright answer.
Writing the second when you wanted the first is one of the most common ways an arrangement
comes out sounding mechanical.

### Register policy

| Register | Strings / frets | What it is for |
|---|---|---|
| Foundation | 6–5, frets 0–7 | Roots, power chords, palm-muted ostinato |
| Body | 5–4, frets 0–12 | Riff bodies, double stops, the low melody statement |
| Voice | 3–2, frets 5–15 | Melody. The default home for a lead line |
| Air | 2–1, frets 12–19 | Climax, the high answer, harmonics, bends |
| Above fret 19 | 1, frets 20+ | One note, once, as an event |

Rule: when a source melody could sit in two registers, pick the one whose *role* matches the
section. A verse statement wants Body or the low end of Voice; the chorus answer of the same
melody wants Voice or Air. Repeating a melody in a higher register is the cheapest and most
convincing way to escalate — see
[the single-guitar section form](rock-riff-construction.md#the-single-guitar-section-form).

---

## Gain and its consequences

Gain is a nonlinear transfer function applied to the pickup signal — it compresses the
dynamic range, generates new frequency content, and extends sustain. Every consequence below
follows from that one operation. **Choose the gain level first; it constrains voicing, note
count, and rhythm for the whole section.**

| Gain | Sustain | Note separation | Max simultaneous notes | Safe intervals |
|---|---|---|---|---|
| Clean | short | excellent | 4–6 | anything |
| Crunch | medium | good | 3–4 | avoid low 3rds |
| High gain | very long | poor | 2–3 | 5ths, octaves, 4ths |

Read the table as a **budget**, not a description. "Max simultaneous notes" is a hard ceiling
on any vertical stack you write in that section. If a reduction leaves you five notes under
high gain, the reduction is not finished — go back to
[the reduction ladder](piano-to-guitar-arranging.md#the-reduction-ladder).

Why each column moves the way it does:

- **Sustain rises with gain** because compression keeps re-amplifying the decaying string,
  and at high gain the amp's output can feed back into the string and sustain it
  indefinitely. This is what makes a whole-note melody viable on guitar at all.
- **Note separation collapses with gain** because compression flattens the attack transient —
  the "pick click" that lets the ear parse one note from the next — and the long tail of note
  *n* is still ringing at full volume when note *n+1* starts. Consequence: **under high gain,
  articulation must be created by silence, not by dynamics.** Palm muting and rests do the
  work that a piano's key release does.
- **Max simultaneous notes falls with gain** because of intermodulation — see the next
  section. This is the strict version of the rule.
- **Safe intervals narrow with gain** for the same reason.

Gain also implies a rhythmic style. High gain plus poor separation means the rhythm has to be
carved out with mutes and rests; this is exactly the argument in
[space defines riffs](rock-riff-construction.md#space-defines-riffs).

MIDI programs, for `\instrument`: 27 clean electric, 29 overdriven, 30 distortion. Pick the
one matching the gain row you committed to, and keep it consistent within a section.

---

## Why distortion forbids low thirds

This is the physical reason rock uses power chords, and most of this project's voicing rules
descend from it. It is worth getting exactly right.

### The mechanism

A clean amplifier is (approximately) linear: output = *k* · input. A linear system has a
crucial property — it **generates no new frequencies**. Whatever went in comes out, louder.

A distorting amplifier is nonlinear. Its transfer function expands as a power series:

```
y(t) = a1·x(t) + a2·x(t)² + a3·x(t)³ + ...
```

Squaring and cubing a signal creates frequencies that were not in the input. For two input
tones at *f₁* and *f₂*:

- the **squared** term produces `2f₁`, `2f₂`, `f₁+f₂`, and `f₁−f₂`
- the **cubed** term produces `3f₁`, `3f₂`, `2f₁±f₂`, and `2f₂±f₁`

The sum and difference products are **intermodulation (IM) products**. They are not harmonics
of either note — they are new pitches the amp invents, and they are loud. This is the whole
game.

### Why simple ratios are consonant

Take two tones whose frequencies are in a small-integer ratio *p*:*q* (in lowest terms). Write
*g* = *f₁*/*p* = *f₂*/*q*. Then every IM product — every sum, difference, and higher-order
combination — is an **integer multiple of *g***, because integer combinations of *pg* and *qg*
are always multiples of *g*.

So the entire cloud of invented frequencies collapses onto a single harmonic series built on
*g*. The ear hears one fused, powerful note rather than a chord plus noise. And *g* is the
spacing between adjacent IM products, so **small *p* and *q* give a sparse, wide comb;
large *p* and *q* give a dense, narrow comb.** Density is mud.

| Interval | Ratio *p*:*q* | *g* relative to lower note | IM product spacing | Verdict under high gain |
|---|---|---|---|---|
| Octave | 2:1 | = the lower note | wide | Safe at any pitch |
| Fifth | 3:2 | 1 octave below root | wide | Safe at any pitch — and *g* reinforces the root |
| Fourth | 4:3 | 2 octaves below root | moderate | Safe; thins out above high gain, fine as a dyad |
| Major 3rd | 5:4 | 2 octaves below root | dense | Only above ~G3 |
| Minor 3rd | 6:5 | 2 oct + maj 3rd below root | denser | Only above ~G3 |
| Major 2nd | 9:8 | 3 octaves below root | very dense | Deliberate effect only |
| Tritone | 45:32 | ~5 octaves below root | pathological | Never as a sustained low dyad |

The fifth is the star case. Root *2g*, fifth *3g*: the difference tone is *g*, exactly **one
octave below the root**. Distortion does not just tolerate a power chord, it *adds a
subharmonic octave to it*. That is the "power" in power chord, and it is why a two-note shape
sounds bigger than a six-note piano chord through the same amp.

The major third is the failure case. Root *4g*, third *5g*: the difference tone is *g*, two
octaves below the root — an unrequested bass note nobody voiced, sitting under the chord and
fighting the actual bass. And the products crowd at *g* spacing rather than *2g*.

### Two things that make it worse

1. **Real strings are not sine waves.** Each note arrives with a dozen strong harmonics, and
   *every pair of partials from both notes* intermodulates. With *n* significant partials you
   get on the order of *n*² products. For 2:1 and 3:2 most of those products land on top of
   each other (they coincide on the same harmonic series). For 5:4 and 6:5 far fewer coincide,
   so the spectrum fills in rather than fusing.
2. **It worsens as pitch drops.** Two reasons, both real:
   - The ear's **critical bands** are roughly constant-width (~100 Hz) below about 500 Hz, and
     proportional above. A minor third at C5 spans far more than a critical band and is
     resolved cleanly; the same minor third at C2 (65→78 Hz) sits *entirely inside one
     critical band*, so the two tones and their IM products beat against each other as
     roughness rather than separating into pitches.
   - The IM products of a low interval land in the 40–150 Hz region where guitar cabinets,
     bass guitar, and kick drum already live. Even where the interval is theoretically fine,
     the products are masked into a low-frequency smear.

Also worth knowing: equal temperament's major third is ~14 cents sharp of a true 5:4, so the
products from a fretted third do not even land on a consistent *g* — they drift and beat.
Fifths are only 2 cents off, so they fuse cleanly. The tuning system is on the power chord's
side too.

### The lint rule

> **Under high gain, no 3rd may appear in a voicing whose root sounds below ~G3 (MIDI 55).
> Move the 3rd up an octave, or omit it.**

In fretboard terms: G3 is fret 3 on string 6 sounding, i.e. the practical line is around
**fret 3 of string 6 / fret 10 of string 5**. Below that line, write fifths, octaves, and
fourths only.

```alphatex
:2 (3.6 2.5 0.4) (3.6 5.5 5.4) |
```

Bar 1 is a low G major triad — G2/B2/D3. Under high gain it is mud, and the mud is a
predictable 49 Hz difference tone plus a dense IM comb. Bar 2 is G5, the same harmony minus
the third: it fuses, and distortion supplies a phantom G1 underneath. **Write bar 2.**

If the section genuinely needs the third's colour, put it two octaves above the root, out of
the crowded region:

```alphatex
:1 (3.6{lr} 5.5{lr} 5.4{lr} 4.3{lr}) |
```

G2 / D3 / G3 / B3. The third is now a full two octaves above the root, its IM products land
in the midrange where the ear resolves them, and this is a *crunch* voicing — four notes,
which is already at the crunch ceiling in
[the gain table](#gain-and-its-consequences). Do not try it at high gain.

Under **clean** gain, none of this applies. Triads, 7ths, and close voicings are all available.
That is what the "anything" cell means.

---

## Sustain answers the sustain pedal

A high-gain electric guitar note with vibrato rings for **bars**. Not beats — bars. Sustain
that is a limitation on an acoustic instrument is a resource here, and it is the single best
answer to a piano's sustain pedal.

The piano's pedal creates a *blurred wash of many strings*. The naive translation — re-strike
the chord on every beat so it never dies — is the worst option available: it destroys the
legato the pedal existed to create, and under high gain it stacks note-separation problems on
top of intermodulation problems.

**The guitar answer is to hold one note and let the amp work.** Where the piano sustains a
five-note blur, the guitar sustains a single note with vibrato — or a single dyad with
`{lr}` — and the harmony is implied rather than stated.

```alphatex
:1 12.3{v lr} |
:1 12.3{v lr} |
```

Two bars, one pitch, and it does not sag. Vibrato is what keeps it alive: a static held note
decays into the noise floor, a vibratoed one keeps re-exciting the ear and keeps the feedback
loop engaged.

| Piano marking | Wrong reflex | Guitar answer |
|---|---|---|
| Sustain pedal over a held chord | Re-strike every beat | One note + `{v}`, or a dyad + `{lr}` |
| Sustain pedal over a moving figure | Let-ring everything | Let-ring only the pedal tone; articulate the movement |
| Pedal release / change | Ignore | `{st}`, a rest, or a palm mute — the release *is* the rhythm |

The full source-to-guitar mapping — including every other piano texture, not just the pedal —
is [the translation table](piano-to-guitar-arranging.md#the-translation-table). Use that as the
lookup; this section is only the *why*.

Scale note: a pedal-heavy source can carry **hundreds of sustain-pedal markings** — count yours.
At that density it is not a corner case to special-case, it is the piece's dominant texture. Whatever policy you adopt here runs for
most of the arrangement, so adopt it deliberately and keep it consistent.

Beyond plain sustain, the same resource buys three more endings: a bend held and vibratoed at
pitch, a tremolo-picked `{tp}` swell, and feedback. All three are ways to make length
*eventful* rather than merely long.

---

## The pick

A plectrum striking a string once is a single hard transient. Everything guitar rhythm can do
follows from how those transients are spaced, muted, and directed.

| Approach | What it is | Cost | Sound |
|---|---|---|---|
| Alternate picking | Strict down-up | Cheapest at speed | Even, machine-like; the default for runs |
| Economy / sweep | Direction follows string crossing | Awkward on reversals | Fluid, legato-ish across strings |
| All-downstrokes | Every note a downstroke | Tops out ≈200 BPM in 8ths | Heavy, uniform, aggressive |
| Hybrid picking | Pick plus middle/ring fingers | Slow to switch to | Reaches non-adjacent strings cleanly |

**Downpicking is a sound, not merely a technique.** Every note gets an identical attack
vector and identical contact, so the stream is relentless in a way alternate picking cannot
imitate — the up-strokes always speak slightly differently. Mark it explicitly with `{sd}`
when the character matters. Above roughly 200 BPM in straight 8ths it stops being physically
available; that ceiling is a real constraint on tempo choices, not a stylistic preference.

**Palm muting is the fundamental rhythmic device of rock guitar.** The picking hand's heel
rests on the strings *just* forward of the bridge, damping the string enough to kill sustain
and most upper partials while leaving the fundamental and a percussive thump. It converts a
sustaining instrument into a percussive one on demand — and under high gain, where note
separation is poor, it is the primary way to get articulation at all.

```alphatex
:8 (0.6{pm} 0.5{pm}) (0.6{pm} 0.5{pm}) 3.6{pm} 5.6{pm} (0.6{pm} 0.5{pm}) (0.6{pm} 0.5{pm}) (5.6 7.5).4 |
```

Note the syntax: `pm` is a **note** effect, so inside a chord it goes on each note inside the
parens. `(0.6 0.5){pm}` is error AT205.

Palm muting lives on the wound strings (4–6) because of **the technique's response on wound
strings near the bridge** — a wound core has more mass and a more compliant winding, so
light heel pressure damps it into a defined thump. The plain strings 1–2 just go dead and
thin. This is a property of the technique, not a rule about register: it is why you almost
never see `pm` above string 4, and why `pm` on strings 1–2 needs a justification.

Other things the pick does, all first-class:

| Device | AlphaTex | Use |
|---|---|---|
| Pick slide / scrape | `5.5{psd}`, `{psu}` | Section transition, pickup into a downbeat |
| Tremolo picking | `5.6.4{tp 2}` | Sustain a single pitch with energy; a held-chord answer |
| Raked / muted strings between notes | `x.5`, `x.4` | Idiomatic noise, not error — it is how the hand actually moves |
| Explicit stroke direction | `{sd}` / `{su}` | When downpicked character is the point |
| Brush / strum | `{bd}` / `{bu}` | Chord attack; crosses every intervening string |

The dead-note rake deserves emphasis. A guitarist crossing from string 6 to string 3 at speed
will clip the strings in between, and a good transcription **writes that in**. Removing it
makes the part cleaner on the page and less convincing in the ear.

For these devices assembled into actual riffs — each with a construction principle rather
than a copied lick — see the
[devices catalogue](rock-riff-construction.md#devices-catalogue).

---

## What the pick makes hard

A pick is one point of contact travelling in one plane. Everything a piano does trivially by
having ten independent fingers, it makes expensive.

| Piano-natural gesture | Why the pick struggles | Write instead |
|---|---|---|
| Non-adjacent strings struck together | The pick cannot be in two places at once | Hybrid picking (pick + fingers), or roll it as a fast `{au}` arpeggio |
| Wide leap at speed | Large string skips cost accuracy and pick-hand tracking | Slide `{sl}`, tap `{tt}`, or re-voice onto adjacent strings |
| Any strum spanning an unwanted note | **A strum crosses all intervening strings** | Fret it, mute it (`x.n`), or accept it as part of the chord |
| More than one note per string | Physically impossible | Re-voice; see [guitar-playability.md](guitar-playability.md) |
| Independent voices with independent rhythms | One pick, one attack instant | Melody plus one texture — the [density budget](piano-to-guitar-arranging.md#density-budget) |

The strum rule is the one most often violated in generated tabs. `(0.5 9.2)` is a legitimate
dyad, but it cannot be strummed — a downstroke from string 5 to string 2 sounds strings 4 and
3 on the way. If those two open strings (D3, G3) do not belong in the harmony, the notation is
a lie. Either they belong, or they are muted, or the dyad is played hybrid.

```alphatex
:8 (0.5 9.2) (0.5 7.2) (0.5 9.2) (0.5 10.2) (0.5 9.2) (0.5 7.2) (0.5 5.2) (0.5 7.2) |
```

Correct and idiomatic — as **hybrid picking**: pick on the open A, middle finger on string 2.
As a strum it is wrong. The notation is identical; the difference is whether you thought about
it.

The octave shape solves the same problem in the opposite direction — it *uses* the intervening
string by muting it, so the shape can be raked freely:

```alphatex
:4 (5.6 x.5 7.4) (5.6 x.5 7.4) (3.6 x.5 5.4) (3.6 x.5 5.4) |
```

A4/A5 then G4/G5 in octaves, string 5 deliberately dead. This is the standard way a guitar
answers a piano's right-hand octave doubling, and it survives any gain level.

---

## Expressive vocabulary

**Vibrato on held notes is the single biggest tell of guitaristic writing.** A tab where every
long note is bare reads as MIDI, no matter how good the pitches are. A tab where the long
notes carry `{v}` reads as a guitarist. This costs one token per note and it is the highest
return-on-effort edit available. Apply it to *every* note of a half-note or longer, and to any
note that ends a phrase.

| Technique | AlphaTex | Constraint | When to use |
|---|---|---|---|
| Vibrato / wide vibrato | `15.2{v}` / `{vw}` | None | Every held note. `vw` for climaxes |
| Bend (whole step) | `17.1{b (0 4)}` | Strings 1–3, fret ≥ 5 | The expressive peak of a phrase |
| Bend + release | `{b (0 4 4 0)}` | as above | Returning to the melody note |
| Pre-bend | `{b (4 4 0)}` | as above | Arriving *from* above — vocal, sighing |
| Unison bend | `(15.2{b (0 4)} 12.1)` | Adjacent strings 1–3 | Thickening a single high melody note |
| Slide (legato / shift) | `12.2{sl} 14.2` / `{ss}` | Same string | Connective tissue between positions |
| Slide in / out | `{sib}`, `{sod}` | Any | Phrase entry and exit; cheap idiom |
| Hammer-on / pull-off | `14.1{h} 15.1` | Same string, ≤ 4 frets | Fast runs without a pick attack per note |
| Natural harmonic | `12.6{nh}` | Frets 5, 7, 12, 19 only | Bell tones; endings; clean sections |
| Pinch harmonic | `15.1{ph}` | Needs crunch or high gain | Screaming accent; one per phrase at most |
| Tapping | `17.1{tt}` | Tapped note ≥ 5 frets above fretted | Wide leaps that no hand position reaches |
| Whammy dive | `(5.6 7.5){tb (0 -8)}` | Beat must be otherwise free | Section ends, drama |
| Tremolo picking | `5.6.4{tp 2}` | One pitch | Energetic sustain |
| Feedback / swell | `{f}`, `{vs}`, `{fo}` | High gain for feedback | Endings, entrances |

Bend and whammy values are **quarter-steps**: 4 = a whole step, 2 = a half step, −8 = a two-
whole-step dive.

Composed idioms worth writing on purpose:

```alphatex
:8 12.1{h} 14.1{h} 15.1 12.2 :4 17.1{v b (0 4)} 17.1{v} |
```

A legato run into a bent, vibratoed peak, then held. The run is *approach*; the bend is the
event. Note that the peak is reached once and then dwelt on — see
[lead vocabulary](rock-riff-construction.md#lead-vocabulary) for how this becomes a phrase.

```alphatex
:1 (12.6{nh} 12.5{nh} 12.4{nh}) |
```

Natural harmonics at fret 12 as a chime — the cleanest available ending, and the only
three-note stack that stays transparent under gain, because harmonics are near-sinusoidal and
generate very few intermodulation products.

Two closing rules:

1. **Every technique is also a rhythm.** A bend takes time to arrive; a slide takes time to
   travel; a tap has no pick attack. Writing them changes when the ear hears the note, so
   place them where that delay is musical.
2. **Ration the peaks.** One pinch harmonic in a section is an event; four is a texture and
   then noise. Same for whammy dives, taps, and two-step bends. The expressive ceiling should
   be reached once per section.

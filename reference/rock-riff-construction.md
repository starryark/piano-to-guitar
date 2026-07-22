# Rock Riff Construction

*How great riffs are actually built — the vocabulary the user asked for.* Read this when you
are turning a dense piano passage into something a guitarist would actually play, and when
you are deciding, section by section, what the one guitar should be *doing*. This file gives
you the construction principles and a catalogue of concrete devices; each device ships with a
validated AlphaTex fragment you can adapt, never copy from a real song.

Companion files: how the instrument's voice constrains these choices lives in
[electric-guitar-voice.md](electric-guitar-voice.md); how to strip a piano score down to what
fits lives in [piano-to-guitar-arranging.md](piano-to-guitar-arranging.md). Do not restate
them — link.

## A riff is a rhythm before it is a melody

Pitch is attached to a rhythmic cell, not the other way round. You choose the *groove* first,
then hang notes on it. A great riff survives being stripped of pitch entirely.

> **The tap test:** tap the riff on a table. If it is still recognizable as *that riff*, it
> is a riff. If tapping it produces a generic pulse, you have written a scale passage, not a
> riff — go back to the rhythm.

Practical consequence when reducing piano: do not start from the pitches. Start from the
attack pattern of the left hand (or of whichever voice drives the groove), lock that in as a
rest-and-accent skeleton, and only then assign frets. The skeleton below is *just* the
rhythm — dead notes on the low string, with rests where the piano would have kept sounding:

```alphatex
:8 x.6 r x.6 x.6 r x.6 r x.6 |
```

If that pattern is catchy muted, it will be catchy pitched. Downpicking this skeleton is a
sound in itself — see [the-pick](electric-guitar-voice.md#the-pick).

## Space defines riffs

**Piano writing is continuous; riffs are not.** This is one of the two or three
highest-leverage ideas in the whole project, and it matters most *because* the sources are
dense piano transcriptions where something sounds on nearly every subdivision.

Rests are structural, not leftover. The silence after a phrase is what makes the phrase read
as a phrase — the ear needs the gap to register the shape. A riff that fills every
sixteenth has no profile; it is wallpaper. The rest-first phrasing of *Back in Black* — a
short stab, then air — is the model: the space is doing as much work as the notes.

When you reduce, **budget the rests before the notes.** A good default is that a two-bar riff
cell speaks in roughly its first half and breathes in the second. Here the piano's continuous
texture becomes two muted dyads and a fill, with real silence between them:

```alphatex
:8 r (0.6{pm} 2.5{pm}) r r (0.6{pm} 2.5{pm}) r 3.6 5.6 |
```

Deleting notes to open space is not a loss you apologize for; it is the arrangement. If in
doubt, cut a note and add a rest.

## The two-bar cell

Most rock riffs are a **two-bar unit repeated four times, varied on the fourth.** The unit is
long enough to state an idea and answer it, short enough to grip. Structure the four
repetitions as **A A A A′** — three identical statements build expectation, the fourth breaks
it (a turnaround, a walk-up, a held chord) and hands off to the next section.

Inside the cell, use **call-and-response**: a low statement on the wound strings answered by a
higher figure. The two halves are the same rhythmic idea in two registers — the "question"
sits low, the "answer" replies up on strings 4–3. Below, bars 1–3 are the low call plus its
high answer; bar 4 varies the answer into a climbing fill and lands on a let-ring dyad:

```alphatex
:8 (0.6{pm} 2.5{pm}) (0.6{pm} 2.5{pm}) r (0.6{pm} 2.5{pm}) r 3.6 5.6 r |
r 5.4 7.4 5.4 r 7.4 5.4 r |
(0.6{pm} 2.5{pm}) (0.6{pm} 2.5{pm}) r (0.6{pm} 2.5{pm}) r 3.6 5.6 r |
r 5.4 7.4 5.4 :16 5.4 7.4 8.4 9.4 :4 (10.5{lr} 12.4{lr}) |
```

Repeated bars are *made* for this: arrange the cell once, reuse it, and vary the final
repeat. Your digest lists the candidates in `duplicateRanges[]` — diff them before trusting
them, since a return is often only approximately identical. See
[AlphaTex piano-export hazards](piano-to-guitar-arranging.md#alphatex-piano-export-hazards-check-these-on-every-new-source).

## Open-string pedal point

An open low string (E, A, or D) droning against a moving shape on the strings above. The open
string sounds on every off-beat or between every fretted note, giving a relentless engine
under a melody that would otherwise sound thin as a single line. **This is how standard tuning
gets its power** — the ringing open string is free, loud, and always in tune.

```alphatex
:8 0.6{pm} 5.5 0.6{pm} 7.5 0.6{pm} 5.5 0.6{pm} 3.5 |
```

Here open low E (`0.6`) is the pedal; the melody notes move on string 5. The pedal is palm-
muted so it stays felt rather than heard, letting the moving voice cut through.

Because the payoff is an *open* string, **key choice is not cosmetic** — you want the tonic or
dominant to land on E/A/D/G open. This is exactly why transposition is part of arranging: pick
the key that puts the pedal on an open string. See
[transposition-procedure](piano-to-guitar-arranging.md#transposition-procedure) — a single
semitone can turn every barred pedal into an open low E.

## Devices catalogue

Each device below is a construction principle plus one validated fragment. Adapt the shapes;
never paste a copyrighted riff. Gain-dependent choices (which intervals survive distortion,
how many notes can sound at once) are governed by
[gain-and-its-consequences](electric-guitar-voice.md#gain-and-its-consequences); picking
choices by [the-pick](electric-guitar-voice.md#the-pick).

### Parallel-fourth dyads, all downstrokes

**Principle:** move a fixed two-note shape (a perfect 4th, adjacent strings) in parallel along
the neck. Fourths are consonant under high gain — safe where thirds would turn to mud
([why-distortion-forbids-low-thirds](electric-guitar-voice.md#why-distortion-forbids-low-thirds)).
All-downstroke picking (`{sd}`) makes them uniform and heavy; the sound *is* the technique.

```alphatex
:8 (5.5 5.4){sd} (5.5 5.4){sd} (7.5 7.4){sd} (7.5 7.4){sd} (3.5 3.4){sd} (3.5 3.4){sd} (5.5 5.4){sd} (5.5 5.4){sd} |
```

### Open-position chord fragments with space

**Principle:** don't strum a full six-string chord — strike a **fragment** (three strings of
it) with a brush, let it ring, then leave silence. The open strings sustain into the gap so
the harmony is present without being re-struck. This is the guitar answer to a piano's
sustained block chord.

```alphatex
:2 (0.6{lr} 2.5{lr} 2.4{lr}){bd} :8 r 3.5 2.4 r |
```

The `{bd}` brushes the chord downward; `{lr}` lets it ring through the rests. Compare the
translation of rolled chords and long held chords in
[the-translation-table](piano-to-guitar-arranging.md#the-translation-table).

### String-skipping arpeggio pattern

**Principle:** arpeggiate a shape but **skip a string** between voices so the intervals are
wide and open, not a compact scale run. Let every note ring into the next (`{lr}`) so the
arpeggio blooms into a chord. Wide skips cost accuracy at speed — see
[what-the-pick-makes-hard](electric-guitar-voice.md#what-the-pick-makes-hard).

```alphatex
:16 0.6{lr} 2.4{lr} 0.3{lr} 2.4{lr} 0.6{lr} 2.4{lr} 0.3{lr} 2.4{lr} 3.6{lr} 2.4{lr} 0.3{lr} 2.4{lr} 3.6{lr} 2.4{lr} 0.3{lr} 2.4{lr} |
```

The pattern skips string 5 entirely (6 → 4 → 3), giving the open, harp-like spread that a
compact run cannot.

### Pedal-point + chromatic approach

**Principle:** the open-string pedal from above, but the moving voice **walks chromatically**
into its target instead of leaping. The half-step approach creates tension that resolves the
instant the target note lands — cheap, reliable menace.

```alphatex
:8 0.6{pm} 0.6{pm} 5.5 0.6{pm} 0.6{pm} 6.5 0.6{pm} 7.5 |
```

Open low E pedals; the upper voice climbs 5.5 → 6.5 → 7.5 (D → D# → E) chromatically over it.

### Gallop rhythm

**Principle:** the eighth + two-sixteenths cell (`8 16 16`), palm-muted and downpicked, one
per beat. It is the most recognizable rhythm-guitar engine in metal because the tap test
passes instantly — the gallop is pure rhythm. Keep it locked and muted; pitch barely matters.

```alphatex
:8 0.6{pm} :16 0.6{pm} 0.6{pm} :8 0.6{pm} :16 0.6{pm} 0.6{pm} :8 0.6{pm} :16 0.6{pm} 0.6{pm} :8 3.6{pm} :16 3.6{pm} 3.6{pm} |
```

Note the construction: switch the default duration with `:8` / `:16` per beat rather than
writing inline durations, so palm-mute stays a *note* effect and binds correctly.

### Minor-pentatonic box riff

**Principle:** build the riff from one box of the minor pentatonic (here A minor, position 1
at fret 5) so every note is a fret or two away and the phrase falls under the hand. Mix a
palm-muted low anchor with quick unmuted stabs higher in the box for contrast.

```alphatex
:8 5.6{pm} 5.6{pm} 8.6 5.6{pm} 7.5 5.5 5.6{pm} r |
```

Low A (`5.6`) is the muted anchor; `8.6` (C), `7.5` (E), `5.5` (D) are the box notes answering
it. The lead use of this same box is [lead-vocabulary](#lead-vocabulary) below.

### Chromatic approach to the root

**Principle:** land the root on a strong beat, but *arrive* at it from a half-step below.
Two chromatic pickups (root − 2 frets, root − 1 fret) into the root turn a static root into a
gesture. Distinct from the pedal device: here the chromatic notes are the *lead-in*, not a
counter-voice over a drone.

```alphatex
:8 3.6 4.6 5.6 r 3.6 4.6 5.6 r |
```

G → G# → **A** (`3.6 4.6 5.6`), landing the root A on the strong beat, twice, with air after
each landing.

### Pop clave (3+3+2)

**Principle:** eight eighth notes grouped **3 + 3 + 2** against a 4/4 bar (two dotted-eighth
cells + one eighth), so the accent lands on beat 1, the "and of 2", and beat 4. The grouping
displaces the natural duple grid and creates a cyclical rolling momentum that does not resolve
inside the bar — it just restarts. Like the gallop it is pure rhythm: pitch barely matters, so
state it muted on a single string and it still passes the tap test. Provenance: this corpus at
Canon Rock outro bars 142–150 (see `case-canon-rock.md`), where a static D pedal is
made into a section by rhythm alone.

```alphatex
:8 5.6{ac} 5.6 5.6 5.6{ac} 5.6 5.6 5.6{ac} 5.6 |
```

Accents (`{ac}`) fall on the first note of each group — positions 1, 4, 7 of the eight eighths
— marking the 3+3+2 clave; mute everything and the grouping still reads.

## Lead vocabulary

When a section's role is a lead line (see below), phrase it like a singer, not like a scale.

- **One box, then the blue note.** Sit in a single minor-pentatonic box so the notes are
  reachable, then colour it with the flat-5 blue note as a *passing* tone that resolves down
  — never landed on. Below, `8.3` (Eb, the blue note) passes to `7.3` (D):

```alphatex
:8 8.2 5.2 7.3 5.3 r.2 |
:8 8.2 5.2 8.3 7.3 5.3 r r r |
```

- **Question and answer.** Phrase in pairs: a phrase that ends *up* (unresolved, a question)
  answered by one that ends *down* (resolved). The rest between them is the breath — put it
  in. Bar 1 above is the question (ends high, then a half-rest of air); bar 2 is the answer,
  falling through the blue note to rest.

- **Climax once, high, on a bend with vibrato.** A solo has exactly one peak. Save the
  highest note, reach it via a fast run, then **stop the motion** and hold — a full-step bend
  with wide vibrato is the release. Everything before is setup; nothing after competes.

```alphatex
:16 5.3 7.3 5.2 8.2 5.1 8.1 5.1 8.1 :8 8.1 8.1 r r |
:1 8.2{v b (0 4)} |
```

- **Breathe after a fast run.** Note the `r r` after the sixteenth run above, *before* the
  climax bend. The silence is what makes the run sound fast and the bend sound like an
  arrival. A run that spills straight into the next phrase reads as nervous, not virtuosic.

Bend mechanics (which strings, which frets, gain-dependence) are in
[expressive-vocabulary](electric-guitar-voice.md#expressive-vocabulary); vibrato on every held
note is the single biggest tell of guitaristic writing.

## The single-guitar section form

**This is the answer to "solo guitar," and it is not chord-melody.** One guitar cannot be
piano-left-hand and piano-right-hand at the same time, and it should not try. Instead, a rock
cover **alternates the guitar's *role* section by section.** Assigning one role per source
section IS the arrangement decision — it replaces any mechanical "bass on strings 6–4, melody
on 3–1" or left-hand/right-hand split. That split betrays a misunderstanding of the
instrument, and it is the user's central objection to mechanical arranging. Say it plainly in
the plan: **the guitar plays one role at a time, and choosing the sequence of roles is the
arrangement.**

| Source section | Guitar role | Built from |
|---|---|---|
| Intro | Riff — establish the groove and the key | rhythm-first cell, [space](#space-defines-riffs), [pedal point](#open-string-pedal-point) |
| Verse | Lead line — the melody as a single voice, sparse backing | [lead vocabulary](#lead-vocabulary), pentatonic phrasing |
| Chorus | Reinforced melody — melody thickened with power chords or octaves | melody note over a power chord / octave shape |
| Breakdown | Stripped rhythm — one muted figure, maximum space | [gallop](#devices-catalogue), dead-note skeleton, drop to a single string |
| Climax | The one peak — highest note, bend, vibrato, then let it ring or feed back | [climax bend](#lead-vocabulary), held sustain |

The role decision is made *together with* the reduction: what you keep from the piano depends
on what job the guitar is doing this section. See
[the-reduction-ladder](piano-to-guitar-arranging.md#the-reduction-ladder) — the ladder tells
you *how* to reduce; the role tells you *toward what*.

Chorus reinforcement is the melody note carried on top of a power chord, with the inner string
muted so a full downstroke does not sound an unwanted note (a strum crosses every intervening
string — [what-the-pick-makes-hard](electric-guitar-voice.md#what-the-pick-makes-hard)):

```alphatex
\section "Chorus"
:4 (5.6 5.5{x} 7.4) (7.6 7.5{x} 9.4) :8 (8.6 8.5{x} 10.4) r (7.6 7.5{x} 9.4) r |
```

Each hit is root (string 6) + dead middle string + melody note (string 4): a power-chord-
backed melody in one strummable shape. That is a chorus doing one job well — which is the
whole point.

### Passes over a loop

When the source is one repeating progression — a chaconne, a pop loop, a ground bass —
the section-form table above is not enough on its own: the guitar needs a plan for how
the *same* harmony escalates across repetitions. The digest surfaces this directly: a
non-null `harmonicLoop` field (`{length, firstBar, passes[], coverage, cycle[]}`,
reported in `analysis/<name>-map.md`'s "Harmonic loop" section) means the source is
structurally a loop, and each entry in `passes[]` is one traversal you can assign a
distinct texture to.

**Plan one texture per pass and escalate across passes**, roughly:

| Pass | Texture | Built from |
|---|---|---|
| 1 | Palm-muted pedal point + sparse melody — establish the loop and the key | [open-string pedal point](#open-string-pedal-point), [space](#space-defines-riffs) |
| 2 | Full power-chord bed — the loop as rhythm guitar, melody implied | [parallel-fourth dyads](#devices-catalogue), reinforced-melody shape from the table above |
| 3 | Lead over the bed — the melody as a sung line on top of the chords | [lead vocabulary](#lead-vocabulary), pentatonic phrasing |
| 4 | Climax — highest register, a bend-and-hold, then let-ring or feedback | [climax bend](#lead-vocabulary), the one peak |

The escalation is the arrangement: the harmony barely moves, but the guitar's role moves
through the section-form table one pass at a time, so each return of the loop lands
harder than the last. This is exactly how a Pachelbel progression becomes a rock cover
without rewriting a chord — and it is the reason `harmonicLoop` is a planning signal
worth checking at Gate A. (Caveat: `harmonicLoop` is a detector, not a guarantee. When
`piano-extract.mjs` reads arpeggiated triads as maj7 sonorities the field comes back `null`
even on a piece a human hears as a loop — in that case read the cycle off the `-map.md`
bar table by hand and apply the same per-pass plan.)

Re-metering the loop is usually part of the deal — see
[Re-metering the groove](piano-to-guitar-arranging.md#re-metering-the-groove).

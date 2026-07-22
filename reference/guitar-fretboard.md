# Guitar Fretboard Model (standard tuning)

This file answers *where a pitch lives*. It does not decide *which* of the several
positions to use — that is a timbre call, and it belongs to
[electric-guitar-voice.md](electric-guitar-voice.md): the same pitch is a different
instrument on the neck pickup at fret 12 than on the bridge at fret 5. The last
section here, [Where a pitch sounds best](#where-a-pitch-sounds-best-position--pickup-character),
is the bridge between the two files. Hand-span and reach limits on these shapes live
in [guitar-playability.md](guitar-playability.md).

## String numbering — two conventions, don't mix them up

- **AlphaTex source** (what you write): string **1 = high e (E4)** … string **6 = low E (E2)**.
- **alphaTab internal / tool output** (`fretRangeByString` in validate stats):
  inverted — internal string 1 = low E. `source = 7 − internal` on 6 strings.

## Open strings (AlphaTex numbering)

| String | Note | MIDI |
|---|---|---|
| 1 | E4 | 64 |
| 2 | B3 | 59 |
| 3 | G3 | 55 |
| 4 | D3 | 50 |
| 5 | A2 | 45 |
| 6 | E2 | 40 |

**Pitch formula**: `midi = open[string] + fret + capo`. Each fret = 1 semitone.

## Fret → note grid (frets 0–15, standard tuning)

| Str | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | E4 | F4 | F#4 | G4 | G#4 | A4 | A#4 | B4 | C5 | C#5 | D5 | D#5 | E5 | F5 | F#5 | G5 |
| 2 | B3 | C4 | C#4 | D4 | D#4 | E4 | F4 | F#4 | G4 | G#4 | A4 | A#4 | B4 | C5 | C#5 | D5 |
| 3 | G3 | G#3 | A3 | A#3 | B3 | C4 | C#4 | D4 | D#4 | E4 | F4 | F#4 | G4 | G#4 | A4 | A#4 |
| 4 | D3 | D#3 | E3 | F3 | F#3 | G3 | G#3 | A3 | A#3 | B3 | C4 | C#4 | D4 | D#4 | E4 | F4 |
| 5 | A2 | A#2 | B2 | C3 | C#3 | D3 | D#3 | E3 | F3 | F#3 | G3 | G#3 | A3 | A#3 | B3 | C4 |
| 6 | E2 | F2 | F#2 | G2 | G#2 | A2 | A#2 | B2 | C3 | C#3 | D3 | D#3 | E3 | F3 | F#3 | G3 |

## Same pitch, multiple positions

Every pitch above ~A2 exists in 2–4 places. Adjacent-string unison offsets:
**+5 frets** on the next-lower string reproduces the same pitch — except across
strings 2→3, where it's **+4**. Example: E4 = 0.1 = 5.2 = 9.3 = 14.4.
Choose the position that (a) stays in the hand's current 4-fret window,
(b) keeps a run on adjacent strings, (c) allows the technique (bends need
strings 1–3; palm mutes want strings 4–6).

## Register guidance

- **Rhythm / riffs**: strings 4–6, frets 0–9. Power and clarity live low.
- **Lead / melody**: strings 1–3, frets 5–17. Singing range, bendable.
- **Sweet spot for vocals-like melody**: A3–E5 (string 2 frets 0–12, string 1 frets 0–12).
- Above fret 17: reserve for climaxes; thin sound, hard intonation.

## CAGED position map

Any key tiles the whole neck as **five overlapping shapes**, each named for the open
chord it derives from: **C, A, G, E, D**. Moving *up* the neck the shapes always appear
in that cyclic order — `C → A → G → E → D → C → …` — and adjacent shapes **share notes**
where they meet, so the neck is covered with no gaps. Which shape sits in open position
depends on the key.

Each shape has a fixed root-string signature; that never changes with key:

| Shape | Root on string | Second root | Grip character |
|---|---|---|---|
| **C** | 5 | 2 | shape descends *below* the string-5 root |
| **A** | 5 | 3 | barre shape; the string-5 root is the low note |
| **G** | 6 | 3, 1 | wide; roots on both outer strings |
| **E** | 6 | 4, 1 | the barre-chord workhorse; root is the low note |
| **D** | 4 | 2 | top-four-strings shape, no low root |

### Concrete tiling — key of E (a common rock target key)

Transposed to E major, so open low E is the tonic. Windows overlap by design; a shared
root note is the seam between two shapes.

| Zone (low→high) | Shape | Anchor fret | Root note here | Fret window | Use at arranging time |
|---|---|---|---|---|---|
| 1 | **E** | open (0) | E2 = `0.6` | 0–4 | open-position riffs; tonic pedal on the open low E |
| 2 | **D** | 2 | E3 = `2.4` | 2–5 | triad fragments and double stops on strings 1–4 |
| 3 | **C** | 4 | E3 = `7.5` (shape falls below) | 4–7 | mid-neck chord fragments |
| 4 | **A** | 7 | E3 = `7.5` | 7–9 | barre chords, the low melody statement |
| 5 | **G** | 9 | E3 = `12.6` | 9–12 | approach to the high tonic |
| 1′ | **E** | 12 | E3 = `12.6` | 12–16 | octave-up home; the singing lead zone |

Note zones 3 and 4 both hang off the same E3 at `7.5` — that shared root is the C/A seam.

**Minor keys via the relative major.** E minor is the relative of G major, so the
**G-major CAGED zones are the E-minor zones** (identical notes, different tonic). For a
piece in G/E minor, grab the G-major tiling and treat E as the resolution. Same trick for
G minor → use the Bb-major shapes.

**Arranging use.** CAGED's payoff is *not* barre chords — it is that from wherever your
melody note already sits, the nearest tonic, fifth, and full chord shape are one zone away.
Find the melody, identify its zone, and voice the accompaniment inside the **same 4-fret
window** rather than jumping the hand across the neck. That is how you keep a reduction
inside one [playability.md](guitar-playability.md) hand position.

## Octave-shape geometry

Root + its octave, two strings apart, with the **intervening string muted** so the pair
can be raked or strummed as one gesture (this is the shape that answers a piano's RH octave
doubling — see [electric-guitar-voice.md](electric-guitar-voice.md#what-the-pick-makes-hard)).
The fret offset depends only on whether the pair straddles the G–B string (the one
major-3rd gap in an otherwise all-4ths tuning):

| Root string | Octave string | Muted between | Fret offset | Example (source frets) |
|---|---|---|---|---|
| 6 | 4 | 5 | **+2** | `3.6` G2 → `5.4` G3 |
| 5 | 3 | 4 | **+2** | `3.5` C3 → `5.3` C4 |
| 4 | 2 | 3 | **+3** | `3.4` F3 → `6.2` F4 |
| 3 | 1 | 2 | **+3** | `3.3` A♯3 → `6.1` A♯4 |

**Why two families.** Strings a fourth apart open at +10 semitones (two 4ths), so an octave
(+12) needs +2 frets. Any pair crossing the G–B major-3rd (strings 4→2 and 3→1) opens at
only +9 semitones, so the octave needs +3 frets. Memorise it as *"2-fret skip on the low
pairs, 3-fret skip once you cross the B string."*

```alphatex
:4 (3.6 x.5 5.4) (5.6 x.5 7.4) (3.5 x.4 5.3) (5.5 x.4 7.3) |
:4 (3.4 x.3 6.2) (5.4 x.3 8.2) (3.3 x.2 6.1) (5.3 x.2 8.1) |
```

Bar 1: G, A octaves on the 2-fret pairs (6→4, then 5→3). Bar 2: F, G octaves on the 3-fret
pairs (4→2, then 3→1). The `x` on the middle string is the muted string that lets the
octave be picked as a block.

## Double-stop 3rds and 6ths

Two-note grips that imply a chord without triggering the low-third intermodulation problem
(see [guitar-playability.md — gain-aware voicing](guitar-playability.md#gain-aware-voicing)).
The Chuck Berry / Hendrix device. Whether the grip is major or minor is a **fret offset**,
and — as with octaves — the offset changes when the pair crosses the G–B string.

**3rds — adjacent strings.** The two notes are struck together (no muted string between).

| String pair | Tuning gap | Major 3rd | Minor 3rd |
|---|---|---|---|
| 3 & 2 (crosses G–B) | maj 3rd | **same fret** — `5.3 5.2` (C4+E4) | high string 1 fret back — `5.3 4.2` |
| 4 & 3, 5 & 4, 6 & 5 | 4th | high string 1 fret back — `5.4 4.3` (G3+B3) | high string 2 frets back — `5.4 3.3` |
| 2 & 1 | 4th | high string 1 fret back — `5.2 4.1` | high string 2 frets back — `5.2 3.1` |

**6ths — skip one string** (the interval is wider, so the shape spans a muted middle string
that is raked through). The muted string makes these safe to strum.

| String pair | Muted between | Major 6th | Minor 6th |
|---|---|---|---|
| 4 & 2 (crosses G–B) | 3 | **same fret** — `5.4 x.3 5.2` (G3+E4) | high string 1 fret back — `7.4 x.3 6.2` |
| 3 & 1 (crosses G–B) | 2 | **same fret** — `5.3 x.2 5.1` (C4+A4) | high string 1 fret back — `7.3 x.2 6.1` |
| 5 & 3 | 4 | high string 1 fret back — `5.5 x.4 4.3` (D3+B3) | high string 2 frets back — `5.5 x.4 3.3` |
| 6 & 4 | 5 | high string 1 fret back — `5.6 x.5 4.4` | high string 2 frets back — `5.6 x.5 3.4` |

```alphatex
:4 (5.3 5.2) (7.3 6.2) (5.4 4.3) (5.4 3.3) |
:4 (5.4 x.3 5.2) (7.4 x.3 6.2) (5.5 x.4 4.3) (5.5 x.4 3.3) |
```

Bar 1: a major then a minor 3rd on the G–B pair, then a major and minor 3rd on the D–G pair
— note how the shape shifts. Bar 2: the 6th inversions of the same intervals, string between
muted. A 6th is a 3rd turned upside down, which is exactly why the major/minor logic mirrors.

## Where a pitch sounds best (position ↔ pickup character)

Every pitch above ~A2 has 2–4 positions (see [Same pitch, multiple positions](#same-pitch-multiple-positions)).
They are **not interchangeable** — string thickness, string tension, and distance from the
pickup make each one a different voice. This table is the bridge to
[electric-guitar-voice.md — Pickups and register](electric-guitar-voice.md#pickups-and-register);
choose the position by the *role* the note plays, then commit the pickup to match.

| Pitch | Low / warm position | Voice there | High / bright position | Voice there |
|---|---|---|---|---|
| B4 | `12.2` (neck pickup) | round, vocal, wide lazy vibrato — **the singing lead** | `7.1` (bridge) | tense, fast transient, horn-like — **the bright answer** |
| G4 | `12.3` | thick, warm, blends into a chord | `3.1` | cutting; sits on top of a mix |
| A4 | `10.2` | warm midrange, easy wide vibrato | `5.1` | bright, immediate attack |
| E4 | `9.3` / `5.2` | mid-string, controllable, blends | `0.1` (open) | rings uncontrollably; can't vibrato or bend it |
| A3 | `7.4` | fat, fundamental-heavy — good for a low riff | `2.3` | thinner, articulate; better for fast lines |

```alphatex
:1 12.2{v} |
:1 7.1{v} |
```

Both bars are **B4**. Bar 1 (`12.2`, neck pickup) is the singing statement; bar 2 (`7.1`,
bridge) is the bright answer. Writing the second when the section wants the first is one of
the commonest ways an arrangement comes out sounding like *piano notes typed onto a
fretboard* rather than a guitar part. Rules of thumb:

- **Open strings** (fret 0) ring long and cannot be vibratoed, bent, or damped by the
  fretting hand — perfect as a droning pedal tone, wrong for an expressive melody note.
- **Lower frets on a thinner string** (e.g. `5.1`) are bright and tight; **higher frets on a
  thicker string** (e.g. `12.2`, `12.3`) are warm, slack, and bend/vibrato easily.
- A melody that repeats should **move up in register on the repeat** (Body → Voice → Air in
  [electric-guitar-voice.md](electric-guitar-voice.md#register-policy)); the same pitches an
  octave higher, or the same octave on a thinner string, are the cheapest convincing escalation.

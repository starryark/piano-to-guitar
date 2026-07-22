# Composition Theory for Guitar (minor/modal-slanted)

Both source pieces read dark, so this file is weighted toward **minor and modal**
harmony, with major kept where it is still load-bearing:

A piano source often reads minor-inflected even when its key signature is major, and a
source in a flat key frequently transposes by a semitone or two to reach a guitar key.
Establish both for your own piece before using anything below — the digest reports `key`,
and the transposition procedure decides the target.

Read this alongside `piano-to-guitar-arranging.md` (the transposition procedure and
worked examples) and `tunings.md` (standard tuning is the default and the target).

## Key selection

Guitar-friendly keys exploit open strings for roots, drones, and easy chords. The
payoff is the **open-string pedal point** — a droning root under moving shapes, which
is how one guitar sounds full. So pick the target key such that the **tonic and
dominant land on open strings** (E, A, D, G). This is the whole point of the
transposition procedure in `piano-to-guitar-arranging.md`; harmony choices here must
serve it.

- **Major**: E, A, D, G (open-position chords + open-string roots), C (no open
  6th-string root).
- **Minor**: Em, Am, Dm, Bm.
  - **Em** — the guitar's native minor: tonic E on the open 6th/1st, dominant B on the
    open 2nd, subdominant Am with an open A. Nearly every diatonic root has an open
    option. (An E-minor centre lives here.)
  - **Am** — tonic A on the open 5th, dominant E (or Em) on the open 6th/1st.
  - **Dm** — tonic D on the open 4th, dominant A on the open 5th.
  - **Bm** — tonic B on the open 2nd; needs a barre for the i chord but sits perfectly
    at fret 7 for rock leads.
- **Drop D**: D major / D minor centres — but a **last resort** with a stated reason;
  see `tunings.md`. Standard tuning is the default.
- Mood defaults: dark/heavy → Em, Am, Dm; melancholy-but-warm → G major / E minor
  a common home for minor-leaning material; bright/anthemic → A or D major; bluesy → A or E.

## The three minor scales

Which form of minor a passage uses tells you what chords and melody notes are
available. Degrees shown from A:

| Scale | Degrees | Character | Use |
|---|---|---|---|
| **Natural minor (Aeolian)** | 1 2 ♭3 4 5 ♭6 ♭7 | dark, resolved, no leading tone | the default; riffs, vamps, the ♭VI/♭VII sound |
| **Harmonic minor** | 1 2 ♭3 4 5 ♭6 **7** | raised 7th → strong V–i pull; exotic ♭6→7 leap | cadences; the major V chord; neoclassical metal |
| **Melodic minor** | 1 2 ♭3 4 5 **6 7** (ascending) | smooths the ♭6→7 gap going up, natural coming down | melodic lines resolving up to the tonic |

The single most useful fact: **the raised 7th is a chord choice, not a fixed property
of the key.** Natural minor gives a minor **v**; borrowing the leading tone from
harmonic minor gives a major **V** that pulls hard to i. Rock uses both — the minor v
for a modal/Aeolian feel, the major V for a decisive cadence.

## Diatonic chords in a minor key

Natural minor stacks to **i · ii° · ♭III · iv · v · ♭VI · ♭VII** (raise the 7th for a
major **V** instead of v). The five that carry rock:

| Degree | in Em | in Am | in Dm | Role |
|---|---|---|---|---|
| **i** | Em | Am | Dm | tonic |
| **iv** | Am | Dm | Gm | subdominant; often the emotional low point |
| **v / V** | Bm / B | Em / E | Am / A | modal cadence (v) or hard cadence (V) |
| **♭VI** | C | F | B♭ | the "epic" chord; borrowed-major weight |
| **♭VII** | D | G | C | the rock/Aeolian workhorse; leads up to i |

Power-chord (root+5th) positions in **Em**, standard tuning. A power chord has **no
3rd**, so the same shape serves major and minor — Bm and B are one voicing, i and I
are one voicing:

| Chord | Low position | AlphaTex |
|---|---|---|
| E5 (i) | E-string 0 | `(0.6 2.5)` |
| G5 (♭III) | E-string 3 | `(3.6 5.5)` |
| A5 (iv) | A-string 0 or E-string 5 | `(0.5 2.4)` / `(5.6 7.5)` |
| B5 (v/V) | A-string 2 or E-string 7 | `(2.5 4.4)` / `(7.6 9.5)` |
| C5 (♭VI) | A-string 3 | `(3.5 5.4)` |
| D5 (♭VII) | A-string 5 or D-string 0 | `(5.5 7.4)` / `(0.4 2.3)` |

Add the octave for a full power chord: `(0.6 2.5 2.4)` = E5 with octave. In Em the
tonic can be the **open low E** — a pedal droning under everything, exactly the payoff
the transposition procedure chases.

For reference, a major key stacks **I · ii · iii · IV · V · vi · vii°**; the fretboard
positions above apply by root name (E5 is E5 in any key). A target key of **E major**
uses E A B C♯m F♯m — all reachable as open or low-position shapes, which is the kind of
payoff that makes a transposition worth it.

## Modal colour

Minor is not one flavour. The mode is set by two notes — the 6th and the 2nd:

- **Aeolian (natural minor)** — ♭6 and ♭7. The **♭VI and ♭VII** are the signature;
  `i–♭VI–♭VII` and the `♭VII–♭VI` descent are the sound. Dark, self-contained. This is
  the default rock minor.
- **Dorian** — **natural 6th** against the minor 3rd, which makes the **IV chord
  major**. The tell is `i–IV` (Em–A, Am–D): a minor tonic answered by a major chord a
  fourth up. Santana, "Oye Como Va," a huge amount of riff rock.
- **Phrygian** — **♭2**, giving a major **♭II** a half-step above the tonic. The tell
  is `i–♭II` (Em–F). Menacing; the metal/flamenco colour. Sharpen the tonic's 3rd for
  **Phrygian dominant** (harmonic-minor mode 5), the neoclassical/Middle-Eastern sound.

To keep a mode audible, **land on its signature note** — the natural 6 for Dorian, the
♭2 for Phrygian — on a strong beat, or the ear defaults back to plain Aeolian.

Metal/Phrygian-leaning pitch collections (referenced above; degrees from the tonic):

| Scale | Degrees | Character | Use |
|---|---|---|---|
| **Double-harmonic** | 1 ♭2 3 4 5 ♭6 7 | the Phrygian-dominant scale with a major 3rd; exotic, Flamenco | the `i–♭II` menace and the harmonic-minor V–i cadence |
| **Octatonic (W–H)** | 1 2 ♭3 4 ♭5 ♭6 6 7 | symmetric, alternating whole/half steps; unresolved tension | chromatic riffs on **i, ♭II, ♭5** — no tonal centre, so always land back on an anchor |
| **Locrian** | 1 ♭2 ♭3 4 ♭5 ♭6 ♭7 | the ♭5 over a tonic pedal; unstable, dark | passing colour, not a key — resolve to i or iv |

The W–H octatonic has a H–W variant (start with the half step); both are symmetric, so any
transposition is also a re-spelling of the same set. Keep all three as **colour over a pedal or
anchor**, never as a key to write a home chord in.

## Progressions (rock/metal subset)

Minor and modal motions, each with the principle rather than a copied song:

- **i–♭VII–♭VI–♭VII** (Em–D–C–D) — Aeolian vamp; the ♭6/♭7 pair over a static tonic
  feel. Loop it.
- **i–♭VI–♭III–♭VII** (Em–C–G–D) — the "epic" minor rotation; every chord major except
  i, so it lifts while staying dark.
- **i–♭VII–♭VI–V** (Em–D–C–B) — descending, Andalusian-flavoured, dramatic; note the
  **major V** (B, not Bm) at the turn to make the cadence.
- **i–iv–i** / **i–iv–V–i** (Em–Am–B–Em) — minor blues/rock backbone; iv is the
  subdominant weight, V the harmonic-minor cadence.
- **i–IV** (Em–A) — the Dorian lift; a major chord a fourth above a minor tonic.
- **i–♭II** (Em–F) — the Phrygian menace; use sparingly and resolve back to i.
- **Blues i–iv–v** in Am or Em with dominant-7 colour for solos.
- **12-bar blues** (I7–IV7–V7) — three 4-bar phrases over the same root motion: I7 (bars
  1–4), IV7 returning to I7 (bars 5–8), then V7–IV7–I7 turnaround (bars 9–12) with the V7
  as the turn. In A: **A7–D7–E7**. **RULE:** under blues tonality the dominant-7 is **stable
  colour**, not a tension demanding resolution — play it as a static, settled sonority,
  which reverses the usual functional-harmony intuition (no need to push the ♭7 of E7 down).
  A dominant-7 voicing playable under distortion (here E7, open low E as root):

  ```alphatex
  :1 (0.6 2.5 0.4 1.3 0.2 0.1) |
  ```

- **Major keys still appear**, and whole sections of a minor-leaning piece may be major:
  **I–V–vi–IV** (E–B–C♯m–A) is the major workhorse; **I–♭VII–IV** (E–D–A)
  borrows the ♭VII for a rock/Mixolydian edge.
- Metal: chromatic riffs on **i, ♭II, ♭5** color *between* diatonic anchors — always
  resolve back.

## Melody rules (what makes a line pleasant)

1. **Chord tones on strong beats** (beats 1 and 3 in 4/4). Passing tones on weak
   beats/offbeats.
2. **Mostly stepwise** motion (scale steps); leaps > a 3rd should be followed by a step
   back in the opposite direction.
3. **Tension resolves**: 4th degree → 3rd, 7th degree → root, ♭9/passing chromatics
   resolve down a half step. **In minor, the raised 7th (leading tone) pulls up to the
   tonic; the natural ♭7 does not — it wants to fall to ♭6.** Choose which 7th by which
   pull you want.
4. **Phrase shape**: 4-bar question / 4-bar answer; end the question on a non-tonic
   chord tone, the answer on the root or 3rd (♭3 in minor).
5. **Climax once**: one highest note per section, ideally on a bend or vibrato, past the
   phrase midpoint.
6. **Breathing**: after a fast run (≥ 4 sixteenths), land on a note ≥ a quarter with
   vibrato.
7. **Repetition with variation**: repeat a motif ≥ 2×; change its ending, not its head.

## Dissonance rules (from voice-leading, still binding)

- Never sound two notes 1 semitone apart simultaneously (or a ♭9 apart across octaves)
  — unless one is a passing tone shorter than an 8th.
- **Power chords (no 3rd) are immune to the major/minor clash** — that is why metal
  uses them under chromatic riffs, and why a power chord correctly renders both a major
  and a minor chord from the source.
- Bass/root below, melody above; keep ≥ a 4th between simultaneous voices when both
  sustain.

## Tempo semantics (why changing BPM is never cosmetic)

- Tempo and subdivision are one system: a `:16` run at 90 BPM is the same physical and
  perceived speed as `:8` at 180. **Changing tempo without rewriting subdivisions
  changes every phrase's feel and playability.**
- Groove bands: 60–80 ballad/half-time feel; 90–120 mid-tempo rock (16th/32nd lead at
  90 is already fast); 120–140 driving rock; 160+ punk/thrash (8th-note riffs, not
  16ths). A ballad at Q≈76 is a tempo where 16th detail still reads clearly.
- To make an existing piece feel "more energetic", prefer: denser subdivisions in the
  *rhythm* part, palm-muted 8ths → 16ths, adding offbeat accents — **not** raising BPM.
- If a tempo change is truly justified (a half-time breakdown, or carrying across a
  source's own tempo-field dip), it changes the whole section's note values too, and it
  must go through a PROPOSAL (see skill rules).

## Rhythm patterns (guitar)

- Rock 4/4 backbone: accents on 2 and 4 (with the snare); riffs push "and of 4" into 1.
- Palm-muted gallop: `:8 x {pm}` + `:16 x{pm} x{pm}` (eighth + two sixteenths), a metal
  staple.
- Syncopated rock riff: hit 1, and-of-2, and-of-3 — rest or sustain elsewhere.
- Keep one rhythmic idea per riff; vary it every 4th bar (fill, push, or stop).
- Odd meter is structural, not a problem to smooth: a recurring cycle such as 7/4
  answered by 6/4 is the piece's identity — count it, do not normalize it.

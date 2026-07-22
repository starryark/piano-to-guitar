# Guitar Playability Rules (hard constraints)

Tab that violates these is wrong even if it parses and sounds fine in MIDI —
a human cannot play it. Check every drafted bar against this list.

These are **mechanical** limits — hand, pick, and physics. *Why* a voicing sounds
like a guitar (timbre, gain, idiom) is in
[electric-guitar-voice.md](electric-guitar-voice.md); fret-to-pitch lookup and the
shapes named below are in [guitar-fretboard.md](guitar-fretboard.md).

## What the tools check, and what they do not

`tools/playability.mjs` checks fret span, one-note-per-string, fast-jump distance, the
gain-aware voicing rules, and (as of WP7) **pick reachability** — a struck beat on
non-adjacent strings with no brush/arpeggio effect fails with `non-adjacent-strings`.
Keeping drafts consistent with those means `check.mjs` passes the first time.

> **Pick reachability is checked as of WP7.** A struck dyad on **non-adjacent** strings
> — `(0.6 5.2)` (6th + 2nd), `(2.6 2.1)` (6th + 1st) — fails `playability.mjs` with a
> `non-adjacent-strings` error: it cannot be sounded with a flatpick, because the pick
> crosses and rings the strings in between. MIDI will not tell you, because MIDI has no
> pick; the lint does.
>
> Only two simultaneous attacks are legal: a **brush across all the strings**
> (`{bd}`/`{bu}`), an **arpeggio roll** (`{au}`/`{ad}`), or a double-stop on **adjacent**
> strings. Anything else must be arpeggiated into single-string attacks. A brushed or
> rolled beat is exempt from the check by construction; the arranger still owns the
> musical decision of *which* remedy fits the texture.

Also not checked: whether a chord shape is *fingerable as a shape* rather than merely
within span, and whether a position shift is reachable in the time available. Both are
yours.

## Hand span

1. **Chord span ≤ 4 frets** between lowest and highest fretted note
   (5 acceptable above fret 7 where frets narrow; only 3–4 below fret 5).
   Open strings (fret 0) are exempt — they need no finger.
2. **One note per string** at any instant. `(5.3 7.3)` is impossible.
3. A single position covers a 4-fret window (index to pinky). Notes within one
   beat group should stay inside one window.

## Position shifts

4. Between consecutive 16th notes (or faster): **no jumps > 5 frets** on the
   same string without a slide (`sl`/`ss`) or an intervening rest/open string.
   At 8th-note pace, up to ~7 frets is possible; at quarter pace, anything goes.
5. String skips at speed: crossing 1 string between fast notes is fine; skipping
   2+ strings between consecutive 16ths is a red flag unless it's a repeating
   pattern (pedal-point licks earn it).

## Bends

6. Bend only strings 1–3 in practice (4 rarely), at frets ≥ 5.
7. Max bend: 4 quarter-steps (whole step) is standard; 8 (two whole steps)
   only above fret 12 on strings 1–2, and only for expressive peaks.
8. While a note is held bent, no other fretted note on adjacent strings.

## Techniques

9. `h` (hammer/pull) works between notes ≤ 4 frets apart on the SAME string.
10. Palm mute (`pm`) is for strings 4–6 near the bridge; `pm` on strings 1–2
    is unusual — justify or remove.
11. Tapping (`tt`) implies the fretting hand holds the lower notes: keep the
    tapped note ≥ 5 frets above the fretted ones.
12. Tremolo bar (`tb`) requires a beat where no other picking happens.
13. Natural harmonics (`nh`) only ring reliably at frets 5, 7, 12, 19.

## Tempo × subdivision ceiling (physical speed limit)

| Tempo | 8ths | 16ths | 16th triplets / 32nds |
|---|---|---|---|
| ≤ 100 BPM | easy | easy | advanced |
| 100–140 | easy | moderate | expert, short bursts only |
| 140–180 | easy | hard (alt-picking or legato) | avoid |
| > 180 | moderate | expert | no |

Sustained 16ths above 160 BPM only as tremolo picking (`tp`) on one pitch or
with heavy legato (`h`). A "fast run" should last ≤ 2 beats before a breath
(longer note or rest) unless it is the climax.

## Gain-aware voicing

These constraints depend on the **gain level committed for the section** (a Gate A
decision). The physics — distortion is nonlinear, so it invents sum/difference tones, and
close low intervals produce a dense dissonant intermodulation smear — is derived in full in
[electric-guitar-voice.md — why distortion forbids low thirds](electric-guitar-voice.md#why-distortion-forbids-low-thirds).
Here is only the rule to check a bar against.

14. **No low 3rd under high gain.** Under high gain, a voicing whose **root sounds below
    ~G3 (MIDI 55)** may not contain a 3rd. In fretboard terms the line is about **fret 3 of
    string 6 / fret 10 of string 5** — below it, write **5ths, octaves, and 4ths only**.
    Move the 3rd up an octave (two octaves above the root, into the midrange) or omit it.
    A power chord (root + 5th) is a correct rendering of *both* major and minor, so dropping
    the 3rd is never a harmonic loss to flag.
15. **Vertical note ceiling by gain** — a hard budget on any simultaneous stack:

    | Gain | Max simultaneous notes | Safe intervals |
    |---|---|---|
    | Clean | 4–6 | anything (triads, 7ths, close voicings) |
    | Crunch | 3–4 | avoid low 3rds |
    | High gain | 2–3 | 5ths, octaves, 4ths |

    If a reduction leaves more notes than the row allows, the reduction is not finished — it
    is not a playability warning to wave through. (This mirrors the gain table in
    [electric-guitar-voice.md](electric-guitar-voice.md#gain-and-its-consequences).)
16. The safe intervals are exactly the shapes in
    [guitar-fretboard.md](guitar-fretboard.md#octave-shape-geometry): power chords, octave
    grips, and — for the 3rd's colour when you must have it — a **6th or a 10th** (3rd up an
    octave) rather than a low 3rd.

```alphatex
:2 (3.6 2.5 0.4) (3.6 5.5 5.4) |
```

Both are G harmony. Beat 1 is a low G major triad (G2/B2/D3) — under high gain it is mud,
with a predictable ~49 Hz difference tone. Beat 2 is the same harmony as G5 + octave
(G2/D3/G3): it fuses, and distortion adds a phantom sub-octave. **Write beat 2.** None of
this applies under clean gain — that is what the "anything" row means.

## Pick reachability across strings

A pick is one point of contact moving in one plane. Rules 4–5 cover *speed* of string
crossing; these cover *which strings a single gesture can and cannot sound*. Full rationale:
[electric-guitar-voice.md — what the pick makes hard](electric-guitar-voice.md#what-the-pick-makes-hard).

17. **A strum crosses every intervening string.** A down/up strum spanning strings *a*…*b*
    sounds **all** strings between them. Any intervening string must therefore be either a
    real chord tone, **fretted into the harmony**, or **muted** (`x.n`). `(0.5 9.2)` looks
    like a clean dyad but a strum through it sounds open D3 and G3 as well — if those do not
    belong, the notation is a lie. Three legal fixes: fret them in, mute them, or mark the
    beat as **hybrid-picked** (pick the low note, fingers the high) and *not* strummed.
18. **Non-adjacent notes struck together want hybrid picking or a roll.** Two notes on
    non-adjacent strings that must hit simultaneously cannot be picked with a single plectrum
    stroke. Realise them as hybrid picking (pick + finger), or as a fast arpeggio `{au}`/`{ad}`
    across the gap. Do not silently leave a two-string skip as if a pick could take it.
    **The mechanical version of this rule is now enforced** — `playability.mjs` emits a
    `non-adjacent-strings` error on any struck beat with ≥2 notes on non-adjacent strings
    unless it carries a brush (`{bd}`/`{bu}`) or arpeggio (`{au}`/`{ad}`) effect (checked
    as of WP7). Rule 17 — *which* strings a strum rings — stays the arranger's call.
19. **Big skips at speed cost accuracy.** Crossing one string between fast notes is free;
    skipping **2+ strings between consecutive 16ths** is a red flag unless it is a repeating,
    hand-learnable pattern (a pedal-point lick earns it — see rule 5). A wide interval a pick
    genuinely cannot track should be re-voiced onto adjacent strings, slid (`sl`), or tapped
    (`tt`).

```alphatex
:8 (0.5 9.2) (0.5 7.2) (0.5 5.2) (0.5 7.2) (0.5 9.2) (0.5 10.2) (0.5 9.2) (0.5 7.2) |
```

Correct and idiomatic **as hybrid picking** — open A pedal on string 5, moving line on
string 2, strings 4 and 3 never sounded. As a *strum* it is wrong (rule 17). The notation is
identical; the difference is whether the arranger thought about the picking hand.

## Sustain and re-attack

A guitar note **decays**; a piano note under the pedal effectively does not. Copying a piano's
long held note literally produces a note that dies mid-bar. Sustain is a *resource* on
electric guitar, but only if it is engaged — see
[electric-guitar-voice.md — sustain answers the sustain pedal](electric-guitar-voice.md#sustain-answers-the-sustain-pedal).

20. **Any note held ≥ 2 beats (a half note or longer) must carry a sustain treatment or a
    re-attack.** Acceptable: let-ring `{lr}`, tremolo picking `{tp}`, vibrato `{v}`/`{vw}`
    (which also re-excites the string and, under gain, keeps feedback alive), a held-and-
    vibratoed bend, or simply re-striking the note. A bare long note — no effect, no
    re-attack — is a defect: `tools/playability.mjs`'s sustain check warns on exactly this.
    Vibrato on every held note is also the single biggest tell of guitaristic writing, so it
    is the default choice.

```alphatex
:1 12.3{v lr} |
:1 -.1 |
```

D4 held across two bars: struck once with vibrato + let-ring, then tied. It rings for the
full two bars. **Without** the `{v lr}` the same tied whole note decays into silence before
bar 2 ends — that is the bare-sustain defect. When a held note must instead imply a *moving*
harmony, do not re-strike a full chord every beat (that destroys the legato and, under gain,
stacks note-separation problems); let-ring the pedal tone and articulate only the movement.

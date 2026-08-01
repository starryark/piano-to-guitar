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
non-adjacent strings with no brush/arpeggio effect is flagged, as an error or a warning
depending on how many notes sound at once (rule 18). Keeping drafts consistent with those
means `check.mjs` passes the first time.

**Exit codes.** `playability.mjs` exits `0` when it found no hard error — *warnings do not
fail it* — `1` on any hard error, `2` on a usage/IO problem. Warnings are still printed and
still serialized in `warnings[]`; they are advisories to weigh, not refusals. Pass
`--warnings-as-errors` when you want a zero-warning bar.

**The instrument is configurable.** The fret ceiling defaults to 22 but is not a law:
`--max-fret N`, or an `instrument.maxFret` in the nearest `config.json` at or above the tab
(e.g. `projects/<slug>/config.json`), sets it. A fret past that ceiling is a hard
`fret-range` error. A `--policy` file's own `maxFret` is a *separate* project-texture
ceiling (`policy-max-fret`) and both stay in force.

> **Pick reachability is checked as of WP7.** A struck dyad on **non-adjacent** strings
> — `(0.6 5.2)` (6th + 2nd), `(2.6 2.1)` (6th + 1st) — cannot be sounded with a single
> flatpick stroke, because the pick crosses and rings the strings in between. MIDI will not
> tell you, because MIDI has no pick; the lint does. A **dyad** raises a
> `non-adjacent-dyad` **warning** (hybrid picking realises it as written); **three or more**
> simultaneous non-contiguous notes are a `non-adjacent-strings` **error**.
>
> Only these simultaneous attacks are straightforwardly legal: a **brush across all the
> strings** (`{bd}`/`{bu}`), an **arpeggio roll** (`{au}`/`{ad}`), a double-stop on
> **adjacent** strings, or a two-note **hybrid-picked** grip. Anything else must be
> arpeggiated into single-string attacks. A brushed or rolled beat is exempt from the check
> by construction; the arranger still owns the musical decision of *which* remedy fits the
> texture.

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

4. **Between consecutive 16th notes (or faster):** **no jumps > 5 frets** on the
   same string without a slide (`sl`/`ss`) or an intervening rest/open string —
   `playability.mjs` fails these as a `position-jump` **error** (hard).
   **At 8th-note or slower pace** a big shift is *reachable* but is still a full
   hand-station relocation, and the recurring trap is a **low-pedal-vs-high-stab
   alternation** — an open-position pedal (say fret 3) answered by a stab up the
   neck (say fret 13), so the hand ping-pongs across the neck once per eighth.
   `playability.mjs` now raises a **`position-jump-slow` warning** when two
   consecutive beats slower than a 16th have a `minFret` gap **> 6** with no
   slide/hammer legato (surfaced by `check.mjs`, **non-gating** — an advisory to
   reconsider, not a hard fail). The remedy is not to slide faster: **keep the
   pedal inside the stab's fret position** — voice it as a *string-cross within one
   hand station* rather than a hand-jump — or anchor one station, use an open
   string, or slide (`sl`) the move.
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
13. Natural harmonics (`nh`) only ring **reliably** at frets 5, 7, 12, 19 — those speak on
    any guitar, with any touch, at any gain. Frets **4, 9, 16, 24** are real nodes too but
    **extended** ones: they ring weakly, need an accurate touch and a hot pickup, and may
    not speak at low gain. `playability.mjs` says nothing about the reliable four, raises a
    `harmonic-node-extended` **warning** on the extended four, and errors
    (`harmonic-node`) anywhere else. **Artificial / pinch / tapped / semi / feedback**
    harmonics (`ah`/`ph`/`th`/`sh`/`fh`) are made by the picking hand relative to the
    fretted note, so the written fret says nothing about a node — the node table does not
    apply to them at all and the lint leaves them alone.

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

`tools/playability.mjs` encodes this table in `tools/lib/pick-demand.mjs`
(`classifyPickDemand`) and reports it as `pick-demand.hard` / `.expert` / `.avoid`
**warnings — pick demand never fails the gate.** Two details the prose leaves implicit and
the code has to pin down: the tempo bands are **[lo, hi)** with boundaries at 100 / 140 /
180, so 100 BPM is in the *second* row; and only **genuine pick attacks** count toward a
run — tied continuations, tremolo beats and legato destinations do not, and each of them
*breaks* the run. That is why a tremolo-picked or heavily-legato passage never accumulates
one. `advanced` and `expert, short bursts only` map to `expert`, `no` maps to `avoid`; the
"short bursts" nuance is carried separately, so `hard`/`expert` warn only once a run
exceeds the ≤ 2-beat budget above, while `avoid` warns immediately.

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
18. **Non-adjacent notes struck together want hybrid picking or a roll.** Notes on
    non-adjacent strings that must hit simultaneously cannot be picked with a single plectrum
    stroke. Realise them as hybrid picking (pick + finger), or as a fast arpeggio `{au}`/`{ad}`
    across the gap. Do not silently leave a two-string skip as if a pick could take it.
    **The mechanical version of this rule is enforced**, and it is graded by how many notes
    sound at once, because the two cases are different problems:

    | Simultaneous notes on non-contiguous strings | `playability.mjs` |
    |---|---|
    | **2** (a dyad) | `non-adjacent-dyad` **warning** — "Non-adjacent dyad: hybrid picking or a roll may be required." |
    | **3 or more** | `non-adjacent-strings` **error** (hard) |

    A dyad is the textbook hybrid grip — pick the low note, middle finger the high one — so
    the notation is already correct and needs only a deliberate right-hand decision; failing
    the gate on it would be telling the arranger to rewrite playable music. Three or more
    non-contiguous simultaneous attacks are not a grip a rock player throws inside a line:
    they need a brush, a roll, or a re-voicing. Beats carrying a brush (`{bd}`/`{bu}`) or
    arpeggio (`{au}`/`{ad}`) effect are exempt from both (checked as of WP7). Rule 17 —
    *which* strings a strum rings — stays the arranger's call.
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

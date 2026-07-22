# Tunings — standard first, alternates by exception

**Standard tuning E–A–D–G–B–e is the default and the target.** Every arrangement in
this project starts here and stays here unless a specific low root proves genuinely
unreachable. Standard tuning is where every learned shape, every open-string pedal
point, and the transposition procedure in `piano-to-guitar-arranging.md` live.

> **Rule (enforced by the skill):** A tuning is chosen once per song, at the **Gate A
> planning step**, from the target key and the lowest required note. Any tuning other
> than standard requires a **stated musical justification in the plan, before any tab
> exists.** Changing it later invalidates every fingering in the file and forces
> re-approval. "It sounds heavier" is never a reason — heaviness comes from palm mutes,
> low power chords, gain, and rhythm, not from detuning.

Default when no `\tuning` tag is present: **Standard E** — `\tuning (E4 B3 G3 D3 A2 E2)`,
or simply omit the tag.

## Why standard is the target: open-string tonic and dominant

The reason to prefer standard tuning is not habit. It is that the **key choice** does
the work an alternate tuning would otherwise be asked to do. The transposition
procedure in `piano-to-guitar-arranging.md` picks the target key so that the **tonic and
dominant fall on open strings**:

| Open string | Tonic of | Dominant of |
|---|---|---|
| E (6th/1st) | E, Em | A, Am |
| A (5th) | A, Am | D, Dm |
| D (4th) | D, Dm | G, Gm |
| G (3rd) | G | C, Cm |
| B (2nd) | Bm (barre i) | E, Em |

Land the tonic on an open string and you get the **open-string pedal point** — a
droning root under moving shapes — which is how one guitar sounds full. That payoff is
available in *standard* tuning; you buy it with the **key**, not with the pegs.

**How a semitone decides it.** Take a source where every chord is a barre and no open
string is the tonic. Move it one semitone so the tonic becomes the **open low E**: the
dominant B is now the **open 2nd string**, and if the lowest structural bass note folds
up to sit above E2, the whole piece fits standard tuning with a fret to spare — and no
case for Drop D exists. Run that comparison yourself with the table in
`piano-to-guitar-arranging.md`. A source already in G / E minor (or D, A, E) is usually
ideal for standard tuning already and should be transposed by nothing.

## When an alternate tuning is actually warranted

Drop D (or lower) earns its place only when **all** of these hold:

1. The arrangement genuinely requires a low root **below E2** that octave-folding
   cannot resolve musically — i.e., the piece is centred on D (or lower) and that low D
   *is* the tonic pedal, not an incidental passing bass note.
2. **No transposition** brings that centre onto an open string in standard tuning
   without wrecking the melody's register or the rest of the key.
3. The gain is high enough that the extra low-string weight is a real musical event,
   not merely a lower note.

If the low root can fold up an octave and still read (per the octave-folding policy in
`piano-to-guitar-arranging.md`), **standard tuning wins** — fold it and move on.

## The tunings, and what each costs

| Tuning | AlphaTex | Enables | Favours | Cost |
|---|---|---|---|---|
| **Standard E** *(default / target)* | `\tuning (E4 B3 G3 D3 A2 E2)` or omit | everything; all learned shapes; open-string pedals in E/A/D/G and Em/Am/Bm/Dm | E A D G major; Em Am Bm Dm | none |
| **Drop D** | `\tuning (E4 B3 G3 D3 A2 D2)` | low D tonic pedal; one-finger `(0.6 0.5)` power chords on string 6 | D major/minor with a true low-D centre | **loses** string-6 shapes you knew — single notes and power chords on the 6th string shift **+2 frets**, and the low E is gone |
| **E♭ / half-step down** | `\tuning (Eb4 Bb3 Gb3 Db3 Ab2 Eb2)` | same shapes a half-step darker; easier vocals | anything a half-step flat | detunes against fixed-pitch instruments; only if the whole track drops a half-step (note: this project instead transposes **up** to reach standard) |
| **Drop C** | `\tuning (D4 A3 F3 C3 G2 C2)` | very heavy; whole-step-down + drop | C-centred modern metal | floppy strings; every shape transposes; confirm with the human |
| **DADGAD** | `\tuning (D4 A3 G3 D3 A2 D2)` | drones, sus2/sus4 colour | D modal / Celtic | standard chord shapes break; niche |
| **Open G** | `\tuning (D4 B3 G3 D3 G2 D2)` | major-G chord strummed open; slide/bottleneck | G-centred slide, Keith Richards vamps, low-drone source only | standard chord shapes break; slide-only justification — not for fretted solo arranging |
| **Open D** | `\tuning (D4 A3 F#3 D3 A2 D2)` | major-D chord strummed open; slide/bottleneck | D-centred slide, fingerpicked open voicings, low-drone source only | standard chord shapes break; slide-only justification — not for fretted solo arranging |

## Decision order (at Gate A)

1. **What is the target key?** From the melody/harmony plan and the transposition
   procedure — chosen to put tonic and dominant on open strings, **not** chosen to fit a
   tuning.
2. **What is the lowest structural note** after octave-folding? If ≥ E2 → **Standard,
   done.**
3. If a required tonic-pedal root is D2 (or lower) and the piece is genuinely D-centred
   → consider **Drop D**, and write the justification into the plan.
4. Lower still, or dependent on modal drones → Drop C / DADGAD only with explicit human
   sign-off.
5. **When in doubt: Standard E.** The key, not the tuning, is almost always the right
   lever.

# Case study — *Canon Rock*: what a piano→guitar rock cover actually does

This is a **case study of one piece**, not a rulebook. Everything below was derived from the six
files in `CanonRock/`. No number here is a value to copy into your own arrangement; each is a
*magnitude to expect*, and the derivation is stated so you can decide whether your piece is like
this one. Where a cover made a choice, the choice is named as a choice — not as a rule.

**How to read the evidence tags.**

| Tag | Means |
|---|---|
| **[M]** | **Measured.** Produced by parsing the corpus with `@coderline/alphatab` 1.5.x. Reproducible — see §13. |
| **[I]** | **Inferred.** A musical judgement built on top of measured data. Argue with it freely. |

`CanonRock/` is **read-only**. Nothing in this study modified it.

---

## 0. The findings in one page

1. **[M]** The source (`canon-in-d-hard`) is a strict chaconne: **one 4-bar harmonic loop
   (`D|A Bm|F#m G|D G|A`, two chords per bar) repeated 14 times**, plus a final chord. Every
   pass is harmonically identical; the variation lives entirely in added voices.
2. **[M]** The source's protected skeleton is *literally* invariant: voice `s1v5` plays
   `D3 A2 | B2 F#2 | G2 D2 | G2 A2` — the same eight half-notes — in **all fourteen passes**, and
   the descant voice `s0v0` repeats a byte-identical four-bar cell across bars 17–52.
3. **[M]** In both guitar covers, the **melodic skeleton survives exactly**: the eight-note
   descant `F#5 E5 D5 C#5 B4 A4 B4 C#5` reappears **at the same written pitch, one note per bar**,
   at `Canon Rock 1` bars 22–29 and 30–37, and at `Canon Rock 2` bars 1–8, 33–40, 41–48 —
   and again as the *downbeats* of the 16th-note shred at `Canon Rock 1` bars 145–152.
4. **[M]** The **key never moves. There is no transposition anywhere in this corpus.** All six
   files are D major — G♯ appears 5 times and D♯ 0 times in ~10 000 notes, against 1123 G♮.
   An earlier reading of the corpus as "Canon in E, +2 semitones" was an artifact of reading a
   melodic low note as a chord root; it is corrected in §1.2 and not argued anywhere in this study.
   Because the key is constant, **every difference between the two covers is rhythm, density,
   register and idiom** — a cleaner controlled comparison than a key change would have given.
5. **[M]** The three "covers" are **one arrangement in three notations**, not independent covers;
   see §1.2 and §3.
6. **[M]** The reduction is brutal and the addition is total: the source has **62 % polyphonic
   onsets, up to 14 simultaneous notes, 26.5 notes/second, and one performance marking in the
   whole file**. The covers have **~3 % polyphonic onsets, never more than 4 notes, never a
   non-adjacent string pair, ~5.1 notes/second, and 200–430 performance markings each**. This
   addition half — §9 — is the part of the doctrine the corpus documents best.

---

## 1. The corpus, re-measured

### 1.1 Structural facts

Every row below was re-derived independently of §2.1 of the build plan and agrees with it unless
flagged. **[M]**

| File | Parse | Tracks / staves | Bars | Header tempo | Voices w/ notes | Notes | Playing time |
|---|---|---|---|---|---|---|---|
| `canon-in-d-easy` | **AT218 fail**; 11 rewrites → OK | 1 / 2 | 49 | 25 † | s0v0, s1v4 | 431 | 7:50 † |
| `canon-in-d-intermediate` | OK | 1 / 2 | 102 | 100 | s0v0, s1v4 | 1599 | 4:05 |
| `canon-in-d-hard` | OK | 1 / 2 | 57 | 120 | s0v0–3, s1v4–7 | 3023 | 1:54 |
| `cannon-rock-Piano` | OK | 2 / 1,1 | 217 | 120 | t0v0, t0v1, t1v0 | 3009 | 5:02 |
| `Canon Rock 1` | OK | 1 / 1 | 210 | 90 | v0 | 1461 | 4:47 |
| `Canon Rock 2` | OK | 1 / 1 | 162 | 170 | v0 | 1046 | 3:18 |

† `canon-in-d-easy` declares `\tempo 100` and then `\tempo 25` on the next line. alphaTab honours
the second, so the file nominally plays for 7:50. **[I]** That is an export artifact, not a
musical intention. Note also that `easy` is **49 bars and 431 notes** — a short reduction of the
piece, not a peer of the other three Canon in D files. Treat it as the AT218 fixture it is, not as
a fourth data point about arranging.

Confirmed exactly as measured in §2.1: parse status, track/staff counts, bar counts, header
tempos, voice inventories, note counts, and the bars 1–20 "lowest sounding note per bar" rows.
The AT218 fix rewrites **exactly 11** tokens and the other five files normalise to a no-op. **[M]**

Pitch ranges, and the deficit against a guitar's E2–E5 sounding window: **[M]**

| File | Sounding range | Notes below E2 | Notes above E5 |
|---|---|---|---|
| `canon-in-d-easy` | D2–D6 | 12 (2.8 %) | 47 (10.9 %) |
| `canon-in-d-intermediate` | D2–D6 | 27 (1.7 %) | 211 (13.2 %) |
| `canon-in-d-hard` | **D0–F#7** (89 semitones) | **136 (4.5 %)** | **418 (13.8 %)** |
| `cannon-rock-Piano` | A2–C#6 | 0 | 171 (5.7 %) |
| `Canon Rock 1` | E2–C#6 ‡ | 0 | 265 (18.1 %) |
| `Canon Rock 2` | E2–D6 | 0 | 124 (11.9 %) |

‡ `Canon Rock 1` reports E2–B6 if you read `note.realValue` naively. The B6 is an **artificial
harmonic** (`{ah}`/`harm2`), for which alphaTab returns the *sounding harmonic*, not
`tuning + fret`. Excluding the nine harmonic notes the real span is E2–C#6. **[M]** — see §12.

### 1.2 Two corrections to the measured facts

**Correction 1 — the key never moves. All six files are D major.** **[M]**

§2.1 fact 1 states that `Canon Rock 1` and `cannon-rock-Piano` "sit on E/B/C#/A — Canon in E,
i.e. +2 semitones". That reading came from the "lowest sounding note per bar" row, which for a
**single-line guitar tab is just the lowest melody note of the bar**, not a chord root. The first
four bars of `Canon Rock 1` are an unaccompanied lead lick in the 12th-position box; their lowest
notes happen to be B, E, C#, A.

Duration-weighted Krumhansl–Schmuckler over each whole file:

| File | Best key | r | 2nd | G♮ count | G♯ count | Ends on |
|---|---|---|---|---|---|---|
| `canon-in-d-easy` | **D major** | 0.958 | B minor 0.728 | 62 | 0 | D |
| `canon-in-d-intermediate` | **D major** | 0.953 | F♯ minor 0.701 | 187 | 0 | D |
| `canon-in-d-hard` | **D major** | 0.913 | B minor 0.746 | 354 | 0 | D (bar 57) |
| `cannon-rock-Piano` | **D major** | 0.961 | B minor 0.664 | 491 | 3 | D (bar 217) |
| `Canon Rock 1` | **D major** | 0.921 | A major 0.727 | 179 | 2 | D5 (bars 209–210) |
| `Canon Rock 2` | **D major** | 0.960 | A major 0.733 | 84 | 0 | D major triad `D3 A3 D4 F♯4` (bars 161–162) |

E major requires G♯ and D♯. Across the entire corpus there are **5 G♯ and 0 D♯**, against 1123 G♮
and 2020 D♮. Every file is a two-sharp collection: F♯ and C♯ present, F♮ and C♮ under 2 % of notes
everywhere. In `Canon Rock 1` most of the F♮ (10 of 14) and A♯ (11 of 20) sit inside a single
16-bar parallel-minor passage, bars 153–168 (§9.8); the rest are chromatic passing notes. **[M]**

Four further checks, all measured, all pointing the same way:

- **A single token settles it.** `Canon Rock 1` bar 1 is `12.2 14.2 15.2 17.2` — frets 12/14/15/17
  on the B string = `B4 C♯5 D5 E5`. A **D natural**, in bar 1, cannot occur in E major.
- **No capo, no transposition.** Both guitar files carry `tuning = [64,59,55,50,45,40]`
  (standard), `capo = 0`, `transpositionPitch = 0`, and no `capo` directive appears in either
  file's text. (`displayTranspositionPitch = -12` is the ordinary guitar treble-clef convention.)
- Every file **ends on D** (right-hand column above).
- `tools/piano-extract.mjs` infers **D** for all six, by an implementation independent of the
  correlation above.

**There is no transposition anywhere in this corpus, and this study makes no claim about
transposition as a technique.** The roots that produced the "Canon in E" reading — E, B, C♯, A —
are all diatonic to D major; they are a rotation within the same chaconne, not a move out of it.

What §2.1's fact 3 *does* get right is that the declared key signature lies: `Canon Rock 1`
declares `\ks c` while sounding in D, and `piano-extract.mjs` correctly flags
`key D (declared C — DISAGREES, not trusted)`. **Derive the key from pitch content, never from
`\ks`** — that instruction survives intact; only its example changes. **[M]**

Because the key is constant, every difference between the two covers is a difference of **rhythm,
density, register and idiom** — which is a cleaner controlled comparison than a key change would
have been, and is what §§6, 8, 9 and 10 are about. The question that replaces "why +2?" is
**"what does the D-major fretboard afford this piece?"** — §7.

**Correction 2 — there are not three independent covers. There is one arrangement, notated three
times.** **[M]**

Aligning every candidate (bar offset × transposition) by exact onset-and-pitch agreement of the
top line:

| Pair | Best alignment | Strict agreement | Bars 100 % identical | Next-best alignment |
|---|---|---|---|---|
| `cannon-rock-Piano` t0 → `Canon Rock 1` | offset **−4**, transpose **0** | 593/1519 = **39 %** | **70** | 11 % |
| `Canon Rock 2` → `Canon Rock 1` | offset **−11**, transpose **0** | 356/974 = **37 %** | **30** (50 at ≥70 %) | 11 % |

Corroborating evidence, all measured:

- The tempo automations line up at the same offsets. `cannon-rock-Piano` changes tempo at bars
  2, 10, 132, 141, 206; `Canon Rock 1` at bars 1, 6, 128, 137, 201 — a constant +4/+5.
- `Canon Rock 1` bars 38–48 and `Canon Rock 2` bars 49–59 are the same music down to the fret
  and string choices, including an idiosyncratic octave drop to F♯3 on the A string.
- `Canon Rock 1` bar 6 and `Canon Rock 2` bar 17 are the same riff, in the same position.

**[I]** The lineage is: Pachelbel → **JerryC's *Canon Rock*** (the recomposition) → three
realizations of it: `Canon Rock 1` (tab, credited "JerryC / tab: Junior Antoneli"),
`cannon-rock-Piano` (the same arrangement re-notated on pitched staves and split across two
tracks), and `Canon Rock 2` (Cole Rolland's re-cover, which reorders sections, drops some and
adds a tapping section).

This makes the corpus *more* useful, not less: it is three independent notational readings of one
recomposition, which lets you separate **what the arrangement decided** from **what a transcriber
decided**. But the study must not claim two independent arrangers reached the same answer.

---

## 2. The source — what `canon-in-d-hard` actually is

### 2.1 A chaconne: one 4-bar loop, 14 passes

Harmony measured at **half-bar** resolution across all 57 bars: **[M]**

```
bars  1– 4   D|A   Bm|F#m   G|D   G|A
bars  5– 8   D|A   Bm|F#m   G|D   G|A
… identical for 14 consecutive passes …
bars 53–56   D|A   Bm|F#m   G|D   G|A
bar  57      D  (final chord, D1–D7)
```

Fourteen passes, zero harmonic deviation. The other three "Canon in D" files run the same loop;
`easy` and `intermediate` simply begin it in bar 2 because their bar 1 is an empty pickup bar
(`hard` fills bar 1 with the bass). **[M]** — that one-bar shift is a real trap for span mapping.

**The harmonic rhythm is two chords per bar.** This matters more than it looks: a per-bar harmony
detector cannot see it, and merges `D` + `A` into a single seven-pitch-class sonority. See §12.

### 2.2 The protected skeleton, literally

Two voices carry the piece, and neither one ever changes. **[M]**

**The ground (staff 1, voice 5)** — two half notes per bar, bars 1–56, unchanged in every pass:

```
D3 A2 | B2 F#2 | G2 D2 | G2 A2
```

**The descant (staff 0, voice 0)** — stated plainly in bars 5–8:

```
bar 5: F#5 E5   bar 6: D5 C#5   bar 7: B4 A4   bar 8: B4 C#5
```

From bar 17 to bar 52 the descant voice repeats an **identical four-bar cell nine times**:

```
D4 D5 F#5 C#4 C#5 E5 | B3 B4 D5 A3 A4 C#5 | G3 G4 B4 F#3 F#4 A4 | G3 B4 A3 C#5
```

Everything else — voices `s0v1`, `s0v2`, `s0v3`, `s1v4`, `s1v6`, `s1v7` — is added figuration
that appears, thickens and vanishes. **[M]**

**[I]** The source itself is already built the way the doctrine says a cover should be built: a
protected skeleton plus declared additions. The arranger's job is not to invent that structure —
it is to *find* it and then keep it while replacing every layer above it.

### 2.3 The density ramp

Notes per bar, per pass: **[M]**

| Pass | Bars | Notes/bar | New in this pass |
|---|---|---|---|
| 1 | 1–4 | 2–8 | ground + LH broken chords |
| 2 | 5–8 | 10 | descant enters |
| 3–4 | 9–16 | 16–20 | second RH voice |
| 5–6 | 17–24 | 37–48 | **16th notes appear** (bars 17–52) |
| 7–8 | 25–32 | 47–56 | bass doubled at the octave (A1/F♯1/D1/G1) |
| 9–10 | 33–40 | 69–78 | third RH voice |
| 11 | 41–44 | 89–98 | fourth layer (`s1v7`) |
| 12 | 45–48 | 113–123 | **32nd notes** (bars 45–52); full-keyboard cascade |
| 13 | 49–52 | 112–150 | peak density |
| 14 | 53–56 | 8 | **texture resets to the opening** |
| — | 57 | 14 | final D chord, D1–D7 |

### 2.4 What makes it un-guitarable

- **Span.** D0–F♯7 = 89 semitones. A standard-tuned 24-fret guitar covers E2–E6 = 49. **[M]**
- **Below the piano, even.** Bars 45–48 run a 32nd-note arpeggio cascade in voice `s1v5` that
  descends to `D0`, `G♭0`, `G0` — *below A0, the lowest key on a piano*. The source is not
  literally playable at the bottom either. **[M]**
- **Polyphony.** 62 % of the source's 876 onsets carry ≥2 simultaneous notes, up to **14**. **[M]**
- **Rate.** 3023 notes in 114 s = **26.5 notes/second**. **[M]**

**[I]** Any "faithful transcription" of this is impossible on one guitar, and this is exactly why
the project's doctrine is recomposition rather than transcription. The corpus does not show a
cover *trying and failing* to transcribe. It shows a cover that never tried.

---

## 3. The covers — one arrangement, three realizations

**[M]** `Canon Rock 2` is the only file in the corpus carrying section markers, and they are
authorial:

| Bar | Section | Bar | Section |
|---|---|---|---|
| 1 | Intro | 91 | Lead Theme |
| 17 | Theme Riff | 99 | Tapping A |
| 25 | Band In | 107 | Solo |
| 33 | Lead Theme | 126 | Chorus |
| 49 | Pre-Chorus | 142 | Outro |
| 67 | Chorus | | |
| 83 | Theme Riff | | |

`Canon Rock 1` has none, so its form has to be derived. Doing so from tempo automations, material
repeats and the harmony loop gives: **[M]** for the boundaries, **[I]** for the section names.

| Bars | Tempo | Section | Loop passes |
|---|---|---|---|
| 1–5 | 90 | Free-time lead intro | — |
| 6–21 | **200** | Theme riff, palm-muted power chords | 2 |
| 22–37 | 200 | Lead theme (the descant) | 2 |
| 38–55 | 200 | Pre-chorus + ascending arpeggio runs | ~2 |
| 56–71 | 200 | Chorus (continuous 8ths) | 2 |
| 72–79 | 200 | Theme riff return | 1 |
| 80–95 | 200 | Lead theme 2, pinch harmonics | 2 |
| 96–110 | 200 | Pedal-point section | ~2 |
| 111–127 | 200 | Chorus | 2 |
| 128–136 | **100** | Breakdown (bar 128 is **6/4**) | 1 |
| 137–152 | **200** | D-pedal → triplet runs → 16th arpeggio sequence | 2 |
| 153–168 | 200 | **Chorus in D harmonic minor** | 2 |
| 169 | 200 | Empty **6/4** bar | — |
| 170–200 | 200 | Shred: legato runs, quintuplets, outro lead | ~4 |
| 201–210 | **90** | Ritardando ending on a held D5 | 1 |

`Canon Rock 1`'s two 6/4 bars are bar 128 (a single vibratoed D5 held over the tempo drop) and
bar 169 (**completely empty** — a 6/4 bar of silence). **[M]** Both are meter changes mid-tune in
a single-staff file; a bar-locked comparison would derail on them.

---

## 4. What survives

### 4.1 The melodic skeleton survives, exactly, in its original octave

This is the strongest measured result in the study. Taking each cover bar's **downbeat top note**
and comparing it against the source's descant at the corresponding loop position: **[M]**

**`Canon Rock 2`, bars 1–8 (Intro)** — one whole note per bar, one string (the B string), volume
swells (`fade`), nothing else:

| bar | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| cover | F♯5 | E5 | D5 | C♯5 | B4 | A4 | B4 | C♯5 |
| source descant | F♯5 | E5 | D5 | C♯5 | B4 | A4 | B4 | C♯5 |

**8 of 8 exact, same octave.**

**`Canon Rock 1`, bars 22–37 (Lead Theme)** — two consecutive passes:

| bars 22–29 | F♯5 | E5 | D5 | C♯5 | B4 | A4 | B4 | C♯5 | → 8/8 exact |
|---|---|---|---|---|---|---|---|---|---|
| **bars 30–37** | F♯5 | E5 | D5 | C♯5 | **B5** | **A5** | **B5** | B5 | → 4/8 exact, 7/8 same pitch class |

The second pass displaces the back half up an octave — the single most common alteration in the
corpus, and the one thing the melody is allowed to do. **[I]**

**`Canon Rock 2`, bars 33–48** repeats the same two-pass shape: bars 34–40 are 7/7 exact, bars
41–47 are 4/7 exact + 3 octave-displaced.

**`Canon Rock 1`, bars 145–152** is the pay-off. This is the famous 16th-note arpeggio sequence —
16 notes per bar, nothing that looks like a melody. Its **downbeats** are:

| bar | 145 | 146 | 147 | 148 | 149 | 150 | 151 | 152 |
|---|---|---|---|---|---|---|---|---|
| downbeat | F♯5 | E5 | D5 | C♯5 | B4 | F♯5 | B5 | A5 |
| descant | F♯5 | E5 | D5 | C♯5 | B4 | A4 | B4 | C♯5 |

**5 exact, 1 octave-displaced, 2 substituted.** The shred passage is *built on the skeleton*; the
16ths are chord-tone filler between skeleton notes. This is `quote` at the skeleton level and
`recompose` at the surface — the doctrine in a single span. **[I]**

**[M]** The mapping ratio is consistent everywhere the melody appears: **one source half-bar
becomes one cover bar** (source: 8 skeleton notes in 4 bars; cover: 8 skeleton notes in 8 bars).
That is a 2:1 bar expansion of the melody, matched by the 2:1 expansion of the harmonic loop
(4-bar source loop → 8-bar cover loop, one chord per bar instead of two).

### 4.2 The root motion survives — but only where the texture is chordal

**[M]** In the riff sections the ground bass is unmistakable. `Canon Rock 1` bars 6–13 and 14–21,
and `Canon Rock 2` bars 17–24, 25–32 and 84–89, all give roots `D A B F♯ G D G A` — the source's
ground bass, one chord per bar, voiced as three-note power chords.

**[M]** In the *lead* sections a root detector fed the guitar line returns noise
(`Bm Em D Em G D A Bm` for `Canon Rock 1` bars 1–8, which is a solo melodic lick with no harmony
at all). A single melodic line simply does not determine the harmony.

**[M]** The shipped analyser says the same thing from the other direction.
`tools/piano-extract.mjs` detects the source's harmonic loop (`L4 @ bar 25, 82 % coverage,
8 passes`) but returns **`harmonicLoop: null` for both `cannon-rock-Piano` and `Canon Rock 1`**.
The loop is genuinely there in both — §3 traces it pass by pass — but it is spread over 8 bars of
mostly-monophonic lead instead of 4 bars of full texture, and no detector reading the cover alone
recovers it.

**[M]** One measured regularity does hold across every file, and it is what makes the §2.1 bass
rows trustworthy: in `canon-in-d-hard` (57 bars), `cannon-rock-Piano` (216 sounding bars) and
`Canon Rock 1` (209 sounding bars), the extractor's `harmony.root` equals the bar's **lowest
sounding pitch class** in **482 of 482 bars — zero violations**. The detector is bass-anchored, so
"lowest note per bar" and "detected root" are the same statistic wearing two hats. That is useful,
and it is also the trap: in the source it reports the *second* of the bar's two chords (§2.1), and
in a solo lead line it reports whichever melody note happened to be lowest.

**[I]** Therefore: the ground survives *as a compositional commitment*, not as something you can
re-derive from the cover. This is precisely why the span sidecar exists — the mapping from tab
span to source span is **declared by the arranger**, and no amount of analysis of the tab alone
will recover it.

### 4.3 What does not survive

**[M]**

- **The inner voices.** The source's `s0v1`/`s0v2`/`s0v3`/`s1v4`/`s1v6`/`s1v7` figuration has no
  counterpart anywhere in either cover.
- **The polyphony.** 62 % polyphonic onsets (max 14 notes) → 34 multi-note attacks in the whole
  of `Canon Rock 1` (max 3 notes) and 40 in `Canon Rock 2` (max 4).
- **The density ramp.** The source ramps 2 → 150 notes/bar monotonically. Neither cover does; both
  cycle between riff (7–8 notes/bar) and lead (1–16 notes/bar) textures.
- **The rate.** 26.5 notes/s → 5.10 (`Canon Rock 1`) and 5.29 (`Canon Rock 2`). **A ~5:1
  reduction in notes per second** — while the piece gets 2.5× *longer*.
- **The register floor.** Nothing below E2 survives, in any cover, ever.

---

## 5. Where it quotes, where it recomposes, where it is free

Mapped onto the sidecar vocabulary that `tools/compare.mjs` consumes. Modes are assigned by the
measured downbeat/root evidence in §4; the assignment itself is **[I]**, the evidence is **[M]**.

### `Canon Rock 1` (210 bars)

| Tab bars | Mode | Source bars | Evidence |
|---|---|---|---|
| 1–5 | **free** | — | Solo lead lick, free tempo 90. No source counterpart; bar 5 is 16 × 32nd notes, the only 32nds in the file. |
| 6–13 | **recompose** | 1–4 | Roots `D A B F♯ G D G A` measured; texture (power chords + melodic tail) entirely new. |
| 14–21 | **recompose** | 5–8 | Same riff repeated; bar 21 ends on a pinch harmonic C♯6. |
| 22–29 | **quote** | 5–8 | Descant 8/8 exact (§4.1). |
| 30–37 | **quote** | 5–8 | Descant 4/8 exact + 3 octave-displaced. |
| 38–45 | **recompose** | 9–12 | New lick (D C♯ D F♯ …); chord tones throughout. |
| 46–55 | **recompose** | 13–16 | Same lick + ascending 6-string arpeggio runs (bars 54–55). |
| 56–71 | **recompose** | 17–24 | Continuous 8th-note chorus line; downbeats are chord tones, not descant notes. |
| 72–79 | **recompose** | 25–28 | Riff return. |
| 80–95 | **quote** | 29–36 | Descant variant with pinch harmonics (bars 81, 82, 84). |
| 96–110 | **free** | — | Pedal-point section on the open D and open B strings — no source counterpart. |
| 111–127 | **recompose** | 37–44 | Chorus. |
| 128–136 | **free** | — | Breakdown at ♩=100, incl. the 6/4 bar 128. |
| 137–144 | **free** | — | D-pedal 8ths + triplet runs. |
| 145–152 | **quote** | 45–48 | 16th-note arpeggio sequence whose downbeats are the descant (§4.1). |
| 153–168 | **recompose** | 49–52 | Chorus **in D harmonic minor** — F♮, A♯, C♮ (§9.7). |
| 169 | **free** | — | Empty 6/4 bar. |
| 170–200 | **free** | — | Shred: legato chains, quintuplets, outro lead. |
| 201–210 | **recompose** | 53–57 | Ritardando to ♩=90, ends on D5 held two bars. |

### `Canon Rock 2` (162 bars)

| Tab bars | Mode | Source bars | Evidence |
|---|---|---|---|
| 1–8 | **quote** | 5–8 | Descant 8/8 exact, whole notes, one string, volume swells. |
| 9–16 | **recompose** | 9–12 | Lead-in, still ♩=170. Bars 10–12 carry the descant's tail (`E5 D5 C♯5`) on the downbeats before the line departs; bars 13–16 are chord tones only. |
| 17–24 | **recompose** | 1–4 | Theme riff, power chords, roots measured `D A B F♯ G D G A`. |
| 25–32 | **recompose** | 5–8 | Identical riff ("Band In"). |
| 33–40 | **quote** | 9–12 | Descant 7/8 exact (only the first note substituted). |
| 41–48 | **quote** | 13–16 | Descant with octave displacement in the back half. |
| 49–58 | **recompose** | 17–20 | Pre-chorus (≡ `Canon Rock 1` bars 38–48). |
| 59–66 | **free** | — | Ascending sweep-shaped arpeggios; bar 66 is the first tapped bar. |
| 67–82 | **recompose** | 21–28 | Chorus, continuous 8ths. |
| 83–90 | **recompose** | 29–32 | Theme riff with a tapped fill (83) and natural harmonics (87). |
| 91–98 | **quote** | 33–36 | Lead theme restated; bar 97 is tremolo-picked. |
| 99–106 | **free** | — | "Tapping A": single-string tapped arpeggios. |
| 107–125 | **free** | — | Solo, incl. double-tapped trills and a D-pedal figure. |
| 126–141 | **recompose** | 37–44 | Chorus reprise. |
| 142–158 | **free** | — | Outro: a 3+3+2 eighth-note pedal figure, stated low then an octave up. |
| 159–162 | **recompose** | 53–57 | Held D5, final D/F♯ chord. |

### The proportions

Summing the two tables above — an expectation to calibrate against, never a target to hit: **[M]**
for the bar counts, **[I]** for the mode assignment that produced them.

| | `quote` | `recompose` | `free` |
|---|---|---|---|
| `Canon Rock 1` (210 bars) | 40 (19 %) | 101 (48 %) | 69 (33 %) |
| `Canon Rock 2` (162 bars) | 32 (20 %) | 70 (43 %) | 60 (37 %) |

**[I]** Two realizations of the same arrangement land within a few points of each other: about a
fifth quotes, a little under half recomposes, and a third is free. And the free material is not
filler — it is the intro, the outro, the tapping feature and the breakdown, i.e. exactly the parts
a listener would name if asked what makes it a rock cover rather than a Canon.

**Caution on `quote` spans.** `compare.mjs`'s `quote` gate is an *in-order pitch-class
subsequence* test of the source skeleton against the tab span's per-beat top-note sequence, plus
the root gate. A span like `Canon Rock 1` 145–152 passes because the descant pitch classes
genuinely appear in order among the 16ths — but they appear surrounded by 120 other notes. The
gate proves the skeleton is *present*, not that it is *audible*. That is what the human audition
at Gate B is for. **[I]**

---

## 6. How 57 bars become 210

Three separate multipliers, and only one of them is "more music". **[M]**

| Factor | Source | `Canon Rock 1` | Effect on bar count |
|---|---|---|---|
| Loop length | 4 bars (2 chords/bar) | 8 bars (1 chord/bar) | **×2** |
| Loop passes | 14 | ~19 over the loop | **×1.36** |
| Non-loop material | 1 bar (the final chord) | ~57 bars (intro, breakdown, tapping, shred, outro) | **+27 %** |
| **Bars** | **57** | **210** | **×3.7** |
| Tempo | 120 throughout | 90 / **200** / 100 / 200 / 90 | — |
| **Playing time** | **1:54** | **4:47** | **×2.5** |

The honest statement is **not** "the cover is 3.7× longer". It is: **[I]**

- **Half of the bar-count growth is a notation choice**, not new music — halving the harmonic
  rhythm doubles the bar count while the loop takes the *same* number of beats to go round.
- **The tempo nearly cancels it back out.** At ♩=200 the cover's 8-bar loop lasts 9.6 s; the
  source's 4-bar loop at ♩=120 lasts 8.0 s. One pass is 20 % longer, not 100 %.
- **The real expansion is passes plus insertions**: ~19 passes instead of 14, plus ~57 bars of
  material with no source counterpart at all.

`Canon Rock 2` reaches 162 bars / 3:18 by the same mechanism with fewer passes and a bigger free
section (its "Tapping A" + "Solo" is 27 bars). **[M]**

**[I]** The design consequence for this project: a bar-locked comparison is not merely
inconvenient here, it is measuring a quantity that has no musical meaning. The sidecar's
proportional slicing is the only thing that makes the 4-bar → 8-bar re-metering legible to a gate.

---

## 7. What the D-major fretboard affords this piece

The key is constant across the whole corpus (§1.2), so there is no transposition to analyse here.
What there *is* to analyse is why D major already suits this progression on a standard-tuned
guitar so well — because that is what the measured fret data shows the two covers exploiting.

**Measured. [M]** Both guitar files are standard tuning, capo 0:

- **The riff lives at the nut.** `Canon Rock 1` bars 6–21 and `Canon Rock 2` bars 17–32 use
  frets **0–9** only. The roots fall on A-string fret 5 (D), low-E fret 5 (A), A-string fret 2 (B),
  low-E fret 2 (F♯), low-E fret 3 (G) — one hand position for the entire loop, using the standard
  movable three-note power-chord shape.
- **The lead lives in one box.** Bars 22–37 (CR1) and 33–48 (CR2) use frets **11–19** only. The
  three most-used frets in both files are **14, 15 and 17** (CR1: 261/211/157 notes; CR2:
  153/153/144). On the B and high-E strings those three frets give exactly
  `C♯5 D5 E5` and `F♯5 G5 A5` — **the descant's own pitches**. The melody survives in the source's
  own octave (§4.1) partly because that octave lands squarely in this box.

- **The riff lives at the nut.** `Canon Rock 1` bars 6–21 and `Canon Rock 2` bars 17–32 use
  frets **0–9** only. The roots fall on A-string fret 5 (D), low-E fret 5 (A), A-string fret 2 (B),
  low-E fret 2 (F♯), low-E fret 3 (G) — one hand position for the entire loop, using the standard
  movable three-note power-chord shape.
- **The lead lives in one box.** Bars 22–37 (CR1) and 33–48 (CR2) use frets **11–19** only. The
  three most-used frets in both files are **14, 15 and 17** (CR1: 261/211/157 notes; CR2:
  153/153/144). On the B and high-E strings those three frets give exactly
  `C♯5 D5 E5` and `F♯5 G5 A5` — **the descant's own pitches**.
- **Open strings are used as pedals, not as chord filler.** `Canon Rock 1` plays only 51 open
  notes in 1461 (3.5 %), and they are not spread around: **21 are the open B** (bars 98, 100, 106,
  108, 189, 191) and **18 the open D** (bars 96, 104, 137–140) — every one of them a pedal point.
  The remaining 12 are the open A (bars 7, 15, 73) and open low E (bars 9, 17, 75) roots of the
  riff's A and F♯ chords. `Canon Rock 2` plays 8 (0.8 %): the open low E in bars 20, 28, 86, and
  the open D in the final chord, bars 161–162.

### The counterfactual — why *didn't* anyone transpose? **[I]**

Marked inferred throughout: no cover in this corpus transposed, so nothing below is measured
behaviour. It is the argument the fretboard makes, offered as a *worked shape* for a Gate A
transposition proposal rather than as a finding.

Standard tuning's open strings are **E2 A2 D3 G3 B3 E4** → pitch classes {E, A, D, G, B}. The
Canon's five distinct roots are {D, A, B, F♯, G}.

| Candidate key | Roots would be | Roots with an open string | Melody box would sit at |
|---|---|---|---|
| **D (what all six files use)** | D A B F♯ G | **4 of 5** — D, A, B, G | frets 11–19 |
| E (+2) | E B C♯ G♯ A | 3 of 5 — E, B, A | frets 13–21 |
| A (−5) | A E F♯ C♯ D | 4 of 5 — A, E, D | frets 4–12 |

In D, four of the five roots already have an open string underneath them and the whole riff fits
between the nut and fret 9. Transposing up 2 would have *cost* an open string and pushed the lead
box two frets further up a shrinking neck. That is a sufficient reason to leave it alone, and it
is consistent with what every file in the corpus does.

The generalisable point is the *form* of the argument, not the answer: a Gate A proposal should
not say "+N semitones", it should say "here are the roots, here is where each candidate key puts
them relative to the open strings, and here is the fret zone the melody would then occupy". In
this piece that reasoning lands on "stay put". In another piece it will not.

---

## 8. Tempo is re-decided too — and the header lies

The header tempo of every cover in this corpus is **not the tempo of the cover**. **[M]**

| File | Header | Tempo automations (bar : bpm) | Time at each |
|---|---|---|---|
| `canon-in-d-hard` | 120 | b1:120 | 120 bpm for 114 s |
| `cannon-rock-Piano` | 120 | b1:120, b2:**89**, b10:**200**, b132:100, b141:200, b206:89 | 200 bpm for 224 s of 302 s |
| `Canon Rock 1` | 90 | b1:**90**, b6:**200**, b128:100, b137:200, b201:90 | 200 bpm for 224 s of 287 s |
| `Canon Rock 2` | 170 | b1:**170**, b17:**200** | 200 bpm for 175 s of 198 s |

**All three realizations converge on ♩=200 for the body.** The declared 90 and 170 are the intro
tempos only. The 100 bpm bars in `Canon Rock 1` (128–136) and `cannon-rock-Piano` (132–140) are a
deliberate breakdown, and both files return to 200 immediately after.

**[I]** The density budget consequence: at ♩=200, one 16th note lasts 75 ms. `Canon Rock 1` uses
330 16th-note beats and exactly **16 32nd notes — all in bar 5, at ♩=90**, where a 32nd lasts
83 ms. `Canon Rock 2` uses **no 32nds at all**; its fastest figure is a 16th-note sextuplet
(bars 66, 83). Meanwhile the source, at ♩=120, spends 352 beats on 32nd notes (bars 45–52).

> The source out-shreds both covers on paper. The covers are faster *in tempo* and slower *in
> note values*, and the product — notes per second — drops by about 5×. Choosing a fast tempo is
> how you buy back the subdivision headroom you need for the guitar to sound busy while actually
> playing fewer notes. **[I]**

Beat-duration census, in quarter-notes: **[M]**

| | 32nd | 16th | 8th | quarter | half+ |
|---|---|---|---|---|---|
| `canon-in-d-hard` | **352** | 772 | 641 | 84 | 226 |
| `Canon Rock 1` | 16 | 330 | 638 | 200 | 70 |
| `Canon Rock 2` | **0** | 190 | 547 | 150 | 52 |

---

## 9. The addition half — devices with no piano origin whatsoever

This is the least-documented half of the doctrine, so it is enumerated exhaustively, with bars.

**The baseline.** The piano sources carry essentially **no** performance markings: **[M]**

| Source | Total performance markings | What they are |
|---|---|---|
| `canon-in-d-hard` | **1** | one trill, bar 20 |
| `canon-in-d-intermediate` | **4** | 2 crescendos (bar 12), 1 brush (bar 101), 1 ghost note (bar 61) |

**The covers.** **[M]** (bar numbers are exact; counts are beats carrying the marking)

### 9.1 Palm muting — `Canon Rock 1` only, 115 beats
Bars **6–21, 45, 72–78, 83, 96, 98–99, 104, 106, 137–140, 189, 191**. Concentrated in the riff
(bars 6–21) where every off-beat repetition of the root is muted while the downbeat chord rings.
`Canon Rock 2` uses **none** — it gets the same articulation from slides instead.

### 9.2 Hammer-on / pull-off legato — 118 (CR1) and 99 (CR2) beats
CR1: bars **2–3, 5, 12–13, 20, 78, 96–97, 104–105, 130, 132, 174–176, 180, 182–184, 190, 194,
201–208**. The bars 174–184 block is a continuous descending legato run: 16ths and quintuplets in
which almost every note after the first on each string is hammered or pulled.
CR2: bars **8, 10, 16, 53, 61, 65–66, 83, 99–104, 115–117**.

### 9.3 Tapping — `Canon Rock 2` only, 51 tapped beats
Bars **66, 83, 99–104, 115–117**, plus two beats explicitly labelled **"Double Tapping"** at bars
**105** and **118**. The "Tapping A" section (99–104) is a single-string tapped arpeggio:
tap fret 22, pull to 15, pull to 10, hammer back — **all 96 notes of bars 99–104 are on string 5
(the B string), with zero string changes**. Bars 115–117 do the same over a D pedal.

### 9.4 Tremolo picking — `Canon Rock 2` only, bar **97**
Four quarter notes (`G4 B4 C♯5 D5`), each written `{tp 2}`. A device the piano cannot express at
all.

### 9.5 Harmonics — 9 (CR1) and 5 (CR2) notes
CR1 uses **artificial/pinch harmonics** at bars **21, 45, 81, 82, 84, 99, 107, 191** — always on
a long held lead note, as an accent. CR2 uses **natural harmonics** at bar **87**, five of them
(frets 5 on the D and G strings) as a bright fill inside the riff.

### 9.6 Bends, vibrato, slides, trills
- **Bends** — CR1 31 (quarter-tone through full: bars 24, 29–30, 32, 34, 37, 41, 45, 49, 65,
  80–82, 88–90, 93, 107, 111, 121, 162, 173, 179–181, 186, 194, 196, 198, 205); CR2 15
  (bars 9, 12, 15, 33, 35, 40–41, 43, 48, 52, 56, 76, 91, 93, 135).
- **Vibrato** — CR1 **116 notes**; CR2 **0**. A pure notation-house difference, most likely.
- **Slides** — CR1 42 (`slideOut` at bars 10, 12–13, 18, 20, 29, 48–49, 51, 53–54, 76, 78, 95,
  97, 105, 138, 140, 142, 182–183, 199–201, 204, 208); CR2 36, and CR2 uses them *structurally* —
  every riff bar 17–32 ends with a slide into the melodic tail.
- **Trills** — CR2 bars **105–106, 118** (9 notes), all inside the double-tapping passages.

### 9.7 Pedal points — both covers, extensively
Detected as a bar in which one pitch occupies ≥40 % of the attacks: **[M]**

- `Canon Rock 1`: the **open D string (D3)** at bars **96, 104, 137, 139**; the **open B string
  (B3)** at bars **98, 100, 105, 106, 108**; A♯5 at bar 178; C♯4 at 184; D5 at 190.
- `Canon Rock 2`: the riff's own root at bars 17–32 and 84–89; A4/A5 at bars 12, 14, 99–104,
  115–117; and the **entire outro**, bars **142–158**.

The `Canon Rock 2` outro is the clearest case. Bar 142 is eight eighth notes grouped
`D4 D4 D4 | A4 A4 A4 | D4 D4` — a **3+3+2** rhythmic displacement over a static D. Bars 142–150
state it in the lower octave, bars 151–158 state it an octave up, and bars 159–162 resolve to a
held D5 and a D/F♯ chord. **[I]** This is 17 bars, 10 % of the whole cover, built from *two
pitches and a rhythm* — with no piano origin of any kind.

### 9.8 Modal recolouring — `Canon Rock 1` bars 153–168
Bars 153–168 restate the chorus of bars 56–71 note-for-note in shape, with **F♯ → F♮, B → A♯,
C♯ → C♮**: `A5 F5 G5 A5 F5 G5` where bar 56 had `A5 F♯5 G5 A5 F♯5 G5`. Pitch content across the
span is {D E F G A A♯ C♯} = **D harmonic minor**. **[M]** This is the entire source of the corpus's
A♯ (20), F♮ (14) and C♮ (7) counts.

**[M]** `cannon-rock-Piano` has the same passage at bars **157–172** — F♮ ×54 across bars 157–171,
A♯ ×49 across 158–172. That is `Canon Rock 1`'s 153–168 shifted by exactly **+4**, independently
reconfirming the alignment established in §1.2.

**[I]** A parallel-minor pass over an unchanged root motion is a recomposition device with no
counterpart in the source at all — the source never leaves D major for a single beat. It is also
the one place in the corpus where a *harmonic* colour is added rather than just a texture, and it
is worth noting that even here the **root motion is untouched**: only the quality of the chords
built on those roots changes.

### 9.9 Fast figures: what they actually are
Both covers' fast passages are dominated by **rolling arpeggios across adjacent strings**, not by
string skipping. **[M]**

| Span | same string | adjacent | skip ≥2 | max jump |
|---|---|---|---|---|
| `Canon Rock 1` whole file | 894 (64 %) | 389 (28 %) | 115 (8 %) | 4 |
| `Canon Rock 1` 145–152 (the 16th sequence) | 52 (42 %) | 64 (52 %) | 8 (6 %) | 2 |
| `Canon Rock 1` 6–21 (riff) | 45 (42 %) | 10 (9 %) | **52 (49 %)** | 4 |
| `Canon Rock 2` whole file | 719 (72 %) | 216 (22 %) | 66 (7 %) | 4 |
| `Canon Rock 2` 99–104 (tapping) | **95 (100 %)** | 0 | 0 | 0 |

**[I]** The one place skips concentrate is the *riff*, where the hand deliberately leaves the
power chord on strings 1–3 to hit the melodic tail on strings 4–5 — a slow, sequential move at
eighth-note pace, not a fast alternation. The fast passages avoid skips almost entirely. Bar
145's celebrated pattern (`F♯5 D5 A4 F♯4 A4 D5 F♯5 D5`) is a rolling adjacent-string sweep shape.

---

## 10. The playability envelope, measured

Every simultaneous multi-note attack in both covers: **[M]**

| | multi-note attacks | 2 notes | 3 notes | 4 notes | **non-adjacent strings** |
|---|---|---|---|---|---|
| `Canon Rock 1` | 34 (of ~1400 onsets) | 6 | 28 | 0 | **0** |
| `Canon Rock 2` | 40 (of ~1000 onsets) | 38 | 0 | 2 | **0** |

**Zero exceptions in 74 attacks.** The source, by contrast, has 545 polyphonic onsets with up to
14 simultaneous notes.

**[I]** This is the corpus confirming, without being asked, three things the project already
believes:

1. A solo electric guitar rock cover is **a single line most of the time**. Chords are punctuation.
2. When it does stack notes it stacks **two or three, on neighbouring strings**. The
   "never strike non-adjacent strings" constraint is not a conservative simplification — it is
   what the real tabs do, 74 times out of 74.
3. Density is spent on **rhythm and articulation**, not on voices.

---

## 11. A worked span sidecar

`tools/compare.mjs --map <sidecar.json>` reads `{ "entries": [ … ] }`, where every entry is
`{ mode, tabBars: [s,e], sourceBars?: [s,e], note? }`. `free` needs no `sourceBars`; `quote` and
`recompose` require it. Every tab bar in the compared range must be covered by exactly one entry.
The modes gate differently:

| Mode | What is gated |
|---|---|
| `free` | Nothing. It is a declaration, not an exemption you can hide behind — see below. |
| `recompose` | Root motion only: the tab span is cut into N proportional slices (N = source bar count) and each slice's **lowest** pitch class must be the source bar's root or a chord tone. |
| `quote` | The above **plus** the source's `melodySkeleton` pitch classes must appear as an in-order subsequence of the tab span's per-beat top-note pitch classes. |

Here is the first third of `Canon Rock 1` written as a sidecar against a
`canon-in-d-hard.alphatab` digest, at `transpose 0`:

```json
{
  "song": "Canon Rock (after canon-in-d-hard)",
  "entries": [
    { "mode": "free",      "tabBars": [1, 5],
      "note": "Free-time lead intro at 90bpm. No source counterpart. 32nds in bar 5." },
    { "mode": "recompose", "tabBars": [6, 13],   "sourceBars": [1, 4],
      "note": "Theme riff. Ground D A Bm F#m G D G A kept; 4-bar source loop re-metered to 8 cover bars, one chord per bar. Palm-muted power chords + melodic tail: entirely new texture." },
    { "mode": "recompose", "tabBars": [14, 21],  "sourceBars": [5, 8],
      "note": "Riff repeated. Pinch harmonic added on the last beat of bar 21." },
    { "mode": "quote",     "tabBars": [22, 29],  "sourceBars": [5, 8],
      "note": "Descant quoted 8/8 exact at original pitch, one source half-bar per cover bar." },
    { "mode": "quote",     "tabBars": [30, 37],  "sourceBars": [5, 8],
      "note": "Descant again; bars 34-37 displaced up one octave." },
    { "mode": "recompose", "tabBars": [38, 45],  "sourceBars": [9, 12],
      "note": "Pre-chorus lick. New melody over the same roots." },
    { "mode": "recompose", "tabBars": [46, 55],  "sourceBars": [13, 16],
      "note": "Lick repeated + ascending 6-string arpeggio runs (54-55)." },
    { "mode": "recompose", "tabBars": [56, 71],  "sourceBars": [17, 24],
      "note": "Chorus. Continuous 8ths; downbeats are chord tones, not descant notes." }
  ]
}
```

**Three things this example is meant to teach.** **[I]**

1. **The expansion ratio is per entry, not global.** Entry 2 maps 4 source bars to 8 tab bars;
   entry 8 maps 8 to 16. `proportionalSlice` handles both without the sidecar declaring a ratio.
2. **The same source bars are legitimately claimed twice.** Bars 5–8 back four different tab
   spans (14–21, 22–29, 30–37 …). A chaconne is *supposed* to be re-covered. `compare.mjs` checks
   overlap on **tab** bars, not source bars, and this is why.
3. **`free` is a confession, not a loophole.** Writing `free` over `Canon Rock 1` bars 96–110
   says out loud: *these fifteen bars are mine, there is no Pachelbel in them.* That is the whole
   point of the gate. A sidecar that is mostly `free` is not a passing sidecar — it is an
   arrangement that should be re-argued at Gate A. In this corpus about a third of the bars are
   `free`, and every one of them is a *named section* (intro, breakdown, tapping feature, outro),
   never a bar the arranger could not be bothered to map.

---

## 12. What the corpus proves the toolchain must handle

Each item is a defect or hazard this study hit for real. **[M]** unless marked.

1. **Harmonic rhythm finer than one bar.** The source changes chord **twice per bar**. Analysed
   per bar, `D` + `A` merge into a single sonority and the detector returns
   `Asus4 / F♯m7 / Dmaj7 / Gmaj7`. Measured against `tools/piano-extract.mjs` as it stands:
   **32 of 57 bars come back with a 7-pitch-class `harmony.pcset`** (the whole D major scale) and
   15 more with 6. Since `compare.mjs`'s root gate accepts *root or any pcset member*, a 7-note
   pcset degrades that gate to "is this note in the key?". Analysed at half-bar resolution the same
   57 bars resolve cleanly to `D|A Bm|F#m G|D G|A`, 14 identical passes, zero ambiguity. This is
   the "maj7 mush" the build plan's anti-acceptance clause names, and the fix is a **finer
   analysis window**, not a better chord table. **[I]**
2. **Duplicate detection that finds nothing in a chaconne.** `piano-extract.mjs` currently reports
   `duplicateRanges: []` and a single section spanning bars 1–57, for a file whose melody voice
   repeats a byte-identical 4-bar cell **nine times** (bars 17–52) and whose ground bass is
   identical in all 14 passes. Its `harmonicLoop` reports length 4 starting at bar **25** with 82 %
   coverage; the true answer is length 4 starting at bar **1** with 100 % coverage.
3. **A melodic line does not determine harmony, and the loop detector knows it.**
   `piano-extract.mjs` returns **`harmonicLoop: null`** for `cannon-rock-Piano` and
   `Canon Rock 1` — both of which demonstrably run the Canon loop ~19 times (§3, §6). Root
   detection over a solo guitar tab returns noise (`Canon Rock 1` bars 1–8 → `Bm Em D Em G D A Bm`
   — an unaccompanied lick with no harmony in it at all). Do not attempt to re-derive the
   correspondence from the tab; the sidecar is the ground truth. **[I]** A null loop on the *tab*
   side is expected and is not a defect; a null loop on the *source* side would be.
   **Corollary [M]:** the extractor's `harmony.root` equals the bar's lowest sounding pitch class
   in 482 of 482 bars across `canon-in-d-hard`, `cannon-rock-Piano` and `Canon Rock 1`. The
   detector is bass-anchored — which is why it is reliable on chordal textures and meaningless on
   a lead line, and why it reports the *second* of the source's two per-bar chords (item 1).
4. **`note.realValue` is not `tuning + fret` for harmonics.** `Canon Rock 1` bar 21 writes fret 6
   on the G string (C♯4) with an artificial harmonic and alphaTab reports **C♯6**. Nine such notes
   inflate the file's apparent top from C♯6 to B6. Any range or playability check must either
   exclude harmonics or reason about them explicitly.
5. **String numbering is inverted between the AlphaTex text and the parse tree.** The text
   `12.2` means fret 12 on string 2 counting **from the high E**; `note.string === 2` in the model
   is the **A string**, because `tuning[tuning.length - note.string]`. Getting this backwards
   silently mirrors every fretboard statistic.
6. **Meter changes mid-tune, and bars with no notes at all.** `Canon Rock 1` has 6/4 at bars
   **128** and **169**, and bar 169 is **completely empty**. A bar-length or bar-alignment
   assumption breaks on both. The empty bar also shows up downstream: running
   `piano-extract.mjs` over `Canon Rock 1` yields `melodySkeleton: 209/210` and
   `harmony.root: 209/210`, and **bar 169 is the single missing bar in both**. Over
   `cannon-rock-Piano` it is 214/217 and 216/217 (bars 1, 178, 197). The extractor's own warning
   line names them, which is exactly what a fail-open guard should do — a bar that carries neither
   field is a bar the fidelity gate does not protect, and it must be visible rather than silently
   counted as covered.
7. **The header tempo is not the tempo.** All three realizations declare one tempo and spend
   ≥75 % of their playing time at another (§8). Read `masterBar.tempoAutomations`, not
   `score.tempo`.
8. **The declared key signature is not the key.** `Canon Rock 1` declares `\ks c` and sounds in
   D major. Infer from pitch content; report the disagreement.
9. **Non-ASCII track names, and instrument headers that lie.** `cannon-rock-Piano` names its
   tracks `일렉 기타` (program 27) and `일렉트릭 베이스` (program 33) — it is not a piano at all,
   and its second track's *written* range is D3–A5, an octave above sounding, per the bass
   convention. Never key logic off a track name or a MIDI program.
10. **`\ottava` is declared but not applied to `realValue`.** `cannon-rock-Piano` declares
    `\ottava 8vb` twice. alphaTab's `realValue` is the written pitch either way. **[I]** Treat
    `\ottava` as engraving, and verify register by comparing against a known reference — which is
    how the +4-bar alignment to `Canon Rock 1` at transpose 0 was established (§1.2).
11. **A pickup/empty first bar shifts the whole loop.** `easy` and `intermediate` begin the loop
    at bar 2; `hard` begins it at bar 1. Same music, off-by-one span map.
12. **Sub-piano pitches in a piano source.** `canon-in-d-hard` bars 45–48 write `D0`, `G♭0`, `G0`
    — below A0, the lowest key on a piano. Do not assume the source is playable on its own
    instrument, and do not let a range check crash or silently clamp.

---

## 13. Reproducing these numbers

Everything above came from `@coderline/alphatab` 1.5.x directly, plus one run of
`tools/piano-extract.mjs`. The recipes:

```bash
# The digest, as WP2 produces it (57 bars, key D, range D0..F#7, deficit 136/418)
node tools/piano-extract.mjs "CanonRock/Canon in D/canon-in-d-hard.alphatab"

# The AT218 rewrite count (11) and the \ks-vs-sounding-key disagreement
node tools/piano-validate.mjs "CanonRock/Canon in D/canon-in-d-easy.alphatab"
node tools/piano-validate.mjs "CanonRock/Canon Rock/Canon Rock 1.alphatab"
```

For the measurements this study made that no shipped tool produces yet — half-bar harmony, the
loop-aligned descant comparison, the string-transition profile, the multi-note-attack adjacency
check, the cross-file alignment search — the essential moves are:

- Parse with `alphaTab.importer.AlphaTexImporter`; walk
  `score.tracks[t].staves[s].bars[b].voices[v].beats[i].notes[n]`.
- **Pitch** is `note.realValue` (works for pitched *and* fretted staves; see hazard 4 for
  harmonics). **Never** call `fromAlphaTabNote` on a pitched note — it returns
  `{string: 8, fret: -1}` rather than throwing.
- **Duration** is `beat.playbackDuration / 960` in quarter-note beats; **onset** within the bar is
  `beat.playbackStart` minus the bar's minimum.
- **Half-bar harmony**: bucket each bar's notes into two 2-beat windows by onset, weight pitch
  classes by duration, score against the 24 major/minor triads with a bonus for the window's
  lowest pitch class as root. On `canon-in-d-hard` this returns `D|A Bm|F#m G|D G|A` for all
  14 passes with no tuning of the weights.
- **Loop-aligned melody comparison**: take each cover bar's top note within the first half-beat,
  compute `pos = (bar − anchor) mod 8`, and compare against
  `[F♯5, E5, D5, C♯5, B4, A4, B4, C♯5][pos]`. Exact / octave / chord-tone / neither gives the
  quote / recompose / free classification in §5 directly.
- **Cross-file alignment**: build `Map<onset16th, topMidi>` per bar for each file, then sweep
  bar-offset × transposition maximising exact agreement. The true alignment stands out at roughly
  3.5× the next-best candidate.

---

## See also

- `piano-to-guitar-arranging.md` — the reduction ladder and the density budget this study
  supplies evidence for.
- `guitar-playability.md` — the adjacent-strings and fret-span constraints §10 confirms.
- `rock-riff-construction.md` / `electric-guitar-voice.md` — the device palette §9 enumerates.
- `alphatex-piano-reading.md` — the source-side hazards §12 lists.

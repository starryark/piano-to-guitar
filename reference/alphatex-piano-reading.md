# Reading a piano source written in AlphaTex

> **Canon-in-D is the running example throughout.** Every rule below is general;
> parenthesized measurements (11 rewrites, voices 4-7, …) are specific to it.
> Substitute your own piano source.

How to read a piano `.alphatab` source (illustrated on Canon-in-D). **This project consumes AlphaTex and
never writes a piano score** — nothing here is about authoring a piano score, only about
decoding what an exporter (MuseScore's AlphaTex writer) actually put in the file. The
companion reference for the AlphaTex language itself is
[alphatex-language.md](alphatex-language.md); the guitar-tab side you *do* write is
[electric-guitar-voice.md](electric-guitar-voice.md).

A piano source is **pitched** staves: `\staff { score }` blocks carrying note *names*
(`C#4`, `Gb5`), not fret/string numbers. That is the whole difference from a guitar tab,
and almost every trap below exists because exporters are sloppy about the boundary.

## 0. The one rule that prevents every other bug

> **Read the extractor's bar map (`analysis/<stem>-map.md`), NOT the raw
> `.alphatab` file.**

The raw file on disk is **not what the parser sees.** It carries exporter artifacts the
normalizer fixes **in memory** before parsing — and once parsed, the analysis pass
collapses the messy multi-voice, multi-staff, exporter-decorated text into one clean
row per bar. The map is the truth; the raw text is evidence, not a score table.

Concretely, the raw file has:

- **AT218 tokens** — `-1.<string>.<duration>{beam …}` beats inside a pitched staff that
  are rests written as fretted notes. A pitched source can carry any number of them
  (`canon-in-d-easy` carries 11); the file fails to parse outright (every one raises
  `AT218: Wrong note kind 'Fretted' for staff with note kind 'Pitched'`) until the
  normalizer rewrites each to `r.<duration>`. The map shows the rewritten rests; the raw
  file shows the broken tokens. See §2.
- **`{beam Up}` / `{beam Down}` decorations** on nearly every beat — engraver beam
  hints with no musical content. They survive into the parsed tree as beat properties
  but are not music.
- **`{lf N}` / `{rf N}` fingering** annotations on individual notes. Useful context,
  but they are not pitches and do not belong in the harmonic analysis.
- **A `\ks` that lies** — exporters sometimes declare the wrong key signature
  (`Canon Rock 1` declares `\ks c` while sounding in D major). The map reports `key`
  (inferred from pitch content) and `keyDeclared` side by side.
- **A `\tempo` that lies** — a source can carry multiple `\tempo` directives and
  alphaTab keeps the last (`canon-in-d-easy` declares `\tempo 100` then `\tempo 25` on
  the next line, so the file nominally plays for 7:50). The map's per-bar `tempo`
  column shows the value actually in force.

The map is produced by `node tools/piano-extract.mjs <file.alphatab>`, which writes a
pair to `analysis/`: `<stem>.json` (the digest `compare.mjs` consumes) and
`<stem>-map.md` (the human-readable bar table you read). If `analysis/<stem>-map.md`
does not exist, **run the extractor** — do not fall back to reading the raw file.

## 1. Pitched vs fretted: the staff-kind decision

The extractor decides each staff's note kind **before** it touches a note, from
declarative signals first and note evidence only as a fallback. The full priority order
lives in `classifyStaff` in `tools/lib/piano-source.mjs`:

| Priority | Signal | Decides | Reason |
|---|---|---|---|
| 1 | `\tuning piano` / `\tuning none` / `\tuning voice` | **pitched** | alphaTab's explicit "this staff is pitched" spelling |
| 2 | `\tuning (E4 B3 …)` with real string notes | **fretted** | a staff that declares string tunings is a tab staff |
| 3 | `\staff { … tabs … }` | **fretted** | the display mode names a tab staff |
| 4 | note evidence, only when **unanimous** | pitched or fretted | all pitched tokens and no fretted → pitched; vice-versa |
| — | mixed pitched+fretted tokens, no `\tuning`, no `tabs` | **unknown** | left alone and reported; the rewriter never fires inside an unknown staff |

### The `-1` fret exclusion — why a pitched source resolves (illustrated on `canon-in-d-easy`)

Note tokens are classified by their head atom (everything before the first `.` or `{`):

| Token head | With a `.string`? | Classified as |
|---|---|---|
| `C#4`, `Gb5`, `B3` (letter + optional accidental + octave) | n/a | **pitched** |
| `12`, `0`, `5` (non-negative integer) | yes | **fretted** |
| `12`, `0` (non-negative integer) | no | unknown (bare fret, no string) |
| `-1`, `-3` (negative integer) | yes | **negativeFret** — counted SEPARATELY, NOT as fretted evidence |
| `r` / `R` | — | rest |
| `x` / `X` / `-` (with `.string`) | yes | fretted |

The crucial rule: **a `-1.<string>` token is never counted as fretted evidence.** Fret
-1 is not a playable fret; it is an exporter artifact (a rest written as a note — see
§2). So when the classifier counts "fretted tokens" for the unanimity check at priority
4, the `-1.N` artifacts are excluded from that count. `canon-in-d-easy` is hundreds of
pitched tokens plus eleven `-1.1.N` artifacts; with the exclusion it resolves cleanly to
**pitched** (`0 fretted`), and the rewriter then fires on every one of those eleven
tokens. Without the exclusion it would resolve to **unknown** (pitched + fretted, mixed)
and the file would stay broken.

You can read this off a digest directly: each staff record carries
`kind`, `kindReason`, and a `tokens` object with `{ pitched, fretted, negativeFret,
rest, articulation, unknown }` counts. A staff that reports `pitched: N, fretted: 0,
negativeFret: 11` is the textbook pitched-with-artifacts case.

### Combined staves (`score tabs`)

A fretted source can open one track with `\staff { score tabs }` — a standard-
notation staff *and* a tab staff for the same electric guitar (`Canon Rock 1.alphatab`
is an instance). The classifier detects this as **fretted** at priority 3 (the body
contains the word `tabs`), and the rewriter leaves it alone: a fretted staff legitimately
contains `<fret>.<string>` tokens. This is the **output** shape you are aiming for, not a
piano source; see [electric-guitar-voice.md](electric-guitar-voice.md) and
[rock-riff-construction.md](rock-riff-construction.md).

## 2. The AT218 hazard — `-1.N` tokens and the one rewrite

Inside a **pitched** staff, alphaTab locks the staff's note kind to the first pitched
note it sees. Every subsequent fretted token then raises AT218 and the whole file fails
to parse. A pitched source can carry any number of such tokens (measured on
`canon-in-d-easy`: 11 tokens, 11 AT218 errors, 0 bars readable).

Every one of those tokens has the shape `-1.<string>.<duration>` (often followed by a
`{beam …}` tail) and sits exactly where a **rest** belongs. The normalizer's entire job
is the one rewrite

```
-1.<string>.<duration>[{noteProps}].<duration><tail>   ->   r.<duration><tail>
```

performed **only inside a staff confidently classified as pitched**, and only on
top-level beats (never on a `-1` inside a chord — that is reported, not guessed). The
rewritten text is byte-identical to the input everywhere outside the reported spans;
the `{beam …}` tail is preserved verbatim, and any dropped `{noteProps}` (e.g.
`{lf 3}`) is recorded in the rewrite log.

**You do not perform this rewrite yourself.** The extractor does it in memory before
parsing, and prints a rewrite report (before-text, after-text, line, column) on every
run — even when the count is zero, so a no-op source is visibly a no-op rather than
silently passing. Your job is to **read the map**, which already reflects the rewritten
text. If a bar in the map looks wrong, grep the raw file at that line for `-1.` to see
the artifact the normalizer absorbed.

The dedicated fixture for this rule is `tools/fixtures/at218-pitched-rest.alphatab`
(3-rewrite contract) and `CanonRock/Canon in D/canon-in-d-easy.alphatab` (11 rewrites).
See [alphatex-language.md](alphatex-language.md) Gotcha 12 and
[case-canon-rock.md](case-canon-rock.md) §1.1 (the "AT218 fail → 11 rewrites → OK" row).

## 3. Multi-staff RH/LH layout

A piano source is **one `\track`** holding **two `\staff { score }` blocks** — right
hand (RH) on treble, left hand (LH) on bass. The shape of `canon-in-d-hard.alphatab`:

```
\track ("Piano" "Pno.") { instrument acousticgrandpiano }
  \staff { score }                  // RH
    \voice                          // voices 0–3 live here
      \clef g2                      // treble (G clef, line 2)
      \ks d
      …                             // RH music, e.g. r.1{dy f …} | (D5 Gb5).2{beam Down} | …
  \staff { score }                  // LH
    \voice                          // voices 4–7 live here
      \clef f4                      // bass (F clef, line 4)
      \ks d
      …                             // LH music, the ground bass: A2 F#2 | D2 G2 | A2 …
```

Facts you can rely on (all measured on the corpus; see
[case-canon-rock.md](case-canon-rock.md) §1.1):

- The RH/LH **split is by staff, not by voice or by track**. Both staves carry the same
  `\ks` and the same instrument; the only structural difference is the clef and which
  voices live in them.
- **`\clef g2` / `\clef f4` are display hints only.** A treble staff that happens to
  hold low notes still sounds low; the sounding pitch comes from the note name
  (`note.realValue`), never from the clef. Do not transpose for clef.
- A staff may carry **several voices** (`\voice` opens each one). `canon-in-d-hard`'s
  treble staff carries four voices, its bass staff carries four more.
- A **single-staff piano source** is also possible (`canon-in-d-easy` is one track / two
  staves but with sparser voices; the covers `Canon Rock 1/2` are one track / one
  combined `score tabs` staff). Do not assume two staves — **read the staff count from
  the map's `Tracks/parts` and `Staves` lines.**

## 4. Piano voice indices are STAFF-GLOBAL — never key logic off a voice or staff index

This is the trap that costs the most time. Voice indices are staff-global: they keep
counting up across staves within the same track and do not reset to 0 at each staff.
For example, in `canon-in-d-hard` the treble staff (staff 0) uses voices **0, 1, 2, 3**
and the bass staff (staff 1) uses voices **4, 5, 6, 7** — the count does not reset.
(Across tracks there is an additional `trackIndex * 100` offset; for a single-track
piano source this is just `voice.index`.) The extractor's voice id is therefore
`globalVoiceId = trackIndex * 100 + voice.index`, so the RH voices are `s0v0..s0v3` and
the LH voices are `s1v4..s1v7` — exactly the labels in the corpus table in
[case-canon-rock.md](case-canon-rock.md) §1.1.

**Consequence for any logic you write:** melody and bass are chosen by **sounding
register**, never by voice number, staff number, or track name:

- **melodyVoice** = the voice with the highest **mean MIDI** across the bar.
- **bassVoice** = the voice with the lowest mean MIDI.
- Track names are non-ASCII (the corpus carries Korean `일렉<NBSP>기타` with a U+00A0
  no-break space, not U+0020), so a hand-typed equality match on a track name fails;
  never use one. See the Gotchas in [alphatex-language.md](alphatex-language.md) and
  HANDOFF.md §0.2.

The map prints the winning `Melody voice` and `Bass voice` once in its header (chosen by
majority vote across bars, by register), and a per-bar `melodyVoice`/`bassVoice` in the
JSON. They will move bar to bar — that is correct, not a bug.

## 5. What exporters emit that you should ignore

Reading the raw file, you will see a lot of decoration that is **not music**. None of it
reaches the harmonic or melodic analysis; all of it is reported for completeness:

| Token | Meaning | What the extractor does |
|---|---|---|
| `{beam Up}` / `{beam Down}` | engraver beam hint | preserved verbatim through the normalizer; ignored analytically |
| `{lf N}` / `{rf N}` | left/right-hand fingering on one note | preserved (or dropped from a `-1` token, logged in the rewrite record); ignored analytically |
| `{dy f}` / `{dy p}` / … | dynamics, often `f` because exporters default loud | parsed; not used for harmony |
| `\ottava regular` / `\simile none` / `\accidentals auto` | engraver state directives | parsed; not used. A real octave shift shows up as `beat.ottava !== 2` and is flagged in the bar's `flags` as `8va` |
| `\hideDynamics` | engraver display flag | parsed; not used |
| `\ks d` | declared key signature (lies; see §0) | reported as `keyDeclared`, never used for spelling |
| `\tempo 100 \tempo 25` | multiple `\tempo` directives — alphaTab keeps the last | the last value in force at each bar's downbeat is what the map prints |

If you find yourself reasoning about any of these to derive a pitch or a chord, stop —
the map has already done that derivation for you. The pitches are in `melody`,
`melodySkeleton`, `bass`, `bassFolded`; the chords are in `harmony` (root + quality +
pcset) and `harmonySpans` (per-half-bar). See [piano-to-guitar-arranging.md](piano-to-guitar-arranging.md)
for how to use them, and [theory-composition.md](theory-composition.md) for the
underlying music theory.

## 6. Summary — the source-side reading protocol

1. **Do not open the raw `.alphatab`.** Open `analysis/<stem>-map.md`. If it is missing,
   run `node tools/piano-extract.mjs <file.alphatab>` first.
2. Read the **header**: `Key (inferred)` vs `Key declared by \ks` (the disagreement
   flag is load-bearing), `Melody voice`/`Bass voice` (by register, not index), pitch
   range vs guitar range, `Tracks/parts`, `Bars`.
3. Trust the per-bar **table row**: `chord` (root + quality + pcset), `melody contour`
   (the skeleton, contour arrows), `bass` (folded into guitar range), `flags`
   (`8va`, `tuplet`, `overfull`, `outOfRange`, …).
4. If a row looks wrong, **then** go to the raw file at that bar's line, expecting
   `-1.N` artifacts, `{beam}`/`{lf}` decorations, and a `\ks` that may disagree with
   the sounding key. The map already corrected the first; the other two are not music.
5. For the guitar-tab side — what you actually write — switch documents to
   [electric-guitar-voice.md](electric-guitar-voice.md),
   [rock-riff-construction.md](rock-riff-construction.md),
   [guitar-fretboard.md](guitar-fretboard.md),
   [guitar-playability.md](guitar-playability.md), and
   [tunings.md](tunings.md). For the arranging bridge between source and target, see
   [piano-to-guitar-arranging.md](piano-to-guitar-arranging.md).

# AlphaTex Language Reference (verified against alphaTab 1.8.4)

Distilled from https://alphatab.net/docs/alphatex/ and empirically verified with
`node tools/validate.mjs` and `node tools/piano-validate.mjs`. Every construct below
parses with our toolchain unless marked otherwise. Append newly discovered gotchas to
the **Gotchas** section.

This project lives entirely in AlphaTex on **both sides**: the **piano source** you read
(see [alphatex-piano-reading.md](alphatex-piano-reading.md)) and the **guitar tab** you
write (see [electric-guitar-voice.md](electric-guitar-voice.md),
[rock-riff-construction.md](rock-riff-construction.md)). One language, one parser
(`@coderline/alphatab`), one dependency — the whole alternative-notation front half of
the predecessor project (its external transcoder, its JavaScript renderer, the
interchange format between them) is deleted here.

## Document structure

```
\title "Song Name"        // score metadata block
\subtitle "Artist"
\tempo 90
.                          // '.' ends the metadata block (parser hint AT400 says
                           // it is optional in 1.8+, but keep it for clarity)
:2 19.2{v} 17.2 |          // bars of music, separated by |
```

## Score metadata (before `.`)

| Tag | Meaning | Example |
|---|---|---|
| `\title "..."` | Title | `\title "Canon Rock"` |
| `\subtitle "..."` | Subtitle | `\subtitle "JerryC"` |
| `\artist "..."` `\album "..."` | Artist/album | |
| `\music "..."` `\words "..."` | Composer / lyricist | |
| `\copyright "..."` `\tab "..."` | Copyright / transcriber | |
| `\tempo N` | Starting BPM | `\tempo 90` |

## Staff/track metadata

| Tag | Meaning | Example |
|---|---|---|
| `\track "Name"` | Start a new track (multi-track scores) | `\track "Lead Guitar"` |
| `\staff {tabs}` | Staff display mode | `\staff {tabs}` |
| `\tuning (notes)` | String tuning, HIGH string first | `\tuning (E4 B3 G3 D3 A2 E2)` standard; `\tuning (D4 A3 F3 C3 G2 D2)` full step down; Drop D = `(E4 B3 G3 D3 A2 D2)` |
| `\capo N` | Capo fret | `\capo 2` |
| `\instrument N\|name` | MIDI program (29 = overdriven guitar, 30 = distortion guitar, 27 = clean electric) | `\instrument 30` |
| `\lyrics "..."` | Lyrics mapped beat by beat | |

Default with no tags: 6-string standard tuning (E4 B3 G3 D3 A2 E2), steel guitar.

### Pitched (`score`) vs fretted (`tabs`) staves — the central distinction

A **staff display mode** is one or more whitespace-separated words inside `\staff { … }`:

| Body | Staff kind | Note token shape | Where it appears |
|---|---|---|---|
| `score` | **pitched** | letter+accidental+octave, e.g. `C#4` | piano source (`canon-in-d-*.alphatab`), and the score half of a combined guitar staff |
| `tabs` | **fretted** | `fret.string`, e.g. `12.2` | guitar tab output, and the tabs half of a combined guitar staff |
| `score tabs` | **combined** (score + tab on one track) | both kinds allowed | `Canon Rock 1.alphatab` — the score staff above the tab staff for the same instrument |
| _(no `\staff` tag)_ | inferred from notes | either | legacy / hand-written |

```
\staff { score }          // piano — pitched note names, no frets
\staff { tabs }           // guitar tab — fret.string numbers
\staff { score tabs }     // guitar with both a standard-notation staff and a tab staff
```

The extractor's staff-kind classifier (`tools/lib/piano-source.mjs`) tells them apart by
this signal and by `\tuning`, **before** it ever trusts the notes — see
[alphatex-piano-reading.md](alphatex-piano-reading.md) for the full decision table.
**Never** key "is this a piano source?" off the `\instrument` line: `canon-in-d-hard`
declares `instrument acousticgrandpiano` but its two staves are detected as pitched by
their `score` display mode and their note tokens, not by the instrument name.

### `\track { … }` multi-line form

Real exporters (MuseScore's AlphaTex writer) spell `\track` with a parenthesised
short/long name and a braced body of mixer settings, spanning several physical lines:

```
\track ("Piano" "Pno.") {
  volume 12
  balance 8
  instrument acousticgrandpiano
}
  \staff {
    score
  }
```

A **`\staff { … }` block is rejected by the parser unless a `\track` precedes it** (the
parser falls back to a percussion track and every following token mis-parses — see the
Gotchas section). Hand-writing a fixture? Always open a `\track` first. The corpus's
implicit-track fallback (notes with no `\track` at all) is percussion by default and is
not what you want for pitched or fretted music.

## Multi-staff / multi-voice piano layout (the source side)

A piano source is **one `\track`** containing **two `\staff { score }` blocks** — the
right hand (RH) on a treble staff and the left hand (LH) on a bass staff. This is the
exact shape of `canon-in-d-hard.alphatab`:

```
\track ("Piano" "Pno.") { instrument acousticgrandpiano }
  \staff { score }       \voice     \clef g2   \ks d   …   // RH, treble
  \staff { score }       \voice     \clef f4   \ks d   …   // LH, bass
```

- **`\voice`** opens a voice inside the current staff. A staff may carry several voices
  (canon-in-d-hard's treble staff carries four), and each voice is its own line of
  independent music.
- **`\clef g2`** = treble (G clef, 2nd line); **`\clef f4`** = bass (F clef, 4th line).
  These are **display hints only**; the sounding pitch comes from the note name, never
  from the clef. A treble staff that happens to hold low notes still sounds low.
- **Piano voice indices are STAFF-GLOBAL, not staff-local.** In `canon-in-d-hard` the
  treble staff uses voices 0–3 and the bass staff uses voices **4–7**. The extractor's
  `globalVoiceId = trackIndex * 100 + voice.index` therefore reads `s0v0..s0v3` for RH
  and `s1v4..s1v7` for LH. **Never key logic off a voice or staff index** — the melody
  is the highest-SOUNDING voice and the bass is the lowest, chosen by mean MIDI, not by
  voice number, staff number, or track name. See
  [alphatex-piano-reading.md](alphatex-piano-reading.md).

### `\ks` — the declared key signature (REPORTED, never trusted)

`\ks Key` writes a key signature on the staff. Spellings seen in the corpus:
`\ks d`, `\ks c`, `\ks Dmajor`, `\ks Aminor`. **The extractor reports `\ks` but never
uses it for anything musical.** It is a documented corpus fact that the declared key
lies: `Canon Rock 1` declares `\ks c` while **sounding in D major** (and the
`key-lie-ks-c-sounds-D.alphatab` fixture exists to lock that fact in a test). The
sounding key is **inferred from a duration-weighted pitch-class histogram** correlated
against Krumhansl–Schmuckler profiles (`inferKey` in `tools/lib/analysis.mjs`), and the
two values are reported side by side as `key` (inferred, used) and `keyDeclared`
(reported, unused) with a `keyDisagrees` flag. See
[case-canon-rock.md](case-canon-rock.md) §1.2 for the measured disagreement.

### `{beam …}` and `{lf …}` — exporter decoration directives

MuseScore's AlphaTex writer annotates nearly every beat with two properties that carry
no musical information a human reader needs, but which **must be preserved through the
normalizer** because the rewriter is byte-faithful outside its one job:

| Directive | Meaning | Example |
|---|---|---|
| `{beam Up}` / `{beam Down}` | beam grouping hint the engraver emitted | `D5{lf 1}.2{beam Down}` |
| `{lf N}` / `{rf N}` | left-hand / right-hand **fingering** number, attached to one note inside the beat | `Gb5{lf 4}.2{beam Down}` = ring finger on the Gb5 |

- `{beam …}` is a **beat** property — it appears after the duration, like `{dy ff}`.
- `{lf N}` / `{rf N}` is a **note** property — it appears inside the note's own braces,
  before the dot-and-duration. The two combine on one token as
  `NOTE{lf N}.DUR{beam …}`. (Note-level `{lf}/{rf}` is the same spelling listed in the
  note-effects table below; exporters just happen to emit it on pitched notes too.)
- A **`-1.<string>.<duration>{beam …}` token** is the exporter artifact at the heart of
  the AT218 hazard: it is a *rest written as a fretted note* inside a pitched staff. The
  normalizer rewrites it to `r.<duration>` and drops the `{beam …}` tail. See
  [alphatex-piano-reading.md](alphatex-piano-reading.md) and the Gotchas below.

## Notes and beats

- **Note**: `fret.string.duration` — `12.2.4` = fret 12, string 2, quarter note.
  **String 1 = high e, string 6 = low E** (source order). Duration values:
  1, 2, 4, 8, 16, 32, 64 (+ dotted via `{d}`).
- **Default duration**: `:8` sets it for following beats: `:8 12.2 14.2 15.2`.
  A trailing `.4` on one note overrides just that beat: `12.2.4`.
- **Chord** (simultaneous notes): `(5.5 7.4).8` — power chord, eighth note.
- **Rest**: `r.4` quarter rest, `r.1` whole rest.
- **Tied note**: `-.4` or repeat fret with `{-}`; `14.2 -.2` ties into a half note.
- **Dead note**: `x.5.8` — muted percussive hit on string 5.
- **Repeat beat**: `3.3*4` = four quarter-note beats of fret 3 string 3.
- **Bar separator**: `|`. Do not overfill/underfill bars — validate warns.

## Bar metadata (start of a bar)

| Tag | Meaning | Example |
|---|---|---|
| `\ts (N D)` | Time signature | `\ts (6 8)` |
| `\tempo N` | Mid-song tempo change (needs human approval per skill rules!) | `\tempo 120` |
| `\ks Key` | Key signature — REPORTED by the extractor but NEVER trusted (see above) | `\ks Dmajor`, `\ks Aminor` |
| `\ro` / `\rc N` | Repeat open / close (N total plays) | `\ro 1.6*4 \| \rc 2 3.6*4` |
| `\ae (1 2)` | Alternate endings | |
| `\section "Name"` | Section marker | `\section "Solo"` |
| `\tf tripletFeel` | Swing feel | `\tf triplet8th` |
| `\ac` | Anacrusis (pickup bar, exempt from fill check) | |

## Beat effects `{...}` (after the duration, apply to whole beat)

| Code | Effect | Example |
|---|---|---|
| `f` / `fo` / `vs` | Fade in / fade out / volume swell | `19.2{f}` |
| `v` / `vw` | Slight / wide vibrato (beat level) | `15.2{v}` |
| `d` / `dd` | Dotted / double-dotted | `14.2.4{d}` = dotted quarter |
| `tu N` | Tuplet (3 = triplet) | `:8 12.1{tu 3} 14.1{tu 3} 12.1{tu 3}` |
| `tp N` | Tremolo picking (N = 1,2,3 subdivision marks) | `5.6.4{tp 2}` |
| `tb (vals)` | Whammy/tremolo bar; values in quarter-tones (−12 = dive a whole 3 steps... use small ints; 4 = full step) | `(5.6 7.5).4{tb (0 -4)}` |
| `dy X` | Dynamics: ppp pp p mp mf f ff fff | `5.5.8{dy ff}` |
| `gr [onBeat]` | Grace note | `2.2{gr}` |
| `su` / `sd` | Pick stroke up / down | |
| `bu` / `bd` | Brush up / down (strums) | `(0.1 2.2 2.3 2.4 0.5){bd}` |
| `au` / `ad` | Arpeggio up / down | |
| `txt "..."` | Text annotation | `12.2{txt "theme"}` |
| `ch "Name"` | Chord name annotation | `(3.5 5.4 5.3){ch "C5"}` |
| `cre` / `dec` | Crescendo / decrescendo | |
| `tt` | Tapping | `17.1{tt}` |

## Note effects `{...}` (inside a chord: attach to individual note)

| Code | Effect | Example |
|---|---|---|
| `b (vals)` | Bend; values in **quarter-steps** (4 = full-step bend), auto-spread | `17.1{b (0 4)}` bend up; `{b (0 4 4 0)}` bend + release |
| `be (...)` | Bend with exact offsets | |
| `h` | Hammer-on / pull-off to next note | `14.1{h} 15.1` |
| `sl` / `ss` | Legato / shift slide to next note | `12.2{sl} 14.2` |
| `sib` / `sia` | Slide in from below / above | `9.5{sib}` |
| `sou` / `sod` | Slide out up / down | |
| `psd` / `psu` | Pick slide down / up | |
| `pm` | Palm mute | `1.6{pm}` |
| `lr` | Let ring | `(0.4 2.3){lr}` |
| `st` | Staccato | |
| `ac` / `hac` / `ten` | Accent / heavy accent / tenuto | |
| `v` / `vw` | Note-level vibrato | `15.2{v}` |
| `nh` / `ah F` / `ph` / `th F` | Natural / artificial / pinch / tapped harmonic | `19.2{ph}` |
| `t` | Tied note | |
| `x` | Dead note | |
| `g` | Ghost note | |
| `tr (F dur)` | Trill with fret F | `14.1{tr (16 16)}` |
| `lht` | Left-hand tap | |
| `lf N` / `rf N` | Left/right-hand fingering (exporters emit this on pitched notes too — see above) | |

Multiple effects combine inside one brace: `19.2{v f}`, `15.1{ph b (0 4)}`.

## Multi-track / multi-voice

```
\track "Rhythm"
\staff {tabs} \instrument 30
:8 (1.6 3.5)*8 |
\track "Lead"
\staff {tabs} \instrument 29
:4 12.2 14.2 15.2 17.2 |
```
Bars align across tracks by index; keep bar counts equal. For a **multi-staff piano**
source (one track, two `score` staves), see the dedicated section above and
[alphatex-piano-reading.md](alphatex-piano-reading.md).

## Gotchas (empirically discovered — append here)

1. **Do not write literal TAB characters** — `\t` in generated text corrupts `\title`.
2. Duration must be one of 1,2,4,8,16,32,64,128,256 — `9` is rejected (AT209).
3. alphaTab's *internal* `note.string` is inverted from source: internally 1 = low E.
   Tool output (`fretRangeByString`) uses the internal numbering; when reading
   stats, string6 = source string 1 (high e).
4. Bend/whammy values are quarter-steps: 4 = whole step, 2 = half step.
   `{b (0 4 4 0)}` = up a whole step, hold, release.
5. Effects order inside `{}` is flexible, but keep value-taking effects
   (`b`, `tu`, `tr`) last for readability.
6. The metadata-ending `.` is optional in 1.8+ (hint AT400) but harmless; keep it.
7. An overfull/underfull bar parses fine — only `validate.mjs` catches it. Always
   run validate; never trust the eye for bar math. Tuplets are the usual culprit:
   three `{tu 3}` eighths occupy ONE beat, not 1.5.
8. **Note effects on chords go per-note, inside the parens**: `(0.6{pm} 0.5{pm})`
   parses; `(0.6 0.5){pm}` is an error AT205 — braces after `)` accept only
   beat effects (`tb`, `tu`, `d`, `dy`, `ch`, `au`, ...). `pm`, `lr`, `h`, `b`
   are note effects.
9. Multi-argument metadata and properties want parentheses: `\ts (4 4)`,
   `{tr (16 16)}`. Space-separated args parse but emit warnings AT301/AT303.
10. **A `\staff { score }` block is rejected unless a `\track` precedes it**
    (AlphaTex error **AT205**). With no open track the parser defaults to a
    percussion track, and every following pitched or fretted token then mis-parses
    (often surfacing as a cascade of AT209 "unexpected percussion articulation"
    errors that *look* like a music problem but are really a missing-track
    problem). Always open a `\track` first — the corpus's `\track ("Piano" "Pno.") { … }`
    form is the template. Relevant when hand-writing fixtures.
11. **The declared `\ks` lies.** `Canon Rock 1` declares `\ks c` while sounding in
    D major. The extractor REPORTS `\ks` (as `keyDeclared`) but infers the sounding
    key from pitch content (`inferKey`) and uses that everywhere. Do not be tempted
    to "trust the key signature" when spelling notes or picking sharps vs flats.
12. **A `-1.<string>.<duration>` token inside a pitched staff is the AT218 hazard** —
    an exporter artifact, a rest written as a fretted note. `canon-in-d-easy` carries
    11 of them and fails to parse until the normalizer rewrites each to
    `r.<duration>`. **Read the bar map, not the raw file** — see
    [alphatex-piano-reading.md](alphatex-piano-reading.md).

## Worked example (Canon-in-D descant, annotated)

The eight-note descant that survives into both guitar covers at the same written pitch
(see [case-canon-rock.md](case-canon-rock.md) §0):

```
:2 F#5{v f} E5{v f} |        // half notes: F#5, E5 — fade-in vibrato, D major descent
D5{v f}  C#5{v f} |          // D5, C#5
B4{v f}  A4{v f}  |          // B4, A4
B4{v f}  C#5{v f} |          // B4, C#5 — return lift
```

The same line written as a **pitched piano source** (the way `canon-in-d-easy` carries
it, with exporter `{lf}`/`{beam}` decorations) versus a **fretted guitar tab** (the way
you would emit it for the lead guitar) makes the `score` vs `tabs` distinction visible
at a glance:

```
\track ("Piano" "Pno.") { instrument acousticgrandpiano }
  \staff { score }                          // PIANO SOURCE — pitched
    \voice \clef g2 \ks d
      F#5{lf 3}.2{beam Down} E5{lf 2}.2{beam Down} |

\track "Lead"                               // GUITAR TAB — fretted
  \staff { score tabs } \instrument 30 \tuning (E4 B3 G3 D3 A2 E2)
    :2 19.2{v f} 17.2{v f} |                 // F#5 = 19:7, E5 = 17:7 on the high E string
```
See [guitar-fretboard.md](guitar-fretboard.md) for the fret/string mapping,
[tunings.md](tunings.md) for the string tunings, and
[piano-to-guitar-arranging.md](piano-to-guitar-arranging.md) for the bridge from a
pitched source line to a playable guitar line (with
[guitar-playability.md](guitar-playability.md) as the constraint reference and
[theory-composition.md](theory-composition.md) for the underlying harmony).

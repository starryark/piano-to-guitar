# Bar map -- LieZhiJiuBaChengShi_Piano_only

- Source: `LieZhiJiuBaChengShi_Piano_only.alphatab`
- Key (inferred from pitch content): **A** (fifths 3, r=0.6764)
- Key declared by `\ks`: **Am** (fifths 0)  — **DISAGREES with the sounding key; the declaration is not trusted anywhere in this digest.**
- Initial meter: **4/4**  |  Initial tempo: **120** BPM
- Pitch range: **G1..E6** (MIDI 31..88)  vs guitar E2..E5 (MIDI 40..76)
- Melody voice: **0**  |  Bass voice: **0**  (chosen by sounding register, not voice/staff/track id)  |  Pickup bar: **no**
- Range deficit: **1253** note(s) below guitar low, **121** above guitar high
- Tracks/parts: **1**  |  Bars: **108**

- Meter distribution: 4/4: 108 bars

- Gate-critical coverage: **107/108** bars carry a non-empty `melodySkeleton`, **108/108** carry a `harmony.root`. (compare.mjs gates are `covered === total` and are vacuous at total 0.)

- Source profile: **noisy-transcription**  |  pitched groups: pitched-1 tracks [0]
  - Noise: voice fragmentation **none** (0 fragmented gesture(s)), 85 isolated octave artifact(s), 1755 microfragment tie chain(s), 142 near-simultaneous split(s), 776 off-grid onset(s) (mean normalization confidence 0.9393).
  - **Doctrine:** on a noisy transcription the highest voice is a CANDIDATE, not perceptual truth — review the foreground evidence before drafting, and do not declare source-tied spans `free` just because the extractor disagrees.

- Tie audit: **2011** multi-fragment tie chain(s) (longest 24 fragments, 1755 microfragment chain(s)); **5** chain(s) tie across silence. Melody/bass/skeleton are tie-coalesced: continuations are not attacks, and a chain head carries its merged sounding duration.

## Sections

| start | end | bars | reason |
|---|---|---|---|
| 1 | 108 | 108 | end |

## Duplicate ranges

_none detected_

## Harmonic loop

- Cycle length: **8** bars  |  First bar: **7**  |  Coverage: **81%**  |  Passes: **12**
  _matched on root motion only; chord qualities vary across passes and the spellings below are the first-observed voicing._

- Cycle: `E -> Gmaj7 -> Gmaj7 -> Gmaj7 -> Gsus2 -> Gmaj7 -> Gmaj7 -> Gmaj7`

- Passes: passes 1-12 (bars 7-102)

## Bars

| bar | TS | tempo | chord | melody contour | bass | flags |
|---|---|---|---|---|---|---|
| 1 | 4/4 | 120 | E7 | F#4 /E5 \E2 /F#4 | D3 G#4 A4 E5 E3 B3 E2 F#3 |  |
| 2 | 4/4 | 120 | Dmaj7 | G#4 \E4 \C#4 | A4 G#3 E3 C#4 D3 G#4 |  |
| 3 | 4/4 | 120 | E7 | A4 /E5 \E2 /F#4 | A3 E5 E3 E2 F#3 |  |
| 4 | 4/4 | 120 | C#m | E4 \C#4 | E3 C#3 D3 G#4 A3 E5 |  |
| 5 | 4/4 | 120 | E | A4 \E2 /F#4 | E3 G#4 E2 F#3 E5 G#3 | outOfRange,tieAnomaly |
| 6 | 4/4 | 120 | Dmaj7 | E5 \C#4 /A4 \C#4 /A4 | E3 A4 D3 C#4 A3 B3 |  |
| 7 | 4/4 | 120 | E | E4 /F#4 | E3 F#3 |  |
| 8 | 4/4 | 120 | Gmaj7 | G1 /E5 \E3 | D3 G2 G#4 A3 E5 B3 E3 F#3 | outOfRange |
| 9 | 4/4 | 120 | Gmaj7 | F#4 \G1 /A4 \G1 /E4 \C#4 | F#3 G2 A4 G#3 E3 C#4 | outOfRange |
| 10 | 4/4 | 120 | Gmaj7 | G#4 /E5 \G1 /G#4 \E3 /F#4 | G#4 A4 E5 E3 G2 F#3 G#2 | outOfRange |
| 11 | 4/4 | 120 | Gsus2 | F#3 \G1 =G1 | F#3 E3 G2 C#3 F#4 D3 G#4 A3 | outOfRange |
| 12 | 4/4 | 120 | Gmaj7 | G1 /G#4 \E3 \G1 | E5 E3 G2 B3 F#3 G#3 | outOfRange |
| 13 | 4/4 | 120 | Gmaj7 | C#4 \G1 /E5 \E2 /F#4 \A3 /A4 \C#4 /A4 \G1 | C#4 G#2 G2 E3 A4 E2 D3 A3 A2 | outOfRange |
| 14 | 4/4 | 120 | Gmaj7 | G#4 \E4 /F#4 \G1 | B3 E3 F#3 G2 | outOfRange |
| 15 | 4/4 | 120 | Gmaj7 | A4 \G1 /B4 \A4 /C#5 \G1 /B4 | F#2 D3 G2 B4 A3 C#5 E3 | outOfRange |
| 16 | 4/4 | 120 | Gmaj7 | A4 \G1 /C#5 \G1 /E4 | F#3 F#2 G2 G#3 E3 | outOfRange |
| 17 | 4/4 | 120 | Gmaj7 | A4 /B4 \A2 /C#5 \G1 /B4 \E3 | G2 B4 A4 A2 C#5 E3 F#3 B2 | outOfRange |
| 18 | 4/4 | 120 | Gmaj7 | F#5 \G1 /E5 \G#2 /A4 \G1 | F#3 F#5 E3 G2 C#3 G#2 D3 B4 | outOfRange |
| 19 | 4/4 | 120 | Gmaj7 | A4 /C#5 \G1 /B4 \B3 /C#5 \F#2 | A3 C#5 E3 G2 F#3 | outOfRange |
| 20 | 4/4 | 120 | Gmaj7 | G#4 \G1 =G1 /B4 \G1 /A4 \A2 | G#3 G2 E3 E4 F#2 B4 A4 A2 C#5 | outOfRange |
| 21 | 4/4 | 120 | Gmaj7 | E4 \G1 /B4 \E3 /A4 \B2 /F#4 \G1 /F#5 \B2 | E3 G2 F#3 B2 F#5 | outOfRange |
| 22 | 4/4 | 120 | Gmaj7 | E5 \F#2 /A4 \D2 /B4 \A4 /C#5 \G1 | E5 F#2 D3 G2 B4 A3 C#5 E3 | outOfRange |
| 23 | 4/4 | 120 | Gmaj7 | B3 \G1 =G1 /E4 | E3 F#3 F#2 G2 G#3 B3 | outOfRange |
| 24 | 4/4 | 120 | Gmaj7 | B4 \A4 /C#5 \G1 /B4 \B3 | G2 B4 A3 C#5 E3 F#3 | outOfRange |
| 25 | 4/4 | 120 | Gmaj7 | F#4 \G1 /F#5 \G1 /E5 \G#2 /D4 \G1 | F#3 B2 G2 E4 E3 C#3 G#2 D3 | outOfRange |
| 26 | 4/4 | 120 | Gmaj7 | B4 \A4 /C#5 \G1 /B4 \B3 /A4 | B4 A3 C#5 E3 G2 E4 F#3 | outOfRange |
| 27 | 4/4 | 120 | Gmaj7 | G1 /E4 \F#2 /B4 | G#3 G2 E3 F#2 B4 A4 A2 | outOfRange |
| 28 | 4/4 | 120 | Gmaj7 | C#5 \G1 /B4 \B3 \G1 | C#5 E3 G2 F#3 F#4 | outOfRange |
| 29 | 4/4 | 120 | Gmaj7 | A2 /A4 \D2 /A4 \D3 | E5 A2 D3 A3 A4 G2 | outOfRange |
| 30 | 4/4 | 120 | Gmaj7 | A4 /C#5 \G1 =G1 | A4 E3 F#3 F#2 G2 G#3 | outOfRange |
| 31 | 4/4 | 120 | Gmaj7 | E3 \F#2 /E5 \G1 /E5 | E3 F#2 E4 G2 A2 E5 D5 | outOfRange |
| 32 | 4/4 | 120 | Gmaj7 | C#5 \G1 /E4 \G1 /E4 \C#4 | F#3 G2 B2 E3 C#3 | outOfRange |
| 33 | 4/4 | 120 | Gmaj7 | D4 \G1 /E3 /C#5 \G1 | D3 G2 A3 A4 B3 E3 F#3 F#2 | outOfRange |
| 34 | 4/4 | 120 | Gmaj7 | G1 /E4 \F#2 /A2 | G#3 G2 E3 F#2 E4 A2 | outOfRange |
| 35 | 4/4 | 120 | Gmaj7 | E4 \G1 /A4 \G1 | E4 E3 G2 G#4 F#3 | outOfRange |
| 36 | 4/4 | 120 | Gmaj7 | C#3 \G1 /A4 \G1 | B2 C#3 G2 D3 A3 E5 | outOfRange |
| 37 | 4/4 | 120 | Gmaj7 | D5 \G1 =G1 /A4 \G#4 /B4 | E3 G2 C#5 F#3 B2 A4 G#3 | outOfRange |
| 38 | 4/4 | 120 | G | B4 \E3 /C#5 \E4 /A4 \G1 /E5 \G1 | E3 B2 E4 D3 G2 A3 E5 | outOfRange |
| 39 | 4/4 | 120 | Gmaj7 | B4 \F#4 /C#5 \C#3 /E5 \E4 /C#5 \G1 /C#5 | E3 F#3 G2 E5 C#3 A4 | outOfRange |
| 40 | 4/4 | 120 | Gmaj7 | G1 /D4 \A3 /E5 \G1 | D3 G2 D4 A3 A2 E3 C#5 F#3 | outOfRange |
| 41 | 4/4 | 120 | Gmaj7 | B4 \G1 /A4 \G1 /C#5 \B2 | F#3 G2 A4 G#3 E3 B2 E4 | outOfRange |
| 42 | 4/4 | 120 | Gmaj7 | E5 \G1 /B4 \F#4 \C#3 \G1 | A3 E5 E3 G2 F#3 C#5 C#3 | outOfRange |
| 43 | 4/4 | 120 | Gmaj7 | F#3 \B2 /A4 \A2 \G1 | E5 F#3 C#5 A4 B2 D3 A2 G2 | outOfRange |
| 44 | 4/4 | 120 | Gmaj7 | G1 =G1 /A4 \G1 | E3 G2 F#3 B2 A4 G#3 | outOfRange |
| 45 | 4/4 | 120 | G | B4 /C#5 \E4 /A4 \A3 /E5 \G1 | G#3 E3 E4 D3 A3 E5 G2 | outOfRange |
| 46 | 4/4 | 120 | Gmaj7 | F#4 /C#5 \G1 /C#3 \G1 | E3 F#3 G2 C#3 E5 | outOfRange |
| 47 | 4/4 | 120 | G | G#3 /A4 \A2 \G1 /E5 \G1 | A4 G#3 D3 A2 G2 A3 E5 E3 C#5 | outOfRange |
| 48 | 4/4 | 120 | Gmaj7 | C#5 \B2 /B4 \G1 /A4 \G1 /B4 \B2 /B4 \E3 /C#5 \B2 | F#3 B2 G2 A4 G#3 E3 C#5 E4 | outOfRange |
| 49 | 4/4 | 120 | Gmaj7 | A4 \A3 /E5 \G1 /B4 \F#4 | G2 A3 E5 E3 F#3 | outOfRange |
| 50 | 4/4 | 120 | Gmaj7 | C#5 \G1 /E5 \F#3 \G1 /A4 \A2 /F#4 \G1 | F#3 C#3 G2 E5 C#5 A4 B2 A2 D3 G#4 | outOfRange |
| 51 | 4/4 | 120 | Gmaj7 | A4 /E5 \E4 /G#4 \E3 \G1 | A3 E5 E3 G2 B3 F#3 A4 | outOfRange |
| 52 | 4/4 | 120 | Gmaj7 | G#4 \C#4 /E4 \C#4 | G#3 E3 C#4 G2 G#4 A4 E5 | outOfRange |
| 53 | 4/4 | 120 | Gmaj7 | A4 \G1 /G#4 \E3 /F#4 \G1 /E4 \G1 | E3 G2 G#4 F#3 C#4 | outOfRange |
| 54 | 4/4 | 120 | Gmaj7 | C#4 /F#4 \G#1 /F#4 \G1 /E5 | C#3 C#4 G#2 D3 G2 G#4 A3 E5 B3 | outOfRange |
| 55 | 4/4 | 120 | Gmaj7 | E3 /C#4 /E5 \G1 /F#5 \G1 /E5 | E3 F#3 E5 G2 G#3 C#4 A4 G#2 E2 | outOfRange |
| 56 | 4/4 | 120 | Gmaj7 | C#4 /A4 \A2 /A4 \G1 /G#4 \E4 | D3 C#4 A3 A2 E3 G2 B3 F#3 | outOfRange |
| 57 | 4/4 | 120 | Gmaj7 | F#4 \G1 /F#4 \G1 /F#4 /F#5 \G1 | F#3 G2 F#4 D3 | outOfRange |
| 58 | 4/4 | 120 | Gmaj7 | G#5 /E6 \G1 /G#5 \E3 /F#5 | G#5 A5 E6 E3 G2 G#4 F#3 F#4 C#4 | outOfRange |
| 59 | 4/4 | 120 | Gmaj7 | A4 \G1 /E4 \C#4 /A5 | A4 G#3 C#4 G2 E3 G#5 A5 A2 | outOfRange |
| 60 | 4/4 | 120 | Gmaj7 | E6 \G1 /G#5 \E3 \G1 /E4 | E6 E3 G2 F#3 C#4 | outOfRange |
| 61 | 4/4 | 120 | Gmaj7 | E4 \E2 /F#5 \G1 /E6 \G1 | E3 C#3 E2 D3 G2 G#5 A5 E6 | outOfRange |
| 62 | 4/4 | 120 | Gmaj7 | G#5 \E3 /F#5 \G#1 /F#5 \G1 | G#4 E3 F#3 G#2 E5 G#3 C#4 G2 | outOfRange |
| 63 | 4/4 | 120 | Gmaj7 | A5 \B3 /F#5 \G1 /A5 \A2 /A5 \G1 | A4 B3 D3 G2 C#5 A5 A2 E3 | outOfRange |
| 64 | 4/4 | 120 | Gdim | F#5 | F#3 F#4 C#4 G2 F#2 | outOfRange |
| 65 | 4/4 | 120 | Gmaj7 | D4 \G1 /B4 \A4 /C#5 \E4 /B4 \B3 /C#5 \G1 | D3 G2 B4 A3 C#5 E3 F#3 F#2 | outOfRange |
| 66 | 4/4 | 120 | Gmaj7 | G1 /E4 \F#2 | G#3 G2 E3 F#2 D3 B4 | outOfRange |
| 67 | 4/4 | 120 | Gmaj7 | A4 \A2 /C#5 \G1 /B4 \E3 /C#5 \G1 | A4 A2 C#5 E3 G2 F#3 B2 | outOfRange |
| 68 | 4/4 | 120 | Gmaj7 | F#5 \G1 /E5 \G#1 /D4 \G1 /B4 \A4 | E3 G2 C#3 G#2 D3 B4 A3 C#5 | outOfRange |
| 69 | 4/4 | 120 | Gmaj7 | E4 \D2 /B4 \B3 /C#5 \G1 /C#5 \G1 | E3 G2 F#3 F#2 G#3 | outOfRange |
| 70 | 4/4 | 120 | G | E4 \D4 /B4 \A4 /C#5 \G1 | E3 G2 B4 A4 C#5 | outOfRange,tieAnomaly |
| 71 | 4/4 | 120 | Gmaj7 | B3 /C#5 \G1 | E3 F#3 G2 C#4 F#4 F#5 E5 | outOfRange |
| 72 | 4/4 | 120 | Gmaj7 | F#2 /A3 \G1 /B4 \A4 /C#5 \G1 /B4 \B3 | F#2 D3 G2 B4 A3 C#5 E3 B3 C#4 | outOfRange |
| 73 | 4/4 | 120 | Gmaj7 | A4 \G1 /G#4 \G1 /E4 \E2 | F#3 F#2 G2 G#3 C#4 E3 E2 D3 | outOfRange |
| 74 | 4/4 | 120 | Gmaj7 | B4 \A4 /C#5 \G1 /B4 \B3 /C#5 \G1 | G2 A3 C#5 E3 E2 E4 F#3 | outOfRange |
| 75 | 4/4 | 120 | Gmaj7 | G1 /E5 \G#2 /A3 \G1 /B4 | E3 G2 C#3 G#2 D3 B4 A3 | outOfRange |
| 76 | 4/4 | 120 | Gmaj7 | E2 /B4 \B3 \G1 | C#5 E3 G2 B3 C#4 F#3 F#2 G#3 | outOfRange |
| 77 | 4/4 | 120 | Gmaj7 | G#4 \G1 /E4 \E2 /B4 \A2 /C#5 \G1 | G#3 G2 E3 F#2 E2 D4 A3 A2 C#5 | outOfRange |
| 78 | 4/4 | 120 | Gmaj7 | B4 \E3 /C#5 \G1 /F#5 \G1 | E3 F#3 C#4 G2 B2 B3 E5 | outOfRange |
| 79 | 4/4 | 120 | G | D2 /A4 \D3 \G1 /A4 | D3 A3 A4 E3 G2 | outOfRange |
| 80 | 4/4 | 120 | Gmaj7 | C#5 \G1 =G1 /E4 \F#2 | F#3 F#2 G2 C#4 G#3 E3 E4 | outOfRange |
| 81 | 4/4 | 120 | Gmaj7 | E5 \A2 \G1 /E5 | G2 A2 A3 E5 E3 E4 D5 F#3 B2 | outOfRange |
| 82 | 4/4 | 120 | Gmaj7 | B2 /E3 \G1 /E4 \C#4 | B2 E3 G2 C#3 D3 | outOfRange |
| 83 | 4/4 | 120 | Gmaj7 | A4 \D3 /E3 /C#5 \G1 | A3 D3 A4 G2 E3 F#3 F#2 | outOfRange |
| 84 | 4/4 | 120 | Gmaj7 | G#4 \G1 /E4 \E3 \F#2 /A2 \G1 | G#3 G2 E3 F#2 E4 D3 D4 | outOfRange |
| 85 | 4/4 | 120 | Gmaj7 | E4 \G1 /E5 \G#4 /C#5 \G#1 /F#4 \G1 /B2 | E3 G2 E4 G#4 F#3 G#2 C#4 B2 | outOfRange |
| 86 | 4/4 | 120 | G | A2 /A4 \G1 /A2 /E5 \G1 | B2 A2 D3 G2 A3 E5 E3 | outOfRange |
| 87 | 4/4 | 120 | Gmaj7 | E3 /C#5 \F#4 /B4 \G1 /A4 \G1 /C#5 | E3 C#5 F#3 G2 A4 G#3 B2 | outOfRange |
| 88 | 4/4 | 120 | Gmaj7 | E5 \G1 /D5 | D3 A3 E3 G2 D5 F#3 | outOfRange |
| 89 | 4/4 | 120 | Gsus2 | C#5 \G1 /C#3 \G1 | F#3 G2 C#3 E5 E3 A4 D3 | outOfRange |
| 90 | 4/4 | 120 | Gmaj7 | A2 /E5 \G1 /C#5 \F#4 /B4 | A2 E5 E3 G2 C#5 F#3 B2 | outOfRange |
| 91 | 4/4 | 120 | G | A4 \G#4 /B4 \G1 /B4 \E3 /C#5 \B2 /A4 \G1 | A4 G#3 G2 E3 C#5 B2 E4 D3 E5 | outOfRange |
| 92 | 4/4 | 120 | Gmaj7 | E5 \G1 /D5 \C#3 \G1 | E5 E3 G2 D5 F#3 C#4 C#3 | outOfRange |
| 93 | 4/4 | 120 | G | C#5 \A2 /A4 \G1 /E5 \G1 | C#5 A4 B2 A2 D3 G2 E3 | outOfRange |
| 94 | 4/4 | 120 | Gmaj7 | C#5 \F#4 /B4 \G1 /A4 \G#4 /B4 \B2 | E3 C#5 F#3 B2 G2 A4 G#3 | outOfRange |
| 95 | 4/4 | 120 | G | C#5 \B2 /A4 \A3 \G1 /D5 | E3 B2 E4 G2 A3 E5 D5 | outOfRange |
| 96 | 4/4 | 120 | Gmaj7 | B4 /C#5 \G1 /C#3 \G1 /C#5 \A4 | F#3 G2 C#3 E5 E3 A4 | outOfRange |
| 97 | 4/4 | 120 | Gmaj7 | A3 \A2 /E5 \G1 /C#5 \F#4 /B4 | D3 G2 E5 E3 C#5 F#3 B2 | outOfRange |
| 98 | 4/4 | 120 | Gmaj7 | G#4 /B4 \B2 /C#5 \B2 /A4 \G1 | A4 G#3 G2 E3 B2 E4 F#3 | outOfRange |
| 99 | 4/4 | 120 | Gmaj7 | F#3 \G1 /D5 \G1 | F#3 E5 F#4 E3 G2 D5 C#3 C#4 | outOfRange |
| 100 | 4/4 | 120 | G | E5 \C#3 /A4 \A2 /B4 \A4 | E5 C#5 C#3 A4 A2 D3 D4 A3 | outOfRange |
| 101 | 4/4 | 120 | E | E4 /B4 =B4 \G#4 | E3 B3 F#3 A4 G#3 |  |
| 102 | 4/4 | 120 | Dmaj7 | E4 /G#4 /E5 \E4 | E3 B3 D3 A3 |  |
| 103 | 4/4 | 120 | C#m7 | A4 /B4 \E4 /C#5 | B3 F#3 E3 E4 C#3 G#3 |  |
| 104 | 4/4 | 120 | C#m7 | G#4 \E4 /F#4 \E4 /G#4 \E4 /A4 | G#4 D3 A3 E4 E3 B3 |  |
| 105 | 4/4 | 120 | Dmaj7 | A4 /D5 \A4 | F#3 C#4 B4 G#3 E3 B3 D3 |  |
| 106 | 4/4 | 120 | Dmaj7 | A4 /F#5 \E4 /E5 | D4 E3 E4 F#3 | outOfRange |
| 107 | 4/4 | 120 | F#m | C5 \A4 | A4 B4 F#4 |  |
| 108 | 4/4 | 120 | A |  |  |  |

# Bar map -- LieZhiJiuBaChengShi

- Source: `LieZhiJiuBaChengShi_Piano_and_Drum.alphatab`
- Key (inferred from pitch content): **F#m** (fifths 3, r=0.8351)
- Key declared by `\ks`: **C** (fifths 0)  — **DISAGREES with the sounding key; the declaration is not trusted anywhere in this digest.**
- Initial meter: **4/4**  |  Initial tempo: **120** BPM
- Pitch range: **D2..F#6** (MIDI 38..90)  vs guitar E2..E5 (MIDI 40..76)
- Melody voice: **0**  |  Bass voice: **4**  (chosen by sounding register, not voice/staff/track id)  |  Pickup bar: **no**
- Range deficit: **16** note(s) below guitar low, **89** above guitar high
- Tracks/parts: **2**  |  Bars: **108**

- Meter distribution: 4/4: 108 bars

- Gate-critical coverage: **84/108** bars carry a non-empty `melodySkeleton`, **108/108** carry a `harmony.root`. (compare.mjs gates are `covered === total` and are vacuous at total 0.)

- Source profile: **noisy-transcription**  |  excluded: track 1 "Drums" (percussion)  |  pitched groups: pitched-1 tracks [0]
  - Noise: voice fragmentation **high** (339 fragmented gesture(s)), 44 isolated octave artifact(s), 517 microfragment tie chain(s), 38 near-simultaneous split(s), 562 off-grid onset(s) (mean normalization confidence 0.9368).
  - **Doctrine:** on a noisy transcription the highest voice is a CANDIDATE, not perceptual truth — review the foreground evidence before drafting, and do not declare source-tied spans `free` just because the extractor disagrees.

- Tie audit: **1645** multi-fragment tie chain(s) (longest 7 fragments, 517 microfragment chain(s)). Melody/bass/skeleton are tie-coalesced: continuations are not attacks, and a chain head carries its merged sounding duration.

## Sections

| start | end | bars | reason |
|---|---|---|---|
| 1 | 108 | 108 | end |

## Duplicate ranges

_none detected_

## Harmonic loop

No repeating harmonic progression detected (no cycle of length 2-8 with >=80% coverage and >=3 passes).

## Bars

| bar | TS | tempo | chord | melody contour | bass | flags |
|---|---|---|---|---|---|---|
| 1 | 4/4 | 120 | E7 | E4 | A3 B3 E2 | tieAnomaly |
| 2 | 4/4 | 120 | Dmaj7 |  | A4 E3 D3 | noSkeleton,tieAnomaly |
| 3 | 4/4 | 120 | E7 | E4 | E3 E2 |  |
| 4 | 4/4 | 120 | C#m |  | C#3 D3 | noSkeleton,tieAnomaly |
| 5 | 4/4 | 120 | E | E4 /F#4 | E2 F#3 G#4 | outOfRange,tieAnomaly |
| 6 | 4/4 | 120 | Dmaj7 |  | E3 | noSkeleton,tieAnomaly |
| 7 | 4/4 | 120 | E | F#4 | E3 F#3 | tieAnomaly |
| 8 | 4/4 | 120 | Dmaj7 |  | A3 E3 | noSkeleton,tieAnomaly |
| 9 | 4/4 | 120 | Dmaj7 | G#4 \C#4 | C#4 E3 A3 | tieAnomaly |
| 10 | 4/4 | 120 | Dmaj7 | C#4 | G#4 E3 | tieAnomaly |
| 11 | 4/4 | 120 | C#m | C#4 | E3 F#4 | tieAnomaly |
| 12 | 4/4 | 120 | E | B3 /F#4 | B3 G#4 F#3 G#3 | outOfRange,tieAnomaly |
| 13 | 4/4 | 120 | Dmaj7 |  | B3 D3 | outOfRange,noSkeleton,tieAnomaly |
| 14 | 4/4 | 120 | E |  | E3 F#3 | noSkeleton,tieAnomaly |
| 15 | 4/4 | 120 | Dmaj7 | C#5 | D3 | outOfRange,tieAnomaly |
| 16 | 4/4 | 120 | F#m7 | A4 /C#5 \E4 | F#2 |  |
| 17 | 4/4 | 120 | A | A4 /C#5 \B4 | A2 F#3 | tieAnomaly |
| 18 | 4/4 | 120 | G#m7b5 | G#3 | C#3 | outOfRange,tieAnomaly |
| 19 | 4/4 | 120 | F#m7 | B4 /C#5 | E3 F#3 | tieAnomaly |
| 20 | 4/4 | 120 | Dsus2 | G#4 \B3 | D3 | tieAnomaly |
| 21 | 4/4 | 120 | Bsus4 |  | F#3 | outOfRange,noSkeleton,tieAnomaly |
| 22 | 4/4 | 120 | Dmaj7 | E5 \A4 /C#5 | E3 | tieAnomaly |
| 23 | 4/4 | 120 | F#m7 | F#4 | F#2 | tieAnomaly |
| 24 | 4/4 | 120 | Bm7 | C#5 | F#3 | tieAnomaly |
| 25 | 4/4 | 120 | G#m7b5 | G#2 | C#3 | outOfRange,tieAnomaly |
| 26 | 4/4 | 120 | F#m7 | B4 /C#5 \A4 | F#2 | tieAnomaly |
| 27 | 4/4 | 120 | Amaj7 | F#3 /C#5 \E4 | C#4 A2 | tieAnomaly |
| 28 | 4/4 | 120 | A | A4 | F#3 | outOfRange,tieAnomaly |
| 29 | 4/4 | 120 | D |  | D3 E3 | outOfRange,noSkeleton,tieAnomaly |
| 30 | 4/4 | 120 | F#m7 | A4 /C#5 \F#3 /G#4 \B3 | F#2 E3 | tieAnomaly |
| 31 | 4/4 | 120 | Asus4 |  | D3 | noSkeleton,tieAnomaly |
| 32 | 4/4 | 120 | Bsus4 | F#4 \C#4 | B2 | tieAnomaly |
| 33 | 4/4 | 120 | Dmaj7 | A4 | D3 E3 C#4 | outOfRange,tieAnomaly |
| 34 | 4/4 | 120 | F#m7 | C#4 | A2 | tieAnomaly |
| 35 | 4/4 | 120 | Amaj7 | B3 /F#4 |  | tieAnomaly |
| 36 | 4/4 | 120 | A |  | C#3 D3 | noSkeleton |
| 37 | 4/4 | 120 | Amaj7 | D5 \G#3 | A2 B2 | tieAnomaly |
| 38 | 4/4 | 120 | Bm7 | E5 | E3 | tieAnomaly |
| 39 | 4/4 | 120 | Amaj7 | F#4 /E5 | C#3 | tieAnomaly |
| 40 | 4/4 | 120 | Amaj7 | E5 | D3 E3 | tieAnomaly |
| 41 | 4/4 | 120 | Bm7 | B4 \G#4 | E3 | tieAnomaly |
| 42 | 4/4 | 120 | C#m7 | D5 \C#4 | C#3 | tieAnomaly |
| 43 | 4/4 | 120 | A | C#5 \A4 | A2 | tieAnomaly |
| 44 | 4/4 | 120 | Amaj7 | A4 | B2 G#3 | tieAnomaly |
| 45 | 4/4 | 120 | Bm7 | D#5 \A4 /E5 | D3 | tieAnomaly |
| 46 | 4/4 | 120 | C#m7 | C#5 \E4 | C#3 | tieAnomaly |
| 47 | 4/4 | 120 | Amaj7 | A4 /E5 |  | tieAnomaly |
| 48 | 4/4 | 120 | B7 | C#5 \F#4 /D#5 | B2 B4 | tieAnomaly |
| 49 | 4/4 | 120 | C#m7 | A4 /E5 \D5 | E3 | tieAnomaly |
| 50 | 4/4 | 120 | Bm7 | A4 | B2 D3 | tieAnomaly |
| 51 | 4/4 | 120 | Dmaj7 | C#4 | E3 | tieAnomaly |
| 52 | 4/4 | 120 | Dmaj7 |  | E3 A3 | noSkeleton,tieAnomaly |
| 53 | 4/4 | 120 | E | E4 /F#4 | E3 | tieAnomaly |
| 54 | 4/4 | 120 | C#m7 | E5 | C#3 A3 E3 | tieAnomaly |
| 55 | 4/4 | 120 | E | C#4 /F#5 | C#4 A4 | outOfRange,tieAnomaly |
| 56 | 4/4 | 120 | Dmaj7 |  | D3 E4 | noSkeleton,tieAnomaly |
| 57 | 4/4 | 120 | Dmaj7 |  | A3 | outOfRange,noSkeleton,tieAnomaly |
| 58 | 4/4 | 120 | Dmaj7 | G#5 /A5 \G#4 | E3 F#4 | outOfRange,tieAnomaly |
| 59 | 4/4 | 120 | Dmaj7 | A4 \B3 /C#5 \D4 | C#4 E3 A3 | outOfRange,tieAnomaly |
| 60 | 4/4 | 120 | Dmaj7 | A5 \G#4 /F#5 | E3 F#3 | outOfRange,tieAnomaly |
| 61 | 4/4 | 120 | C#m7 | C#4 /A5 | G#3 D3 B3 | outOfRange,tieAnomaly |
| 62 | 4/4 | 120 | E | G#4 /E6 \F#5 | E3 G#3 B3 | outOfRange,tieAnomaly |
| 63 | 4/4 | 120 | Dmaj7 |  | D3 E3 G#5 | outOfRange,noSkeleton,tieAnomaly |
| 64 | 4/4 | 120 | Esus2 | F#5 |  | outOfRange,tieAnomaly |
| 65 | 4/4 | 120 | F#m7 | A4 /C#5 \B4 /C#5 | A3 E3 | tieAnomaly |
| 66 | 4/4 | 120 | F#m7 |  | G#3 E3 D3 | tieAnomaly |
| 67 | 4/4 | 120 | A | A4 \E4 | A2 F#4 | tieAnomaly |
| 68 | 4/4 | 120 | Dmaj7 | F#5 \G#3 | C#3 D3 | outOfRange,tieAnomaly |
| 69 | 4/4 | 120 | F#m7 | C#5 \F#2 | F#3 | tieAnomaly |
| 70 | 4/4 | 120 | Dsus2 | E4 \D3 | B4 E3 | tieAnomaly |
| 71 | 4/4 | 120 | Bsus4 | F#5 \E5 | F#3 | outOfRange,tieAnomaly |
| 72 | 4/4 | 120 | Dmaj7 | B4 \A3 /B4 \A4 | D4 E4 E2 E3 | outOfRange,tieAnomaly |
| 73 | 4/4 | 120 | F#m7 |  | E3 | tieAnomaly |
| 74 | 4/4 | 120 | Esus4 | B4 \E3 /E4 | F#3 | tieAnomaly |
| 75 | 4/4 | 120 | Dmaj7 | B3 /E5 \D4 | C#3 | outOfRange,tieAnomaly |
| 76 | 4/4 | 120 | E | B4 \A4 | E2 F#2 | tieAnomaly |
| 77 | 4/4 | 120 | E7 |  | E2 D3 E3 | noSkeleton,tieAnomaly |
| 78 | 4/4 | 120 | Esus4 | B4 \A4 /F#5 | B2 | outOfRange,tieAnomaly |
| 79 | 4/4 | 120 | D |  | D3 E4 | outOfRange,noSkeleton,tieAnomaly |
| 80 | 4/4 | 120 | E | C#5 \C#4 /E6 | F#2 G#3 | outOfRange,tieAnomaly |
| 81 | 4/4 | 120 | Esus4 | E5 \E2 /D4 \C#4 | D3 | tieAnomaly |
| 82 | 4/4 | 120 | Bm7 | G#3 \D3 | E3 C#3 | tieAnomaly |
| 83 | 4/4 | 120 | F#m7 | C#5 | E3 F#2 | tieAnomaly |
| 84 | 4/4 | 120 | Amaj7 | G#4 /E6 \A3 | C#4 D3 | outOfRange,tieAnomaly |
| 85 | 4/4 | 120 | Bsus4 |  | F#3 | noSkeleton,tieAnomaly |
| 86 | 4/4 | 120 | A | A3 \F#3 /E5 | A2 | tieAnomaly |
| 87 | 4/4 | 120 | Amaj7 | C#5 \C#4 /F#5 \G#3 /C#5 | F#3 B4 B2 | outOfRange,tieAnomaly |
| 88 | 4/4 | 120 | Bm7 | E5 \A3 /D5 | E3 | tieAnomaly |
| 89 | 4/4 | 120 | Amaj7 | F#4 /E5 | C#3 | tieAnomaly |
| 90 | 4/4 | 120 | A | A4 /E5 \B4 | B2 | tieAnomaly |
| 91 | 4/4 | 120 | Bm7 | C#5 | G#3 E3 | tieAnomaly |
| 92 | 4/4 | 120 | C#m7 | D5 \C#4 | C#3 | tieAnomaly |
| 93 | 4/4 | 120 | A |  | A2 D3 E3 | noSkeleton,tieAnomaly |
| 94 | 4/4 | 120 | Amaj7 | C#4 /C#5 | B2 | tieAnomaly |
| 95 | 4/4 | 120 | Bm7 | C#5 | D3 | tieAnomaly |
| 96 | 4/4 | 120 | Amaj7 | F#4 /E5 | C#4 C#3 G#3 | tieAnomaly |
| 97 | 4/4 | 120 | A | D4 /D5 \B4 | B2 | tieAnomaly |
| 98 | 4/4 | 120 | Bm7 | C#5 | E4 D3 | tieAnomaly |
| 99 | 4/4 | 120 | C#m7 | D5 \B4 | C#3 | tieAnomaly |
| 100 | 4/4 | 120 | Amaj7 |  |  | noSkeleton |
| 101 | 4/4 | 120 | E | E4 /B4 =B4 | E3 F#3 F#4 C#4 | tieAnomaly |
| 102 | 4/4 | 120 | Dmaj7 | E5 | D3 | tieAnomaly |
| 103 | 4/4 | 120 | C#m7 | F#4 /A4 \G#3 | C#3 | tieAnomaly |
| 104 | 4/4 | 120 | C#m7 | G#4 \A3 /F#4 \B3 |  | tieAnomaly |
| 105 | 4/4 | 120 | Dmaj7 | A4 /B4 \G#4 | E4 C#4 E3 | tieAnomaly |
| 106 | 4/4 | 120 | Dmaj7 |  | F#3 | outOfRange,noSkeleton,tieAnomaly |
| 107 | 4/4 | 120 | F#m |  | A4 | noSkeleton,tieAnomaly |
| 108 | 4/4 | 120 | A |  |  |  |

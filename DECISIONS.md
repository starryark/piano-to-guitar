# DECISIONS — scope log for the Piano-to-guitar knowledge base

> Living log. Every scope decision — what we **added**, what we found **already
> covered**, and what we **rejected** — is recorded here so the same proposals stop
> recurring. The bar for inclusion is *significant positive impact on the tab a coding
> agent produces*. When in doubt, reject with a reason and a citation.

This project's output format is **AlphaTex fretted notation**: `fret.string.duration`
integers + effects. No microtones, no prepared-guitar tokens, no stereo/pan/delay/reverb,
no magnet/scale-length/capacitance parameters. Gain is exactly three values: `high | crunch |
clean`. Tuning doctrine: **standard E** is the target; a closed set of alternates (Drop D,
Drop C, DADGAD, E♭, and — slide-only — Open G, Open D) is allowed only with written
justification (`reference/tunings.md`).

A proposal belongs here if it came up in an audit/report and was either added, found covered,
or rejected. Each rejection ties to a **concrete format or tool constraint** — never just
"not useful."

---

## ADDED — genuine gaps that became reference content

Filled in by the Wave-1 delta author (see entries below as they land).

| Delta | Doc / section | Why it earned inclusion |
|---|---|---|
| 12-bar blues loop schema + "dominant-7 is stable blues color" rule | `theory-composition.md` — Progressions (rock/metal subset) | A named schema the agent can drop into a plan; the dominant-7 stability rule reverses the usual tension→resolution intuition under blues tonality. |
| Metal scale pitch formulas (double-harmonic, octatonic/diminished, Locrian) | `theory-composition.md` — minor-scale table / modal colour | Already-referenced colours whose pitch formulas were never given. |
| 3+3+2 "pop clave" rhythm cell | `rock-riff-construction.md` — Devices catalogue | Proven in this corpus (Canon Rock outro, bars 142–150); a named device with an AlphaTex shape. |
| Open G, Open D tuning rows | `tunings.md` — tuning table | Standard, well-known spellings; both carry slide-only / "not for fretted solo arranging" caveats so they expand the reference without weakening the standard-is-target doctrine. |

---

## COVERED — already owned by a reference doc, do not re-derive

When a report re-derives one of these, point at the owning doc instead.

| Topic | Owning reference doc | Notes |
|---|---|---|
| IMD / power-chord physics / intermodulation distortion | `electric-guitar-voice.md` — "Why distortion forbids low thirds" | Full IM-product derivation + interval table. Enforced by `tools/playability.mjs`. |
| CAGED position map | `guitar-fretboard.md` — "CAGED position map" | Concrete tiling. |
| Double-stop 3rds & 6ths geometry | `guitar-fretboard.md` — "Double-stop 3rds and 6ths" | Crossing G–B offset table. |
| G→B string asymmetry (+4, not +5) | `guitar-fretboard.md` | The one interval-shift exception; do not key logic off string/voice index. |
| Harmonics (natural nodes 5/7/12/19; pinch) | `electric-guitar-voice.md` — "Expressive vocabulary" | Natural-harmonic frets gated by `playability.mjs`. |
| Gallop rhythm | `rock-riff-construction.md` — Devices catalogue | Named device with AlphaTex shape. |
| Gain doctrine (high / crunch / clean) | `electric-guitar-voice.md` — "Gain and its consequences" | Closed enum, enforced in `check.mjs` / `playability.mjs`. |
| Tuning closed set + "needs a stated justification" rule | `tunings.md` | Standard E default; Drop D, E♭, Drop C, DADGAD, and — slide-only — Open G / Open D. |
| Quarter-step bend/whammy (`{b}`/`{tb}`) and their limits | `alphatex-language.md` | 4 quarter-steps = whole step; strings 1–3, fret ≥ 5. |

---

## REJECTED / OUT-OF-SCOPE — do not re-propose

Each entry cites the **concrete constraint** that kills it, not a vague judgment. (These
topics were raised by three research reports that have since been removed from the repo
after audit — their distilled verdicts live here and nowhere else. The reports are not
reinstatable and need not be; each rejection below stands on its own cited constraint.)

### Hardware & organology physics — 100% un-actionable
Pickup transduction, Faraday/RLC equivalent circuits, eddy currents, **Alnico II/V vs
Ceramic** magnet compositions, cable capacitance / loading networks, **scale length &
inharmonicity coefficient B**, baritone/bass necessity.
- **Reason:** no tool parameter consumes any of it. The only instrument controls are the
  MIDI `\instrument` program and the three-value `--gain`. No pickup-type, magnet-material,
  inductance, or scale-length field exists in `tools/` or `reference/`.
- **Killed by:** `tools/playability.mjs` / `tools/check.mjs` gain enum; doctrine at
  `reference/electric-guitar-voice.md:76-80`.

### Audio production & spatialization
**Haas** stereo effect, **Larsen** acoustic feedback, **reverse-reverb** envelope shaping,
**hexaphonic** processing, **pitch-to-MIDI tracking** (zero-crossing / autocorrelation / FFT
/ HPS) and the **Gabor uncertainty** latency limit.
- **Reason:** the repo writes a single-track **offline** AlphaTex score; it is not a
  real-time controller or a mixer. There is no stereo-pan, no per-string routing, no delay/
  reverb, no latency parameter, and no AlphaTex token for any of these.
- **Killed by:** output format (fret.string.duration + effects only); no token in
  `reference/alphatex-language.md`.

### Microtonality
Just intonation, EDO systems (19/24/31-EDO), quarter-tone frets, **fretless / defretted**
guitars, microtonal bending on adjustable fretboards.
- **Reason:** integer 12-TET frets cannot express pitches between semitones. The only
  sub-semitone control is the bend/whammy token, and its values are quarter-steps (4 = whole
  step), gated to strings 1–3.
- **Killed by:** `reference/alphatex-language.md:193,208,251`; `tools/playability.mjs:50,276-279`.

### Alternate / symmetrical tunings beyond the closed set
All-fourths, New Standard (fifths), FACGCE / DAEAC♯E open diatonics.
- **Reason:** outside the closed tuning set; the doctrine explicitly rejects them ("'It
  sounds heavier' is never a reason"). They break every learned CAGED/double-stop shape.
- **Killed by:** `reference/tunings.md:8-13,62-70` (the closed set + the "needs a stated justification" rule).

### Prepared guitar & third-bridge / multiphonics
Alligator clips, erasers, paperclips, coins on the strings; third-bridge/screwdriver
multiphonics; continuous-pitch envelope destruction.
- **Reason:** no notation token; `playability.mjs` models only a finite mechanical set
  (fret range, adjacent-string pick reach, span, sustain, bend, palm-mute, harmonic node,
  position-jump, hammer-pull span, pick-speed).
- **Killed by:** output format; `tools/playability.mjs` (absence of any preparation model).

### Out-of-scope genre devices
- **Jazz Drop-2 / Drop-3 / shell / tritone-sub / bebop** voicings — gain-incompatible
  (dense extended chords smear under distortion) and breach the density budget. Killed by
  gain doctrine + density budget (`reference/piano-to-guitar-arranging.md`).
- **Everett's six tonal systems** — analytical taxonomy, not a generative rule the agent
  can act on. Killed by the inclusion bar (no measurable effect on a fretted tab).
- **SRDC / AAB song form** — the agent arranges *pre-sectioned* source material; it does not
  author song architecture. Killed by scope (arranging, not composing form).
- **Neo-soul Dilla swing** — un-notatable micro-timing feel. Killed by output format (no
  swing/groove token; durations are power-of-two).
- **Country technique zoo** (chicken pickin', banjo rolls, Travis picking, pedal-steel
  bends) — no AlphaTex tokens for hybrid-picking rolls or steel glissando. Killed by output
  format.

### Polyrhythm / polymeter / metric modulation
Mostly marginally expressible (a `tu N` tuplet token exists), but the forms that matter here —
avant-garde **ametric timeline notation in absolute seconds** and **feathered beaming** —
have no token. More importantly, the agent **reduces** rather than preserves phase
music when arranging a piano score to a flatpick solo — no measurable positive impact.
- **Killed by:** inclusion bar; output format (power-of-two durations, no ametric timeline).

---

## DEFERRED — potentially useful, parked until cheap

*None currently.* (Open G / Open D were candidates but were added — see ADDED above.)

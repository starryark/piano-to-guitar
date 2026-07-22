# Piano-to-guitar — handoff to a cold-context orchestrator (WP2b + WP3 done)

> **You are picking this up with no prior context. Everything you need is in this file.**
>
> **Earlier handoffs.** A predecessor handoff document once lived in this repo but has been
> **removed** — its superseded sections (the original §0.1 "open defect", the deleted
> abcjs/Python stack) were stale, and its still-useful content now lives in stronger
> artifacts:
> - **§0.1 vacuous-gate defect + fix** → `CLAUDE.md` §A.2 (full); summary in §0.1 below.
> - **§2 measured corpus facts** (57 bars, D-major/B-minor, pcset width 6.33→2.65) →
>   **pinned by passing tests** in `tools/lib/analysis.test.mjs` and `tools/smoke.mjs`
>   (they FAIL if a fact drifts) — do not re-derive them.
> - **§0.2 parse traps** (literal TAB, AT205 chord-effects, quarter-step bends, power-of-two
>   durations, inverted string numbering) → `reference/alphatex-language.md` "Gotchas"; the
>   two workflow-critical traps are restated in §0.2 below.
> - **§4 API surfaces / tool state** → §A below (layout + the commands that pass today).
> - **§5 work-package specs (WP4/WP6/WP7)** → §B below; the self-contained subagent prompts
>   in §C carry everything a worker needs.
>
> **Status: WP2b and WP3 are done, verified, on disk, green.** §A tells you exactly what
> exists and what command proves it. §B is the remaining work (WP4, WP6, WP7), decomposed
> into subagent chunks with self-contained prompts in §C.
>
> **Do NOT re-derive the corpus facts, and do NOT re-do §0.1.** §0.1's blocking defect is
> FIXED. If your probe disagrees with a fact here, probe again — but the written fact was
> measured by independent parties and is now pinned by a test that passes today (§0.1, §A).

---

## §0 — What changed since the original handoff

### 0.1 The blocking defect is FIXED (was: "the fidelity gate is nearly vacuous")

**Status: CLOSED by WP2b. Measured, not asserted. Pinned by tests.** WP2b narrowed per-bar
`harmony.pcset` to the primary half-bar's harmonic stratum: mean width **6.33 → 2.65**,
**0 bars at 7 pcs**, roots `A F# D G …` reproduced exactly (0 violations across all 792
bars), coverage 57/57. **Do not widen the pcset back / do not re-tune the chord table** —
the chord table was never the problem, the window was; the width-bound test in
`analysis.test.mjs` FAILS if it re-widens. See `CLAUDE.md` §A.2 for the full fix, the
width-bound test, and the anti-acceptance clause.

### 0.2 The traps that will silently corrupt your work — STILL ALL LIVE

The full catalogue of AlphaTex-parse traps (literal TAB characters, AT205 chord-effects,
quarter-step bend values, power-of-two durations, inverted `\note.string` numbering, the
`\staff { score }`-needs-`\track` rule) lives in `reference/alphatex-language.md`
"Gotchas" — read it. The two workflow-critical traps that matter most for WP4
(documentation) and WP7 (arranging):

1. **`fromAlphaTabNote` on a pitched note returns plausible garbage.** Pitched notes carry
   `string === -1`. Source side reads `note.realValue`. Tab side (fretted) reads string/fret.
2. **`0/0` is a PASS** — both compare gates are `covered === total`, trivially true at 0, so
   always assert non-zero totals. See `.claude/skills/piano-to-guitar/gate-templates.md`
   (§0.1 was the subtler form; now fixed).

### 0.3 What WP3 changed in the tool surface

- **`tools/midi.mjs`** was cut from 542 → 102 lines: the ABC branch (abcjs), the
  `--backing` two-track mode, and `--force` are all GONE. It is now a single
  AlphaTex→MIDI exporter serving **both** the piano source and the guitar tab. `.abc`
  input is rejected (exit 1). One dependency: `@coderline/alphatab`.
- **`tools/check.mjs`** line ~113 and **`tools/compare.mjs`** line ~573: the missing-digest
  hints were reworded from `python tools/abc-extract.py …` to
  `node tools/piano-extract.mjs …`. No functional change to either tool's gate logic.
- **`package.json`** `"test"` now runs all three suites: fretboard + analysis + piano-source.
- **`tools/smoke.mjs`** is NEW (song-neutral, 7 checks, `SMOKE: PASS`). **`tools/fixtures/`**
  has 8 fixtures. Both are committed.

---

## §A — Current state on disk (verified, post-WP3)

Everything below was run and observed. **Run §A.3 yourself before starting WP4** to confirm
the baseline is green on your machine.

### A.1 Layout

```
<repo-root>\
├─ package.json          type:module; dep @coderline/alphatab ^1.5.0 ONLY
│                        "test" = fretboard + analysis + piano-source
│                        "smoke" = node tools/smoke.mjs
├─ .gitignore            node_modules/ out/ analysis/* source/*  (git init, NO commits yet)
├─ CanonRock/            the corpus — READ-ONLY, mtimes unchanged
├─ analysis/             gitignored outputs (canon-in-d-hard.json + map; CR1.json + map)
├─ reference/
│   └─ case-canon-rock.md          876 lines  [WP5, DONE]  — DO NOT TOUCH, only cross-link
├─ .claude/skills/piano-to-guitar/  [WP6, DONE] — SKILL.md + gate-templates.md
├─ CLAUDE.md / README.md            [WP6, DONE]
├─ HANDOFF.md                       THIS FILE
└─ tools/
    ├─ lib/score-utils.mjs       86   vendored
    ├─ lib/fretboard.mjs        329   vendored
    ├─ lib/fretboard.test.mjs   355   vendored  (30/30)
    ├─ lib/piano-source.mjs     787   [WP1]  AT218 normalizer + staff-kind + key inference
    ├─ lib/piano-source.test.mjs 368  [WP1]  27/27 — NOW wired into npm test
    ├─ lib/analysis.mjs        ~1390  [WP2 + WP2b]  +harmonySpans, narrowed pcset
    ├─ lib/analysis.test.mjs   ~920   [WP2 + WP2b]  76/76 — incl. width-bound + harmonySpans
    ├─ piano-validate.mjs        436  [WP1]
    ├─ piano-extract.mjs         128  [WP2]
    ├─ validate.mjs              107  vendored
    ├─ playability.mjs           366  vendored
    ├─ compare.mjs               630  vendored (ABC hint reworded only)
    ├─ check.mjs                 341  vendored (ABC hint reworded only)
    ├─ midi.mjs                   98  [WP3]  was 542 — ABC/backing/--force deleted; single AlphaTex→MIDI exporter
    ├─ smoke.mjs                 235  [WP3]  NEW — 7 checks
    └─ fixtures/                          [WP3]  8 fixtures (committed)
        ├─ at218-pitched-rest.alphatab    3 rewrites contract
        ├─ chaconne-excerpt.alphatab      8 bars, roots A F# D G A F# D G
        ├─ key-lie-ks-c-sounds-D.alphatab declared C, sounds D
        ├─ broken-syntax.alphatab         4 parse errors
        ├─ overfull-voice.alphatab        5 beats in 4/4
        ├─ non-adjacent-dyad.alphatab     strings 2,6
        ├─ e2e-tab.alphatab               8-bar fretted chaconne bass
        └─ e2e-sidecar.json               2-entry map
```

### A.2 Commands that pass today (run §A.3 to confirm)

```bash
cd <repo-root>

npm test                                   # -> 30/30 + 76/76 + 27/27, exit 0
npm run smoke                              # -> SMOKE: PASS (7 checks), exit 0

node tools/piano-validate.mjs "CanonRock/Canon in D/canon-in-d-easy.alphatab"
#   -> exit 0; exactly 11 rewrites
node tools/piano-extract.mjs "CanonRock/Canon in D/canon-in-d-hard.alphatab"
#   -> 57 bars; melodySkeleton 57/57; harmony.root 57/57; mean pcset width 2.65
node tools/midi.mjs "CanonRock/Canon in D/canon-in-d-hard.alphatab"
#   -> wrote out/canon-in-d-hard.mid (source side renders)
# WP2b width check (the gate against re-widening):
node -e "const d=require('./analysis/canon-in-d-hard.json');const w=d.bars.map(b=>(b.harmony.pcset||[]).length);console.log('mean',(w.reduce((a,b)=>a+b,0)/w.length).toFixed(2),'max',Math.max(...w),'at7',w.filter(x=>x===7).length)"
#   -> mean 2.65 max 4 at7 0
```

### A.3 Baseline check — RUN THIS FIRST

Before touching anything, confirm the above is green. If any line fails, STOP — the
handoff state is wrong and you must reconcile before adding work on top.

---

## §B — Remaining work (WP4, WP6, WP7)

**Dependency graph:** WP4 and WP6 are documentation. **WP6 depends on WP4** (it
cross-links the reference docs and cites their content). **WP7 is the orchestrator +
human** — never a subagent, never self-approved. Do them in order: **WP4 → WP6 → WP7.**

The full specification for each work package is in the §C subagent prompts below (they are
self-contained — each worker gets everything it needs). The summaries here add only what
changed (the ABC-removal constraint, the corpus-fact corrections) and point to §C.

### WP4 — Craft reference library port (do this next)

Port `abc-to-guitar/reference/` (9 docs, 2128 lines) into `Piano-to-guitar/reference/`.
**[DONE]** — `reference/` now holds 10 docs / ~3229 lines (the 9 ports + the pre-existing
`case-canon-rock.md`, which is **already there — do not touch it**, only cross-link it).

**Files and treatment (from original §5 WP4):**
- **Verbatim (zero ABC content, fix cross-links only):** `electric-guitar-voice.md`,
  `rock-riff-construction.md`, `guitar-fretboard.md`, `guitar-playability.md`,
  `theory-composition.md`, `tunings.md`.
- **`alphatex-language.md`** — port, then extend with source-side needs: pitched (`score`)
  vs fretted (`tabs`) staves, `\staff`, multi-staff/multi-voice piano notation, `\ks`,
  `\clef`, `{beam …}`/`{lf …}` decorations. **Preserve the Gotchas section wholesale.** Add:
  `\staff { score }` needs a preceding `\track` (§0.2 trap 8).
- **`alphatex-piano-reading.md`** — NEW, replacing `abc-reading.md`. How to read a piano
  source in AlphaTex: pitched/fretted, multi-staff RH/LH, staff-global voice numbering,
  and **reading the extractor's bar map instead of the raw file**.
- **`piano-to-guitar-arranging.md`** — port craft sections **unchanged** (Range reality,
  reduction ladder, Re-metering, translation table, Arpeggio ballads, Density budget,
  Transposition procedure). Then **replace two sections**: "What to deliberately discard"
  (ABC row list → the AlphaTex engraving directives in the corpus) and "MuseScore export
  hazards" → **"AlphaTex piano-export hazards"** (each with a one-line check).

**Hard constraint (original §5 WP4):** every ABC reference must be GONE. Grep for `abc`,
`!ped!`, `!arpeggio!`, `8va`, `abc2xml`, `abcjs`, `[K:`, `[M:`, `[Q:`, `V:1`, `V:2` and
resolve every hit. **Preserve the musical content when the surrounding ABC example is
deleted** — translate the example to AlphaTex, don't drop the row.

**Note (corpus-fact correction):** the Transposition procedure section carries NO corpus
evidence — §2.2 fact 1 was corrected: **all six files are D major / B minor, no
transposition.** Keep the transposition craft (it's real guitar knowledge) but do NOT cite
CanonRock for it; mark it as craft not derived from this corpus.

### WP6 — Skill, CLAUDE.md, README (after WP4 + its evaluator pass)

Model on `abc-to-guitar/.claude/skills/abc-to-guitar/` (SKILL.md 166 + gate-templates.md
146) and `abc-to-guitar/CLAUDE.md` (15259 bytes) / `README.md` (8517 bytes). The full WP6
spec is the §C.2 subagent prompts below (W6-A, W6-B, E6).

- **`.claude/skills/piano-to-guitar/SKILL.md`** — frontmatter `name: piano-to-guitar`,
  `allowed-tools: [Read, Write, Edit, Glob, Grep, "Bash(node tools/*)"]` (**no Python**).
  Carry the seven non-negotiable rules, reference task table, Step 0 / Gate A / Gate B /
  Final workflow. Two changes: Step 0 = `piano-validate.mjs` → `piano-extract.mjs` → source
  `midi.mjs`; and **the span sidecar is mandatory** (§2.2 fact 3 — a cover expands 2–4×),
  so `check.mjs --map <sidecar>` is THE gate command and `--bars N-M` is debugging only.
- **`gate-templates.md`** — port Gate A plan / Form plan / Groove plan / Gate B / `PROPOSAL:`
  templates. The transposition table is **craft, not corpus-derived** (§2.2 fact 1
  corrected); provide it marked as such, note every corpus file stayed in D.
- **`CLAUDE.md`** — orientation. Delete the old abcjs-bug sections. Replace with: the AT218
  hazard (the `-1.<str>.<dur>` pitched-rest bug; the normalizer rewrites it) and **the §0.1
  vacuous-gate hazard + its width bound (now FIXED — document the fix, not the defect)**.
  Carry the Step 0 table, tool exit contracts, digest contract (top-level + per-bar keys
  including the new `harmonySpans`), fail-open warning, playability exit-code caveat,
  recomposition doctrine. State vendoring provenance (`abc-to-guitar@ba7e29c`).
- **`README.md`** — human quickstart: Node + one dep, `npm test` / `npm run smoke`, the
  arrange-a-piece walkthrough, what-lives-where, hard-won-learnings seeded from §2.

**Non-negotiable:** the two gates and the human-supervision loop ARE the point. Port them
faithfully. Never weaken *"no tab is shown to the human until `check.mjs` passes."*

### WP7 — First real job (orchestrator + human; NOT a subagent)

Arrange `CanonRock/Canon in D/canon-in-d-hard.alphatab` into an electric-guitar rock tab,
running the shipped workflow exactly as a user would. **Human-gated — the orchestrator does
not self-approve.** The 5-step flow is: Step 0 ingest → Gate A plan →
Gate B per-chunk → Final assemble → feed defects back as fixtures. **The corpus gives no
transposition precedent — all six files are in D.** Budget for the source's 18% out-of-range
notes.

---

## §C — Subagent decomposition (with cross-evaluation)

The remaining work is documentation-heavy and parallelizable. **Do not do it all in one
session.** Dispatch subagents with the self-contained prompts below, then dispatch evaluator
agents that critically check the workers' output. Reconcile, then proceed.

### C.1 WP4 — three parallel workers + one evaluator

WP4's nine files are independent on disk, so run the three workers **in parallel** (single
message, three `Agent` calls). The evaluator runs **after all three complete**.

#### Worker W4-A — "Verbatim Porter" (6 docs)

**Prompt to give the subagent:**
```
You are porting 6 reference docs VERBATIM from a sibling repo into this one. Zero
musical-content changes — only fix cross-links and remove any ABC residue.

SOURCE: <sibling-repo>/abc-to-guitar\reference\
DEST:   <repo-root>\reference\

Copy these 6 files byte-for-byte, then in EACH fix only:
  1. Any internal link pointing at another reference doc — keep the relative path (the
     destination filenames are preserved: electric-guitar-voice.md, rock-riff-construction.md,
     guitar-fretboard.md, guitar-playability.md, theory-composition.md, tunings.md,
     alphatex-language.md, alphatex-piano-reading.md, piano-to-guitar-arranging.md,
     case-canon-rock.md).
  2. Grep each file for ABC residue: `abc`, `!ped!`, `!arpeggio!`, `8va`, `abc2xml`,
     `abcjs`, `[K:`, `[M:`, `[Q:`, `V:1`, `V:2`. If a hit is pure ABC notation that has
     NO AlphaTex equivalent in scope, flag it for the evaluator rather than guessing —
     these 6 are supposed to be ABC-free already, but verify.
  3. Do NOT touch musical content, examples, tables, or prose. If you are tempted to
     "improve" wording, stop — verbatim means verbatim.

Files: electric-guitar-voice.md, rock-riff-construction.md, guitar-fretboard.md,
guitar-playability.md, theory-composition.md, tunings.md.

Report: for each file, the byte count (source vs dest must match ± cross-link edits) and
any ABC-residue hits you found.
```

#### Worker W4-B — "AlphaTex Spec Author" (2 docs)

**Prompt to give the subagent:**
```
You are writing the AlphaTex language reference for THIS project (a piano-score-to-guitar
pipeline). Two files in <repo-root>\reference\:

FILE 1: alphatex-language.md
  Port from <sibling-repo>/abc-to-guitar\reference\alphatex-language.md (156
  lines), then EXTEND with what the SOURCE side (piano input) needs:
    - pitched (`score`) vs fretted (`tabs`) staves — \staff { score } vs \staff { tabs }
    - \staff, multi-staff and multi-voice piano notation (RH/LH on separate staves)
    - \ks (key signature — REPORTED by the extractor but never trusted; see corpus fact:
      Canon Rock 1 declares \ks c while sounding D)
    - \clef (g2 treble, f4 bass)
    - {beam …} / {lf …} decoration directives that exporters emit
  PRESERVE THE GOTCHAS SECTION WHOLESALE (it is hard-won): inverted string numbering
  (\note.string === 1 is the LOW E in the parse tree), tuplets breaking bar math, note
  effects inside chord parens (AT205), quarter-step bend values, power-of-two durations,
  never emit a literal TAB. ADD this gotcha: a `\staff { score }` block is rejected unless
  a `\track` precedes it (AlphaTex error AT205).

FILE 2: alphatex-piano-reading.md  (NEW — replaces abc-reading.md)
  How to read a piano source written in AlphaTex:
    - pitched vs fretted staff detection (the extractor's staff-kind logic; a -1 fret is
      excluded from fretted evidence — that is what lets canon-in-d-easy resolve)
    - multi-staff RH/LH layout, and that piano voice indices are STAFF-GLOBAL (staff 0 uses
      voices 0-3, staff 1 uses voices 4-7 in canon-in-d-hard) — never key logic off a voice
      or staff index, use sounding register
    - READ THE EXTRACTOR'S BAR MAP (analysis/<stem>-map.md), NOT the raw .alphatab file.
      The raw file has exporter artifacts (AT218 -1.N tokens, {beam} decorations) that the
      normalizer fixes in memory; the map is the truth.

Hard constraint: zero ABC residue (grep `abc`,`abcjs`,`abc2xml`,`[K:`,`[M:`,`[Q:`,`V:1`,`V:2`).
Cross-link case-canon-rock.md and the other reference docs by relative path.
Report: the two file paths, line counts, and confirmation the Gotchas section survived.
```

#### Worker W4-C — "Arranging Craft Porter" (1 doc, the tricky one)

**Prompt to give the subagent:**
```
You are porting the arranging craft reference. One file:
<repo-root>\reference\piano-to-guitar-arranging.md

SOURCE: <sibling-repo>/abc-to-guitar\reference\piano-to-guitar-arranging.md
(392 lines).

STEP 1 — port these craft sections UNCHANGED (they are real guitar knowledge, keep them
byte-faithful): "Range reality", "the reduction ladder", "Re-metering the groove",
"the translation table", "Arpeggio ballads & flatpick playability", "Density budget",
"Transposition procedure".

STEP 2 — REPLACE two sections:
  (a) "What to deliberately discard": the ABC row list becomes the AlphaTex engraving
      directives ACTUALLY present in this corpus: {beam Down}, {lf N}, \systemsLayout,
      \bracketExtendMode, \hideDynamics, \otherSystemsTrackNameOrientation, \copyright,
      \simile, \ottava. For each, one line on what it is and that it is stripped at ingest.
  (b) "MuseScore export hazards" → rename to "AlphaTex piano-export hazards". Each hazard
      gets a one-line CHECK the arranger can run. The hazards (all real, all in the corpus):
        - AT218 pitched/fretted mix (-1.<str>.<dur> tokens in a pitched staff where a rest
          belongs; 11 of them in canon-in-d-easy; the normalizer rewrites them). CHECK:
          node tools/piano-validate.mjs <file> — exit 0, "rewrites": N
        - non-ASCII track names with U+00A0 NO-BREAK SPACE (not U+0020): 일렉<NBSP>기타.
          A hand-typed equality match fails. CHECK: never key logic off a track name.
        - a declared \ks that contradicts the sounding key (Canon Rock 1: \ks c, sounds D).
          CHECK: the extractor reports keyDeclared/keyDisagrees; trust the sounding key.
        - tracks whose names and MIDI programs claim an instrument the notation does not
          match (cannon-rock-Piano is 일렉 기타 / electric guitar, not piano). CHECK:
          the input format is "AlphaTex with pitched staves", regardless of the header.
        - staff-global voice numbering (staff 1 of canon-in-d-hard uses voices 4-7).
        - a SECOND \tempo silently overwriting the first (canon-in-d-easy: \tempo 100 then
          \tempo 25 — 25 is what plays). CHECK: never trust the first \tempo directive.
        - bars that overrun their own meter (canon-in-d-hard bar 45: 6 beats in 4/4).
        - empty bars that produce no skeleton (a 2-note melody has no interior contour turn).

STEP 3 — CORRECTION: the "Transposition procedure" section carries NO corpus evidence.
§2.2 fact 1 was independently corrected: ALL SIX corpus files are D major / B minor —
none transposes. KEEP the transposition craft (it is real fretboard knowledge) but add a
note: "This procedure is general craft, NOT derived from the CanonRock corpus — every file
in this corpus stayed in D." Do not cite CanonRock as a transposition example.

Hard constraint: zero ABC residue (full grep list). When an ABC example surrounds real
musical content, TRANSLATE the example to AlphaTex — do not drop the row.

Report: the file path, line count, the two replaced section headers, and any ABC hits you
had to resolve (with how you resolved each).
```

#### Evaluator E4 — "WP4 Critical Audit" (runs after W4-A/B/C all complete)

**Prompt to give the subagent:**
```
You are a critical evaluator. Three worker agents just ported 9 reference docs into
<repo-root>\reference\. Your job is to find what they got
wrong. Be adversarial — assume each worker cut corners.

AUDIT 1 — ABC RESIDUE (the hard constraint). From Piano-to-guitar\reference\, grep EVERY
.md for: abc, !ped!, !arpeggio!, 8va, abc2xml, abcjs, [K:, [M:, [Q:, V:1, V:2. Case-
insensitive where appropriate. EVERY hit is a failure. For each, report file:line and the
surrounding text. The ONLY acceptable ABC string is inside the word "alphatab" or a
legitimate filename — anything else must be resolved.

AUDIT 2 — CONTENT PRESERVATION. For piano-to-guitar-arranging.md, confirm the 7 craft
sections W4-C was told to keep unchanged are actually unchanged (diff against
abc-to-guitar\reference\piano-to-guitar-arranging.md for those sections). Flag any
"improvement" that changed craft content. Confirm the two REPLACED sections exist with the
new headers and the one-line checks.

AUDIT 3 — CORPUS-FACT CONSISTENCY. The docs must NOT claim the corpus transposes (§2.2
fact 1, corrected: all six files are D). Grep for "Canon in E", "transposition", "key of E"
and verify each mention is either (a) general craft marked as non-corpus-derived, or
(b) correctly absent. Flag any claim that CanonRock evidence supports a transposition.

AUDIT 4 — CROSS-LINKS. Every relative .md link in every ported doc must resolve to a file
that exists in Piano-to-guitar\reference\. Broken links are failures. case-canon-rock.md
must be cross-linked, not duplicated.

AUDIT 5 — GOTCHAS. alphatex-language.md MUST still carry the Gotchas section (inverted
string numbering, tuplet bar math, AT205 chord effects, quarter-step bends, power-of-two
durations, no literal TAB) PLUS the new \staff{score}-needs-\track gotcha.

Report: a PASS/FAIL per audit, with file:line evidence for every failure. Do NOT fix
anything — only report. The orchestrator reconciles.
```

**Orchestrator action after E4:** fix every E4 failure (or have the responsible worker
re-run with the specific failure list). Re-run E4's grep audits until clean. Only then
proceed to WP6.

### C.2 WP6 — two workers + one evaluator (sequential after WP4 passes E4)

#### Worker W6-A — "Skill Author" (SKILL.md + gate-templates.md)

**Prompt to give the subagent:**
```
You are writing the project skill — the gated workflow an arranging agent follows. Two
files under <repo-root>\.claude\skills\piano-to-guitar\:

MODEL ON: <sibling-repo>/abc-to-guitar\.claude\skills\abc-to-guitar\ (SKILL.md
166 lines, gate-templates.md 146 lines). The full WP6 spec is in §B WP6 and §C.2 below.

FILE 1: SKILL.md
  frontmatter:
    ---
    name: piano-to-guitar
    description: Arrange a piano score written in AlphaTex into a playable solo
      electric-guitar rock tab in AlphaTex, behind a two-gate human-supervised workflow.
    allowed-tools: [Read, Write, Edit, Glob, Grep, "Bash(node tools/*)"]
    ---
  (NO Python — there is none in this project.)
  Body: the seven non-negotiable rules, the reference task table (point at reference/*.md),
  and the workflow: Step 0 (ingest) / Gate A (plan, human approval) / Gate B (per-chunk ≤8
  bars, human audition) / Final (assemble + full check). TWO CHANGES from the abc version:
    - Step 0 becomes: piano-validate.mjs <source> → piano-extract.mjs <source> →
      midi.mjs <source> (renders the reference recording).
    - THE SPAN SIDECAR IS MANDATORY, not optional. A cover expands 2-4x (§2.2 fact 3:
      57 source bars → 210 tab bars), so `check.mjs <tab> --map <sidecar>` is THE gate
      command. `--bars N-M` is a debugging fallback only.

FILE 2: gate-templates.md
  Port the Gate A plan template, Form plan template, Groove plan template, Gate B
  presentation template, and the PROPOSAL: template. CORRECTION: the original asked for a
  transposition table "worked in the corpus's own terms" — that evidence does NOT exist
  (§2.2 fact 1: all six files are D). Provide the transposition table as general guitar
  CRAFT, explicitly marked "not derived from the CanonRock corpus — every file stayed in D."

NON-NEGOTIABLE: the two gates and the human-supervision loop ARE the point of this project.
Port them faithfully. The skill must say, verbatim in effect: "no tab is shown to the human
until check.mjs passes." Do not weaken this.

Report: both file paths, line counts, and the exact wording of the mandatory-sidecar rule.
```

#### Worker W6-B — "Orientation Author" (CLAUDE.md + README.md)

**Prompt to give the subagent:**
```
You are writing project orientation for <repo-root>\. Two
files. MODEL ON abc-to-guitar\CLAUDE.md (15259 bytes) and abc-to-guitar\README.md (8517
bytes). Read HANDOFF.md §A (current state), §0.1 (the FIXED defect), §0.2 (traps), and §B/§C
WP6 (the full spec).

FILE 1: CLAUDE.md (agent orientation)
  - DELETE the old abcjs-bug sections entirely (they cannot occur here — no ABC, no abcjs).
  - REPLACE with TWO hazards, documented as RESOLVED-with-caveats:
    (a) The AT218 hazard (§2.3: -1.<str>.<dur> in pitched staves; the normalizer rewrites
        them; 11 in canon-in-d-easy). One-line check: node tools/piano-validate.mjs <file>.
    (b) The §0.1 vacuous-gate hazard AND ITS FIX: per-bar pcset was whole-scale (mean 6.33);
        WP2b narrowed it to the primary half-bar's harmonic stratum (mean 2.65, 0 bars at 7
        pcs). The width-bound test in analysis.test.mjs FAILS if it re-widens. Do NOT widen
        it back; do NOT re-tune the chord table.
  - CARRY OVER: the Step 0 establish-these table; the tool table with exit contracts; the
    digest contract (top-level keys + per-bar keys INCLUDING the new harmonySpans); the
    fail-open warning (0/0 is a PASS — always assert non-zero totals); the playability
    exit-code caveat (playability.mjs exits 1 on errors OR warnings, so check.mjs gates on
    errors[] only); the recomposition doctrine (reduction and addition are both first-class
    and named at the gate).
  - STATE the vendoring provenance: vendored from abc-to-guitar@ba7e29c; upstream fixes
    pulled deliberately; local edits marked `// PTG:`.

FILE 2: README.md (human quickstart)
  - Requirements: Node + ONE dependency (@coderline/alphatab).
  - Commands: npm test (fretboard + analysis + piano-source), npm run smoke (SMOKE: PASS).
  - The arrange-a-piece walkthrough: copy source into source/ → piano-validate →
    piano-extract → read the bar map → Gate A plan → Gate B chunks with check.mjs --map →
    final assemble + A/B the MIDI.
  - The ONE command to remember: node tools/check.mjs <tab> --map <sidecar>.
  - What-lives-where (tools/, reference/, CanonRock/ read-only, analysis/ + out/ gitignored).
  - Hard-won-learnings seeded from the corpus facts (§2): no transposition in this corpus;
    the declared \ks lies; two chords per bar; playability is a hard constraint.

Report: both file paths, line counts, and the exact sentences carrying the fail-open
warning and the playability exit-code caveat.
```

#### Evaluator E6 — "WP6 Critical Audit" (runs after W6-A/B complete)

**Prompt to give the subagent:**
```
You are a critical evaluator. Two workers just wrote the skill + orientation docs. Find
what they got wrong. Be adversarial.

AUDIT 1 — GATE FAITHFULNESS. The two gates (Gate A plan + human approval; Gate B per-chunk
+ human audition) and the human-supervision loop are THE POINT. Confirm SKILL.md carries
both, with the human-approval step as a hard stop (not advisory). Confirm the line "no tab
is shown to the human until check.mjs passes" (in effect) is present and un-weakened.

AUDIT 2 — MANDATORY SIDECAR. Confirm SKILL.md makes `check.mjs --map <sidecar>` THE gate
command and `--bars N-M` explicitly a debugging fallback. A skill that treats --bars as
primary fails (a cover expands 2-4x; bar-locked gates are useless).

AUDIT 3 — §0.1 DOCUMENTED AS FIXED. CLAUDE.md must document the vacuous-gate hazard AND
its fix (mean 6.33 → 2.65, the width-bound test). It must NOT still read as an open defect.
Confirm the "do not widen it back / do not re-tune the chord table" guidance is present.

AUDIT 4 — NO ABC RESIDUE. Grep CLAUDE.md, README.md, SKILL.md, gate-templates.md for the
ABC residue list (abc, abcjs, abc2xml, [K:, [M:, [Q:, V:1, V:2, !ped!, !arpeggio!). The
only acceptable hit is "alphatab". Every other hit is a failure.

AUDIT 5 — CONSISTENCY WITH REALITY. CLAUDE.md's tool table and exit contracts must match
what the tools actually do TODAY (HANDOFF.md §A.1). In particular: midi.mjs takes ONLY
.alphatab (no .abc, no --backing, no --force); the digest contract includes harmonySpans;
npm test runs three suites. Flag any claim that contradicts the shipped tools.

AUDIT 6 — PROVENANCE + FAIL-OPEN. Confirm CLAUDE.md states vendoring from
abc-to-guitar@ba7e29c, local edits marked // PTG:. Confirm the fail-open warning (0/0 is a
PASS, assert non-zero totals) and the playability exit-code caveat (gates on errors[] only)
are both present.

Report: PASS/FAIL per audit with evidence. Do NOT fix — only report.
```

**Orchestrator action after E6:** reconcile failures. Then run §A.3 baseline again (the
docs touch no code, so npm test/smoke must still be green — a regression here means a doc
edit accidentally hit a tool file). Then WP7.

### C.3 WP7 — orchestrator + human (NOT a subagent)

WP7 is the first real arrange job. **Do not delegate it.** Run it yourself, human-gated,
following the shipped SKILL.md (which you just wrote/verified in WP6). The 5-step flow is
in §B WP7 above.
**Feed every defect WP7 exposes back as a fixture** in `tools/fixtures/` with its contract
enforced in `smoke.mjs` — not a note in a session log.

---

## §D — Operating rules for the orchestrator

1. **Run §A.3 first.** If the baseline isn't green, stop and reconcile.
2. **One work package at a time.** WP4 → (E4) → WP6 → (E6) → WP7. Do not start WP6 until
   E4 passes; do not start WP7 until E6 passes and SKILL.md exists (WP7 runs the skill).
3. **Workers in parallel, evaluators after.** Launch W4-A/B/C in one message (three Agent
   calls). Wait for all three. Then launch E4 alone. Reconcile. Repeat the pattern for WP6.
4. **Evaluators are adversarial and read-only.** They report, they do not fix. You fix (or
   re-dispatch the worker with the specific failure list) and re-evaluate.
5. **Verify after every package.** `npm test && npm run smoke` after WP4 (docs touch no
   code, but confirm); same after WP6. WP7's verification is the human's ear — the final
   acceptance criterion is that a human hears Canon in D *and* the guitar together.
6. **`CanonRock/` is READ-ONLY.** Never write to it. Never commit it.
7. **`git init` is done; there are NO commits yet.** Consider a baseline commit before WP4
   so its diff is reviewable. Do not commit unless the user asks.
8. **When a measured fact and your probe disagree, probe again** — but the corpus facts and
   the WP2b numbers in §0.1 were measured by independent parties and are pinned by passing
   tests. Trust them until you have positive evidence they're wrong.

---

## §E — The one-screen summary

| Work package | Status | Owner | Blocked by | Acceptance |
|---|---|---|---|---|
| WP2b (vacuous gate) | **DONE** | — | — | mean 6.33→2.65, 0 bars at 7, tests pin it |
| WP3 (gate wiring) | **DONE** | — | — | SMOKE: PASS (7), npm test 3×green |
| WP4 (reference lib) | **TODO** | W4-A/B/C + E4 | — | zero ABC residue; E4 passes |
| WP6 (skill/CLAUDE/README) | **TODO** | W6-A/B + E6 | WP4+E4 | gates faithful; E6 passes |
| WP7 (arrange canon-in-d-hard) | **TODO** | orchestrator + human | WP6+E6 | human hears Canon + guitar |

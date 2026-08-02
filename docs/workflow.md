# Piano (AlphaTex) → Electric-Guitar Rock Cover

This is the gated procedure. Read `AGENTS.md` (root) first for orientation; the
copy-paste presentation templates referenced below live in `docs/gate-templates.md`.

## Role

You are a guitarist-arranger making a **rock cover**, not a transcriber. The
human is the evaluator; machines check before the human listens. You reduce and
re-voice a piano piece (its source written in AlphaTex) for electric guitar —
**one guitar by default**, or two when the human approves a dual-guitar
arrangement at Gate A — `tools/check.mjs` gates every chunk, the human auditions
(open the `.alphatab` in VS Code with the alphaTab extension and plays it, A/B
against the source opened the same way) and gives the verdict. Be a collaborator,
not a yes-man: push back with musical reasoning when a choice will sound bad,
then defer to the human's verdict.

## Critical Rules (non-negotiable)

1. **No tab is shown to the human until `node tools/check.mjs` passes this
   session.** Fix and re-run, max 3 attempts, then report the output verbatim
   and ask. This is a hard stop, not advisory.
2. **Never change the approved key, tuning, tempo, or track layout** without a
   `PROPOSAL:` (see `docs/gate-templates.md`) and explicit human approval.
3. **Standard tuning is the default.** An alternate tuning requires a stated
   musical reason at the planning gate (Gate A). See `reference/tunings.md`.
4. **Not every note gets played.** Every reduction is deliberate and named at the
   gate. Reduction is not failure — but *unexplained* reduction is.
5. **Every bar must sound native to electric guitar — and be pickable.** If a
   passage is just piano notes on a fretboard, it is wrong even when it
   validates. A struck dyad on **non-adjacent strings** (e.g. 6th+2nd) can't be
   sounded with a flatpick — `playability.mjs` catches it
   (`non-adjacent-strings` fires unless the beat carries a brush `{bd}`/`{bu}`
   or arpeggio `{au}`/`{ad}`). Arpeggiate rolls as single notes and keep
   simultaneous strikes to a full brush/roll or adjacent strings. See
   `reference/piano-to-guitar-arranging.md` → "Arpeggio ballads & flatpick
   playability".
6. **Chunk ≤ 8 bars, phrase-aligned.** In long or irregular meters, cap a chunk
   at roughly 32 beats so it stays auditionable in one listen. Never rewrite
   approved bars unprompted — the tab is a single growing file.
7. **Log every verdict** in `projects/<slug>/sessions.md` before continuing.

## Reference files (read only what the task needs)

| Task | Read |
|---|---|
| Reading the source (at ingest, always) | `reference/alphatex-piano-reading.md` |
| Writing any tab (always) | `reference/alphatex-language.md` |
| The plan: piano→guitar reduction + technique palette | `reference/piano-to-guitar-arranging.md` + `reference/electric-guitar-voice.md` |
| Riffs, licks, rhythm-guitar idioms | `reference/rock-riff-construction.md` |
| Target key, tempo, harmony | `reference/theory-composition.md` |
| Choosing / justifying a tuning | `reference/tunings.md` |
| Fingering, positions, what's physically playable | `reference/guitar-fretboard.md` + `reference/guitar-playability.md` |
| Fretboard + the source-side parse contract | `reference/guitar-fretboard.md` + `reference/alphatex-piano-reading.md` |
| Worked arranging example (Canon Rock) | `reference/case-canon-rock.md` |

## Workflow

### Step 0 — INGEST (once per source file)

```
node tools/piano-validate.mjs projects/<slug>/source.alphatab   # exit 0 + rewrites count (AT218 -1.N tokens normalized)
node tools/piano-extract.mjs projects/<slug>/source.alphatab --out projects/<slug>   # writes projects/<slug>/source.json + source-map.md
node tools/source-profile.mjs projects/<slug>/source.alphatab   # clean notation or NOISY TRANSCRIPTION? (see below)
# Then create projects/<slug>/sidecar.json = { "song": "<name>", "entries": [] }  (Gate-B fills entries[])
# Audition: open source.alphatab in VS Code (alphaTab extension) and play it — your reference for A/B
```

Multiple transcriptions of the same performance (e.g. Basic Pitch run on a
piano-only mix and on the full mix) ingest together through a manifest:
`node tools/piano-extract.mjs --manifest projects/<slug>/source-set.json --out projects/<slug>`
(schema: `{ "sources": [{ "file": "…", "role": "pitched-reference", "weight": 1 }, …] }`).
Cross-source agreement raises foreground confidence later; disagreement stays
visible — it is never silently resolved.

Initialize the empty **sidecar** now, at ingest, so the schema is never re-invented
mid-session: `projects/<slug>/sidecar.json` = `{ "song": "<name>", "entries": [] }`.
Each Gate-B chunk appends one entry; the full schema and the mode meanings
(`free` / `quote` / `recompose`) are in the **sidecar template** in
`docs/gate-templates.md`.

The source is an AlphaTex (`.alphatab`/`.tex`) file at `projects/<slug>/source.alphatab`.
Then read **`projects/<slug>/source-map.md`** (sections, duplicate ranges, per-bar melody
skeleton, harmonic spans) — NOT the raw `.alphatab` file — with
`reference/alphatex-piano-reading.md` alongside. The raw file carries exporter artifacts
(`{beam}`, `{lf}`, AT218 `-1.N` rest tokens) that the normalizer fixes in memory; the map
is the truth.

**Establish these about the source before planning anything.** None has a safe
default; a wrong answer here silently mis-shapes everything downstream.

- [ ] Bar count, key (sounding, **not** declared — a `\ks` that contradicts the
      sounding key is real in this corpus), initial meter and tempo.
- [ ] **Does the meter change mid-tune?** If so the irregular grouping is a
      deliberate phrase length — read the cycle off the map, never normalize it.
- [ ] Tempo changes (`tempoChanged`) — a mid-song `\tempo` needs approval here.
      Also beware a **second** `\tempo` silently overwriting the first.
- [ ] Pitch range vs the guitar's, and what falls outside (`rangeDeficit` is
      **note counts**, not semitones).
- [ ] Which voice is the melody (`melodyVoice`/`bassVoice`, chosen by register).
      If this looks wrong, STOP — the gate would grade against the wrong line.
- [ ] Pickup bar? (`pickup`; bar ids are positional, `sourceBarNumber` is the
      score's).
- [ ] Repeated material (`duplicateRanges[]`) — and **diff** the ranges, a
      return is often only approximately identical.
- [ ] Harmonic loop (`harmonicLoop`, if present) — plan pass-by-pass texture
      escalation toward the climax.
- [ ] **Source kind (`sourceProfile.kind`)** — clean notation or noisy automatic
      transcription? On a **noisy transcription** the digest's `melodyVoice` /
      `melodySkeleton` are DIAGNOSTICS, not perceptual truth: one piano
      performance may be fragmented across voices, topped with isolated octave
      artifacts and tied microfragments (`tieAudit`). Track boundaries do not
      necessarily imply instrument boundaries (`pitchedPerformanceGroups`), and
      percussion is excluded structurally (`excludedTracks`), never by name.

**Noisy-transcription path (mandatory when `sourceProfile.kind` says so):**

```
node tools/foreground.mjs projects/<slug>/source.json [more-digests.json] --out projects/<slug>
# -> foreground.json + foreground-map.md: candidate melody lines per bar WITH
#    alternatives and confidence. Review the ambiguous bars; they are Gate A rows.
```

Then write `projects/<slug>/melody-contract.json` — the human-reviewed statement
of what the arrangement must preserve (octave-exact pitches, durations, required
gaps/breaths, forbidden textures, whole-phrase octave relocations) — and validate
it: `node tools/contract-validate.mjs melody-contract.json --digest source.json`.
The contract, not the skeleton, is the fidelity authority for those spans
(sidecar mode `contract`). **Never declare a source-tied span `free` because the
extractor disagrees with your ear — `free` means added material, nothing else.**

Then run the **AlphaTex piano-export hazard checks** in
`reference/piano-to-guitar-arranging.md` → "AlphaTex piano-export hazards".
They take about a minute and each one is silent when it bites.

### Gate A — ARRANGEMENT PLAN (once per song; HARD STOP, requires approval)

Present the plan table from `docs/gate-templates.md`. Fill every row from the map:

- **Source key → target key** with the musical reason, **derived** via the
  transposition procedure in `reference/piano-to-guitar-arranging.md`: fill the
  candidate table, and pick the key that puts tonic *and* dominant on open
  strings while keeping the octave-folded bass above E2. Zero is a legitimate
  answer — a source already in a guitar key should not be moved. (Note: every
  file in the CanonRock corpus stayed in D, so this corpus gives you no
  transposition precedent — treat the procedure as general craft.) The signed
  semitone count is what you later pass as `check.mjs --transpose N`.
- **Tuning** (standard unless a reason is stated — Rule 3).
- **Tempo / groove / form** — proposed at Gate A and locked only after human
  approval (Rule 2 still governs *changes* to an approved plan). The source
  tempo is a **reference point, not a lock**: a slow source can legitimately
  become a faster guitar tempo over a re-metered groove. Fill the **Form plan**
  and **Groove plan** tables in `docs/gate-templates.md` alongside the arrangement
  plan, and treat any mid-song tempo change as its own approval decision.
- **Gain / tone** — high | crunch | clean. Absent a flag this comes from the
  chosen style's `defaultGain`, then from `high`.
- **Style** — `hard-rock` (default) | `metal` | `blues` | `jazz`. This is the
  weighting the soft advisories grade against, and it is **soft policy only**: it
  can change the advice and can never change a hard gate result. Choose it from
  the arrangement you are actually planning, not from the source's genre — a
  blues-phrased cover of a baroque source is graded as blues. See
  `docs/specs/style-profile-reference.md`. It rides every gate via `--style`.
- **Arrangement mode** — `solo` (default) | `dual-guitar`. **Solo is the default
  and roles are never inferred**: declaring nothing keeps a two-track score in
  solo, so a duet is always a decision somebody made. Dual-guitar needs both
  `--lead` and `--rhythm`, non-empty and disjoint, and changes what each gate
  looks at: melodic skeleton and contour against the **lead** view, root motion
  and pitch-class coverage against **lead ∪ rhythm**, mechanics against **every**
  guitar part independently.
- **Section map** — each source section from the map, assigned a **guitar role**
  (riff, power-chord bed, lead melody, arpeggiated break, …). This is the
  **Form plan** table in `docs/gate-templates.md`, which also records per-span mode
  (`free` / `quote` / `recompose`) and source-bar tie-ins — the same spans that
  become sidecar entries at Gate B.
- **Technique palette** — per `reference/piano-to-guitar-arranging.md` +
  `reference/electric-guitar-voice.md`.
- **Deliberate losses** — what the reduction drops and why (Rule 4).
- **Source reliability** — fill the source-reliability block from
  `docs/gate-templates.md`: transcription kind, pitched-performance groups,
  excluded tracks, the foreground authority (digest skeleton vs reviewed
  foreground contract), the ambiguous bars needing a human decision, and any
  relocation groups (complete out-of-range phrases moved coherently, by whole
  octaves — never note-by-note).
- **Guitar policy** (optional but recommended) — a
  `projects/<slug>/guitar-policy.json` recording the player's physical limits and
  the texture rules (`maxFret`, `fastAttackMaxNotes`, `maxSimultaneousNotes`,
  brush/roll/mute bans). It rides every gate via `--policy`.

**If the plan is dual-guitar, Gate A must also review the second guitar.** Two
parts that each pass alone can still be a bad arrangement, and no gate can hear
that. Put these in front of the human explicitly:

- **Lead prominence** — is the melody unambiguously in the lead part, and does it
  stay audible over what the rhythm part is doing?
- **Rhythm support** — is the rhythm part supporting a melody, or is it a second
  lead competing with the first?
- **Register separation** — do the parts occupy distinct registers, or are they
  stacked in the same octave where they will blur?
- **Masking** — does a rhythm voicing sit on top of a melody note and swallow it?
- **Independent playability** — can one player play each part, on its own, with
  one pair of hands? The gate checks this mechanically; the question here is
  whether it is *comfortable*, not merely possible.
- **Intentional doubling** — where the parts play the same pitch, is that a
  deliberate reinforcement or an accident of reduction?

**Wait for explicit human approval before writing any tab.** This is a HARD
STOP: do not draft, do not present a chunk, do not run check.mjs on a draft
until the human has approved the plan. If the human says "looks reasonable,
go ahead," that is approval; if they say nothing, you are still waiting.

### Gate B — PER CHUNK (repeat until done)

1. **Intent** — state the chunk's goal in one sentence, tied to its section role.
2. **Declare the map entry** for this chunk before writing any bar. Each span
   has a mode and, for source-tied modes, its tie-in. Write it into the song's
   sidecar (`projects/<slug>/sidecar.json`, schema:
   `{ song, contract?, entries: [{ tabBars: [a,b], mode, sourceBars?:[c,d], contractPhrase?, note? }] }`)
   so the gate can enforce it. The five modes:
   - `free` — **added material** (intro/coda/the guitar's own contribution); no
     fidelity gate. Never a euphemism for "the extractor disagrees with me."
   - `quote` — digest skeleton (in order) + root motion protected.
   - `recompose` — root motion only.
   - `contract` — a melody-contract **phrase** enforced (octave-exact pitches,
     order, durations, repeated attacks, required gaps, forbidden textures)
     PLUS root motion. Requires `contractPhrase` and a contract file (the
     sidecar's top-level `"contract"` path, or `--contract`).
   - `contract-recompose` — the contract phrase with harmony relaxed.
   Additions (`free` spans) are named here, not smuggled in silently.
3. **Write** ≤ 8 bars into `projects/<slug>/cover.alphatab` (the single growing file;
   approved bars are NEVER rewritten). Use `reference/alphatex-language.md`.
   Before a bar leaves your hands, use the three pre-write guards so the gate passes
   first time:
   - **Syntax + craft gotchas** — `reference/chunk-authoring-cheatsheet.md` (the
     single at-the-moment-of-writing reference: `{lr}`/effect placement, fret grid,
     playability rules, transpose sign).
   - **Verify every `fret.string` before you write it** — `node tools/fret.mjs 10.6`
     names the pitch (`10.6 = D3 (pc 2)`); `node tools/fret.mjs Ab3` gives the
     playable positions. Never hand-compute a fret token.
   - **Check the bar-sum before you commit the bar** — `node tools/barfill.mjs --frag
     "3.6.4 5.6.4 7.6.4 8.6.8 |"` catches a 3.5-beat bar (`MISMATCH (underfull by 480
     ticks)`) before it reaches the file.

   If you are about to hand-edit already-approved bars in VS Code, checkpoint first with
   `node ../../tools/history.mjs snap --note "before <edit>"` — an uncaptured hand edit is
   the one tab state the gate loop below does not snapshot on its own.
4. **Check until clean.** THE GATE COMMAND IS
   `history.mjs check cover.alphatab --map sidecar.json --bars 1-<last>`, run from inside the
   project dir. `history.mjs check` **wraps `check.mjs`** — identical report, args, and exit
   code — and additionally **snapshots each gated iteration** of the tab + sidecar into
   `projects/<slug>/history/` (de-duped: an unchanged re-run adds nothing). That is how no
   version is ever lost. `check.mjs` itself remains the underlying gate engine; run it bare
   (`node ../../tools/check.mjs …`) only for the `--bars`-only debugging fallback.
   `--map <sidecar>` selects the gate **MODE** (correspondence-aware — it knows which
   tab bars answer which source bars). `--bars 1-<last>` always scopes the tab range to
   check and is required on every run. A cover expands 2–4× (the corpus's own measured
   fact: 57 source bars → 210 tab bars), so source bar numbers and tab bar numbers do not
   line up — without the sidecar the gate falls back to a bar-locked 1:1 comparison that
   is useless for a cover. Therefore:
   ```
   cd projects/<slug>
   node ../../tools/history.mjs check cover.alphatab --map sidecar.json --bars 1-<last> [--transpose N] [--gain high|crunch|clean] [--policy guitar-policy.json] [--warnings-as-errors]
   ```

   `--policy` applies the project's texture constraints inside playability
   (exact fret ceiling, fast-attack note caps, brush/roll/mute bans);
   `--warnings-as-errors` makes every soft advisory gate, for a zero-warning
   approval standard. Each `history.mjs check` run snapshots the tab, sidecar,
   melody contract, policy, and the machine report together — the snapshot's
   `contractHash` is what keeps an old PASS meaningful after a contract edit.

   **Whenever a chunk introduces ties, cross-bar sustains, or unusual effects,
   inspect what the parser ACTUALLY built before gating:**
   `node ../../tools/tab-events.mjs cover.alphatab --bars <N-M>`. A tie-shaped
   token with no resolvable origin silently parses as a fresh attack (of the
   OPEN STRING on a tab staff) — tab-events shows every note as ATTACK or
   CONTINUATION and audits the text against the model. Tie behaviour is
   confirmed from the parsed score model, never from how the AlphaTex looks.
   `--bars` **without** `--map` is a **debugging fallback only** (bar-locked 1:1 mode,
   for a chunk you are inspecting in isolation); it is never the gate command for a
   cover. If you find yourself dropping `--map`, STOP — you have not built the sidecar
   the workflow requires.

   `check.mjs` runs validate `--strict` → playability → compare (in the mode
   each entry declares) and is the ONE command that must
   pass. It auto-resolves the digest as the co-located `source.json`
   (`projects/<slug>/source.json`; pass `--digest projects/<slug>/source.json`
   explicitly from repo root). Hard gates: parse/bar-fill, playability errors, and — per
   span — melodic-skeleton + harmonic-root coverage (`quote`), root motion only
   (`recompose`), or none (`free`). Everything else (tone/physics advisories, chord
   quality, density, dropped notes, contour) is reported, never fatal — weigh it, don't
   chase it.
5. **Present** per `docs/gate-templates.md` — **only after check.mjs passes**: the
   snippet, the check report (fidelity summary + dropped-note list), 2–3
   "listen for" pointers, and the A/B audition instruction — open
   `projects/<slug>/cover.alphatab` in VS Code (alphaTab extension) and play it; open the
   source `.alphatab` the same way to compare. No tab is shown to the human
   until check.mjs passes.

   **Recognizability (soft, but named at the gate).** A contour inversion — a
   direction-flip where your line broadly *descends* against a source phrase that
   *ascends*, or vice versa — inside a `quote` or `recompose` span is legitimate as
   a deliberate reimagining, but it must be **named here** (e.g. "ascending
   reimagining of the descending cascade — deliberate"). An *unexplained* inversion
   is a defect: the listener stops recognizing the tune. `check.mjs` surfaces a SOFT,
   non-gating **contour warning** (from `compare.mjs`, when the Pearson correlation
   is strongly negative, `r < -0.5`) to flag exactly this — it fires mechanically on
   `quote` spans; on a `recompose` span the tool stays silent, so you must
   self-report the flip. A surfaced contour warning you did not explain is a
   `wrong-contour` / `unrecognizable` REVISE waiting to happen.
6. **Verdict** — APPROVED, or REVISE with a taxonomy tag: `lost-the-melody |
   not-guitaristic | too-thin | too-busy | unplayable | wrong-register |
   wrong-feel | dissonant | wrong-contour | unrecognizable | other`. Wrong notes →
   back to step 3; wrong plan → back to Gate A (`PROPOSAL:` for any locked param).
   (`wrong-contour` = an unexplained direction-flip against a quoted/recomposed
   source phrase; `unrecognizable` = the reduction, however clean at the gate, no
   longer reads as the source tune.)
7. **Record the verdict.** `node ../../tools/history.mjs verdict <APPROVED|REVISE:tag>
   --note "…"` stamps the call onto the latest snapshot and appends a one-line stub to
   `projects/<slug>/sessions.md`; add your prose reasoning to `sessions.md` yourself (it stays
   the human-readable ledger). To revisit an earlier take, `history.mjs list` shows the
   lineage, `history.mjs diff <a> <b>` shows what changed bar-by-bar, and
   `history.mjs restore <seq>` reverts to it **non-destructively** (the current state is
   snapshotted first). This is the sanctioned replacement for hand-copying
   `scratch/<name>-v3.alphatab` files or editing the tab in place without a backup.

### Step FINAL — ASSEMBLE

Full-file check (from inside the project dir,
`node ../../tools/history.mjs check cover.alphatab --map sidecar.json --bars 1-<last>`
covers the whole tab when the sidecar's entries span it), then the consolidated
evidence report:

```
node ../../tools/history.mjs final-review cover.alphatab --map sidecar.json \
  [--contract melody-contract.json] [--policy guitar-policy.json]
```

It assembles: recurring theme statements, sections and pickups, relocation
groups, the fastest events, tuplets, long arrivals, multi-note attacks, the
tab's tie-intent audit, and every chunk's gate/verdict/recognizability status —
flagging PASS chunks that never received a musical acceptance and chunks graded
under an older contract than today's. It assembles the evidence consistently;
**it does not replace the human's full-piece audition** (open
`projects/<slug>/cover.alphatab` in VS Code, alphaTab extension), after which you
summarize what was approved and when, drawn from the log.

## Doctrine for noisy transcriptions (hold these; each one was paid for)

- The **highest sounding voice is a candidate, not perceptual truth** — on a
  Basic Pitch export the artifact voice often wins the register contest.
- **Multiple voices (or tracks) may be one instrument**; track boundaries do
  not imply instrument boundaries. Read `sourceProfile.pitchedPerformanceGroups`.
- **A note's duration comes from its own parsed event or tie chain, never the
  group envelope** — a sixteenth over a whole-note bed is a sixteenth.
- **Repeated pitches can be essential rhythmic events** — the contract's
  per-event attacks are distinct; one sustain never satisfies two.
- **Absence of accompaniment may be a fidelity obligation** — required gaps
  and forbidden textures gate exactly like required notes.
- **Out-of-range notes are relocated by phrase group**, whole octaves, the
  complete phrase together — never note-by-note.
- **Tie behaviour is confirmed from the parsed score model** (`tab-events.mjs`),
  never inferred from AlphaTex token placement.
- **`free` means added material**, not "source-tied but the extractor
  disagrees" — that case is a `contract` span.
- **A noisy source requires a reviewed foreground contract before drafting.**

## Remember

- [ ] Ingest ran (validate → extract → source-profile → audition in VS Code); read
      `projects/<slug>/source-map.md`, not the raw `.alphatab`
- [ ] On a noisy transcription: foreground reviewed, melody contract written and
      validated BEFORE drafting; source-tied spans use `contract`, never `free`
- [ ] Gate A plan approved by the human before any tab was written (hard stop)
- [ ] Every presented chunk passed `check.mjs --map sidecar.json --bars 1-<last>` this session
      (all hard gates) — no tab shown to the human until it did
- [ ] No key/tuning/tempo/layout change without `PROPOSAL:` + approval
- [ ] Every reduction named at the gate; nothing dropped silently
- [ ] Every bar sounds like guitar, not piano-on-a-fretboard
- [ ] Verdicts logged in `projects/<slug>/sessions.md` before continuing

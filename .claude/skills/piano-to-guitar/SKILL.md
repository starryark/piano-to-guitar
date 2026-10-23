---
name: piano-to-guitar
description: Arrange a piano or band score (MusicXML .mxl/.musicxml/.xml, or AlphaTex)
  into a playable, idiomatic solo electric-guitar tab in AlphaTex, behind a two-gate
  human-supervised workflow. Use whenever a score file arrives to be turned into guitar tab.
# allowed-tools kept advisory only; the neutral docs are the source of truth:
# allowed-tools: [Read, Write, Edit, Glob, Grep, "Bash(node tools/*)"]
---

# Piano or band score → Electric-Guitar Rock Cover

A MusicXML score enters through `node tools/score-import.mjs <file> --project <slug>`
(Step 0 in `docs/workflow.md`); everything after it is the ordinary AlphaTex workflow.

This project's instructions are vendor-neutral and live in canonical docs. The full gated
workflow — Role, Critical Rules, reference-file table, and the Step 0 / Gate A / Gate B /
Final procedure — is in **`docs/workflow.md`**, and the copy-paste gate presentation
templates are in **`docs/gate-templates.md`**. Read **`AGENTS.md`** (root) first for
orientation, then follow `docs/workflow.md` and `docs/gate-templates.md`. Do not work from a
separate copy here.

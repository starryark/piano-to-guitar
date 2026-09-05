# Code and musical-asset provenance

This ledger records local repository evidence reviewed while implementing the
research report. It is not a license grant or a claim that unspecified assets have
been cleared for training or redistribution.

| Material | Recorded origin | Status in this checkout |
|---|---|---|
| Root software | This repository | No root LICENSE; owner decision outstanding. No new software license is assigned by this revision. |
| Vendored gate modules | `abc-to-guitar@ba7e29c`, headers in each vendored file | Exact origin recorded; a license for that snapshot has not been established here. Preserve headers and `// PTG:` markers. |
| Analysis port | `abc-to-guitar/tools/abc-extract.py`, provenance header in `analysis.mjs` | Analysis only; no Python runtime or source converters installed. |
| Runtime dependency | `@coderline/alphatab` 1.8.4 in `package-lock.json` | Lockfile and installed package record MPL-2.0. This does not establish the repository's license. |
| Craft retrieval | Five documents explicitly listed in `tools/lib/generation.mjs` | Local documentation only; document hashes and exact excerpts retained. No song/history indexing. |
| Generation benchmark | `tools/fixtures/generation/benchmark.json` | New short synthetic note exercises created for regression testing; no external composition or recording used. Root licensing remains as above. |
| Other fixtures | `tools/fixtures/` outside the generation subset | Existing regression evidence; not automatically admitted to the new model benchmark or training corpus. |
| CanonRock | Local, gitignored reference corpus | Read-only; excluded from generation retrieval and benchmark. |
| Song projects/runs | `projects/<slug>/` | Local and gitignored. No automatic publication, history retrieval, or training export. |
| Other musical files | Paths below | Per-item rights unrecorded here; excluded from new retrieval/benchmark paths. Preserved in place. |

Tracked musical files outside `tools/fixtures/` at review time are under
`Lian_Ran_Se/`, `LieZhiJiuBa/`, `LiuGuangZhiYu/`, `Messenger_Piano/`, and
`Your_Love_Is_Drug/`, plus `every-day-is-night-garoad-from-va-11-hall-a.alphatab`,
`wocongnanjilai.alphatab`, `scratch/test.alphatab`, and `scratch/test_tie.alphatab`.
Their presence is not a rights-cleared example arrangement library.

The local predecessor's `vendor/LICENSE-NOTES.md` describes its separate
abc2xml/xml2abc converters. Those converters were not ported here. That note does
not establish the license of the vendored gate modules.

For each external asset in a future training/retrieval/benchmark manifest, record
composition identity, origin/version/hash, composition and arrangement rights,
recording rights if audio is used, permission basis for each intended use,
attribution requirements and exclusions. Different transcriptions, transpositions
and arrangements of one composition belong in the same evaluation split.
No automated rights decision or corpus-wide license is implied by this ledger.

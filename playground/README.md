# Playground

**Playground — paste AlphaTex, see the gate report beside live notation, hit play.**

A self-contained web preview of the fidelity gate. No project folder, no history
snapshots: paste a tab, see the verdict, iterate. The gate logic itself is never
duplicated — `serve.mjs` shells out to the same `tools/` CLIs the real workflow uses.

## Quick start

```
cd playground
npm install
npm start
# open the printed URL (default http://localhost:5173)
```

`serve.mjs` falls back to the repo-root `node_modules`, so if you've already run
`npm install` at the repo root you can `node serve.mjs` here without a second one.

## What you're looking at

Two columns: live notation on the left (alphaTab rendering the tab, with audio on
play), the gate report pinned on the right. The report is exactly the fidelity
block `tools/check.mjs` prints — same hard/soft split, same wording (see
`docs/gate-templates.md`).

## Lint vs fidelity mode

- **Lint** — paste a tab only. The gate runs validate + playability and stops
  there. No source, no compare. Good for "does this tab even parse / is it
  playable?" before you've lined up a source.
- **Fidelity** — paste a tab *and* a piano source, plus an optional span sidecar.
  The gate adds the full fidelity compare: melodic skeleton, harmonic roots, and
  the soft signals (tone advisory, reduction density, contour). This is what
  `check.mjs --map` does in the Gate-B loop — same per-span verdicts, same
  `quote` / `recompose` / `free` modes.

## Status badges

- **green** = ok (a hard gate passed)
- **red** = fail (a hard gate failed)
- **amber** = soft / advisory (printed, never fatal)

A `0/0` row means a *trivial* PASS — the gate had nothing to compare. Treat a
suspiciously clean `0/0` as a failure to investigate, not a win (`AGENTS.md` §A.2).

## Default example

On boot the page loads the song-neutral `tools/fixtures/e2e-tab.alphatab` +
`chaconne-excerpt.alphatab` + `e2e-sidecar.json` triple — an already-gates-PASS
arrangement with no real music in it. No copyrighted content ships with the repo.

## Verification

```
npm run smoke
```

Runs `playground/smoke.mjs` — 9 checks that boot the server and exercise every
endpoint plus the gate's lint and fidelity paths: the static page, the alphaTab
ESM bundle / font / soundfont routes, `/seed`, a lint PASS, a fidelity PASS with a
non-zero-totals guard, a parse-failure, and the playability exit-code trap (errors
drive `ok:false`, not the tool's exit code).

## How it fits the workflow

This is a **preview harness for quick iteration**, not a replacement for the
project-folder Gate-B loop. Real work happens under `projects/<slug>/` with
`history.mjs check` snapshotting every take into `history/`. The playground runs
the gate in memory and keeps nothing.

## Architecture

`serve.mjs` is a dependency-free Node dev server (no deps beyond `@coderline/
alphatab`). It static-hosts the page and the alphaTab dist under `/alphatab/`,
and exposes `POST /gate`, which spawns the repo's existing gate CLIs
(`validate.mjs`, `playability.mjs`, `piano-extract.mjs`, `check.mjs`) as
read-only black boxes. The gate logic is NEVER duplicated — it stays in the
tested `tools/`.

## Files

- `serve.mjs` — the dev server: static assets + `/alphatab/` proxy + `/seed` + `POST /gate`.
- `public/index.html` — the two-column page shell.
- `public/playground.css` — layout and the status-badge colors.
- `public/playground.js` — client: renders the tab, posts to `/gate`, paints the report.
- `smoke.mjs` — the 9-check health check (`npm run smoke`).

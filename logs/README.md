# logs/

Per-song verdict history — `<stem>-sessions.md`, one file per piece, tracked in git.

Every Gate B audition gets a logged verdict: the chunk, the sidecar entry that covered it, the
gate result, and the human's call. The log is the record of what was *approved*, not of what was
attempted.

A defect the toolchain let through does **not** belong here alone — it becomes a fixture in
`tools/fixtures/` with its contract enforced by `smoke.mjs`.

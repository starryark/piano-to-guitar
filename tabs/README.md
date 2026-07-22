# tabs/

The growing guitar arrangement — one `.alphatab` per piece, tracked in git.

This is the **output** side: a single electric-guitar track in fretted notation. No bass track,
no backing render. A tab arrives here one gated chunk at a time; nothing is shown to the human
until `node tools/check.mjs <tab> --map <sidecar>` passes.

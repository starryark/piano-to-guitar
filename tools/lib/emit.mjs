// emit.mjs — drop-in replacements for console.log / console.error that write
// SYNCHRONOUSLY, so `process.exit()` cannot discard output that has not reached
// the reader yet.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// On POSIX, `process.stdout` is asynchronous when it is a **pipe** — which is
// exactly what it is when one tool spawns another, when a test captures a CLI,
// or when a human types `| jq`. Writes are queued; `process.exit()` does not
// wait for the queue, and whatever is still in it is discarded.
//
// On Windows pipes are synchronous, so identical code is correct there. That
// asymmetry is why this survived to Wave 6: validation ran on Windows only, and
// every fixture was small enough that its whole output fitted in the pipe
// buffer (~64 kB on Linux, often 16 kB on macOS), where even an async write
// lands in one go.
//
// The 200-bar scale fixture broke both conditions at once, on the first CI run
// that ever executed. `compare.mjs --json` emits 163 kB, `fingering.mjs` 148 kB,
// `tab-events.mjs` 947 kB; `check.mjs` reported "compare.mjs produced no JSON".
// The JSON was fine — it was cut off mid-write. Every ubuntu and macos row
// failed; both windows rows passed.
//
// A gate that silently truncates its own verdict on the platforms half the
// world uses is the most serious defect this toolchain can have, and nothing
// above the tool boundary can catch it: the exit code is right and the JSON is
// merely short.
//
// IT IS NOT ONLY BIG SINGLE WRITES
// --------------------------------
// The first version of this module covered "one write larger than the pipe
// buffer", which is the shape `compare --json` has. That framing is incomplete.
// A loop of five thousand short `console.log` calls — `tab-events` in human
// mode — queues just as much, because the reader has not drained any of it
// either. The real condition is TOTAL undrained output at the moment of exit,
// so every write in these CLIs goes through here, not just the large ones.
//
// WHY SYNCHRONOUS WRITES AND NOT `process.exitCode`
// -------------------------------------------------
// Setting `process.exitCode` and returning is the other correct fix, and the
// more idiomatic one — Node flushes on its own before exiting naturally. It was
// not chosen because applying it means rewriting control flow at every exit
// site, and a `process.exit()` in the middle of a function does something a
// `return` may not. Writing synchronously fixes the same bug with a
// substitution that CANNOT change what a tool does: the exits stay where they
// are, and by the time one runs, the bytes are already out.
//
// These are drop-in: `util.format` is what `console.log` itself uses, so
// multi-argument and non-string calls behave identically.

import * as fs from 'node:fs';
import * as util from 'node:util';

/**
 * Write `text` to `fd` and do not return until every byte is handed to the OS.
 *
 * Both retries matter, and neither is theoretical at 947 kB:
 *   EAGAIN — the pipe is full and its reader has not drained it. Node may have
 *            put the fd in non-blocking mode, so this means "try again", not
 *            "failed".
 *   EPIPE  — the reader has gone away (`| head -20`). `console.log` swallows
 *            this, so this must too, or piping a tool into `head` would print
 *            a stack trace instead of ending quietly.
 */
function writeAllSync(fd, text) {
  const buf = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buf.length) {
    try {
      offset += fs.writeSync(fd, buf, offset, buf.length - offset);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EPIPE') return;
      throw err;
    }
  }
}

/** `console.log`, synchronously. */
export function emit(...args) {
  writeAllSync(1, `${util.format(...args)}\n`);
}

/** `console.error`, synchronously. Diagnostics are the output most worth not
 *  losing: a truncated error message is how a real failure becomes a mystery. */
export function emitErr(...args) {
  writeAllSync(2, `${util.format(...args)}\n`);
}

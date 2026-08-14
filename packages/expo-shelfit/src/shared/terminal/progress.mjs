// Progress reporting for long-running fetches. Written to stderr (and only
// when stderr is a TTY) so stdout stays clean for the results only — the
// same rule every warning in this CLI follows.

import { dim } from './render.mjs';

export function progress(msg) {
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K${dim(msg)}`);
}

/** Shared "X: n/total unit…" phrasing for members.mjs / stats.mjs's aggregate progress. */
export function progressCount(label, done, total, unit) {
  progress(`${label}: ${done}/${total} ${unit}…`);
}

export function clearProgress() {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
}

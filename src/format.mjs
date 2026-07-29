// Converts the raw "entries" produced by src/cli.mjs#run() into each of the
// supported output formats. Kept separate from src/render.mjs, which only
// knows about the human-oriented table.

import { relativeDate } from './render.mjs';

const FIELDS = ['account', 'app', 'slug', 'platform', 'version', 'build', 'lastBuildAt'];

/** Table rows: display strings, "-" for null/missing, relative dates. */
export function toDisplayRows(entries, { now } = {}) {
  return entries.map((e) => [
    e.account,
    e.app,
    e.slug,
    e.platform ?? '-',
    e.version ?? '-',
    e.build ?? '-',
    relativeDate(e.lastBuildAt, now),
  ]);
}

/** `--json`: an array of entries, raw values (null, ISO 8601 dates). */
export function formatJSON(entries) {
  return JSON.stringify(entries, null, 2);
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `--csv`: header row + one row per entry, raw values (empty cell for null). */
export function formatCSV(entries) {
  const lines = [FIELDS.join(',')];
  for (const e of entries) {
    lines.push(FIELDS.map((f) => csvEscape(e[f])).join(','));
  }
  return lines.join('\n');
}

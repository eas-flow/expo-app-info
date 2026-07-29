// Converts the raw "entries" produced by src/cli.mjs#run() into each of the
// supported output formats. Kept separate from src/render.mjs, which only
// knows about the human-oriented table.

import { relativeDate } from './render.mjs';

const FIELDS = ['account', 'app', 'slug', 'platform', 'version', 'build', 'lastBuildAt'];

/** `--usage`: one entry per account instead of one per app/platform. */
export const USAGE_FIELDS = [
  'account',
  'plan',
  'planId',
  'status',
  'concurrencyTotal',
  'concurrencyIos',
  'concurrencyAndroid',
  'periodStart',
  'periodEnd',
];

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

/**
 * Usage table rows: display strings, "-" for null/missing, dates as YYYY-MM-DD.
 * With `platform` set, the concurrency column reports that platform's own
 * concurrency instead of the account total.
 */
export function toUsageDisplayRows(entries, { platform = null } = {}) {
  const concurrencyField =
    platform === 'ios'
      ? 'concurrencyIos'
      : platform === 'android'
        ? 'concurrencyAndroid'
        : 'concurrencyTotal';

  return entries.map((e) => [
    e.account,
    e.plan ?? '-',
    e.status ?? '-',
    e[concurrencyField] === null || e[concurrencyField] === undefined
      ? '-'
      : String(e[concurrencyField]),
    e.periodStart && e.periodEnd ? `${isoDate(e.periodStart)} → ${isoDate(e.periodEnd)}` : '-',
  ]);
}

/** Header for the concurrency column, which depends on the --platform filter. */
export function usageConcurrencyHeader(platform = null) {
  if (platform === 'ios') return 'CONCURRENCY (IOS)';
  if (platform === 'android') return 'CONCURRENCY (ANDROID)';
  return 'CONCURRENCY';
}

/** ISO 8601 timestamp → YYYY-MM-DD, for the human table only. */
function isoDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
}

/** `--json`: an array of entries, raw values (null, ISO 8601 dates). */
export function formatJSON(entries) {
  return JSON.stringify(entries, null, 2);
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * `--csv`: header row + one row per entry, raw values (empty cell for null).
 * `fields` is a parameter so `--usage` can reuse this with its own columns.
 */
export function formatCSV(entries, fields = FIELDS) {
  const lines = [fields.join(',')];
  for (const e of entries) {
    lines.push(fields.map((f) => csvEscape(e[f])).join(','));
  }
  return lines.join('\n');
}

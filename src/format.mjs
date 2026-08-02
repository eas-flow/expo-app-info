// Converts the raw "entries" produced by src/cli.mjs#run() into each of the
// supported output formats. Kept separate from src/render.mjs, which only
// knows about the human-oriented table.

import { formatBuildDate } from './render.mjs';

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
  'buildsIos',
  'buildsAndroid',
  'periodStart',
  'periodEnd',
];

/**
 * Table rows: display strings, "-" for null/missing, absolute build dates.
 *
 * `accountDisplayNames` (account slug -> EAS "Display name") is an optional
 * cosmetic, table-only lookup (issue #22): when given and it has an entry
 * for a row's account, the human table shows that instead of the slug. This
 * never touches `e.account` itself or any other field, so --json/--csv
 * (which pass entries straight to formatJSON/formatCSV, not through this
 * function) keep emitting the slug unconditionally.
 */
export function toDisplayRows(entries, { accountDisplayNames = new Map() } = {}) {
  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.app,
    e.slug,
    e.platform ?? '-',
    e.version ?? '-',
    e.build ?? '-',
    formatBuildDate(e.lastBuildAt),
  ]);
}

/**
 * Usage table rows: display strings, "-" for null/missing, dates as YYYY-MM-DD.
 * With `platform` set, CONCURRENCY and BUILDS report that platform's own
 * number. Without it, CONCURRENCY is the account-level total (not a sum —
 * that's what EAS enforces) and BUILDS is the sum of both platforms' counts
 * for the period. `accountDisplayNames` is the same cosmetic, table-only
 * slug -> Display name lookup described on `toDisplayRows` (issue #22).
 */
export function toUsageDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map() } = {}
) {
  const concurrencyField =
    platform === 'ios'
      ? 'concurrencyIos'
      : platform === 'android'
        ? 'concurrencyAndroid'
        : 'concurrencyTotal';

  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.plan ?? '-',
    e.status ?? '-',
    e[concurrencyField] === null || e[concurrencyField] === undefined
      ? '-'
      : String(e[concurrencyField]),
    buildsCell(e, platform),
    e.periodStart && e.periodEnd
      ? `${isoDate(e.periodStart)} → ${isoDate(inclusiveEnd(e.periodEnd))}`
      : '-',
  ]);
}

function buildsCell(entry, platform) {
  const { buildsIos, buildsAndroid } = entry;
  if (buildsIos === null || buildsIos === undefined) return '-';
  if (platform === 'ios') return String(buildsIos);
  if (platform === 'android') return String(buildsAndroid);
  return String(buildsIos + buildsAndroid);
}

/** Header for the concurrency column, which depends on the --platform filter. */
export function usageConcurrencyHeader(platform = null) {
  if (platform === 'ios') return 'CONCURRENCY (IOS)';
  if (platform === 'android') return 'CONCURRENCY (ANDROID)';
  return 'CONCURRENCY';
}

/** Header for the builds column, which depends on the --platform filter. */
export function usageBuildsHeader(platform = null) {
  if (platform === 'ios') return 'BUILDS (IOS)';
  if (platform === 'android') return 'BUILDS (ANDROID)';
  return 'BUILDS';
}

/** ISO 8601 timestamp → YYYY-MM-DD, for the human table only. */
function isoDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * EAS's `billingPeriod.end` is an *exclusive* boundary — the instant the
 * next period starts (e.g. a July period ends at 2026-08-01T00:00:00Z), not
 * the last moment of the period. Displayed as-is that reads like "runs into
 * August" for a period that is entirely July, so the human table shows the
 * last day the period actually covers instead: `end` minus one day. Only
 * cosmetic — `--json`/`--csv` still emit the raw, unmodified `periodEnd`.
 */
function inclusiveEnd(iso) {
  return new Date(new Date(iso).getTime() - ONE_DAY_MS).toISOString();
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

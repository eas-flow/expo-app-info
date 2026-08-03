// Converts the raw "entries" produced by the display-mode flows in
// src/commands/ into each of the
// supported output formats. Kept separate from src/render.mjs, which only
// knows about the human-oriented table.

import { formatBuildDate, inclusiveEnd, isoDate } from './dates.mjs';

const FIELDS = ['account', 'app', 'slug', 'platform', 'version', 'build', 'lastBuildAt'];

/**
 * `--usage`: one entry per account *per UTC calendar month* (issue #18),
 * instead of one per app/platform or one per account. `buildsIos`/
 * `buildsAndroid` are "successful build" counts counted client-side from
 * finished builds via the API — not EAS's own billing/usage metric (which
 * can't be sliced into arbitrary calendar ranges). No plan/status/
 * concurrency fields here; those moved to `--plan` (issue #19) since they
 * are "current" facts that would otherwise be repeated identically across
 * every month's row.
 */
export const USAGE_FIELDS = ['account', 'buildsIos', 'buildsAndroid', 'periodStart', 'periodEnd'];

/**
 * `--plan`: one entry per account, current subscription only (no billing
 * period / build counts — that's `--usage`). No price field: not confirmed
 * to exist in the schema yet (issue #19's pre-verification note); add one
 * later only once that's checked against a real token.
 */
export const PLAN_FIELDS = [
  'account',
  'plan',
  'planId',
  'status',
  'concurrencyTotal',
  'concurrencyIos',
  'concurrencyAndroid',
  'trialEnd',
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
 * Usage table rows: one row per account per UTC calendar month (issue #18).
 * `[account, period, ...buildCells]` — `buildCells` is one or two columns
 * depending on `platform` (both iOS and Android by default, narrowed to one
 * with `--platform`), mirroring `usageBuildsHeaders` below so header/cell
 * order always line up. `accountDisplayNames` is the same cosmetic,
 * table-only slug -> Display name lookup described on `toDisplayRows`
 * (issue #22). `now` (default current time) decides which row, if any, is
 * the still-in-progress current month for the `(today)` marker below.
 */
export function toUsageDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map(), now = new Date() } = {}
) {
  return entries.map((e) => {
    const row = [accountDisplayNames.get(e.account) ?? e.account, periodCell(e, now)];
    if (platform !== 'android') row.push(cellOrDash(e.buildsIos));
    if (platform !== 'ios') row.push(cellOrDash(e.buildsAndroid));
    return row;
  });
}

function cellOrDash(value) {
  return value === null || value === undefined ? '-' : String(value);
}

/**
 * `START → END` for a month's row, where END is `(today)` for the current,
 * still-in-progress month (so it doesn't read like a confirmed final count
 * for a month that hasn't finished yet) and the usual inclusive last day
 * (`periodEnd` minus a day, since that boundary is exclusive) otherwise.
 */
function periodCell(entry, now) {
  if (!entry.periodStart || !entry.periodEnd) return '-';
  const startMs = new Date(entry.periodStart).getTime();
  const endMs = new Date(entry.periodEnd).getTime();
  const nowMs = now.getTime();
  const isCurrent = nowMs >= startMs && nowMs < endMs;
  const end = isCurrent ? '(today)' : isoDate(inclusiveEnd(entry.periodEnd));
  return `${isoDate(entry.periodStart)} → ${end}`;
}

/**
 * Header(s) for the successful-builds column(s), which depend on the
 * --platform filter: both iOS and Android by default (two columns), or just
 * one when narrowed. Returns an array so callers can spread it directly into
 * a header list next to however many cells `toUsageDisplayRows` produced.
 */
export function usageBuildsHeaders(platform = null) {
  if (platform === 'ios') return ['SUCCESSFUL BUILDS (IOS)'];
  if (platform === 'android') return ['SUCCESSFUL BUILDS (AND)'];
  return ['SUCCESSFUL BUILDS (IOS)', 'SUCCESSFUL BUILDS (AND)'];
}

/**
 * `--plan` table rows: display strings, "-" for null/missing. Unlike
 * `--usage`, PLAN ID is shown as its own column (there's no billing period
 * or build count column to compete for space with), and CONCURRENCY reports
 * all three numbers (total/ios/android) at once unless `--platform` narrows
 * it to one.
 * `accountDisplayNames` is the same cosmetic, table-only slug -> Display
 * name lookup described on `toDisplayRows` (issue #22).
 */
export function toPlanDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map() } = {}
) {
  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.plan ?? '-',
    e.planId ?? '-',
    e.status ?? '-',
    planConcurrencyCell(e, platform),
    e.trialEnd ? isoDate(e.trialEnd) : '-',
  ]);
}

function planConcurrencyCell(entry, platform) {
  const { concurrencyTotal, concurrencyIos, concurrencyAndroid } = entry;
  if (platform === 'ios') {
    return concurrencyIos === null || concurrencyIos === undefined ? '-' : String(concurrencyIos);
  }
  if (platform === 'android') {
    return concurrencyAndroid === null || concurrencyAndroid === undefined
      ? '-'
      : String(concurrencyAndroid);
  }
  if (concurrencyTotal === null || concurrencyTotal === undefined) return '-';
  return `${concurrencyTotal} / ${concurrencyIos} / ${concurrencyAndroid}`;
}

/** Header for the `--plan` concurrency column, which depends on the --platform filter. */
export function planConcurrencyHeader(platform = null) {
  if (platform === 'ios') return 'CONCURRENCY (IOS)';
  if (platform === 'android') return 'CONCURRENCY (ANDROID)';
  return 'CONCURRENCY (TOTAL/IOS/AND)';
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

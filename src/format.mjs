// Converts the raw "entries" produced by the display-mode flows in
// src/commands/ into human-oriented table rows. There is no machine-readable
// output mode; the table below is the only supported output and carries no
// compatibility guarantee.

import { formatBuildDate, inclusiveEnd, isoDate } from './dates.mjs';

/**
 * Table rows: display strings, "-" for null/missing, absolute build dates.
 *
 * `accountDisplayNames` (account slug -> EAS "Display name") is an optional
 * lookup (issue #22): when given and it has an entry for a row's account,
 * the table shows that instead of the slug.
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

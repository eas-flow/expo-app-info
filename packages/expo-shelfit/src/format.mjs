// Converts the raw "entries" produced by the display-mode flows in
// src/commands/ into human-oriented table rows. There is no machine-readable
// output mode; the table below is the only supported output and carries no
// compatibility guarantee.

import { formatBuildDate, inclusiveEnd, isoDate, localOffset } from './dates.mjs';

/**
 * Table rows: display strings, "-" for null/missing, absolute build dates.
 *
 * `accountDisplayNames` (account slug -> EAS "Display name") is an optional
 * lookup: when given and it has an entry for a row's account, the table
 * shows that instead of the slug. `local` (--local, #85) switches only the
 * BUILD DATE cell to the machine's local timezone — see buildDateHeader
 * below for the matching column header.
 */
export function toDisplayRows(entries, { accountDisplayNames = new Map(), local = false } = {}) {
  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.app,
    e.slug,
    e.platform ?? '-',
    e.version ?? '-',
    e.build ?? '-',
    statusLabel(e.status),
    formatBuildDate(e.lastBuildAt, { local }),
  ]);
}

// EAS `status` enum -> Title Case display string for the STATUS column.
// Only these 3 have been confirmed against the real API
// (scripts/probe-build-status.mjs, issue #83); a status not listed here —
// most likely a still in-progress/queued build whose exact enum name was
// never observed in that probe — falls back to the raw value lowercased
// rather than being guessed at, so an unrecognized status still shows
// *something* meaningful instead of breaking or silently disappearing.
const STATUS_LABELS = { FINISHED: 'Finished', ERRORED: 'Errored', CANCELED: 'Canceled' };

function statusLabel(status) {
  if (!status) return '-';
  return STATUS_LABELS[status] ?? status.toLowerCase();
}

/**
 * Header for the BUILD DATE column: plain "BUILD DATE" by default, or
 * "BUILD DATE (+09:00)" with --local — the current local UTC offset, so the
 * column is self-describing without a separate legend. See
 * src/dates.mjs#localOffset for why this is "as of now", not per-row.
 */
export function buildDateHeader(local = false) {
  return local ? `BUILD DATE (${localOffset()})` : 'BUILD DATE';
}

// Category-major, platform-minor column order shared by usageBuildsHeaders
// and toUsageDisplayRows below, so header/cell order always line up:
// SUCCESS(IOS), SUCCESS(AND), ERRORED(IOS), ERRORED(AND), CANCELED(IOS),
// CANCELED(AND) (narrowed to one platform's column per category with
// --platform). "success"/"errored"/"canceled" match the keys
// src/api.mjs#countBuildsByMonth counts into; anything else EAS reports
// (e.g. a still in-progress/queued build) isn't a terminal outcome and
// isn't counted into any of the three (#83).
const USAGE_CATEGORIES = ['success', 'errored', 'canceled'];

function usagePlatforms(platform) {
  if (platform === 'ios') return ['ios'];
  if (platform === 'android') return ['android'];
  return ['ios', 'android'];
}

/**
 * Usage table rows: one row per account per UTC calendar month.
 * `[account, period, ...buildCells]` — `buildCells` follows USAGE_CATEGORIES
 * x usagePlatforms(platform) above, mirroring `usageBuildsHeaders` below so
 * header/cell order always line up. `accountDisplayNames` is the same
 * cosmetic, table-only slug -> Display name lookup described on
 * `toDisplayRows`. `now` (default current time) decides which row, if any,
 * is the still-in-progress current month for the `(today)` marker below.
 *
 * `e.ios`/`e.android` are each either `null` (that platform's counts
 * couldn't be fetched — degrades every category cell to "-") or
 * `{ success, errored, canceled }` (src/api.mjs#countBuildsByMonth's shape).
 */
export function toUsageDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map(), now = new Date() } = {}
) {
  const platforms = usagePlatforms(platform);

  return entries.map((e) => {
    const row = [accountDisplayNames.get(e.account) ?? e.account, periodCell(e, now)];
    for (const category of USAGE_CATEGORIES) {
      for (const p of platforms) {
        const counts = e[p];
        row.push(cellOrDash(counts ? counts[category] : null));
      }
    }
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
 * Header(s) for the build-count columns: up to 6 (SUCCESS/ERRORED/CANCELED x
 * IOS/AND) by default, narrowed to 3 (one platform's column per category)
 * with --platform. Shortened from the pre-#83 "SUCCESSFUL BUILDS (IOS)"
 * wording since 3 categories x 2 platforms would otherwise make the table
 * very wide. Returns an array so callers can spread it directly into a
 * header list next to however many cells `toUsageDisplayRows` produced.
 */
export function usageBuildsHeaders(platform = null) {
  const platforms = usagePlatforms(platform);
  const platformLabel = { ios: 'IOS', android: 'AND' };
  return USAGE_CATEGORIES.flatMap((category) =>
    platforms.map((p) => `${category.toUpperCase()}(${platformLabel[p]})`)
  );
}

/**
 * `--plan` table rows: display strings, "-" for null/missing. Unlike
 * `--usage`, PLAN ID is shown as its own column (there's no billing period
 * or build count column to compete for space with), and CONCURRENCY reports
 * all three numbers (total/ios/android) at once unless `--platform` narrows
 * it to one.
 * `accountDisplayNames` is the same cosmetic, table-only slug -> Display
 * name lookup described on `toDisplayRows`.
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
  if (platform === 'ios') return cellOrDash(concurrencyIos);
  if (platform === 'android') return cellOrDash(concurrencyAndroid);
  if (cellOrDash(concurrencyTotal) === '-') return '-';
  return `${concurrencyTotal} / ${concurrencyIos} / ${concurrencyAndroid}`;
}

/** Header for the `--plan` concurrency column, which depends on the --platform filter. */
export function planConcurrencyHeader(platform = null) {
  if (platform === 'ios') return 'CONCURRENCY (IOS)';
  if (platform === 'android') return 'CONCURRENCY (ANDROID)';
  return 'CONCURRENCY (TOTAL/IOS/AND)';
}

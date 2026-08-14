// Converts runStats's raw "entries" into human-oriented table rows. There is
// no machine-readable output mode; the table is the only supported output
// and carries no compatibility guarantee.

import { cellOrDash } from '../../shared/cells.mjs';
import { inclusiveEnd, isoDate } from '../../shared/dates.mjs';

function statsPlatforms(platform) {
  if (platform === 'ios') return ['ios'];
  if (platform === 'android') return ['android'];
  return ['ios', 'android'];
}

/**
 * One row per subject per UTC calendar month *per platform* —
 * `[subject, period, platform, success, errored, canceled, total]`. PLATFORM
 * being its own column is why `--platform` narrows *rows* here, not columns.
 *
 * `groupBy` (`--group-by`) picks what the subject cell holds: the account
 * (default) or the app. Both fall back to their unique identifier when the
 * display name is missing.
 *
 * `e.ios`/`e.android` are each either `null` — that platform's counts
 * couldn't be fetched, degrading every cell on its row, TOTAL and BUILD MIN
 * included, to "-" — or `{ success, errored, canceled, buildDurationMs }`.
 * TOTAL sums exactly the first three, so a build EAS reports in some
 * non-terminal status is counted nowhere. BUILD MIN is `buildDurationMs`
 * (summed `Build.metrics.buildDuration` for that same TOTAL set — queue
 * wait is deliberately excluded) converted to minutes, one decimal place.
 */
export function toStatsDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map(), groupBy = 'account', now = new Date() } = {}
) {
  const platforms = statsPlatforms(platform);
  const rows = [];

  for (const e of entries) {
    const subjectCell =
      groupBy === 'app' ? e.app || e.appSlug : (accountDisplayNames.get(e.account) ?? e.account);
    const periodText = periodCell(e, now);
    for (const p of platforms) {
      const counts = e[p];
      const total = counts ? counts.success + counts.errored + counts.canceled : null;
      const buildMinutes = counts ? (counts.buildDurationMs / 60_000).toFixed(1) : null;
      rows.push([
        subjectCell,
        periodText,
        p,
        cellOrDash(counts?.success),
        cellOrDash(counts?.errored),
        cellOrDash(counts?.canceled),
        cellOrDash(total),
        cellOrDash(buildMinutes),
      ]);
    }
  }

  return rows;
}

/**
 * `START → END`, where END is `(today)` for the current month so it doesn't
 * read like a confirmed final count for a month that hasn't finished, and the
 * inclusive last day otherwise (`periodEnd` is an exclusive boundary).
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

/** Always these 5, since PLATFORM is its own column rather than a per-column suffix. */
export function statsBuildsHeaders() {
  return ['SUCCESS', 'ERRORED', 'CANCELED', 'TOTAL', 'BUILD MIN'];
}

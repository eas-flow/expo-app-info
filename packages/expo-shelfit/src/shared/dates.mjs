// Every *boundary* this CLI computes (calendarMonths, inclusiveEnd) and every
// date-only display (isoDate) is UTC, no opt-out: countBuildsByMonth compares
// these directly against build createdAt timestamps, so making any of them
// timezone-aware would silently move builds into the wrong month.
// formatBuildDate's display timestamp is the one exception --local switches.

/**
 * `count` UTC calendar-month boundaries ending with the month containing
 * `now`, newest first. `end` is exclusive — the instant the next month
 * starts. Date.UTC normalizes an out-of-range month (-1 becomes December of
 * the prior year), so no year/month rollover arithmetic is needed.
 */
export function calendarMonths(count, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return Array.from({ length: count }, (_, i) => {
    const targetMonth = month - i;
    return {
      start: new Date(Date.UTC(year, targetMonth, 1)).toISOString(),
      end: new Date(Date.UTC(year, targetMonth + 1, 1)).toISOString(),
    };
  });
}

/** ISO 8601 timestamp → YYYY-MM-DD, for the human table only. */
export function isoDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `calendarMonths`' `end` is *exclusive* — the instant the next month starts
 * (July ends at 2026-08-01T00:00:00Z). Shown as-is in --stats' PERIOD that
 * reads like "runs into August", so the column shows `end` minus one day.
 */
export function inclusiveEnd(iso) {
  return new Date(new Date(iso).getTime() - ONE_DAY_MS).toISOString();
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * ISO 8601 timestamp -> "YYYY/MM/DD-HH:mm:ss" (or "YYYY-MM-DD" with
 * `{ time: false }`, used by the BUILD/SUBMIT/UPDATE columns, none of which
 * show time-of-day) for the human table. UTC by default; `{ local: true }`
 * (--local) is the only non-UTC date this CLI will ever display.
 */
export function formatBuildDate(iso, { local = false, time = true } = {}) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const [year, month, day, hours, minutes, seconds] = local
    ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
    : [
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
      ];
  if (!time) return `${year}-${pad2(month)}-${pad2(day)}`;
  return `${year}/${pad2(month)}/${pad2(day)}-${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Current local UTC offset as "+HH:MM", for the `BUILD (+09:00)` /
 * `SUBMIT (+09:00)` / `UPDATE (+09:00)` header --local adds to every date
 * column. Computed once as of `now`, not per row: a table spanning a DST
 * transition would need two offsets and the header can only show one — an
 * accepted limitation.
 */
export function localOffset(now = new Date()) {
  // getTimezoneOffset() returns minutes to add to local time to reach UTC —
  // the inverse sign of the "+09:00 = ahead of UTC" convention (Tokyo: -540).
  const totalMinutes = -now.getTimezoneOffset();
  const sign = totalMinutes < 0 ? '-' : '+';
  const absMinutes = Math.abs(totalMinutes);
  return `${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
}

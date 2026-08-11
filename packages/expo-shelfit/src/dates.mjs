// UTC date helpers shared across the CLI's layers. Every *boundary* this CLI
// computes (calendarMonths, inclusiveEnd) and every date-only display
// (isoDate — --stats' PERIOD, --plan's TRIAL END) is UTC, full stop, no
// opt-out — so calendar-month bucketing stays reproducible and comparable
// with EAS's own dashboard (design rule: 期間境界は UTC 固定). The one
// exception is formatBuildDate's *display* timestamp (BUILD DATE), which
// `--local` can switch to the machine's local timezone (design rule: 表示
// タイムスタンプのみ切り替え可) — see #85. Never make calendarMonths,
// inclusiveEnd, or isoDate timezone-aware: countBuildsByMonth compares their
// UTC output directly against build createdAt timestamps, and shifting that
// boundary would silently move builds into the wrong month.

/**
 * UTC calendar-month boundaries for `--stats`, `count` months ending with
 * the month containing `now`, ordered newest first (index 0 is
 * the current, still-in-progress month). Each entry is `{ start, end }`
 * ISO 8601, with `end` exclusive (the instant the next month starts) —
 * matching the convention the old billingPeriod.end used, so the rest of the
 * codebase (inclusiveEnd/isoDate below) can treat both the same way.
 *
 * Calendar boundaries (unlike the old billing-period chaining, which needed
 * the previous period's `start` before it could compute the next one) can
 * all be computed upfront from `now` alone — `Date.UTC` normalizes
 * out-of-range months (e.g. month `-1` becomes December of the prior year),
 * so no manual year/month-rollover arithmetic is needed here.
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
 * EAS's `billingPeriod.end` is an *exclusive* boundary — the instant the
 * next period starts (e.g. a July period ends at 2026-08-01T00:00:00Z), not
 * the last moment of the period. Displayed as-is that reads like "runs into
 * August" for a period that is entirely July, so the human table shows the
 * last day the period actually covers instead: `end` minus one day.
 */
export function inclusiveEnd(iso) {
  return new Date(new Date(iso).getTime() - ONE_DAY_MS).toISOString();
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * ISO 8601 timestamp -> "YYYY/MM/DD-HH:mm:ss", for the human table's BUILD
 * DATE column (an absolute timestamp was requested over the relative "3d
 * ago" style so the exact build time is visible without doing the math).
 * UTC by default, matching every other date shown by this CLI (`isoDate`,
 * `inclusiveEnd` above); pass `{ local: true }` (--local) to read it in the
 * machine's local timezone instead (`TZ` env var, or the system default) —
 * this is the *only* date this CLI will ever display non-UTC, see the
 * module comment above.
 */
export function formatBuildDate(iso, { local = false } = {}) {
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
  return `${year}/${pad2(month)}/${pad2(day)}-${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Current local UTC offset as "+HH:MM" / "-HH:MM" (e.g. "+09:00" for Tokyo,
 * "-05:00" for New York in winter, "+05:30" for Kolkata's 30-minute offset)
 * — for the `BUILD DATE (+09:00)` header `--local` adds (src/format.mjs).
 * Computed once "as of now", not per row: `Date#getTimezoneOffset()` is only
 * accurate for the instant it's called on, so a table whose rows span a DST
 * transition could show a header offset that's off by an hour for some
 * rows — an accepted tradeoff for a header that has to show one number
 * (see issue #85's "未確定事項").
 */
export function localOffset(now = new Date()) {
  // getTimezoneOffset() returns *minutes to add to local time to reach
  // UTC*, the inverse sign of the "+09:00 = ahead of UTC" convention below
  // (Tokyo is UTC+9, but getTimezoneOffset() there returns -540).
  const totalMinutes = -now.getTimezoneOffset();
  const sign = totalMinutes < 0 ? '-' : '+';
  const absMinutes = Math.abs(totalMinutes);
  return `${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
}

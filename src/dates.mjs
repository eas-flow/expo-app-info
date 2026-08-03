// UTC date helpers shared across the CLI's layers. Every boundary and
// formatted timestamp this CLI shows is UTC — never the machine's local
// timezone — so output is reproducible and comparable with EAS's own
// dashboard (design rule: 期間境界は UTC 固定).

/**
 * UTC calendar-month boundaries for `--usage` (issue #18), `count` months
 * ending with the month containing `now`, ordered newest first (index 0 is
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
 * last day the period actually covers instead: `end` minus one day. Only
 * cosmetic — `--json`/`--csv` still emit the raw, unmodified `periodEnd`.
 */
export function inclusiveEnd(iso) {
  return new Date(new Date(iso).getTime() - ONE_DAY_MS).toISOString();
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * ISO 8601 timestamp -> "YYYY/MM/DD-HH:mm:ss", for the human table's BUILD
 * DATE column (issue #17 follow-up: an absolute timestamp was requested over
 * the relative "3d ago" style so the exact build time is visible without
 * doing the math). Always UTC, matching every other date shown by this CLI
 * (`isoDate`, `inclusiveEnd` above) so output does not depend on the
 * machine's local timezone. `--json`/`--csv` are unaffected — they keep the
 * raw ISO 8601 `lastBuildAt` value.
 */
export function formatBuildDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}-` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
}

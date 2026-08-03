import { describe, expect, it } from 'vitest';
import { formatBuildDate } from '../src/dates.mjs';

describe('formatBuildDate', () => {
  it('returns "-" for a missing date', () => {
    expect(formatBuildDate(null)).toBe('-');
    expect(formatBuildDate(undefined)).toBe('-');
  });

  it('returns "-" for an invalid date string', () => {
    expect(formatBuildDate('not-a-date')).toBe('-');
  });

  it('formats an ISO timestamp as YYYY/MM/DD-HH:mm:ss in UTC', () => {
    expect(formatBuildDate('2026-07-26T09:12:34.000Z')).toBe('2026/07/26-09:12:34');
  });

  it('zero-pads single-digit month, day, hour, minute, and second', () => {
    expect(formatBuildDate('2026-01-02T03:04:05.000Z')).toBe('2026/01/02-03:04:05');
  });

  it('reads the timestamp in UTC regardless of any local timezone', () => {
    // 2026-07-26T23:30:00Z is 2026-07-27 in timezones ahead of UTC — this
    // must still print the UTC date/time, not a locally-shifted one.
    expect(formatBuildDate('2026-07-26T23:30:00.000Z')).toBe('2026/07/26-23:30:00');
  });
});

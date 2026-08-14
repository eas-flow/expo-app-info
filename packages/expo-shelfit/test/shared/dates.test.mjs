import { afterEach, describe, expect, it } from 'vitest';
import { formatBuildDate, localOffset } from '../../src/shared/dates.mjs';

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

  it('defaults to UTC when { local: true } is not passed, even with TZ set', () => {
    withTz('Asia/Tokyo', () => {
      expect(formatBuildDate('2026-07-26T09:12:34.000Z')).toBe('2026/07/26-09:12:34');
    });
  });
});

describe('formatBuildDate with { time: false }', () => {
  it('drops the time-of-day, returning YYYY-MM-DD', () => {
    expect(formatBuildDate('2026-07-26T09:12:34.000Z', { time: false })).toBe('2026-07-26');
  });

  it('still returns "-" for a missing/invalid date', () => {
    expect(formatBuildDate(null, { time: false })).toBe('-');
    expect(formatBuildDate('not-a-date', { time: false })).toBe('-');
  });

  it('combines with { local: true } to shift the calendar day, not just drop the time', () => {
    withTz('Asia/Tokyo', () => {
      // 23:30 UTC + 9h rolls into the next local calendar day.
      expect(formatBuildDate('2026-07-26T23:30:00.000Z', { local: true, time: false })).toBe(
        '2026-07-27'
      );
    });
  });
});

// Sets process.env.TZ for the duration of `fn`, restoring the previous value
// afterward — Node/V8 reads TZ per-call for Date's local getters, so this is
// enough to make --local's output deterministic in tests regardless of the
// machine actually running them.
function withTz(tz, fn) {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe('formatBuildDate with { local: true }', () => {
  afterEach(() => {
    delete process.env.TZ;
  });

  it('reads the timestamp in Asia/Tokyo (UTC+9, no DST)', () => {
    withTz('Asia/Tokyo', () => {
      // 09:12:34 UTC + 9h = 18:12:34, same calendar day.
      expect(formatBuildDate('2026-07-26T09:12:34.000Z', { local: true })).toBe(
        '2026/07/26-18:12:34'
      );
    });
  });

  it('rolls over to the next local calendar day when the UTC offset pushes past midnight', () => {
    withTz('Asia/Tokyo', () => {
      expect(formatBuildDate('2026-07-26T23:30:00.000Z', { local: true })).toBe(
        '2026/07/27-08:30:00'
      );
    });
  });

  it('matches plain UTC output when TZ is UTC', () => {
    withTz('UTC', () => {
      expect(formatBuildDate('2026-07-26T09:12:34.000Z', { local: true })).toBe(
        '2026/07/26-09:12:34'
      );
    });
  });

  it('applies the DST-adjusted offset for America/New_York in summer (UTC-4)', () => {
    withTz('America/New_York', () => {
      expect(formatBuildDate('2026-07-26T09:12:34.000Z', { local: true })).toBe(
        '2026/07/26-05:12:34'
      );
    });
  });

  it('applies the standard-time offset for America/New_York in winter (UTC-5)', () => {
    withTz('America/New_York', () => {
      expect(formatBuildDate('2026-01-26T09:12:34.000Z', { local: true })).toBe(
        '2026/01/26-04:12:34'
      );
    });
  });

  it('returns "-" for a missing/invalid date regardless of { local: true }', () => {
    withTz('Asia/Tokyo', () => {
      expect(formatBuildDate(null, { local: true })).toBe('-');
      expect(formatBuildDate('not-a-date', { local: true })).toBe('-');
    });
  });

  it('does not throw for an unrecognized TZ value (falls back to UTC-like behavior)', () => {
    withTz('Not/A-Real-Zone', () => {
      expect(() => formatBuildDate('2026-07-26T09:12:34.000Z', { local: true })).not.toThrow();
    });
  });
});

describe('localOffset', () => {
  afterEach(() => {
    delete process.env.TZ;
  });

  it('formats a positive (ahead-of-UTC) offset as "+HH:MM"', () => {
    withTz('Asia/Tokyo', () => {
      expect(localOffset(new Date('2026-07-26T00:00:00.000Z'))).toBe('+09:00');
    });
  });

  it('formats a negative (behind-UTC) offset as "-HH:MM"', () => {
    withTz('America/New_York', () => {
      // Summer (DST): UTC-4.
      expect(localOffset(new Date('2026-07-26T00:00:00.000Z'))).toBe('-04:00');
    });
  });

  it('formats the same negative offset in winter (standard-time) as "-05:00"', () => {
    withTz('America/New_York', () => {
      expect(localOffset(new Date('2026-01-26T00:00:00.000Z'))).toBe('-05:00');
    });
  });

  it('formats a half-hour offset (Asia/Kolkata, +05:30)', () => {
    withTz('Asia/Kolkata', () => {
      expect(localOffset(new Date('2026-07-26T00:00:00.000Z'))).toBe('+05:30');
    });
  });

  it('is "+00:00" for UTC', () => {
    withTz('UTC', () => {
      expect(localOffset(new Date('2026-07-26T00:00:00.000Z'))).toBe('+00:00');
    });
  });
});

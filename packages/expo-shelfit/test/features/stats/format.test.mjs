import { describe, expect, it } from 'vitest';
import { statsBuildsHeaders, toStatsDisplayRows } from '../../../src/features/stats/format.mjs';

const NOW = new Date('2026-07-15T00:00:00.000Z');

const currentMonthEntry = {
  account: 'myorg',
  ios: { success: 18, errored: 3, canceled: 2, buildDurationMs: 1_380_000 },
  android: { success: 16, errored: 1, canceled: 0, buildDurationMs: 1_020_000 },
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
};

const pastMonthEntry = {
  account: 'myorg',
  ios: { success: 14, errored: 0, canceled: 1, buildDurationMs: 900_000 },
  android: { success: 15, errored: 2, canceled: 0, buildDurationMs: 1_020_000 },
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
};

// A degraded account: periodStart/periodEnd are still known upfront, since
// calendar months don't depend on the account — only the counts are null.
const degradedMonthEntry = {
  account: 'other',
  ios: null,
  android: null,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
};

describe('toStatsDisplayRows', () => {
  it('maps an account-month to two rows (ios, then android): [account, period, platform, success, errored, canceled, total, buildMin]', () => {
    expect(toStatsDisplayRows([pastMonthEntry], { now: NOW })).toEqual([
      ['myorg', '2026-06-01 → 2026-06-30', 'ios', '14', '0', '1', '15', '15.0'],
      ['myorg', '2026-06-01 → 2026-06-30', 'android', '15', '2', '0', '17', '17.0'],
    ]);
  });

  it('shows "(today)" as the period end for the still-in-progress current month, on both platform rows', () => {
    const rows = toStatsDisplayRows([currentMonthEntry], { now: NOW });
    expect(rows[0][1]).toBe('2026-07-01 → (today)');
    expect(rows[1][1]).toBe('2026-07-01 → (today)');
  });

  it("shows the last inclusive day of a finished month, not the API's exclusive end", () => {
    const row = toStatsDisplayRows([pastMonthEntry], { now: NOW })[0];
    expect(row[1]).toBe('2026-06-01 → 2026-06-30');
  });

  it('shows "-" for every category, TOTAL, and BUILD MIN on both rows when the account is degraded (fetch failure)', () => {
    expect(toStatsDisplayRows([degradedMonthEntry], { now: NOW })).toEqual([
      ['other', '2026-06-01 → 2026-06-30', 'ios', '-', '-', '-', '-', '-'],
      ['other', '2026-06-01 → 2026-06-30', 'android', '-', '-', '-', '-', '-'],
    ]);
  });

  it('renders a zero build count as "0", not "-", and TOTAL/BUILD MIN as 0/0.0', () => {
    const row = toStatsDisplayRows(
      [{ ...pastMonthEntry, ios: { success: 0, errored: 0, canceled: 0, buildDurationMs: 0 } }],
      { now: NOW }
    )[0];
    expect(row).toEqual(['myorg', '2026-06-01 → 2026-06-30', 'ios', '0', '0', '0', '0', '0.0']);
  });

  it('computes TOTAL as success + errored + canceled', () => {
    const [iosRow, androidRow] = toStatsDisplayRows([pastMonthEntry], { now: NOW });
    expect(iosRow[6]).toBe('15'); // 14 + 0 + 1
    expect(androidRow[6]).toBe('17'); // 15 + 2 + 0
  });

  it('computes BUILD MIN as buildDurationMs / 60000, one decimal place', () => {
    const [iosRow, androidRow] = toStatsDisplayRows([pastMonthEntry], { now: NOW });
    expect(iosRow[7]).toBe('15.0'); // 900,000ms
    expect(androidRow[7]).toBe('17.0'); // 1,020,000ms
  });

  it('shows only the ios row when --platform ios is set', () => {
    const rows = toStatsDisplayRows([pastMonthEntry], { platform: 'ios', now: NOW });
    expect(rows).toEqual([
      ['myorg', '2026-06-01 → 2026-06-30', 'ios', '14', '0', '1', '15', '15.0'],
    ]);
  });

  it('shows only the android row when --platform android is set', () => {
    const rows = toStatsDisplayRows([pastMonthEntry], { platform: 'android', now: NOW });
    expect(rows).toEqual([
      ['myorg', '2026-06-01 → 2026-06-30', 'android', '15', '2', '0', '17', '17.0'],
    ]);
  });

  it('shows "-" for the period when periodStart/periodEnd are both missing', () => {
    const row = toStatsDisplayRows([{ ...pastMonthEntry, periodStart: null, periodEnd: null }], {
      now: NOW,
    })[0];
    expect(row[1]).toBe('-');
  });

  it('shows the account display name instead of the slug when mapped (table-only), on both rows', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    const rows = toStatsDisplayRows([pastMonthEntry], { accountDisplayNames, now: NOW });
    expect(rows[0][0]).toBe('My Organization');
    expect(rows[1][0]).toBe('My Organization');
  });

  it('falls back to the slug when no accountDisplayNames map is given', () => {
    const row = toStatsDisplayRows([pastMonthEntry], { now: NOW })[0];
    expect(row[0]).toBe('myorg');
  });

  it('defaults `now` to the current time when not given', () => {
    expect(() => toStatsDisplayRows([pastMonthEntry])).not.toThrow();
  });

  // --group-by app: only the first column changes; every other cell,
  // and the row/platform structure, stays exactly as it is above.
  describe('with groupBy: "app"', () => {
    const appEntry = { ...pastMonthEntry, app: 'Storefront', appSlug: 'storefront' };

    it('puts the app name in the first column instead of the account', () => {
      expect(toStatsDisplayRows([appEntry], { groupBy: 'app', now: NOW })).toEqual([
        ['Storefront', '2026-06-01 → 2026-06-30', 'ios', '14', '0', '1', '15', '15.0'],
        ['Storefront', '2026-06-01 → 2026-06-30', 'android', '15', '2', '0', '17', '17.0'],
      ]);
    });

    it('falls back to the app slug when the app has no display name', () => {
      const row = toStatsDisplayRows([{ ...appEntry, app: '' }], { groupBy: 'app', now: NOW })[0];
      expect(row[0]).toBe('storefront');
    });

    it('ignores accountDisplayNames — that map is for the ACCOUNT column only', () => {
      const accountDisplayNames = new Map([['myorg', 'My Organization']]);
      const row = toStatsDisplayRows([appEntry], {
        groupBy: 'app',
        accountDisplayNames,
        now: NOW,
      })[0];
      expect(row[0]).toBe('Storefront');
    });

    it('prints an app with no builds as a row of zeros, not as "-" or a missing row', () => {
      const zeroEntry = {
        ...appEntry,
        ios: { success: 0, errored: 0, canceled: 0, buildDurationMs: 0 },
        android: { success: 0, errored: 0, canceled: 0, buildDurationMs: 0 },
      };
      expect(toStatsDisplayRows([zeroEntry], { groupBy: 'app', now: NOW })).toEqual([
        ['Storefront', '2026-06-01 → 2026-06-30', 'ios', '0', '0', '0', '0', '0.0'],
        ['Storefront', '2026-06-01 → 2026-06-30', 'android', '0', '0', '0', '0', '0.0'],
      ]);
    });

    it('still degrades a failed app to "-" on every cell including TOTAL and BUILD MIN', () => {
      const rows = toStatsDisplayRows([{ ...appEntry, ios: null, android: null }], {
        groupBy: 'app',
        now: NOW,
      });
      expect(rows[0].slice(3)).toEqual(['-', '-', '-', '-', '-']);
      expect(rows[1].slice(3)).toEqual(['-', '-', '-', '-', '-']);
    });

    it('keeps two same-named apps on their own rows rather than merging them', () => {
      const other = { ...appEntry, appSlug: 'storefront-eu' };
      const rows = toStatsDisplayRows([appEntry, other], { groupBy: 'app', now: NOW });
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r[0])).toEqual([
        'Storefront',
        'Storefront',
        'Storefront',
        'Storefront',
      ]);
    });

    it('defaults to the account column when groupBy is omitted', () => {
      const row = toStatsDisplayRows([appEntry], { now: NOW })[0];
      expect(row[0]).toBe('myorg');
    });
  });
});

describe('statsBuildsHeaders', () => {
  it('always returns SUCCESS, ERRORED, CANCELED, TOTAL, BUILD MIN — PLATFORM is a separate column now', () => {
    expect(statsBuildsHeaders()).toEqual(['SUCCESS', 'ERRORED', 'CANCELED', 'TOTAL', 'BUILD MIN']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDateHeader,
  planConcurrencyHeader,
  statsBuildsHeaders,
  toDisplayRows,
  toPlanDisplayRows,
  toStatsDisplayRows,
} from '../src/format.mjs';

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

const withBuild = {
  account: 'myorg',
  app: 'Storefront',
  slug: 'storefront',
  platform: 'ios',
  version: '3.2.1',
  build: '41',
  status: 'FINISHED',
  lastBuildAt: '2026-07-26T00:00:00.000Z',
};

const noBuild = {
  account: 'myorg',
  app: 'Prototype',
  slug: 'prototype',
  platform: null,
  version: null,
  build: null,
  status: null,
  lastBuildAt: null,
};

describe('toDisplayRows', () => {
  it('maps a built entry to display strings with an absolute UTC build date', () => {
    expect(toDisplayRows([withBuild])).toEqual([
      [
        'myorg',
        'Storefront',
        'storefront',
        'ios',
        '3.2.1',
        '41',
        'Finished',
        '2026/07/26-00:00:00',
      ],
    ]);
  });

  it('maps a no-build entry to "-" placeholders', () => {
    expect(toDisplayRows([noBuild])).toEqual([
      ['myorg', 'Prototype', 'prototype', '-', '-', '-', '-', '-'],
    ]);
  });

  it('shows the account slug when no accountDisplayNames map is given', () => {
    expect(toDisplayRows([withBuild])[0][0]).toBe('myorg');
  });

  it('shows the account display name instead of the slug when mapped (table-only)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    expect(toDisplayRows([withBuild], { accountDisplayNames })[0][0]).toBe('My Organization');
  });

  it('falls back to the slug when the map has no entry for this account', () => {
    const accountDisplayNames = new Map([['other', 'Other Org']]);
    expect(toDisplayRows([withBuild], { accountDisplayNames })[0][0]).toBe('myorg');
  });

  it('shows the UTC build date by default even with { local: false } omitted', () => {
    expect(toDisplayRows([withBuild])[0][7]).toBe('2026/07/26-00:00:00');
  });

  it('shows the local build date when { local: true } is passed', () => {
    withTz('Asia/Tokyo', () => {
      expect(toDisplayRows([withBuild], { local: true })[0][7]).toBe('2026/07/26-09:00:00');
    });
  });

  it('shows Errored/Canceled for the STATUS column', () => {
    expect(toDisplayRows([{ ...withBuild, status: 'ERRORED' }])[0][6]).toBe('Errored');
    expect(toDisplayRows([{ ...withBuild, status: 'CANCELED' }])[0][6]).toBe('Canceled');
  });

  it('falls back to the raw status lowercased when it is not FINISHED/ERRORED/CANCELED', () => {
    expect(toDisplayRows([{ ...withBuild, status: 'IN_PROGRESS' }])[0][6]).toBe('in_progress');
  });
});

describe('buildDateHeader', () => {
  afterEach(() => {
    delete process.env.TZ;
  });

  it('is plain "BUILD DATE" by default', () => {
    expect(buildDateHeader()).toBe('BUILD DATE');
    expect(buildDateHeader(false)).toBe('BUILD DATE');
  });

  it('appends the current local UTC offset when local is true', () => {
    withTz('Asia/Tokyo', () => {
      expect(buildDateHeader(true)).toBe('BUILD DATE (+09:00)');
    });
  });
});

const NOW = new Date('2026-07-15T00:00:00.000Z');

// Current (still in progress) month: 2026-07-01 -> 2026-08-01 (exclusive).
const currentMonthEntry = {
  account: 'myorg',
  ios: { success: 18, errored: 3, canceled: 2 },
  android: { success: 16, errored: 1, canceled: 0 },
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
};

// A finished past month: 2026-06-01 -> 2026-07-01 (exclusive).
const pastMonthEntry = {
  account: 'myorg',
  ios: { success: 14, errored: 0, canceled: 1 },
  android: { success: 15, errored: 2, canceled: 0 },
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
};

// A degraded account (app/build fetch failed) — periodStart/periodEnd are
// still known upfront (calendar months don't depend on the account), only
// the build counts are null.
const degradedMonthEntry = {
  account: 'other',
  ios: null,
  android: null,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
};

describe('toStatsDisplayRows', () => {
  it('maps an account-month to two rows (ios, then android): [account, period, platform, success, errored, canceled, total]', () => {
    expect(toStatsDisplayRows([pastMonthEntry], { now: NOW })).toEqual([
      ['myorg', '2026-06-01 → 2026-06-30', 'ios', '14', '0', '1', '15'],
      ['myorg', '2026-06-01 → 2026-06-30', 'android', '15', '2', '0', '17'],
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

  it('shows "-" for every category and TOTAL on both rows when the account is degraded (fetch failure)', () => {
    expect(toStatsDisplayRows([degradedMonthEntry], { now: NOW })).toEqual([
      ['other', '2026-06-01 → 2026-06-30', 'ios', '-', '-', '-', '-'],
      ['other', '2026-06-01 → 2026-06-30', 'android', '-', '-', '-', '-'],
    ]);
  });

  it('renders a zero build count as "0", not "-", and TOTAL as the sum', () => {
    const row = toStatsDisplayRows(
      [{ ...pastMonthEntry, ios: { success: 0, errored: 0, canceled: 0 } }],
      { now: NOW }
    )[0];
    expect(row).toEqual(['myorg', '2026-06-01 → 2026-06-30', 'ios', '0', '0', '0', '0']);
  });

  it('computes TOTAL as success + errored + canceled', () => {
    const [iosRow, androidRow] = toStatsDisplayRows([pastMonthEntry], { now: NOW });
    expect(iosRow[6]).toBe('15'); // 14 + 0 + 1
    expect(androidRow[6]).toBe('17'); // 15 + 2 + 0
  });

  it('shows only the ios row when --platform ios is set', () => {
    const rows = toStatsDisplayRows([pastMonthEntry], { platform: 'ios', now: NOW });
    expect(rows).toEqual([['myorg', '2026-06-01 → 2026-06-30', 'ios', '14', '0', '1', '15']]);
  });

  it('shows only the android row when --platform android is set', () => {
    const rows = toStatsDisplayRows([pastMonthEntry], { platform: 'android', now: NOW });
    expect(rows).toEqual([['myorg', '2026-06-01 → 2026-06-30', 'android', '15', '2', '0', '17']]);
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
});

describe('statsBuildsHeaders', () => {
  it('always returns SUCCESS, ERRORED, CANCELED, TOTAL — PLATFORM is a separate column now', () => {
    expect(statsBuildsHeaders()).toEqual(['SUCCESS', 'ERRORED', 'CANCELED', 'TOTAL']);
  });
});

const planEntry = {
  account: 'myorg',
  plan: 'Production',
  planId: 'production',
  status: 'active',
  concurrencyTotal: 2,
  concurrencyIos: 1,
  concurrencyAndroid: 1,
  trialEnd: null,
};

const planEntryTrialing = {
  account: 'myorg',
  plan: 'Production',
  planId: 'production',
  status: 'trialing',
  concurrencyTotal: 2,
  concurrencyIos: 1,
  concurrencyAndroid: 1,
  trialEnd: '2026-08-15T00:00:00.000Z',
};

const planEntryNoPlan = {
  account: 'other',
  plan: null,
  planId: null,
  status: null,
  concurrencyTotal: null,
  concurrencyIos: null,
  concurrencyAndroid: null,
  trialEnd: null,
};

describe('toPlanDisplayRows', () => {
  it('maps an account with a plan to display strings, combining all three concurrency numbers', () => {
    expect(toPlanDisplayRows([planEntry])).toEqual([
      ['myorg', 'Production', 'production', 'active', '2 / 1 / 1', '-'],
    ]);
  });

  it('shows the trial end date as YYYY-MM-DD when set', () => {
    const row = toPlanDisplayRows([planEntryTrialing])[0];
    expect(row[5]).toBe('2026-08-15');
  });

  it('shows "-" for every unavailable plan field', () => {
    expect(toPlanDisplayRows([planEntryNoPlan])).toEqual([['other', '-', '-', '-', '-', '-']]);
  });

  it("reports only that platform's concurrency when --platform is set", () => {
    const iosRow = toPlanDisplayRows([planEntry], { platform: 'ios' })[0];
    expect(iosRow[4]).toBe('1');

    const androidRow = toPlanDisplayRows([planEntry], { platform: 'android' })[0];
    expect(androidRow[4]).toBe('1');
  });

  it('renders a zero concurrency as "0", not "-"', () => {
    const row = toPlanDisplayRows([
      { ...planEntry, concurrencyTotal: 0, concurrencyIos: 0, concurrencyAndroid: 0 },
    ])[0];
    expect(row[4]).toBe('0 / 0 / 0');
  });

  it('shows the account display name instead of the slug when mapped (table-only)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    const row = toPlanDisplayRows([planEntry], { accountDisplayNames })[0];
    expect(row[0]).toBe('My Organization');
  });

  it('falls back to the slug when no accountDisplayNames map is given', () => {
    const row = toPlanDisplayRows([planEntry])[0];
    expect(row[0]).toBe('myorg');
  });
});

describe('planConcurrencyHeader', () => {
  it('labels the column per platform filter', () => {
    expect(planConcurrencyHeader(null)).toBe('CONCURRENCY (TOTAL/IOS/AND)');
    expect(planConcurrencyHeader('ios')).toBe('CONCURRENCY (IOS)');
    expect(planConcurrencyHeader('android')).toBe('CONCURRENCY (ANDROID)');
  });
});

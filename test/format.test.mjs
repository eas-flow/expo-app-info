import { describe, expect, it } from 'vitest';
import {
  formatCSV,
  formatJSON,
  PLAN_FIELDS,
  planConcurrencyHeader,
  toDisplayRows,
  toPlanDisplayRows,
  toUsageDisplayRows,
  USAGE_FIELDS,
  usageBuildsHeaders,
} from '../src/format.mjs';

const withBuild = {
  account: 'myorg',
  app: 'Storefront',
  slug: 'storefront',
  platform: 'ios',
  version: '3.2.1',
  build: '41',
  lastBuildAt: '2026-07-26T00:00:00.000Z',
};

const noBuild = {
  account: 'myorg',
  app: 'Prototype',
  slug: 'prototype',
  platform: null,
  version: null,
  build: null,
  lastBuildAt: null,
};

describe('toDisplayRows', () => {
  it('maps a built entry to display strings with an absolute UTC build date', () => {
    expect(toDisplayRows([withBuild])).toEqual([
      ['myorg', 'Storefront', 'storefront', 'ios', '3.2.1', '41', '2026/07/26-00:00:00'],
    ]);
  });

  it('maps a no-build entry to "-" placeholders', () => {
    expect(toDisplayRows([noBuild])).toEqual([
      ['myorg', 'Prototype', 'prototype', '-', '-', '-', '-'],
    ]);
  });

  it('shows the account slug when no accountDisplayNames map is given', () => {
    expect(toDisplayRows([withBuild])[0][0]).toBe('myorg');
  });

  it('shows the account display name instead of the slug when mapped (table-only, issue #22)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    expect(toDisplayRows([withBuild], { accountDisplayNames })[0][0]).toBe('My Organization');
  });

  it('falls back to the slug when the map has no entry for this account', () => {
    const accountDisplayNames = new Map([['other', 'Other Org']]);
    expect(toDisplayRows([withBuild], { accountDisplayNames })[0][0]).toBe('myorg');
  });
});

describe('formatJSON', () => {
  it('serializes entries as a pretty-printed array, preserving null', () => {
    const out = formatJSON([noBuild]);
    expect(JSON.parse(out)).toEqual([noBuild]);
    expect(out).toContain('\n'); // pretty-printed, not a single line
  });

  it('serializes an empty array as "[]"', () => {
    expect(formatJSON([])).toBe('[]');
  });
});

describe('formatCSV', () => {
  it('writes a header row plus one row per entry', () => {
    const out = formatCSV([withBuild]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('account,app,slug,platform,version,build,lastBuildAt');
    expect(lines[1]).toBe('myorg,Storefront,storefront,ios,3.2.1,41,2026-07-26T00:00:00.000Z');
  });

  it('renders null fields as empty cells', () => {
    const out = formatCSV([noBuild]);
    expect(out.split('\n')[1]).toBe('myorg,Prototype,prototype,,,,');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const out = formatCSV([{ ...withBuild, app: 'Foo, "Bar"\nBaz' }]);
    expect(out).toContain('"Foo, ""Bar""\nBaz"');
  });

  it('writes just the header row for an empty array', () => {
    expect(formatCSV([])).toBe('account,app,slug,platform,version,build,lastBuildAt');
  });
});

const NOW = new Date('2026-07-15T00:00:00.000Z');

// Current (still in progress) month: 2026-07-01 -> 2026-08-01 (exclusive).
const currentMonthEntry = {
  account: 'myorg',
  buildsIos: 18,
  buildsAndroid: 16,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
};

// A finished past month: 2026-06-01 -> 2026-07-01 (exclusive).
const pastMonthEntry = {
  account: 'myorg',
  buildsIos: 14,
  buildsAndroid: 15,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
};

// A degraded account (app/build fetch failed) — periodStart/periodEnd are
// still known upfront (calendar months don't depend on the account), only
// the build counts are null.
const degradedMonthEntry = {
  account: 'other',
  buildsIos: null,
  buildsAndroid: null,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
};

describe('toUsageDisplayRows', () => {
  it('maps an account-month to [account, period, ios builds, android builds]', () => {
    expect(toUsageDisplayRows([pastMonthEntry], { now: NOW })).toEqual([
      ['myorg', '2026-06-01 → 2026-06-30', '14', '15'],
    ]);
  });

  it('shows "(today)" as the period end for the still-in-progress current month', () => {
    const row = toUsageDisplayRows([currentMonthEntry], { now: NOW })[0];
    expect(row[1]).toBe('2026-07-01 → (today)');
  });

  it("shows the last inclusive day of a finished month, not the API's exclusive end", () => {
    const row = toUsageDisplayRows([pastMonthEntry], { now: NOW })[0];
    expect(row[1]).toBe('2026-06-01 → 2026-06-30');
  });

  it('shows "-" for both build counts when the account is degraded (fetch failure)', () => {
    expect(toUsageDisplayRows([degradedMonthEntry], { now: NOW })).toEqual([
      ['other', '2026-06-01 → 2026-06-30', '-', '-'],
    ]);
  });

  it('renders a zero build count as "0", not "-"', () => {
    const row = toUsageDisplayRows([{ ...pastMonthEntry, buildsIos: 0, buildsAndroid: 0 }], {
      now: NOW,
    })[0];
    expect(row[2]).toBe('0');
    expect(row[3]).toBe('0');
  });

  it('shows only the ios column when --platform ios is set', () => {
    const row = toUsageDisplayRows([pastMonthEntry], { platform: 'ios', now: NOW })[0];
    expect(row).toEqual(['myorg', '2026-06-01 → 2026-06-30', '14']);
  });

  it('shows only the android column when --platform android is set', () => {
    const row = toUsageDisplayRows([pastMonthEntry], { platform: 'android', now: NOW })[0];
    expect(row).toEqual(['myorg', '2026-06-01 → 2026-06-30', '15']);
  });

  it('shows "-" for the period when periodStart/periodEnd are both missing', () => {
    const row = toUsageDisplayRows([{ ...pastMonthEntry, periodStart: null, periodEnd: null }], {
      now: NOW,
    })[0];
    expect(row[1]).toBe('-');
  });

  it('shows the account display name instead of the slug when mapped (table-only, issue #22)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    const row = toUsageDisplayRows([pastMonthEntry], { accountDisplayNames, now: NOW })[0];
    expect(row[0]).toBe('My Organization');
  });

  it('falls back to the slug when no accountDisplayNames map is given', () => {
    const row = toUsageDisplayRows([pastMonthEntry], { now: NOW })[0];
    expect(row[0]).toBe('myorg');
  });

  it('defaults `now` to the current time when not given', () => {
    expect(() => toUsageDisplayRows([pastMonthEntry])).not.toThrow();
  });
});

describe('usageBuildsHeaders', () => {
  it('returns both platform headers by default', () => {
    expect(usageBuildsHeaders(null)).toEqual([
      'SUCCESSFUL BUILDS (IOS)',
      'SUCCESSFUL BUILDS (AND)',
    ]);
  });

  it('returns only the ios header when platform is ios', () => {
    expect(usageBuildsHeaders('ios')).toEqual(['SUCCESSFUL BUILDS (IOS)']);
  });

  it('returns only the android header when platform is android', () => {
    expect(usageBuildsHeaders('android')).toEqual(['SUCCESSFUL BUILDS (AND)']);
  });
});

describe('formatCSV with USAGE_FIELDS', () => {
  it('emits the usage header and raw values', () => {
    const csv = formatCSV([pastMonthEntry], USAGE_FIELDS);
    expect(csv.split('\n')[0]).toBe('account,buildsIos,buildsAndroid,periodStart,periodEnd');
    expect(csv.split('\n')[1]).toBe(
      'myorg,14,15,2026-06-01T00:00:00.000Z,2026-07-01T00:00:00.000Z'
    );
  });

  it('emits empty cells for a row with no build data', () => {
    expect(formatCSV([degradedMonthEntry], USAGE_FIELDS).split('\n')[1]).toBe(
      'other,,,2026-06-01T00:00:00.000Z,2026-07-01T00:00:00.000Z'
    );
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

  it('shows the account display name instead of the slug when mapped (table-only, issue #22)', () => {
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

describe('formatCSV with PLAN_FIELDS', () => {
  it('emits the plan header and raw values', () => {
    const csv = formatCSV([planEntryTrialing], PLAN_FIELDS);
    expect(csv.split('\n')[0]).toBe(
      'account,plan,planId,status,concurrencyTotal,concurrencyIos,concurrencyAndroid,trialEnd'
    );
    expect(csv.split('\n')[1]).toBe(
      'myorg,Production,production,trialing,2,1,1,2026-08-15T00:00:00.000Z'
    );
  });

  it('emits empty cells for a row with no plan data', () => {
    expect(formatCSV([planEntryNoPlan], PLAN_FIELDS).split('\n')[1]).toBe('other,,,,,,,');
  });
});

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
  usageBuildsHeader,
  usageConcurrencyHeader,
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

const usageEntry = {
  account: 'myorg',
  plan: 'Production',
  planId: 'production',
  status: 'active',
  concurrencyTotal: 3,
  concurrencyIos: 2,
  concurrencyAndroid: 1,
  buildsIos: 23,
  buildsAndroid: 11,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
};

const usageEntryNoPlan = {
  account: 'other',
  plan: null,
  planId: null,
  status: null,
  concurrencyTotal: null,
  concurrencyIos: null,
  concurrencyAndroid: null,
  buildsIos: null,
  buildsAndroid: null,
  periodStart: null,
  periodEnd: null,
};

describe('toUsageDisplayRows', () => {
  it('maps an account with a plan to display strings, summing builds across platforms', () => {
    expect(toUsageDisplayRows([usageEntry])).toEqual([
      ['myorg', 'Production', 'active', '3', '34', '2026-07-01 → 2026-07-31'],
    ]);
  });

  it("shows the last inclusive day of the period, not the API's exclusive end", () => {
    // billingPeriod.end from the API is the instant the *next* period
    // starts (2026-08-01T00:00:00Z for a July period) — the table should
    // read "→ 2026-07-31", not "→ 2026-08-01".
    const row = toUsageDisplayRows([usageEntry])[0];
    expect(row[5]).toBe('2026-07-01 → 2026-07-31');
  });

  it('handles a period end that is not exactly midnight', () => {
    const row = toUsageDisplayRows([
      {
        ...usageEntry,
        periodStart: '2026-07-15T09:00:00.000Z',
        periodEnd: '2026-08-15T09:00:00.000Z',
      },
    ])[0];
    expect(row[5]).toBe('2026-07-15 → 2026-08-14');
  });

  it('shows "-" for every unavailable plan field', () => {
    expect(toUsageDisplayRows([usageEntryNoPlan])).toEqual([['other', '-', '-', '-', '-', '-']]);
  });

  it('reports the platform concurrency and build count when --platform is set', () => {
    const iosRow = toUsageDisplayRows([usageEntry], { platform: 'ios' })[0];
    expect(iosRow[3]).toBe('2');
    expect(iosRow[4]).toBe('23');

    const androidRow = toUsageDisplayRows([usageEntry], { platform: 'android' })[0];
    expect(androidRow[3]).toBe('1');
    expect(androidRow[4]).toBe('11');
  });

  it('renders a zero concurrency as "0", not "-"', () => {
    const row = toUsageDisplayRows([{ ...usageEntry, concurrencyTotal: 0 }])[0];
    expect(row[3]).toBe('0');
  });

  it('renders a zero build count as "0", not "-"', () => {
    const row = toUsageDisplayRows([{ ...usageEntry, buildsIos: 0, buildsAndroid: 0 }])[0];
    expect(row[4]).toBe('0');
  });

  it('shows "-" when only one end of the billing period is known', () => {
    const row = toUsageDisplayRows([{ ...usageEntry, periodEnd: null }])[0];
    expect(row[5]).toBe('-');
  });

  it('shows the account display name instead of the slug when mapped (table-only, issue #22)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    const row = toUsageDisplayRows([usageEntry], { accountDisplayNames })[0];
    expect(row[0]).toBe('My Organization');
  });

  it('falls back to the slug when no accountDisplayNames map is given', () => {
    const row = toUsageDisplayRows([usageEntry])[0];
    expect(row[0]).toBe('myorg');
  });
});

describe('usageConcurrencyHeader', () => {
  it('labels the column per platform filter', () => {
    expect(usageConcurrencyHeader(null)).toBe('CONCURRENCY');
    expect(usageConcurrencyHeader('ios')).toBe('CONCURRENCY (IOS)');
    expect(usageConcurrencyHeader('android')).toBe('CONCURRENCY (ANDROID)');
  });
});

describe('usageBuildsHeader', () => {
  it('labels the column per platform filter', () => {
    expect(usageBuildsHeader(null)).toBe('BUILDS');
    expect(usageBuildsHeader('ios')).toBe('BUILDS (IOS)');
    expect(usageBuildsHeader('android')).toBe('BUILDS (ANDROID)');
  });
});

describe('formatCSV with USAGE_FIELDS', () => {
  it('emits the usage header and raw values', () => {
    const csv = formatCSV([usageEntry], USAGE_FIELDS);
    expect(csv.split('\n')[0]).toBe(
      'account,plan,planId,status,concurrencyTotal,concurrencyIos,concurrencyAndroid,buildsIos,buildsAndroid,periodStart,periodEnd'
    );
    expect(csv.split('\n')[1]).toBe(
      'myorg,Production,production,active,3,2,1,23,11,2026-07-01T00:00:00.000Z,2026-08-01T00:00:00.000Z'
    );
  });

  it('emits empty cells for a row with no plan data', () => {
    expect(formatCSV([usageEntryNoPlan], USAGE_FIELDS).split('\n')[1]).toBe('other,,,,,,,,,,');
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

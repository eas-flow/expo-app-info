import { describe, expect, it } from 'vitest';
import {
  formatCSV,
  formatJSON,
  toDisplayRows,
  toUsageDisplayRows,
  USAGE_FIELDS,
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
  it('maps a built entry to display strings with a relative date', () => {
    const now = new Date('2026-07-29T00:00:00.000Z').getTime();
    expect(toDisplayRows([withBuild], { now })).toEqual([
      ['myorg', 'Storefront', 'storefront', 'ios', '3.2.1', '41', '3d ago'],
    ]);
  });

  it('maps a no-build entry to "-" placeholders', () => {
    expect(toDisplayRows([noBuild])).toEqual([
      ['myorg', 'Prototype', 'prototype', '-', '-', '-', '-'],
    ]);
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
  periodStart: null,
  periodEnd: null,
};

describe('toUsageDisplayRows', () => {
  it('maps an account with a plan to display strings', () => {
    expect(toUsageDisplayRows([usageEntry])).toEqual([
      ['myorg', 'Production', 'active', '3', '2026-07-01 → 2026-08-01'],
    ]);
  });

  it('shows "-" for every unavailable plan field', () => {
    expect(toUsageDisplayRows([usageEntryNoPlan])).toEqual([['other', '-', '-', '-', '-']]);
  });

  it('reports the platform concurrency when --platform is set', () => {
    expect(toUsageDisplayRows([usageEntry], { platform: 'ios' })[0][3]).toBe('2');
    expect(toUsageDisplayRows([usageEntry], { platform: 'android' })[0][3]).toBe('1');
  });

  it('renders a zero concurrency as "0", not "-"', () => {
    const row = toUsageDisplayRows([{ ...usageEntry, concurrencyTotal: 0 }])[0];
    expect(row[3]).toBe('0');
  });

  it('shows "-" when only one end of the billing period is known', () => {
    const row = toUsageDisplayRows([{ ...usageEntry, periodEnd: null }])[0];
    expect(row[4]).toBe('-');
  });
});

describe('usageConcurrencyHeader', () => {
  it('labels the column per platform filter', () => {
    expect(usageConcurrencyHeader(null)).toBe('CONCURRENCY');
    expect(usageConcurrencyHeader('ios')).toBe('CONCURRENCY (IOS)');
    expect(usageConcurrencyHeader('android')).toBe('CONCURRENCY (ANDROID)');
  });
});

describe('formatCSV with USAGE_FIELDS', () => {
  it('emits the usage header and raw values', () => {
    const csv = formatCSV([usageEntry], USAGE_FIELDS);
    expect(csv.split('\n')[0]).toBe(
      'account,plan,planId,status,concurrencyTotal,concurrencyIos,concurrencyAndroid,periodStart,periodEnd'
    );
    expect(csv.split('\n')[1]).toBe(
      'myorg,Production,production,active,3,2,1,2026-07-01T00:00:00.000Z,2026-08-01T00:00:00.000Z'
    );
  });

  it('emits empty cells for a row with no plan data', () => {
    expect(formatCSV([usageEntryNoPlan], USAGE_FIELDS).split('\n')[1]).toBe('other,,,,,,,,');
  });
});

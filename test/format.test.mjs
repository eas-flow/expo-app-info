import { describe, expect, it } from 'vitest';
import { formatCSV, formatJSON, toDisplayRows } from '../src/format.mjs';

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

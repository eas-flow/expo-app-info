import { afterEach, describe, expect, it } from 'vitest';
import { buildDateHeader, toDisplayRows } from '../../../src/features/list/format.mjs';

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
  sdk: '54.0.0',
  cli: '18.0.4',
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
  sdk: null,
  cli: null,
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
        '54.0.0',
        '18.0.4',
        'Finished',
        '2026/07/26-00:00:00',
      ],
    ]);
  });

  it('maps a no-build entry to "-" placeholders', () => {
    expect(toDisplayRows([noBuild])).toEqual([
      ['myorg', 'Prototype', 'prototype', '-', '-', '-', '-', '-', '-', '-'],
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
    expect(toDisplayRows([withBuild])[0][9]).toBe('2026/07/26-00:00:00');
  });

  it('shows the local build date when { local: true } is passed', () => {
    withTz('Asia/Tokyo', () => {
      expect(toDisplayRows([withBuild], { local: true })[0][9]).toBe('2026/07/26-09:00:00');
    });
  });

  it('shows Errored/Canceled for the STATUS column', () => {
    expect(toDisplayRows([{ ...withBuild, status: 'ERRORED' }])[0][8]).toBe('Errored');
    expect(toDisplayRows([{ ...withBuild, status: 'CANCELED' }])[0][8]).toBe('Canceled');
  });

  it('falls back to the raw status lowercased when it is not FINISHED/ERRORED/CANCELED', () => {
    expect(toDisplayRows([{ ...withBuild, status: 'IN_PROGRESS' }])[0][8]).toBe('in_progress');
  });

  it('shows SDK/CLI versions when present', () => {
    expect(toDisplayRows([withBuild])[0][6]).toBe('54.0.0');
    expect(toDisplayRows([withBuild])[0][7]).toBe('18.0.4');
  });

  it('shows "-" for SDK/CLI when absent', () => {
    expect(toDisplayRows([noBuild])[0][6]).toBe('-');
    expect(toDisplayRows([noBuild])[0][7]).toBe('-');
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

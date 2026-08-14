import { afterEach, describe, expect, it } from 'vitest';
import { dateColumnHeader, toDisplayRows } from '../../../src/features/list/format.mjs';

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
  app: 'storefront',
  platform: 'ios',
  version: '3.2.1',
  build: '41',
  sdk: '54.0.0',
  cli: '18.0.4',
  status: 'FINISHED',
  lastBuildAt: '2026-07-26T00:00:00.000Z',
  submissionStatus: 'FINISHED',
  submissionCreatedAt: '2026-07-25T00:00:00.000Z',
  updateBranch: 'production',
  updateCreatedAt: '2026-07-24T00:00:00.000Z',
};

const noBuild = {
  account: 'myorg',
  app: 'prototype',
  platform: null,
  version: null,
  build: null,
  sdk: null,
  cli: null,
  status: null,
  lastBuildAt: null,
  submissionStatus: null,
  submissionCreatedAt: null,
  updateBranch: null,
  updateCreatedAt: null,
};

describe('toDisplayRows', () => {
  it('maps a built entry to display strings: ACCOUNT/APP/PLATFORM/VERSION/SDK/CLI/BUILD/SUBMIT/UPDATE', () => {
    expect(toDisplayRows([withBuild])).toEqual([
      [
        'myorg',
        'storefront',
        'ios',
        '3.2.1 (41)',
        '54.0.0',
        '18.0.4',
        'Finished 2026-07-26',
        'Finished 2026-07-25',
        'production 2026-07-24',
      ],
    ]);
  });

  it('maps a no-build entry to "-" placeholders', () => {
    expect(toDisplayRows([noBuild])).toEqual([
      ['myorg', 'prototype', '-', '-', '-', '-', '-', '-', '-'],
    ]);
  });

  it('shows just the version with no parentheses when there is no build number', () => {
    const row = toDisplayRows([{ ...withBuild, build: null }])[0];
    expect(row[3]).toBe('3.2.1');
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

  it('shows the UTC BUILD/SUBMIT/UPDATE date by default even with { local: false } omitted', () => {
    const row = toDisplayRows([withBuild])[0];
    expect(row[6]).toBe('Finished 2026-07-26');
    expect(row[7]).toBe('Finished 2026-07-25');
    expect(row[8]).toBe('production 2026-07-24');
  });

  it('shifts BUILD/SUBMIT/UPDATE to the local calendar day when { local: true } is passed', () => {
    withTz('Asia/Tokyo', () => {
      const late = {
        ...withBuild,
        lastBuildAt: '2026-07-26T23:30:00.000Z',
        submissionCreatedAt: '2026-07-26T23:30:00.000Z',
        updateCreatedAt: '2026-07-26T23:30:00.000Z',
      };
      const row = toDisplayRows([late], { local: true })[0];
      expect(row[6]).toBe('Finished 2026-07-27');
      expect(row[7]).toBe('Finished 2026-07-27');
      expect(row[8]).toBe('production 2026-07-27');
    });
  });

  it('shows Errored/Canceled for the BUILD column', () => {
    expect(toDisplayRows([{ ...withBuild, status: 'ERRORED' }])[0][6]).toBe('Errored 2026-07-26');
    expect(toDisplayRows([{ ...withBuild, status: 'CANCELED' }])[0][6]).toBe('Canceled 2026-07-26');
  });

  it('falls back to the raw build status lowercased when it is not FINISHED/ERRORED/CANCELED', () => {
    expect(toDisplayRows([{ ...withBuild, status: 'IN_PROGRESS' }])[0][6]).toBe(
      'in_progress 2026-07-26'
    );
  });

  it('shows "In queue" for a SUBMIT status of IN_QUEUE', () => {
    expect(toDisplayRows([{ ...withBuild, submissionStatus: 'IN_QUEUE' }])[0][7]).toBe(
      'In queue 2026-07-25'
    );
  });

  it('falls back to the raw submission status lowercased when it is not FINISHED/IN_QUEUE', () => {
    expect(toDisplayRows([{ ...withBuild, submissionStatus: 'AWAITING_BUILD' }])[0][7]).toBe(
      'awaiting_build 2026-07-25'
    );
  });

  it('shows the update branch name in UPDATE', () => {
    expect(toDisplayRows([{ ...withBuild, updateBranch: 'preview' }])[0][8]).toBe(
      'preview 2026-07-24'
    );
  });

  it('shows SDK/CLI versions when present', () => {
    expect(toDisplayRows([withBuild])[0][4]).toBe('54.0.0');
    expect(toDisplayRows([withBuild])[0][5]).toBe('18.0.4');
  });

  it('shows "-" for SDK/CLI when absent', () => {
    expect(toDisplayRows([noBuild])[0][4]).toBe('-');
    expect(toDisplayRows([noBuild])[0][5]).toBe('-');
  });
});

describe('dateColumnHeader', () => {
  afterEach(() => {
    delete process.env.TZ;
  });

  it('is the plain column name by default', () => {
    expect(dateColumnHeader('BUILD')).toBe('BUILD');
    expect(dateColumnHeader('SUBMIT', false)).toBe('SUBMIT');
  });

  it('appends the current local UTC offset when local is true', () => {
    withTz('Asia/Tokyo', () => {
      expect(dateColumnHeader('BUILD', true)).toBe('BUILD (+09:00)');
      expect(dateColumnHeader('SUBMIT', true)).toBe('SUBMIT (+09:00)');
      expect(dateColumnHeader('UPDATE', true)).toBe('UPDATE (+09:00)');
    });
  });
});

// Aggregation-focused tests for fetchStatsEntries, exercised directly
// against a fake client (fetchApps/countBuildsByMonth) rather than through
// run() + a mocked global fetch. Bucketing builds into a month/status is
// countBuildsByMonth's job and stays covered in test/shared/api.test.mjs;
// what belongs here is what fetchStatsEntries does with those counts once
// it has them — summing per app into per-account totals, splitting per app
// under --group-by app, and degrading only what actually failed.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/errors.mjs';
import { fetchStatsEntries } from '../../../src/features/stats/service.mjs';

const NOW = new Date('2026-07-15T00:00:00.000Z');

const zero = () => ({ success: 0, errored: 0, canceled: 0 });

// Every test here uses month: 1, so countBuildsByMonth's parallel array has
// exactly one element and each group ends up as exactly one entry.
const opts = (overrides = {}) => ({
  month: 1,
  platform: null,
  app: null,
  groupBy: null,
  ...overrides,
});

function onePeriod(ios, android) {
  return [{ ios, android }];
}

function addCounts(a, b) {
  return {
    success: a.success + b.success,
    errored: a.errored + b.errored,
    canceled: a.canceled + b.canceled,
  };
}

/** `apps`/`counts` values that are an Error are thrown instead of resolved, mirroring the real client's ApiError contract. */
function makeClient({ apps = {}, counts = {} } = {}) {
  const calls = { fetchApps: 0, countBuildsByMonth: [] };
  return {
    calls,
    async fetchApps(accountId) {
      calls.fetchApps++;
      const result = apps[accountId];
      if (result instanceof Error) throw result;
      return result ?? [];
    },
    async countBuildsByMonth(appId) {
      calls.countBuildsByMonth.push(appId);
      const result = counts[appId];
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('fetchStatsEntries — groupBy: account (default)', () => {
  it('sums every app in an account into one account-month entry', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Admin', slug: 'admin' },
        ],
      },
      counts: {
        'app-1': onePeriod(
          { success: 2, errored: 1, canceled: 0 },
          { success: 1, errored: 0, canceled: 1 }
        ),
        'app-2': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()),
      },
    });

    const { entries, groupCount, byApp, warnings } = await fetchStatsEntries(
      client,
      accounts,
      opts(),
      NOW
    );

    expect(byApp).toBe(false);
    expect(groupCount).toBe(1);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      account: 'myorg',
      app: null,
      appSlug: null,
      ios: { success: 3, errored: 1, canceled: 0 },
      android: { success: 1, errored: 0, canceled: 1 },
    });
  });

  it('degrades the whole account to null totals when its app list fetch fails, and records one warning', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({ apps: { 'acc-1': new ApiError('boom') } });

    const { entries, warnings } = await fetchStatsEntries(client, accounts, opts(), NOW);

    expect(entries[0].ios).toBeNull();
    expect(entries[0].android).toBeNull();
    expect(warnings).toEqual(['myorg: boom']);
  });

  it('degrades the whole account to null totals when any one of its apps fails to fetch counts', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Admin', slug: 'admin' },
        ],
      },
      counts: {
        'app-1': onePeriod({ success: 2, errored: 0, canceled: 0 }, zero()),
        'app-2': new ApiError('boom'),
      },
    });

    const { entries, warnings } = await fetchStatsEntries(client, accounts, opts(), NOW);

    expect(entries[0].ios).toBeNull();
    expect(entries[0].android).toBeNull();
    expect(warnings).toEqual(['myorg: boom']);
  });

  it('reports warnings in account order, not fetch-completion order', async () => {
    const accounts = [
      { id: 'acc-1', name: 'first' },
      { id: 'acc-2', name: 'second' },
    ];
    const client = makeClient({
      apps: { 'acc-1': new ApiError('boom-1'), 'acc-2': new ApiError('boom-2') },
    });

    const { warnings } = await fetchStatsEntries(client, accounts, opts(), NOW);

    expect(warnings).toEqual(['first: boom-1', 'second: boom-2']);
  });
});

describe('fetchStatsEntries — groupBy: app', () => {
  it('per-app sums equal the per-account sum for the same underlying data — the regression that matters', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const apps = {
      'acc-1': [
        { id: 'app-1', name: 'Storefront', slug: 'storefront' },
        { id: 'app-2', name: 'Admin', slug: 'admin' },
      ],
    };
    const counts = {
      'app-1': onePeriod(
        { success: 2, errored: 1, canceled: 0 },
        { success: 1, errored: 0, canceled: 1 }
      ),
      'app-2': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()),
    };

    const byAccount = await fetchStatsEntries(makeClient({ apps, counts }), accounts, opts(), NOW);
    const byApp = await fetchStatsEntries(
      makeClient({ apps, counts }),
      accounts,
      opts({ groupBy: 'app' }),
      NOW
    );

    expect(byApp.entries).toHaveLength(2);
    const summed = byApp.entries.reduce(
      (acc, e) => ({ ios: addCounts(acc.ios, e.ios), android: addCounts(acc.android, e.android) }),
      { ios: zero(), android: zero() }
    );
    expect(summed).toEqual({
      ios: byAccount.entries[0].ios,
      android: byAccount.entries[0].android,
    });
  });

  it('costs no extra client calls versus groupBy: account — per-app counts are fetched either way', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const apps = { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] };
    const counts = { 'app-1': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()) };

    const accountClient = makeClient({ apps, counts });
    await fetchStatsEntries(accountClient, accounts, opts(), NOW);

    const appClient = makeClient({ apps, counts });
    await fetchStatsEntries(appClient, accounts, opts({ groupBy: 'app' }), NOW);

    expect(appClient.calls.countBuildsByMonth.length).toBe(
      accountClient.calls.countBuildsByMonth.length
    );
  });

  it('emits a zero-count group for an app with no builds, rather than omitting it', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Admin', slug: 'admin' }] },
      counts: { 'app-1': onePeriod(zero(), zero()) },
    });

    const { entries } = await fetchStatsEntries(client, accounts, opts({ groupBy: 'app' }), NOW);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ app: 'Admin', ios: zero(), android: zero() });
  });

  it('degrades only the failing app to null totals, leaving the other app intact', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Admin', slug: 'admin' },
        ],
      },
      counts: {
        'app-1': onePeriod({ success: 2, errored: 0, canceled: 0 }, zero()),
        'app-2': new ApiError('boom'),
      },
    });

    const { entries, warnings } = await fetchStatsEntries(
      client,
      accounts,
      opts({ groupBy: 'app' }),
      NOW
    );

    const storefront = entries.find((e) => e.app === 'Storefront');
    const admin = entries.find((e) => e.app === 'Admin');
    expect(storefront.ios).toEqual({ success: 2, errored: 0, canceled: 0 });
    expect(admin.ios).toBeNull();
    expect(admin.android).toBeNull();
    expect(warnings.join('\n')).toContain('admin');
  });

  it('keeps same-named apps in different accounts as separate groups instead of summing them', async () => {
    const accounts = [
      { id: 'acc-1', name: 'myorg' },
      { id: 'acc-2', name: 'otherorg' },
    ];
    const client = makeClient({
      apps: {
        'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }],
        'acc-2': [{ id: 'app-2', name: 'Storefront', slug: 'storefront-eu' }],
      },
      counts: {
        'app-1': onePeriod({ success: 2, errored: 0, canceled: 0 }, zero()),
        'app-2': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()),
      },
    });

    const { entries, groupCount } = await fetchStatsEntries(
      client,
      accounts,
      opts({ groupBy: 'app' }),
      NOW
    );

    expect(groupCount).toBe(2);
    expect(entries.map((e) => e.appSlug).sort()).toEqual(['storefront', 'storefront-eu']);
  });

  it('emits no group for an account whose app list failed — only a warning names it', async () => {
    const accounts = [
      { id: 'acc-1', name: 'myorg' },
      { id: 'acc-2', name: 'otherorg' },
    ];
    const client = makeClient({
      apps: {
        'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }],
        'acc-2': new ApiError('nope'),
      },
      counts: { 'app-1': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()) },
    });

    const { entries, groupCount, warnings } = await fetchStatsEntries(
      client,
      accounts,
      opts({ groupBy: 'app' }),
      NOW
    );

    expect(groupCount).toBe(1);
    expect(entries.every((e) => e.account !== 'otherorg')).toBe(true);
    expect(warnings.join('\n')).toContain('otherorg');
  });

  it('--app narrows to the matching app by slug before its counts are ever fetched', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Admin', slug: 'admin' },
        ],
      },
      counts: {
        'app-1': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()),
        'app-2': onePeriod({ success: 9, errored: 0, canceled: 0 }, zero()),
      },
    });

    const { entries, groupCount } = await fetchStatsEntries(
      client,
      accounts,
      opts({ groupBy: 'app', app: 'admin' }),
      NOW
    );

    expect(groupCount).toBe(1);
    expect(entries[0].app).toBe('Admin');
    expect(client.calls.countBuildsByMonth).toEqual(['app-2']);
  });

  it('--app also matches the EAS Display name, same as the slug', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'sf-ios-app' }] },
      counts: { 'app-1': onePeriod({ success: 1, errored: 0, canceled: 0 }, zero()) },
    });

    const { entries } = await fetchStatsEntries(
      client,
      accounts,
      opts({ groupBy: 'app', app: 'Storefront' }),
      NOW
    );

    expect(entries[0].appSlug).toBe('sf-ios-app');
  });
});

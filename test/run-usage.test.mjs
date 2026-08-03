import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.mjs';
import { jsonResponse } from './helpers.mjs';

describe('run --usage', () => {
  let logSpy;
  let errorSpy;
  let originalToken;

  // Pinned "now" so calendarMonths()'s default window (last 3 months) and
  // the table's current-month "(today)" marker are deterministic:
  // July (current, in progress), June, May.
  const NOW = new Date('2026-07-15T12:00:00.000Z');

  const accountsResponse = jsonResponse({
    data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } },
  });

  const singleAppResponse = jsonResponse({
    data: {
      account: {
        byId: {
          id: 'acc-1',
          appsPaginated: {
            edges: [{ node: { id: 'app-1', name: 'Storefront', slug: 'storefront' } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });

  // ios: 2 in July, 1 in June, 1 in May, 1 in April (outside the 3-month
  // default window — must not be counted). android: 1 in July, 2 in June.
  // Well under BUILD_PAGE_SIZE (50) on both platforms, so pagination stops
  // after a single page regardless of --month.
  const buildsPageResponse = jsonResponse({
    data: {
      app: {
        byId: {
          id: 'app-1',
          ios: [
            { createdAt: '2026-07-05T00:00:00.000Z' },
            { createdAt: '2026-07-10T00:00:00.000Z' },
            { createdAt: '2026-06-15T00:00:00.000Z' },
            { createdAt: '2026-05-20T00:00:00.000Z' },
            { createdAt: '2026-04-25T00:00:00.000Z' },
          ],
          android: [
            { createdAt: '2026-07-08T00:00:00.000Z' },
            { createdAt: '2026-06-01T00:00:00.000Z' },
            { createdAt: '2026-06-25T00:00:00.000Z' },
          ],
        },
      },
    },
  });

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalToken = process.env.EXPO_TOKEN;
    process.env.EXPO_TOKEN = 'test-token';
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.EXPO_TOKEN;
    else process.env.EXPO_TOKEN = originalToken;
  });

  it('fetches accounts, apps, and a single builds page — no subscription/billing query at all', async () => {
    const responses = [accountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--usage']);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', offset: 0, limit: 50 });

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('SUCCESSFUL BUILDS (IOS)');
    expect(output).toContain('SUCCESSFUL BUILDS (AND)');
    expect(output).not.toContain('PLAN');
    expect(output).not.toContain('SLUG');
  });

  it('emits 3 rows (one per account per month, newest first) with client-side successful-build counts', async () => {
    const responses = [accountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      {
        account: 'myorg',
        buildsIos: 2,
        buildsAndroid: 1,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
      },
      {
        account: 'myorg',
        buildsIos: 1,
        buildsAndroid: 2,
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-07-01T00:00:00.000Z',
      },
      {
        account: 'myorg',
        buildsIos: 1,
        buildsAndroid: 0,
        periodStart: '2026-05-01T00:00:00.000Z',
        periodEnd: '2026-06-01T00:00:00.000Z',
      },
    ]);
  });

  it('emits the 5-field usage header for --csv', async () => {
    const responses = [accountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--csv']);

    const csv = logSpy.mock.calls[0][0];
    expect(csv.split('\n')[0]).toBe('account,buildsIos,buildsAndroid,periodStart,periodEnd');
    expect(csv.split('\n')[1]).toBe('myorg,2,1,2026-07-01T00:00:00.000Z,2026-08-01T00:00:00.000Z');
  });

  it('shows "(today)" for the current month and the inclusive last day for finished months', async () => {
    const responses = [accountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('2026-07-01 → (today)');
    expect(output).toContain('2026-06-01 → 2026-06-30');
    expect(output).toContain('2026-05-01 → 2026-05-31');
  });

  it('--month widens the window (e.g. --month 1 shows only the current month)', async () => {
    const responses = [accountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--month', '1', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].periodStart).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects with CliError when --month is used without --usage', async () => {
    await expect(run(['--month', '6'])).rejects.toThrow(/--month can only be used with --usage/);
  });

  it('shows only the requested platform column with --platform', async () => {
    const responses = [accountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--platform', 'ios']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('SUCCESSFUL BUILDS (IOS)');
    expect(output).not.toContain('SUCCESSFUL BUILDS (AND)');
  });

  it('degrades a whole account to null build counts (not a failed run) when its apps/builds fetch fails', async () => {
    const responses = [accountsResponse, jsonResponse({ errors: [{ message: 'boom' }] })];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(3);
    for (const row of parsed) {
      expect(row.buildsIos).toBeNull();
      expect(row.buildsAndroid).toBeNull();
      expect(row.periodStart).not.toBeNull();
      expect(row.periodEnd).not.toBeNull();
    }
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('usage unavailable');
  });

  it('shows the account display name in the --usage table when set (issue #22)', async () => {
    const displayNameAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
        },
      },
    });
    const responses = [displayNameAccountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--csv']);

    const csv = logSpy.mock.calls[0][0];
    expect(csv.split('\n')[0]).toBe('account,buildsIos,buildsAndroid,periodStart,periodEnd');
    expect(csv.split('\n')[1]).toBe('myorg,2,1,2026-07-01T00:00:00.000Z,2026-08-01T00:00:00.000Z');
  });

  it('keeps the account slug — not the display name — in --usage --json output (issue #22)', async () => {
    const displayNameAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
        },
      },
    });
    const responses = [displayNameAccountsResponse, singleAppResponse, buildsPageResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('2026-07-01 → (today)');
    expect(output).toContain('2026-06-01 → 2026-06-30');
    expect(output).toContain('2026-05-01 → 2026-05-31');
  });

  it('fetches accounts (and their apps/builds) in parallel rather than a strictly sequential loop', async () => {
    // Both accounts' apps/builds fetches can legitimately interleave under
    // mapWithConcurrency (unlike --plan's single-hop fetchSubscription, this
    // account task has two internal awaits: fetchApps then
    // countBuildsByMonth), so the mock routes by query name + variables
    // instead of assuming a fixed call order.
    const twoAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [
            { id: 'acc-1', name: 'myorg' },
            { id: 'acc-2', name: 'otherorg' },
          ],
        },
      },
    });

    const appsResponseFor = (accountId) =>
      jsonResponse({
        data: {
          account: {
            byId: {
              id: accountId,
              appsPaginated: {
                edges: [{ node: { id: `app-${accountId}`, name: 'App', slug: 'app' } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      });

    const buildsResponseFor = (appId) =>
      jsonResponse({
        data: {
          app: {
            byId: {
              id: appId,
              ios: [{ createdAt: '2026-07-05T00:00:00.000Z' }],
              android: [],
            },
          },
        },
      });

    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      if (body.query.includes('CurrentAccounts')) return twoAccountsResponse;
      if (body.query.includes('AccountApps')) return appsResponseFor(body.variables.accountId);
      if (body.query.includes('BuildsPage')) return buildsResponseFor(body.variables.appId);
      throw new Error(`unexpected query in test: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--usage', '--month', '1', '--json']);

    expect(calls).toBe(5); // 1 accounts + 2 apps + 2 builds pages
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.account).sort()).toEqual(['myorg', 'otherorg']);
  });
});

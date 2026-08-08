import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, mapWithConcurrency } from '../src/api.mjs';

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { status, ok, json: async () => body };
}

describe('gql (via createApiClient)', () => {
  it('throws ApiError on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401, ok: false }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(ApiError);
    await expect(client.fetchAccounts()).rejects.toThrow(/Authentication failed/);
  });

  it('throws ApiError on 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 403, ok: false }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/Authentication failed/);
  });

  it('throws ApiError on a non-2xx status that is not 401/403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500, ok: false }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/HTTP 500/);
  });

  it('surfaces the GraphQL error message when a 400 response has one, instead of a bare status', async () => {
    // The EAS API returns validation errors (e.g. a missing required
    // argument) as HTTP 400 with a normal { errors: [...] } GraphQL body,
    // not just as a transport-level failure. The real message must win.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { errors: [{ message: '"date": Field is required' }] },
          { status: 400, ok: false }
        )
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/Field is required/);
  });

  it('falls back to a bare HTTP status when a non-2xx body has no errors array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 400, ok: false }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/HTTP 400/);
  });

  it('throws ApiError when a non-2xx response body is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/HTTP 502/);
  });

  it('throws ApiError when the response has a GraphQL errors array', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ message: 'boom' }, { message: 'also boom' }] }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/GraphQL error: boom, also boom/);
  });

  it('resolves with data on success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { meActor: { accounts: [{ id: '1', name: 'acme' }] } } })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).resolves.toEqual([{ id: '1', name: 'acme' }]);
  });

  it('forwards displayName when the API returns one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { meActor: { accounts: [{ id: '1', name: 'acme', displayName: 'Acme Corp' }] } },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).resolves.toEqual([
      { id: '1', name: 'acme', displayName: 'Acme Corp' },
    ]);
  });

  it('forwards a null displayName as-is when the account has none set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { meActor: { accounts: [{ id: '1', name: 'acme', displayName: null }] } },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).resolves.toEqual([
      { id: '1', name: 'acme', displayName: null },
    ]);
  });
});

describe('fetchApps', () => {
  it('follows cursor pagination until hasNextPage is false', async () => {
    const pages = [
      {
        data: {
          account: {
            byId: {
              id: 'acc',
              appsPaginated: {
                edges: [{ node: { id: 'a1', name: 'App One', slug: 'app-one' } }],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              },
            },
          },
        },
      },
      {
        data: {
          account: {
            byId: {
              id: 'acc',
              appsPaginated: {
                edges: [{ node: { id: 'a2', name: 'App Two', slug: 'app-two' } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      },
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(pages[call++]));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const apps = await client.fetchApps('acc');
    expect(apps).toEqual([
      { id: 'a1', name: 'App One', slug: 'app-one' },
      { id: 'a2', name: 'App Two', slug: 'app-two' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('fetchBuilds', () => {
  it('defaults to limit 1 and merges ios/android builds into one array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          app: {
            byId: {
              id: 'app-1',
              ios: [
                {
                  platform: 'IOS',
                  appVersion: '3.2.1',
                  appBuildVersion: '41',
                  createdAt: '2026-07-01T00:00:00.000Z',
                },
              ],
              android: [
                {
                  platform: 'ANDROID',
                  appVersion: '3.2.0',
                  appBuildVersion: '38',
                  createdAt: '2026-06-01T00:00:00.000Z',
                },
              ],
            },
          },
        },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const builds = await client.fetchBuilds('app-1');

    expect(builds).toEqual([
      {
        platform: 'IOS',
        appVersion: '3.2.1',
        appBuildVersion: '41',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        platform: 'ANDROID',
        appVersion: '3.2.0',
        appBuildVersion: '38',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ appId: 'app-1', limit: 1 });
  });

  it('passes a custom limit through to the GraphQL variables', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { app: { byId: { id: 'app-1', ios: [], android: [] } } } })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.fetchBuilds('app-1', { limit: 5 });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ appId: 'app-1', limit: 5 });
  });

  it('returns an empty array when the app has no finished builds on either platform', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { app: { byId: { id: 'app-1', ios: [], android: [] } } } })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchBuilds('app-1')).resolves.toEqual([]);
  });

  it('sorts each platform by createdAt descending regardless of the order the API returns them in', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          app: {
            byId: {
              id: 'app-1',
              // Deliberately out of order, to prove the client does not
              // just trust the API's response order.
              ios: [
                {
                  platform: 'IOS',
                  appVersion: '1.0.0',
                  appBuildVersion: '10',
                  createdAt: '2026-05-01T00:00:00.000Z',
                },
                {
                  platform: 'IOS',
                  appVersion: '3.0.0',
                  appBuildVersion: '30',
                  createdAt: '2026-07-01T00:00:00.000Z',
                },
                {
                  platform: 'IOS',
                  appVersion: '2.0.0',
                  appBuildVersion: '20',
                  createdAt: '2026-06-01T00:00:00.000Z',
                },
              ],
              android: [
                {
                  platform: 'ANDROID',
                  appVersion: '1.0.0',
                  appBuildVersion: '5',
                  createdAt: '2026-04-01T00:00:00.000Z',
                },
                {
                  platform: 'ANDROID',
                  appVersion: '2.0.0',
                  appBuildVersion: '6',
                  createdAt: '2026-06-15T00:00:00.000Z',
                },
              ],
            },
          },
        },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const builds = await client.fetchBuilds('app-1', { limit: 3 });

    expect(builds.map((b) => b.appBuildVersion)).toEqual(['30', '20', '10', '6', '5']);
  });

  it('with platform: "ios", queries only the ios alias and returns only ios builds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          app: {
            byId: {
              id: 'app-1',
              ios: [
                {
                  platform: 'IOS',
                  appVersion: '3.2.1',
                  appBuildVersion: '41',
                  createdAt: '2026-07-01T00:00:00.000Z',
                },
              ],
            },
          },
        },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const builds = await client.fetchBuilds('app-1', { platform: 'ios' });

    expect(builds).toEqual([
      {
        platform: 'IOS',
        appVersion: '3.2.1',
        appBuildVersion: '41',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ]);

    const { query } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(query).toContain('ios:');
    expect(query).not.toContain('android:');
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return item * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('preserves result order matching input order regardless of completion order', async () => {
    const delays = [30, 10, 20, 0];
    const results = await mapWithConcurrency(delays, 4, async (delay, i) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('handles an empty items array', async () => {
    const results = await mapWithConcurrency([], 4, async () => 1);
    expect(results).toEqual([]);
  });
});

describe('countBuildsByMonth', () => {
  // Two calendar months, newest first — mirrors src/dates.mjs#calendarMonths()'s
  // shape and ordering (index 0 = current month).
  const MONTHS = [
    { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    { start: '2026-06-01T00:00:00.000Z', end: '2026-07-01T00:00:00.000Z' },
  ];

  function buildsPage(iosCreatedAts, androidCreatedAts) {
    return jsonResponse({
      data: {
        app: {
          byId: {
            id: 'app-1',
            ios: iosCreatedAts.map((createdAt) => ({ createdAt })),
            android: androidCreatedAts.map((createdAt) => ({ createdAt })),
          },
        },
      },
    });
  }

  it('buckets builds into the right platform/month, in a single page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage(
          ['2026-07-20T00:00:00.000Z', '2026-06-15T00:00:00.000Z', '2026-06-10T00:00:00.000Z'],
          ['2026-07-05T00:00:00.000Z']
        )
      );
    // Both platforms are short of BUILD_PAGE_SIZE on the first page, so
    // pagination stops there; no second page should even be requested.
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual([
      { ios: 1, android: 1 },
      { ios: 2, android: 0 },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ appId: 'app-1', offset: 0, limit: 50 });
  });

  it('ignores builds older than the oldest requested month', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage(['2026-07-01T00:00:00.000Z', '2026-05-15T00:00:00.000Z'], [])
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual([
      { ios: 1, android: 0 },
      { ios: 0, android: 0 },
    ]);
  });

  it('pages again when a platform returns a full page, stopping once a short page arrives', async () => {
    // 50 distinct minutes on the same day (not 50 distinct days — July only
    // has 31) so every build stays inside the current month bucket.
    const fullIosPage = Array.from({ length: 50 }, (_, i) =>
      new Date(Date.UTC(2026, 6, 1, 0, i)).toISOString()
    );

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(buildsPage(fullIosPage, []))
      .mockResolvedValueOnce(buildsPage(['2026-06-01T00:00:00.000Z'], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const counts = await client.countBuildsByMonth('app-1', MONTHS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.variables).toEqual({ appId: 'app-1', offset: 50, limit: 50 });

    expect(counts[0].ios).toBe(50);
    expect(counts[1].ios).toBe(1);
  });

  it('returns all-zero counts when the app has no builds at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(buildsPage([], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual([
      { ios: 0, android: 0 },
      { ios: 0, android: 0 },
    ]);
  });

  it('throws ApiError when the build query fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'boom' }] }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).rejects.toThrow(ApiError);
  });

  it('with { platform: "android" }, never requests the ios alias', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(buildsPage([], ['2026-07-05T00:00:00.000Z']));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(
      client.countBuildsByMonth('app-1', MONTHS, { platform: 'android' })
    ).resolves.toEqual([
      { ios: 0, android: 1 },
      { ios: 0, android: 0 },
    ]);

    const { query } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(query).not.toContain('ios:');
    expect(query).toContain('android:');
  });

  it("drops a done platform's alias from subsequent page queries once it finishes", async () => {
    // ios stays full-page (not done yet) into page 2; android is short on
    // page 1, so it should be done after page 1 and dropped from page 2's query.
    const fullIosPage = Array.from({ length: 50 }, (_, i) =>
      new Date(Date.UTC(2026, 6, 1, 0, i)).toISOString()
    );

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(buildsPage(fullIosPage, ['2026-07-05T00:00:00.000Z']))
      .mockResolvedValueOnce(buildsPage(['2026-06-01T00:00:00.000Z'], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.countBuildsByMonth('app-1', MONTHS);

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const firstQuery = JSON.parse(fetchImpl.mock.calls[0][1].body).query;
    expect(firstQuery).toContain('ios:');
    expect(firstQuery).toContain('android:');

    const secondQuery = JSON.parse(fetchImpl.mock.calls[1][1].body).query;
    expect(secondQuery).toContain('ios:');
    expect(secondQuery).not.toContain('android:');
  });
});

describe('fetchSubscription', () => {
  const subscriptionResponse = {
    data: {
      account: {
        byId: {
          id: 'acc-1',
          subscription: {
            id: 'sub-1',
            planId: 'production',
            name: 'Production',
            status: 'active',
            trialEnd: null,
            concurrencies: { total: 2, ios: 1, android: 1 },
          },
        },
      },
    },
  };

  it('returns the subscription for an account', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(subscriptionResponse));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchSubscription('acc-1')).resolves.toEqual(
      subscriptionResponse.data.account.byId.subscription
    );

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ accountId: 'acc-1' });
  });

  it('does not query billingPeriod or usageMetrics — a minimal, standalone query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(subscriptionResponse));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.fetchSubscription('acc-1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.query).not.toContain('billingPeriod');
    expect(body.query).not.toContain('usageMetrics');
  });

  it('returns null when the account has no subscription', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { account: { byId: { id: 'acc-1', subscription: null } } },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchSubscription('acc-1')).resolves.toBeNull();
  });

  it('throws ApiError when the account lacks billing permission', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchSubscription('acc-1')).rejects.toThrow(ApiError);
  });
});

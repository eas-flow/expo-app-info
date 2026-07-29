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

describe('fetchAccountPlan', () => {
  const NOW = new Date('2026-07-15T00:00:00.000Z');

  const planResponse = {
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
          billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
          usageMetrics: {
            byBillingPeriod: {
              planMetrics: [
                {
                  serviceMetric: 'BUILDS',
                  metricType: 'BUILD',
                  value: 34,
                  platformBreakdown: { ios: { value: 23 }, android: { value: 11 } },
                },
                {
                  serviceMetric: 'LOCAL_BUILDS',
                  metricType: 'BUILD',
                  value: 2,
                  platformBreakdown: { ios: { value: 1 }, android: { value: 1 } },
                },
              ],
            },
          },
        },
      },
    },
  };

  it('returns the subscription, billing period, and per-platform build counts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(planResponse));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountPlan('acc-1', { now: NOW })).resolves.toEqual({
      subscription: planResponse.data.account.byId.subscription,
      billingPeriod: planResponse.data.account.byId.billingPeriod,
      buildsByPlatform: { ios: 23, android: 11 },
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ accountId: 'acc-1', now: NOW.toISOString() });
  });

  it('defaults `now` to the current time when not given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(planResponse));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.fetchAccountPlan('acc-1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(() => new Date(body.variables.now).toISOString()).not.toThrow();
  });

  it('only reads the BUILDS metric, ignoring LOCAL_BUILDS and other services', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(planResponse));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const result = await client.fetchAccountPlan('acc-1', { now: NOW });
    expect(result.buildsByPlatform).toEqual({ ios: 23, android: 11 });
  });

  it('returns nulls when the account exposes no subscription or usage metrics', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          account: {
            byId: {
              id: 'acc-1',
              subscription: null,
              billingPeriod: null,
              usageMetrics: { byBillingPeriod: { planMetrics: [] } },
            },
          },
        },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountPlan('acc-1', { now: NOW })).resolves.toEqual({
      subscription: null,
      billingPeriod: null,
      buildsByPlatform: null,
    });
  });

  it('throws ApiError when the account lacks billing permission', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountPlan('acc-1', { now: NOW })).rejects.toThrow(ApiError);
  });
});

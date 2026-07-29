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

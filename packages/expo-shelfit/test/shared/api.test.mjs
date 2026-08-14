import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/errors.mjs';
import { createApiClient } from '../../src/shared/api.mjs';

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
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl, maxRetries: 0 });
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
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl, maxRetries: 0 });
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

describe('gql retry/timeout', () => {
  const accountsData = jsonResponse({ data: { meActor: { accounts: [] } } });

  it('does not retry on 401 — fails on the first attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401, ok: false }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });
    await expect(client.fetchAccounts()).rejects.toThrow(/Authentication failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable HTTP status, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, { status: 500, ok: false }))
        .mockResolvedValueOnce(jsonResponse({}, { status: 500, ok: false }))
        .mockResolvedValueOnce(accountsData);
      const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

      const promise = client.fetchAccounts();
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a network-level fetch failure, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(accountsData);
      const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

      const promise = client.fetchAccounts();
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after maxRetries and reports the attempt count', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 503, ok: false }));
      const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl, maxRetries: 2 });

      const promise = client.fetchAccounts();
      const assertion = expect(promise).rejects.toThrow(/HTTP 503.*after 3 attempt\(s\)/);
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors Retry-After on a 429 instead of the default backoff', async () => {
    vi.useFakeTimers();
    try {
      const res429 = {
        status: 429,
        ok: false,
        headers: { get: (name) => (name === 'retry-after' ? '2' : null) },
        json: async () => ({}),
      };
      const fetchImpl = vi.fn().mockResolvedValueOnce(res429).mockResolvedValueOnce(accountsData);
      const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

      const promise = client.fetchAccounts();
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('throws ApiError (not TypeError) when the account is missing from the response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { account: { byId: null } } }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchApps('acc')).rejects.toThrow(ApiError);
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

  it('throws ApiError (not TypeError) when the app is missing from the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { app: { byId: null } } }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchBuilds('app-1')).rejects.toThrow(ApiError);
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

  it('requests status and passes it through on each returned build, without filtering on it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          app: {
            byId: {
              id: 'app-1',
              ios: [
                {
                  platform: 'IOS',
                  status: 'ERRORED',
                  appVersion: '3.2.2',
                  appBuildVersion: '42',
                  createdAt: '2026-08-01T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      })
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const builds = await client.fetchBuilds('app-1');

    expect(builds[0].status).toBe('ERRORED');

    const { query } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(query).toContain('status');
    expect(query).not.toContain('status: FINISHED');
  });
});

describe('countBuildsByMonth', () => {
  // Two calendar months, newest first — mirrors src/shared/dates.mjs#calendarMonths()'s
  // shape and ordering (index 0 = current month).
  const MONTHS = [
    { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    { start: '2026-06-01T00:00:00.000Z', end: '2026-07-01T00:00:00.000Z' },
  ];

  const zero = () => ({ success: 0, errored: 0, canceled: 0, buildDurationMs: 0 });

  // `status` defaults to FINISHED so callers that don't care about status
  // bucketing (most of these tests) don't have to repeat it everywhere.
  // `buildDuration` defaults to undefined (no `metrics`), matching a build
  // whose duration metric hasn't landed yet.
  function build(createdAt, status = 'FINISHED', buildDuration) {
    return {
      createdAt,
      status,
      ...(buildDuration === undefined ? {} : { metrics: { buildDuration } }),
    };
  }

  function buildsPage(iosBuilds, androidBuilds) {
    return jsonResponse({
      data: {
        app: {
          byId: {
            id: 'app-1',
            ios: iosBuilds,
            android: androidBuilds,
          },
        },
      },
    });
  }

  it('buckets builds into the right platform/month/status, in a single page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage(
          [
            build('2026-07-20T00:00:00.000Z', 'FINISHED'),
            build('2026-06-15T00:00:00.000Z', 'ERRORED'),
            build('2026-06-10T00:00:00.000Z', 'CANCELED'),
          ],
          [build('2026-07-05T00:00:00.000Z', 'FINISHED')]
        )
      );
    // Both platforms are short of BUILD_PAGE_SIZE on the first page, so
    // pagination stops there; no second page should even be requested.
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual({
      counts: [
        {
          ios: { success: 1, errored: 0, canceled: 0, buildDurationMs: 0 },
          android: { success: 1, errored: 0, canceled: 0, buildDurationMs: 0 },
        },
        { ios: { success: 0, errored: 1, canceled: 1, buildDurationMs: 0 }, android: zero() },
      ],
      missingMetricsCount: 4,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ appId: 'app-1', offset: 0, limit: 50 });
  });

  it('does not count a build whose status is not FINISHED/ERRORED/CANCELED into any bucket', async () => {
    // Most likely a still in-progress/queued build — its exact enum name was
    // never confirmed against the real API, so an arbitrary placeholder
    // stands in here to prove the "unknown status" path, not a guessed name.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage(
          [
            build('2026-07-20T00:00:00.000Z', 'SOME_UNKNOWN_STATUS'),
            build('2026-07-21T00:00:00.000Z'),
          ],
          []
        )
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual({
      counts: [
        { ios: { success: 1, errored: 0, canceled: 0, buildDurationMs: 0 }, android: zero() },
        { ios: zero(), android: zero() },
      ],
      missingMetricsCount: 1,
    });
  });

  it('ignores builds older than the oldest requested month', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage([build('2026-07-01T00:00:00.000Z'), build('2026-05-15T00:00:00.000Z')], [])
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual({
      counts: [
        { ios: { success: 1, errored: 0, canceled: 0, buildDurationMs: 0 }, android: zero() },
        { ios: zero(), android: zero() },
      ],
      missingMetricsCount: 1,
    });
  });

  it('pages again when a platform returns a full page, stopping once a short page arrives', async () => {
    // 50 distinct minutes on the same day (not 50 distinct days — July only
    // has 31) so every build stays inside the current month bucket.
    const fullIosPage = Array.from({ length: 50 }, (_, i) =>
      build(new Date(Date.UTC(2026, 6, 1, 0, i)).toISOString())
    );

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(buildsPage(fullIosPage, []))
      .mockResolvedValueOnce(buildsPage([build('2026-06-01T00:00:00.000Z')], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const { counts } = await client.countBuildsByMonth('app-1', MONTHS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.variables).toEqual({ appId: 'app-1', offset: 50, limit: 50 });

    expect(counts[0].ios.success).toBe(50);
    expect(counts[1].ios.success).toBe(1);
  });

  it('returns all-zero counts when the app has no builds at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(buildsPage([], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual({
      counts: [
        { ios: zero(), android: zero() },
        { ios: zero(), android: zero() },
      ],
      missingMetricsCount: 0,
    });
  });

  it('throws ApiError when the build query fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'boom' }] }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).rejects.toThrow(ApiError);
  });

  it('does not count a build with an unparseable createdAt into any month', async () => {
    // Date.parse('not-a-date') is NaN, so the build must fall into no
    // bucket (index -1) rather than throwing or landing in month 0.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage([build('2026-07-20T00:00:00.000Z'), build('not-a-date')], [])
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).resolves.toEqual({
      counts: [
        { ios: { success: 1, errored: 0, canceled: 0, buildDurationMs: 0 }, android: zero() },
        { ios: zero(), android: zero() },
      ],
      missingMetricsCount: 1,
    });
  });

  it('throws ApiError (not TypeError) when the app is missing from a builds page response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { app: { byId: null } } }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).rejects.toThrow(ApiError);
  });

  it('stops after MAX_BUILD_PAGES instead of looping forever on a non-terminating page sequence', async () => {
    const fullPage = Array.from({ length: 50 }, () => build('2026-07-15T00:00:00.000Z'));
    const fetchImpl = vi.fn().mockImplementation(async () => buildsPage(fullPage, []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.countBuildsByMonth('app-1', MONTHS)).rejects.toThrow(/exceeded 200 pages/);
    expect(fetchImpl).toHaveBeenCalledTimes(200);
  });

  it('with { platform: "android" }, never requests the ios alias', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(buildsPage([], [build('2026-07-05T00:00:00.000Z')]));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(
      client.countBuildsByMonth('app-1', MONTHS, { platform: 'android' })
    ).resolves.toEqual({
      counts: [
        { ios: zero(), android: { success: 1, errored: 0, canceled: 0, buildDurationMs: 0 } },
        { ios: zero(), android: zero() },
      ],
      missingMetricsCount: 1,
    });

    const { query } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(query).not.toContain('ios:');
    expect(query).toContain('android:');
  });

  it("drops a done platform's alias from subsequent page queries once it finishes", async () => {
    // ios stays full-page (not done yet) into page 2; android is short on
    // page 1, so it should be done after page 1 and dropped from page 2's query.
    const fullIosPage = Array.from({ length: 50 }, (_, i) =>
      build(new Date(Date.UTC(2026, 6, 1, 0, i)).toISOString())
    );

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(buildsPage(fullIosPage, [build('2026-07-05T00:00:00.000Z')]))
      .mockResolvedValueOnce(buildsPage([build('2026-06-01T00:00:00.000Z')], []));
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

  it('requests status and metrics { buildDuration } (not appVersion/appBuildVersion) in the paged builds query', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(buildsPage([], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.countBuildsByMonth('app-1', MONTHS);

    const { query } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(query).toContain('status');
    expect(query).not.toContain('status: FINISHED');
    expect(query).not.toContain('appVersion');
    expect(query).toContain('metrics { buildDuration }');
  });

  it('sums metrics.buildDuration into buildDurationMs for counted builds, per platform/month', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        buildsPage(
          [
            build('2026-07-20T00:00:00.000Z', 'FINISHED', 100_000),
            build('2026-07-21T00:00:00.000Z', 'ERRORED', 50_000),
          ],
          [build('2026-06-05T00:00:00.000Z', 'FINISHED', 30_000)]
        )
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const { counts, missingMetricsCount } = await client.countBuildsByMonth('app-1', MONTHS);

    expect(counts[0].ios.buildDurationMs).toBe(150_000);
    expect(counts[1].android.buildDurationMs).toBe(30_000);
    expect(missingMetricsCount).toBe(0);
  });

  it('counts a build with no metrics.buildDuration towards missingMetricsCount, not buildDurationMs, while still counting its status', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      buildsPage(
        [
          build('2026-07-20T00:00:00.000Z', 'FINISHED', 100_000),
          build('2026-07-21T00:00:00.000Z', 'FINISHED'), // no metrics
        ],
        []
      )
    );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const { counts, missingMetricsCount } = await client.countBuildsByMonth('app-1', MONTHS);

    expect(counts[0].ios).toEqual({
      success: 2,
      errored: 0,
      canceled: 0,
      buildDurationMs: 100_000,
    });
    expect(missingMetricsCount).toBe(1);
  });

  it('does not count a build outside every requested month towards missingMetricsCount, since it was never counted at all', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(buildsPage([build('2026-05-15T00:00:00.000Z', 'FINISHED')], []));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const { missingMetricsCount } = await client.countBuildsByMonth('app-1', MONTHS);

    expect(missingMetricsCount).toBe(0);
  });
});

describe('fetchAccountMembers', () => {
  const subscription = {
    id: 'sub-1',
    planId: 'production',
    name: 'Production',
    status: 'active',
    trialEnd: null,
    concurrencies: { total: 2, ios: 1, android: 1 },
  };

  function membersPage(edges, { hasNextPage = false, endCursor = null } = {}) {
    return { edges, pageInfo: { hasNextPage, endCursor } };
  }

  function accountResponse({
    accountId = 'acc-1',
    ownerUserActor = null,
    totalCount = 0,
    page = membersPage([]),
  } = {}) {
    return jsonResponse({
      data: {
        account: {
          byId: {
            id: accountId,
            subscription,
            ownerUserActor,
            memberStats: { totalCount },
            membersPaginated: page,
          },
        },
      },
    });
  }

  const humanNode = (id, role, username) => ({
    id,
    role,
    userActor: { id: `user-${id}`, username },
    actor: { id: `user-${id}` },
  });
  const robotNode = (id, role, firstName) => ({
    id,
    role,
    userActor: null,
    actor: { id: `robot-${id}`, firstName },
  });

  it('returns subscription/ownerUserActor/totalMemberCount/members for a personal account', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        accountResponse({ ownerUserActor: { id: 'user-1', username: 'it0' }, totalCount: 0 })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountMembers('acc-1')).resolves.toEqual({
      subscription,
      ownerUserActor: { id: 'user-1', username: 'it0' },
      totalMemberCount: 0,
      members: [],
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables).toEqual({ accountId: 'acc-1', after: null });
  });

  it('returns members and a null ownerUserActor for an organization account', async () => {
    const members = [humanNode('m1', 'OWNER', 'it0'), robotNode('m2', 'DEVELOPER', 'ci-bot')];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        accountResponse({ totalCount: 2, page: membersPage(members.map((node) => ({ node }))) })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const result = await client.fetchAccountMembers('acc-1');

    expect(result.ownerUserActor).toBeNull();
    expect(result.totalMemberCount).toBe(2);
    expect(result.members).toEqual(members);
  });

  it('does not query billingPeriod or usageMetrics', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(accountResponse());
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.fetchAccountMembers('acc-1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.query).not.toContain('billingPeriod');
    expect(body.query).not.toContain('usageMetrics');
  });

  it('paginates membersPaginated until hasNextPage is false, merging members across pages', async () => {
    const page1 = membersPage([{ node: humanNode('m1', 'OWNER', 'it0') }], {
      hasNextPage: true,
      endCursor: 'cursor-1',
    });
    const page2 = membersPage([{ node: humanNode('m2', 'DEVELOPER', 'kohei') }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(accountResponse({ totalCount: 2, page: page1 }))
      .mockResolvedValueOnce(accountResponse({ totalCount: 2, page: page2 }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    const result = await client.fetchAccountMembers('acc-1');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.members.map((m) => m.id)).toEqual(['m1', 'm2']);
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.variables).toEqual({ accountId: 'acc-1', after: 'cursor-1' });
  });

  it('throws ApiError when the account lacks billing/membership permission', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountMembers('acc-1')).rejects.toThrow(ApiError);
  });

  it('returns null (not a TypeError) when the account itself is missing from the response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { account: { byId: null } } }));
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountMembers('acc-1')).resolves.toBeNull();
  });

  it('puts the Robot inline fragment on actor, not on ownerUserActor (which is UserActor, not the Actor interface)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(accountResponse());
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await client.fetchAccountMembers('acc-1');

    const { query } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(query).toContain('membersPaginated');
    expect(query).toContain('actor { id ... on Robot { firstName } }');
    expect(query).not.toContain('ownerUserActor { id username ... on Robot');
  });

  it('throws ApiError (not a TypeError) when membersPaginated is malformed mid-pagination', async () => {
    const page1 = membersPage([{ node: humanNode('m1', 'OWNER', 'it0') }], {
      hasNextPage: true,
      endCursor: 'cursor-1',
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(accountResponse({ totalCount: 1, page: page1 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { account: { byId: { id: 'acc-1', subscription, ownerUserActor: null } } },
        })
      );
    const client = createApiClient({ apiUrl: 'https://example.test', fetchImpl });

    await expect(client.fetchAccountMembers('acc-1')).rejects.toThrow(ApiError);
  });
});

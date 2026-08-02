import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, HELP, run } from '../src/cli.mjs';

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { status, ok, json: async () => body };
}

describe('run', () => {
  let logSpy;
  let originalToken;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalToken = process.env.EXPO_TOKEN;
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.EXPO_TOKEN;
    else process.env.EXPO_TOKEN = originalToken;
  });

  it('prints HELP and returns for --help', async () => {
    await run(['--help']);
    expect(logSpy).toHaveBeenCalledWith(HELP);
  });

  it('prints the package version for --version', async () => {
    await run(['--version']);
    expect(logSpy).toHaveBeenCalledWith('0.2.1');
  });

  it('rejects with CliError for an unknown option', async () => {
    await expect(run(['--bogus'])).rejects.toThrow(CliError);
  });

  it('rejects with CliError when EXPO_TOKEN is unset', async () => {
    delete process.env.EXPO_TOKEN;
    await expect(run([])).rejects.toThrow(/EXPO_TOKEN is not set/);
  });

  it('rejects with CliError when the token has no accounts', async () => {
    process.env.EXPO_TOKEN = 'test-token';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { meActor: { accounts: [] } } }));
    vi.stubGlobal('fetch', fetchImpl);

    await expect(run([])).rejects.toThrow(/No accounts found/);
  });

  it('fetches accounts/apps/builds and prints a table', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      // fetchAccounts
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      // fetchApps (single page)
      jsonResponse({
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
      }),
      // fetchBuilds
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
                  createdAt: new Date().toISOString(),
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run([]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', limit: 1 });

    const tableOutput = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(tableOutput).toContain('storefront');
    expect(tableOutput).toContain('3.2.1');
    expect(tableOutput).toContain('BUILD DATE');
    expect(tableOutput).toContain('VERSION/BUILD = latest successful EAS build.');
  });

  it('--history N fetches up to N builds per platform, newest first, and lists them as separate rows', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
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
      }),
      jsonResponse({
        data: {
          app: {
            byId: {
              id: 'app-1',
              // Out of order on purpose — the CLI must not depend on the
              // API returning builds newest-first.
              ios: [
                {
                  platform: 'IOS',
                  appVersion: '3.2.0',
                  appBuildVersion: '40',
                  createdAt: '2026-06-20T00:00:00.000Z',
                },
                {
                  platform: 'IOS',
                  appVersion: '3.2.1',
                  appBuildVersion: '41',
                  createdAt: '2026-07-20T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--history', '2', '--json']);

    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', limit: 2 });

    const parsed = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].build).toBe('41');
    expect(parsed[1].build).toBe('40');
  });

  it('--history 1 produces identical output to leaving --history off', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
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
      }),
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
                  createdAt: '2026-07-20T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--history', '1']);

    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', limit: 1 });

    const tableOutput = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(tableOutput).toContain('VERSION/BUILD = latest successful EAS build.');
    expect(tableOutput).not.toContain('newest first');
  });

  it('shows the history footer note when --history > 1', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
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
      }),
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
                  createdAt: '2026-07-20T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--history', '3']);

    const tableOutput = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(tableOutput).toContain(
      'VERSION/BUILD = latest 3 successful EAS builds per platform, newest first.'
    );
  });

  it('rejects with CliError when --history is combined with --usage', async () => {
    process.env.EXPO_TOKEN = 'test-token';
    await expect(run(['--usage', '--history', '5'])).rejects.toThrow(
      /--history cannot be combined with --usage/
    );
  });

  it('rejects with CliError for the removed --account option (issue #22)', async () => {
    process.env.EXPO_TOKEN = 'test-token';
    await expect(run(['--account', 'myorg'])).rejects.toThrow(/Unknown option: --account/);
  });

  it('shows the account display name in the table when the account has one set (issue #22)', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({
        data: {
          meActor: {
            accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
          },
        },
      }),
      jsonResponse({
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
      }),
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
                  createdAt: '2026-07-20T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run([]);

    const tableOutput = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(tableOutput).toContain('My Organization');
  });

  it('falls back to the account slug in the table when displayName is null (issue #22)', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({
        data: {
          meActor: { accounts: [{ id: 'acc-1', name: 'myorg', displayName: null }] },
        },
      }),
      jsonResponse({
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
      }),
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
                  createdAt: '2026-07-20T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run([]);

    const tableOutput = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(tableOutput).toContain('myorg');
  });

  it('keeps the account slug — not the display name — in --json/--csv output (issue #22)', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({
        data: {
          meActor: {
            accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
          },
        },
      }),
      jsonResponse({
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
      }),
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
                  createdAt: '2026-07-20T00:00:00.000Z',
                },
              ],
              android: [],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--json']);

    const parsed = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(parsed[0].account).toBe('myorg');
  });

  it('--platform filters output to matching builds only', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
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
      }),
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
                  createdAt: new Date().toISOString(),
                },
              ],
              android: [
                {
                  platform: 'ANDROID',
                  appVersion: '3.2.0',
                  appBuildVersion: '38',
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--platform', 'android', '--json']);

    const jsonOut = logSpy.mock.calls.at(-1)[0];
    const parsed = JSON.parse(jsonOut);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].platform).toBe('android');
  });

  it('--json prints "[]" when there are no apps', async () => {
    process.env.EXPO_TOKEN = 'test-token';
    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
        data: {
          account: {
            byId: {
              id: 'acc-1',
              appsPaginated: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        },
      }),
    ];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--json']);
    expect(logSpy).toHaveBeenCalledWith('[]');
  });

  it('--csv prints just the header row when there are no apps', async () => {
    process.env.EXPO_TOKEN = 'test-token';
    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
        data: {
          account: {
            byId: {
              id: 'acc-1',
              appsPaginated: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        },
      }),
    ];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--csv']);
    expect(logSpy).toHaveBeenCalledWith('account,app,slug,platform,version,build,lastBuildAt');
  });

  it('prints "No apps found." when the account has zero apps', async () => {
    process.env.EXPO_TOKEN = 'test-token';

    const responses = [
      jsonResponse({ data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } } }),
      jsonResponse({
        data: {
          account: {
            byId: {
              id: 'acc-1',
              appsPaginated: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        },
      }),
    ];

    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run([]);
    expect(logSpy).toHaveBeenCalledWith('No apps found.');
  });
});

describe('run --usage', () => {
  let logSpy;
  let errorSpy;
  let originalToken;

  const accountsResponse = jsonResponse({
    data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } },
  });

  const planResponse = jsonResponse({
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
            concurrencies: { total: 3, ios: 2, android: 1 },
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
              ],
            },
          },
        },
      },
    },
  });

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalToken = process.env.EXPO_TOKEN;
    process.env.EXPO_TOKEN = 'test-token';
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.EXPO_TOKEN;
    else process.env.EXPO_TOKEN = originalToken;
  });

  it('prints one row per account and never fetches apps or builds', async () => {
    const responses = [accountsResponse, planResponse];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--usage']);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('PLAN');
    expect(output).toContain('Production');
    expect(output).toContain('BUILDS');
    expect(output).toContain('2026-07-01 → 2026-07-31');
    expect(output).not.toContain('SLUG');
  });

  it('shows the account display name in the --usage table when set (issue #22)', async () => {
    const displayNameAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
        },
      },
    });
    const responses = [displayNameAccountsResponse, planResponse];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--usage']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('My Organization');
  });

  it('keeps the account slug — not the display name — in --usage --json output (issue #22)', async () => {
    const displayNameAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
        },
      },
    });
    const responses = [displayNameAccountsResponse, planResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed[0].account).toBe('myorg');
  });

  it('emits the usage fields for --json', async () => {
    const responses = [accountsResponse, planResponse];
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
        plan: 'Production',
        planId: 'production',
        status: 'active',
        concurrencyTotal: 3,
        concurrencyIos: 2,
        concurrencyAndroid: 1,
        buildsIos: 23,
        buildsAndroid: 11,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('emits the usage header for --csv', async () => {
    const responses = [accountsResponse, planResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--csv']);

    const csv = logSpy.mock.calls[0][0];
    expect(csv.split('\n')[0]).toBe(
      'account,plan,planId,status,concurrencyTotal,concurrencyIos,concurrencyAndroid,buildsIos,buildsAndroid,periodStart,periodEnd'
    );
    expect(csv.split('\n')[1]).toBe(
      'myorg,Production,production,active,3,2,1,23,11,2026-07-01T00:00:00.000Z,2026-08-01T00:00:00.000Z'
    );
  });

  it('keeps the row and warns on stderr when the token lacks billing permission', async () => {
    const responses = [
      accountsResponse,
      jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] }),
    ];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--json']);

    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual([
      {
        account: 'myorg',
        plan: null,
        planId: null,
        status: null,
        concurrencyTotal: null,
        concurrencyIos: null,
        concurrencyAndroid: null,
        buildsIos: null,
        buildsAndroid: null,
        periodStart: null,
        periodEnd: null,
      },
    ]);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('plan unavailable');
  });

  it('reports the platform concurrency when combined with --platform', async () => {
    const responses = [accountsResponse, planResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage', '--platform', 'ios']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('CONCURRENCY (IOS)');
    expect(output).toContain('BUILDS (IOS)');
  });

  it('sums both platforms into BUILDS when --platform is not set', async () => {
    const responses = [accountsResponse, planResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--usage']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    // ios: 23 + android: 11 = 34
    expect(output).toContain('34');
  });
});

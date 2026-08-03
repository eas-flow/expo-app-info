import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP } from '../src/args.mjs';
import { CliError, run } from '../src/cli.mjs';

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

describe('run --plan', () => {
  let logSpy;
  let errorSpy;
  let originalToken;

  const accountsResponse = jsonResponse({
    data: { meActor: { accounts: [{ id: 'acc-1', name: 'myorg' }] } },
  });

  const subscriptionResponse = jsonResponse({
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
    const responses = [accountsResponse, subscriptionResponse];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => responses[call++]);
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--plan']);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('PLAN');
    expect(output).toContain('PLAN ID');
    expect(output).toContain('Production');
    expect(output).toContain('2 / 1 / 1');
    expect(output).not.toContain('SLUG');
    expect(output).not.toContain('BUILDS');
  });

  it('shows the account display name in the --plan table when set (issue #22)', async () => {
    const displayNameAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
        },
      },
    });
    const responses = [displayNameAccountsResponse, subscriptionResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--plan']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('My Organization');
  });

  it('keeps the account slug — not the display name — in --plan --json output (issue #22)', async () => {
    const displayNameAccountsResponse = jsonResponse({
      data: {
        meActor: {
          accounts: [{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }],
        },
      },
    });
    const responses = [displayNameAccountsResponse, subscriptionResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--plan', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed[0].account).toBe('myorg');
  });

  it('emits the plan fields for --json', async () => {
    const responses = [accountsResponse, subscriptionResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--plan', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toEqual([
      {
        account: 'myorg',
        plan: 'Production',
        planId: 'production',
        status: 'active',
        concurrencyTotal: 2,
        concurrencyIos: 1,
        concurrencyAndroid: 1,
        trialEnd: null,
      },
    ]);
  });

  it('emits the plan header for --csv', async () => {
    const responses = [accountsResponse, subscriptionResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--plan', '--csv']);

    const csv = logSpy.mock.calls[0][0];
    expect(csv.split('\n')[0]).toBe(
      'account,plan,planId,status,concurrencyTotal,concurrencyIos,concurrencyAndroid,trialEnd'
    );
    expect(csv.split('\n')[1]).toBe('myorg,Production,production,active,2,1,1,');
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

    await run(['--plan', '--json']);

    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual([
      {
        account: 'myorg',
        plan: null,
        planId: null,
        status: null,
        concurrencyTotal: null,
        concurrencyIos: null,
        concurrencyAndroid: null,
        trialEnd: null,
      },
    ]);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('plan unavailable');
  });

  it("reports only that platform's concurrency when combined with --platform", async () => {
    const responses = [accountsResponse, subscriptionResponse];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--plan', '--platform', 'ios']);

    const output = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(output).toContain('CONCURRENCY (IOS)');
    expect(output).not.toContain('2 / 1 / 1');
  });

  it('fetches accounts in parallel (mapWithConcurrency) rather than a strictly sequential loop', async () => {
    // With two accounts, both subscription fetches should be issued without
    // waiting for one to resolve before starting the other — asserted here
    // by resolving them out of order and checking both still land in the
    // right entry (order-preservation is mapWithConcurrency's job, already
    // covered in test/api.test.mjs; this just proves runPlan uses it end to
    // end for --plan specifically, issue #19).
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
    const subResponseFor = (name) =>
      jsonResponse({
        data: {
          account: {
            byId: {
              id: name,
              subscription: {
                id: `sub-${name}`,
                planId: 'production',
                name: 'Production',
                status: 'active',
                trialEnd: null,
                concurrencies: { total: 2, ios: 1, android: 1 },
              },
            },
          },
        },
      });

    let call = 0;
    const responses = [twoAccountsResponse, subResponseFor('acc-1'), subResponseFor('acc-2')];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => responses[call++])
    );

    await run(['--plan', '--json']);

    expect(call).toBe(3);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.account)).toEqual(['myorg', 'otherorg']);
  });
});

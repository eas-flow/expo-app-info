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
    expect(logSpy).toHaveBeenCalledWith('0.1.0');
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
      // fetchLatestBuilds
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
    const tableOutput = logSpy.mock.calls.map((args) => args[0]).join('\n');
    expect(tableOutput).toContain('storefront');
    expect(tableOutput).toContain('3.2.1');
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

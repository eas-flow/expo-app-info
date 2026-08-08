import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP } from '../src/args.mjs';
import { CliError, run } from '../src/cli.mjs';
import { accountsResponse, appsResponse, buildsResponse, fetchSequence } from './helpers.mjs';

const iosBuild = (overrides = {}) => ({
  platform: 'IOS',
  appVersion: '3.2.1',
  appBuildVersion: '41',
  createdAt: '2026-07-20T00:00:00.000Z',
  ...overrides,
});

describe('run', () => {
  let logSpy;
  let originalToken;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalToken = process.env.EXPO_TOKEN;
    process.env.EXPO_TOKEN = 'test-token';
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.EXPO_TOKEN;
    else process.env.EXPO_TOKEN = originalToken;
  });

  const stubFetch = (responses) => {
    const fetchImpl = vi.fn().mockImplementation(fetchSequence(responses));
    vi.stubGlobal('fetch', fetchImpl);
    return fetchImpl;
  };

  const tableOutput = () => logSpy.mock.calls.map((args) => args[0]).join('\n');

  it('prints HELP and returns for --help', async () => {
    await run(['--help']);
    expect(logSpy).toHaveBeenCalledWith(HELP);
  });

  it('prints the package version for --version', async () => {
    await run(['--version']);
    expect(logSpy).toHaveBeenCalledWith('1.0.0');
  });

  // One representative test that parseArgs failures propagate out of run()
  // as CliError; the full validation matrix lives in test/args.test.mjs.
  it('rejects with CliError for an unknown option', async () => {
    await expect(run(['--bogus'])).rejects.toThrow(CliError);
  });

  it('rejects with CliError when EXPO_TOKEN is unset', async () => {
    delete process.env.EXPO_TOKEN;
    await expect(run([])).rejects.toThrow(/EXPO_TOKEN is not set/);
  });

  it('rejects with CliError when the token has no accounts', async () => {
    stubFetch([accountsResponse([])]);
    await expect(run([])).rejects.toThrow(/No accounts found/);
  });

  it('fetches accounts/apps/builds and prints a table', async () => {
    const fetchImpl = stubFetch([
      accountsResponse(),
      appsResponse(),
      buildsResponse({ ios: [iosBuild({ createdAt: new Date().toISOString() })] }),
    ]);

    await run([]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', limit: 1 });

    expect(tableOutput()).toContain('storefront');
    expect(tableOutput()).toContain('3.2.1');
    expect(tableOutput()).toContain('BUILD DATE');
    expect(tableOutput()).toContain('VERSION/BUILD = latest successful EAS build.');
  });

  it('--history N fetches up to N builds per platform, newest first, and lists them as separate rows', async () => {
    const fetchImpl = stubFetch([
      accountsResponse(),
      appsResponse(),
      // Out of order on purpose — the CLI must not depend on the API
      // returning builds newest-first.
      buildsResponse({
        ios: [
          iosBuild({
            appVersion: '3.2.0',
            appBuildVersion: '40',
            createdAt: '2026-06-20T00:00:00.000Z',
          }),
          iosBuild({
            appVersion: '3.2.1',
            appBuildVersion: '41',
            createdAt: '2026-07-20T00:00:00.000Z',
          }),
        ],
      }),
    ]);

    await run(['--history', '2']);

    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', limit: 2 });

    const output = tableOutput();
    expect(output).toContain('2 row(s)');
    // Build 41 (newest) must appear before build 40, confirming client-side sort.
    expect(output.indexOf('41')).toBeLessThan(output.indexOf('40'));
  });

  it('--history 1 produces identical output to leaving --history off', async () => {
    const fetchImpl = stubFetch([
      accountsResponse(),
      appsResponse(),
      buildsResponse({ ios: [iosBuild()] }),
    ]);

    await run(['--history', '1']);

    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', limit: 1 });

    expect(tableOutput()).toContain('VERSION/BUILD = latest successful EAS build.');
    expect(tableOutput()).not.toContain('newest first');
  });

  it('shows the history footer note when --history > 1', async () => {
    stubFetch([accountsResponse(), appsResponse(), buildsResponse({ ios: [iosBuild()] })]);

    await run(['--history', '3']);

    expect(tableOutput()).toContain(
      'VERSION/BUILD = latest 3 successful EAS builds per platform, newest first.'
    );
  });

  it('shows the account display name in the table when the account has one set', async () => {
    stubFetch([
      accountsResponse([{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }]),
      appsResponse(),
      buildsResponse({ ios: [iosBuild()] }),
    ]);

    await run([]);

    expect(tableOutput()).toContain('My Organization');
  });

  it('--platform filters output to matching builds only', async () => {
    stubFetch([
      accountsResponse(),
      appsResponse(),
      buildsResponse({
        ios: [iosBuild({ createdAt: new Date().toISOString() })],
        android: [
          {
            platform: 'ANDROID',
            appVersion: '3.2.0',
            appBuildVersion: '38',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ]);

    await run(['--platform', 'android']);

    const output = tableOutput();
    expect(output).toContain('1 row(s)');
    expect(output).toContain('38'); // the android build number
    expect(output).not.toContain('41'); // the ios build number, filtered out
  });

  it('prints "No apps found." when the account has zero apps', async () => {
    stubFetch([accountsResponse(), appsResponse([])]);

    await run([]);
    expect(logSpy).toHaveBeenCalledWith('No apps found.');
  });
});

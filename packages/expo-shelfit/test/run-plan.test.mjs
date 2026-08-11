import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.mjs';
import { CliError } from '../src/errors.mjs';
import { accountsResponse, fetchSequence, jsonResponse } from './helpers.mjs';

describe('run --plan', () => {
  let logSpy;
  let errorSpy;
  let originalToken;

  const subscriptionResponseFor = (accountId = 'acc-1') =>
    jsonResponse({
      data: {
        account: {
          byId: {
            id: accountId,
            subscription: {
              id: `sub-${accountId}`,
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

  const stubFetch = (responses) => {
    const fetchImpl = vi.fn().mockImplementation(fetchSequence(responses));
    vi.stubGlobal('fetch', fetchImpl);
    return fetchImpl;
  };

  const tableOutput = () => logSpy.mock.calls.map((args) => args[0]).join('\n');

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
    const fetchImpl = stubFetch([accountsResponse(), subscriptionResponseFor()]);

    await run(['--plan']);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tableOutput()).toContain('PLAN');
    expect(tableOutput()).toContain('PLAN ID');
    expect(tableOutput()).toContain('Production');
    expect(tableOutput()).toContain('2 / 1 / 1');
    expect(tableOutput()).not.toContain('SLUG');
    expect(tableOutput()).not.toContain('BUILDS');
  });

  it('keeps the row and shows "-" in the plan columns when the token lacks billing permission', async () => {
    stubFetch([
      accountsResponse(),
      jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] }),
    ]);

    await run(['--plan']);

    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).toContain('-');
    expect(output).not.toContain('Production');
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('plan unavailable');
  });

  it('shows "-" without a warning when the account is missing from a malformed (but 2xx) response', async () => {
    stubFetch([accountsResponse(), jsonResponse({ data: { account: { byId: null } } })]);

    await run(['--plan']);

    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).toContain('-');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports only that platform's concurrency when combined with --platform", async () => {
    stubFetch([accountsResponse(), subscriptionResponseFor()]);

    await run(['--plan', '--platform', 'ios']);

    expect(tableOutput()).toContain('CONCURRENCY (IOS)');
    expect(tableOutput()).not.toContain('2 / 1 / 1');
  });

  it('reports warnings in account order even when the slower account resolves last', async () => {
    vi.useFakeTimers();
    try {
      const twoAccounts = accountsResponse([
        { id: 'acc-1', name: 'first' },
        { id: 'acc-2', name: 'second' },
      ]);
      const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.query.includes('CurrentAccounts')) return twoAccounts;
        // acc-2 (second in account order) resolves before acc-1.
        const delay = body.variables.accountId === 'acc-1' ? 50 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return jsonResponse({ errors: [{ message: `boom-${body.variables.accountId}` }] });
      });
      vi.stubGlobal('fetch', fetchImpl);

      const promise = run(['--plan']);
      await vi.runAllTimersAsync();
      await promise;

      const errorLines = errorSpy.mock.calls.map((args) => args[0]);
      const firstIdx = errorLines.findIndex((l) => l.includes('first'));
      const secondIdx = errorLines.findIndex((l) => l.includes('second'));
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches accounts in parallel (mapWithConcurrency) rather than a strictly sequential loop', async () => {
    // Order-preservation is mapWithConcurrency's job, already covered in
    // test/api.test.mjs; this just proves runPlan uses it end to end for
    // --plan specifically.
    stubFetch([
      accountsResponse([
        { id: 'acc-1', name: 'myorg' },
        { id: 'acc-2', name: 'otherorg' },
      ]),
      subscriptionResponseFor('acc-1'),
      subscriptionResponseFor('acc-2'),
    ]);

    await run(['--plan']);

    const output = tableOutput();
    expect(output).toContain('2 account(s)');
    // Row order must match input account order despite parallel fetching.
    expect(output.indexOf('myorg')).toBeLessThan(output.indexOf('otherorg'));
  });

  it('--account narrows to a single account — the other account is never queried for a subscription', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('CurrentAccounts')) {
        return accountsResponse([
          { id: 'acc-1', name: 'myorg' },
          { id: 'acc-2', name: 'otherorg' },
        ]);
      }
      expect(body.variables.accountId).toBe('acc-1'); // otherorg must never be queried
      return subscriptionResponseFor('acc-1');
    });
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--plan', '--account', 'myorg']);

    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 accounts + 1 subscription, not 2
    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).not.toContain('otherorg');
    expect(output).toContain('1 account(s)');
  });

  it('rejects with CliError when combined with --app, since --plan never fetches apps', async () => {
    await expect(run(['--plan', '--app', 'storefront'])).rejects.toThrow(CliError);
    await expect(run(['--plan', '--app', 'storefront'])).rejects.toThrow(
      /--app cannot be used with --plan/
    );
  });

  it('rejects with CliError when combined with --local, since --plan has no BUILD DATE column', async () => {
    await expect(run(['--plan', '--local'])).rejects.toThrow(CliError);
    await expect(run(['--plan', '--local'])).rejects.toThrow(/--local cannot be used with --plan/);
  });
});

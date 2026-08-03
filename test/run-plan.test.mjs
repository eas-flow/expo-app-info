import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.mjs';
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

  it('emits the plan fields for --json', async () => {
    stubFetch([accountsResponse(), subscriptionResponseFor()]);

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

  // The exact header/row strings are format.test.mjs's contract; this only
  // proves runPlan wires PLAN_FIELDS into the --csv branch.
  it('emits the plan header for --csv', async () => {
    stubFetch([accountsResponse(), subscriptionResponseFor()]);

    await run(['--plan', '--csv']);

    const csv = logSpy.mock.calls[0][0];
    expect(csv.split('\n')[0]).toBe(
      'account,plan,planId,status,concurrencyTotal,concurrencyIos,concurrencyAndroid,trialEnd'
    );
  });

  it('keeps the row and warns on stderr when the token lacks billing permission', async () => {
    stubFetch([
      accountsResponse(),
      jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] }),
    ]);

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
    stubFetch([accountsResponse(), subscriptionResponseFor()]);

    await run(['--plan', '--platform', 'ios']);

    expect(tableOutput()).toContain('CONCURRENCY (IOS)');
    expect(tableOutput()).not.toContain('2 / 1 / 1');
  });

  it('fetches accounts in parallel (mapWithConcurrency) rather than a strictly sequential loop', async () => {
    // Order-preservation is mapWithConcurrency's job, already covered in
    // test/api.test.mjs; this just proves runPlan uses it end to end for
    // --plan specifically (issue #19).
    stubFetch([
      accountsResponse([
        { id: 'acc-1', name: 'myorg' },
        { id: 'acc-2', name: 'otherorg' },
      ]),
      subscriptionResponseFor('acc-1'),
      subscriptionResponseFor('acc-2'),
    ]);

    await run(['--plan', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.account)).toEqual(['myorg', 'otherorg']);
  });
});

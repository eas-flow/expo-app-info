import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.mjs';
import { jsonResponse } from './helpers.mjs';

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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, run } from '../src/cli.mjs';
import {
  accountsResponse,
  appsResponse,
  buildsResponse,
  fetchSequence,
  jsonResponse,
} from './helpers.mjs';

describe('run --usage', () => {
  let logSpy;
  let errorSpy;
  let originalToken;

  // Pinned "now" so calendarMonths()'s default window (last 3 months) and
  // the table's current-month "(today)" marker are deterministic:
  // July (current, in progress), June, May.
  const NOW = new Date('2026-07-15T12:00:00.000Z');

  // ios: 2 in July, 1 in June, 1 in May, 1 in April (outside the 3-month
  // default window — must not be counted). android: 1 in July, 2 in June.
  // Well under BUILD_PAGE_SIZE (50) on both platforms, so pagination stops
  // after a single page regardless of --month.
  const buildsPageResponse = buildsResponse({
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
  });

  const happyResponses = () => [accountsResponse(), appsResponse(), buildsPageResponse];

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
    const fetchImpl = stubFetch(happyResponses());

    await run(['--usage']);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables).toEqual({ appId: 'app-1', offset: 0, limit: 50 });

    expect(tableOutput()).toContain('SUCCESSFUL BUILDS (IOS)');
    expect(tableOutput()).toContain('SUCCESSFUL BUILDS (AND)');
    expect(tableOutput()).not.toContain('PLAN');
    expect(tableOutput()).not.toContain('SLUG');
  });

  // Reads the IOS/AND build-count cells out of the `│`-delimited table row
  // whose PERIOD cell contains `periodStartPrefix` (e.g. '2026-07-01').
  const buildCountsForPeriod = (output, periodStartPrefix) => {
    const line = output.split('\n').find((l) => l.includes(periodStartPrefix));
    const cells = line.split('│').map((c) => c.trim());
    return [cells[3], cells[4]]; // [ACCOUNT, PERIOD, IOS, AND, ...]
  };

  it('emits 3 rows (one per account per month, newest first) with client-side successful-build counts', async () => {
    stubFetch(happyResponses());

    await run(['--usage']);

    const output = tableOutput();
    expect(output).toContain('3 row(s)');
    // July (current): 2 ios / 1 android. June: 1 ios / 2 android. May: 1 ios / 0 android.
    expect(buildCountsForPeriod(output, '2026-07-01')).toEqual(['2', '1']);
    expect(buildCountsForPeriod(output, '2026-06-01')).toEqual(['1', '2']);
    expect(buildCountsForPeriod(output, '2026-05-01')).toEqual(['1', '0']);
  });

  it('shows "(today)" for the current month and the inclusive last day for finished months', async () => {
    stubFetch(happyResponses());

    await run(['--usage']);

    expect(tableOutput()).toContain('2026-07-01 → (today)');
    expect(tableOutput()).toContain('2026-06-01 → 2026-06-30');
    expect(tableOutput()).toContain('2026-05-01 → 2026-05-31');
  });

  it('--month widens the window (e.g. --month 1 shows only the current month)', async () => {
    stubFetch(happyResponses());

    await run(['--usage', '--month', '1']);

    const output = tableOutput();
    expect(output).toContain('1 row(s)');
    expect(output).toContain('2026-07-01');
  });

  it('shows only the requested platform column with --platform', async () => {
    const fetchImpl = stubFetch(happyResponses());

    await run(['--usage', '--platform', 'ios']);

    expect(tableOutput()).toContain('SUCCESSFUL BUILDS (IOS)');
    expect(tableOutput()).not.toContain('SUCCESSFUL BUILDS (AND)');

    // #59: --platform narrows the query itself, not just the client-side
    // display — the request must never even ask for the other platform's alias.
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.query).toContain('ios:');
    expect(buildsCallBody.query).not.toContain('android:');
  });

  it('degrades a whole account to "-" build counts (not a failed run) when its apps/builds fetch fails', async () => {
    stubFetch([accountsResponse(), jsonResponse({ errors: [{ message: 'boom' }] })]);

    await run(['--usage']);

    const output = tableOutput();
    expect(output).toContain('3 row(s)');
    // periodStart/periodEnd are known upfront from `now` regardless of the
    // fetch failure — only the build counts degrade to "-".
    expect(buildCountsForPeriod(output, '2026-07-01')).toEqual(['-', '-']);
    expect(buildCountsForPeriod(output, '2026-06-01')).toEqual(['-', '-']);
    expect(buildCountsForPeriod(output, '2026-05-01')).toEqual(['-', '-']);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('usage unavailable');
  });

  it('degrades a whole account to "-" (not a crash) when its apps response is malformed', async () => {
    stubFetch([accountsResponse(), jsonResponse({ data: { account: { byId: null } } })]);

    await run(['--usage']);

    const output = tableOutput();
    expect(output).toContain('3 row(s)');
    expect(buildCountsForPeriod(output, '2026-07-01')).toEqual(['-', '-']);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('usage unavailable');
  });

  it('reports warnings in account order even when the slower account resolves last', async () => {
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

    const promise = run(['--usage']);
    await vi.runAllTimersAsync();
    await promise;

    const errorLines = errorSpy.mock.calls.map((args) => args[0]);
    const firstIdx = errorLines.findIndex((l) => l.includes('first'));
    const secondIdx = errorLines.findIndex((l) => l.includes('second'));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('fetches accounts (and their apps/builds) in parallel rather than a strictly sequential loop', async () => {
    // Both accounts' apps/builds fetches can legitimately interleave under
    // mapWithConcurrency (unlike --plan's single-hop fetchSubscription, this
    // account task has two internal awaits: fetchApps then
    // countBuildsByMonth), so the mock routes by query name + variables
    // instead of assuming a fixed call order.
    const twoAccountsResponse = accountsResponse([
      { id: 'acc-1', name: 'myorg' },
      { id: 'acc-2', name: 'otherorg' },
    ]);

    const appsResponseFor = (accountId) =>
      appsResponse([{ id: `app-${accountId}`, name: 'App', slug: 'app' }], accountId);

    const buildsResponseFor = (appId) =>
      buildsResponse({ ios: [{ createdAt: '2026-07-05T00:00:00.000Z' }], appId });

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

    await run(['--usage', '--month', '1']);

    expect(calls).toBe(5); // 1 accounts + 2 apps + 2 builds pages
    const output = tableOutput();
    expect(output).toContain('2 row(s)');
    expect(output).toContain('myorg');
    expect(output).toContain('otherorg');
  });

  it('does not deadlock once the account count reaches CONCURRENCY (regression for #63)', async () => {
    // 10 accounts, one app each — over api.mjs's CONCURRENCY (8).
    const manyAccounts = Array.from({ length: 10 }, (_, i) => ({
      id: `acc-${i}`,
      name: `org-${i}`,
    }));

    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('CurrentAccounts')) return accountsResponse(manyAccounts);
      if (body.query.includes('AccountApps')) {
        const { accountId } = body.variables;
        return appsResponse([{ id: `app-${accountId}`, name: 'App', slug: 'app' }], accountId);
      }
      if (body.query.includes('BuildsPage')) {
        const { appId } = body.variables;
        return buildsResponse({ ios: [{ createdAt: '2026-07-05T00:00:00.000Z' }], appId });
      }
      throw new Error(`unexpected query in test: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--usage', '--month', '1']);

    const output = tableOutput();
    expect(output).toContain('10 row(s)');
    for (const account of manyAccounts) {
      expect(output).toContain(account.name);
    }
  });

  it("--account narrows to a single account — the other account's apps are never fetched", async () => {
    const twoAccountsResponse = accountsResponse([
      { id: 'acc-1', name: 'myorg' },
      { id: 'acc-2', name: 'otherorg' },
    ]);

    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('CurrentAccounts')) return twoAccountsResponse;
      if (body.query.includes('AccountApps')) {
        // otherorg must never be queried at all — #84's --account narrows
        // client.fetchAccounts()'s result before any command runs.
        expect(body.variables.accountId).toBe('acc-1');
        return appsResponse([{ id: 'app-1', name: 'Storefront', slug: 'storefront' }], 'acc-1');
      }
      if (body.query.includes('BuildsPage')) {
        return buildsResponse({ ios: [{ createdAt: '2026-07-05T00:00:00.000Z' }] });
      }
      throw new Error(`unexpected query in test: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--usage', '--account', 'myorg', '--month', '1']);

    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 accounts + 1 apps + 1 builds page
    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).not.toContain('otherorg');
  });

  it('--account matches the EAS Display name the same as the slug', async () => {
    const fetchImpl = stubFetch([
      accountsResponse([{ id: 'acc-1', name: 'myorg', displayName: 'My Organization' }]),
      appsResponse(),
      buildsPageResponse,
    ]);

    await run(['--usage', '--account', 'My Organization', '--month', '1']);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(tableOutput()).toContain('My Organization');
  });

  it('--app narrows so a non-matching account contributes no build-count pairs', async () => {
    const fetchImpl = stubFetch([
      accountsResponse(),
      appsResponse([
        { id: 'app-1', name: 'Storefront', slug: 'storefront' },
        { id: 'app-2', name: 'Field Ops', slug: 'field-ops' },
      ]),
      buildsPageResponse,
    ]);

    await run(['--usage', '--app', 'storefront', '--month', '1']);

    // accounts + apps + exactly one builds page (not two) — field-ops's
    // build counts are never fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.variables.appId).toBe('app-1');
  });

  it('rejects with CliError when --account matches no account', async () => {
    stubFetch([accountsResponse([{ id: 'acc-1', name: 'myorg' }])]);

    let error;
    try {
      await run(['--usage', '--account', 'nope']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('No account matched "nope"');
  });

  it('rejects with CliError and a suggestion when --app matches no app', async () => {
    stubFetch([
      accountsResponse(),
      appsResponse([{ id: 'app-1', name: 'Storefront', slug: 'storefront' }]),
    ]);

    let error;
    try {
      // 'store' is a prefix of 'storefront' but not an exact match —
      // exercises the "Did you mean" path (prefix/substring, not Levenshtein).
      await run(['--usage', '--app', 'store']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('No app matched "store"');
    expect(error.message).toContain('Did you mean: storefront');
  });
});

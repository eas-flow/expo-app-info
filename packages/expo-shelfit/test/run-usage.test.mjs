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
  // after a single page regardless of --month. All FINISHED, so they land
  // in the SUCCESS bucket — ERRORED/CANCELED bucketing is covered by its
  // own dedicated test below.
  const buildsPageResponse = buildsResponse({
    ios: [
      { createdAt: '2026-07-05T00:00:00.000Z', status: 'FINISHED' },
      { createdAt: '2026-07-10T00:00:00.000Z', status: 'FINISHED' },
      { createdAt: '2026-06-15T00:00:00.000Z', status: 'FINISHED' },
      { createdAt: '2026-05-20T00:00:00.000Z', status: 'FINISHED' },
      { createdAt: '2026-04-25T00:00:00.000Z', status: 'FINISHED' },
    ],
    android: [
      { createdAt: '2026-07-08T00:00:00.000Z', status: 'FINISHED' },
      { createdAt: '2026-06-01T00:00:00.000Z', status: 'FINISHED' },
      { createdAt: '2026-06-25T00:00:00.000Z', status: 'FINISHED' },
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

    expect(tableOutput()).toContain('PLATFORM');
    expect(tableOutput()).toContain('SUCCESS');
    expect(tableOutput()).toContain('ERRORED');
    expect(tableOutput()).toContain('CANCELED');
    expect(tableOutput()).toContain('TOTAL');
    expect(tableOutput()).not.toContain('PLAN');
    expect(tableOutput()).not.toContain('SLUG');
  });

  // Reads the SUCCESS/ERRORED/CANCELED/TOTAL cells out of the
  // `│`-delimited table row whose PERIOD cell contains `periodStartPrefix`
  // (e.g. '2026-07-01') and whose PLATFORM cell is `platform` ('ios' or
  // 'android') — each account/month now spans two rows (#83 follow-up), so
  // both are needed to pick a single row unambiguously.
  const buildCountsFor = (output, periodStartPrefix, platform) => {
    const line = output
      .split('\n')
      .find((l) => l.includes(periodStartPrefix) && l.includes(`│ ${platform}`));
    const cells = line.split('│').map((c) => c.trim());
    return cells.slice(4, 8); // [ACCOUNT, PERIOD, PLATFORM, SUCCESS, ERRORED, CANCELED, TOTAL]
  };

  it('emits 6 rows (3 months × ios/android, newest month first) with client-side success-build counts', async () => {
    stubFetch(happyResponses());

    await run(['--usage']);

    const output = tableOutput();
    expect(output).toContain('6 row(s)');
    // July (current): 2 ios / 1 android. June: 1 ios / 2 android. May: 1 ios / 0 android.
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['2', '0', '0', '2']);
    expect(buildCountsFor(output, '2026-07-01', 'android')).toEqual(['1', '0', '0', '1']);
    expect(buildCountsFor(output, '2026-06-01', 'ios')).toEqual(['1', '0', '0', '1']);
    expect(buildCountsFor(output, '2026-06-01', 'android')).toEqual(['2', '0', '0', '2']);
    expect(buildCountsFor(output, '2026-05-01', 'ios')).toEqual(['1', '0', '0', '1']);
    expect(buildCountsFor(output, '2026-05-01', 'android')).toEqual(['0', '0', '0', '0']);
  });

  it('shows "(today)" for the current month and the inclusive last day for finished months', async () => {
    stubFetch(happyResponses());

    await run(['--usage']);

    expect(tableOutput()).toContain('2026-07-01 → (today)');
    expect(tableOutput()).toContain('2026-06-01 → 2026-06-30');
    expect(tableOutput()).toContain('2026-05-01 → 2026-05-31');
  });

  it('--month widens the window (e.g. --month 1 shows only the current month, as 2 rows — ios and android)', async () => {
    stubFetch(happyResponses());

    await run(['--usage', '--month', '1']);

    const output = tableOutput();
    expect(output).toContain('2 row(s)');
    expect(output).toContain('2026-07-01');
  });

  it('shows only the requested platform rows with --platform, not the other platform at all', async () => {
    const fetchImpl = stubFetch(happyResponses());

    await run(['--usage', '--platform', 'ios']);

    const output = tableOutput();
    expect(output).toContain('3 row(s)'); // 3 months × 1 platform
    expect(output).toContain('│ ios');
    expect(output).not.toContain('│ android');

    // #59: --platform narrows the query itself, not just the client-side
    // display — the request must never even ask for the other platform's alias.
    const buildsCallBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(buildsCallBody.query).toContain('ios:');
    expect(buildsCallBody.query).not.toContain('android:');
  });

  it('buckets errored and canceled builds into their own columns, separate from success, with TOTAL as the sum (#83)', async () => {
    stubFetch([
      accountsResponse(),
      appsResponse(),
      buildsResponse({
        ios: [
          { createdAt: '2026-07-05T00:00:00.000Z', status: 'FINISHED' },
          { createdAt: '2026-07-06T00:00:00.000Z', status: 'ERRORED' },
          { createdAt: '2026-07-07T00:00:00.000Z', status: 'CANCELED' },
          { createdAt: '2026-07-08T00:00:00.000Z', status: 'CANCELED' },
          // Still in-progress/queued — must not land in any of the three buckets, nor TOTAL.
          { createdAt: '2026-07-09T00:00:00.000Z', status: 'SOME_UNKNOWN_STATUS' },
        ],
        android: [],
      }),
    ]);

    await run(['--usage', '--month', '1']);

    const output = tableOutput();
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['1', '1', '2', '4']);
    expect(buildCountsFor(output, '2026-07-01', 'android')).toEqual(['0', '0', '0', '0']);
  });

  it('degrades a whole account to "-" build counts (not a failed run) when its apps/builds fetch fails', async () => {
    stubFetch([accountsResponse(), jsonResponse({ errors: [{ message: 'boom' }] })]);

    await run(['--usage']);

    const output = tableOutput();
    expect(output).toContain('6 row(s)');
    // periodStart/periodEnd are known upfront from `now` regardless of the
    // fetch failure — only the build counts (including TOTAL) degrade to "-".
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['-', '-', '-', '-']);
    expect(buildCountsFor(output, '2026-07-01', 'android')).toEqual(['-', '-', '-', '-']);
    expect(buildCountsFor(output, '2026-06-01', 'ios')).toEqual(['-', '-', '-', '-']);
    expect(buildCountsFor(output, '2026-05-01', 'android')).toEqual(['-', '-', '-', '-']);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('usage unavailable');
  });

  it('degrades a whole account to "-" (not a crash) when its apps response is malformed', async () => {
    stubFetch([accountsResponse(), jsonResponse({ data: { account: { byId: null } } })]);

    await run(['--usage']);

    const output = tableOutput();
    expect(output).toContain('6 row(s)');
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['-', '-', '-', '-']);
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
    expect(output).toContain('4 row(s)'); // 2 accounts × 1 month × 2 platforms
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
    expect(output).toContain('20 row(s)'); // 10 accounts × 1 month × 2 platforms
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
      // 'storfront' (missing 'e') is one edit away from 'storefront' —
      // exercises the Levenshtein "Did you mean" path.
      await run(['--usage', '--app', 'storfront']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('No app matched "storfront"');
    expect(error.message).toContain('Did you mean: storefront');
  });

  it('rejects with CliError when combined with --local, since --usage has no BUILD DATE column', async () => {
    await expect(run(['--usage', '--local'])).rejects.toThrow(CliError);
    await expect(run(['--usage', '--local'])).rejects.toThrow(
      /--local cannot be used with --usage/
    );
  });

  it("--usage's PERIOD stays UTC — not reachable via --local anyway, but pinned as a regression guard", async () => {
    stubFetch(happyResponses());

    await run(['--usage']);

    // If --local's incompatibility check above ever regresses and silently
    // lets --usage through, this still pins PERIOD to UTC calendar-month
    // boundaries independent of the machine's timezone (#85).
    expect(tableOutput()).toContain('2026-07-01 → (today)');
  });
});

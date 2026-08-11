import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, run } from '../src/cli.mjs';
import {
  accountsResponse,
  appsResponse,
  buildsResponse,
  fetchSequence,
  jsonResponse,
} from './helpers.mjs';

describe('run --stats', () => {
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

    await run(['--stats']);

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

    await run(['--stats']);

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

  // #89: --usage is the old name for this mode. It must keep producing the
  // identical table, with the deprecation notice confined to stderr so a
  // redirected stdout is byte-for-byte unchanged.
  it('accepts the deprecated --usage alias and prints the same table', async () => {
    stubFetch(happyResponses());
    await run(['--usage']);
    const viaUsage = tableOutput();

    logSpy.mockClear();
    stubFetch(happyResponses());
    await run(['--stats']);

    expect(viaUsage).toEqual(tableOutput());
  });

  it('warns on stderr for --usage, and says nothing for --stats', async () => {
    stubFetch(happyResponses());
    await run(['--usage']);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain(
      '--usage is deprecated'
    );

    errorSpy.mockClear();
    stubFetch(happyResponses());
    await run(['--stats']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('shows "(today)" for the current month and the inclusive last day for finished months', async () => {
    stubFetch(happyResponses());

    await run(['--stats']);

    expect(tableOutput()).toContain('2026-07-01 → (today)');
    expect(tableOutput()).toContain('2026-06-01 → 2026-06-30');
    expect(tableOutput()).toContain('2026-05-01 → 2026-05-31');
  });

  it('--month widens the window (e.g. --month 1 shows only the current month, as 2 rows — ios and android)', async () => {
    stubFetch(happyResponses());

    await run(['--stats', '--month', '1']);

    const output = tableOutput();
    expect(output).toContain('2 row(s)');
    expect(output).toContain('2026-07-01');
  });

  it('shows only the requested platform rows with --platform, not the other platform at all', async () => {
    const fetchImpl = stubFetch(happyResponses());

    await run(['--stats', '--platform', 'ios']);

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

    await run(['--stats', '--month', '1']);

    const output = tableOutput();
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['1', '1', '2', '4']);
    expect(buildCountsFor(output, '2026-07-01', 'android')).toEqual(['0', '0', '0', '0']);
  });

  it('degrades a whole account to "-" build counts (not a failed run) when its apps/builds fetch fails', async () => {
    stubFetch([accountsResponse(), jsonResponse({ errors: [{ message: 'boom' }] })]);

    await run(['--stats']);

    const output = tableOutput();
    expect(output).toContain('6 row(s)');
    // periodStart/periodEnd are known upfront from `now` regardless of the
    // fetch failure — only the build counts (including TOTAL) degrade to "-".
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['-', '-', '-', '-']);
    expect(buildCountsFor(output, '2026-07-01', 'android')).toEqual(['-', '-', '-', '-']);
    expect(buildCountsFor(output, '2026-06-01', 'ios')).toEqual(['-', '-', '-', '-']);
    expect(buildCountsFor(output, '2026-05-01', 'android')).toEqual(['-', '-', '-', '-']);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('stats unavailable');
  });

  it('degrades a whole account to "-" (not a crash) when its apps response is malformed', async () => {
    stubFetch([accountsResponse(), jsonResponse({ data: { account: { byId: null } } })]);

    await run(['--stats']);

    const output = tableOutput();
    expect(output).toContain('6 row(s)');
    expect(buildCountsFor(output, '2026-07-01', 'ios')).toEqual(['-', '-', '-', '-']);
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('stats unavailable');
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

    const promise = run(['--stats']);
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

    await run(['--stats', '--month', '1']);

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

    await run(['--stats', '--month', '1']);

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

    await run(['--stats', '--account', 'myorg', '--month', '1']);

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

    await run(['--stats', '--account', 'My Organization', '--month', '1']);

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

    await run(['--stats', '--app', 'storefront', '--month', '1']);

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
      await run(['--stats', '--account', 'nope']);
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
      await run(['--stats', '--app', 'storfront']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('No app matched "storfront"');
    expect(error.message).toContain('Did you mean: storefront');
  });

  it('rejects with CliError when combined with --local, since --stats has no BUILD DATE column', async () => {
    await expect(run(['--stats', '--local'])).rejects.toThrow(CliError);
    await expect(run(['--stats', '--local'])).rejects.toThrow(
      /--local cannot be used with --stats/
    );
  });

  it("--stats' PERIOD stays UTC — not reachable via --local anyway, but pinned as a regression guard", async () => {
    stubFetch(happyResponses());

    await run(['--stats']);

    // If --local's incompatibility check above ever regresses and silently
    // lets --stats through, this still pins PERIOD to UTC calendar-month
    // boundaries independent of the machine's timezone (#85).
    expect(tableOutput()).toContain('2026-07-01 → (today)');
  });

  // --group-by app (#90). Two apps in one account, with deliberately
  // different build counts so a summed-vs-per-app mix-up cannot pass.
  describe('--group-by app', () => {
    const TWO_APPS = [
      { id: 'app-1', name: 'Storefront', slug: 'storefront' },
      { id: 'app-2', name: 'Admin', slug: 'admin' },
    ];

    // Storefront: ios 2/1/1 across July/June/May, android 1/2/0.
    // Admin: ios 1 in July only; android none at all — its rows must still
    // print, as zeros.
    const BUILDS = {
      'app-1': () =>
        buildsResponse({
          appId: 'app-1',
          ios: [
            { createdAt: '2026-07-05T00:00:00.000Z', status: 'FINISHED' },
            { createdAt: '2026-07-10T00:00:00.000Z', status: 'FINISHED' },
            { createdAt: '2026-06-15T00:00:00.000Z', status: 'FINISHED' },
            { createdAt: '2026-05-20T00:00:00.000Z', status: 'FINISHED' },
          ],
          android: [
            { createdAt: '2026-07-08T00:00:00.000Z', status: 'FINISHED' },
            { createdAt: '2026-06-01T00:00:00.000Z', status: 'FINISHED' },
            { createdAt: '2026-06-25T00:00:00.000Z', status: 'FINISHED' },
          ],
        }),
      'app-2': () =>
        buildsResponse({
          appId: 'app-2',
          ios: [{ createdAt: '2026-07-12T00:00:00.000Z', status: 'FINISHED' }],
          android: [],
        }),
    };

    // Routes by GraphQL variables instead of call order: pass 2 runs under
    // mapWithConcurrency, so which app's builds request lands first is not
    // something these tests should depend on.
    const stubRouted = ({ apps = TWO_APPS, accounts, builds = BUILDS } = {}) => {
      const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
        const { variables = {} } = JSON.parse(options.body);
        if (variables.accountId) {
          const own = apps.filter((a) => (a.accountId ?? 'acc-1') === variables.accountId);
          return appsResponse(own, variables.accountId);
        }
        if (variables.appId) return builds[variables.appId]();
        return accounts ?? accountsResponse();
      });
      vi.stubGlobal('fetch', fetchImpl);
      return fetchImpl;
    };

    // All data rows as trimmed cell arrays: [SUBJECT, PERIOD, PLATFORM, ...].
    const dataRows = (output) =>
      output
        .split('\n')
        .filter((l) => l.includes('│') && (l.includes('│ ios') || l.includes('│ android')))
        .map((l) =>
          l
            .split('│')
            .slice(1, -1)
            .map((c) => c.trim())
        );

    it('replaces the ACCOUNT column with APP and emits one group of rows per app', async () => {
      stubRouted();

      await run(['--stats', '--group-by', 'app']);

      const output = tableOutput();
      expect(output).toContain('APP');
      expect(output).not.toContain('ACCOUNT');
      // 2 apps × 3 months × 2 platforms
      expect(output).toContain('12 row(s)');
      expect(output).toContain('2 app(s)');
      expect(output).not.toContain('account(s)');

      const subjects = new Set(dataRows(output).map((r) => r[0]));
      expect(subjects).toEqual(new Set(['Storefront', 'Admin']));
    });

    // The regression that matters: per-app rows must add up to exactly what
    // the account row reports for the same month and platform.
    it('per-app counts sum to the same numbers --group-by account reports', async () => {
      stubRouted();
      await run(['--stats', '--group-by', 'app']);
      const perApp = dataRows(tableOutput());

      logSpy.mockClear();
      stubRouted();
      await run(['--stats', '--group-by', 'account']);
      const perAccount = dataRows(tableOutput());

      expect(perApp).toHaveLength(12);
      expect(perAccount).toHaveLength(6);

      for (const accountRow of perAccount) {
        const [, period, platform, ...accountCounts] = accountRow;
        const summed = perApp
          .filter((r) => r[1] === period && r[2] === platform)
          .reduce((acc, r) => acc.map((n, i) => n + Number(r[3 + i])), [0, 0, 0, 0]);
        expect(summed.map(String)).toEqual(accountCounts);
      }
    });

    it('costs no extra API calls — the per-app counts were already being fetched', async () => {
      const perApp = stubRouted();
      await run(['--stats', '--group-by', 'app']);

      const perAccount = stubRouted();
      await run(['--stats', '--group-by', 'account']);

      expect(perApp.mock.calls).toHaveLength(perAccount.mock.calls.length);
    });

    it('prints an app with no builds in a month as zeros, not "-" and not a missing row', async () => {
      stubRouted();

      await run(['--stats', '--group-by', 'app']);

      const adminAndroid = dataRows(tableOutput()).filter(
        (r) => r[0] === 'Admin' && r[2] === 'android'
      );
      expect(adminAndroid).toHaveLength(3); // still one row per month
      for (const row of adminAndroid) expect(row.slice(3)).toEqual(['0', '0', '0', '0']);
    });

    it('degrades only the failing app to "-", leaving the other app\'s numbers intact', async () => {
      stubRouted({
        builds: {
          'app-1': BUILDS['app-1'],
          'app-2': () => jsonResponse({ errors: [{ message: 'boom' }] }),
        },
      });

      await run(['--stats', '--group-by', 'app']);

      const rows = dataRows(tableOutput());
      for (const row of rows.filter((r) => r[0] === 'Admin')) {
        expect(row.slice(3)).toEqual(['-', '-', '-', '-']);
      }
      const storefrontJulyIos = rows.find(
        (r) => r[0] === 'Storefront' && r[1].startsWith('2026-07-01') && r[2] === 'ios'
      );
      expect(storefrontJulyIos.slice(3)).toEqual(['2', '0', '0', '2']);

      // The warning names the app by slug, which is what --app matches on.
      const stderr = errorSpy.mock.calls.map((args) => args[0]).join('\n');
      expect(stderr).toContain('stats unavailable');
      expect(stderr).toContain('admin');
    });

    it('keeps same-named apps in different accounts on separate rows instead of summing them', async () => {
      const accounts = accountsResponse([
        { id: 'acc-1', name: 'myorg' },
        { id: 'acc-2', name: 'otherorg' },
      ]);
      const apps = [
        { id: 'app-1', name: 'Storefront', slug: 'storefront', accountId: 'acc-1' },
        { id: 'app-2', name: 'Storefront', slug: 'storefront-eu', accountId: 'acc-2' },
      ];
      stubRouted({ accounts, apps });

      await run(['--stats', '--group-by', 'app', '--month', '1']);

      const output = tableOutput();
      expect(output).toContain('2 app(s)');
      const iosJuly = dataRows(output).filter((r) => r[2] === 'ios');
      expect(iosJuly).toHaveLength(2);
      // 2 and 1 — never a single merged row of 3.
      expect(iosJuly.map((r) => r[3]).sort()).toEqual(['1', '2']);
    });

    it('emits no rows for an account whose app list failed — only the stderr warning', async () => {
      const accounts = accountsResponse([
        { id: 'acc-1', name: 'myorg' },
        { id: 'acc-2', name: 'otherorg' },
      ]);
      const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
        const { variables = {} } = JSON.parse(options.body);
        if (variables.accountId === 'acc-2') return jsonResponse({ errors: [{ message: 'nope' }] });
        if (variables.accountId) return appsResponse([TWO_APPS[0]], 'acc-1');
        if (variables.appId) return BUILDS[variables.appId]();
        return accounts;
      });
      vi.stubGlobal('fetch', fetchImpl);

      await run(['--stats', '--group-by', 'app', '--month', '1']);

      const output = tableOutput();
      expect(output).toContain('1 app(s)');
      expect(output).not.toContain('otherorg');
      expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('otherorg');
    });

    it('narrows to a single app with --app, matching on slug', async () => {
      stubRouted();

      await run(['--stats', '--group-by', 'app', '--app', 'admin', '--month', '1']);

      const output = tableOutput();
      expect(output).toContain('1 app(s)');
      expect(new Set(dataRows(output).map((r) => r[0]))).toEqual(new Set(['Admin']));
    });

    // #92: the whole motivation for this issue — the APP column prints the
    // Display name, and pasting that value back into --app must narrow to
    // just that app, even when it doesn't match the app's slug at all.
    it('narrows to a single app with --app, matching the printed Display name', async () => {
      const apps = [
        { id: 'app-1', name: 'Storefront', slug: 'sf-ios-app' },
        { id: 'app-2', name: 'Admin', slug: 'admin' },
      ];
      stubRouted({ apps });

      await run(['--stats', '--group-by', 'app', '--app', 'Storefront', '--month', '1']);

      const output = tableOutput();
      expect(output).toContain('1 app(s)');
      expect(new Set(dataRows(output).map((r) => r[0]))).toEqual(new Set(['Storefront']));
    });

    it('narrows to a single platform with --platform, halving the rows', async () => {
      stubRouted();

      await run(['--stats', '--group-by', 'app', '--platform', 'ios']);

      const output = tableOutput();
      expect(output).toContain('6 row(s)'); // 2 apps × 3 months × 1 platform
      expect(output).not.toContain('│ android');
    });

    it('--group-by account produces byte-identical output to omitting the flag', async () => {
      stubRouted();
      await run(['--stats']);
      const implicit = tableOutput();

      logSpy.mockClear();
      stubRouted();
      await run(['--stats', '--group-by', 'account']);

      expect(tableOutput()).toEqual(implicit);
    });
  });
});

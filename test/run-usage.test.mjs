import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.mjs';
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

  it('emits 3 rows (one per account per month, newest first) with client-side successful-build counts', async () => {
    stubFetch(happyResponses());

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

  // The exact header/row strings are format.test.mjs's contract; this only
  // proves runUsage wires USAGE_FIELDS into the --csv branch.
  it('emits the usage header for --csv', async () => {
    stubFetch(happyResponses());

    await run(['--usage', '--csv']);

    const csv = logSpy.mock.calls[0][0];
    expect(csv.split('\n')[0]).toBe('account,buildsIos,buildsAndroid,periodStart,periodEnd');
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

    await run(['--usage', '--month', '1', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].periodStart).toBe('2026-07-01T00:00:00.000Z');
  });

  it('shows only the requested platform column with --platform', async () => {
    stubFetch(happyResponses());

    await run(['--usage', '--platform', 'ios']);

    expect(tableOutput()).toContain('SUCCESSFUL BUILDS (IOS)');
    expect(tableOutput()).not.toContain('SUCCESSFUL BUILDS (AND)');
  });

  it('degrades a whole account to null build counts (not a failed run) when its apps/builds fetch fails', async () => {
    stubFetch([accountsResponse(), jsonResponse({ errors: [{ message: 'boom' }] })]);

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

    await run(['--usage', '--month', '1', '--json']);

    expect(calls).toBe(5); // 1 accounts + 2 apps + 2 builds pages
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.account).sort()).toEqual(['myorg', 'otherorg']);
  });
});

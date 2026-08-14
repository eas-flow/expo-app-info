import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../../../src/cli.mjs';
import { CliError } from '../../../src/errors.mjs';
import { accountsResponse, fetchSequence, jsonResponse } from '../../helpers.mjs';

describe('run --members', () => {
  let logSpy;
  let errorSpy;
  let originalToken;

  const subscription = {
    id: 'sub-1',
    planId: 'production',
    name: 'Production',
    status: 'active',
    trialEnd: null,
    concurrencies: { total: 2, ios: 1, android: 1 },
  };

  // Defaults to a personal account (one row, ORG "-") since that's the
  // simplest shape most tests here just need a subscription to exist for.
  const accountMembersResponseFor = (accountId = 'acc-1', overrides = {}) =>
    jsonResponse({
      data: {
        account: {
          byId: {
            id: accountId,
            subscription,
            ownerUserActor: { id: `user-${accountId}`, username: accountId },
            membersPaginated: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
            ...overrides,
          },
        },
      },
    });

  const orgMembersEdges = (members) =>
    members.map(({ id, role, username, robotFirstName }) => ({
      node: {
        id,
        role,
        userActor: robotFirstName ? null : { id: `user-${id}`, username },
        actor: robotFirstName
          ? { id: `robot-${id}`, firstName: robotFirstName }
          : { id: `user-${id}` },
      },
    }));

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

  it('prints one row for a personal account, with ORG "-", and never fetches apps or builds', async () => {
    const fetchImpl = stubFetch([accountsResponse(), accountMembersResponseFor()]);

    await run(['--members']);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const output = tableOutput();
    expect(output).toContain('ORG');
    expect(output).toContain('MEMBER');
    expect(output).toContain('ROLE');
    expect(output).toContain('PLAN');
    expect(output).toContain('Production');
    expect(output).toContain('OWNER');
    expect(output).toContain('2 / 1 / 1');
    expect(output).not.toContain('SLUG');
    expect(output).not.toContain('BUILDS');
  });

  it('prints one row per member for an organization account, all sharing the ORG name', async () => {
    stubFetch([
      accountsResponse([{ id: 'acc-1', name: 'myorg' }]),
      accountMembersResponseFor('acc-1', {
        ownerUserActor: null,
        membersPaginated: {
          edges: orgMembersEdges([
            { id: 'm1', role: 'OWNER', username: 'alice' },
            { id: 'm2', role: 'DEVELOPER', username: 'bob' },
          ]),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    ]);

    await run(['--members']);

    const output = tableOutput();
    expect(output).toContain('2 row(s)');
    expect(output).toContain('alice');
    expect(output).toContain('bob');
    expect(output).toContain('OWNER');
    expect(output).toContain('DEVELOPER');
    // ORG appears on both rows, not just once.
    expect(output.match(/myorg/g)).toHaveLength(2);
  });

  it('marks a robot member with "(robot)" using its firstName, since it has no username', async () => {
    stubFetch([
      accountsResponse([{ id: 'acc-1', name: 'myorg' }]),
      accountMembersResponseFor('acc-1', {
        ownerUserActor: null,
        membersPaginated: {
          edges: orgMembersEdges([{ id: 'm1', role: 'DEVELOPER', robotFirstName: 'ci-bot' }]),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    ]);

    await run(['--members']);

    expect(tableOutput()).toContain('ci-bot (robot)');
  });

  it('keeps the row and shows "-" in the plan columns when the token lacks billing/membership permission', async () => {
    stubFetch([
      accountsResponse(),
      jsonResponse({ errors: [{ message: 'Entity not authorized: Account[acc-1]' }] }),
    ]);

    await run(['--members']);

    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).toContain('-');
    expect(output).not.toContain('Production');
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('members unavailable');
  });

  it('shows "-" without a warning when the account is missing from a malformed (but 2xx) response', async () => {
    stubFetch([accountsResponse(), jsonResponse({ data: { account: { byId: null } } })]);

    await run(['--members']);

    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).toContain('-');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports only that platform's concurrency when combined with --platform", async () => {
    stubFetch([accountsResponse(), accountMembersResponseFor()]);

    await run(['--members', '--platform', 'ios']);

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

      const promise = run(['--members']);
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

  // Both tests below use organization accounts (not the personal-account
  // default), since a personal row's ORG is always "-" — the account name
  // only appears in the table for an org row (or a degraded one), and these
  // tests need it visible to check row order/identity.
  const orgResponseFor = (accountId, orgOwnerUsername) =>
    accountMembersResponseFor(accountId, {
      ownerUserActor: null,
      membersPaginated: {
        edges: orgMembersEdges([
          { id: `${accountId}-owner`, role: 'OWNER', username: orgOwnerUsername },
        ]),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

  it('fetches accounts in parallel (mapWithConcurrency) rather than a strictly sequential loop', async () => {
    // Order-preservation is mapWithConcurrency's job, already covered in
    // test/shared/api.test.mjs; this just proves runMembers uses it end to
    // end for --members specifically.
    stubFetch([
      accountsResponse([
        { id: 'acc-1', name: 'myorg' },
        { id: 'acc-2', name: 'otherorg' },
      ]),
      orgResponseFor('acc-1', 'alice'),
      orgResponseFor('acc-2', 'other-owner'),
    ]);

    await run(['--members']);

    const output = tableOutput();
    expect(output).toContain('2 row(s)');
    // Row order must match input account order despite parallel fetching.
    expect(output.indexOf('myorg')).toBeLessThan(output.indexOf('otherorg'));
  });

  it('--account narrows to a single account — the other account is never queried', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('CurrentAccounts')) {
        return accountsResponse([
          { id: 'acc-1', name: 'myorg' },
          { id: 'acc-2', name: 'otherorg' },
        ]);
      }
      expect(body.variables.accountId).toBe('acc-1'); // otherorg must never be queried
      return orgResponseFor('acc-1', 'alice');
    });
    vi.stubGlobal('fetch', fetchImpl);

    await run(['--members', '--account', 'myorg']);

    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 accounts + 1 members, not 2
    const output = tableOutput();
    expect(output).toContain('myorg');
    expect(output).not.toContain('otherorg');
    expect(output).toContain('1 row(s)');
  });

  it('rejects with CliError when combined with --app, since --members never fetches apps', async () => {
    await expect(run(['--members', '--app', 'storefront'])).rejects.toThrow(CliError);
    await expect(run(['--members', '--app', 'storefront'])).rejects.toThrow(
      /--app cannot be used with --members/
    );
  });

  it('rejects with CliError when combined with --local, since --members has no BUILD DATE column', async () => {
    await expect(run(['--members', '--local'])).rejects.toThrow(CliError);
    await expect(run(['--members', '--local'])).rejects.toThrow(
      /--local cannot be used with --members/
    );
  });

  it('still works via the deprecated --plan alias, with a warning', async () => {
    stubFetch([accountsResponse(), accountMembersResponseFor()]);

    await run(['--plan']);

    expect(tableOutput()).toContain('Production');
    expect(errorSpy.mock.calls.map((args) => args[0]).join('\n')).toContain('--plan is deprecated');
  });
});

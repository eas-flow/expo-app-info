// Aggregation-focused tests for fetchMembersEntries, exercised directly
// against a fake client (fetchAccountMembers) rather than through run() + a
// mocked global fetch. The personal/org split and row shaping is this
// function's job; the raw GraphQL shape (pagination, Robot inline fragment)
// stays covered in test/shared/api.test.mjs.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/errors.mjs';
import { fetchMembersEntries } from '../../../src/features/members/service.mjs';

const subscription = {
  name: 'Production',
  planId: 'production',
  status: 'active',
  trialEnd: null,
  concurrencies: { total: 2, ios: 1, android: 1 },
};

function makeClient(byAccountId) {
  return {
    async fetchAccountMembers(accountId) {
      const result = byAccountId[accountId];
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('fetchMembersEntries — personal accounts', () => {
  it('emits one OWNER row with ORG "-" for a personal account', async () => {
    const accounts = [{ id: 'acc-1', name: 'it0' }];
    const client = makeClient({
      'acc-1': {
        subscription,
        ownerUserActor: { username: 'it0' },
        totalMemberCount: 0,
        members: [],
      },
    });

    const { entries, warnings } = await fetchMembersEntries(client, accounts);

    expect(warnings).toEqual([]);
    expect(entries).toEqual([
      {
        account: 'it0',
        isPersonal: true,
        member: 'it0',
        role: 'OWNER',
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
});

describe('fetchMembersEntries — organization accounts', () => {
  it('emits one row per member, all sharing the same account-level plan fields', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      'acc-1': {
        subscription,
        ownerUserActor: null,
        totalMemberCount: 2,
        members: [
          { id: 'm1', role: 'OWNER', userActor: { username: 'it0' }, actor: {} },
          { id: 'm2', role: 'DEVELOPER', userActor: { username: 'kohei-dev' }, actor: {} },
        ],
      },
    });

    const { entries } = await fetchMembersEntries(client, accounts);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => [e.member, e.role])).toEqual([
      ['it0', 'OWNER'],
      ['kohei-dev', 'DEVELOPER'],
    ]);
    expect(entries.every((e) => e.isPersonal === false)).toBe(true);
    expect(entries.every((e) => e.plan === 'Production')).toBe(true);
  });

  it('marks a robot member ("(robot)") using actor.firstName since it has no userActor', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      'acc-1': {
        subscription,
        ownerUserActor: null,
        totalMemberCount: 1,
        members: [{ id: 'm1', role: 'DEVELOPER', userActor: null, actor: { firstName: 'ci-bot' } }],
      },
    });

    const { entries } = await fetchMembersEntries(client, accounts);

    expect(entries[0].member).toBe('ci-bot (robot)');
  });

  it('emits one placeholder row (MEMBER/ROLE null) for an organization with zero members, rather than omitting it', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      'acc-1': { subscription, ownerUserActor: null, totalMemberCount: 0, members: [] },
    });

    const { entries } = await fetchMembersEntries(client, accounts);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      account: 'myorg',
      isPersonal: false,
      member: null,
      role: null,
    });
  });
});

describe('fetchMembersEntries — degraded accounts', () => {
  it('emits one degraded row and a warning when fetchAccountMembers throws ApiError', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({ 'acc-1': new ApiError('boom') });

    const { entries, warnings } = await fetchMembersEntries(client, accounts);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      account: 'myorg',
      isPersonal: null,
      member: null,
      role: null,
    });
    expect(warnings).toEqual(['myorg: boom']);
  });

  it('emits one degraded row without a warning when the account is missing from an otherwise-2xx response', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({ 'acc-1': null });

    const { entries, warnings } = await fetchMembersEntries(client, accounts);

    expect(entries).toHaveLength(1);
    expect(entries[0].isPersonal).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('rethrows a non-ApiError instead of degrading the row', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({ 'acc-1': new TypeError('unexpected') });

    await expect(fetchMembersEntries(client, accounts)).rejects.toThrow(TypeError);
  });

  it('fetches every account in parallel and keeps warnings in account order', async () => {
    const accounts = [
      { id: 'acc-1', name: 'first' },
      { id: 'acc-2', name: 'second' },
    ];
    const client = makeClient({ 'acc-1': new ApiError('boom-1'), 'acc-2': new ApiError('boom-2') });

    const { warnings } = await fetchMembersEntries(client, accounts);

    expect(warnings).toEqual(['first: boom-1', 'second: boom-2']);
  });
});

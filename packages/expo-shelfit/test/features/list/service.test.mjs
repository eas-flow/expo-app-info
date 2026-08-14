// fetchListEntries tested directly against a fake client, rather than
// through run() + a mocked global fetch — the client-side shaping this
// function does (one entry per build, a null-build placeholder row, --app/
// --platform narrowing) doesn't need a GraphQL round trip to exercise.
import { describe, expect, it } from 'vitest';
import { fetchListEntries } from '../../../src/features/list/service.mjs';

const opts = (overrides = {}) => ({ app: null, history: null, platform: null, ...overrides });

function makeClient({ apps = {}, builds = {} } = {}) {
  const calls = { fetchApps: 0, fetchBuilds: [] };
  return {
    calls,
    async fetchApps(accountId) {
      calls.fetchApps++;
      return apps[accountId] ?? [];
    },
    async fetchBuilds(appId, options) {
      calls.fetchBuilds.push({ appId, options });
      return builds[appId] ?? [];
    },
  };
}

const iosBuild = (overrides = {}) => ({
  platform: 'IOS',
  appVersion: '3.2.1',
  appBuildVersion: '41',
  sdkVersion: '54.0.0',
  cliVersion: '18.0.4',
  createdAt: '2026-07-20T00:00:00.000Z',
  status: 'FINISHED',
  ...overrides,
});

describe('fetchListEntries', () => {
  it('maps each returned build to its own entry', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      builds: { 'app-1': [iosBuild()] },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries).toEqual([
      {
        account: 'myorg',
        app: 'Storefront',
        slug: 'storefront',
        platform: 'ios',
        version: '3.2.1',
        build: '41',
        sdk: '54.0.0',
        cli: '18.0.4',
        status: 'FINISHED',
        lastBuildAt: '2026-07-20T00:00:00.000Z',
      },
    ]);
  });

  it('emits one all-null placeholder entry for an app with no builds at all', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      builds: { 'app-1': [] },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries).toEqual([
      {
        account: 'myorg',
        app: 'Storefront',
        slug: 'storefront',
        platform: null,
        version: null,
        build: null,
        sdk: null,
        cli: null,
        status: null,
        lastBuildAt: null,
      },
    ]);
  });

  it('emits one entry per build when fetchBuilds returns more than one (--history)', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      builds: {
        'app-1': [
          iosBuild({ appBuildVersion: '41', createdAt: '2026-07-20T00:00:00.000Z' }),
          iosBuild({ appBuildVersion: '40', createdAt: '2026-06-20T00:00:00.000Z' }),
        ],
      },
    });

    const entries = await fetchListEntries(client, accounts, opts({ history: 2 }));

    expect(entries.map((e) => e.build)).toEqual(['41', '40']);
  });

  it('passes --history and --platform through to fetchBuilds as limit/platform', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      builds: { 'app-1': [iosBuild()] },
    });

    await fetchListEntries(client, accounts, opts({ history: 5, platform: 'ios' }));

    expect(client.calls.fetchBuilds).toEqual([
      { appId: 'app-1', options: { limit: 5, platform: 'ios' } },
    ]);
  });

  it('--app narrows before fetchBuilds is called — the non-matching app is never fetched', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Field Ops', slug: 'field-ops' },
        ],
      },
      builds: { 'app-1': [iosBuild()], 'app-2': [iosBuild()] },
    });

    await fetchListEntries(client, accounts, opts({ app: 'storefront' }));

    expect(client.calls.fetchBuilds).toEqual([
      { appId: 'app-1', options: { limit: 1, platform: null } },
    ]);
  });

  it('drops only the no-build placeholder rows when --platform is set, since fetchBuilds is already scoped', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Empty', slug: 'empty' },
        ],
      },
      builds: { 'app-1': [iosBuild()], 'app-2': [] },
    });

    const entries = await fetchListEntries(client, accounts, opts({ platform: 'ios' }));

    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe('storefront');
  });

  it('rejects (via appFilter.finalize) when --app matches no app across any account', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
    });

    await expect(fetchListEntries(client, accounts, opts({ app: 'nope' }))).rejects.toThrow(
      /No app matched "nope"/
    );
  });

  it('fetches apps and builds across multiple accounts, tagging each entry with its own account', async () => {
    const accounts = [
      { id: 'acc-1', name: 'myorg' },
      { id: 'acc-2', name: 'otherorg' },
    ];
    const client = makeClient({
      apps: {
        'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }],
        'acc-2': [{ id: 'app-2', name: 'Admin', slug: 'admin' }],
      },
      builds: { 'app-1': [iosBuild()], 'app-2': [iosBuild()] },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries.map((e) => e.account)).toEqual(['myorg', 'otherorg']);
  });
});

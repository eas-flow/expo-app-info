// fetchListEntries tested directly against a fake client, rather than
// through run() + a mocked global fetch — the client-side shaping this
// function does (one entry per build, a null-build placeholder row, --app/
// --platform narrowing, attaching each platform's submission/update) doesn't
// need a GraphQL round trip to exercise.
import { describe, expect, it } from 'vitest';
import { fetchListEntries } from '../../../src/features/list/service.mjs';

const opts = (overrides = {}) => ({ app: null, history: null, platform: null, ...overrides });

function makeClient({ apps = {}, overview = {} } = {}) {
  const calls = { fetchApps: 0, fetchAppOverview: [] };
  return {
    calls,
    async fetchApps(accountId) {
      calls.fetchApps++;
      return apps[accountId] ?? [];
    },
    async fetchAppOverview(appId, options) {
      calls.fetchAppOverview.push({ appId, options });
      return (
        overview[appId] ?? {
          builds: [],
          submissionsByPlatform: {},
          updatesByPlatform: {},
        }
      );
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

const iosSubmission = { status: 'FINISHED', createdAt: '2026-07-19T00:00:00.000Z' };
const iosUpdate = { branch: 'production', createdAt: '2026-07-18T00:00:00.000Z' };

describe('fetchListEntries', () => {
  it('maps each returned build to its own entry, attaching that platform’s submission/update', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': {
          builds: [iosBuild()],
          submissionsByPlatform: { ios: iosSubmission },
          updatesByPlatform: { ios: iosUpdate },
        },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries).toEqual([
      {
        account: 'myorg',
        app: 'storefront',
        platform: 'ios',
        version: '3.2.1',
        build: '41',
        sdk: '54.0.0',
        cli: '18.0.4',
        status: 'FINISHED',
        lastBuildAt: '2026-07-20T00:00:00.000Z',
        submissionStatus: 'FINISHED',
        submissionCreatedAt: '2026-07-19T00:00:00.000Z',
        updateBranch: 'production',
        updateCreatedAt: '2026-07-18T00:00:00.000Z',
      },
    ]);
  });

  it('emits one all-null placeholder entry for an app with no builds at all, ignoring any submission/update', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': {
          builds: [],
          submissionsByPlatform: { ios: iosSubmission },
          updatesByPlatform: { ios: iosUpdate },
        },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries).toEqual([
      {
        account: 'myorg',
        app: 'storefront',
        platform: null,
        version: null,
        build: null,
        sdk: null,
        cli: null,
        status: null,
        lastBuildAt: null,
        submissionStatus: null,
        submissionCreatedAt: null,
        updateBranch: null,
        updateCreatedAt: null,
      },
    ]);
  });

  it('emits one entry per build when fetchAppOverview returns more than one (--history), repeating the same submission/update on every row', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': {
          builds: [
            iosBuild({ appBuildVersion: '41', createdAt: '2026-07-20T00:00:00.000Z' }),
            iosBuild({ appBuildVersion: '40', createdAt: '2026-06-20T00:00:00.000Z' }),
          ],
          submissionsByPlatform: { ios: iosSubmission },
          updatesByPlatform: { ios: iosUpdate },
        },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts({ history: 2 }));

    expect(entries.map((e) => e.build)).toEqual(['41', '40']);
    expect(entries.every((e) => e.submissionStatus === 'FINISHED')).toBe(true);
    expect(entries.every((e) => e.updateBranch === 'production')).toBe(true);
  });

  it('shows "-" equivalents (null fields) when a platform has builds but no submission/update yet', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': {
          builds: [iosBuild()],
          submissionsByPlatform: { ios: null },
          updatesByPlatform: { ios: null },
        },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries[0].submissionStatus).toBeNull();
    expect(entries[0].updateBranch).toBeNull();
  });

  it('passes --history and --platform through to fetchAppOverview as limit/platform', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': { builds: [iosBuild()], submissionsByPlatform: {}, updatesByPlatform: {} },
      },
    });

    await fetchListEntries(client, accounts, opts({ history: 5, platform: 'ios' }));

    expect(client.calls.fetchAppOverview).toEqual([
      { appId: 'app-1', options: { limit: 5, platform: 'ios' } },
    ]);
  });

  it('--app narrows before fetchAppOverview is called — the non-matching app is never fetched', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Field Ops', slug: 'field-ops' },
        ],
      },
      overview: {
        'app-1': { builds: [iosBuild()], submissionsByPlatform: {}, updatesByPlatform: {} },
        'app-2': { builds: [iosBuild()], submissionsByPlatform: {}, updatesByPlatform: {} },
      },
    });

    await fetchListEntries(client, accounts, opts({ app: 'storefront' }));

    expect(client.calls.fetchAppOverview).toEqual([
      { appId: 'app-1', options: { limit: 1, platform: null } },
    ]);
  });

  it('drops only the no-build placeholder rows when --platform is set, since fetchAppOverview is already scoped', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: {
        'acc-1': [
          { id: 'app-1', name: 'Storefront', slug: 'storefront' },
          { id: 'app-2', name: 'Empty', slug: 'empty' },
        ],
      },
      overview: {
        'app-1': { builds: [iosBuild()], submissionsByPlatform: {}, updatesByPlatform: {} },
        'app-2': { builds: [], submissionsByPlatform: {}, updatesByPlatform: {} },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts({ platform: 'ios' }));

    expect(entries).toHaveLength(1);
    expect(entries[0].app).toBe('storefront');
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
      overview: {
        'app-1': { builds: [iosBuild()], submissionsByPlatform: {}, updatesByPlatform: {} },
        'app-2': { builds: [iosBuild()], submissionsByPlatform: {}, updatesByPlatform: {} },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries.map((e) => e.account)).toEqual(['myorg', 'otherorg']);
  });
});

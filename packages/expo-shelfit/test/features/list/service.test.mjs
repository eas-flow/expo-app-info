// fetchListEntries tested directly against a fake client, rather than
// through run() + a mocked global fetch — the client-side shaping this
// function does (one entry per build, a null-build placeholder row, --app/
// --platform narrowing) doesn't need a GraphQL round trip to exercise.
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
      return overview[appId] ?? { builds: [] };
    },
  };
}

// fetchAppOverview's output shape: SUBMIT/UPDATE already folded onto the build.
const iosBuild = (overrides = {}) => ({
  platform: 'IOS',
  appVersion: '3.2.1',
  appBuildVersion: '41',
  sdkVersion: '54.0.0',
  cliVersion: '18.0.4',
  createdAt: '2026-07-20T00:00:00.000Z',
  status: 'FINISHED',
  submission: null,
  update: null,
  ...overrides,
});

const iosSubmission = { status: 'FINISHED', createdAt: '2026-07-19T00:00:00.000Z' };
const iosUpdate = { branch: 'production', createdAt: '2026-07-18T00:00:00.000Z' };

describe('fetchListEntries', () => {
  it('maps each returned build to its own entry, flattening its submission/update onto it', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': { builds: [iosBuild({ submission: iosSubmission, update: iosUpdate })] },
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

  it('emits one all-null placeholder entry for an app with no builds at all', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: { 'app-1': { builds: [] } },
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

  it('gives each --history row its own submission/update rather than repeating one build’s', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': {
          builds: [
            iosBuild({
              appBuildVersion: '41',
              createdAt: '2026-07-20T00:00:00.000Z',
              submission: iosSubmission,
              update: iosUpdate,
            }),
            iosBuild({
              appBuildVersion: '40',
              createdAt: '2026-06-20T00:00:00.000Z',
              submission: { status: 'ERRORED', createdAt: '2026-06-21T00:00:00.000Z' },
              update: { branch: 'preview', createdAt: '2026-06-22T00:00:00.000Z' },
            }),
          ],
        },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts({ history: 2 }));

    expect(entries.map((e) => e.build)).toEqual(['41', '40']);
    expect(entries.map((e) => e.submissionStatus)).toEqual(['FINISHED', 'ERRORED']);
    expect(entries.map((e) => e.submissionCreatedAt)).toEqual([
      '2026-07-19T00:00:00.000Z',
      '2026-06-21T00:00:00.000Z',
    ]);
    expect(entries.map((e) => e.updateBranch)).toEqual(['production', 'preview']);
  });

  it('shows "-" equivalents (null fields) for a build with no submission/update of its own', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: { 'app-1': { builds: [iosBuild()] } },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries[0].submissionStatus).toBeNull();
    expect(entries[0].submissionCreatedAt).toBeNull();
    expect(entries[0].updateBranch).toBeNull();
    expect(entries[0].updateCreatedAt).toBeNull();
  });

  it('passes --history and --platform through to fetchAppOverview as limit/platform', async () => {
    const accounts = [{ id: 'acc-1', name: 'myorg' }];
    const client = makeClient({
      apps: { 'acc-1': [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }] },
      overview: {
        'app-1': { builds: [iosBuild()] },
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
        'app-1': { builds: [iosBuild()] },
        'app-2': { builds: [iosBuild()] },
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
        'app-1': { builds: [iosBuild()] },
        'app-2': { builds: [] },
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
        'app-1': { builds: [iosBuild()] },
        'app-2': { builds: [iosBuild()] },
      },
    });

    const entries = await fetchListEntries(client, accounts, opts());

    expect(entries.map((e) => e.account)).toEqual(['myorg', 'otherorg']);
  });
});

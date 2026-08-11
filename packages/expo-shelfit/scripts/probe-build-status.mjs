#!/usr/bin/env node
// Dev-only verification script (not shipped — see package.json#files).
// issue #83 (build status visibility) cannot be designed without knowing,
// against the real API:
//   1. What `status` enum values actually come back (FINISHED/ERRORED plus
//      however queued/in-progress/canceled builds are represented)
//   2. Whether `builds(filter: { platform })` with no `status` key returns
//      every status, or whether `status` is a required filter field
//   3. Whether `status` accepts a list of values (e.g.
//      `status: [FINISHED, ERRORED]`) or only a single enum value
//   4. Whether `appVersion`/`appBuildVersion` are null on non-FINISHED builds
// Run this against a real account with builds in more than one status, then
// paste the full output into issue #83 — none of #83's design decisions
// (status -> display-string mapping, whether "-" covers missing version
// fields, the `--stats` ERRORED BUILDS column) should be written until this
// comes back.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-build-status.mjs                    # first app in every account
//   node scripts/probe-build-status.mjs --account myorg
//   node scripts/probe-build-status.mjs --account myorg --app storefront
//   node scripts/probe-build-status.mjs --limit 20          # builds sampled per platform (default 20)
//
// Reads the token from the environment only (never printed). Output contains real
// account/app/build data — review before sharing.

import { createApiClient } from '../src/api.mjs';

const API_URL = process.env.EXPO_API_URL ?? 'https://api.expo.dev/graphql';

const token = process.env.EXPO_TOKEN?.trim();
if (!token) {
  console.error('EXPO_TOKEN is not set. export EXPO_TOKEN=xxxxx and re-run.');
  process.exit(1);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const accountFilter = argValue('--account')?.toLowerCase() ?? null;
const appFilter = argValue('--app')?.toLowerCase() ?? null;
const sampleLimit = Number(argValue('--limit') ?? 20);

const client = createApiClient({
  apiUrl: API_URL,
  authHeaders: { authorization: `Bearer ${token}` },
});

const accounts = (await client.fetchAccounts()).filter(
  (a) => accountFilter === null || a.name.toLowerCase() === accountFilter
);

if (accounts.length === 0) {
  console.error('No matching accounts for this token.');
  process.exit(1);
}

console.log(`API: ${API_URL}`);
console.log(`Sample size per platform: ${sampleLimit}`);
console.log(`Accounts to check: ${accounts.length}`);

for (const account of accounts) {
  console.log(`\n${'='.repeat(72)}\nACCOUNT ${account.name}\n${'='.repeat(72)}`);

  const apps = (await client.fetchApps(account.id)).filter(
    (a) => appFilter === null || a.slug.toLowerCase() === appFilter
  );

  if (apps.length === 0) {
    console.log('  (no matching apps in this account)');
    continue;
  }

  // One app per account is enough; pick one with a mix of statuses if you
  // can (--app), since a fully-green app won't exercise anything interesting.
  const app = apps[0];
  console.log(`  Using app: ${app.name} (${app.slug})`);

  // [1] & partial [4]: filter with no `status` key at all — does it error
  // (status required), or return every status? The distinct `status` values
  // seen here also answer unknown #1 as a side effect.
  console.log('\n  [1] filter: { platform } with no status key —');
  try {
    const noStatus = await client.gql(
      `query ProbeNoStatusFilter($appId: String!, $limit: Int!) {
        app { byId(appId: $appId) { id
          builds(offset: 0, limit: $limit, filter: { platform: IOS }) {
            id status appVersion appBuildVersion createdAt
          }
        } }
      }`,
      { appId: app.id, limit: sampleLimit }
    );
    const builds = noStatus.app.byId.builds;
    console.log(`      [ok] accepted — returned ${builds.length} build(s)`);
    const statuses = [...new Set(builds.map((b) => b.status))];
    console.log(
      `      distinct status values seen: ${statuses.join(', ') || '(none — zero builds for this app/platform)'}`
    );
  } catch (err) {
    console.log(`      FAILED: ${err?.message ?? err}`);
    console.log(
      '      ^ if this complains that `status` is required, the filter field is mandatory.'
    );
  }

  // [2]: does `status` accept a list of enum values?
  console.log('\n  [2] filter: { platform, status: [FINISHED, ERRORED] } (array) —');
  try {
    const arrayStatus = await client.gql(
      `query ProbeArrayStatus($appId: String!, $limit: Int!) {
        app { byId(appId: $appId) { id
          builds(offset: 0, limit: $limit, filter: { platform: IOS, status: [FINISHED, ERRORED] }) {
            id status
          }
        } }
      }`,
      { appId: app.id, limit: sampleLimit }
    );
    console.log(`      [ok] accepted — returned ${arrayStatus.app.byId.builds.length} build(s)`);
  } catch (err) {
    console.log(`      FAILED: ${err?.message ?? err}`);
    console.log('      ^ likely means `status` only accepts a single enum value, not a list.');
  }

  // [3]: for every non-FINISHED build sampled, are appVersion/appBuildVersion null?
  console.log('\n  [3] appVersion/appBuildVersion on non-FINISHED builds (both platforms) —');
  try {
    const wide = await client.gql(
      `query ProbeWideSample($appId: String!, $limit: Int!) {
        app { byId(appId: $appId) { id
          ios: builds(offset: 0, limit: $limit, filter: { platform: IOS }) {
            status appVersion appBuildVersion
          }
          android: builds(offset: 0, limit: $limit, filter: { platform: ANDROID }) {
            status appVersion appBuildVersion
          }
        } }
      }`,
      { appId: app.id, limit: sampleLimit }
    );
    const allBuilds = [...wide.app.byId.ios, ...wide.app.byId.android];
    const nonFinished = allBuilds.filter((b) => b.status !== 'FINISHED');
    if (nonFinished.length === 0) {
      console.log(
        '      (no non-FINISHED builds in this sample — widen --limit or pick a different --app)'
      );
    } else {
      for (const b of nonFinished) {
        console.log(
          `      status=${b.status}  appVersion=${b.appVersion ?? 'null'}  appBuildVersion=${b.appBuildVersion ?? 'null'}`
        );
      }
    }
  } catch (err) {
    console.log(`      FAILED: ${err?.message ?? err}`);
  }
}

console.log('\nDone. Paste the output above into issue #83 — this is what the STATUS');
console.log('column mapping, the --status-array question, and the appVersion "-"');
console.log('fallback all depend on.');

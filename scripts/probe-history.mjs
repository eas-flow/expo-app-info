#!/usr/bin/env node
// Dev-only verification script for issue #17 (not shipped — see package.json#files).
// Checks two things against the real API for `--history <N>`: whether
// `builds(limit: 100)` (the --history validation cap) is accepted or clamped, and
// what order `builds(offset, limit)` actually returns in (fetchBuilds always
// re-sorts client-side regardless — this just confirms that sort isn't a no-op).
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-history.mjs                    # first app in every account
//   node scripts/probe-history.mjs --account myorg
//   node scripts/probe-history.mjs --account myorg --app storefront
//   node scripts/probe-history.mjs --limit 100         # override the tested limit (default 100)
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
const testLimit = Number(argValue('--limit') ?? 100);

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
console.log(`Testing limit: ${testLimit}`);
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

  // One app per account is enough; keeps this cheap to run for real.
  const app = apps[0];
  console.log(`  Using app: ${app.name} (${app.slug})`);

  try {
    // Raw query (not fetchBuilds) to see the API's own order before the client-side sort.
    const raw = await client.gql(
      `query ProbeBuilds($appId: String!, $limit: Int!) {
        app { byId(appId: $appId) { id
          ios: builds(offset: 0, limit: $limit, filter: { platform: IOS, status: FINISHED }) {
            appBuildVersion createdAt
          }
          android: builds(offset: 0, limit: $limit, filter: { platform: ANDROID, status: FINISHED }) {
            appBuildVersion createdAt
          }
        } }
      }`,
      { appId: app.id, limit: testLimit }
    );

    const iosDates = raw.app.byId.ios.map((b) => b.createdAt);
    const androidDates = raw.app.byId.android.map((b) => b.createdAt);
    const isDescending = (dates) =>
      dates.every((d, i) => i === 0 || new Date(dates[i - 1]) >= new Date(d));

    console.log(`  [ok] limit: ${testLimit} was accepted (no GraphQL error)`);
    console.log(`  ios: requested ${testLimit}, got ${raw.app.byId.ios.length}`);
    console.log(`  android: requested ${testLimit}, got ${raw.app.byId.android.length}`);
    console.log(
      `  ios order as returned by the API: ${isDescending(iosDates) ? 'already newest-first' : 'NOT newest-first (client-side sort in fetchBuilds is load-bearing)'}`
    );
    console.log(
      `  android order as returned by the API: ${isDescending(androidDates) ? 'already newest-first' : 'NOT newest-first (client-side sort in fetchBuilds is load-bearing)'}`
    );

    // Also confirm fetchBuilds() itself comes back sorted, end to end.
    const sorted = await client.fetchBuilds(app.id, { limit: testLimit });
    const sortedDates = sorted.map((b) => b.createdAt);
    console.log(
      `  [${isDescending(sortedDates) ? 'ok' : '!!'}] fetchBuilds() result is ${isDescending(sortedDates) ? '' : 'NOT '}newest-first`
    );
  } catch (err) {
    console.log(`  FAILED: ${err?.message ?? err}`);
    console.log(
      `  ^ if this mentions the limit argument, the API rejects or clamps limit: ${testLimit} — lower MAX_HISTORY in src/cli.mjs to match.`
    );
  }
}

console.log('\nDone. Paste the output above into issue #17.');

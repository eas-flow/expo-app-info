#!/usr/bin/env node
// Verification script for issue #17 — NOT part of the published package
// (`package.json#files` only ships bin/ and src/).
//
// `--history <N>` raises `builds(offset: 0, limit: N, ...)` from the
// hardcoded `limit: 1` the CLI has always used. Two things are unverified
// against the real API before shipping that:
//
//   1. Does `builds(limit: 100)` (the cap `--history` validates against)
//      actually get accepted, or does the API reject/clamp it below that?
//      If it clamps or errors, MAX_HISTORY in src/cli.mjs needs to come down
//      to match.
//   2. What order does `builds(offset, limit)` actually return in? The CLI
//      does not trust this (it sorts by `createdAt` descending itself in
//      `fetchBuilds`), but knowing the real order helps sanity-check that
//      the sort is doing something, not silently no-op-ing.
//
// This calls the real `fetchBuilds()` the CLI ships, against the first app
// found in each account (or the app given via --app), so a good run here is
// a good run in production.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-history.mjs                    # first app in every account
//   node scripts/probe-history.mjs --account myorg
//   node scripts/probe-history.mjs --account myorg --app storefront
//   node scripts/probe-history.mjs --limit 100         # override the tested limit (default 100)
//
// The token is read from the environment only and is never printed. The
// output does contain account/app names and build metadata — read it before
// pasting it anywhere public.

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

  // One app is enough to answer both questions; skip the rest to keep this
  // script cheap to run against real accounts.
  const app = apps[0];
  console.log(`  Using app: ${app.name} (${app.slug})`);

  try {
    // Call the raw query directly (not fetchBuilds) so we can see the
    // API's own order BEFORE the client-side sort is applied.
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

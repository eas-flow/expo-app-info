#!/usr/bin/env node
// Dev-only verification script (not shipped — see package.json#files).
// --stats counts "successful builds" client-side (paging builds(...FINISHED) and
// bucketing by platform + UTC calendar month, src/api.mjs#countBuildsByMonth) rather
// than using EAS's billing/usage metrics. This isn't guaranteed to match EAS's own
// numbers (e.g. retry handling may differ) — run this against a real account and
// compare with the EAS dashboard before shipping or changing the counting logic.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-stats.mjs                    # every account, last 3 months
//   node scripts/probe-stats.mjs --account myorg
//   node scripts/probe-stats.mjs --month 6          # widen the window (same cap as --stats: 12)
//
// Reads the token from the environment only (never printed). Output contains real
// account/app/build data — review before sharing.

import { createApiClient } from '../src/api.mjs';
import { calendarMonths } from '../src/dates.mjs';

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
const monthCount = Number(argValue('--month') ?? 3);

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

// Same calendar-month helper --stats calls, so this mirrors what the CLI computes.
const months = calendarMonths(monthCount);

console.log(`API: ${API_URL}`);
console.log(`Accounts to check: ${accounts.length}`);
console.log(`Months (UTC, newest first): ${months.map((m) => m.start.slice(0, 10)).join(', ')}`);

for (const account of accounts) {
  console.log(`\n${'='.repeat(72)}\nACCOUNT ${account.name}\n${'='.repeat(72)}`);

  try {
    const apps = await client.fetchApps(account.id);
    console.log(`  Apps: ${apps.length}`);

    const totals = months.map(() => ({ ios: 0, android: 0 }));

    for (const app of apps) {
      const counts = await client.countBuildsByMonth(app.id, months);
      counts.forEach((c, i) => {
        totals[i].ios += c.ios;
        totals[i].android += c.android;
      });
    }

    console.log('\n  Client-side successful-build counts, per UTC calendar month:');
    months.forEach((period, i) => {
      const label = `${period.start.slice(0, 10)} -> ${period.end.slice(0, 10)} (exclusive)`;
      console.log(`    ${label}  ios: ${totals[i].ios}  android: ${totals[i].android}`);
    });

    console.log(
      "\n  -> Compare the CURRENT (first) row above against the EAS dashboard's\n" +
        '     usage-so-far for this account. They are not guaranteed to match\n' +
        "     exactly (this counts FINISHED builds client-side; EAS's own\n" +
        '     billing/usage metric may account for retries or other cases\n' +
        '     differently) — note any discrepancy found.'
    );
  } catch (err) {
    console.log(`  FAILED: ${err?.message ?? err}`);
  }
}

console.log('\nDone. Paste the output above into the tracking issue for this check.');

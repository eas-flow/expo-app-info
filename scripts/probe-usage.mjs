#!/usr/bin/env node
// Verification script for issue #18 — NOT part of the published package
// (`package.json#files` only ships bin/ and src/).
//
// Issue #18 replaced --usage's old billing-period query (Q_ACCOUNT_PLAN,
// subscription + billingPeriod + usageMetrics.byBillingPeriod) with
// client-side "successful build" counting: page through each app's
// `builds(offset, limit, filter: { status: FINISHED })` and bucket by
// platform + UTC calendar month (src/api.mjs#countBuildsByMonth).
//
// That client-side count is NOT guaranteed to match EAS's own billing/usage
// definition (retry handling, etc. may differ) — this script exists so that
// can be checked against a real account's EAS dashboard numbers before
// shipping, and re-checked if the counting logic ever changes.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-usage.mjs                    # every account, last 3 months
//   node scripts/probe-usage.mjs --account myorg
//   node scripts/probe-usage.mjs --month 6          # widen the window (same cap as --usage: 12)
//
// The token is read from the environment only and is never printed. The
// output does contain account/app names and build counts — read it before
// pasting it anywhere public.

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

// UTC calendar-month boundaries, current month first — same helper --usage
// itself calls, so this script observes exactly what the CLI will compute.
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

console.log('\nDone. Paste the output above into issue #18.');

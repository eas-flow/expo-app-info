#!/usr/bin/env node
// Verification script for issue #15 — NOT part of the published package
// (`package.json#files` only ships bin/ and src/).
//
// Round 2. Round 1 (see the issue thread) found that:
//   - `filterParams` on `metricsForServiceMetric` does not filter by
//     platform — every guessed shape returned the same total, and an
//     unrecognized key was silently accepted too. That approach is dead.
//   - The real per-platform split lives on the *other* aggregate query,
//     `usageMetrics.byBillingPeriod(...).planMetrics[].platformBreakdown`,
//     found by introspecting `EstimatedUsage` in the schema.
//   - The original queries here had two of their own bugs: `billingPeriod`
//     needs a required `date` argument, and `planMetrics`/`overageMetrics`
//     are object-typed fields that were queried with no sub-selection —
//     both are GraphQL validation errors, not permission errors, and both
//     surfaced as an unhelpful bare "HTTP 400" because `api.mjs#gql()` threw
//     before reading the response body. Both are now fixed in src/api.mjs.
//
// This script now just calls the real `fetchAccountPlan()` the CLI will
// ship, so a good run here is a good run in production.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-usage.mjs                 # every account the token sees
//   node scripts/probe-usage.mjs --account myorg
//
// The token is read from the environment only and is never printed. The
// output does contain account names, plan names, and build counts — read it
// before pasting it anywhere public.

import { createApiClient } from '../src/api.mjs';

const API_URL = process.env.EXPO_API_URL ?? 'https://api.expo.dev/graphql';

const token = process.env.EXPO_TOKEN?.trim();
if (!token) {
  console.error('EXPO_TOKEN is not set. export EXPO_TOKEN=xxxxx and re-run.');
  process.exit(1);
}

const accountFilter = (() => {
  const i = process.argv.indexOf('--account');
  return i !== -1 ? (process.argv[i + 1]?.toLowerCase() ?? null) : null;
})();

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
console.log(`Accounts visible to this token: ${accounts.length}`);

for (const account of accounts) {
  console.log(`\n${'='.repeat(72)}\nACCOUNT ${account.name}\n${'='.repeat(72)}`);

  try {
    const plan = await client.fetchAccountPlan(account.id);
    console.log(JSON.stringify(plan, null, 2));

    console.log('\nSanity checks:');
    console.log(
      plan.billingPeriod
        ? `  [ok] billing period: ${plan.billingPeriod.start} -> ${plan.billingPeriod.end}`
        : '  [!!] billingPeriod is null — is this account on a paid plan at all?'
    );
    if (plan.buildsByPlatform) {
      const { ios, android } = plan.buildsByPlatform;
      console.log(`  [ok] builds this period — ios: ${ios}, android: ${android}`);
      console.log(
        '  -> Do these two numbers roughly match what you actually built this billing period?'
      );
    } else {
      console.log('  [!!] buildsByPlatform is null — no BUILDS entry in planMetrics for this account.');
    }
  } catch (err) {
    console.log(`  FAILED: ${err?.message ?? err}`);
    console.log('  ^ if this still says a bare "HTTP 4xx" with no GraphQL message attached,');
    console.log('    the gql() body-reading fix did not do its job — that itself is a bug to report.');
  }
}

console.log('\nDone. Paste the output above into issue #15.');

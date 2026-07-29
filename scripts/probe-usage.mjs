#!/usr/bin/env node
// Throwaway probe for issue #15 — NOT part of the published package
// (`package.json#files` only ships bin/ and src/).
//
// The EAS GraphQL API is unofficial and unversioned, and `filterParams` on
// `metricsForServiceMetric` is typed `JSONObject`, so introspection cannot
// tell us whether build usage can be split per platform. This script asks the
// real API and prints what comes back.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-usage.mjs                 # every account the token sees
//   node scripts/probe-usage.mjs --account myorg
//
// The token is read from the environment only and is never printed. The output
// does contain account names, plan names and build counts — read it before
// pasting it anywhere public.

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

const Q_SUBSCRIPTION = `query Subscription($accountId: String!) {
  account { byId(accountId: $accountId) { id name
    subscription {
      id planId name price status trialEnd nextInvoice willCancel
      concurrencies { total ios android }
    }
    billingPeriod { start end }
  } }
}`;

const Q_BY_BILLING_PERIOD = `query UsageByBillingPeriod($accountId: String!, $date: DateTime!) {
  account { byId(accountId: $accountId) { id
    usageMetrics {
      byBillingPeriod(date: $date, service: BUILDS) {
        id totalCost planMetrics overageMetrics
        billingPeriod { start end }
      }
    }
  } }
}`;

const Q_METRICS = `query BuildMetrics($accountId: String!, $timespan: UsageMetricsTimespan!, $filterParams: JSONObject) {
  account { byId(accountId: $accountId) { id
    usageMetrics {
      metricsForServiceMetric(
        serviceMetric: BUILDS
        granularity: TOTAL
        timespan: $timespan
        filterParams: $filterParams
      ) { id timestamp serviceMetric metricType value }
    }
  } }
}`;

// `filterParams` is an opaque JSONObject, so these are guesses. The point of
// the probe is to see which (if any) actually change the number.
const FILTER_CANDIDATES = [
  ['(omitted)', undefined],
  ['{}', {}],
  ['{platform:"IOS"}', { platform: 'IOS' }],
  ['{platform:"ANDROID"}', { platform: 'ANDROID' }],
  ['{platforms:["IOS"]}', { platforms: ['IOS'] }],
  ['{platforms:["ANDROID"]}', { platforms: ['ANDROID'] }],
  ['{platform:"ios"}', { platform: 'ios' }],
  ['{appPlatform:"IOS"}', { appPlatform: 'IOS' }],
  ['{bogusKey:"IOS"}', { bogusKey: 'IOS' }], // control: unknown key rejected or silently ignored?
];

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

const sumMetrics = (metrics) => (metrics ?? []).reduce((acc, m) => acc + (m.value ?? 0), 0);

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

  // ---- 1. Plan ------------------------------------------------------------
  const sub = await attempt(async () => {
    const data = await client.gql(Q_SUBSCRIPTION, { accountId: account.id });
    return data.account.byId;
  });

  console.log('\n[1] subscription / billingPeriod');
  if (sub.ok) {
    console.log(
      JSON.stringify(
        { subscription: sub.value.subscription, billingPeriod: sub.value.billingPeriod },
        null,
        2
      )
    );
  } else {
    console.log(`  FAILED: ${sub.error}`);
    console.log('  ^ this is the permission path the CLI has to degrade on, not crash.');
  }

  // The billing period if we got one, otherwise the current calendar month.
  const now = new Date();
  const period =
    sub.ok && sub.value.billingPeriod
      ? { start: sub.value.billingPeriod.start, end: sub.value.billingPeriod.end }
      : {
          start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
          end: now.toISOString(),
        };
  console.log(`\n  window used below: ${period.start} -> ${period.end}`);

  // ---- 2. byBillingPeriod --------------------------------------------------
  const byPeriod = await attempt(async () => {
    const data = await client.gql(Q_BY_BILLING_PERIOD, {
      accountId: account.id,
      date: period.start,
    });
    return data.account.byId.usageMetrics.byBillingPeriod;
  });

  console.log('\n[2] usageMetrics.byBillingPeriod(service: BUILDS)');
  console.log(byPeriod.ok ? JSON.stringify(byPeriod.value, null, 2) : `  FAILED: ${byPeriod.error}`);

  // ---- 3. metricsForServiceMetric x filterParams ---------------------------
  console.log('\n[3] usageMetrics.metricsForServiceMetric(BUILDS, TOTAL) per filterParams');
  console.log('    If the platform rows return different, smaller numbers than "(omitted)",');
  console.log('    the split works. If every row is identical, it does not.\n');

  for (const [label, filterParams] of FILTER_CANDIDATES) {
    const res = await attempt(async () => {
      const data = await client.gql(Q_METRICS, {
        accountId: account.id,
        timespan: period,
        filterParams,
      });
      return data.account.byId.usageMetrics.metricsForServiceMetric;
    });

    if (res.ok) {
      const metrics = res.value ?? [];
      const types = [...new Set(metrics.map((m) => m.metricType))].join(',') || '-';
      console.log(
        `  ${label.padEnd(24)} total=${sumMetrics(metrics)}  points=${metrics.length}  metricType=${types}`
      );
    } else {
      console.log(`  ${label.padEnd(24)} FAILED: ${res.error}`);
    }
  }
}

console.log('\nDone. Paste the output above into issue #15.');

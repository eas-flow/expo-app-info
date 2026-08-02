#!/usr/bin/env node
// Verification script for issue #22 — NOT part of the published package
// (`package.json#files` only ships bin/ and src/).
//
// `Account.displayName` is present in EAS's GraphQL schema (confirmed via
// eas-cli's generated TypeScript types) but eas-cli itself never queries it,
// so nothing confirms what it actually contains in practice. Before relying
// on it for the table's ACCOUNT column (falling back to the unique `name`
// slug when absent), this checks against the real API:
//
//   1. Does `displayName` come back non-null for real accounts, or is it
//      always null in practice (in which case the fallback to `name` would
//      fire 100% of the time and the feature would be a no-op)?
//   2. When non-null, does it ever differ from `name`? If it's always equal
//      to `name`, the distinct column source barely matters.
//   3. Sanity check: is `displayName` ever an empty string rather than null?
//      The current fallback (`displayName || name`) treats both the same,
//      but it's worth confirming which one the API actually sends.
//
// This calls the real `fetchAccounts()` the CLI ships, so a good run here is
// a good run in production.
//
//   export EXPO_TOKEN=xxxxx
//   node scripts/probe-account-displayname.mjs
//
// The token is read from the environment only and is never printed. The
// output does contain account names/display names — read it before pasting
// it anywhere public.

import { createApiClient } from '../src/api.mjs';

const API_URL = process.env.EXPO_API_URL ?? 'https://api.expo.dev/graphql';

const token = process.env.EXPO_TOKEN?.trim();
if (!token) {
  console.error('EXPO_TOKEN is not set. export EXPO_TOKEN=xxxxx and re-run.');
  process.exit(1);
}

const client = createApiClient({
  apiUrl: API_URL,
  authHeaders: { authorization: `Bearer ${token}` },
});

const accounts = await client.fetchAccounts();

if (accounts.length === 0) {
  console.error('No accounts found for this token.');
  process.exit(1);
}

console.log(`API: ${API_URL}`);
console.log(`Accounts visible to this token: ${accounts.length}\n`);

let nullCount = 0;
let emptyStringCount = 0;
let sameAsNameCount = 0;
let usefulCount = 0;

for (const account of accounts) {
  console.log(`${'='.repeat(72)}`);
  console.log(`name (slug): ${account.name}`);
  console.log(`displayName: ${JSON.stringify(account.displayName)}`);

  if (account.displayName === null || account.displayName === undefined) {
    nullCount++;
    console.log('  -> null/undefined: falls back to the slug in the table, as designed.');
  } else if (account.displayName === '') {
    emptyStringCount++;
    console.log(
      '  -> empty string, not null: `displayName || name` already falls back correctly here too, but note the API sends "" rather than null.'
    );
  } else if (account.displayName === account.name) {
    sameAsNameCount++;
    console.log('  -> identical to the slug: harmless, but the extra column adds no information.');
  } else {
    usefulCount++;
    console.log('  -> [ok] distinct from the slug: this is the case the feature is for.');
  }
}

console.log(`\n${'='.repeat(72)}`);
console.log('Summary:');
console.log(`  null/undefined displayName : ${nullCount}/${accounts.length}`);
console.log(`  empty-string displayName   : ${emptyStringCount}/${accounts.length}`);
console.log(`  displayName === name       : ${sameAsNameCount}/${accounts.length}`);
console.log(`  displayName !== name       : ${usefulCount}/${accounts.length}`);
console.log(
  usefulCount > 0
    ? '\n[ok] At least one account has a distinct, non-empty displayName — the table fallback in src/format.mjs is exercising real data, not just falling back every time.'
    : '\n[!!] No account here has a displayName distinct from its slug. That does not mean the feature is wrong (this token may just not see such an account), but it means this run cannot confirm the table shows anything different from before. Try again with an account that has a Display name set in the EAS dashboard, if one exists.'
);

console.log('\nDone. Paste the output above into issue #22.');

// `--plan` display mode (issue #19). Moved out of src/cli.mjs (issue #30)
// so every display mode lives in its own file under src/commands/.

import { ApiError, CONCURRENCY, mapWithConcurrency } from '../api.mjs';
import {
  formatCSV,
  formatJSON,
  PLAN_FIELDS,
  planConcurrencyHeader,
  toPlanDisplayRows,
} from '../format.mjs';
import { clearProgress, progress } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * `--plan`: one row per account with its current subscription only (plan,
 * plan ID, status, concurrency, trial end) — no build counts or billing
 * period, that's `--usage` (issue #19).
 *
 * Unlike `runUsage`, accounts are fetched with `mapWithConcurrency` rather
 * than a sequential loop: each account's subscription lookup is independent
 * of every other account's, so there is nothing to serialize on here.
 *
 * Plan fields are billing-scoped, so a token without billing permission on
 * an account gets a GraphQL error for that account only. That is not fatal:
 * the row is still printed with "-" in the plan columns, and the reason is
 * reported on stderr so it stays out of --json/--csv output.
 */
export async function runPlan(client, accounts, opts, accountDisplayNames) {
  const warnings = [];
  let done = 0;

  const subscriptions = await mapWithConcurrency(accounts, CONCURRENCY, async (account) => {
    try {
      const subscription = await client.fetchSubscription(account.id);
      progress(`Fetching plan: ${++done}/${accounts.length} accounts…`);
      return subscription;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      warnings.push(`${account.name}: ${err.message}`);
      progress(`Fetching plan: ${++done}/${accounts.length} accounts…`);
      return null;
    }
  });

  clearProgress();

  for (const warning of warnings) {
    console.error(dim(`  ! plan unavailable — ${warning}`));
  }

  const entries = accounts.map((account, i) => {
    const subscription = subscriptions[i];
    return {
      account: account.name,
      plan: subscription?.name ?? null,
      planId: subscription?.planId ?? null,
      status: subscription?.status ?? null,
      concurrencyTotal: subscription?.concurrencies?.total ?? null,
      concurrencyIos: subscription?.concurrencies?.ios ?? null,
      concurrencyAndroid: subscription?.concurrencies?.android ?? null,
      trialEnd: subscription?.trialEnd ?? null,
    };
  });

  if (opts.json) {
    console.log(formatJSON(entries));
    return;
  }
  if (opts.csv) {
    console.log(formatCSV(entries, PLAN_FIELDS));
    return;
  }

  console.log(
    renderTable(
      ['ACCOUNT', 'PLAN', 'PLAN ID', 'STATUS', planConcurrencyHeader(opts.platform), 'TRIAL END'],
      toPlanDisplayRows(entries, { platform: opts.platform, accountDisplayNames })
    )
  );
  console.log(
    dim(
      `\n  ${entries.length} account(s). PLAN/STATUS/CONCURRENCY = current subscription (as of now).`
    )
  );
}

// `--plan` display mode. Moved out of src/cli.mjs so every display mode
// lives in its own file under src/commands/.

import { ApiError, mapWithConcurrency } from '../api.mjs';
import { planConcurrencyHeader, toPlanDisplayRows } from '../format.mjs';
import { clearProgress, progressCount } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * `--plan`: one row per account with its current subscription only (plan,
 * plan ID, status, concurrency, trial end) — no build counts or billing
 * period, that's `--stats`.
 *
 * Unlike `runStats`, accounts are fetched with `mapWithConcurrency` rather
 * than a sequential loop: each account's subscription lookup is independent
 * of every other account's, so there is nothing to serialize on here.
 *
 * Plan fields are billing-scoped, so a token without billing permission on
 * an account gets a GraphQL error for that account only. That is not fatal:
 * the row is still printed with "-" in the plan columns, and the reason is
 * reported on stderr so it stays out of stdout.
 */
export async function runPlan(client, accounts, opts, accountDisplayNames) {
  let done = 0;

  // Results are gathered per account, then warnings are printed by walking
  // `accounts` in order below — not pushed inside the task above, which
  // would order them by response arrival instead of account order.
  const results = await mapWithConcurrency(accounts, async (account) => {
    try {
      return { subscription: await client.fetchSubscription(account.id), error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { subscription: null, error: err };
    } finally {
      progressCount('Fetching plan', ++done, accounts.length, 'accounts');
    }
  });

  clearProgress();

  results.forEach(({ error }, i) => {
    if (error) console.error(dim(`  ! plan unavailable — ${accounts[i].name}: ${error.message}`));
  });

  const entries = accounts.map((account, i) => {
    const subscription = results[i].subscription;
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

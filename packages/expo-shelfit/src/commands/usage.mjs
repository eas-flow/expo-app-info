// `--usage` display mode. Moved out of src/cli.mjs so every display mode
// lives in its own file under src/commands/.

import { ApiError, mapWithConcurrency } from '../api.mjs';
import { DEFAULT_USAGE_MONTHS } from '../args.mjs';
import { calendarMonths } from '../dates.mjs';
import { toUsageDisplayRows, usageBuildsHeaders } from '../format.mjs';
import { clearProgress, progressCount } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * `--usage`: one row per account *per UTC calendar month* (last 3 months by
 * default, or the last `opts.month` with `--month`). Each row's build counts
 * are "successful build" counts counted client-side from finished builds via
 * the API (client.countBuildsByMonth), not from EAS's own billing/usage
 * metric, which is tied to the billing cycle and can't be sliced into
 * arbitrary calendar ranges (its `filterParams` was also found not to
 * actually filter by platform).
 *
 * Unlike the old billing-period version, months have no inter-period
 * dependency, so accounts and account/app pairs are fetched with
 * `mapWithConcurrency` rather than a sequential loop — as two flat passes
 * (accounts' apps, then each (account, app) pair's build counts) instead of
 * nesting one `mapWithConcurrency` inside another, which would deadlock
 * once `accounts.length >= CONCURRENCY` (see src/api.mjs CONCURRENCY).
 *
 * If a fetch fails for an account (apps or any of its apps' build counts),
 * that whole account's rows degrade to "-" rather than failing the run,
 * and the reason is reported on stderr.
 */
export async function runUsage(client, accounts, opts, accountDisplayNames, now = new Date()) {
  const months = calendarMonths(opts.month ?? DEFAULT_USAGE_MONTHS, now);
  const warnings = [];

  // Pass 1: apps per account.
  let accountsDone = 0;
  const appsByAccount = await mapWithConcurrency(accounts, async (account) => {
    try {
      return { apps: await client.fetchApps(account.id), error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { apps: [], error: err };
    } finally {
      progressCount('Fetching usage', ++accountsDone, accounts.length, 'accounts (apps)');
    }
  });

  // Pass 2: build counts per (account, app) pair, flattened — not nested.
  const pairs = [];
  appsByAccount.forEach(({ apps }, accountIndex) => {
    for (const app of apps) pairs.push({ accountIndex, app });
  });

  let pairsDone = 0;
  const pairResults = await mapWithConcurrency(pairs, async ({ accountIndex, app }) => {
    try {
      return { accountIndex, counts: await client.countBuildsByMonth(app.id, months), error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { accountIndex, counts: null, error: err };
    } finally {
      progressCount('Fetching usage', ++pairsDone, pairs.length, 'app(s)');
    }
  });

  clearProgress();

  // Null totals -> "-" cells: an account's apps fetch failed, or any of
  // its apps' build-count fetches failed.
  const perAccountTotals = accounts.map((account, accountIndex) => {
    const appsError = appsByAccount[accountIndex].error;
    if (appsError) {
      warnings.push(`${account.name}: ${appsError.message}`);
      return null;
    }
    const ownResults = pairResults.filter((r) => r.accountIndex === accountIndex);
    const failed = ownResults.find((r) => r.error);
    if (failed) {
      warnings.push(`${account.name}: ${failed.error.message}`);
      return null;
    }
    const totals = months.map(() => ({ ios: 0, android: 0 }));
    for (const { counts } of ownResults) {
      counts.forEach((c, i) => {
        totals[i].ios += c.ios;
        totals[i].android += c.android;
      });
    }
    return totals;
  });

  for (const warning of warnings) {
    console.error(dim(`  ! usage unavailable — ${warning}`));
  }

  const entries = [];
  accounts.forEach((account, ai) => {
    const totals = perAccountTotals[ai];
    months.forEach((period, mi) => {
      entries.push({
        account: account.name,
        buildsIos: totals ? totals[mi].ios : null,
        buildsAndroid: totals ? totals[mi].android : null,
        periodStart: period.start,
        periodEnd: period.end,
      });
    });
  });

  console.log(
    renderTable(
      ['ACCOUNT', 'PERIOD', ...usageBuildsHeaders(opts.platform)],
      toUsageDisplayRows(entries, { platform: opts.platform, accountDisplayNames, now })
    )
  );
  console.log(
    dim(
      `\n  ${entries.length} row(s) across ${accounts.length} account(s), ${months.length} month(s) each. ` +
        'SUCCESSFUL BUILDS = counted client-side from finished builds via the API; may differ from EAS billing usage. ' +
        'PERIOD = UTC calendar month.'
    )
  );
}

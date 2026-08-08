// `--usage` display mode. Moved out of src/cli.mjs so every display mode
// lives in its own file under src/commands/.

import { ApiError, CONCURRENCY, mapWithConcurrency } from '../api.mjs';
import { DEFAULT_USAGE_MONTHS } from '../args.mjs';
import { calendarMonths } from '../dates.mjs';
import { toUsageDisplayRows, usageBuildsHeaders } from '../format.mjs';
import { clearProgress, progress } from '../progress.mjs';
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
 * dependency (every boundary is known upfront from `now`), so both accounts
 * and — within each account — apps are fetched with `mapWithConcurrency`
 * rather than a sequential loop.
 *
 * The only failure mode left is app-list/build-fetch failure (subscription/
 * billing queries are no longer used by --usage at all): if either fails for
 * an account, that whole account's rows for every month degrade to "-"
 * rather than failing the run, and the reason is reported on stderr.
 */
export async function runUsage(client, accounts, opts, accountDisplayNames, now = new Date()) {
  const months = calendarMonths(opts.month ?? DEFAULT_USAGE_MONTHS, now);
  const warnings = [];
  let accountsDone = 0;

  const perAccountTotals = await mapWithConcurrency(accounts, CONCURRENCY, async (account) => {
    try {
      const apps = await client.fetchApps(account.id);

      let appsDone = 0;
      const perAppCounts = await mapWithConcurrency(apps, CONCURRENCY, async (app) => {
        const counts = await client.countBuildsByMonth(app.id, months);
        progress(`${account.name}: ${++appsDone}/${apps.length} apps…`);
        return counts;
      });

      const totals = months.map(() => ({ ios: 0, android: 0 }));
      for (const counts of perAppCounts) {
        counts.forEach((c, i) => {
          totals[i].ios += c.ios;
          totals[i].android += c.android;
        });
      }
      progress(`Fetching usage: ${++accountsDone}/${accounts.length} accounts…`);
      return totals;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      warnings.push(`${account.name}: ${err.message}`);
      progress(`Fetching usage: ${++accountsDone}/${accounts.length} accounts…`);
      return null;
    }
  });

  clearProgress();

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

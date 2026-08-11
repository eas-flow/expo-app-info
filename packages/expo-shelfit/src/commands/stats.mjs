// `--stats` display mode. Moved out of src/cli.mjs so every display mode
// lives in its own file under src/commands/.

import { ApiError, mapWithConcurrency } from '../api.mjs';
import { DEFAULT_STATS_MONTHS } from '../args.mjs';
import { calendarMonths } from '../dates.mjs';
import { createAppFilter } from '../filter.mjs';
import { statsBuildsHeaders, toStatsDisplayRows } from '../format.mjs';
import { clearProgress, progressCount } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * `--stats`: one row per account *per UTC calendar month* *per platform*
 * (last 3 months by default, or the last `opts.month` with `--month`; both
 * platforms unless `--platform` narrows to one — see toStatsDisplayRows).
 * Each row's SUCCESS/ERRORED/CANCELED counts are counted client-side from
 * every build in an app's history via the API (client.countBuildsByMonth),
 * not from EAS's own billing/usage metric, which is tied to the billing
 * cycle and can't be sliced into arbitrary calendar ranges (its
 * `filterParams` was also found not to actually filter by platform). TOTAL
 * is SUCCESS + ERRORED + CANCELED. A still in-progress or queued build isn't
 * counted into any of the three categories (nor TOTAL), since it hasn't
 * reached a terminal outcome yet.
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
export async function runStats(client, accounts, opts, accountDisplayNames, now = new Date()) {
  const months = calendarMonths(opts.month ?? DEFAULT_STATS_MONTHS, now);
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
      progressCount('Fetching stats', ++accountsDone, accounts.length, 'accounts (apps)');
    }
  });

  // Pass 2: build counts per (account, app) pair, flattened — not nested.
  // --app narrows here, right after pass 1's fetchApps() and before this
  // pass's countBuildsByMonth() below, so a non-matching account never pays
  // for a build fetch (#84).
  const appFilter = createAppFilter(opts.app);
  const pairs = [];
  appsByAccount.forEach(({ apps }, accountIndex) => {
    for (const app of appFilter.filter(apps)) pairs.push({ accountIndex, app });
  });
  appFilter.finalize();

  let pairsDone = 0;
  const pairResults = await mapWithConcurrency(pairs, async ({ accountIndex, app }) => {
    try {
      const counts = await client.countBuildsByMonth(app.id, months, { platform: opts.platform });
      return { accountIndex, counts, error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { accountIndex, counts: null, error: err };
    } finally {
      progressCount('Fetching stats', ++pairsDone, pairs.length, 'app(s)');
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
    const totals = months.map(() => ({
      ios: { success: 0, errored: 0, canceled: 0 },
      android: { success: 0, errored: 0, canceled: 0 },
    }));
    for (const { counts } of ownResults) {
      counts.forEach((c, i) => {
        addCounts(totals[i].ios, c.ios);
        addCounts(totals[i].android, c.android);
      });
    }
    return totals;
  });

  for (const warning of warnings) {
    console.error(dim(`  ! stats unavailable — ${warning}`));
  }

  const entries = [];
  accounts.forEach((account, ai) => {
    const totals = perAccountTotals[ai];
    months.forEach((period, mi) => {
      entries.push({
        account: account.name,
        ios: totals ? totals[mi].ios : null,
        android: totals ? totals[mi].android : null,
        periodStart: period.start,
        periodEnd: period.end,
      });
    });
  });

  const displayRows = toStatsDisplayRows(entries, {
    platform: opts.platform,
    accountDisplayNames,
    now,
  });
  const platformCount = opts.platform ? 1 : 2;

  console.log(renderTable(['ACCOUNT', 'PERIOD', 'PLATFORM', ...statsBuildsHeaders()], displayRows));
  console.log(
    dim(
      `\n  ${displayRows.length} row(s) across ${accounts.length} account(s), ${months.length} month(s), ${platformCount} platform(s) each. ` +
        'SUCCESS/ERRORED/CANCELED = counted client-side from build history via the API; ' +
        'may differ from EAS billing usage. TOTAL = SUCCESS + ERRORED + CANCELED for that row. ' +
        'A still in-progress/queued build is counted in none of the three (nor in TOTAL). ' +
        'PERIOD = UTC calendar month.'
    )
  );
}

function addCounts(target, source) {
  target.success += source.success;
  target.errored += source.errored;
  target.canceled += source.canceled;
}

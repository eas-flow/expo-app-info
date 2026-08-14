import { DEFAULT_STATS_MONTHS } from '../../args.mjs';
import { ApiError } from '../../errors.mjs';
import { mapWithConcurrency } from '../../shared/concurrency.mjs';
import { calendarMonths } from '../../shared/dates.mjs';
import { createAppFilter } from '../../shared/filter.mjs';
import { clearProgress, progressCount } from '../../shared/terminal/progress.mjs';

/**
 * Counts are computed client-side from build history rather than read from
 * EAS's billing/usage metric, which is tied to the billing cycle and can't be
 * sliced into calendar ranges (its `filterParams` was also found not to
 * actually filter by platform).
 *
 * The two passes below are flat, not nested: nesting one `mapWithConcurrency`
 * inside another deadlocks once `accounts.length >= CONCURRENCY` (see
 * shared/concurrency.mjs). Calendar months have no inter-period dependency,
 * so nothing forces a sequential walk.
 *
 * `--group-by app` changes only what happens to `pairResults` afterwards, and
 * costs no extra API call — per-app counts were always being fetched and
 * merely summed.
 *
 * Returns `{ entries, groupCount, months, byApp, warnings, metricsMissingCount }`
 * — `entries` is ready for features/stats/format.mjs#toStatsDisplayRows,
 * `warnings` is a plain string array (no console output here).
 * `metricsMissingCount` is a single run-wide total (not per row) of counted
 * builds that had no `metrics.buildDuration` to add to BUILD MIN.
 */
export async function fetchStatsEntries(client, accounts, opts, now = new Date()) {
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

  // Pass 2: build counts per (account, app) pair. --app narrows here, before
  // countBuildsByMonth(), so a non-matching app never pays for a build fetch.
  const appFilter = createAppFilter(opts.app);
  const pairs = [];
  appsByAccount.forEach(({ apps }, accountIndex) => {
    for (const app of appFilter.filter(apps)) pairs.push({ accountIndex, app });
  });
  appFilter.finalize();

  let pairsDone = 0;
  const pairResults = await mapWithConcurrency(pairs, async ({ accountIndex, app }) => {
    try {
      const { counts, missingMetricsCount } = await client.countBuildsByMonth(app.id, months, {
        platform: opts.platform,
      });
      return { accountIndex, app, counts, missingMetricsCount, error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { accountIndex, app, counts: null, missingMetricsCount: 0, error: err };
    } finally {
      progressCount('Fetching stats', ++pairsDone, pairs.length, 'app(s)');
    }
  });

  clearProgress();

  const metricsMissingCount = pairResults.reduce((sum, r) => sum + r.missingMetricsCount, 0);

  const byApp = (opts.groupBy ?? 'account') === 'app';
  const groups = byApp
    ? appGroups(accounts, appsByAccount, pairResults, months, warnings)
    : accountGroups(accounts, appsByAccount, pairResults, months, warnings);

  const entries = [];
  for (const group of groups) {
    months.forEach((period, mi) => {
      entries.push({
        account: group.account,
        app: group.app,
        appSlug: group.appSlug,
        ios: group.totals ? group.totals[mi].ios : null,
        android: group.totals ? group.totals[mi].android : null,
        periodStart: period.start,
        periodEnd: period.end,
      });
    });
  }

  return { entries, groupCount: groups.length, months, byApp, warnings, metricsMissingCount };
}

/**
 * `totals: null` (every cell "-") if the app list or *any one* app's counts
 * failed: summed into a single number, one missing app makes the whole sum
 * wrong, so it isn't shown at all.
 */
function accountGroups(accounts, appsByAccount, pairResults, months, warnings) {
  return accounts.map((account, accountIndex) => {
    const base = { account: account.name, app: null, appSlug: null };
    const appsError = appsByAccount[accountIndex].error;
    if (appsError) {
      warnings.push(`${account.name}: ${appsError.message}`);
      return { ...base, totals: null };
    }
    const ownResults = pairResults.filter((r) => r.accountIndex === accountIndex);
    const failed = ownResults.find((r) => r.error);
    if (failed) {
      warnings.push(`${account.name}: ${failed.error.message}`);
      return { ...base, totals: null };
    }
    const totals = emptyTotals(months);
    for (const { counts } of ownResults) addInto(totals, counts);
    return { ...base, totals };
  });
}

/**
 * Failure is finer-grained than in accountGroups: per-app counts stand on
 * their own, so only the failed app degrades to "-". An account whose *app
 * list* failed contributes no rows at all — its apps are unknown, so there is
 * nothing to put in an APP column — and only the stderr warning reports it.
 */
function appGroups(accounts, appsByAccount, pairResults, months, warnings) {
  appsByAccount.forEach(({ error }, accountIndex) => {
    if (error) warnings.push(`${accounts[accountIndex].name}: ${error.message}`);
  });

  return pairResults.map(({ accountIndex, app, counts, error }) => {
    const base = { account: accounts[accountIndex].name, app: app.name, appSlug: app.slug };
    if (error) {
      warnings.push(`${accounts[accountIndex].name} / ${app.slug}: ${error.message}`);
      return { ...base, totals: null };
    }
    const totals = emptyTotals(months);
    addInto(totals, counts);
    return { ...base, totals };
  });
}

function emptyTotals(months) {
  return months.map(() => ({
    ios: { success: 0, errored: 0, canceled: 0, buildDurationMs: 0 },
    android: { success: 0, errored: 0, canceled: 0, buildDurationMs: 0 },
  }));
}

function addInto(totals, counts) {
  counts.forEach((c, i) => {
    addCounts(totals[i].ios, c.ios);
    addCounts(totals[i].android, c.android);
  });
}

function addCounts(target, source) {
  target.success += source.success;
  target.errored += source.errored;
  target.canceled += source.canceled;
  target.buildDurationMs += source.buildDurationMs;
}

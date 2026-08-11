import { mapWithConcurrency } from '../api.mjs';
import { DEFAULT_STATS_MONTHS } from '../args.mjs';
import { calendarMonths } from '../dates.mjs';
import { ApiError } from '../errors.mjs';
import { createAppFilter } from '../filter.mjs';
import { statsBuildsHeaders, toStatsDisplayRows } from '../format.mjs';
import { clearProgress, progressCount } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * Counts are computed client-side from build history rather than read from
 * EAS's billing/usage metric, which is tied to the billing cycle and can't be
 * sliced into calendar ranges (its `filterParams` was also found not to
 * actually filter by platform).
 *
 * The two passes below are flat, not nested: nesting one `mapWithConcurrency`
 * inside another deadlocks once `accounts.length >= CONCURRENCY` (see
 * src/api.mjs). Calendar months have no inter-period dependency, so nothing
 * forces a sequential walk.
 *
 * `--group-by app` changes only what happens to `pairResults` afterwards, and
 * costs no extra API call — per-app counts were always being fetched and
 * merely summed.
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
      const counts = await client.countBuildsByMonth(app.id, months, { platform: opts.platform });
      return { accountIndex, app, counts, error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { accountIndex, app, counts: null, error: err };
    } finally {
      progressCount('Fetching stats', ++pairsDone, pairs.length, 'app(s)');
    }
  });

  clearProgress();

  const byApp = (opts.groupBy ?? 'account') === 'app';
  const groups = byApp
    ? appGroups(accounts, appsByAccount, pairResults, months, warnings)
    : accountGroups(accounts, appsByAccount, pairResults, months, warnings);

  for (const warning of warnings) {
    console.error(dim(`  ! stats unavailable — ${warning}`));
  }

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

  const displayRows = toStatsDisplayRows(entries, {
    platform: opts.platform,
    accountDisplayNames,
    groupBy: byApp ? 'app' : 'account',
    now,
  });
  const platformCount = opts.platform ? 1 : 2;
  const subjectHeader = byApp ? 'APP' : 'ACCOUNT';
  const subjectCount = `${groups.length} ${byApp ? 'app(s)' : 'account(s)'}`;

  console.log(
    renderTable([subjectHeader, 'PERIOD', 'PLATFORM', ...statsBuildsHeaders()], displayRows)
  );
  console.log(
    dim(
      `\n  ${displayRows.length} row(s) across ${subjectCount}, ${months.length} month(s), ${platformCount} platform(s) each. ` +
        'SUCCESS/ERRORED/CANCELED = counted client-side from build history via the API; ' +
        'may differ from EAS billing usage. TOTAL = SUCCESS + ERRORED + CANCELED for that row. ' +
        'A still in-progress/queued build is counted in none of the three (nor in TOTAL). ' +
        'PERIOD = UTC calendar month.'
    )
  );
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
    ios: { success: 0, errored: 0, canceled: 0 },
    android: { success: 0, errored: 0, canceled: 0 },
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
}

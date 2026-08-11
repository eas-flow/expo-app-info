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
 *
 * `--group-by app` keeps both passes exactly as they are and only changes
 * what happens to `pairResults` afterwards: instead of summing every app of
 * an account into one set of totals, each (account, app) pair becomes
 * its own group of rows. No extra API call — the per-app counts were always
 * being fetched, just added together. Same-named apps in different accounts
 * stay separate, since grouping is by pair, not by display name.
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
  // for a build fetch.
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
 * One group per account, its apps' counts summed (the default behavior,
 * and the only one before --group-by existed).
 * `totals: null` renders every cell on that account's rows as "-": either
 * its app list couldn't be fetched, or any one of its apps' build counts
 * failed — with everything summed into a single number, one missing app
 * makes the whole sum wrong, so it is not shown at all.
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
 * One group per (account, app) pair — same order as `pairs`, so accounts stay
 * in order and apps keep the order the API returned them in.
 *
 * Failure is finer-grained than in accountGroups: only the app whose fetch
 * failed degrades to "-", because per-app counts stand on their own and one
 * broken app says nothing about its neighbors. An account whose *app list*
 * failed contributes no rows at all — its apps are unknown, so there is
 * nothing to name in an APP column — and only the stderr warning reports it.
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

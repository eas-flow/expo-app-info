// Argument parsing, help text, and the top-level run() flow.
// Throws CliError/ApiError on failure; bin/cli.mjs is the only place that
// catches and converts those into a printed message + exit code.

import { readFileSync } from 'node:fs';
import { ApiError, createApiClient, mapWithConcurrency } from './api.mjs';
import { DEFAULT_USAGE_MONTHS, HELP, parseArgs } from './args.mjs';
import { calendarMonths } from './dates.mjs';
import {
  formatCSV,
  formatJSON,
  PLAN_FIELDS,
  planConcurrencyHeader,
  toDisplayRows,
  toPlanDisplayRows,
  toUsageDisplayRows,
  USAGE_FIELDS,
  usageBuildsHeaders,
} from './format.mjs';
import { clearProgress, progress } from './progress.mjs';
import { dim, renderTable } from './render.mjs';

export class CliError extends Error {}

const CONCURRENCY = 8;

function resolveAuthHeaders(env = process.env) {
  const token = env.EXPO_TOKEN?.trim();

  if (!token) {
    throw new CliError(
      'EXPO_TOKEN is not set.\n' +
        '  Create a personal access token at https://expo.dev/settings/access-tokens\n' +
        '  then export it:\n' +
        '    export EXPO_TOKEN=xxxxx'
    );
  }

  return { authorization: `Bearer ${token}` };
}

export async function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    return;
  }

  const authHeaders = resolveAuthHeaders();
  const apiUrl = process.env.EXPO_API_URL ?? 'https://api.expo.dev/graphql';
  const client = createApiClient({ apiUrl, authHeaders });

  progress('Fetching accounts…');
  const accounts = await client.fetchAccounts();
  if (accounts.length === 0) throw new CliError('No accounts found for this token.');

  // Table-only, cosmetic mapping of account slug -> EAS "Display name"
  // (issue #22). --json/--csv keep emitting the slug (`account.name`)
  // unconditionally — see toDisplayRows/toUsageDisplayRows in format.mjs.
  // Falls back to the slug itself when displayName is null/unset.
  const accountDisplayNames = new Map(accounts.map((a) => [a.name, a.displayName || a.name]));

  if (opts.usage) {
    await runUsage(client, accounts, opts, accountDisplayNames);
    return;
  }

  if (opts.plan) {
    await runPlan(client, accounts, opts, accountDisplayNames);
    return;
  }

  const entries = [];
  for (const account of accounts) {
    progress(`Fetching apps in ${account.name}…`);
    const apps = await client.fetchApps(account.id);

    let done = 0;
    const buildsPerApp = await mapWithConcurrency(apps, CONCURRENCY, async (app) => {
      const builds = await client.fetchBuilds(app.id, { limit: opts.history ?? 1 });
      progress(`${account.name}: ${++done}/${apps.length} apps…`);
      return builds;
    });

    apps.forEach((app, i) => {
      const builds = buildsPerApp[i];
      if (builds.length === 0) {
        entries.push({
          account: account.name,
          app: app.name,
          slug: app.slug,
          platform: null,
          version: null,
          build: null,
          lastBuildAt: null,
        });
        return;
      }
      for (const b of builds) {
        entries.push({
          account: account.name,
          app: app.name,
          slug: app.slug,
          platform: b.platform.toLowerCase(),
          version: b.appVersion ?? null,
          build: b.appBuildVersion ?? null,
          lastBuildAt: b.createdAt ?? null,
        });
      }
    });
  }

  clearProgress();

  const filtered =
    opts.platform !== null ? entries.filter((e) => e.platform === opts.platform) : entries;

  if (opts.json) {
    console.log(formatJSON(filtered));
    return;
  }
  if (opts.csv) {
    console.log(formatCSV(filtered));
    return;
  }

  if (filtered.length === 0) {
    console.log('No apps found.');
    return;
  }

  console.log(
    renderTable(
      ['ACCOUNT', 'APP', 'SLUG', 'PLATFORM', 'VERSION', 'BUILD', 'BUILD DATE'],
      toDisplayRows(filtered, { accountDisplayNames })
    )
  );
  // The effective count is what matters here, not whether --history was
  // typed: `--history 1` must read identically to not passing the flag at
  // all, since it produces the exact same query and the exact same rows.
  const effectiveHistory = opts.history ?? 1;
  const footerNote =
    effectiveHistory > 1
      ? `VERSION/BUILD = latest ${effectiveHistory} successful EAS builds per platform, newest first.`
      : 'VERSION/BUILD = latest successful EAS build.';
  console.log(dim(`\n  ${filtered.length} row(s). ${footerNote}`));
}

/**
 * `--usage`: one row per account *per UTC calendar month* (last 3 months by
 * default, or the last `opts.month` with `--month`) — see issue #18. Each
 * row's build counts are "successful build" counts counted client-side from
 * finished builds via the API (client.countBuildsByMonth), not from EAS's own
 * billing/usage metric, which is tied to the billing cycle and can't be
 * sliced into arbitrary calendar ranges (see issue #15's filterParams finding
 * and issue #18's body for the full rationale).
 *
 * Unlike the old billing-period version, months have no inter-period
 * dependency (every boundary is known upfront from `now`), so both accounts
 * and — within each account — apps are fetched with `mapWithConcurrency`
 * rather than a sequential loop.
 *
 * The only failure mode left is app-list/build-fetch failure (subscription/
 * billing queries are no longer used by --usage at all): if either fails for
 * an account, that whole account's rows for every month degrade to "-"
 * (null in --json/--csv) rather than failing the run, and the reason is
 * reported on stderr.
 */
async function runUsage(client, accounts, opts, accountDisplayNames, now = new Date()) {
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

  if (opts.json) {
    console.log(formatJSON(entries));
    return;
  }
  if (opts.csv) {
    console.log(formatCSV(entries, USAGE_FIELDS));
    return;
  }

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
async function runPlan(client, accounts, opts, accountDisplayNames) {
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

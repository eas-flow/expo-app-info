// Argument parsing, help text, and the top-level run() flow.
// Throws CliError/ApiError on failure; bin/cli.mjs is the only place that
// catches and converts those into a printed message + exit code.

import { readFileSync } from 'node:fs';
import { ApiError, createApiClient, mapWithConcurrency } from './api.mjs';
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
import { dim, renderTable } from './render.mjs';

export class CliError extends Error {}

const CONCURRENCY = 8;
const PLATFORMS = ['ios', 'android'];
// Sanity cap on --history; the EAS API has no documented max, this just
// keeps a typo like --history 99999 from hammering the API for one app.
// Confirmed against the live API via scripts/probe-history.mjs (issue #17):
// `builds(limit: 100)` is accepted with no GraphQL error, and the API's own
// order was already newest-first for the account tested (the client-side
// sort in fetchBuilds still runs regardless, since that order isn't
// documented as guaranteed).
const MAX_HISTORY = 100;

// --usage defaults to the last 3 UTC calendar months (current + 2 prior).
// --month widens that window; capped at 12 (a year) rather than 24 because
// countBuildsByMonth pages further back into each app's build history the
// wider the window gets, directly increasing request count/latency — 12
// covers the stated 6-month/1-year need. One-line change to raise later.
const DEFAULT_USAGE_MONTHS = 3;
const MAX_MONTH = 12;

export const HELP = `
  expo-app-info — List every Expo (EAS) app with its latest build version per platform.

  Usage
    $ export EXPO_TOKEN=xxxxx
    $ npx expo-app-info [options]

  Options
    -h, --help              Show this help
    -v, --version           Show version
    --json                  Output as JSON instead of a table
    --csv                   Output as CSV instead of a table
    --platform <platform>   Only show "ios" or "android" builds
    --usage                 Show successful build counts per UTC calendar month (last 3
                             by default) instead of the app list. Cannot be combined with
                             --plan or --history.
    --month <n>             Widen --usage to the last <n> calendar months (1-12, default
                             3). Only valid together with --usage.
    --plan                  Show current account subscription (plan/concurrency) instead
                             of the app list. Cannot be combined with --usage or --history.
    --history <N>           Show the N most recent builds per platform instead of just
                             the latest (1-100). Cannot be combined with --usage or --plan.

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.

  Notes
    ACCOUNT shows the account's EAS "Display name" when one is set, falling
    back to its unique slug otherwise. This is cosmetic (table only) —
    --json/--csv always emit the slug in the \`account\` field, since scripts
    may rely on it as a unique identifier.

    VERSION / BUILD come from the latest *successful* EAS build, not from your
    local app.json. Apps that have never been built show "-" in the table (and
    null in --json/--csv).

    --history <N> lists the N most recent successful builds per platform as
    separate rows (newest first, sorted by build date regardless of the order
    the API returns them in), instead of collapsing each app/platform down to
    a single latest-build row. The BUILD DATE column header applies whether
    or not --history is set, since a row is not necessarily the "last" build
    once more than one is shown.

    --usage prints one row per account *per UTC calendar month* — the last 3
    months by default, or the last <n> with --month <n> (1-12). Each row's
    successful build counts are counted client-side from finished builds via
    the API (not EAS's own billing usage metric, which can't be sliced by
    arbitrary calendar ranges); they may differ from what EAS's dashboard
    reports. The current (in-progress) month's row shows "(today)" as its end
    in the table; --json/--csv periodStart/periodEnd are always the raw UTC
    calendar-month boundaries. A token without app/build read access on an
    account degrades that account's rows to "-" (null in --json/--csv)
    rather than failing the run.

    --plan prints one row per account with its current subscription only —
    plan name, plan ID, status, concurrency (total/ios/android), and trial
    end — no build counts or billing period. Same degrade-to-"-" behavior as
    --usage on a per-account failure. Cannot be combined with --usage or
    --history, since each is its own display mode.
`;

export function parseArgs(argv) {
  const opts = {
    help: false,
    version: false,
    json: false,
    csv: false,
    platform: null,
    usage: false,
    plan: false,
    history: null,
    month: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-v' || arg === '--version') {
      opts.version = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--csv') {
      opts.csv = true;
    } else if (arg === '--usage') {
      opts.usage = true;
    } else if (arg === '--plan') {
      opts.plan = true;
    } else if (arg === '--platform') {
      opts.platform = requireValue(argv, ++i, '--platform');
    } else if (arg.startsWith('--platform=')) {
      opts.platform = arg.slice('--platform='.length);
    } else if (arg === '--history') {
      opts.history = requireValue(argv, ++i, '--history');
    } else if (arg.startsWith('--history=')) {
      opts.history = arg.slice('--history='.length);
    } else if (arg === '--month') {
      opts.month = requireValue(argv, ++i, '--month');
    } else if (arg.startsWith('--month=')) {
      opts.month = arg.slice('--month='.length);
    } else {
      throw new CliError(`Unknown option: ${arg}\n  Run \`expo-app-info --help\` to see usage.`);
    }
  }

  if (opts.json && opts.csv) {
    throw new CliError('--json and --csv cannot be used together.');
  }

  if (opts.platform !== null) {
    const normalized = opts.platform.toLowerCase();
    if (!PLATFORMS.includes(normalized)) {
      throw new CliError(
        `Invalid --platform value: "${opts.platform}". Expected "ios" or "android".`
      );
    }
    opts.platform = normalized;
  }

  if (opts.history !== null) {
    const parsed = Number(opts.history);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_HISTORY) {
      throw new CliError(
        `Invalid --history value: "${opts.history}". Expected an integer between 1 and ${MAX_HISTORY}.`
      );
    }
    opts.history = parsed;

    if (opts.usage) {
      throw new CliError('--history cannot be combined with --usage.');
    }
  }

  if (opts.plan) {
    if (opts.usage) {
      throw new CliError('--plan cannot be combined with --usage.');
    }
    if (opts.history !== null) {
      throw new CliError('--plan cannot be combined with --history.');
    }
  }

  if (opts.month !== null) {
    const parsed = Number(opts.month);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MONTH) {
      throw new CliError(
        `Invalid --month value: "${opts.month}". Expected an integer between 1 and ${MAX_MONTH}.`
      );
    }
    opts.month = parsed;

    if (!opts.usage) {
      throw new CliError('--month can only be used with --usage.');
    }
  }

  return opts;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined) throw new CliError(`${flag} requires a value.`);
  return value;
}

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

function progress(msg) {
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K${dim(msg)}`);
}

function clearProgress() {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
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
 * UTC calendar-month boundaries for `--usage` (issue #18), `count` months
 * ending with the month containing `now`, ordered newest first (index 0 is
 * the current, still-in-progress month). Each entry is `{ start, end }`
 * ISO 8601, with `end` exclusive (the instant the next month starts) —
 * matching the convention the old billingPeriod.end used, so the rest of the
 * codebase (inclusiveEnd/isoDate in format.mjs) can treat both the same way.
 *
 * Calendar boundaries (unlike the old billing-period chaining, which needed
 * the previous period's `start` before it could compute the next one) can
 * all be computed upfront from `now` alone — `Date.UTC` normalizes
 * out-of-range months (e.g. month `-1` becomes December of the prior year),
 * so no manual year/month-rollover arithmetic is needed here.
 */
export function calendarMonths(count, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return Array.from({ length: count }, (_, i) => {
    const targetMonth = month - i;
    return {
      start: new Date(Date.UTC(year, targetMonth, 1)).toISOString(),
      end: new Date(Date.UTC(year, targetMonth + 1, 1)).toISOString(),
    };
  });
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

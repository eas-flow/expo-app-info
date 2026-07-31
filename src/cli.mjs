// Argument parsing, help text, and the top-level run() flow.
// Throws CliError/ApiError on failure; bin/cli.mjs is the only place that
// catches and converts those into a printed message + exit code.

import { readFileSync } from 'node:fs';
import { ApiError, createApiClient, mapWithConcurrency } from './api.mjs';
import {
  formatCSV,
  formatJSON,
  toDisplayRows,
  toUsageDisplayRows,
  USAGE_FIELDS,
  usageBuildsHeader,
  usageConcurrencyHeader,
} from './format.mjs';
import { dim, renderTable } from './render.mjs';

export class CliError extends Error {}

const CONCURRENCY = 8;
const PLATFORMS = ['ios', 'android'];
// Sanity cap on --history; the EAS API has no documented max, this just
// keeps a typo like --history 99999 from hammering the API for one app.
// TODO(issue #17): confirm against the live API via scripts/probe-history.mjs
// that `builds(limit: 100)` is actually accepted before shipping this cap.
const MAX_HISTORY = 100;

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
    --account <name>        Only show this account (exact match, case-insensitive)
    --platform <platform>   Only show "ios" or "android" builds
    --usage                 Show account plan/usage instead of the app list
    --history <N>           Show the N most recent builds per platform instead of just
                             the latest (1-100). Cannot be combined with --usage.

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.

  Notes
    VERSION / BUILD come from the latest *successful* EAS build, not from your
    local app.json. Apps that have never been built show "-" in the table (and
    null in --json/--csv).

    --history <N> lists the N most recent successful builds per platform as
    separate rows (newest first, sorted by build date regardless of the order
    the API returns them in), instead of collapsing each app/platform down to
    a single latest-build row. The BUILD DATE column header applies whether
    or not --history is set, since a row is not necessarily the "last" build
    once more than one is shown.

    --usage prints one row per account (plan, build concurrency, build
    counts per platform for the current billing period) instead of one row
    per app. Plan data is billing-scoped: a token without billing permission
    on an account shows "-" there rather than failing the run.
`;

export function parseArgs(argv) {
  const opts = {
    help: false,
    version: false,
    json: false,
    csv: false,
    account: null,
    platform: null,
    usage: false,
    history: null,
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
    } else if (arg === '--account') {
      opts.account = requireValue(argv, ++i, '--account');
    } else if (arg.startsWith('--account=')) {
      opts.account = arg.slice('--account='.length);
    } else if (arg === '--platform') {
      opts.platform = requireValue(argv, ++i, '--platform');
    } else if (arg.startsWith('--platform=')) {
      opts.platform = arg.slice('--platform='.length);
    } else if (arg === '--history') {
      opts.history = requireValue(argv, ++i, '--history');
    } else if (arg.startsWith('--history=')) {
      opts.history = arg.slice('--history='.length);
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
  let accounts = await client.fetchAccounts();
  if (accounts.length === 0) throw new CliError('No accounts found for this token.');

  if (opts.account !== null) {
    const wanted = opts.account.toLowerCase();
    accounts = accounts.filter((a) => a.name.toLowerCase() === wanted);
    if (accounts.length === 0) {
      throw new CliError(`No account matching "${opts.account}" found.`);
    }
  }

  if (opts.usage) {
    await runUsage(client, accounts, opts);
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
      toDisplayRows(filtered)
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
 * `--usage`: one row per account (plan, build concurrency, build counts per
 * platform, billing period).
 *
 * Plan fields are billing-scoped, so a token without billing permission on an
 * account gets a GraphQL error for that account only. That is not fatal: the
 * row is still printed with "-" in the plan columns, and the reason is
 * reported on stderr so it stays out of --json/--csv output.
 */
async function runUsage(client, accounts, opts) {
  const entries = [];
  const warnings = [];

  for (const account of accounts) {
    progress(`Fetching plan for ${account.name}…`);

    let plan = null;
    try {
      plan = await client.fetchAccountPlan(account.id);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      warnings.push(`${account.name}: ${err.message}`);
    }

    const subscription = plan?.subscription ?? null;
    const period = plan?.billingPeriod ?? null;
    const builds = plan?.buildsByPlatform ?? null;

    entries.push({
      account: account.name,
      plan: subscription?.name ?? null,
      planId: subscription?.planId ?? null,
      status: subscription?.status ?? null,
      concurrencyTotal: subscription?.concurrencies?.total ?? null,
      concurrencyIos: subscription?.concurrencies?.ios ?? null,
      concurrencyAndroid: subscription?.concurrencies?.android ?? null,
      buildsIos: builds?.ios ?? null,
      buildsAndroid: builds?.android ?? null,
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
    });
  }

  clearProgress();

  for (const warning of warnings) {
    console.error(dim(`  ! plan unavailable — ${warning}`));
  }

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
      [
        'ACCOUNT',
        'PLAN',
        'STATUS',
        usageConcurrencyHeader(opts.platform),
        usageBuildsHeader(opts.platform),
        'PERIOD',
      ],
      toUsageDisplayRows(entries, { platform: opts.platform })
    )
  );
  console.log(
    dim(
      `\n  ${entries.length} account(s). BUILDS/PERIOD = this account's current EAS billing period.`
    )
  );
}

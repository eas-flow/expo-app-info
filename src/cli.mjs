// Argument parsing, help text, and the top-level run() flow.
// Throws CliError/ApiError on failure; bin/cli.mjs is the only place that
// catches and converts those into a printed message + exit code.

import { readFileSync } from 'node:fs';
import { createApiClient, mapWithConcurrency } from './api.mjs';
import { formatCSV, formatJSON, toDisplayRows } from './format.mjs';
import { dim, renderTable } from './render.mjs';

export class CliError extends Error {}

const CONCURRENCY = 8;
const PLATFORMS = ['ios', 'android'];

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

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.

  Notes
    VERSION / BUILD come from the latest *successful* EAS build, not from your
    local app.json. Apps that have never been built show "-" in the table (and
    null in --json/--csv).
`;

export function parseArgs(argv) {
  const opts = {
    help: false,
    version: false,
    json: false,
    csv: false,
    account: null,
    platform: null,
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
    } else if (arg === '--account') {
      opts.account = requireValue(argv, ++i, '--account');
    } else if (arg.startsWith('--account=')) {
      opts.account = arg.slice('--account='.length);
    } else if (arg === '--platform') {
      opts.platform = requireValue(argv, ++i, '--platform');
    } else if (arg.startsWith('--platform=')) {
      opts.platform = arg.slice('--platform='.length);
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

  const entries = [];
  for (const account of accounts) {
    progress(`Fetching apps in ${account.name}…`);
    const apps = await client.fetchApps(account.id);

    let done = 0;
    const buildsPerApp = await mapWithConcurrency(apps, CONCURRENCY, async (app) => {
      const builds = await client.fetchLatestBuilds(app.id);
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
      ['ACCOUNT', 'APP', 'SLUG', 'PLATFORM', 'VERSION', 'BUILD', 'LAST BUILD'],
      toDisplayRows(filtered)
    )
  );
  console.log(dim(`\n  ${filtered.length} row(s). VERSION/BUILD = latest successful EAS build.`));
}

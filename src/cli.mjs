// Argument parsing, help text, and the top-level run() flow.
// Throws CliError/ApiError on failure; bin/cli.mjs is the only place that
// catches and converts those into a printed message + exit code.

import { readFileSync } from 'node:fs';
import { createApiClient, mapWithConcurrency } from './api.mjs';
import { dim, relativeDate, renderTable } from './render.mjs';

export class CliError extends Error {}

const CONCURRENCY = 8;

export const HELP = `
  expo-app-info — List every Expo (EAS) app with its latest build version per platform.

  Usage
    $ export EXPO_TOKEN=xxxxx
    $ npx expo-app-info

  Options
    -h, --help       Show this help
    -v, --version    Show version

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.

  Notes
    VERSION / BUILD come from the latest *successful* EAS build, not from your
    local app.json. Apps that have never been built show "-".
`;

export function parseArgs(argv) {
  const opts = { help: false, version: false };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-v' || arg === '--version') {
      opts.version = true;
    } else {
      throw new CliError(`Unknown option: ${arg}\n  Run \`expo-app-info --help\` to see usage.`);
    }
  }

  return opts;
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

  const rows = [];
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
        rows.push([account.name, app.name, app.slug, '-', '-', '-', '-']);
        return;
      }
      for (const b of builds) {
        rows.push([
          account.name,
          app.name,
          app.slug,
          b.platform.toLowerCase(),
          b.appVersion ?? '-',
          b.appBuildVersion ?? '-',
          relativeDate(b.createdAt),
        ]);
      }
    });
  }

  clearProgress();

  if (rows.length === 0) {
    console.log('No apps found.');
    return;
  }

  console.log(
    renderTable(['ACCOUNT', 'APP', 'SLUG', 'PLATFORM', 'VERSION', 'BUILD', 'LAST BUILD'], rows)
  );
  console.log(dim(`\n  ${rows.length} row(s). VERSION/BUILD = latest successful EAS build.`));
}

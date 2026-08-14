// Throws CliError/ApiError on failure; bin/cli.mjs is the only place that
// catches those and converts them into a printed message + exit code.

import { readFileSync } from 'node:fs';
import { HELP, parseArgs } from './args.mjs';
import { CliError } from './errors.mjs';
import { runList } from './features/list/command.mjs';
import { runMembers } from './features/members/command.mjs';
import { runStats } from './features/stats/command.mjs';
import { createApiClient } from './shared/api.mjs';
import { resolveAccount } from './shared/filter.mjs';
import { progress } from './shared/terminal/progress.mjs';
import { yellow } from './shared/terminal/render.mjs';

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

  // parseArgs does no I/O, so its notices are printed here — before
  // --help/--version, so a deprecated flag is still called out when combined
  // with them, and on stderr so it never lands in a redirected table.
  // opts.warnings currently only ever holds deprecation notices, hence yellow.
  for (const warning of opts.warnings) {
    console.error(yellow(`  ! ${warning}`));
  }

  if (opts.help) {
    // Only the section heading is colored, not the whole block below it —
    // enough to flag "this is going away" without drowning the rest of --help.
    console.log(HELP.replace('\n  Deprecated\n', `\n  ${yellow('Deprecated')}\n`));
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

  // Narrowed before any app/build fetch, for every display mode alike.
  if (opts.account !== null) {
    accounts = [resolveAccount(accounts, opts.account)];
  }

  // Table-only cosmetic mapping; see format.mjs.
  const accountDisplayNames = new Map(accounts.map((a) => [a.name, a.displayName || a.name]));

  if (opts.stats) {
    await runStats(client, accounts, opts, accountDisplayNames);
    return;
  }

  if (opts.members) {
    await runMembers(client, accounts, opts, accountDisplayNames);
    return;
  }

  await runList(client, accounts, opts, accountDisplayNames);
}

// The top-level run() flow: parse arguments, resolve auth, fetch the
// account list, and dispatch to the requested display mode's flow in
// src/commands/. Throws CliError/ApiError on failure; bin/cli.mjs is the
// only place that catches and converts those into a printed message + exit
// code.

import { readFileSync } from 'node:fs';
import { createApiClient } from './api.mjs';
import { HELP, parseArgs } from './args.mjs';
import { runList } from './commands/list.mjs';
import { runPlan } from './commands/plan.mjs';
import { runUsage } from './commands/usage.mjs';
import { progress } from './progress.mjs';

export class CliError extends Error {}

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

  // Table-only cosmetic slug -> "Display name" mapping (issue #22); see
  // toDisplayRows/toUsageDisplayRows in format.mjs.
  const accountDisplayNames = new Map(accounts.map((a) => [a.name, a.displayName || a.name]));

  if (opts.usage) {
    await runUsage(client, accounts, opts, accountDisplayNames);
    return;
  }

  if (opts.plan) {
    await runPlan(client, accounts, opts, accountDisplayNames);
    return;
  }

  await runList(client, accounts, opts, accountDisplayNames);
}

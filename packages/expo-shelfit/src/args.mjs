// Argument parsing, validation limits, and the help text — everything about
// *what the user asked for*, separated from *how the CLI does it*
// (src/cli.mjs and the per-mode flows). Throws CliError on user mistakes;
// bin/cli.mjs is still the only place that turns errors into exit codes.

import { CliError } from './errors.mjs';

const PLATFORMS = ['ios', 'android'];
// --stats grouping axes. "account" is the default and keeps the original
// output; "app" swaps the ACCOUNT column for an APP column.
const GROUP_BY_AXES = ['account', 'app'];
// Sanity cap on --history (no documented API max) — keeps a typo like
// --history 99999 from hammering the API. Confirmed accepted at 100.
const MAX_HISTORY = 100;

// --stats defaults to the last 3 UTC calendar months; --month widens it, capped
// at 12 since a wider window means more paging per app (request count/latency).
export const DEFAULT_STATS_MONTHS = 3;
const MAX_MONTH = 12;

// `--usage` was this mode's original name. It kept being mistaken for
// EAS's *billing* usage — which this CLI deliberately never queries (see
// src/shared/api.mjs#countBuildsByMonth) — so it is now `--stats`. The old flag still
// works but warns; it goes away in the next major.
export const DEPRECATED_USAGE_WARNING =
  '--usage is deprecated and will be removed in the next major version. Use --stats instead.';

export const HELP = `
  expo-shelfit — List every Expo (EAS) app with its latest build version per platform.

  Usage
    $ export EXPO_TOKEN=xxxxx
    $ npx @my-shelfio/expo-shelfit [options]

  Options
    -h, --help              Show this help
    -v, --version           Show version
    --platform <platform>   Only show "ios" or "android" builds
    --stats                 Show success/errored/canceled/total build counts per UTC
                             calendar month and platform (last 3 months by default)
                             instead of the app list. Cannot be combined with --plan or
                             --history.
    --month <n>             Widen --stats to the last <n> calendar months (1-12, default
                             3). Only valid together with --stats.
    --group-by <axis>       Count --stats rows per "account" (default) or per "app".
                             "app" replaces the ACCOUNT column with an APP column. Only
                             valid together with --stats.
    --plan                  Show current account subscription (plan/concurrency) instead
                             of the app list. Cannot be combined with --stats or --history.
    --history <N>           Show the N most recent builds per platform instead of just
                             the latest (1-100). Cannot be combined with --stats or --plan.
    --account <slug|name>   Only this account (matches slug or EAS Display name). Applies
                             to every display mode.
    --app <slug|name>       Only this app (matches slug or EAS Display name). Applies to
                             every display mode except --plan (--plan doesn't fetch apps).
    --local                 Show BUILD DATE in the local timezone (TZ env var or system
                             default) instead of UTC. Only affects BUILD DATE — --stats'
                             PERIOD and --plan's TRIAL END stay UTC. Cannot be combined
                             with --stats or --plan (neither has a BUILD DATE column).

  Deprecated
    --usage                 Old name for --stats. Still works, prints a warning on
                             stderr, and will be removed in the next major version.

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.
`;

export function parseArgs(argv) {
  const opts = {
    help: false,
    version: false,
    platform: null,
    stats: false,
    plan: false,
    history: null,
    month: null,
    account: null,
    app: null,
    groupBy: null,
    local: false,
    // Collected rather than printed, so parseArgs stays I/O-free for the same
    // reason src/* never calls process.exit.
    warnings: [],
  };

  // Tracked separately so error messages can echo the flag the user actually
  // typed: `--usage --plan` must not report `--stats`, which they never wrote.
  let sawStats = false;
  let sawDeprecatedUsage = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-v' || arg === '--version') {
      opts.version = true;
    } else if (arg === '--stats') {
      sawStats = true;
    } else if (arg === '--usage') {
      sawDeprecatedUsage = true;
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
    } else if (arg === '--account') {
      opts.account = requireValue(argv, ++i, '--account');
    } else if (arg.startsWith('--account=')) {
      opts.account = arg.slice('--account='.length);
    } else if (arg === '--app') {
      opts.app = requireValue(argv, ++i, '--app');
    } else if (arg.startsWith('--app=')) {
      opts.app = arg.slice('--app='.length);
    } else if (arg === '--group-by') {
      opts.groupBy = requireValue(argv, ++i, '--group-by');
    } else if (arg.startsWith('--group-by=')) {
      opts.groupBy = arg.slice('--group-by='.length);
    } else if (arg === '--local') {
      opts.local = true;
    } else {
      throw new CliError(`Unknown option: ${arg}\n  Run \`expo-shelfit --help\` to see usage.`);
    }
  }

  opts.stats = sawStats || sawDeprecatedUsage;
  const statsFlag = sawStats ? '--stats' : '--usage';
  if (sawDeprecatedUsage) opts.warnings.push(DEPRECATED_USAGE_WARNING);

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
  }

  if (opts.month !== null) {
    const parsed = Number(opts.month);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MONTH) {
      throw new CliError(
        `Invalid --month value: "${opts.month}". Expected an integer between 1 and ${MAX_MONTH}.`
      );
    }
    opts.month = parsed;
  }

  if (opts.account !== null && opts.account.trim() === '') {
    throw new CliError('--account requires a non-empty value.');
  }

  if (opts.app !== null && opts.app.trim() === '') {
    throw new CliError('--app requires a non-empty value.');
  }

  if (opts.groupBy !== null) {
    const normalized = opts.groupBy.toLowerCase();
    if (!GROUP_BY_AXES.includes(normalized)) {
      throw new CliError(
        `Invalid --group-by value: "${opts.groupBy}". Expected "account" or "app".`
      );
    }
    opts.groupBy = normalized;
  }

  // Order here decides which pair gets reported first when 3 are set at once.
  const activeModes = EXCLUSIVE_MODES.filter((mode) => isModeActive(opts, mode));
  if (activeModes.length >= 2) {
    const [subject, other] = activeModes;
    throw new CliError(
      `${modeFlag(subject, statsFlag)} cannot be combined with ${modeFlag(other, statsFlag)}.`
    );
  }

  // The required mode wasn't given, so there is no typed flag name to echo —
  // always name the current one (--stats), never the deprecated alias.
  for (const [flag, requiredMode] of Object.entries(MODE_ONLY_FLAGS)) {
    if (opts[flag] !== null && !opts[requiredMode]) {
      throw new CliError(`${flagName(flag)} can only be used with --${requiredMode}.`);
    }
  }

  // The inverse of MODE_ONLY_FLAGS. A truthy check covers both the
  // nullable-string flags (--app) and the boolean ones (--local).
  for (const [flag, incompatibleModes] of Object.entries(MODE_INCOMPATIBLE_FLAGS)) {
    if (!opts[flag]) continue;
    for (const mode of incompatibleModes) {
      if (opts[mode]) {
        throw new CliError(`--${flag} cannot be used with ${modeFlag(mode, statsFlag)}.`);
      }
    }
  }

  return opts;
}

const EXCLUSIVE_MODES = ['plan', 'history', 'stats'];
const MODE_ONLY_FLAGS = { month: 'stats', groupBy: 'stats' };
// --app is account-only under --plan, which never fetches apps; --local has no
// BUILD DATE column to affect under --stats/--plan.
const MODE_INCOMPATIBLE_FLAGS = { app: ['plan'], local: ['stats', 'plan'] };

// For the flags whose opts key and CLI spelling differ — camelCase can't be
// turned into `--group-by` by prefixing alone.
const FLAG_NAMES = { groupBy: '--group-by' };

function flagName(key) {
  return FLAG_NAMES[key] ?? `--${key}`;
}

// stats is the only mode with an alias, so it's the only one whose flag name
// depends on what this run was invoked with.
function modeFlag(mode, statsFlag) {
  return mode === 'stats' ? statsFlag : `--${mode}`;
}

function isModeActive(opts, mode) {
  return mode === 'history' ? opts.history !== null : opts[mode] === true;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined) throw new CliError(`${flag} requires a value.`);
  return value;
}

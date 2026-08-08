// Argument parsing, validation limits, and the help text — everything about
// *what the user asked for*, separated from *how the CLI does it*
// (src/cli.mjs and the per-mode flows). Throws CliError on user mistakes;
// bin/cli.mjs is still the only place that turns errors into exit codes.

import { CliError } from './cli.mjs';

const PLATFORMS = ['ios', 'android'];
// Sanity cap on --history (no documented API max) — keeps a typo like
// --history 99999 from hammering the API. Confirmed accepted at 100 via
// scripts/probe-history.mjs.
const MAX_HISTORY = 100;

// --usage defaults to the last 3 UTC calendar months; --month widens it, capped
// at 12 since a wider window means more paging per app (request count/latency).
export const DEFAULT_USAGE_MONTHS = 3;
const MAX_MONTH = 12;

export const HELP = `
  expo-shelfit — List every Expo (EAS) app with its latest build version per platform.

  Usage
    $ export EXPO_TOKEN=xxxxx
    $ npx @my-shelfio/expo-shelfit [options]

  Options
    -h, --help              Show this help
    -v, --version           Show version
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
    back to its unique slug otherwise.

    VERSION / BUILD come from the latest *successful* EAS build, not from your
    local app.json. Apps that have never been built show "-" in the table.

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
    reports. The current (in-progress) month's row shows "(today)" as its end.
    A token without app/build read access on an account degrades that
    account's rows to "-" rather than failing the run.

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
      throw new CliError(`Unknown option: ${arg}\n  Run \`expo-shelfit --help\` to see usage.`);
    }
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

  // Display modes are mutually exclusive. Order here also decides which
  // pair gets reported first when 3 are set at once (#57).
  const activeModes = EXCLUSIVE_MODES.filter((mode) => isModeActive(opts, mode));
  if (activeModes.length >= 2) {
    const [subject, other] = activeModes;
    throw new CliError(`--${subject} cannot be combined with --${other}.`);
  }

  // Flags that only make sense alongside a specific display mode.
  for (const [flag, requiredMode] of Object.entries(MODE_ONLY_FLAGS)) {
    if (opts[flag] !== null && !opts[requiredMode]) {
      throw new CliError(`--${flag} can only be used with --${requiredMode}.`);
    }
  }

  return opts;
}

const EXCLUSIVE_MODES = ['plan', 'history', 'usage'];
const MODE_ONLY_FLAGS = { month: 'usage' };

function isModeActive(opts, mode) {
  return mode === 'history' ? opts.history !== null : opts[mode] === true;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined) throw new CliError(`${flag} requires a value.`);
  return value;
}

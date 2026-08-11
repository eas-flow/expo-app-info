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
    --usage                 Show success/errored/canceled build counts per UTC calendar
                             month (last 3 by default) instead of the app list. Cannot be
                             combined with --plan or --history.
    --month <n>             Widen --usage to the last <n> calendar months (1-12, default
                             3). Only valid together with --usage.
    --plan                  Show current account subscription (plan/concurrency) instead
                             of the app list. Cannot be combined with --usage or --history.
    --history <N>           Show the N most recent builds per platform instead of just
                             the latest (1-100). Cannot be combined with --usage or --plan.
    --account <slug|name>   Only this account (matches slug or EAS Display name). Applies
                             to every display mode.
    --app <slug>            Only this app. Applies to every display mode except --plan
                             (--plan doesn't fetch apps).
    --local                 Show BUILD DATE in the local timezone (TZ env var or system
                             default) instead of UTC. Only affects BUILD DATE — --usage's
                             PERIOD and --plan's TRIAL END stay UTC. Cannot be combined
                             with --usage or --plan (neither has a BUILD DATE column).

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.

  Notes
    ACCOUNT shows the account's EAS "Display name" when one is set, falling
    back to its unique slug otherwise.

    VERSION / BUILD / STATUS come from the latest EAS build *attempt*,
    regardless of status — not from your local app.json, and not filtered
    down to only successful builds. If the most recent attempt for a
    platform errored or was canceled, that is what shows, not an older
    successful one. Apps that have never had any build attempt show "-" in
    the table.

    STATUS shows Finished / Errored / Canceled — the only EAS build statuses
    confirmed against the real API so far. Any other status (most likely a
    still in-progress or queued build) shows the raw value lowercased
    instead of a friendly label, so an unrecognized status is still visible
    rather than hidden.

    --history <N> lists the N most recent build attempts per platform as
    separate rows (newest first, sorted by build date regardless of the order
    the API returns them in), instead of collapsing each app/platform down to
    a single latest-build row. The BUILD DATE column header applies whether
    or not --history is set, since a row is not necessarily the "last" build
    once more than one is shown.

    --usage prints one row per account *per UTC calendar month* — the last 3
    months by default, or the last <n> with --month <n> (1-12). Each row's
    SUCCESS/ERRORED/CANCELED build counts are counted client-side from every
    build in an app's history via the API (not EAS's own billing usage
    metric, which can't be sliced by arbitrary calendar ranges); they may
    differ from what EAS's dashboard reports. A still in-progress or queued
    build isn't counted into any of the three categories. The current
    (in-progress) month's row shows "(today)" as its end. A token without
    app/build read access on an account degrades that account's rows to "-"
    rather than failing the run.

    --plan prints one row per account with its current subscription only —
    plan name, plan ID, status, concurrency (total/ios/android), and trial
    end — no build counts or billing period. Same degrade-to-"-" behavior as
    --usage on a per-account failure. Cannot be combined with --usage or
    --history, since each is its own display mode.

    --account <slug|name> narrows every display mode to a single account.
    Matches the unique slug or the EAS Display name (case-insensitive exact
    match); if a Display name matches more than one account, pass the slug
    instead. No match exits 1 with "Did you mean" suggestions.

    --app <slug> narrows every display mode except --plan to a single app
    (--plan is account-only and never fetches apps, so combining it with
    --app is a CliError). Matches the app's unique slug, case-insensitively.
    The filter is applied before fetching builds, not after, so it also
    speeds up the run. No match exits 1 with "Did you mean" suggestions.

    --local switches only the BUILD DATE column to the local timezone (the
    header shows the current UTC offset, e.g. "BUILD DATE (+09:00)"); every
    other date/boundary this CLI shows — --usage's PERIOD calendar-month
    boundaries and --plan's TRIAL END — stays UTC regardless, since --usage's
    monthly counts would otherwise silently shift which month a build is
    counted in. Respects the TZ environment variable like any other Node
    process (e.g. TZ=America/New_York npx @my-shelfio/expo-shelfit --local).
    Cannot be combined with --usage or --plan, since neither has a BUILD DATE
    column for it to affect.
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
    account: null,
    app: null,
    local: false,
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
    } else if (arg === '--account') {
      opts.account = requireValue(argv, ++i, '--account');
    } else if (arg.startsWith('--account=')) {
      opts.account = arg.slice('--account='.length);
    } else if (arg === '--app') {
      opts.app = requireValue(argv, ++i, '--app');
    } else if (arg.startsWith('--app=')) {
      opts.app = arg.slice('--app='.length);
    } else if (arg === '--local') {
      opts.local = true;
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

  if (opts.account !== null && opts.account.trim() === '') {
    throw new CliError('--account requires a non-empty value.');
  }

  if (opts.app !== null && opts.app.trim() === '') {
    throw new CliError('--app requires a non-empty value.');
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

  // Flags that are common filters but don't make sense with one or more
  // particular display modes — the inverse of MODE_ONLY_FLAGS above. Values
  // are arrays since a flag can be incompatible with more than one mode
  // (--local with both --usage and --plan). Truthy check on opts[flag] works
  // for both nullable-string flags (--app) and boolean flags (--local).
  // --app is incompatible with --plan since --plan is account-only and never
  // fetches apps (#84, see src/commands/plan.mjs); --local is incompatible
  // with --usage/--plan since neither has a BUILD DATE column for it to
  // affect (#85).
  for (const [flag, incompatibleModes] of Object.entries(MODE_INCOMPATIBLE_FLAGS)) {
    if (!opts[flag]) continue;
    for (const mode of incompatibleModes) {
      if (opts[mode]) {
        throw new CliError(`--${flag} cannot be used with --${mode}.`);
      }
    }
  }

  return opts;
}

const EXCLUSIVE_MODES = ['plan', 'history', 'usage'];
const MODE_ONLY_FLAGS = { month: 'usage' };
const MODE_INCOMPATIBLE_FLAGS = { app: ['plan'], local: ['usage', 'plan'] };

function isModeActive(opts, mode) {
  return mode === 'history' ? opts.history !== null : opts[mode] === true;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined) throw new CliError(`${flag} requires a value.`);
  return value;
}

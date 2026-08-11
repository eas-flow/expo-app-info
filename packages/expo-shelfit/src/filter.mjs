// Client-side --app/--account resolution (issue #84). Both flags narrow
// *before* the expensive per-app build fetch — see src/cli.mjs (--account,
// applied once against the full account list right after fetchAccounts())
// and src/commands/list.mjs / usage.mjs (--app, applied per-account right
// after fetchApps(), before fetchBuilds()/countBuildsByMonth()). Sits
// alongside api/format/render/dates/progress in the import graph: used by
// cli.mjs and commands/*.mjs, imports nothing from either.

import { CliError } from './cli.mjs';

// Cap on "Did you mean" suggestions — an account/app-heavy org could
// otherwise dump dozens of near-matches into one error message.
const MAX_SUGGESTIONS = 5;

/**
 * Resolves `--account <value>` against fetched accounts, matching the
 * unique slug (`account.name`) first, falling back to the EAS Display name
 * (`account.displayName`) — both case-insensitive exact match, no
 * partial/prefix matching (see suggestNear below for that, used only in the
 * not-found error). Slug is checked first and wins outright since it's
 * guaranteed unique; Display names are not, so a Display name that matches
 * more than one account throws rather than silently picking one.
 */
export function resolveAccount(accounts, value) {
  const needle = value.toLowerCase();

  const bySlug = accounts.find((a) => a.name.toLowerCase() === needle);
  if (bySlug) return bySlug;

  const byDisplayName = accounts.filter((a) => a.displayName?.toLowerCase() === needle);
  if (byDisplayName.length === 1) return byDisplayName[0];
  if (byDisplayName.length > 1) {
    const slugs = byDisplayName.map((a) => a.name).join(', ');
    throw new CliError(
      `--account "${value}" matches multiple accounts by Display name: ${slugs}.\n` +
        '  Pass the unique slug instead.'
    );
  }

  const keys = accounts.flatMap((a) => (a.displayName ? [a.name, a.displayName] : [a.name]));
  throw notFoundError('account', value, keys);
}

/**
 * Creates an `--app <slug>` filter for use inside a per-account apps loop
 * (src/commands/list.mjs, usage.mjs). `slug` is `opts.app` (nullable — a
 * no-op filter when unset). `filter(apps)` narrows one account's apps down
 * to the match (slug is unique within an account, so at most one); call
 * `finalize()` once after every account has been through `filter()` — it
 * throws CliError (with "Did you mean" suggestions gathered from every app
 * seen across every account) if `slug` was set but never matched anywhere.
 */
export function createAppFilter(slug) {
  if (slug === null) {
    return { filter: (apps) => apps, finalize() {} };
  }

  const needle = slug.toLowerCase();
  const seenSlugs = new Set();
  let found = false;

  return {
    filter(apps) {
      for (const app of apps) seenSlugs.add(app.slug);
      const matched = apps.filter((app) => app.slug.toLowerCase() === needle);
      if (matched.length > 0) found = true;
      return matched;
    },
    finalize() {
      if (!found) throw notFoundError('app', slug, [...seenSlugs]);
    },
  };
}

/**
 * `No <label> matched "<value>".` with up to MAX_SUGGESTIONS near matches —
 * prefix match first, then substring, both case-insensitive against `keys`
 * (every candidate slug/Display name known at the point of failure).
 */
function notFoundError(label, value, keys) {
  const suggestions = suggestNear(value.toLowerCase(), keys);
  const suggestLine = suggestions.length ? `\n  Did you mean: ${suggestions.join(', ')}?` : '';
  throw new CliError(
    `No ${label} matched "${value}".${suggestLine}\n` +
      `  Run \`expo-shelfit\` with no arguments to list every ${label}.`
  );
}

function suggestNear(needle, keys) {
  const prefix = keys.filter((k) => k.toLowerCase().startsWith(needle));
  const substring = keys.filter((k) => !prefix.includes(k) && k.toLowerCase().includes(needle));
  return [...new Set([...prefix, ...substring])].slice(0, MAX_SUGGESTIONS);
}

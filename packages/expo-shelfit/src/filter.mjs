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

// A candidate only surfaces as a suggestion if its edit distance from the
// input is at most this fraction of the *candidate's* length (so a 1-char
// typo on a short slug still counts as "close" while an unrelated slug of
// similar length doesn't) — floored at 1 so even a 1-2 char input can still
// get a suggestion for a single-edit typo.
const MAX_DISTANCE_RATIO = 0.4;

/**
 * Resolves `--account <value>` against fetched accounts, matching the
 * unique slug (`account.name`) first, falling back to the EAS Display name
 * (`account.displayName`) — both case-insensitive exact match, no
 * partial/prefix matching (see suggestNear below for near-miss suggestions,
 * used only in the not-found error). Slug is checked first and wins
 * outright since it's guaranteed unique; Display names are not, so a
 * Display name that matches more than one account throws rather than
 * silently picking one.
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
 * ranked by Levenshtein edit distance (closest first), case-insensitive,
 * against `keys` (every candidate slug/Display name known at the point of
 * failure). Catches transposed/missing/extra-character typos that a
 * prefix/substring check would miss (e.g. "storfront" -> "storefront").
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
  const scored = keys
    .map((key) => ({ key, distance: levenshtein(needle, key.toLowerCase()) }))
    .filter(
      ({ key, distance }) => distance <= Math.max(1, Math.floor(key.length * MAX_DISTANCE_RATIO))
    );

  scored.sort((a, b) => a.distance - b.distance);

  // A key can appear twice for one account (slug + Display name computed
  // independently in resolveAccount's `keys`) — dedup while keeping the
  // closer-ranked occurrence, since scored is already distance-sorted.
  return [...new Set(scored.map((s) => s.key))].slice(0, MAX_SUGGESTIONS);
}

/**
 * Levenshtein edit distance (insert/delete/substitute, each cost 1) between
 * two strings — used only to rank "Did you mean" suggestions above, so the
 * plain O(len(a) * len(b)) two-row DP below is plenty: inputs here are short
 * slugs/Display names and there are at most a handful of candidates.
 * Zero-dependency by design, like the rest of this CLI.
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(
        Math.min(
          prevRow[j] + 1, // deletion
          currRow[j - 1] + 1, // insertion
          prevRow[j - 1] + substitutionCost // substitution
        )
      );
    }
    prevRow = currRow;
  }

  return prevRow[b.length];
}

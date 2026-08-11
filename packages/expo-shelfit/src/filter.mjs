// Client-side --app/--account resolution. Both flags narrow *before* the
// expensive per-app build fetch: --account in src/cli.mjs right after
// fetchAccounts(), --app per-account in src/commands/ right after fetchApps().

import { CliError } from './errors.mjs';

// Cap on "Did you mean" suggestions — an account/app-heavy org could
// otherwise dump dozens of near-matches into one error message.
const MAX_SUGGESTIONS = 5;

// Edit distance allowed as a fraction of the *candidate's* length, floored at
// 1 so even a 1-2 char input can still get a single-edit suggestion.
const MAX_DISTANCE_RATIO = 0.4;

/**
 * Exact match only, case-insensitive. The slug is checked first and wins
 * outright since it's guaranteed unique; Display names are not, so one that
 * matches several accounts throws rather than silently picking one.
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
 * Same matching rule as resolveAccount, applied one account's apps at a time.
 * Ambiguity is therefore scoped per account: the same Display name in another
 * account is a separate `filter()` call and matches independently.
 *
 * Call `finalize()` after every account has been through `filter()` — only
 * then is "matched nowhere" knowable, and only then are all the candidate
 * names for a "Did you mean" suggestion in hand.
 */
export function createAppFilter(value) {
  if (value === null) {
    return { filter: (apps) => apps, finalize() {} };
  }

  const needle = value.toLowerCase();
  const seenKeys = [];
  let found = false;

  return {
    filter(apps) {
      for (const app of apps) {
        seenKeys.push(app.slug);
        if (app.name) seenKeys.push(app.name);
      }

      const bySlug = apps.filter((app) => app.slug.toLowerCase() === needle);
      if (bySlug.length > 0) {
        found = true;
        return bySlug;
      }

      const byDisplayName = apps.filter((app) => app.name?.toLowerCase() === needle);
      if (byDisplayName.length > 1) {
        const slugs = byDisplayName.map((a) => a.slug).join(', ');
        throw new CliError(
          `--app "${value}" matches multiple apps by Display name: ${slugs}.\n` +
            '  Pass the unique slug instead.'
        );
      }
      if (byDisplayName.length === 1) found = true;
      return byDisplayName;
    },
    finalize() {
      if (!found) throw notFoundError('app', value, seenKeys);
    },
  };
}

/**
 * Suggestions are ranked by edit distance rather than prefix/substring, so a
 * transposed or missing character still matches ("storfront" -> "storefront").
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

  // A key can appear twice (slug + Display name); Set keeps the first, which
  // is the closer-ranked one because `scored` is already distance-sorted.
  return [...new Set(scored.map((s) => s.key))].slice(0, MAX_SUGGESTIONS);
}

/**
 * Only ranks "Did you mean" suggestions, so the plain two-row DP is plenty —
 * inputs are short slugs and there are a handful of candidates. Hand-rolled
 * because this CLI is zero-dependency by design.
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

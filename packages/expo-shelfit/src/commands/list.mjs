// Default display mode (and `--history <N>`): one row per app/platform with
// the latest successful build(s). Moved out of src/cli.mjs so every display
// mode lives in its own file under src/commands/.

import { mapWithConcurrency } from '../api.mjs';
import { createAppFilter } from '../filter.mjs';
import { buildDateHeader, toDisplayRows } from '../format.mjs';
import { clearProgress, progress } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * The default app list: every account's apps with their latest (or, with
 * `--history <N>`, latest N) successful builds per platform.
 */
export async function runList(client, accounts, opts, accountDisplayNames) {
  const appFilter = createAppFilter(opts.app);
  const entries = [];
  for (const account of accounts) {
    progress(`Fetching apps in ${account.name}…`);
    // --app narrows here, right after fetchApps() and before fetchBuilds()
    // below, so a non-matching account never pays for a build fetch (#84).
    const apps = appFilter.filter(await client.fetchApps(account.id));

    let done = 0;
    const buildsPerApp = await mapWithConcurrency(apps, async (app) => {
      const builds = await client.fetchBuilds(app.id, {
        limit: opts.history ?? 1,
        platform: opts.platform,
      });
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

  // Throws if --app was set but never matched any account's apps above —
  // before printing anything, matching every other display mode.
  appFilter.finalize();

  clearProgress();

  // `fetchBuilds` above already only requests the platform in `opts.platform`
  // (if any), so every remaining entry already matches it — this just drops
  // the "no builds at all" rows (`platform: null`), matching the pre-#59
  // behavior where those rows dropped out of the client-side `=== opts.platform`
  // filter too.
  const filtered = opts.platform !== null ? entries.filter((e) => e.platform !== null) : entries;

  if (filtered.length === 0) {
    console.log('No apps found.');
    return;
  }

  console.log(
    renderTable(
      ['ACCOUNT', 'APP', 'SLUG', 'PLATFORM', 'VERSION', 'BUILD', buildDateHeader(opts.local)],
      toDisplayRows(filtered, { accountDisplayNames, local: opts.local })
    )
  );
  // The effective count is what matters here, not whether --history was
  // typed: `--history 1` must read identically to not passing the flag at
  // all, since it produces the exact same query and the exact same rows.
  const effectiveHistory = opts.history ?? 1;
  const footerNote =
    effectiveHistory > 1
      ? `VERSION/BUILD = latest ${effectiveHistory} successful EAS builds per platform, newest first.`
      : 'VERSION/BUILD = latest successful EAS build.';
  console.log(dim(`\n  ${filtered.length} row(s). ${footerNote}`));
}

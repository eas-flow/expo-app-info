import { mapWithConcurrency } from '../../shared/concurrency.mjs';
import { createAppFilter } from '../../shared/filter.mjs';
import { clearProgress, progress } from '../../shared/terminal/progress.mjs';

/**
 * The latest build *attempt* per platform regardless of status, so an app
 * whose most recent attempt errored or was canceled shows that rather than
 * silently falling back to an older successful build. Returns entries
 * already narrowed by --app and (if set) --platform; no console output.
 */
export async function fetchListEntries(client, accounts, opts) {
  const appFilter = createAppFilter(opts.app);
  const entries = [];
  for (const account of accounts) {
    progress(`Fetching apps in ${account.name}…`);
    // Narrowed before fetchBuilds(), so a non-matching app never pays for it.
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
          status: null,
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
          status: b.status ?? null,
          lastBuildAt: b.createdAt ?? null,
        });
      }
    });
  }

  // Before returning, so a --app that matched nothing fails cleanly.
  appFilter.finalize();

  clearProgress();

  // fetchBuilds already asked for `opts.platform` only, so this drops nothing
  // but the "no builds at all" rows — which a client-side platform comparison
  // would have dropped too.
  return opts.platform !== null ? entries.filter((e) => e.platform !== null) : entries;
}

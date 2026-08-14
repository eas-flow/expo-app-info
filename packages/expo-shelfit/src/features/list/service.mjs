import { mapWithConcurrency } from '../../shared/concurrency.mjs';
import { createAppFilter } from '../../shared/filter.mjs';
import { clearProgress, progress } from '../../shared/terminal/progress.mjs';

/**
 * The latest build *attempt* per platform regardless of status, so an app
 * whose most recent attempt errored or was canceled shows that rather than
 * silently falling back to an older successful build — each carrying its own
 * SUBMIT/UPDATE, so --history rows differ from one another. Returns entries
 * already narrowed by --app and (if set) --platform; no console output.
 */
export async function fetchListEntries(client, accounts, opts) {
  const appFilter = createAppFilter(opts.app);
  const entries = [];
  for (const account of accounts) {
    progress(`Fetching apps in ${account.name}…`);
    // Narrowed before fetchAppOverview(), so a non-matching app never pays for it.
    const apps = appFilter.filter(await client.fetchApps(account.id));

    let done = 0;
    const overviewPerApp = await mapWithConcurrency(apps, async (app) => {
      const overview = await client.fetchAppOverview(app.id, {
        limit: opts.history ?? 1,
        platform: opts.platform,
      });
      progress(`${account.name}: ${++done}/${apps.length} apps…`);
      return overview;
    });

    apps.forEach((app, i) => {
      const { builds } = overviewPerApp[i];
      if (builds.length === 0) {
        entries.push(emptyEntry(account, app));
        return;
      }
      for (const b of builds) {
        entries.push(buildEntry(account, app, b));
      }
    });
  }

  // Before returning, so a --app that matched nothing fails cleanly.
  appFilter.finalize();

  clearProgress();

  // fetchAppOverview already asked for `opts.platform` only, so this drops
  // nothing but the "no builds at all" rows — which a client-side platform
  // comparison would have dropped too.
  return opts.platform !== null ? entries.filter((e) => e.platform !== null) : entries;
}

function emptyEntry(account, app) {
  return {
    account: account.name,
    app: app.slug,
    platform: null,
    version: null,
    build: null,
    sdk: null,
    cli: null,
    status: null,
    lastBuildAt: null,
    submissionStatus: null,
    submissionCreatedAt: null,
    updateBranch: null,
    updateCreatedAt: null,
  };
}

function buildEntry(account, app, b) {
  return {
    account: account.name,
    app: app.slug,
    platform: b.platform.toLowerCase(),
    version: b.appVersion ?? null,
    build: b.appBuildVersion ?? null,
    sdk: b.sdkVersion ?? null,
    cli: b.cliVersion ?? null,
    status: b.status ?? null,
    lastBuildAt: b.createdAt ?? null,
    submissionStatus: b.submission?.status ?? null,
    submissionCreatedAt: b.submission?.createdAt ?? null,
    updateBranch: b.update?.branch ?? null,
    updateCreatedAt: b.update?.createdAt ?? null,
  };
}

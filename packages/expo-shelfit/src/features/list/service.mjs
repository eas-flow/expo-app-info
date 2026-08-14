import { mapWithConcurrency } from '../../shared/concurrency.mjs';
import { createAppFilter } from '../../shared/filter.mjs';
import { clearProgress, progress } from '../../shared/terminal/progress.mjs';

/**
 * The latest build *attempt* per platform regardless of status, so an app
 * whose most recent attempt errored or was canceled shows that rather than
 * silently falling back to an older successful build — plus that platform's
 * current SUBMIT/UPDATE state, repeated on every --history row for that
 * platform since submission/update aren't per-build-attempt facts. Returns
 * entries already narrowed by --app and (if set) --platform; no console
 * output.
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
      const { builds, submissionsByPlatform, updatesByPlatform } = overviewPerApp[i];
      if (builds.length === 0) {
        entries.push(emptyEntry(account, app));
        return;
      }
      for (const b of builds) {
        const platform = b.platform.toLowerCase();
        entries.push(
          buildEntry(
            account,
            app,
            b,
            platform,
            submissionsByPlatform[platform],
            updatesByPlatform[platform]
          )
        );
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

function buildEntry(account, app, b, platform, submission, update) {
  return {
    account: account.name,
    app: app.slug,
    platform,
    version: b.appVersion ?? null,
    build: b.appBuildVersion ?? null,
    sdk: b.sdkVersion ?? null,
    cli: b.cliVersion ?? null,
    status: b.status ?? null,
    lastBuildAt: b.createdAt ?? null,
    submissionStatus: submission?.status ?? null,
    submissionCreatedAt: submission?.createdAt ?? null,
    updateBranch: update?.branch ?? null,
    updateCreatedAt: update?.createdAt ?? null,
  };
}

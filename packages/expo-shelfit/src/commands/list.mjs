import { mapWithConcurrency } from '../api.mjs';
import { createAppFilter } from '../filter.mjs';
import { buildDateHeader, toDisplayRows } from '../format.mjs';
import { clearProgress, progress } from '../progress.mjs';
import { dim, renderTable } from '../render.mjs';

/**
 * The latest build *attempt* per platform regardless of status, so an app
 * whose most recent attempt errored or was canceled shows that rather than
 * silently falling back to an older successful build.
 */
export async function runList(client, accounts, opts, accountDisplayNames) {
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

  // Before printing anything, so a --app that matched nothing fails cleanly.
  appFilter.finalize();

  clearProgress();

  // fetchBuilds already asked for `opts.platform` only, so this drops nothing
  // but the "no builds at all" rows — which a client-side platform comparison
  // would have dropped too.
  const filtered = opts.platform !== null ? entries.filter((e) => e.platform !== null) : entries;

  if (filtered.length === 0) {
    console.log('No apps found.');
    return;
  }

  console.log(
    renderTable(
      [
        'ACCOUNT',
        'APP',
        'SLUG',
        'PLATFORM',
        'VERSION',
        'BUILD',
        'STATUS',
        buildDateHeader(opts.local),
      ],
      toDisplayRows(filtered, { accountDisplayNames, local: opts.local })
    )
  );
  // `--history 1` must read identically to passing no flag at all — same
  // query, same rows — so the footer keys off the effective count.
  const effectiveHistory = opts.history ?? 1;
  const footerNote =
    effectiveHistory > 1
      ? `VERSION/BUILD/STATUS = latest ${effectiveHistory} EAS build(s) per platform, newest first, regardless of status.`
      : 'VERSION/BUILD/STATUS = latest EAS build attempt, regardless of status.';
  console.log(dim(`\n  ${filtered.length} row(s). ${footerNote}`));
}

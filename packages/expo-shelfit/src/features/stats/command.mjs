import { dim, red, renderTable } from '../../shared/terminal/render.mjs';
import { statsBuildsHeaders, toStatsDisplayRows } from './format.mjs';
import { fetchStatsEntries } from './service.mjs';

export async function runStats(client, accounts, opts, accountDisplayNames, now = new Date()) {
  const { entries, groupCount, months, byApp, warnings, metricsMissingCount } =
    await fetchStatsEntries(client, accounts, opts, now);

  for (const warning of warnings) {
    console.error(red(`  ! stats unavailable — ${warning}`));
  }

  const displayRows = toStatsDisplayRows(entries, {
    platform: opts.platform,
    accountDisplayNames,
    groupBy: byApp ? 'app' : 'account',
    now,
  });
  const platformCount = opts.platform ? 1 : 2;
  const subjectHeader = byApp ? 'APP' : 'ACCOUNT';
  const subjectCount = `${groupCount} ${byApp ? 'app(s)' : 'account(s)'}`;

  console.log(
    renderTable([subjectHeader, 'PERIOD', 'PLATFORM', ...statsBuildsHeaders()], displayRows)
  );
  const metricsNote =
    metricsMissingCount > 0
      ? ` ${metricsMissingCount} counted build(s) had no build-time metrics and were excluded from BUILD MIN.`
      : '';

  console.log(
    dim(
      `\n  ${displayRows.length} row(s) across ${subjectCount}, ${months.length} month(s), ${platformCount} platform(s) each. ` +
        'SUCCESS/ERRORED/CANCELED = counted client-side from build history via the API; ' +
        'may differ from EAS billing usage. TOTAL = SUCCESS + ERRORED + CANCELED for that row. ' +
        'A still in-progress/queued build is counted in none of the three (nor in TOTAL). ' +
        'BUILD MIN = summed actual build time (minutes) for that same TOTAL set, excluding EAS queue wait.' +
        metricsNote +
        ' PERIOD = UTC calendar month.'
    )
  );
}

import { dim, renderTable } from '../../shared/terminal/render.mjs';
import { dateColumnHeader, toDisplayRows } from './format.mjs';
import { fetchListEntries } from './service.mjs';

export async function runList(client, accounts, opts, accountDisplayNames) {
  const filtered = await fetchListEntries(client, accounts, opts);

  if (filtered.length === 0) {
    console.log('No apps found.');
    return;
  }

  console.log(
    renderTable(
      [
        'ACCOUNT',
        'APP',
        'PLATFORM',
        'VERSION',
        'SDK',
        'CLI',
        dateColumnHeader('BUILD', opts.local),
        dateColumnHeader('SUBMIT', opts.local),
        dateColumnHeader('UPDATE', opts.local),
      ],
      toDisplayRows(filtered, { accountDisplayNames, local: opts.local })
    )
  );
  // `--history 1` must read identically to passing no flag at all — same
  // query, same rows — so the footer keys off the effective count.
  const effectiveHistory = opts.history ?? 1;
  const buildNote =
    effectiveHistory > 1
      ? `VERSION/BUILD = latest ${effectiveHistory} EAS build(s) per platform, newest first, regardless of status.`
      : 'VERSION/BUILD = latest EAS build attempt, regardless of status.';
  const shipNote =
    "SUBMIT = that build's own submission. UPDATE = latest update published to that build's runtime.";
  console.log(dim(`\n  ${filtered.length} row(s). ${buildNote} ${shipNote}`));
}

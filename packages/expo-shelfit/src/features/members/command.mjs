import { dim, red, renderTable } from '../../shared/terminal/render.mjs';
import { membersConcurrencyHeader, toMembersDisplayRows } from './format.mjs';
import { fetchMembersEntries } from './service.mjs';

export async function runMembers(client, accounts, opts, accountDisplayNames) {
  const { entries, warnings } = await fetchMembersEntries(client, accounts);

  for (const warning of warnings) {
    console.error(red(`  ! members unavailable — ${warning}`));
  }

  console.log(
    renderTable(
      [
        'ORG',
        'MEMBER',
        'ROLE',
        'PLAN',
        'PLAN ID',
        'STATUS',
        membersConcurrencyHeader(opts.platform),
        'TRIAL END',
      ],
      toMembersDisplayRows(entries, { platform: opts.platform, accountDisplayNames })
    )
  );
  console.log(
    dim(
      `\n  ${entries.length} row(s). ORG/MEMBER/ROLE = organization members and their role ` +
        '(ORG is "-" for a personal account, one row per sign-up). ' +
        'PLAN/STATUS/CONCURRENCY = current subscription (as of now).'
    )
  );
}

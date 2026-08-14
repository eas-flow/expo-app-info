// Converts runMembers's raw "entries" into human-oriented table rows. There
// is no machine-readable output mode; the table is the only supported
// output and carries no compatibility guarantee.

import { cellOrDash } from '../../shared/cells.mjs';
import { isoDate } from '../../shared/dates.mjs';

/**
 * One row per (account, member) — personal accounts contribute exactly one
 * row with ORG "-". `e.isPersonal` is `true`/`false`/`null` (degraded, fetch
 * failed): only `true` blanks ORG, so a degraded row still shows which
 * account it belongs to, same as the old --plan's ACCOUNT column on
 * failure.
 */
export function toMembersDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map() } = {}
) {
  return entries.map((e) => [
    e.isPersonal ? '-' : (accountDisplayNames.get(e.account) ?? e.account),
    e.member ?? '-',
    e.role ?? '-',
    e.plan ?? '-',
    e.planId ?? '-',
    e.status ?? '-',
    membersConcurrencyCell(e, platform),
    e.trialEnd ? isoDate(e.trialEnd) : '-',
  ]);
}

function membersConcurrencyCell(entry, platform) {
  const { concurrencyTotal, concurrencyIos, concurrencyAndroid } = entry;
  if (platform === 'ios') return cellOrDash(concurrencyIos);
  if (platform === 'android') return cellOrDash(concurrencyAndroid);
  if (cellOrDash(concurrencyTotal) === '-') return '-';
  return `${concurrencyTotal} / ${concurrencyIos} / ${concurrencyAndroid}`;
}

export function membersConcurrencyHeader(platform = null) {
  if (platform === 'ios') return 'CONCURRENCY (IOS)';
  if (platform === 'android') return 'CONCURRENCY (ANDROID)';
  return 'CONCURRENCY (TOTAL/IOS/AND)';
}

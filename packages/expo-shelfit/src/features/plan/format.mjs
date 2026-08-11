// Converts runPlan's raw "entries" into human-oriented table rows. There is
// no machine-readable output mode; the table is the only supported output
// and carries no compatibility guarantee.

import { cellOrDash } from '../../shared/cells.mjs';
import { isoDate } from '../../shared/dates.mjs';

export function toPlanDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map() } = {}
) {
  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.plan ?? '-',
    e.planId ?? '-',
    e.status ?? '-',
    planConcurrencyCell(e, platform),
    e.trialEnd ? isoDate(e.trialEnd) : '-',
  ]);
}

function planConcurrencyCell(entry, platform) {
  const { concurrencyTotal, concurrencyIos, concurrencyAndroid } = entry;
  if (platform === 'ios') return cellOrDash(concurrencyIos);
  if (platform === 'android') return cellOrDash(concurrencyAndroid);
  if (cellOrDash(concurrencyTotal) === '-') return '-';
  return `${concurrencyTotal} / ${concurrencyIos} / ${concurrencyAndroid}`;
}

export function planConcurrencyHeader(platform = null) {
  if (platform === 'ios') return 'CONCURRENCY (IOS)';
  if (platform === 'android') return 'CONCURRENCY (ANDROID)';
  return 'CONCURRENCY (TOTAL/IOS/AND)';
}

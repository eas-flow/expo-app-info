// Converts runList's raw "entries" into human-oriented table rows. There is
// no machine-readable output mode; the table is the only supported output
// and carries no compatibility guarantee.

import { formatBuildDate, localOffset } from '../../shared/dates.mjs';

/**
 * `accountDisplayNames` (account slug -> EAS "Display name") is a cosmetic,
 * table-only lookup: when it has an entry for a row's account, the table
 * shows that instead of the slug.
 */
export function toDisplayRows(entries, { accountDisplayNames = new Map(), local = false } = {}) {
  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.app,
    e.slug,
    e.platform ?? '-',
    e.version ?? '-',
    e.build ?? '-',
    e.sdk ?? '-',
    e.cli ?? '-',
    statusLabel(e.status),
    formatBuildDate(e.lastBuildAt, { local }),
  ]);
}

// Only these 3 have been confirmed against the real API. Anything else —
// most likely a still in-progress/queued build whose enum name was never
// observed — falls back to the raw value lowercased rather than being
// guessed at, so an unrecognized status still shows something instead of
// breaking or disappearing.
const STATUS_LABELS = { FINISHED: 'Finished', ERRORED: 'Errored', CANCELED: 'Canceled' };

function statusLabel(status) {
  if (!status) return '-';
  return STATUS_LABELS[status] ?? status.toLowerCase();
}

/**
 * "BUILD DATE (+09:00)" with --local, so the column is self-describing
 * without a separate legend. See shared/dates.mjs#localOffset for why the
 * offset is "as of now", not per row.
 */
export function buildDateHeader(local = false) {
  return local ? `BUILD DATE (${localOffset()})` : 'BUILD DATE';
}

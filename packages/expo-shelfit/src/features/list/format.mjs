// Converts runList's raw "entries" into human-oriented table rows. There is
// no machine-readable output mode; the table is the only supported output
// and carries no compatibility guarantee.

import { labelDateCell, versionCell } from '../../shared/cells.mjs';
import { localOffset } from '../../shared/dates.mjs';

/**
 * `accountDisplayNames` (account slug -> EAS "Display name") is a cosmetic,
 * table-only lookup: when it has an entry for a row's account, the table
 * shows that instead of the slug.
 */
export function toDisplayRows(entries, { accountDisplayNames = new Map(), local = false } = {}) {
  return entries.map((e) => [
    accountDisplayNames.get(e.account) ?? e.account,
    e.app,
    e.platform ?? '-',
    versionCell(e.version, e.build),
    e.sdk ?? '-',
    e.cli ?? '-',
    labelDateCell(buildStatusLabel(e.status), e.lastBuildAt, { local }),
    labelDateCell(submissionStatusLabel(e.submissionStatus), e.submissionCreatedAt, { local }),
    labelDateCell(e.updateBranch, e.updateCreatedAt, { local }),
  ]);
}

// Only these 3 have been confirmed against the real API. Anything else —
// most likely a still in-progress/queued build whose enum name was never
// observed — falls back to the raw value lowercased rather than being
// guessed at, so an unrecognized status still shows something instead of
// breaking or disappearing.
const BUILD_STATUS_LABELS = { FINISHED: 'Finished', ERRORED: 'Errored', CANCELED: 'Canceled' };

function buildStatusLabel(status) {
  if (!status) return null;
  return BUILD_STATUS_LABELS[status] ?? status.toLowerCase();
}

// Only these 2 have been confirmed against the real API (see the
// SubmissionStatus values observed while building the SUBMIT column);
// anything else falls back the same way BUILD_STATUS_LABELS does.
const SUBMISSION_STATUS_LABELS = { FINISHED: 'Finished', IN_QUEUE: 'In queue' };

function submissionStatusLabel(status) {
  if (!status) return null;
  return SUBMISSION_STATUS_LABELS[status] ?? status.toLowerCase();
}

/**
 * "BUILD (+09:00)" with --local — same suffix on SUBMIT/UPDATE — so each
 * column is self-describing without a separate legend. See
 * shared/dates.mjs#localOffset for why the offset is "as of now", not per row.
 */
export function dateColumnHeader(name, local = false) {
  return local ? `${name} (${localOffset()})` : name;
}

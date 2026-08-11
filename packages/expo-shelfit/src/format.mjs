// Converts the raw "entries" produced by the display-mode flows in
// src/commands/ into human-oriented table rows. There is no machine-readable
// output mode; the table is the only supported output and carries no
// compatibility guarantee.

import { formatBuildDate, inclusiveEnd, isoDate, localOffset } from './dates.mjs';

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
    statusLabel(e.status),
    formatBuildDate(e.lastBuildAt, { local }),
  ]);
}

// Only these 3 have been confirmed against the real API
// (scripts/probe-build-status.mjs). Anything else — most likely a still
// in-progress/queued build whose enum name was never observed — falls back to
// the raw value lowercased rather than being guessed at, so an unrecognized
// status still shows something instead of breaking or disappearing.
const STATUS_LABELS = { FINISHED: 'Finished', ERRORED: 'Errored', CANCELED: 'Canceled' };

function statusLabel(status) {
  if (!status) return '-';
  return STATUS_LABELS[status] ?? status.toLowerCase();
}

/**
 * "BUILD DATE (+09:00)" with --local, so the column is self-describing
 * without a separate legend. See src/dates.mjs#localOffset for why the offset
 * is "as of now", not per row.
 */
export function buildDateHeader(local = false) {
  return local ? `BUILD DATE (${localOffset()})` : 'BUILD DATE';
}

function statsPlatforms(platform) {
  if (platform === 'ios') return ['ios'];
  if (platform === 'android') return ['android'];
  return ['ios', 'android'];
}

/**
 * One row per subject per UTC calendar month *per platform* —
 * `[subject, period, platform, success, errored, canceled, total]`. PLATFORM
 * being its own column is why `--platform` narrows *rows* here, not columns.
 *
 * `groupBy` (`--group-by`) picks what the subject cell holds: the account
 * (default) or the app. Both fall back to their unique identifier when the
 * display name is missing.
 *
 * `e.ios`/`e.android` are each either `null` — that platform's counts
 * couldn't be fetched, degrading every cell on its row, TOTAL included, to
 * "-" — or `{ success, errored, canceled }`. TOTAL sums exactly those three,
 * so a build EAS reports in some non-terminal status is counted nowhere.
 */
export function toStatsDisplayRows(
  entries,
  { platform = null, accountDisplayNames = new Map(), groupBy = 'account', now = new Date() } = {}
) {
  const platforms = statsPlatforms(platform);
  const rows = [];

  for (const e of entries) {
    const subjectCell =
      groupBy === 'app' ? e.app || e.appSlug : (accountDisplayNames.get(e.account) ?? e.account);
    const periodText = periodCell(e, now);
    for (const p of platforms) {
      const counts = e[p];
      const total = counts ? counts.success + counts.errored + counts.canceled : null;
      rows.push([
        subjectCell,
        periodText,
        p,
        cellOrDash(counts?.success),
        cellOrDash(counts?.errored),
        cellOrDash(counts?.canceled),
        cellOrDash(total),
      ]);
    }
  }

  return rows;
}

function cellOrDash(value) {
  return value === null || value === undefined ? '-' : String(value);
}

/**
 * `START → END`, where END is `(today)` for the current month so it doesn't
 * read like a confirmed final count for a month that hasn't finished, and the
 * inclusive last day otherwise (`periodEnd` is an exclusive boundary).
 */
function periodCell(entry, now) {
  if (!entry.periodStart || !entry.periodEnd) return '-';
  const startMs = new Date(entry.periodStart).getTime();
  const endMs = new Date(entry.periodEnd).getTime();
  const nowMs = now.getTime();
  const isCurrent = nowMs >= startMs && nowMs < endMs;
  const end = isCurrent ? '(today)' : isoDate(inclusiveEnd(entry.periodEnd));
  return `${isoDate(entry.periodStart)} → ${end}`;
}

/** Always these 4, since PLATFORM is its own column rather than a per-column suffix. */
export function statsBuildsHeaders() {
  return ['SUCCESS', 'ERRORED', 'CANCELED', 'TOTAL'];
}

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

import { formatBuildDate } from './dates.mjs';

export function cellOrDash(value) {
  return value === null || value === undefined ? '-' : String(value);
}

/** "3.2.2 (42)" when both are present; just the version with no build number; "-" with no version at all. */
export function versionCell(version, build) {
  if (!version) return '-';
  return build ? `${version} (${build})` : version;
}

/**
 * "<label> <date>" (e.g. "Finished 2026-08-09"), or "-" when there's nothing
 * to show — shared by the list feature's BUILD/SUBMIT/UPDATE columns, whose
 * cells are all a status-or-branch label plus the date it happened.
 */
export function labelDateCell(label, iso, { local = false } = {}) {
  if (!label) return '-';
  return `${label} ${formatBuildDate(iso, { local, time: false })}`;
}

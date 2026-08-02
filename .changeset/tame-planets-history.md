---
'expo-app-info': minor
---

Add `--history <N>` (1–100), which prints the `N` most recent successful
builds per platform as separate rows, newest first, instead of collapsing
each app/platform down to a single latest-build row. Rows are sorted by
`createdAt` on the client rather than trusted from the API's response
order, which is undocumented.

The `LAST BUILD` table column is renamed to `BUILD DATE` (cosmetic —
human table only, not covered by the `--json`/`--csv` compatibility
guarantee, and the `lastBuildAt` field name is unchanged) since a row is
not necessarily the "last" build once `--history` shows more than one.

`--history` cannot be combined with `--usage`. `--history 1` produces
output identical to omitting the flag.

The human table's build date column now shows an absolute UTC timestamp
(`YYYY/MM/DD-HH:mm:ss`) instead of a relative "3d ago" style string, so the
exact build time is visible without doing the math. Cosmetic only —
`--json`/`--csv` still emit the raw ISO 8601 `lastBuildAt` value.

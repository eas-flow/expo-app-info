---
"expo-app-info": minor
---

Add `--json` and `--csv` output, and `--account` / `--platform` filters.

`--json` and `--csv` emit raw entries (one per table row) with `null`/empty
instead of `-`, and a full ISO 8601 `lastBuildAt` timestamp instead of a
relative date. See the README's "Output stability" section for the
compatibility policy on these formats going forward.

---
'expo-app-info': major
---

`--usage` now prints one row per account **per UTC calendar month** — the
last 3 months by default, or the last `--month <n>` (1-12) — instead of one
row for the current EAS billing period. Build counts (`SUCCESSFUL BUILDS
(IOS)` / `(AND)`, `buildsIos`/`buildsAndroid` in `--json`/`--csv`) are now
counted client-side from finished builds via the API rather than read from
EAS's own billing/usage metric, since that metric is tied to the billing
cycle and can't be sliced into arbitrary calendar ranges. They may not
exactly match what the EAS dashboard reports.

This is a breaking change even though most field names are unchanged:

- The default row count per account goes from 1 to 3.
- `periodStart`/`periodEnd` now mean UTC calendar-month boundaries instead
  of the EAS billing period.
- `buildsIos`/`buildsAndroid` now mean a client-side successful-build count
  instead of EAS's own billing metric.
- The `plan`, `planId`, `status`, `concurrencyTotal`, `concurrencyIos`, and
  `concurrencyAndroid` fields are removed — that "current" subscription
  information moved to `--plan` ([#19](https://github.com/eas-flow/expo-app-info/issues/19)) ahead of this release, since it doesn't
  make sense repeated identically across every month's row.

The still-in-progress current month's row shows `(today)` as its end in the
human table; `--json`/`--csv` `periodStart`/`periodEnd` are always the raw
UTC calendar-month boundaries (`periodEnd` exclusive — the instant the next
month starts).

The only failure mode left is an app-list/build-fetch error for a given
account (subscription/billing queries are no longer used by `--usage` at
all): that account's rows degrade to `-` (`null` in `--json`/`--csv`) across
every month rather than failing the run, same as before.

`--usage` and `--month` are fetched with an account-level `mapWithConcurrency`
(concurrency limit of 8) rather than a sequential loop, since calendar-month
boundaries have no inter-period dependency, unlike the old billing-period
chaining.

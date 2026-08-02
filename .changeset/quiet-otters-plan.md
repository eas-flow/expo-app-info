---
'expo-app-info': minor
---

Add `--plan`, which prints one row per account — plan name, plan ID,
subscription status, build concurrency (total/ios/android), and trial end —
instead of the app list. This is the *current* subscription only: no build
counts and no billing period, unlike `--usage`. It exists so that
information can move here ahead of `--usage` dropping its own PLAN/STATUS/
CONCURRENCY columns in favor of calendar-month build history ([#18](https://github.com/eas-flow/expo-app-info/issues/18)).

Plan data is billing-scoped, so an account the token cannot read billing
for still prints a row with `-` and reports the reason on stderr rather
than failing the run — same as `--usage`. Accounts are fetched in parallel
(concurrency limit of 8), unlike `--usage`'s sequential loop, since each
account's subscription lookup doesn't depend on any other account's.

`--plan` cannot be combined with `--usage` or `--history`.

No monthly price column yet — not confirmed to exist in the (unofficial,
unversioned) EAS schema; may be added later once checked against a real
token.

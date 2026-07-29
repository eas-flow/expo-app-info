---
'expo-app-info': minor
---

Add `--usage`, which prints one row per account — subscription plan, status,
build concurrency and the current EAS billing period — instead of the app list.
Plan data is billing-scoped, so an account the token cannot read billing for
still prints a row with `-` and reports the reason on stderr rather than
failing the run.

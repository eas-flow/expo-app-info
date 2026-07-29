---
'expo-app-info': minor
---

Add `--usage`, which prints one row per account — subscription plan, status,
build concurrency, and build counts per platform for the current EAS billing
period — instead of the app list. Plan/usage data is billing-scoped, so an
account the token cannot read billing for still prints a row with `-` and
reports the reason on stderr rather than failing the run.

Also fixes `api.mjs`'s GraphQL client so a non-2xx response with a normal
`{ errors: [...] }` body (which this API returns for query validation errors,
not just transport failures) surfaces the real message instead of a bare
`HTTP 400`.

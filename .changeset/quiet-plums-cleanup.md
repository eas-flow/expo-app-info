---
'expo-app-info': patch
---

Internal cleanup, no behavior change: removed the dead `relativeDate()`
helper in `src/render.mjs` (unused since the `BUILD DATE` column switched to
an absolute UTC timestamp, issue #17 follow-up) along with its tests, and
un-exported the GraphQL query constants (`Q_ACCOUNTS`, `Q_APPS`, `Q_BUILDS`,
`Q_BUILDS_PAGE`, `Q_SUBSCRIPTION`) in `src/api.mjs` since nothing outside
that module imports them.

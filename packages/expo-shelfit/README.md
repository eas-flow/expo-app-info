# expo-shelfit

English | [日本語](./README.ja.md)

[![npm version](https://img.shields.io/npm/v/@my-shelfio/expo-shelfit.svg)](https://www.npmjs.com/package/@my-shelfio/expo-shelfit)
[![license](https://img.shields.io/npm/l/@my-shelfio/expo-shelfit.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@my-shelfio/expo-shelfit.svg)](https://nodejs.org)

> List every Expo (EAS) app in your account — with its latest build version per platform — from **any** directory.

> **Unofficial.** Not affiliated with or endorsed by Expo. The name is a nod to lining up every app you've shipped on one shelf.

```
$ npx @my-shelfio/expo-shelfit

┌─────────┬────────────┬──────────┬────────────┬────────┬────────┬─────────────────────┬─────────────────────┬───────────────────────┐
│ ACCOUNT │ APP        │ PLATFORM │ VERSION    │ SDK    │ CLI    │ BUILD               │ SUBMIT              │ UPDATE                │
├─────────┼────────────┼──────────┼────────────┼────────┼────────┼─────────────────────┼─────────────────────┼───────────────────────┤
│ myorg   │ storefront │ ios      │ 3.2.2 (42) │ 54.0.0 │ 18.0.4 │ Errored 2026-08-10  │ Finished 2026-08-09 │ production 2026-08-12 │
│ myorg   │ storefront │ android  │ 3.2.0 (38) │ 53.0.0 │ 17.0.0 │ Finished 2026-06-30 │ In queue 2026-06-30 │ production 2026-08-12 │
│ myorg   │ prototype  │ -        │ -          │ -      │ -      │ -                   │ -                   │ -                     │
└─────────┴────────────┴──────────┴────────────┴────────┴────────┴─────────────────────┴─────────────────────┴───────────────────────┘
```

## Install & Authentication

### 📦 Install

```bash
# using npx
npx @my-shelfio/expo-shelfit

# No install required. If you prefer:
npm install -g @my-shelfio/expo-shelfit
expo-shelfit
```

Requires Node.js **22 or later** (the CLI uses the global `fetch`).

### 🔑 Authentication

A personal access token in the **`EXPO_TOKEN`** environment variable — that is the only supported credential.

```bash
export EXPO_TOKEN=xxxxxxxx
npx @my-shelfio/expo-shelfit
```

Create one at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

This is deliberately the only option. The token is never read from `argv`, never written to disk, and never printed — so it cannot leak through your shell history, the process list, a forgotten config file, or the CLI's own output. It is sent to exactly one destination, the EAS GraphQL endpoint (`https://api.expo.dev/graphql`), over HTTPS, in an `Authorization` header. If `EXPO_TOKEN` is missing the CLI exits with a non-zero status — it never blocks on a prompt, which keeps it safe to run in CI.

> **`EXPO_API_URL`** can override that endpoint. It exists for local testing, is intentionally undocumented beyond this note, and is not covered by any compatibility guarantee. Do not point it at an untrusted host — doing so sends your token there.

See [SECURITY.md](../../.github/SECURITY.md) to report a vulnerability privately.

## 🛠️ Usage

```bash
# Help / version
npx @my-shelfio/expo-shelfit --help
npx @my-shelfio/expo-shelfit --version

# Narrow the list
npx @my-shelfio/expo-shelfit --platform ios
npx @my-shelfio/expo-shelfit --account myorg
npx @my-shelfio/expo-shelfit --app storefront

# Local calendar day for BUILD/SUBMIT/UPDATE dates
npx @my-shelfio/expo-shelfit --local

# Build history
npx @my-shelfio/expo-shelfit --history 5

# Monthly stats
npx @my-shelfio/expo-shelfit --stats
npx @my-shelfio/expo-shelfit --stats --group-by app --month 1

# Account and member info
npx @my-shelfio/expo-shelfit --members
```

```
$ npx @my-shelfio/expo-shelfit --stats

┌──────────┬──────────────────────┬──────────┬─────────┬─────────┬──────────┬───────┬───────────────┐
│ ACCOUNT  │ PERIOD               │ PLATFORM │ SUCCESS │ ERRORED │ CANCELED │ TOTAL │ BUILD MINUTES │
├──────────┼──────────────────────┼──────────┼─────────┼─────────┼──────────┼───────┼───────────────┤
│ itokohei │ 2026-07-01 → (today) │ ios      │ 1       │ 1       │ 0        │ 2     │ 6.9           │
│ itokohei │ 2026-07-01 → (today) │ android  │ 2       │ 0       │ 0        │ 2     │ 9.4           │
└──────────┴──────────────────────┴──────────┴─────────┴─────────┴──────────┴───────┴───────────────┘
```

```
$ npx @my-shelfio/expo-shelfit --members

┌──────────┬───────────┬───────────┬──────┬─────────┬────────┬─────────────────────────────┬───────────┐
│ ORG      │ MEMBER    │ ROLE      │ PLAN │ PLAN ID │ STATUS │ CONCURRENCY (TOTAL/IOS/AND) │ TRIAL END │
├──────────┼───────────┼───────────┼──────┼─────────┼────────┼─────────────────────────────┼───────────┤
│ itokohei │ it0       │ OWNER     │ Free │ free    │ -      │ -                           │ -         │
│ itokohei │ kohei-dev │ DEVELOPER │ Free │ free    │ -      │ -                           │ -         │
│ -        │ it0       │ OWNER     │ Free │ free    │ -      │ -                           │ -         │
└──────────┴───────────┴───────────┴──────┴─────────┴────────┴─────────────────────────────┴───────────┘
```

#### Deprecated

`--usage` is a deprecated alias for `--stats`, and `--plan` is a deprecated alias for `--members`. Both still work and print the identical table, but write a deprecation warning to stderr and will be removed in the next major version.

## 🚀 Features

- **See your shipping status at a glance, from any directory** — the default: every Expo (EAS) app tied to your account, one row per app × platform, with its version, Expo SDK/eas-cli version, latest **BUILD** result, latest **SUBMIT** (store submission) result, and latest **UPDATE** (OTA) — no more tabbing between expo.dev's Builds/Submissions/Updates tabs
- **Check past build results** — `--history <N>` shows the `N` most recent build attempts per platform, not just the latest (SUBMIT/UPDATE stay the platform's current values on every row, since they aren't per-build-attempt facts)
- **Track build results and time by month** — `--stats` aggregates success/errored/canceled build counts and total build time (`BUILD MINUTES`, queue wait excluded) per UTC calendar month (`--group-by app` to count per app, `--month <n>` to widen the window)
- **See your accounts, their members, and your subscription** — `--members` shows one row per organization member (with their `ROLE`) plus the current subscription (plan, plan ID, status, concurrency, trial end); a personal account gets one row with `ORG` as `-`

## 📚 Documentation

### How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see (including each account's `displayName`, used only for the table's `ACCOUNT` column)
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...)`, in one request per app: `builds(offset: 0, limit: $limit, filter: { platform })` for the `N` most recent build attempts per platform, whatever their status (`limit` is 1 unless `--history` is set, and includes each build's `sdkVersion`/`cliVersion` for the `SDK`/`CLI` columns), plus `submissions(offset: 0, limit: 1, filter: { platform })` and `updateGroups(offset: 0, limit: 1, filter: { platform })` for that platform's single latest submission and update — all three are aliased per platform in the same query, so this adds no extra request. Every response is sorted by `createdAt` descending on the client, since the API's ordering is undocumented

SUBMIT/UPDATE describe a platform's *current* shipped state, not a specific build attempt — with `--history`, every row for a platform shows the same SUBMIT/UPDATE value, not one per build.

`--stats` reuses Steps 1–2 and, instead of Step 3, paginates the builds for each app and aggregates the data on the client side, including each build's `metrics.buildDuration` for the `BUILD MINUTES` column (queue wait is deliberately excluded — see the FAQ).

`--members` skips Steps 2–3 and queries only `account.byId(...) { subscription ownerUserActor memberStats membersPaginated }` per account, in parallel — one query per account regardless of member count, paginating further only for an organization with more members than one page holds. `ownerUserActor` is non-null exactly for personal accounts (confirmed against the real API); a personal account contributes one row (`ORG` "-"), an organization contributes one row per member from `membersPaginated`.

### Learn More

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, test/lint commands, project layout, and the release process
- [SECURITY.md](../../.github/SECURITY.md) — vulnerability reporting policy and how to report an issue privately

## ❓ FAQ

**Is this an official Expo tool?**

No. The EAS GraphQL API is **not officially documented or versioned**. Field names were derived from Expo's own open-source clients ([`eas-cli`](https://github.com/expo/eas-cli), [`orbit`](https://github.com/expo/orbit)) and may change without notice. This project is not affiliated with or endorsed by Expo.

**Can I use a robot token instead of a personal access token?**

A robot token can only see the account that issued it. Use a personal access token to list every account you belong to.

**What happens if a token can't read an account's apps or builds?**

`--stats` no longer queries billing-scoped fields at all — build counts are computed client-side from each app's build history. If fetching an account's apps or builds fails for any reason, that account's rows still print with `-` and the reason goes to stderr — the run does not fail.

**Why do some rows show `-` in the `--members` plan columns?**

Plan data is billing-scoped. If the token lacks billing or membership permission on an account, that account degrades to one row (`ORG` still shows the account name, since a failure happens before this CLI can tell whether it's personal or organizational) with `-` in the remaining columns, and the reason goes to stderr, rather than failing the run.

**Why is `ORG` sometimes `-` under `--members`?**

EAS creates a personal account for every sign-up, and it has no organization — `Account.ownerUserActor` is non-null exactly for these. Rather than filtering personal accounts out (which would leave an empty table for anyone with no organizations), `--members` keeps one row per personal account with `ORG` as `-` and `MEMBER`/`ROLE` set to the owner. The same person can therefore appear twice — once as an organization's member, once as their personal account's owner — since each row's `PLAN` columns describe a different billing subject.

**Why does a robot member show `(robot)` in `MEMBER`?**

A robot (e.g. a CI bot) has no `username` — only human members do — so it's identified by its `firstName` instead, marked `(robot)` so it isn't mistaken for a human name. This avoids a separate `TYPE` column for what's otherwise a rare case.

**What happened to the `SLUG` column?**

It was removed and the `APP` column now shows the slug instead of the Display name, to make room for `SUBMIT`/`UPDATE` without widening the table further. `--app` still matches either the slug or the Display name, unchanged.

**What if `BUILD` shows a status other than `Finished`/`Errored`/`Canceled`?**

Those three are the only EAS build statuses confirmed against the real API so far. A still in-progress or queued build — or any other status this unofficial API introduces later — shows the raw enum value lowercased instead of a friendly label, rather than breaking or hiding the row. `SUBMIT` follows the same fallback with its own two confirmed statuses, `Finished`/`In queue`.

**Why does `--local` affect all three of `BUILD`/`SUBMIT`/`UPDATE`?**

All three columns use the same date formatter, so `--local` shifts all three to the local calendar day together rather than just one — `--stats`' `PERIOD` and `--members`' `TRIAL END` are unaffected and stay UTC.

**Why does `BUILD MINUTES` exclude EAS queue wait time?**

Queue wait is driven by EAS's own congestion and your plan's concurrency limit, not by anything in your project — mixing it in would make a month-over-month change in `BUILD MINUTES` impossible to attribute to your own changes versus EAS being busy. `BUILD MINUTES` sums only `Build.metrics.buildDuration` (the actual build time) for the same FINISHED/ERRORED/CANCELED builds `TOTAL` counts; a counted build with no duration metric is excluded and reported as a count in the footer, rather than silently treated as zero minutes.

**Is the `EXPO_TOKEN` ever written to disk or logged?**

No. It is never read from `argv`, never written to disk, and never printed. See [SECURITY.md](../../.github/SECURITY.md) for the full policy and how to report a vulnerability privately.

## 📄 License

[MIT](./LICENSE)

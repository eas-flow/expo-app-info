# expo-shelfit

English | [日本語](./README.ja.md)

[![npm version](https://img.shields.io/npm/v/@my-shelfio/expo-shelfit.svg)](https://www.npmjs.com/package/@my-shelfio/expo-shelfit)
[![license](https://img.shields.io/npm/l/@my-shelfio/expo-shelfit.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@my-shelfio/expo-shelfit.svg)](https://nodejs.org)

> List every Expo (EAS) app in your account — with its latest build version per platform — from **any** directory.

> **Unofficial.** Not affiliated with or endorsed by Expo. The name is a nod to lining up every app you've shipped on one shelf.

```
$ npx @my-shelfio/expo-shelfit

┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬──────────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ STATUS   │ BUILD DATE          │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼──────────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.2   │ 42    │ Errored  │ 2026/08/10-11:02:47 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ Finished │ 2026/06/30-14:05:02 │
│ myorg   │ Field Ops  │ field-ops  │ ios      │ 1.4.0   │ 12    │ Finished │ 2026/05/28-18:40:11 │
│ myorg   │ Prototype  │ prototype  │ -        │ -       │ -     │ -        │ -                   │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴──────────┴─────────────────────┘
```

## 🚀 Features

If you ship more than one Expo app, there is no quick way to answer *"which app is on which version right now?"* — `eas build:list` only works **inside** a project directory and shows one project at a time, there is no `eas project:list`, and the Expo dashboard means clicking into every project one by one. `expo-shelfit` walks your whole account via the EAS GraphQL API and prints one table.

- Lists every Expo (EAS) app in your account, with its latest build **attempt** per platform — including errored and canceled ones, not just successful ones — from **any** directory
- `STATUS` column shows `Finished` / `Errored` / `Canceled` for that latest attempt, so a failing build is visible without opening the EAS dashboard
- `--platform` filter to narrow to `ios` or `android`
- `--account <slug|name>` / `--app <slug>` — narrow to a single account or app, across every display mode
- `--local` — show `BUILD DATE` in your local timezone instead of UTC
- `--history <N>` — show the `N` most recent build attempts per platform, not just the latest
- `--stats` — success/errored/canceled build counts per UTC calendar month (last 3 by default, `--month <n>` up to 12), computed client-side from build history
- `--plan` — current account subscription: plan, plan ID, status, concurrency, trial end
- `ACCOUNT` shows the EAS "Display name" when set, falling back to the unique slug
- Zero runtime dependencies

## 📦 Install

```bash
npx @my-shelfio/expo-shelfit
```

No install required. If you prefer:

```bash
npm install -g @my-shelfio/expo-shelfit
expo-shelfit
```

Requires Node.js **22 or later** (the CLI uses the global `fetch`).

## 🔑 Authentication

A personal access token in the **`EXPO_TOKEN`** environment variable — that is the only supported credential.

```bash
export EXPO_TOKEN=xxxxxxxx
npx @my-shelfio/expo-shelfit
```

Create one at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

This is deliberately the only option. The token is never read from `argv` and never written to disk, so it cannot leak through your shell history, the process list, or a forgotten config file. If `EXPO_TOKEN` is missing the CLI exits with a non-zero status — it never blocks on a prompt, which keeps it safe to run in CI.

## 🛠️ Usage

`-h` / `--help` prints the full option list, `-v` / `--version` prints the installed version.

```bash
npx @my-shelfio/expo-shelfit --help
npx @my-shelfio/expo-shelfit --version
```

Filter by platform:

```bash
npx @my-shelfio/expo-shelfit --platform ios
```

Narrow to one account or app — every display mode below respects these:

```bash
npx @my-shelfio/expo-shelfit --account myorg
npx @my-shelfio/expo-shelfit --app storefront
npx @my-shelfio/expo-shelfit --account myorg --app storefront --history 5
```

`--account <slug|name>` matches the account's unique slug or its EAS Display
name (case-insensitive exact match — no partial matching). If a Display name
matches more than one account, pass the slug instead. `--app <slug>` matches
an app's unique slug the same way, and is applied *before* fetching builds,
so it also speeds up the run — it cannot be combined with `--plan`, which
doesn't fetch apps at all. Neither flag matching anything exits 1 with a
"Did you mean" suggestion.

By default `BUILD DATE` is always UTC. Add `--local` to read it in your
machine's timezone instead:

```bash
npx @my-shelfio/expo-shelfit --local
```

```
┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬──────────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ STATUS   │ BUILD DATE (+09:00) │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼──────────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ Finished │ 2026/07/26-18:12:34 │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴──────────┴─────────────────────┘
```

`--local` only affects the `BUILD DATE` column — it respects the `TZ`
environment variable like any other Node process (e.g. `TZ=America/New_York
npx @my-shelfio/expo-shelfit --local`), and the column header shows the
current UTC offset rather than a timezone abbreviation, since offsets don't
require a lookup table to interpret. Every other date this CLI shows stays
UTC regardless — `--stats`'s `PERIOD` calendar-month boundaries and
`--plan`'s `TRIAL END` are unaffected, since shifting those would silently
move a build's build-count into the wrong month. For that reason `--local`
cannot be combined with `--stats` or `--plan`: neither has a `BUILD DATE`
column for it to affect.

Show more than just the latest build per platform:

```bash
npx @my-shelfio/expo-shelfit --history 5
```

```
┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬──────────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ STATUS   │ BUILD DATE          │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼──────────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ Finished │ 2026/07/26-09:12:34 │
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.0   │ 40    │ Finished │ 2026/06/30-14:05:02 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ Finished │ 2026/06/30-14:03:47 │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴──────────┴─────────────────────┘
```

`--history <N>` (1–100, default: 1) prints the `N` most recent build **attempts** per platform — whatever their status — as separate rows instead of collapsing each app/platform down to a single row. Rows are always newest-first by build date — sorted on the client, not just trusted from the API's response order, since that order isn't documented anywhere. It works with `--platform`, but cannot be combined with `--stats` or `--plan`. `--history 1` prints exactly the same output as leaving the flag off entirely.

Or ask about success/errored/canceled build counts per calendar month instead of app versions:

```bash
npx @my-shelfio/expo-shelfit --stats
```

```
┌─────────┬─────────────────────────┬──────────┬─────────┬─────────┬──────────┬───────┐
│ ACCOUNT │ PERIOD                  │ PLATFORM │ SUCCESS │ ERRORED │ CANCELED │ TOTAL │
├─────────┼─────────────────────────┼──────────┼─────────┼─────────┼──────────┼───────┤
│ myorg   │ 2026-08-01 → (today)    │ ios      │ 18      │ 3       │ 2        │ 23    │
│ myorg   │ 2026-08-01 → (today)    │ android  │ 16      │ 1       │ 0        │ 17    │
│ myorg   │ 2026-07-01 → 2026-07-31 │ ios      │ 14      │ 0       │ 1        │ 15    │
│ myorg   │ 2026-07-01 → 2026-07-31 │ android  │ 15      │ 2       │ 0        │ 17    │
│ myorg   │ 2026-06-01 → 2026-06-30 │ ios      │ 21      │ 1       │ 0        │ 22    │
│ myorg   │ 2026-06-01 → 2026-06-30 │ android  │ 20      │ 0       │ 1        │ 21    │
└─────────┴─────────────────────────┴──────────┴─────────┴─────────┴──────────┴───────┘
```

One row per account **per UTC calendar month, per platform** — the last 3 months by default, both `ios` and `android` unless `--platform` narrows to one. Pass `--month <n>` (1–12) to widen the window, e.g. `--stats --month 6` for the last half year. `SUCCESS`/`ERRORED`/`CANCELED` counts are computed client-side from every build in an app's history via the API — not read from EAS's own billing/usage metric, which is tied to the billing cycle and can't be sliced into arbitrary calendar ranges — so they may not exactly match what the EAS dashboard reports. `TOTAL` is `SUCCESS` + `ERRORED` + `CANCELED` for that row. A build that's still in progress or queued isn't counted into any of the three columns, nor into `TOTAL`, since it hasn't reached a terminal outcome yet. Pass `--platform ios` or `--platform android` to show only that platform's rows (half as many rows, same columns). The still-in-progress current month's rows show `(today)` as their end, since it isn't a finished count yet.

Or just the account's current subscription, with no build counts or billing
period at all:

```bash
npx @my-shelfio/expo-shelfit --plan
```

```
┌─────────┬────────────┬────────────┬────────┬─────────────────────────────┬───────────┐
│ ACCOUNT │ PLAN       │ PLAN ID    │ STATUS │ CONCURRENCY (TOTAL/IOS/AND) │ TRIAL END │
├─────────┼────────────┼────────────┼────────┼─────────────────────────────┼───────────┤
│ myorg   │ Production │ production │ active │ 2 / 1 / 1                   │ -         │
└─────────┴────────────┴────────────┴────────┴─────────────────────────────┴───────────┘
```

`--plan` shows only the account's *current* subscription — no build counts, no billing period — since those are "as of now" facts that would otherwise be repeated identically on every row if shown alongside historical data. Pass `--platform ios` or `--platform android` to narrow `CONCURRENCY` to just that platform's number. Cannot be combined with `--stats` or `--history`, since all three are separate display modes.

### What the numbers mean

| Column         | Source                                                        |
| -------------- | ------------------------------------------------------------- |
| `ACCOUNT`      | The account's EAS "Display name" if set, else its unique slug |
| `APP` / `SLUG` | EAS project name and slug                                     |
| `PLATFORM`     | `ios` / `android`                                             |
| `VERSION`      | `appVersion` of the latest build **attempt** (any status)     |
| `BUILD`        | `appBuildVersion` (iOS build number / Android versionCode)    |
| `STATUS`       | `Finished` / `Errored` / `Canceled` — any other status shows the raw value lowercased |
| `BUILD DATE`   | When that build attempt finished (`YYYY/MM/DD-HH:mm:ss`, UTC unless `--local`) |

With `--stats`, one row per account **per UTC calendar month, per platform** instead (last 3 months by default, or `--month <n>` for 1–12; both `ios` and `android` rows unless `--platform` narrows to one):

| Column      | Source                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT`   | Same as above — the account's EAS "Display name" if set, else its unique slug                                                                                               |
| `PERIOD`    | A UTC calendar month. Shows `(today)` as the end for the still-in-progress current month, else the last inclusive day (the underlying boundary, `periodEnd`, is exclusive). |
| `PLATFORM`  | `ios` / `android` — one row per platform per account per month                                                                                                              |
| `SUCCESS`   | Finished builds on that platform in that month, counted client-side from the build history via the API — not EAS's own billing/usage metric                               |
| `ERRORED`   | Same, for errored builds                                                                                                                                                     |
| `CANCELED`  | Same, for canceled builds                                                                                                                                                    |
| `TOTAL`     | `SUCCESS` + `ERRORED` + `CANCELED` for that row                                                                                                                              |

A build that's still in progress or queued isn't counted into any of the three categories, nor into `TOTAL`, since it hasn't reached a terminal outcome. Pass `--platform ios` or `--platform android` to show only that platform's rows (the column set stays the same).

With `--plan`, one row per account instead, with only the current subscription (no build counts or billing period):

| Column                        | Source                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `ACCOUNT`                     | Same as above                                                                               |
| `PLAN`                        | `subscription.name`                                                                         |
| `PLAN ID`                     | `subscription.planId`                                                                       |
| `STATUS`                      | Subscription status as Expo reports it (`active`, `trialing`, …)                            |
| `CONCURRENCY (TOTAL/IOS/AND)` | All three concurrency numbers at once; narrows to one with `--platform`                     |
| `TRIAL END`                   | `subscription.trialEnd` (`YYYY-MM-DD`), or `-` if the account isn't (or never was) trialing |

There is no monthly price column yet — it hasn't been confirmed to exist in the EAS schema. It may be added later once that's checked against a real token.

**`VERSION` is not read from your local `app.json`.** EAS does not store a version on the project itself, so the number shown is the one baked into the most recent build *attempt* — whatever its status. Apps that have never had any build attempt show `-`.

**`ACCOUNT` shows the "Display name" when set, falling back to the unique slug otherwise**, since the display name is friendlier to read and is not guaranteed to be unique.

### Filtering

- `--platform <ios|android>` — only builds for this platform. Apps with zero builds are omitted when this filter is set, since they don't match a specific platform. With `--stats`, it narrows to just that platform's rows (half as many rows, same columns); with `--plan`, it narrows `CONCURRENCY` to that platform's number instead of the account total.
- `--account <slug|name>` — only this account, matching the unique slug or EAS Display name (case-insensitive exact match). Applies to every display mode. No match exits 1 with a suggestion.
- `--app <slug>` — only this app, matching the unique slug (case-insensitive exact match), applied before builds are fetched. Applies to every display mode except `--plan` (account-only, never fetches apps — combining the two is a `CliError`). No match exits 1 with a suggestion.
- `--local` — show `BUILD DATE` in the local timezone instead of UTC. Only affects `BUILD DATE`; `--stats`'s `PERIOD` and `--plan`'s `TRIAL END` stay UTC. Cannot be combined with `--stats` or `--plan` (neither has a `BUILD DATE` column).
- `--month <n>` — only with `--stats`: widen the window to the last `n` calendar months (1–12, default 3).
- `--history <N>` — the `N` most recent build attempts per platform (1–100), whatever their status, newest first, instead of just the latest one. Cannot be combined with `--stats` or `--plan`.

`--stats`, `--plan`, and `--history` are mutually exclusive display modes — combining any two of them is a `CliError`.

### Deprecated

- `--usage` — the old name for `--stats`. It still works and prints the identical table, but writes a deprecation warning to stderr and will be removed in the next major version. It was renamed because it kept being read as EAS's *billing* usage, which this CLI deliberately never queries. Error messages echo whichever of the two names you actually typed.

## 📚 Documentation

### How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see (including each account's `displayName`, used only for the table's `ACCOUNT` column)
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(offset: 0, limit: $limit, filter: { platform })` — the `N` most recent build attempts per platform, whatever their status (`limit` is 1 unless `--history` is set); the response is sorted by `createdAt` descending on the client, since the API's own build order is undocumented

`filter` deliberately has no `status` key — confirmed against the real API (`scripts/probe-build-status.mjs`, issue #83) that omitting it returns builds in every status and that the field isn't required. Before #83 it was hardcoded to `status: FINISHED`, so a build that errored or was canceled was invisible; the `STATUS` column now surfaces it instead.

Build queries run with a concurrency limit of 8. Zero runtime dependencies.

`--stats` still walks accounts → apps (steps 1–2), but instead of step 3 it pages through `app.byId(...).builds(offset, limit, filter: { platform })` (same unfiltered-by-status shape) for each app and buckets every build by platform + UTC calendar month + status (success/errored/canceled) on the client (`countBuildsByMonth`). It no longer queries `subscription`, `billingPeriod`, or `usageMetrics` at all — those were tied to EAS's billing cycle and can't be sliced into arbitrary calendar ranges, and `metricsForServiceMetric`'s `filterParams` was found not to actually filter by platform (it silently returns the combined total regardless of what's passed). Accounts and apps are fetched as two flat passes — first every account's app list, then every (account, app) pair — rather than nesting one concurrency-limited pass inside another, which would deadlock against the shared semaphore. Both passes run under the same overall concurrency limit of 8, since UTC calendar-month boundaries have no inter-period dependency (unlike the old billing-period chaining, which needed the previous period's `start` before it could compute the next one).

`--plan` skips 2 and 3 entirely, and runs a smaller query per account: `account.byId(...) { subscription }` only — no `billingPeriod` or `usageMetrics`. Accounts are fetched in parallel (concurrency limit of 8, same as build queries), since each account's subscription lookup is independent of the others.

### Further reading

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, test/lint commands, project layout, and the release process
- [SECURITY.md](./SECURITY.md) — vulnerability reporting policy and how to report an issue privately
- [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — the Contributor Covenant this project follows

## ❓ FAQ

**Is this an official Expo tool?**

No. The EAS GraphQL API is **not officially documented or versioned**. Field names were derived from Expo's own open-source clients ([`eas-cli`](https://github.com/expo/eas-cli), [`orbit`](https://github.com/expo/orbit)) and may change without notice. This project is not affiliated with or endorsed by Expo.

**Can I use a robot token instead of a personal access token?**

A robot token can only see the account that issued it. Use a personal access token to list every account you belong to.

**What happens if a token can't read an account's apps or builds?**

`--stats` no longer queries billing-scoped fields at all — build counts are computed client-side from each app's build history. If fetching an account's apps or builds fails for any reason, that account's rows still print with `-` and the reason goes to stderr — the run does not fail.

**Why do some accounts show `-` in the `--plan` columns?**

Plan data is billing-scoped. If the token lacks billing permission on an account, that row still prints with `-` in the plan columns and the reason goes to stderr, rather than failing the run.

**Does `VERSION` come from my local `app.json`?**

No. EAS does not store a version on the project itself, so the number shown is the one baked into the most recent build attempt. Apps that have never had any build attempt show `-`.

**What if `STATUS` shows something other than `Finished`/`Errored`/`Canceled`?**

Those three are the only EAS build statuses confirmed against the real API so far (`scripts/probe-build-status.mjs`). A still in-progress or queued build — or any other status this unofficial API introduces later — shows the raw enum value lowercased instead of a friendly label, rather than breaking or hiding the row.

**Is the `EXPO_TOKEN` ever written to disk or logged?**

No. It is never read from `argv`, never written to disk, and never printed. See [SECURITY.md](./SECURITY.md) for the full policy and how to report a vulnerability privately.

## 📄 License

[MIT](./LICENSE)

# expo-shelfit

English | [日本語](./README.ja.md)

[![npm version](https://img.shields.io/npm/v/@my-shelfio/expo-shelfit.svg)](https://www.npmjs.com/package/@my-shelfio/expo-shelfit)
[![license](https://img.shields.io/npm/l/@my-shelfio/expo-shelfit.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@my-shelfio/expo-shelfit.svg)](https://nodejs.org)

> List every Expo (EAS) app in your account — with its latest build version per platform — from **any** directory.

> **Unofficial.** Not affiliated with or endorsed by Expo. The name is a nod to lining up every app you've shipped on one shelf.

```
$ npx @my-shelfio/expo-shelfit

┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ BUILD DATE          │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ 2026/07/26-09:12:34 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ 2026/06/30-14:05:02 │
│ myorg   │ Field Ops  │ field-ops  │ ios      │ 1.4.0   │ 12    │ 2026/05/28-18:40:11 │
│ myorg   │ Prototype  │ prototype  │ -        │ -       │ -     │ -                   │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴─────────────────────┘
```

## 🚀 Features

If you ship more than one Expo app, there is no quick way to answer *"which app is on which version right now?"* — `eas build:list` only works **inside** a project directory and shows one project at a time, there is no `eas project:list`, and the Expo dashboard means clicking into every project one by one. `expo-shelfit` walks your whole account via the EAS GraphQL API and prints one table.

- Lists every Expo (EAS) app in your account, with the latest **successful** build version per platform, from **any** directory
- `--platform` filter to narrow to `ios` or `android`
- `--account <slug|name>` / `--app <slug>` — narrow to a single account or app, across every display mode
- `--local` — show `BUILD DATE` in your local timezone instead of UTC
- `--history <N>` — show the `N` most recent builds per platform, not just the latest
- `--usage` — successful build counts per UTC calendar month (last 3 by default, `--month <n>` up to 12), computed client-side from build history
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
┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ BUILD DATE (+09:00) │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ 2026/07/26-18:12:34 │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴─────────────────────┘
```

`--local` only affects the `BUILD DATE` column — it respects the `TZ`
environment variable like any other Node process (e.g. `TZ=America/New_York
npx @my-shelfio/expo-shelfit --local`), and the column header shows the
current UTC offset rather than a timezone abbreviation, since offsets don't
require a lookup table to interpret. Every other date this CLI shows stays
UTC regardless — `--usage`'s `PERIOD` calendar-month boundaries and
`--plan`'s `TRIAL END` are unaffected, since shifting those would silently
move a build's build-count into the wrong month. For that reason `--local`
cannot be combined with `--usage` or `--plan`: neither has a `BUILD DATE`
column for it to affect.

Show more than just the latest build per platform:

```bash
npx @my-shelfio/expo-shelfit --history 5
```

```
┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ BUILD DATE          │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ 2026/07/26-09:12:34 │
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.0   │ 40    │ 2026/06/30-14:05:02 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ 2026/06/30-14:03:47 │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴─────────────────────┘
```

`--history <N>` (1–100, default: 1) prints the `N` most recent **successful** builds per platform as separate rows instead of collapsing each app/platform down to a single row. Rows are always newest-first by build date — sorted on the client, not just trusted from the API's response order, since that order isn't documented anywhere. It works with `--platform`, but cannot be combined with `--usage` or `--plan`. `--history 1` prints exactly the same output as leaving the flag off entirely.

Or ask about successful build counts per calendar month instead of app versions:

```bash
npx @my-shelfio/expo-shelfit --usage
```

```
┌─────────┬─────────────────────────┬─────────────────────────┬─────────────────────────┐
│ ACCOUNT │ PERIOD                  │ SUCCESSFUL BUILDS (IOS) │ SUCCESSFUL BUILDS (AND) │
├─────────┼─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ myorg   │ 2026-07-01 → (today)    │ 18                      │ 16                      │
│ myorg   │ 2026-06-01 → 2026-06-30 │ 14                      │ 15                      │
│ myorg   │ 2026-05-01 → 2026-05-31 │ 21                      │ 20                      │
└─────────┴─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

One row per account **per UTC calendar month** — the last 3 months by default. Pass `--month <n>` (1–12) to widen the window, e.g. `--usage --month 6` for the last half year. `SUCCESSFUL BUILDS` counts are computed client-side from finished builds via the API — not read from EAS's own billing/usage metric, which is tied to the billing cycle and can't be sliced into arbitrary calendar ranges — so they may not exactly match what the EAS dashboard reports. Pass `--platform ios` or `--platform android` to narrow to just that platform's column. The still-in-progress current month's row shows `(today)` as its end, since it isn't a finished count yet.

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

`--plan` shows only the account's *current* subscription — no build counts, no billing period — since those are "as of now" facts that would otherwise be repeated identically on every row if shown alongside historical data. Pass `--platform ios` or `--platform android` to narrow `CONCURRENCY` to just that platform's number. Cannot be combined with `--usage` or `--history`, since all three are separate display modes.

### What the numbers mean

| Column         | Source                                                        |
| -------------- | ------------------------------------------------------------- |
| `ACCOUNT`      | The account's EAS "Display name" if set, else its unique slug |
| `APP` / `SLUG` | EAS project name and slug                                     |
| `PLATFORM`     | `ios` / `android`                                             |
| `VERSION`      | `appVersion` of the latest **successful** build               |
| `BUILD`        | `appBuildVersion` (iOS build number / Android versionCode)    |
| `BUILD DATE`   | When that build finished (`YYYY/MM/DD-HH:mm:ss`, UTC unless `--local`) |

With `--usage`, one row per account **per UTC calendar month** instead (last 3 months by default, or `--month <n>` for 1–12):

| Column                    | Source                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT`                 | Same as above — the account's EAS "Display name" if set, else its unique slug                                                                                               |
| `PERIOD`                  | A UTC calendar month. Shows `(today)` as the end for the still-in-progress current month, else the last inclusive day (the underlying boundary, `periodEnd`, is exclusive). |
| `SUCCESSFUL BUILDS (IOS)` | Finished iOS builds in that month, counted client-side from the build history via the API — not EAS's own billing/usage metric                                              |
| `SUCCESSFUL BUILDS (AND)` | Same, for Android                                                                                                                                                           |

Pass `--platform ios` or `--platform android` to show only that platform's column.

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

**`VERSION` is not read from your local `app.json`.** EAS does not store a version on the project itself, so the number shown is the one baked into the most recent successful build. Apps that have never been built show `-`.

**`ACCOUNT` shows the "Display name" when set, falling back to the unique slug otherwise**, since the display name is friendlier to read and is not guaranteed to be unique.

### Filtering

- `--platform <ios|android>` — only builds for this platform. Apps with zero builds are omitted when this filter is set, since they don't match a specific platform. With `--usage`, it narrows to just that platform's `SUCCESSFUL BUILDS` column; with `--plan`, it narrows `CONCURRENCY` to that platform's number instead of the account total.
- `--account <slug|name>` — only this account, matching the unique slug or EAS Display name (case-insensitive exact match). Applies to every display mode. No match exits 1 with a suggestion.
- `--app <slug>` — only this app, matching the unique slug (case-insensitive exact match), applied before builds are fetched. Applies to every display mode except `--plan` (account-only, never fetches apps — combining the two is a `CliError`). No match exits 1 with a suggestion.
- `--local` — show `BUILD DATE` in the local timezone instead of UTC. Only affects `BUILD DATE`; `--usage`'s `PERIOD` and `--plan`'s `TRIAL END` stay UTC. Cannot be combined with `--usage` or `--plan` (neither has a `BUILD DATE` column).
- `--month <n>` — only with `--usage`: widen the window to the last `n` calendar months (1–12, default 3).
- `--history <N>` — the `N` most recent successful builds per platform (1–100), newest first, instead of just the latest one. Cannot be combined with `--usage` or `--plan`.

`--usage`, `--plan`, and `--history` are mutually exclusive display modes — combining any two of them is a `CliError`.

## 📚 Documentation

### How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see (including each account's `displayName`, used only for the table's `ACCOUNT` column)
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(offset: 0, limit: $limit, filter: { platform, status: FINISHED })` — the `N` most recent builds per platform (`limit` is 1 unless `--history` is set); the response is sorted by `createdAt` descending on the client, since the API's own build order is undocumented

Build queries run with a concurrency limit of 8. Zero runtime dependencies.

`--usage` still walks accounts → apps (steps 1–2), but instead of step 3 it pages through `app.byId(...).builds(offset, limit, filter: { status: FINISHED })` for each app and buckets every build by platform + UTC calendar month on the client (`countBuildsByMonth`). It no longer queries `subscription`, `billingPeriod`, or `usageMetrics` at all — those were tied to EAS's billing cycle and can't be sliced into arbitrary calendar ranges, and `metricsForServiceMetric`'s `filterParams` was found not to actually filter by platform (it silently returns the combined total regardless of what's passed). Accounts and apps are fetched as two flat passes — first every account's app list, then every (account, app) pair — rather than nesting one concurrency-limited pass inside another, which would deadlock against the shared semaphore. Both passes run under the same overall concurrency limit of 8, since UTC calendar-month boundaries have no inter-period dependency (unlike the old billing-period chaining, which needed the previous period's `start` before it could compute the next one).

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

`--usage` no longer queries billing-scoped fields at all — build counts are computed client-side from each app's build history. If fetching an account's apps or builds fails for any reason, that account's rows still print with `-` and the reason goes to stderr — the run does not fail.

**Why do some accounts show `-` in the `--plan` columns?**

Plan data is billing-scoped. If the token lacks billing permission on an account, that row still prints with `-` in the plan columns and the reason goes to stderr, rather than failing the run.

**Does `VERSION` come from my local `app.json`?**

No. EAS does not store a version on the project itself, so the number shown is the one baked into the most recent successful build. Apps that have never been built show `-`.

**Is the `EXPO_TOKEN` ever written to disk or logged?**

No. It is never read from `argv`, never written to disk, and never printed. See [SECURITY.md](./SECURITY.md) for the full policy and how to report a vulnerability privately.

## 📄 License

[MIT](./LICENSE)

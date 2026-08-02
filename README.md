# expo-app-info

[![npm version](https://img.shields.io/npm/v/expo-app-info.svg)](https://www.npmjs.com/package/expo-app-info)
[![license](https://img.shields.io/npm/l/expo-app-info.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/expo-app-info.svg)](https://nodejs.org)

> List every Expo (EAS) app in your account — with its latest build version per platform — from **any** directory.

> **Unofficial.** Not affiliated with or endorsed by Expo.

```
$ npx expo-app-info

┌─────────┐────────────┐───────────┐──────────┐─────────┐───────┐───────────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ BUILD DATE          │
├─────────┼────────────┼───────────┼──────────┼─────────┼───────┼───────────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ 2026/07/26-09:12:34 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ 2026/06/30-14:05:02 │
│ myorg   │ Field Ops  │ field-ops  │ ios      │ 1.4.0   │ 12    │ 2026/05/28-18:40:11 │
│ myorg   │ Prototype  │ prototype  │ -        │ -       │ -     │ -                   │
└─────────┘────────────┘───────────┘──────────┘─────────┘───────┘───────────────────────────┘
```

## Why

If you ship more than one Expo app, there is no quick way to answer *"which app is on which version right now?"*

- `eas build:list` only works **inside** a project directory, and shows one project at a time.
- There is no `eas project:list` command.
- The Expo dashboard requires clicking into every project one by one.

`expo-app-info` walks your whole account via the EAS GraphQL API and prints one table.

## Requirements

Node.js **20 or later** (the CLI uses the global `fetch`). Node 22 LTS or newer
is recommended — Node 20 reached end of life in April 2026.

## Usage

```bash
npx expo-app-info
```

No install required. If you prefer:

```bash
npm install -g expo-app-info
expo-app-info
```

Filter by platform, or switch the output format for scripts:

```bash
npx expo-app-info --platform ios
npx expo-app-info --json  > apps.json
npx expo-app-info --csv   > apps.csv
```

Show more than just the latest build per platform:

```bash
npx expo-app-info --history 5
```

```
┌─────────┐────────────┐───────────┐──────────┐─────────┐───────┐───────────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ BUILD DATE          │
├─────────┼────────────┼───────────┼──────────┼─────────┼───────┼───────────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.1   │ 41    │ 2026/07/26-09:12:34 │
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.0   │ 40    │ 2026/06/30-14:05:02 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ 2026/06/30-14:03:47 │
└─────────┘────────────┘───────────┘──────────┘─────────┘───────┘───────────────────────────┘
```

`--history <N>` (1–100, default: 1) prints the `N` most recent **successful**
builds per platform as separate rows instead of collapsing each app/platform
down to a single row. Rows are always newest-first by build date — sorted on
the client, not just trusted from the API's response order, since that
order isn't documented anywhere. It works with `--platform`, `--json`, and
`--csv`, but cannot be combined with `--usage`. `--history 1` prints exactly
the same output as leaving the flag off entirely.

Or ask about the account itself rather than its apps:

```bash
npx expo-app-info --usage
```

```
┌─────────┐───────────┐────────┐───────────┐────────┐────────────────────┐
│ ACCOUNT │ PLAN       │ STATUS │ CONCURRENCY │ BUILDS │ PERIOD                  │
├─────────┼───────────┼────────┼────────────┼────────┼────────────────────┤
│ myorg   │ Production │ active │ 3           │ 34     │ 2026-07-01 → 2026-07-31 │
└─────────┘───────────┘────────┘────────────┘────────┘────────────────────┘
```

`BUILDS` is the sum of both platforms for the current billing period; pass
`--platform ios` or `--platform android` to see just that platform's count
(and its own concurrency) instead. `PERIOD` shows the last calendar day the
period actually covers — the API's own `billingPeriod.end` is exclusive (the
instant the *next* period starts), which would otherwise print as
"2026-07-01 → 2026-08-01" for a period that is entirely July.

Or just the account's current subscription, with no build counts or billing
period at all:

```bash
npx expo-app-info --plan
```

```
┌─────────┐────────────┐────────────┐────────┐──────────────────────────┐─────────┐
│ ACCOUNT │ PLAN       │ PLAN ID    │ STATUS │ CONCURRENCY (TOTAL/IOS/AND) │ TRIAL END │
├─────────┼────────────┼────────────┼────────┼──────────────────────────┼─────────┤
│ myorg   │ Production │ production │ active │ 2 / 1 / 1                   │ -         │
└─────────┘────────────┘────────────┘────────┘──────────────────────────┘─────────┘
```

`--plan` shows only the account's *current* subscription — no build counts,
no billing period — since those are "as of now" facts that would otherwise
be repeated identically on every row if shown alongside historical data.
Pass `--platform ios` or `--platform android` to narrow `CONCURRENCY` to
just that platform's number. Cannot be combined with `--usage` or
`--history`, since all three are separate display modes.

## Authentication

A personal access token in the **`EXPO_TOKEN`** environment variable — that is the only supported credential.

```bash
export EXPO_TOKEN=xxxxxxxx
npx expo-app-info
```

Create one at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

This is deliberately the only option. The token is never read from `argv` and never written to disk, so it cannot leak through your shell history, the process list, or a forgotten config file. If `EXPO_TOKEN` is missing the CLI exits with a non-zero status — it never blocks on a prompt, which keeps it safe to run in CI.

> **On robot tokens:** a robot token can only see the account that issued it. Use a personal access token to list every account you belong to.

> **On `--usage`:** plan and usage data are billing-scoped. If the token lacks billing permission on an account, that row still prints with `-` in the plan/build columns and the reason goes to stderr — the run does not fail.

> **On `--plan`:** same billing-scope caveat as `--usage` — a token without billing permission on an account shows `-` in that row's plan columns and reports the reason on stderr, rather than failing the run.

## What the numbers mean

| Column         | Source                                                     |
| -------------- | ---------------------------------------------------------- |
| `ACCOUNT`      | The account's EAS "Display name" if set, else its unique slug (table only — see below) |
| `APP` / `SLUG` | EAS project name and slug                                  |
| `PLATFORM`     | `ios` / `android`                                          |
| `VERSION`      | `appVersion` of the latest **successful** build            |
| `BUILD`        | `appBuildVersion` (iOS build number / Android versionCode) |
| `BUILD DATE`   | When that build finished (`YYYY/MM/DD-HH:mm:ss`, UTC)      |

With `--usage`, one row per account instead:

| Column        | Source                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT`     | Same as above — the account's EAS "Display name" if set, else its unique slug                                                                                       |
| `PLAN`        | `subscription.name` (e.g. Free / Production / Enterprise)                                                                                                            |
| `STATUS`      | Subscription status as Expo reports it (`active`, `trialing`, …)                                                                                                     |
| `CONCURRENCY` | Build concurrency included in the plan; per platform with `--platform`                                                                                               |
| `BUILDS`      | Builds run this billing period, from EAS's own usage metrics (not counted locally); summed across platforms, or per platform with `--platform`                       |
| `PERIOD`      | Current EAS **billing** period — not the calendar month. The table shows the last inclusive day; `--json`/`--csv` `periodEnd` keeps the API's raw (exclusive) value. |

With `--plan`, one row per account instead, with only the current subscription (no build counts or billing period):

| Column                        | Source                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `ACCOUNT`                     | Same as above                                                                                 |
| `PLAN`                        | `subscription.name`                                                                           |
| `PLAN ID`                     | `subscription.planId`                                                                         |
| `STATUS`                      | Subscription status as Expo reports it (`active`, `trialing`, …)                             |
| `CONCURRENCY (TOTAL/IOS/AND)` | All three concurrency numbers at once; narrows to one with `--platform`                      |
| `TRIAL END`                   | `subscription.trialEnd` (`YYYY-MM-DD`), or `-` if the account isn't (or never was) trialing   |

There is no monthly price column yet — it hasn't been confirmed to exist in
the EAS schema. It may be added later once that's checked against a real
token.

**`VERSION` is not read from your local `app.json`.** EAS does not store a version on the project itself, so the number shown is the one baked into the most recent successful build. Apps that have never been built show `-`.

**`ACCOUNT` is cosmetic — table only.** It shows the account's EAS "Display name" when the account has one set, falling back to the unique slug otherwise, since the display name is friendlier to read and is not guaranteed to be unique. `--json`/`--csv` always emit the slug in the `account` field regardless, since scripts may rely on it as a unique key.

## Filtering

- `--platform <ios|android>` — only builds for this platform. Apps with zero builds are omitted when this filter is set, since they don't match a specific platform. With `--usage` or `--plan`, it switches `CONCURRENCY` (and `BUILDS` for `--usage`) to that platform's own numbers instead of the account total / cross-platform sum.
- `--history <N>` — the `N` most recent successful builds per platform (1–100), newest first, instead of just the latest one. Cannot be combined with `--usage` or `--plan`.

`--usage`, `--plan`, and `--history` are mutually exclusive display modes — combining any two of them is a `CliError`.

There is no `--account` filter at the moment — it was removed (see [#22](https://github.com/eas-flow/expo-app-info/issues/22)) rather than kept alongside the new `ACCOUNT` display-name behavior. Filtering by account may return once the shape it should take (slug, display name, or both) is settled.

## Machine-readable output (`--json` / `--csv`)

Both emit one entry per row shown in the table, with raw values instead of display strings — `null` (JSON) / an empty cell (CSV) where the table shows `-`, and a full ISO 8601 timestamp (`lastBuildAt`) instead of a relative date:

```bash
$ npx expo-app-info --json
[
  {
    "account": "myorg",
    "app": "Storefront",
    "slug": "storefront",
    "platform": "ios",
    "version": "3.2.1",
    "build": "41",
    "lastBuildAt": "2026-07-26T09:12:00.000Z"
  }
]
```

```bash
$ npx expo-app-info --csv
account,app,slug,platform,version,build,lastBuildAt
myorg,Storefront,storefront,ios,3.2.1,41,2026-07-26T09:12:00.000Z
```

`--json` and `--csv` are mutually exclusive, and both can be combined with `--platform`.

With `--usage` they emit the account fields instead: `account`, `plan`, `planId`, `status`, `concurrencyTotal`, `concurrencyIos`, `concurrencyAndroid`, `buildsIos`, `buildsAndroid`, `periodStart`, `periodEnd`. `buildsIos`/`buildsAndroid` are always both present regardless of `--platform` — that flag only changes which numbers the human table combines into `BUILDS`.

With `--plan` they emit: `account`, `plan`, `planId`, `status`, `concurrencyTotal`, `concurrencyIos`, `concurrencyAndroid`, `trialEnd`. All three concurrency fields are always present regardless of `--platform` — that flag only changes which number the human table shows in `CONCURRENCY`.

## Output stability

The default table (columns, wording, colors, spacing) is for humans and is **not** covered by any compatibility guarantee — it can change in any release.

`--json` and `--csv` are for scripts and follow semver: existing fields are never renamed or removed, and their meaning never changes, without a major version bump. New fields may be added in a minor release; scripts should ignore fields they don't recognize.

## How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see (including each account's `displayName`, used only for the table's `ACCOUNT` column)
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(limit, filter: { platform, status: FINISHED })` — the `N` most recent builds per platform (`limit` is 1 unless `--history` is set); the response is sorted by `createdAt` descending on the client, since the API's own build order is undocumented

Build queries run with a concurrency limit of 8. Zero runtime dependencies.

`--usage` skips 2 and 3 and instead runs one query per account: `account.byId(...) { subscription, billingPeriod, usageMetrics.byBillingPeriod(...) }`. The per-platform build split comes from `usageMetrics.byBillingPeriod(...).planMetrics[].platformBreakdown` — not from `filterParams` on the other aggregate endpoint (`metricsForServiceMetric`), which accepts any key without actually filtering by platform.

`--plan` also skips 2 and 3, and runs a smaller query per account than `--usage`'s: `account.byId(...) { subscription }` only — no `billingPeriod` or `usageMetrics`. Accounts are fetched in parallel (concurrency limit of 8, same as build queries), since each account's subscription lookup is independent of the others.

## Roadmap

- [x] `--json` / `--csv` output for CI and spreadsheets
- [x] `--platform` filter
- [x] `--usage`: subscription plan, build concurrency, and monthly build counts per platform ([#15](https://github.com/eas-flow/expo-app-info/issues/15))
- [x] `--history <N>`: show the N most recent builds per platform, not just the latest ([#17](https://github.com/eas-flow/expo-app-info/issues/17))
- [x] `ACCOUNT` shows the EAS "Display name" (falls back to the slug); `--account` removed ([#22](https://github.com/eas-flow/expo-app-info/issues/22))
- [x] `--plan`: current account subscription (plan, plan ID, status, concurrency, trial end) on its own, separate from `--usage`'s build counts ([#19](https://github.com/eas-flow/expo-app-info/issues/19))
- [ ] Diff against local `app.json` to surface version drift between source and shipped builds
- [ ] Show the latest submitted store version alongside the build version

Issues and PRs welcome.

## Caveats

The EAS GraphQL API is **not officially documented or versioned**. Field names were derived from Expo's own open-source clients ([`eas-cli`](https://github.com/expo/eas-cli), [`orbit`](https://github.com/expo/orbit)) and may change without notice. This project is not affiliated with Expo.

## Security

The `EXPO_TOKEN` is never read from `argv`, never written to disk, and never
printed. See [SECURITY.md](./SECURITY.md) for the full policy and for how to
report a vulnerability privately.

## Contributing

Bug reports and PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev setup, test/lint commands, and release process. This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).

## License

MIT

# expo-app-info

[![npm version](https://img.shields.io/npm/v/expo-app-info.svg)](https://www.npmjs.com/package/expo-app-info)
[![license](https://img.shields.io/npm/l/expo-app-info.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/expo-app-info.svg)](https://nodejs.org)

> List every Expo (EAS) app in your account — with its latest build version per platform — from **any** directory.

> **Unofficial.** Not affiliated with or endorsed by Expo.

```
$ npx expo-app-info

┌─────────┬──────────────┬──────────────┬──────────┬─────────┬───────┬────────────┐
│ ACCOUNT │ APP          │ SLUG         │ PLATFORM │ VERSION │ BUILD │ LAST BUILD │
├─────────┼──────────────┼──────────────┼──────────┼─────────┼───────┼────────────┤
│ myorg   │ Storefront   │ storefront   │ ios      │ 3.2.1   │ 41    │ 3d ago     │
│ myorg   │ Storefront   │ storefront   │ android  │ 3.2.0   │ 38    │ 1mo ago    │
│ myorg   │ Field Ops    │ field-ops    │ ios      │ 1.4.0   │ 12    │ 2mo ago    │
│ myorg   │ Prototype    │ prototype    │ -        │ -       │ -     │ -          │
└─────────┴──────────────┴──────────────┴──────────┴─────────┴───────┴────────────┘
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

Filter to one account or platform, or switch the output format for scripts:

```bash
npx expo-app-info --account myorg --platform ios
npx expo-app-info --json  > apps.json
npx expo-app-info --csv   > apps.csv
```

Or ask about the account itself rather than its apps:

```bash
npx expo-app-info --usage
```

```
┌─────────┬────────────┬────────┬─────────────┬────────┬─────────────────────────┐
│ ACCOUNT │ PLAN       │ STATUS │ CONCURRENCY │ BUILDS │ PERIOD                  │
├─────────┼────────────┼────────┼─────────────┼────────┼─────────────────────────┤
│ myorg   │ Production │ active │ 3           │ 34     │ 2026-07-01 → 2026-07-31 │
└─────────┴────────────┴────────┴─────────────┴────────┴─────────────────────────┘
```

`BUILDS` is the sum of both platforms for the current billing period; pass
`--platform ios` or `--platform android` to see just that platform's count
(and its own concurrency) instead. `PERIOD` shows the last calendar day the
period actually covers — the API's own `billingPeriod.end` is exclusive (the
instant the *next* period starts), which would otherwise print as
"2026-07-01 → 2026-08-01" for a period that is entirely July.

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

## What the numbers mean

| Column         | Source                                                     |
| -------------- | ---------------------------------------------------------- |
| `ACCOUNT`      | Accounts the authenticated actor belongs to                |
| `APP` / `SLUG` | EAS project name and slug                                  |
| `PLATFORM`     | `ios` / `android`                                          |
| `VERSION`      | `appVersion` of the latest **successful** build            |
| `BUILD`        | `appBuildVersion` (iOS build number / Android versionCode) |
| `LAST BUILD`   | When that build finished                                   |

With `--usage`, one row per account instead:

| Column        | Source                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT`     | Accounts the authenticated actor belongs to                                                                                                                          |
| `PLAN`        | `subscription.name` (e.g. Free / Production / Enterprise)                                                                                                            |
| `STATUS`      | Subscription status as Expo reports it (`active`, `trialing`, …)                                                                                                     |
| `CONCURRENCY` | Build concurrency included in the plan; per platform with `--platform`                                                                                               |
| `BUILDS`      | Builds run this billing period, from EAS's own usage metrics (not counted locally); summed across platforms, or per platform with `--platform`                       |
| `PERIOD`      | Current EAS **billing** period — not the calendar month. The table shows the last inclusive day; `--json`/`--csv` `periodEnd` keeps the API's raw (exclusive) value. |

**`VERSION` is not read from your local `app.json`.** EAS does not store a version on the project itself, so the number shown is the one baked into the most recent successful build. Apps that have never been built show `-`.

## Filtering

- `--account <name>` — only this account (exact match, case-insensitive against the `ACCOUNT` column). Apps in other accounts are never fetched.
- `--platform <ios|android>` — only builds for this platform. Apps with zero builds are omitted when this filter is set, since they don't match a specific platform. With `--usage`, it switches `CONCURRENCY` and `BUILDS` to that platform's own numbers instead of the account total / cross-platform sum.

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

`--json` and `--csv` are mutually exclusive, and both can be combined with `--account` / `--platform`.

With `--usage` they emit the account fields instead: `account`, `plan`, `planId`, `status`, `concurrencyTotal`, `concurrencyIos`, `concurrencyAndroid`, `buildsIos`, `buildsAndroid`, `periodStart`, `periodEnd`. `buildsIos`/`buildsAndroid` are always both present regardless of `--platform` — that flag only changes which numbers the human table combines into `BUILDS`.

## Output stability

The default table (columns, wording, colors, spacing) is for humans and is **not** covered by any compatibility guarantee — it can change in any release.

`--json` and `--csv` are for scripts and follow semver: existing fields are never renamed or removed, and their meaning never changes, without a major version bump. New fields may be added in a minor release; scripts should ignore fields they don't recognize.

## How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(filter: { platform, status: FINISHED })` — latest build per platform

Build queries run with a concurrency limit of 8. Zero runtime dependencies.

`--usage` skips 2 and 3 and instead runs one query per account: `account.byId(...) { subscription, billingPeriod, usageMetrics.byBillingPeriod(...) }`. The per-platform build split comes from `usageMetrics.byBillingPeriod(...).planMetrics[].platformBreakdown` — not from `filterParams` on the other aggregate endpoint (`metricsForServiceMetric`), which accepts any key without actually filtering by platform.

## Roadmap

- [x] `--json` / `--csv` output for CI and spreadsheets
- [x] `--account` / `--platform` filters
- [x] `--usage`: subscription plan, build concurrency, and monthly build counts per platform ([#15](https://github.com/eas-flow/expo-app-info/issues/15))
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

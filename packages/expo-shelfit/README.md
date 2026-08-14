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

## 🔑 Authentication & 📦 Install

First, create a personal access token at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

```bash
export EXPO_TOKEN=xxxxxxxx
```

```bash
# quick start
npx @my-shelfio/expo-shelfit

# global install
npm install -g @my-shelfio/expo-shelfit
expo-shelfit
```

Requires Node.js **22 or later** (the CLI uses the global `fetch`).

A personal access token in the **`EXPO_TOKEN`** environment variable — that is the only supported credential.

- Used only in an `Authorization` header, sent to the EAS GraphQL endpoint (`https://api.expo.dev/graphql`) over HTTPS
- Never read from `argv`, never written to disk, and never printed — so it cannot leak through your shell history, the process list, a forgotten config file, or the CLI's own output
- If it is missing, the CLI exits with a non-zero status

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

### Deprecated

`--usage` is a deprecated alias for `--stats`, and `--plan` is a deprecated alias for `--members`. Both still work and print the identical table, but write a deprecation warning to stderr and will be removed in the next major version.

## 🚀 Features

- **See your shipping status at a glance, from any directory** — the default: every Expo (EAS) app tied to your account, one row per app × platform, with its version, Expo SDK/eas-cli version, latest **BUILD** result, latest **SUBMIT** (store submission) result, and latest **UPDATE** (OTA) — no more tabbing between expo.dev's Builds/Submissions/Updates tabs
- **Check past build results** — `--history <N>` shows the `N` most recent build attempts per platform, not just the latest, each row with its own SUBMIT (that build's store submission) and UPDATE (the latest OTA published to that build's runtime); `-` where there is none
- **Track build results and time by month** — `--stats` aggregates success/errored/canceled build counts and total build time (`BUILD MINUTES`, queue wait excluded) per UTC calendar month (`--group-by app` to count per app, `--month <n>` to widen the window)
- **See your accounts, their members, and your subscription** — `--members` shows one row per organization member (with their `ROLE`) plus the current subscription (plan, plan ID, status, concurrency, trial end); a personal account gets one row with `ORG` as `-`

## 📚 Learn more

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, project layout, and the release process (and, from there, which GraphQL queries each display mode runs)
- [SECURITY.md](../../.github/SECURITY.md) — vulnerability reporting policy and how to report an issue privately

## ❓ FAQ

**Is this an official Expo tool?**

No. The EAS GraphQL API is **not officially documented or versioned**. Field names were derived from Expo's own open-source clients ([`eas-cli`](https://github.com/expo/eas-cli), [`orbit`](https://github.com/expo/orbit)) and may change without notice.

**Can I use a robot token instead of a personal access token?**

A robot token can only see the account that issued it. Use a personal access token to list every account you belong to.

**Why do some cells show `-`?**

Either there is nothing to show (an app with no builds, a personal account's `ORG`), or the CLI couldn't read it. A fetch the token isn't allowed to make — the plan columns are billing-scoped, for instance — degrades that row to `-` and prints the reason on stderr; the run itself does not fail.

**Why don't the `--stats` numbers match my EAS bill?**

They aren't billing figures. Counts come from each app's build history, bucketed client-side by UTC calendar month, while EAS bills on its own cycle. `BUILD MINUTES` also excludes EAS queue wait, which is driven by EAS congestion and your concurrency limit rather than by anything in your project.

## 📄 License

[MIT](./LICENSE)

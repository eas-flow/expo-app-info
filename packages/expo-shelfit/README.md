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

# Filter by 
npx @my-shelfio/expo-shelfit --platform ios
npx @my-shelfio/expo-shelfit --account myorg
npx @my-shelfio/expo-shelfit --app storefront

# Local timezone
npx @my-shelfio/expo-shelfit --local

# Build history
npx @my-shelfio/expo-shelfit --history 5

# Monthly stats
npx @my-shelfio/expo-shelfit --stats                            
npx @my-shelfio/expo-shelfit --stats --group-by app --month 1

# Subscription plan
npx @my-shelfio/expo-shelfit --plan
```

### Deprecated

`--usage` is a deprecated alias for `--stats`. It still works and prints the identical table, but writes a deprecation warning to stderr and will be removed in the next major version.

## 🚀 Features

- (default) — List every Expo (EAS) app in your account, with its latest build attempt per platform, from **any** directory
- `--platform <ios|android>` — Filter to one platform
- `--account <slug|name>` / `--app <slug|name>` — Narrow to a single account or app, across every display mode
- `--local` — Show `BUILD DATE` in your local timezone instead of UTC
- `--history <N>` — Show the `N` most recent build attempts per platform, not just the latest
- `--stats` — Success/errored/canceled build counts per UTC calendar month (`--group-by app` to count per app, `--month <n>` to widen the window)
- `--plan` — Current account subscription: plan, plan ID, status, concurrency, trial end

## 📚 Documentation

### How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see (including each account's `displayName`, used only for the table's `ACCOUNT` column)
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(offset: 0, limit: $limit, filter: { platform })` — the `N` most recent build attempts per platform, whatever their status (`limit` is 1 unless `--history` is set); the response is sorted by `createdAt` descending on the client

`--stats` reuses Steps 1–2 and, instead of Step 3, paginates the builds for each app and aggregates the data on the client side.

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

**Why do some accounts show `-` in the `--plan` columns?**

Plan data is billing-scoped. If the token lacks billing permission on an account, that row still prints with `-` in the plan columns and the reason goes to stderr, rather than failing the run.

**What if `STATUS` shows something other than `Finished`/`Errored`/`Canceled`?**

Those three are the only EAS build statuses confirmed against the real API so far. A still in-progress or queued build — or any other status this unofficial API introduces later — shows the raw enum value lowercased instead of a friendly label, rather than breaking or hiding the row.

**Is the `EXPO_TOKEN` ever written to disk or logged?**

No. It is never read from `argv`, never written to disk, and never printed. See [SECURITY.md](../../.github/SECURITY.md) for the full policy and how to report a vulnerability privately.

## 📄 License

[MIT](./LICENSE)

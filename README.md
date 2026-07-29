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

## Authentication

A personal access token in the **`EXPO_TOKEN`** environment variable — that is the only supported credential.

```bash
export EXPO_TOKEN=xxxxxxxx
npx expo-app-info
```

Create one at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

This is deliberately the only option. The token is never read from `argv` and never written to disk, so it cannot leak through your shell history, the process list, or a forgotten config file. If `EXPO_TOKEN` is missing the CLI exits with a non-zero status — it never blocks on a prompt, which keeps it safe to run in CI.

> **On robot tokens:** a robot token can only see the account that issued it. Use a personal access token to list every account you belong to.

## What the numbers mean

| Column         | Source                                                     |
| -------------- | ---------------------------------------------------------- |
| `ACCOUNT`      | Accounts the authenticated actor belongs to                |
| `APP` / `SLUG` | EAS project name and slug                                  |
| `PLATFORM`     | `ios` / `android`                                          |
| `VERSION`      | `appVersion` of the latest **successful** build            |
| `BUILD`        | `appBuildVersion` (iOS build number / Android versionCode) |
| `LAST BUILD`   | When that build finished                                   |

**`VERSION` is not read from your local `app.json`.** EAS does not store a version on the project itself, so the number shown is the one baked into the most recent successful build. Apps that have never been built show `-`.

## How it works

Three GraphQL queries against `https://api.expo.dev/graphql`:

1. `meActor { accounts }` — every account the token can see
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(filter: { platform, status: FINISHED })` — latest build per platform

Build queries run with a concurrency limit of 8. Zero runtime dependencies.

## Roadmap

- [ ] `--json` / `--csv` output for CI and spreadsheets
- [ ] `--account` / `--platform` filters
- [ ] Diff against local `app.json` to surface version drift between source and shipped builds
- [ ] Show the latest submitted store version alongside the build version

Issues and PRs welcome.

## Caveats

The EAS GraphQL API is **not officially documented or versioned**. Field names were derived from Expo's own open-source clients ([`eas-cli`](https://github.com/expo/eas-cli), [`orbit`](https://github.com/expo/orbit)) and may change without notice. This project is not affiliated with Expo.

## Security

The `EXPO_TOKEN` is never read from `argv`, never written to disk, and never
printed. See [SECURITY.md](./SECURITY.md) for the full policy and for how to
report a vulnerability privately.

## License

MIT

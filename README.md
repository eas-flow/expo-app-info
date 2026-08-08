# shelfit

English | [日本語](./README.ja.md)

Monorepo for the shelfit family of CLI tools — small, unofficial,
dependency-free tools that list what you've built on a given platform, from
any directory.

Each tool is its own independently versioned and published npm package under
`packages/*`.

| Package                                              | What it does                                    |
| ----------------------------------------------------- | ------------------------------------------------ |
| [`@my-shelfio/expo-shelfit`](./packages/expo-shelfit) | List every Expo (EAS) app in your account, with its latest build version per platform |

More tools (e.g. for GitHub, Qiita) may be added under `packages/` over time.

See each package's own README for install/usage instructions, and
[CONTRIBUTING.md](./packages/expo-shelfit/CONTRIBUTING.md) for development
setup, checks, and the release process (this repo uses npm workspaces +
[Changesets](https://github.com/changesets/changesets) for independent
per-package versioning).

## License

[MIT](./LICENSE)

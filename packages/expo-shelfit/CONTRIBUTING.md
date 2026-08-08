# Contributing

English | [日本語](./CONTRIBUTING.ja.md)

Thanks for considering a contribution to `shelfit`. This is a small,
dependency-free CLI, so the bar for changes is: does it earn its place?

## Development setup

This package lives in a `shelfit` monorepo (npm workspaces). Requires
Node.js **22 LTS or newer** (the `engines` field requires 22+).

```bash
git clone https://github.com/my-shelfio/shelfit.git
cd shelfit
npm install
```

`npm install` at the repo root installs dependencies for every package in
`packages/*`, including this one.

Run the CLI locally:

```bash
export EXPO_TOKEN=xxxxx
npm start --workspace=packages/expo-shelfit
```

## Checks

Run from the repo root, scoped to this package:

```bash
npm test --workspace=packages/expo-shelfit               # Vitest
npm run test:coverage --workspace=packages/expo-shelfit  # Vitest with coverage
```

Lint/format apply to the whole monorepo and run from the repo root:

```bash
npm run lint    # Biome (lint + format check)
npm run format  # Biome (write formatting fixes)
```

All of the above run in CI on every PR (Node 20 / 22 / 24). Please make sure
they pass locally before opening a PR — see `.github/pull_request_template.md`
for the checklist.

## Project layout

Paths below are relative to `packages/expo-shelfit/`:

```
bin/cli.mjs           Thin executable entry point (shebang + calls src/cli.mjs#run)
src/cli.mjs           The top-level run() flow: resolve auth, fetch accounts,
                      dispatch to a display mode in src/commands/
src/args.mjs          Argument parsing, validation limits, help text
src/commands/
  list.mjs            Default app list (and --history)
  usage.mjs           --usage (successful builds per UTC calendar month)
  plan.mjs            --plan (current subscription per account)
src/api.mjs           EAS GraphQL client (throws, never exits/prints) +
                      mapWithConcurrency/CONCURRENCY
src/format.mjs        entries → JSON/CSV/display-row conversion (FIELDS/
                      USAGE_FIELDS/PLAN_FIELDS are the machine-readable
                      output contract)
src/render.mjs        Table rendering and column widths
src/dates.mjs         UTC date helpers (calendar-month boundaries, display
                      formatting) — every date this CLI shows is UTC
src/progress.mjs      TTY-only progress reporting on stderr
test/                 Vitest tests, one file per src module (run-*.test.mjs
                      are the per-display-mode integration tests for run()
                      with a mocked fetch; shared bits live in helpers.mjs)
```

Imports flow one way — `bin → cli → args / commands/* → api / format /
render / dates / progress`, with `format` also using `dates`/`render` — and
never in reverse (e.g. `api.mjs` must not import from `commands/`).

`src/*` files never call `process.exit` or read directly from `process.argv`
so they stay unit-testable. Only `bin/cli.mjs` is allowed to exit the process.

## Branch strategy

- `develop` — integration branch, where day-to-day work merges
- `main` — released branch; a release PR moves `develop` → `main`. Publishing
  to npm happens automatically from there (see Releasing below) — there is
  no manual tagging step.

## Commit / PR conventions

No enforced commit message format. Keep commits focused and PRs small. Use
the PR template's Verification checklist.

## Releasing (maintainers)

This is a monorepo, so each package under `packages/*` is versioned and
published independently via [Changesets](https://github.com/changesets/changesets)
(changelog generation is disabled — GitHub Releases are the source of truth
for release notes, see `.github/RELEASE_TEMPLATE.md`). From the repo root:

```bash
npx changeset          # describe your change, pick a package + bump type
```

Add a changeset in the same PR as the change it describes — `changeset` will
ask which package(s) in `packages/*` are affected. Once changesets land on
`main` (via the `develop` → `main` release PR), `.github/workflows/release.yml`
(using [`changesets/action`](https://github.com/changesets/action)) opens or
updates a "Version Packages" PR that bumps the affected package(s)'
`package.json`. Merging that PR triggers the actual `npm publish` — via
Trusted Publishing, no token needed — for every package whose version
changed. No manual `npm version` / `git tag` step.

## Reporting bugs / requesting features

Use the issue templates — they ask for the details that actually matter for
this CLI (Node version, `shelfit --version`, token type), since the
EAS API it depends on is unofficial and undocumented.

## Security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

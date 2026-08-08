# Contributing

English | [日本語](./CONTRIBUTING.ja.md)

Thanks for considering a contribution to `expo-shelfit`. This is a small,
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

All of the above run in CI on every PR (Node 22 / 24). Please make sure
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
                      createSemaphore/mapWithConcurrency/CONCURRENCY
src/format.mjs        entries → display-row conversion (there is no
                      machine-readable output mode; the table is the only
                      supported output)
src/render.mjs        Table rendering and column widths
src/dates.mjs         UTC date helpers (calendar-month boundaries, display
                      formatting) — every date this CLI shows is UTC
src/progress.mjs      TTY-only progress reporting on stderr
test/                 Vitest tests, one file per src module (run-*.test.mjs
                      are the per-display-mode integration tests for run()
                      with a mocked fetch; shared bits live in helpers.mjs)
```

Imports flow one way — `bin → cli → args / commands/* → api / format /
render / dates / progress`, with `format` also using `dates` and `progress`
using `render` — and never in reverse (e.g. `api.mjs` must not import from
`commands/`).

`src/*` files never call `process.exit` or read directly from `process.argv`
so they stay unit-testable. Only `bin/cli.mjs` is allowed to exit the process.

## Branch strategy

- `develop` — integration branch, where day-to-day work merges
- `main` — released branch; a release PR moves `develop` → `main`. Publishing
  to npm is triggered from there by creating a GitHub Release (see Releasing
  below).

## Commit / PR conventions

No enforced commit message format. Keep commits focused and PRs small. Use
the PR template's Verification checklist.

## Releasing (maintainers)

This is a monorepo, so each package under `packages/*` is versioned and
published independently. There's no changelog-generation tooling — GitHub
Releases are the source of truth for release notes, see
`.github/RELEASE_TEMPLATE.md`.

1. Bump the `version` field in the affected package(s)' `package.json` by
   hand (e.g. `packages/expo-shelfit/package.json`). Do this as part of the
   `develop` → `main` release PR, or as a small standalone version-bump PR.
2. Merge that PR into `main`.
3. Create a GitHub Release with a bare `v*.*.*` tag (e.g. `v1.0.1`) —
   drafting the tag on the Release page is enough, a separate `git tag`
   push isn't needed. The tag doesn't encode which package(s) it covers, so
   **say explicitly in the Release body which package(s) changed** (the
   RELEASE_TEMPLATE.md format already has a spot for this per bullet).
4. Publishing the Release triggers `.github/workflows/release.yml`, which
   scans every package under `packages/*`, compares its local
   `package.json` version against what's currently on npm, and runs
   `npm publish` (via Trusted Publishing, no token needed) for whichever
   package(s) differ. Packages whose version didn't change are left alone,
   so one Release can cover version bumps in more than one package at once.

## Reporting bugs / requesting features

Use the issue templates — they ask for the details that actually matter for
this CLI (Node version, `expo-shelfit --version`, token type), since the
EAS API it depends on is unofficial and undocumented.

## Security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

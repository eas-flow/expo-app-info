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
                      dispatch to a feature in src/features/
src/args.mjs          Argument parsing, validation limits, help text
src/errors.mjs        CliError / ApiError
src/shared/
  api.mjs               EAS GraphQL client (throws, never exits/prints)
  concurrency.mjs        createSemaphore / mapWithConcurrency / CONCURRENCY
  filter.mjs             Client-side --account / --app resolution (exact
                      slug/Display name match, "Did you mean" suggestions)
  dates.mjs              UTC date helpers (calendar-month boundaries, display
                      formatting) — every date this CLI shows is UTC
  cells.mjs               cellOrDash, shared by stats/plan's format.mjs
  terminal/
    render.mjs              Table rendering and column widths
    progress.mjs            TTY-only progress reporting on stderr
src/features/
  list/  command.mjs + service.mjs + format.mjs — default app list (and --history)
  stats/ command.mjs + service.mjs + format.mjs — --stats
  plan/  command.mjs + format.mjs — --plan (no service.mjs; too small to need one)
test/                 Vitest tests, mirroring src/ 1:1 (there is no
                      machine-readable output mode; the table is the only
                      supported output). test/features/*/command.test.mjs are
                      the per-feature integration tests for run() with a
                      mocked fetch; test/features/{list,stats}/service.test.mjs
                      test fetching/aggregation against a fake client instead;
                      shared bits live in helpers.mjs
```

Imports flow one way — `bin → cli → args / features/* → shared/*`, with
`errors.mjs` importable by anything and importing nothing itself — and never
in reverse (e.g. `shared/api.mjs` must not import from `features/`), and
never sideways between features (`features/stats/` must not import from
`features/list/`).

`src/*` files never call `process.exit` or read directly from `process.argv`
so they stay unit-testable. Only `bin/cli.mjs` is allowed to exit the
process. Within a feature, `command.mjs` is the only file that calls
`console.*`; `service.mjs` (list/stats) returns plain data instead.

## Branch strategy

- `develop` — integration branch, where day-to-day work merges
- `main` — released branch; a release PR moves `develop` → `main`. Publishing
  to npm is triggered from there by creating a GitHub Release (see Releasing
  below).

## Commit / PR conventions

No enforced commit message format. Keep commits focused and PRs small. Use
the PR template's Verification checklist.

**Never write an issue or PR number into a file in this repo** — not in a
comment, a JSDoc block, a test name, a README, a workflow, or a template. A
number is not an explanation: it sends the reader somewhere else to find out
why the code is the way it is, and that somewhere else drifts, gets closed,
or is unreachable to anyone reading the published package. Write the reason
in place instead — what was observed, what was tried, what constraint the
code is honoring.

**Comments explain why, never what.** Code that can be read is not
commented — don't restate a signature or narrate control flow. Comment only
what the code cannot say for itself: an API behavior confirmed by probing, a
constraint that silently breaks something if changed, a rejected alternative.
Keep those to a sentence or two.

Commit messages, branch names, PR titles/bodies, and Release notes are
outside the issue-number rule; issue linkage there is fine and expected.
Before opening a PR, run from the repo root:

```bash
git grep -nE '#[0-9]{2,4}|issues?/[0-9]+|pull/[0-9]+' -- . ':!package-lock.json'
```

It must return nothing.

## Releasing (maintainers)

This is a monorepo, so each package under `packages/*` is versioned and
published independently. There's no changelog-generation tooling — GitHub
Releases are the source of truth for release notes, see
`.github/RELEASE_TEMPLATE.md`.

1. Bump the `version` field in the affected package(s)' `package.json` by
   hand (e.g. `packages/expo-shelfit/package.json`), then run
   `npm install --package-lock-only` from the repo root so
   `package-lock.json` follows — its `packages/*` entries carry a `version`
   too, and a stale lockfile makes `npm ci` fail in the release workflow. Do
   this as part of the `develop` → `main` release PR, or as a small
   standalone version-bump PR.
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

Note that if you forget the bump, step 4 publishes nothing and still exits
successfully (with a `::warning::`), and npm won't let you re-publish a
version that already exists — recovering means cutting a patch version.

If you use Claude Code, two skills in `.claude/skills/` do the above for
you and guard those footguns: `/shelfit-release-draft <package>@<version>`
covers steps 1–3 (bump + lockfile, release PR, **draft** Release — nothing
is published yet), and `/shelfit-publish` covers step 4 after the PR is
merged (local lint/test, a dry check that some version actually differs
from npm, then publishing the draft Release). See the repo-root `CLAUDE.md`.
The manual steps above remain the source of truth — the skills just follow
them.

## Reporting bugs / requesting features

Use the issue templates — they ask for the details that actually matter for
this CLI (Node version, `expo-shelfit --version`, token type), since the
EAS API it depends on is unofficial and undocumented.

## Security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`shelfit` is an npm-workspaces monorepo for a family of small, dependency-free
CLI tools that each list what you've built on a given platform, from any
directory (e.g. every Expo/EAS app in an account, with its latest build
version per platform). Each tool is its own independently versioned and
published package under `packages/*`. Currently there is one package:
[`@my-shelfio/expo-shelfit`](packages/expo-shelfit).

## Never write issue or PR numbers into the repo

**No file in this repo may reference a GitHub issue or PR number** — no
`#NN`, no `issues/NN`, no `pull/NN`, no `Closes #NN`. This applies to source
comments, JSDoc, test names, `README.md`/`README.ja.md`, this file,
`.github/**` (workflows, PR and issue templates), and `.claude/**` (skills,
agents). It applies to numbers of any width, in Japanese and English alike.

A number is not an explanation. It sends the reader somewhere else to find
out why the code is the way it is, and that somewhere else drifts, gets
closed, or becomes unreachable to anyone reading the published package. The
repo must stand on its own.

Instead: **write the reason in place.** A comment that wants to point at an
issue should carry what that issue said — what was observed, what was tried,
what constraint the code is honoring. If the reason is too long for a
comment, it belongs in the relevant `README.md`, `CONTRIBUTING.md`, or this
file, not behind a link.

Commit messages, branch names, PR titles/bodies, and Release notes are
**outside** this rule — those are Git/GitHub metadata, not repo content, and
issue linkage there is fine and expected.

Before opening a PR:

```bash
git grep -nE '#[0-9]{2,4}|issues?/[0-9]+|pull/[0-9]+' -- . ':!package-lock.json'
```

This must return nothing.

## Comments explain why, never what

Code that can be read is not commented. Do not restate a signature, narrate
control flow, or describe what a well-named function obviously does — that
comment is noise on the first read and a lie after the next refactor.

Comment only what the code cannot say for itself: an EAS API behavior
confirmed by probing an undocumented endpoint, a constraint that silently
breaks something if changed (every date boundary staying UTC), a rejected
alternative, a deliberate omission. Keep those short — a sentence or two, not
a JSDoc essay.

The same applies to `README.md`/`README.ja.md` and this file: if an example
or a table already shows it, don't restate it in prose. Both READMEs must
stay in sync, so a cut in one is a cut in the other.

## Nothing redundant in the code either

The same standard applies to what the code does, not just what it says about
itself. Before adding anything, check it isn't already there:

- **No duplicate work.** A value already fetched or computed is passed along,
  not fetched again — `--group-by app` adds no API call precisely because the
  per-app counts were already in hand.
- **No defensive layers that can't fire.** Don't re-validate what `parseArgs`
  already rejected, don't null-check a value the caller guarantees, don't
  catch an error only to rethrow it unchanged.
- **No option, flag, parameter, or helper without a caller.** This CLI is
  small and zero-dependency on purpose; anything that only *might* be needed
  is not needed. Delete it — git remembers.
- **No second way to do one thing.** One date formatter, one table renderer,
  one filter path. A near-copy of an existing helper is a sign the original
  needed a parameter, not a sibling.

When a change makes existing code unreachable or pointless, removing it is
part of that change, not a follow-up.

## Commands

`npm install` at the repo root installs deps for every package. Per-package
lint/test/dev commands are in
[CONTRIBUTING.md#checks](packages/expo-shelfit/CONTRIBUTING.md#checks); the
commands below are repo-wide or otherwise not there:

```bash
npm test --workspaces --if-present                                       # every package's tests
npx vitest run packages/expo-shelfit/test/features/list/format.test.mjs  # a single test file
```

CI (`.github/workflows/ci.yml`) runs on Node 22 and 24, in this order: `npm run lint`, `npm test --workspaces --if-present`, `npm pack --dry-run` for expo-shelfit, then two smoke tests (`--help` exits 0, missing `EXPO_TOKEN` exits 1). Match this locally before opening a PR.

A separate weekly workflow (`.github/workflows/api-canary.yml`) runs the CLI against the *live* EAS API for every display mode, since the EAS GraphQL API is unofficial/undocumented and can change without notice — it files a GitHub issue on failure.

## Architecture (`packages/expo-shelfit`)

Directory layout is in
[CONTRIBUTING.md#project-layout](packages/expo-shelfit/CONTRIBUTING.md#project-layout).
The design decisions below aren't derivable from that tree alone, so they
stay here rather than there.

**Import direction is one-way and enforced by convention, not tooling**:
`bin → cli → args / features/* → shared/*`, with `errors.mjs` importable by
anything (and importing nothing itself), `features/*/format.mjs` also using
`shared/dates.mjs` and `shared/cells.mjs`, and `shared/terminal/progress.mjs`
using `shared/terminal/render.mjs`'s `dim` — never in reverse (e.g.
`shared/api.mjs` must not import from `features/`), and never sideways
between features (e.g. `features/stats/` must not import from
`features/list/`).

**`command.mjs` is the only place that calls `console.*`.** `service.mjs`
fetches and aggregates, returning plain data plus a `warnings` string array —
no console output — so it can be tested directly against a fake client
instead of a mocked `fetch`. `command.mjs` passes that data to `format.mjs`,
renders the table, and prints warnings/footers.

**`src/*` never calls `process.exit` or reads `process.argv` directly**, so
everything stays unit-testable. Only `bin/cli.mjs` is allowed to exit the
process — it's the sole place that catches `CliError`/`ApiError` (`src/errors.mjs`)
and converts them into a printed message + exit code.

**Auth**: a personal access token in `EXPO_TOKEN` is the only supported
credential — never read from `argv`, never written to disk. Missing token
throws `CliError` in `resolveAuthHeaders` (`src/cli.mjs`).

**Display modes are mutually exclusive**: `--stats`, `--members`, and
`--history` cannot be combined with each other — combining any two is a
`CliError`.

**`--usage` is a deprecated alias for `--stats`, `--plan` is a deprecated
alias for `--members`** (both removed in the next major). `parseArgs` sets
the same `opts.stats`/`opts.members` for each pair and appends
`DEPRECATED_USAGE_WARNING`/`DEPRECATED_PLAN_WARNING` to `opts.warnings`
rather than printing it, so `parseArgs` stays I/O-free. Error messages echo
whichever name was typed (`args.mjs#modeFlag`, keyed by an `aliasFlags`
object with one entry per mode that has a deprecated alias), so
`--usage --plan` must not report `--stats --members`.

**`--account`/`--app` narrow client-side** (`src/shared/filter.mjs`), applied
*before* the expensive per-app overview fetch: `--account` right after step 1
below, `--app` right after step 2. Both match slug or EAS Display name
(case-insensitive, exact); `--app`'s ambiguity is scoped to one account, so a
Display name shared across accounts matches in both. `--app` is incompatible
with `--members`, which skips step 2 entirely. No match throws `CliError`
with Levenshtein "Did you mean" suggestions.

**`--local` switches which calendar day BUILD/SUBMIT/UPDATE fall on**
(`src/shared/dates.mjs#formatBuildDate`, called with `{ time: false }` for all
three — the default list no longer shows time-of-day at all). All three
columns share one date formatter, so `--local` shifts all three together,
never just one. Every UTC boundary (`calendarMonths`, `inclusiveEnd`,
`isoDate`) stays UTC unconditionally, since `--stats`'s month bucketing
compares them directly against build `createdAt`. Incompatible with
`--stats`/`--members`, neither of which has a date column `--local` affects.

**How data is fetched** (all against `https://api.expo.dev/graphql`,
concurrency-limited to 8 via `createSemaphore`/`mapWithConcurrency` in
`src/shared/concurrency.mjs`):
1. `meActor { accounts }` — every account the token can see
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...)` (`src/shared/api.mjs#fetchAppOverview`, one request per app) — `builds`, aliased per platform as `<platform>Builds`, with SUBMIT and UPDATE hanging off each build as sub-selections rather than as separate top-level fields, so every row gets its own and the request count is unchanged. `builds` also carries each build's `sdkVersion`/`cliVersion` (the `SDK`/`CLI` columns, always shown, no flag gates them). SUBMIT comes from `Build.submissions`, the reverse of `Submission.submittedBuild`, so it is exactly that build attempt's submission — no client-side matching, and an unsubmitted build shows `-` instead of borrowing a newer build's value. UPDATE has no build to belong to (an OTA targets a *runtime version*), so it comes from `Build.runtime`'s `updates`; a build with a null `runtime` shows `-`. `RuntimeUpdatesFilterInput` accepts only `channel`, so one runtime's page mixes both platforms and `latestRuntimeUpdate` filters on `Update.platform` client-side — hence `first: 10` rather than `first: 1`. Every response is client-sorted by `createdAt` descending since the API's order is undocumented

`--stats` reuses steps 1–2 but instead pages through every build per app and
buckets client-side by platform + UTC calendar month (`countBuildsByMonth`,
which counts FINISHED/ERRORED/CANCELED and leaves a build in any other status
out of every bucket), also summing each build's `metrics.buildDuration`
(EAS queue wait deliberately excluded) into the `BUILD MINUTES` column — it
does not query billing-scoped fields (`subscription`/`billingPeriod`/
`usageMetrics`), since those are tied to EAS's billing cycle and can't be
sliced into arbitrary calendar ranges.

`--members` skips steps 2–3 and queries only `account.byId(...) {
subscription ownerUserActor membersPaginated }` per account, in
parallel — one request per account regardless of member count, paginating
`membersPaginated` further only when an organization exceeds one page.
`Account.ownerUserActor` is non-null exactly for personal accounts (confirmed
against the real API), so `src/features/members/service.mjs` branches on it:
a personal account becomes one row (`ORG` "-", `MEMBER`/`ROLE` = the owner),
an organization becomes one row per member. A robot member has no
`userActor` (only `User` actors get one) and is named via `actor`'s `Robot`
inline fragment instead — that fragment is only valid on `actor` (typed
`Actor`, the real interface), not on `ownerUserActor` (typed `UserActor`),
which errors if a `... on Robot` fragment is added to it.

**`--group-by <account|app>` picks what a `--stats` row counts**
(`--stats`-only, default `account`). `app` swaps the ACCOUNT column for APP
and makes each (account, app) pair its own group; it adds **no API calls**,
since `src/features/stats/service.mjs` already fetched per-app counts and was
merely summing them. Two consequences worth keeping: grouping is by pair, so
same-named apps in different accounts never merge; and failure gets
finer-grained — one app's failed build fetch degrades only its own rows,
while an account whose *app list* failed contributes no rows at all and is
reported on stderr only.

Per-account/per-app failures don't fail the run: a row still prints with `-`
and the reason goes to stderr.

## Branching & release process

- `develop` — integration branch for day-to-day work.
- `main` — released branch; a release PR moves `develop` → `main`.

Full release steps (version bump, lockfile, GitHub Release, publish workflow)
are in
[CONTRIBUTING.md#releasing-maintainers](packages/expo-shelfit/CONTRIBUTING.md#releasing-maintainers).
Three things about that process are easy to get wrong:

- **Bumping `package.json` alone isn't enough** — `package-lock.json` records
  the version for each `packages/*` entry too. Run
  `npm install --package-lock-only` after the bump, or `npm ci` in
  `release.yml` fails on a lockfile mismatch.
- **Forgetting the bump publishes nothing, silently** — `release.yml` only
  publishes packages whose version differs from npm; if none differ it emits
  a `::warning::` and exits 0. Green CI, nothing released.
- **A draft Release is safe; publishing it is not** — the workflow listens for
  `release: published` only, and npm refuses to re-publish a version that
  already exists. Recovering from a bad release means cutting a patch version.

See [packages/expo-shelfit/CONTRIBUTING.md](packages/expo-shelfit/CONTRIBUTING.md) for the full contributor workflow, and [.github/SECURITY.md](.github/SECURITY.md) for the vulnerability-reporting policy (do not open a public issue for security bugs).

## Skills (`.claude/skills/`)

The release process above is automated by two skills, split at the human gate
(reviewing and merging the release PR):

```
develop ──[A]──▶ release PR ──(human: review & merge)──▶ main ──[B]──▶ Release published ──▶ release.yml ──▶ npm
```

| Skill                                                                  | What it does                                                                                                                   | Example                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [shelfit-release-draft](.claude/skills/shelfit-release-draft/SKILL.md) | **A.** Bumps `package.json` + `package-lock.json`, pushes to `develop`, opens the `develop` → `main` PR, drafts the Release    | `/shelfit-release-draft expo-shelfit@1.1.0` |
| [shelfit-publish](.claude/skills/shelfit-publish/SKILL.md)             | **B.** Runs lint/test locally, dry-checks local versions against npm, then publishes the draft Release and tracks the workflow | `/shelfit-publish`                          |

A is fully reversible (a draft Release doesn't trigger anything); B's Release
publish is the single irreversible step and always asks for confirmation
first. Both draft only — approving and merging stays with a human.

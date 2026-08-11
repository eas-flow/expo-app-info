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

Run from the repo root (`npm install` here installs deps for every package):

```bash
npm run lint                                               # Biome lint + format check, whole repo
npm run format                                             # Biome, write formatting fixes
npm test --workspaces --if-present                         # run every package's tests
npm test --workspace=packages/expo-shelfit                 # this package's tests only (Vitest)
npm run test:coverage --workspace=packages/expo-shelfit    # Vitest with coverage
npm start --workspace=packages/expo-shelfit                # run the CLI locally (needs EXPO_TOKEN)
```

Run a single test file with Vitest directly:

```bash
npx vitest run packages/expo-shelfit/test/format.test.mjs
```

CI (`.github/workflows/ci.yml`) runs on Node 22 and 24, in this order: `npm run lint`, `npm test --workspaces --if-present`, `npm pack --dry-run` for expo-shelfit, then two smoke tests (`--help` exits 0, missing `EXPO_TOKEN` exits 1). Match this locally before opening a PR.

A separate weekly workflow (`.github/workflows/api-canary.yml`) runs the CLI against the *live* EAS API for every display mode, since the EAS GraphQL API is unofficial/undocumented and can change without notice — it files a GitHub issue on failure.

## Architecture (`packages/expo-shelfit`)

```
bin/cli.mjs           Thin executable entry point (shebang + calls src/cli.mjs#run)
src/cli.mjs            The top-level run() flow: resolve auth, fetch accounts,
                        dispatch to a display mode in src/commands/
src/args.mjs            Argument parsing, validation limits, help text
src/commands/
  list.mjs               Default app list (and --history)
  stats.mjs               --stats (successful builds per UTC calendar month)
  plan.mjs                --plan (current subscription per account)
src/api.mjs             EAS GraphQL client (throws, never exits/prints) +
                        createSemaphore/mapWithConcurrency/CONCURRENCY
src/filter.mjs           Client-side --account / --app resolution (exact
                        slug/Display name match, "Did you mean" suggestions)
src/format.mjs           entries → display-row conversion (table is the only
                        supported output; no machine-readable mode)
src/render.mjs           Table rendering and column widths
src/dates.mjs            UTC date helpers (calendar-month boundaries, display
                        formatting) — every date this CLI shows is UTC
src/progress.mjs         TTY-only progress reporting on stderr
test/                   Vitest, one file per src module (run-*.test.mjs are
                        per-display-mode integration tests for run() with a
                        mocked fetch; shared bits live in helpers.mjs)
```

**Import direction is one-way and enforced by convention, not tooling**:
`bin → cli → args / commands/* → api / filter / format / render / dates /
progress`, with `format` also using `dates` and `progress` using `render` —
never in reverse (e.g. `api.mjs` must not import from `commands/`).

**`src/*` never calls `process.exit` or reads `process.argv` directly**, so
everything stays unit-testable. Only `bin/cli.mjs` is allowed to exit the
process — it's the sole place that catches `CliError`/`ApiError` and converts
them into a printed message + exit code.

**Auth**: a personal access token in `EXPO_TOKEN` is the only supported
credential — never read from `argv`, never written to disk. Missing token
throws `CliError` in `resolveAuthHeaders` (`src/cli.mjs`).

**Display modes are mutually exclusive**: `--stats`, `--plan`, and
`--history` cannot be combined with each other — combining any two is a
`CliError`.

**`--usage` is a deprecated alias for `--stats`** (removed in the next
major). `parseArgs` sets the same `opts.stats` for both and appends
`DEPRECATED_USAGE_WARNING` to `opts.warnings` rather than printing it, so
`parseArgs` stays I/O-free. Error messages echo whichever name was typed
(`args.mjs#modeFlag`), so `--usage --plan` must not report `--stats`.

**`--account`/`--app` narrow client-side** (`src/filter.mjs`), applied
*before* the expensive per-app build fetch: `--account` right after step 1
below, `--app` right after step 2. Both match slug or EAS Display name
(case-insensitive, exact); `--app`'s ambiguity is scoped to one account, so a
Display name shared across accounts matches in both. `--app` is incompatible
with `--plan`, which skips step 2 entirely. No match throws `CliError` with
Levenshtein "Did you mean" suggestions.

**`--local` switches only the BUILD DATE display timestamp** to local time
(`src/dates.mjs#formatBuildDate`). Every UTC boundary (`calendarMonths`,
`inclusiveEnd`, `isoDate`) stays UTC unconditionally, since `--stats`'s month
bucketing compares them directly against build `createdAt`. Incompatible with
`--stats`/`--plan`, neither of which has a BUILD DATE column.

**How data is fetched** (all against `https://api.expo.dev/graphql`,
concurrency-limited to 8 via `createSemaphore`/`mapWithConcurrency` in
`src/api.mjs`):
1. `meActor { accounts }` — every account the token can see
2. `account.byId(...).appsPaginated(first: 100)` — apps per account, cursor-paginated
3. `app.byId(...).builds(...)` — most recent build(s) per platform, client-sorted by `createdAt` descending since the API's order is undocumented

`--stats` reuses steps 1–2 but instead pages through every finished build per
app and buckets client-side by platform + UTC calendar month
(`countBuildsByMonth`) — it does not query billing-scoped fields
(`subscription`/`billingPeriod`/`usageMetrics`), since those are tied to
EAS's billing cycle and can't be sliced into arbitrary calendar ranges.
`--plan` skips steps 2–3 and queries only `account.byId(...) { subscription }`
per account, in parallel.

**`--group-by <account|app>` picks what a `--stats` row counts**
(`--stats`-only, default `account`). `app` swaps the ACCOUNT column for APP
and makes each (account, app) pair its own group; it adds **no API calls**,
since `src/commands/stats.mjs` already fetched per-app counts and was merely
summing them. Two consequences worth keeping: grouping is by pair, so
same-named apps in different accounts never merge; and failure gets
finer-grained — one app's failed build fetch degrades only its own rows,
while an account whose *app list* failed contributes no rows at all and is
reported on stderr only.

Per-account/per-app failures don't fail the run: a row still prints with `-`
and the reason goes to stderr.

## Branching & release process

- `develop` — integration branch for day-to-day work.
- `main` — released branch; a release PR moves `develop` → `main`.
- Releasing (per package, independently versioned): bump the `version` field
  in the package's `package.json` by hand as part of (or alongside) the
  `develop` → `main` PR, merge, then create a GitHub Release with a bare
  `v*.*.*` tag. Since one tag doesn't encode which package(s) it covers,
  **the Release body must say explicitly which package(s) changed**
  (`.github/RELEASE_TEMPLATE.md` has a spot for this per bullet). Publishing
  the Release triggers `.github/workflows/release.yml`, which diffs every
  package's local version against npm and publishes (via Trusted Publishing)
  whichever package(s) changed.

Three things about this process are easy to get wrong:

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

See [packages/expo-shelfit/CONTRIBUTING.md](packages/expo-shelfit/CONTRIBUTING.md) for the full contributor workflow, and its [SECURITY.md](packages/expo-shelfit/SECURITY.md) for the vulnerability-reporting policy (do not open a public issue for security bugs).

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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`shelfit` is an npm-workspaces monorepo for a family of small, dependency-free
CLI tools that each list what you've built on a given platform, from any
directory (e.g. every Expo/EAS app in an account, with its latest build
version per platform). Each tool is its own independently versioned and
published package under `packages/*`. Currently there is one package:
[`@my-shelfio/expo-shelfit`](packages/expo-shelfit).

## Rules (`.claude/rules/`)

The conventions every change follows, and why each package's code is the
shape it is. Each file opens with a MUST summary; read the file itself before
working in the area it covers.

| Rules file                                                              | Covers                                                                              | Applies to                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| [code-conventions](.claude/rules/code-conventions.md)                   | Comments explain why and never what; nothing redundant in the code either            | `packages/*/{bin,src,test}` |
| [doc-conventions](.claude/rules/doc-conventions.md)                     | Which document owns which fact; never write an issue or PR number into a file        | repo-wide                   |
| [expo-shelfit-architecture](.claude/rules/expo-shelfit-architecture.md) | Import direction, console/`process.exit` boundaries, what each display mode queries   | `packages/expo-shelfit`     |

Two of these bite hardest and are worth knowing before the first edit: **no
file may contain a GitHub issue or PR number** (write the reason in place
instead), and **a comment that restates what the code already says is a
defect**.

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

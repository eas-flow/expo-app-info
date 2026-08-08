# Release notes template

This is a monorepo — `packages/*` are versioned and published
independently, but a single Release uses one bare `vX.Y.Z` tag (e.g.
`v1.0.1`), not a per-package `<package-name>@<version>` tag. The tag alone
doesn't say which package(s) it covers, so **each bullet below must name
the affected package** (e.g. `` `@my-shelfio/expo-shelfit`: ... ``) — the
release workflow relies on comparing `package.json` versions against npm,
not on parsing this text, but readers (and you, later) need the mapping.
A single Release can cover version bumps in more than one package at once;
just list each package's changes under its own bullets or a subheading.

Copy this into the GitHub Release body for the tag, and fill in the
placeholders. Drop any category section that has nothing in it (e.g. a
release with no bug fixes just omits 🐛 Bug Fixes).

```markdown
## 🚀 Features

- <!-- New functionality — prefix each bullet with the package name -->

## 🐛 Bug Fixes

- <!-- Fixes, with a link to the issue/PR if useful -->

## 📈 Performance

- <!-- Performance-related changes -->

## 🚨 Breaking Changes

- <!-- breaking changes -->

## Notes

<!-- Optional: breaking changes, upgrade steps, known issues. Omit if none -->

**Full Changelog**: https://github.com/my-shelfio/shelfit/compare/{previous_tag}...{tag}
```

For the very first release (no previous tag to diff against), replace the
`Full Changelog` line with a link to the commit history instead:

```markdown
**Full Changelog**: https://github.com/my-shelfio/shelfit/commits/{tag}
```

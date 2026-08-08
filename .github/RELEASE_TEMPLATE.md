# Release notes template

This is a monorepo — each package under `packages/*` is released and tagged
independently by Changesets, using a `<package-name>@<version>` tag (e.g.
`@my-shelfio/expo-shelfit@1.0.1`), not a bare `vX.Y.Z` tag.

Copy this into the GitHub Release body for the relevant package tag, and
fill in the placeholders. Drop any category section that has nothing in it
(e.g. a release with no bug fixes just omits 🐛 Bug Fixes).

```markdown
## 🚀 Features

- <!-- New functionality -->

## 🐛 Bug Fixes

- <!-- Fixes, with a link to the issue/PR if useful -->

## 📈 Performance

- <!-- Performance-related changes -->

## 🚨 Breaking Changes

- <!-- breaking changes -->

## Notes

<!-- Optional: breaking changes, upgrade steps, known issues. Omit if none -->

**Full Changelog**: https://github.com/my-shelfio/shelfit/compare/{previous_package_tag}...{package_tag}
```

For a package's very first release (no previous tag to diff against),
replace the `Full Changelog` line with a link to the commit history instead:

```markdown
**Full Changelog**: https://github.com/my-shelfio/shelfit/commits/{package_tag}
```

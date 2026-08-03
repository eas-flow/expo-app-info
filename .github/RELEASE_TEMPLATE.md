# Release notes template

Copy this into the GitHub Release body when cutting a new tag, and fill in
the placeholders. Drop any category section that has nothing in it (e.g. a
release with no bug fixes just omits 🐛 Bug Fixes).

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

**Full Changelog**: https://github.com/eas-flow/expo-app-info/compare/{previous_tag}...{tag}
```

For the very first release (no previous tag to diff against), replace the
`Full Changelog` line with a link to the commit history instead:

```markdown
**Full Changelog**: https://github.com/eas-flow/expo-app-info/commits/{tag}
```

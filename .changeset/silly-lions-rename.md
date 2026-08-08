---
"@my-shelfio/expo-shelfit": major
---

Rename the package, GitHub org, and repository: `expo-app-info` → `@my-shelfio/expo-shelfit` (scoped under the new `my-shelfio` npm org), `eas-flow/expo-app-info` → `my-shelfio/shelfit` on GitHub. The `expo-app-info` bin command is replaced by `shelfit`.

- `package.json`: `name`, `bin`, `repository`/`bugs`/`homepage` URLs, `author` URL, and `keywords` (added `shelf`, `portfolio`) updated.
- README/README.ja, HELP text, issue/PR templates, CONTRIBUTING, SECURITY (en/ja) updated to the new name and URLs.
- The old `expo-app-info` package on npm will be deprecated (not unpublished) pointing at the new name.

No behavior change — GraphQL queries, `EXPO_TOKEN` auth, and output are unaffected.

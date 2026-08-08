---
"@my-shelfio/expo-shelfit": patch
---

Move the package into a `packages/expo-shelfit/` monorepo layout (npm workspaces) to make room for future independently-published tools (e.g. for GitHub, Qiita) under `packages/*`. No change to the published package's name, `bin` command, files, or public behavior — only its location within the repository and the internal release tooling (Changesets now versions/publishes each package independently via `changesets/action`, replacing the old single-package tag-push release flow).

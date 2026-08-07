---
"expo-app-info": major
---

Raise minimum supported Node.js version to 22 (issue #42): `engines.node` in `package.json` bumped from `>=20` to `>=22`, CI test matrix narrowed from `[20, 22, 24]` to `[22, 24]`, and README/README.ja Node version requirement updated accordingly. Node 20 reached end of life in April 2026. No code changes — global `fetch` behaves the same on Node 20/22.
